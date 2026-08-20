/**
 * Workers-native Jira Cloud REST v3 client (S-03). Validates a Jira API token +
 * account email and reads projects + workflow statuses using raw `fetch` — the
 * Jira sibling of `src/lib/github.ts`, sharing its typed-error model and
 * injectable transport.
 *
 * Two things diverge from the GitHub client:
 *  1. Auth is HTTP Basic (`base64(email:api_token)`), not Bearer.
 *  2. There is no fixed API host — the base URL is derived from the user's
 *     workspace (`https://{workspace}.atlassian.net`). The base is passed in
 *     explicitly by the caller (the service/action layer), which computes it ONCE
 *     as the effective base (a non-prod `JIRA_API_BASE_URL` override, else the
 *     normalized workspace) and reuses that same value for BOTH the request and
 *     the pagination origin-check (F2 in the plan review). `fetchImpl` stays
 *     injectable so the client is unit- and e2e-mockable (`page.route()` cannot
 *     intercept a server-side fetch).
 *
 * SECURITY: the email:token pair is a bearer secret. It is sent only in the
 * `Authorization` header and NEVER placed in a thrown error, a log line, or a
 * return value.
 */

const API_VERSION_PATH = "/rest/api/3";

/** Injectable transport, so the client is unit- and e2e-mockable. */
export type JiraClientOpts = {
  fetchImpl?: typeof fetch;
};

/** The credential pair used for HTTP Basic auth against Jira Cloud. */
export type JiraCreds = {
  email: string;
  token: string;
};

/**
 * The credentials were rejected by Jira (401). Distinct from
 * `JiraUnavailableError` so the form can say "invalid credentials" only when Jira
 * actually said so — never carries the token.
 */
export class JiraAuthError extends Error {
  constructor(message = "Jira rejected the credentials (invalid or expired).") {
    super(message);
    this.name = "JiraAuthError";
  }
}

/**
 * Jira could not be reached or answered with a non-auth failure (403, 429, 5xx,
 * network/timeout). The credentials may be perfectly valid — the form must show
 * "couldn't reach Jira, try again" rather than mislabeling them as invalid.
 * Never carries the token.
 */
export class JiraUnavailableError extends Error {
  constructor(message = "Could not reach Jira. Please try again.") {
    super(message);
    this.name = "JiraUnavailableError";
  }
}

/** The 5 fixed SprintFlow categories (mirrors the `status_category` pgEnum). */
export type StatusCategory =
  | "TODO"
  | "IN_PROGRESS"
  | "CODE_REVIEW"
  | "TESTING"
  | "DONE";

export type JiraIdentity = {
  accountId: string;
  emailAddress?: string;
  displayName?: string;
};

export type JiraProjectSummary = {
  jiraProjectId: string;
  key: string;
  name: string;
};

export type JiraStatus = {
  jiraStatusId: string;
  jiraStatusName: string;
  /** Jira's native 3-bucket category key; may be absent (F3) — a refinement, not a dependency. */
  nativeCategoryKey?: "new" | "indeterminate" | "done";
};

/**
 * Normalize whatever the user pasted into a canonical
 * `https://{workspace}.atlassian.net` origin. Accepts `foo`, `foo.atlassian.net`,
 * and `https://foo.atlassian.net/jira?x=1` — all collapse to the same origin.
 * Rejects any non-Jira-Cloud host (Jira Cloud only per PRD Non-Goals).
 */
export function normalizeWorkspaceUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Workspace URL is empty.");
  }
  // Strip scheme, then take the host (drop any path/query/port fragment).
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
  let host = withoutScheme.split("/")[0].split("?")[0].split(":")[0].toLowerCase();
  if (host.length === 0) {
    throw new Error("Workspace URL has no host.");
  }
  // A bare subdomain (`foo`) is expanded to the full Atlassian Cloud host.
  if (!host.includes(".")) {
    host = `${host}.atlassian.net`;
  }
  if (!host.endsWith(".atlassian.net")) {
    throw new Error(
      "Only Jira Cloud workspaces are supported (….atlassian.net).",
    );
  }
  const subdomain = host.slice(0, -".atlassian.net".length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(subdomain)) {
    throw new Error("Workspace URL has an invalid Jira Cloud subdomain.");
  }
  return `https://${host}`;
}

/** Headers for every authenticated Jira REST call (HTTP Basic + JSON accept). */
function jiraHeaders(creds: JiraCreds): HeadersInit {
  // nodejs_compat is on (wrangler.jsonc), so Buffer is available at runtime.
  const basic = Buffer.from(`${creds.email}:${creds.token}`, "utf8").toString(
    "base64",
  );
  return {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
  };
}

/**
 * Perform a GET against Jira, mapping transport failures to
 * `JiraUnavailableError`. The caller decides how to treat each HTTP status. A
 * thrown network error is deliberately NOT attached as `cause` — its message
 * could echo the request and we never risk the token surfacing in a log/stack.
 */
async function jiraGet(
  url: string,
  creds: JiraCreds,
  opts: JiraClientOpts | undefined,
): Promise<Response> {
  const doFetch = opts?.fetchImpl ?? fetch;
  try {
    return await doFetch(url, { headers: jiraHeaders(creds) });
  } catch {
    throw new JiraUnavailableError(
      "Could not reach Jira (network error). Please try again.",
    );
  }
}

/**
 * Validate credentials against `GET /rest/api/3/myself`.
 * - 200 → the current user's `accountId` (+ optional email/displayName).
 * - 401 → `JiraAuthError` (the credentials are bad).
 * - anything else (403, 429, 5xx) → `JiraUnavailableError`.
 */
export async function validateCredentials(
  baseUrl: string,
  creds: JiraCreds,
  opts?: JiraClientOpts,
): Promise<JiraIdentity> {
  const res = await jiraGet(`${baseUrl}${API_VERSION_PATH}/myself`, creds, opts);

  if (res.status === 401) {
    throw new JiraAuthError();
  }
  if (!res.ok) {
    throw new JiraUnavailableError(
      `Jira responded with ${res.status}. Please try again.`,
    );
  }

  let body: { accountId?: unknown; emailAddress?: unknown; displayName?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new JiraUnavailableError(
      "Jira returned an unreadable response. Please try again.",
    );
  }
  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    throw new JiraUnavailableError(
      "Jira returned an unexpected response. Please try again.",
    );
  }

  return {
    accountId: body.accountId,
    emailAddress:
      typeof body.emailAddress === "string" ? body.emailAddress : undefined,
    displayName:
      typeof body.displayName === "string" ? body.displayName : undefined,
  };
}

/** Hard cap on project pages followed — defends against an unbounded `nextPage` chain (50/page ⇒ ≤1000 projects). */
const MAX_PROJECT_PAGES = 20;

/**
 * List the projects visible to the credentials, following `PageBeanProject`'s
 * server-directed `nextPage` pagination until `isLast`.
 *
 * SECURITY (F2 / lesson 4): every `nextPage` is a Jira-chosen absolute URL and
 * every refetch carries the Basic-auth secret, so the loop (a) caps iterations
 * and (b) rejects any `nextPage` whose origin differs from `baseUrl`'s origin —
 * the SAME effective base the caller used for the first request. Never send the
 * secret to a host the response chose.
 */
export async function listProjects(
  baseUrl: string,
  creds: JiraCreds,
  opts?: JiraClientOpts,
): Promise<JiraProjectSummary[]> {
  const baseOrigin = new URL(baseUrl).origin;
  const params = new URLSearchParams({ maxResults: "50" });

  let url: string | null = `${baseUrl}${API_VERSION_PATH}/project/search?${params.toString()}`;
  const projects: JiraProjectSummary[] = [];
  let pageCount = 0;

  while (url) {
    if (++pageCount > MAX_PROJECT_PAGES) {
      throw new JiraUnavailableError(
        `Jira project list exceeded ${MAX_PROJECT_PAGES} pages. Please try again.`,
      );
    }
    const res: Response = await jiraGet(url, creds, opts);
    if (!res.ok) {
      throw new JiraUnavailableError(
        `Jira responded with ${res.status} while listing projects. Please try again.`,
      );
    }

    let page: {
      isLast?: unknown;
      nextPage?: unknown;
      values?: Array<{ id?: unknown; key?: unknown; name?: unknown }>;
    };
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new JiraUnavailableError(
        "Jira returned an unreadable project list. Please try again.",
      );
    }

    for (const project of page.values ?? []) {
      if (
        (typeof project.id === "string" || typeof project.id === "number") &&
        typeof project.key === "string" &&
        typeof project.name === "string"
      ) {
        projects.push({
          jiraProjectId: String(project.id),
          key: project.key,
          name: project.name,
        });
      }
    }

    // Follow the server-directed next page only when it stays on the base origin.
    const next =
      page.isLast === false && typeof page.nextPage === "string"
        ? page.nextPage
        : null;
    if (next !== null && new URL(next, baseUrl).origin !== baseOrigin) {
      throw new JiraUnavailableError(
        "Jira returned a cross-origin pagination link. Please try again.",
      );
    }
    url = next;
  }

  return projects;
}

/**
 * List a project's valid statuses via `GET /project/{idOrKey}/statuses`. The
 * response groups statuses by issue type, so the same status repeats across issue
 * types — we flatten and DEDUPE by status id. `statusCategory` may be absent from
 * the payload (F3); when present its `key` seeds the auto-suggestion.
 *
 * Runs only after `validateCredentials` accepted the credentials, so a 401 here
 * is an availability blip, not an auth verdict.
 */
export async function listProjectStatuses(
  baseUrl: string,
  creds: JiraCreds,
  projectIdOrKey: string,
  opts?: JiraClientOpts,
): Promise<JiraStatus[]> {
  const res = await jiraGet(
    `${baseUrl}${API_VERSION_PATH}/project/${encodeURIComponent(projectIdOrKey)}/statuses`,
    creds,
    opts,
  );
  if (!res.ok) {
    throw new JiraUnavailableError(
      `Jira responded with ${res.status} while listing statuses. Please try again.`,
    );
  }

  let issueTypes: Array<{
    statuses?: Array<{
      id?: unknown;
      name?: unknown;
      statusCategory?: { key?: unknown };
    }>;
  }>;
  try {
    issueTypes = (await res.json()) as typeof issueTypes;
  } catch {
    throw new JiraUnavailableError(
      "Jira returned an unreadable status list. Please try again.",
    );
  }

  const byId = new Map<string, JiraStatus>();
  for (const issueType of issueTypes ?? []) {
    for (const status of issueType.statuses ?? []) {
      if (
        (typeof status.id === "string" || typeof status.id === "number") &&
        typeof status.name === "string"
      ) {
        const id = String(status.id);
        if (byId.has(id)) continue;
        const key = status.statusCategory?.key;
        byId.set(id, {
          jiraStatusId: id,
          jiraStatusName: status.name,
          nativeCategoryKey:
            key === "new" || key === "indeterminate" || key === "done"
              ? key
              : undefined,
        });
      }
    }
  }
  return [...byId.values()];
}

/**
 * Best-guess category for a Jira status. Pure — drives the editable auto-suggest
 * seed in the status mapper.
 *
 * Name-first (F3): a name match is decisive and covers the two categories Jira's
 * native `statusCategory` can't express (Code Review, Testing), so the suggestion
 * is meaningful even when `nativeCategoryKey` is absent. The native 3-bucket key
 * is only a fallback when the name is uninformative. Never returns null — the
 * user can always change it in the UI.
 */
export function suggestCategory(status: JiraStatus): StatusCategory {
  const name = status.jiraStatusName.toLowerCase();

  if (/review/.test(name)) return "CODE_REVIEW";
  if (/\bqa\b|test/.test(name)) return "TESTING";
  if (/progress|doing|develop|wip|implement/.test(name)) return "IN_PROGRESS";
  if (/done|closed|resolved|complete|shipped/.test(name)) return "DONE";
  if (/to.?do|backlog|open|new|selected|ready/.test(name)) return "TODO";

  switch (status.nativeCategoryKey) {
    case "indeterminate":
      return "IN_PROGRESS";
    case "done":
      return "DONE";
    case "new":
    default:
      return "TODO";
  }
}
