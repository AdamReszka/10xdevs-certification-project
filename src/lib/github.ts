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
