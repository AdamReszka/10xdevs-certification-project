/**
 * Workers-native GitHub REST client (S-02). Validates a classic Personal Access
 * Token and lists the account's repositories using raw `fetch` — no Octokit.
 *
 * Why raw `fetch`, not Octokit (research §Area 3): `new Octokit()` pulls in
 * `bottleneck`, which touches globals unavailable at Workers module scope and
 * crashes the isolate at instantiation; it also adds ~88 KiB gzip for what is
 * two GET requests. `fetch` is the Workers-native primitive and costs nothing.
 *
 * Injectable `baseUrl` + `fetchImpl` are the seam that makes this mockable from
 * both the unit tests and the Playwright e2e — `page.route()` cannot intercept a
 * server-side fetch, so the e2e overrides `baseUrl` to a local fixture server
 * (test-plan §6.3).
 *
 * SECURITY: the token is a bearer secret. It is sent only in the `Authorization`
 * header and NEVER placed in a thrown error, a log line, or a return value.
 */

const DEFAULT_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "SprintFlow";

/** Injectable transport + endpoint, so the client is unit- and e2e-mockable. */
export type GithubClientOpts = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/**
 * The token was rejected by GitHub (401). Distinct from `GithubUnavailableError`
 * so the form can say "invalid token" only when GitHub actually said so — never
 * carries the token (F5, PRD graceful-degradation).
 */
export class GithubAuthError extends Error {
  constructor(message = "GitHub rejected the token (invalid or expired).") {
    super(message);
    this.name = "GithubAuthError";
  }
}

/**
 * GitHub could not be reached or answered with a non-auth failure (403
 * rate-limit / missing UA, 5xx, network/timeout). The token may be perfectly
 * valid — the form must show "couldn't reach GitHub, try again" rather than
 * mislabeling it as invalid (F5). Never carries the token.
 */
export class GithubUnavailableError extends Error {
  constructor(message = "Could not reach GitHub. Please try again.") {
    super(message);
    this.name = "GithubUnavailableError";
  }
}

export type ValidatePatResult = {
  login: string;
  scopes: string[];
  likelyFineGrained: boolean;
};

export type GithubRepo = {
  githubRepoId: number;
  fullName: string;
};

/**
 * A collaborator on a monitored repo (S-04 roster seed). `login`/`id` are the
 * stable identity; `type` distinguishes `User` from `Bot`; `role_name` is the
 * repo permission role. Name/email are unreliable on the collaborators endpoint
 * (frequently withheld), so they are intentionally absent — roster dedup is a
 * manual GitHub↔Jira mapping, never an email join (plan: What We're NOT Doing).
 */
export type GithubCollaborator = {
  login: string;
  id: number;
  type: string;
  roleName?: string;
};

/** Headers common to every authenticated GitHub REST call. */
function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    // GitHub returns 403 for requests without a User-Agent.
    "User-Agent": USER_AGENT,
  };
}

/**
 * Perform a GET against GitHub, mapping transport/status failures to the two
 * typed errors. A thrown network error (offline, DNS, timeout) becomes
 * `GithubUnavailableError`; the caller decides how to treat each status.
 */
async function githubGet(
  url: string,
  token: string,
  opts: GithubClientOpts | undefined,
): Promise<Response> {
  const doFetch = opts?.fetchImpl ?? fetch;
  try {
    return await doFetch(url, { headers: githubHeaders(token) });
  } catch {
    // Network-level failure (offline, DNS, timeout). We deliberately do NOT
    // attach the caught error as `cause` — its message could echo the request
    // and we never risk the token surfacing in a log/stack.
    throw new GithubUnavailableError(
      "Could not reach GitHub (network error). Please try again.",
    );
  }
}

/**
 * Validate a classic PAT against `GET /user`.
 * - 200 → parse `login` + granted scopes from the `x-oauth-scopes` header
 *   (comma-separated). A fine-grained PAT omits that header entirely, so an
 *   absent header ⇒ `likelyFineGrained: true` (MVP locks classic per FR-002).
 * - 401 → `GithubAuthError` (the token is bad).
 * - anything else (403, 5xx) → `GithubUnavailableError`.
 */
export async function validatePat(
  token: string,
  opts?: GithubClientOpts,
): Promise<ValidatePatResult> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const res = await githubGet(`${baseUrl}/user`, token, opts);

  if (res.status === 401) {
    throw new GithubAuthError();
  }
  if (!res.ok) {
    throw new GithubUnavailableError(
      `GitHub responded with ${res.status}. Please try again.`,
    );
  }

  let body: { login?: unknown };
  try {
    body = (await res.json()) as { login?: unknown };
  } catch {
    throw new GithubUnavailableError(
      "GitHub returned an unreadable response. Please try again.",
    );
  }
  if (typeof body.login !== "string" || body.login.length === 0) {
    throw new GithubUnavailableError(
      "GitHub returned an unexpected response. Please try again.",
    );
  }

  const scopeHeader = res.headers.get("x-oauth-scopes");
  const likelyFineGrained = scopeHeader === null;
  const scopes =
    scopeHeader === null
      ? []
      : scopeHeader
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

  return { login: body.login, scopes, likelyFineGrained };
}

/** Hard cap on repo pages followed — defends against an unbounded `Link` chain (100/page ⇒ ≤2000 repos). */
const MAX_REPO_PAGES = 20;

/** Parse the `rel="next"` URL out of a GitHub `Link` header, if present. */
function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * List the account's repositories, following `Link: rel="next"` pagination
 * until exhausted. GitHub's OpenAPI omits the `Link` header but the live API
 * sends it, so we read the real header rather than trusting the schema.
 *
 * A non-OK status or a network failure surfaces as `GithubUnavailableError`
 * (this runs only after `validatePat` already accepted the token, so a 401 here
 * is an availability blip, not an auth verdict).
 */
export async function listRepos(
  token: string,
  opts?: GithubClientOpts,
): Promise<GithubRepo[]> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams({
    per_page: "100",
    affiliation: "owner,collaborator,organization_member",
    sort: "full_name",
  });

  let url: string | null = `${baseUrl}/user/repos?${params.toString()}`;
  const repos: GithubRepo[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  let pageCount = 0;

  while (url) {
    if (++pageCount > MAX_REPO_PAGES) {
      throw new GithubUnavailableError(
        `GitHub repository list exceeded ${MAX_REPO_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await githubGet(url, token, opts);
    if (!res.ok) {
      throw new GithubUnavailableError(
        `GitHub responded with ${res.status} while listing repositories. Please try again.`,
      );
    }

    let page: Array<{ id?: unknown; full_name?: unknown }>;
    try {
      page = (await res.json()) as Array<{ id?: unknown; full_name?: unknown }>;
    } catch {
      throw new GithubUnavailableError(
        "GitHub returned an unreadable repository list. Please try again.",
      );
    }

    for (const repo of page) {
      if (typeof repo.id === "number" && typeof repo.full_name === "string") {
        repos.push({ githubRepoId: repo.id, fullName: repo.full_name });
      }
    }

    // Pin each next-link to the base origin: never chase a cross-host
    // `Link: rel="next"` while carrying the token (F4).
    const next = nextLink(res.headers.get("link"));
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new GithubUnavailableError(
        "GitHub returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return repos;
}

/** Hard cap on collaborator pages followed — mirrors `MAX_REPO_PAGES` (100/page ⇒ ≤2000 people). */
const MAX_COLLABORATOR_PAGES = 20;

/**
 * List a repo's collaborators, following `Link: rel="next"` pagination with the
 * same cap + cross-origin guard as `listRepos` (lesson 4: never chase a
 * cross-host next-link while carrying the token).
 *
 * Requires a classic PAT with `read:org` AND `repo` (a scope escalation over
 * S-02's read-only PAT). A missing scope surfaces as 403 → `GithubUnavailableError`;
 * the roster importer catches that and degrades to Jira-seeded + manual entry
 * rather than aborting the step (PRD graceful-degradation guardrail).
 * - 401 → `GithubAuthError`.
 * - anything else (403/scope, 5xx, network) → `GithubUnavailableError`.
 */
export async function listCollaborators(
  token: string,
  repoFullName: string,
  opts?: GithubClientOpts,
): Promise<GithubCollaborator[]> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams({
    affiliation: "all",
    per_page: "100",
  });

  let url: string | null = `${baseUrl}/repos/${repoFullName}/collaborators?${params.toString()}`;
  const collaborators: GithubCollaborator[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  let pageCount = 0;

  while (url) {
    if (++pageCount > MAX_COLLABORATOR_PAGES) {
      throw new GithubUnavailableError(
        `GitHub collaborator list exceeded ${MAX_COLLABORATOR_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await githubGet(url, token, opts);
    if (res.status === 401) {
      throw new GithubAuthError();
    }
    if (!res.ok) {
      throw new GithubUnavailableError(
        `GitHub responded with ${res.status} while listing collaborators. Please try again.`,
      );
    }

    let page: Array<{
      login?: unknown;
      id?: unknown;
      type?: unknown;
      role_name?: unknown;
    }>;
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new GithubUnavailableError(
        "GitHub returned an unreadable collaborator list. Please try again.",
      );
    }

    for (const person of page) {
      if (typeof person.login === "string" && typeof person.id === "number") {
        collaborators.push({
          login: person.login,
          id: person.id,
          type: typeof person.type === "string" ? person.type : "User",
          roleName:
            typeof person.role_name === "string" ? person.role_name : undefined,
        });
      }
    }

    const next = nextLink(res.headers.get("link"));
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new GithubUnavailableError(
        "GitHub returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return collaborators;
}

// ============================================================================
// S-05 sync fetch methods — commits, pull requests, PR detail, reviews.
//
// Each mirrors the fixed client pattern: `githubGet` transport (token never in a
// thrown error), the `MAX_*_PAGES` cap + cross-origin `Link` guard (lesson #4),
// and the injectable `baseUrl`/`fetchImpl` seam. These run on the cron/on-demand
// sync path, AFTER `validatePat` already accepted the token, so a 401 here means
// the token was revoked/expired mid-life → `GithubAuthError` (the sync records it
// as an integration ERROR); every other non-OK status → `GithubUnavailableError`.
// ============================================================================

/** Parse an ISO-8601 timestamp to a Date, or null when absent/unparseable. */
function parseGithubDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A commit as consumed by the sync store. `branch` is intentionally absent —
 * the commits *list* endpoint carries no per-commit branch label.
 *
 * `additions`/`deletions` are **forward-only** (S-10): the list endpoint omits
 * per-commit `stats`, so they come from a per-commit GET ({@link getCommitDetail})
 * that the sync applies only to the newest N *new* commits per repo. Commits
 * beyond that cap are still persisted, with NULL churn, and the GitHub cursor
 * never revisits them — so NULL means "not measured", never "zero lines". Every
 * consumer must render it as such. */
export type GithubCommitData = {
  sha: string;
  authorGithubUsername: string | null;
  authoredAt: Date | null;
  message: string | null;
  additions: number | null;
  deletions: number | null;
};

/** Per-commit line stats from the single-commit endpoint. */
export type GithubCommitDetail = {
  additions: number | null;
  deletions: number | null;
};

/** A pull request from the *list* endpoint. `additions`/`deletions`/`changedFiles`
 * are absent here (list "Pull Request Simple" omits them) — the store fills them
 * from {@link getPullRequestDetail}. `branch`/`title`/`body` carry the text the
 * PR↔ticket link parser (S-06 correlation) scans; they are not all persisted. */
export type GithubPullRequestData = {
  githubPrId: number;
  number: number;
  title: string | null;
  body: string | null;
  authorGithubUsername: string | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  branch: string | null;
  isDraft: boolean;
  openedAt: Date | null;
  mergedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date | null;
  sourceUrl: string | null;
};

/** Per-PR size, from the PR *detail* endpoint (the list omits these). */
export type GithubPullRequestDetail = {
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
};

/** A submitted review whose verdict maps onto the `review_state` enum. PENDING
 * (never submitted) and DISMISSED (no column to hold it) are skipped by the
 * caller — see {@link listReviews}. */
export type GithubReviewData = {
  githubReviewId: number;
  reviewerGithubUsername: string | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  submittedAt: Date | null;
};

/** Hard caps on server-directed pagination — same rationale as `MAX_REPO_PAGES`
 * (defend against an unbounded `Link` chain while carrying the token, lesson #4). */
const MAX_COMMIT_PAGES = 20;
const MAX_PR_PAGES = 20;
const MAX_REVIEW_PAGES = 10;

/** login off a GitHub user sub-object (`author`/`user`), or null when detached. */
function loginOf(user: unknown): string | null {
  if (user && typeof user === "object" && "login" in user) {
    const login = (user as { login?: unknown }).login;
    if (typeof login === "string" && login.length > 0) return login;
  }
  return null;
}

/**
 * List commits on `repoFullName` authored at/after `since`, following
 * `Link: rel="next"` with the cap + cross-origin guard. `since` is passed to
 * GitHub as the ISO `since` query param so the server bounds the scan; the cursor
 * lets a backlog drain across sync cycles.
 */
export async function listCommits(
  token: string,
  repoFullName: string,
  since: Date,
  opts?: GithubClientOpts,
): Promise<GithubCommitData[]> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams({
    per_page: "100",
    since: since.toISOString(),
  });

  let url: string | null = `${baseUrl}/repos/${repoFullName}/commits?${params.toString()}`;
  const commits: GithubCommitData[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  let pageCount = 0;

  while (url) {
    if (++pageCount > MAX_COMMIT_PAGES) {
      throw new GithubUnavailableError(
        `GitHub commit list exceeded ${MAX_COMMIT_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await githubGet(url, token, opts);
    if (res.status === 401) {
      throw new GithubAuthError();
    }
    if (!res.ok) {
      throw new GithubUnavailableError(
        `GitHub responded with ${res.status} while listing commits. Please try again.`,
      );
    }

    let page: Array<{
      sha?: unknown;
      commit?: { author?: { date?: unknown }; message?: unknown };
      author?: unknown;
    }>;
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new GithubUnavailableError(
        "GitHub returned an unreadable commit list. Please try again.",
      );
    }

    for (const row of page) {
      if (typeof row.sha !== "string") continue;
      commits.push({
        sha: row.sha,
        authorGithubUsername: loginOf(row.author),
        authoredAt: parseGithubDate(row.commit?.author?.date),
        message: typeof row.commit?.message === "string" ? row.commit.message : null,
        // The list endpoint carries no `stats`; the sync enriches the newest N
        // new commits per repo via getCommitDetail and leaves the rest NULL.
        additions: null,
        deletions: null,
      });
    }

    const next = nextLink(res.headers.get("link"));
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new GithubUnavailableError(
        "GitHub returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return commits;
}

/** Map GitHub's `state` (open|closed) + `merged_at` onto the `pr_state` enum. */
function mapPrState(state: unknown, mergedAt: Date | null): "OPEN" | "CLOSED" | "MERGED" {
  if (mergedAt !== null) return "MERGED";
  if (state === "closed") return "CLOSED";
  return "OPEN";
}

/**
 * List pull requests updated at/after `since`, newest-updated first. GitHub has
 * no `since` param on `/pulls`, so we sort `updated` desc and stop as soon as a
 * page crosses the cutoff (and drop the sub-cutoff tail of the crossing page).
 * The list endpoint omits size fields — the caller fetches {@link getPullRequestDetail}
 * per PR within the per-cycle cap.
 */
export async function listPullRequests(
  token: string,
  repoFullName: string,
  since: Date,
  opts?: GithubClientOpts,
): Promise<GithubPullRequestData[]> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams({
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: "100",
  });

  let url: string | null = `${baseUrl}/repos/${repoFullName}/pulls?${params.toString()}`;
  const pulls: GithubPullRequestData[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  let pageCount = 0;
  const sinceMs = since.getTime();

  while (url) {
    if (++pageCount > MAX_PR_PAGES) {
      throw new GithubUnavailableError(
        `GitHub pull-request list exceeded ${MAX_PR_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await githubGet(url, token, opts);
    if (res.status === 401) {
      throw new GithubAuthError();
    }
    if (!res.ok) {
      throw new GithubUnavailableError(
        `GitHub responded with ${res.status} while listing pull requests. Please try again.`,
      );
    }

    let page: Array<Record<string, unknown>>;
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new GithubUnavailableError(
        "GitHub returned an unreadable pull-request list. Please try again.",
      );
    }

    let crossedCutoff = false;
    for (const row of page) {
      const updatedAt = parseGithubDate(row.updated_at);
      // Sorted updated-desc: the first PR older than the cutoff ends the scan.
      if (updatedAt !== null && updatedAt.getTime() < sinceMs) {
        crossedCutoff = true;
        break;
      }
      if (typeof row.id !== "number" || typeof row.number !== "number") continue;
      const mergedAt = parseGithubDate(row.merged_at);
      const head = row.head as { ref?: unknown } | undefined;
      pulls.push({
        githubPrId: row.id,
        number: row.number,
        title: typeof row.title === "string" ? row.title : null,
        body: typeof row.body === "string" ? row.body : null,
        authorGithubUsername: loginOf(row.user),
        state: mapPrState(row.state, mergedAt),
        branch: typeof head?.ref === "string" ? head.ref : null,
        isDraft: row.draft === true,
        openedAt: parseGithubDate(row.created_at),
        mergedAt,
        closedAt: parseGithubDate(row.closed_at),
        updatedAt,
        sourceUrl: typeof row.html_url === "string" ? row.html_url : null,
      });
    }
    if (crossedCutoff) break;

    const next = nextLink(res.headers.get("link"));
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new GithubUnavailableError(
        "GitHub returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return pulls;
}

/**
 * Fetch one PR's size fields (`additions`/`deletions`/`changed_files`) — omitted
 * by the list endpoint, so this is a per-PR GET (the dominant subrequest
 * multiplier that drives the per-cycle PR cap).
 */
export async function getPullRequestDetail(
  token: string,
  repoFullName: string,
  prNumber: number,
  opts?: GithubClientOpts,
): Promise<GithubPullRequestDetail> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const res = await githubGet(
    `${baseUrl}/repos/${repoFullName}/pulls/${prNumber}`,
    token,
    opts,
  );
  if (res.status === 401) {
    throw new GithubAuthError();
  }
  if (!res.ok) {
    throw new GithubUnavailableError(
      `GitHub responded with ${res.status} while fetching PR #${prNumber}. Please try again.`,
    );
  }

  let body: { additions?: unknown; deletions?: unknown; changed_files?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new GithubUnavailableError(
      "GitHub returned an unreadable pull-request detail. Please try again.",
    );
  }

  return {
    additions: typeof body.additions === "number" ? body.additions : null,
    deletions: typeof body.deletions === "number" ? body.deletions : null,
    changedFiles: typeof body.changed_files === "number" ? body.changed_files : null,
  };
}

/**
 * Fetch one commit's line stats (`stats.additions`/`stats.deletions`) — omitted
 * by the commits list endpoint, so this is a per-commit GET. Single-resource, so
 * no pagination cap / origin guard applies (lesson #4 is about `Link` following).
 * The caller applies the per-repo cap that bounds how many of these run.
 */
export async function getCommitDetail(
  token: string,
  repoFullName: string,
  sha: string,
  opts?: GithubClientOpts,
): Promise<GithubCommitDetail> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const res = await githubGet(`${baseUrl}/repos/${repoFullName}/commits/${sha}`, token, opts);
  if (res.status === 401) {
    throw new GithubAuthError();
  }
  if (!res.ok) {
    throw new GithubUnavailableError(
      `GitHub responded with ${res.status} while fetching commit detail. Please try again.`,
    );
  }

  let body: { stats?: { additions?: unknown; deletions?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new GithubUnavailableError(
      "GitHub returned an unreadable commit detail. Please try again.",
    );
  }

  return {
    additions: typeof body.stats?.additions === "number" ? body.stats.additions : null,
    deletions: typeof body.stats?.deletions === "number" ? body.stats.deletions : null,
  };
}

/**
 * List a PR's submitted reviews, following `Link: rel="next"` with the cap +
 * cross-origin guard. Only verdicts on the `review_state` enum
 * (APPROVED/CHANGES_REQUESTED/COMMENTED) are returned — PENDING reviews are never
 * submitted and DISMISSED has no column, so both are skipped.
 */
export async function listReviews(
  token: string,
  repoFullName: string,
  prNumber: number,
  opts?: GithubClientOpts,
): Promise<GithubReviewData[]> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams({ per_page: "100" });

  let url: string | null = `${baseUrl}/repos/${repoFullName}/pulls/${prNumber}/reviews?${params.toString()}`;
  const reviews: GithubReviewData[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  let pageCount = 0;

  while (url) {
    if (++pageCount > MAX_REVIEW_PAGES) {
      throw new GithubUnavailableError(
        `GitHub review list exceeded ${MAX_REVIEW_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await githubGet(url, token, opts);
    if (res.status === 401) {
      throw new GithubAuthError();
    }
    if (!res.ok) {
      throw new GithubUnavailableError(
        `GitHub responded with ${res.status} while listing reviews. Please try again.`,
      );
    }

    let page: Array<{ id?: unknown; user?: unknown; state?: unknown; submitted_at?: unknown }>;
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new GithubUnavailableError(
        "GitHub returned an unreadable review list. Please try again.",
      );
    }

    for (const row of page) {
      if (typeof row.id !== "number") continue;
      if (
        row.state !== "APPROVED" &&
        row.state !== "CHANGES_REQUESTED" &&
        row.state !== "COMMENTED"
      ) {
        continue;
      }
      reviews.push({
        githubReviewId: row.id,
        reviewerGithubUsername: loginOf(row.user),
        state: row.state,
        submittedAt: parseGithubDate(row.submitted_at),
      });
    }

    const next = nextLink(res.headers.get("link"));
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new GithubUnavailableError(
        "GitHub returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return reviews;
}
