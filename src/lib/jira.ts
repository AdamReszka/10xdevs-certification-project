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

import { flattenAdf } from "@/lib/jira-adf";

const API_VERSION_PATH = "/rest/api/3";
/** Jira Agile (Software) API — same host + Basic auth as v3, different base path (S-04 cadence). */
const AGILE_API_PATH = "/rest/agile/1.0";

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

/**
 * The board named in the request does not exist in Jira (404 from an Agile
 * board endpoint). Deliberately narrower than `JiraUnavailableError`: a stored
 * `jira_project.board_id` that was deleted in Jira must trigger board
 * re-discovery, whereas a 5xx or a rate-limit must NOT. Never carries the token.
 */
export class JiraBoardNotFoundError extends Error {
  constructor(message = "The Jira board no longer exists.") {
    super(message);
    this.name = "JiraBoardNotFoundError";
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
  /**
   * The authenticated owner's IANA time zone (e.g. `Europe/Warsaw`), read from
   * `/myself` (F3). This is the canonical source for cadence weekday derivation —
   * NOT `assignable/search`, whose email join key is unreliable/withheld and would
   * silently drop most owners to the UTC fallback.
   */
  timeZone?: string;
};

/** A Jira Agile board (S-04 cadence). Only `type == "scrum"` boards carry sprints. */
export type JiraBoard = {
  id: number;
  name: string;
  type: string;
};

/**
 * Board types that can carry sprints, per the Agile API's `type` field.
 *
 * `scrum` is what a **company-managed** project reports. A **team-managed**
 * (next-gen) project reports **`simple`** for its board regardless of whether
 * the project runs sprints — and team-managed is the default when you create a
 * project in Jira Cloud today. Filtering on `scrum` alone therefore rejected the
 * board of most new projects, `listBoards` returned `[]`, and `importCadence`
 * took its "no scrum board" branch and persisted no sprint at all. Observed on a
 * real project on 2026-08-22: board `type=simple` holding an `active` sprint
 * with both dates set.
 *
 * `kanban` stays excluded — it genuinely has no sprints.
 *
 * Including `simple` is safe for a team-managed *kanban* board: it has no
 * sprints, so `getActiveSprint` returns null and `importCadence` falls through
 * to its existing `noActiveSprint` path with editable defaults. The sprint query
 * is the real discriminator; the board type only narrows the candidates.
 */
const SPRINT_CAPABLE_BOARD_TYPES = new Set(["scrum", "simple"]);

/**
 * A Jira Agile sprint. `startDate`/`endDate` are ISO strings, reliably populated
 * only for `active`/`closed` sprints — the cadence derivation treats them as raw
 * UTC inputs.
 */
export type JiraSprint = {
  id: number;
  state: string;
  name: string;
  startDate?: string;
  endDate?: string;
};

/** A member of the monitored Jira project (S-04 roster seed). */
export type JiraProjectMember = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
  timeZone?: string;
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

  let body: {
    accountId?: unknown;
    emailAddress?: unknown;
    displayName?: unknown;
    timeZone?: unknown;
  };
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
    timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
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

/** Hard cap on Agile/user pages followed — mirrors the project-list cap. */
const MAX_AGILE_PAGES = 20;

/**
 * List the **scrum** boards attached to a project via the Agile API
 * (`GET {AGILE_API_PATH}/board?projectKeyOrId=…`). Kanban boards carry no
 * sprints and are filtered out here, so callers receive only cadence-capable
 * boards. Offset pagination over `{startAt, maxResults, total, isLast, values}`
 * (no server-directed `nextPage` — the URL is self-constructed from `baseUrl`,
 * so there is no cross-origin link to chase). Capped at `MAX_AGILE_PAGES`.
 *
 * A 401 here is `JiraAuthError`, not an availability blip. `validateCredentials`
 * accepting the creds does not imply Agile access: a PAT that `/myself` accepts
 * can still lack board permission, and that case must reach the owner as
 * "reconnect Jira" rather than "rate-limited, nothing to do".
 */
export async function listBoards(
  baseUrl: string,
  creds: JiraCreds,
  projectKeyOrId: string,
  opts?: JiraClientOpts,
): Promise<JiraBoard[]> {
  const boards: JiraBoard[] = [];
  const maxResults = 50;
  let startAt = 0;
  let pageCount = 0;

  for (;;) {
    if (++pageCount > MAX_AGILE_PAGES) {
      throw new JiraUnavailableError(
        `Jira board list exceeded ${MAX_AGILE_PAGES} pages. Please try again.`,
      );
    }
    const params = new URLSearchParams({
      projectKeyOrId,
      startAt: String(startAt),
      maxResults: String(maxResults),
    });
    const res = await jiraGet(
      `${baseUrl}${AGILE_API_PATH}/board?${params.toString()}`,
      creds,
      opts,
    );
    if (res.status === 401) {
      throw new JiraAuthError();
    }
    if (!res.ok) {
      throw new JiraUnavailableError(
        `Jira responded with ${res.status} while listing boards. Please try again.`,
      );
    }

    let page: {
      isLast?: unknown;
      values?: Array<{ id?: unknown; name?: unknown; type?: unknown }>;
    };
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new JiraUnavailableError(
        "Jira returned an unreadable board list. Please try again.",
      );
    }

    const values = page.values ?? [];
    for (const board of values) {
      if (
        (typeof board.id === "string" || typeof board.id === "number") &&
        typeof board.name === "string" &&
        typeof board.type === "string" &&
        SPRINT_CAPABLE_BOARD_TYPES.has(board.type)
      ) {
        boards.push({ id: Number(board.id), name: board.name, type: board.type });
      }
    }

    // Terminate on the server's `isLast` flag or a short/empty page.
    if (page.isLast === true || values.length < maxResults || values.length === 0) {
      break;
    }
    startAt += values.length;
  }

  return boards;
}

/**
 * Return the board's active sprint, or `null` if none is active
 * (`GET {AGILE_API_PATH}/board/{boardId}/sprint?state=active`). A team onboarding
 * between sprints legitimately has no active sprint → `null`, which the cadence
 * importer treats as the no-active-sprint degradation path. Returns the first
 * active sprint (a scrum board has at most one).
 *
 * Two narrow error branches sit above the generic one: 401 → `JiraAuthError`
 * (a PAT without Agile permission must say "reconnect", not "rate-limited"), and
 * 404 → `JiraBoardNotFoundError`, so a caller passing a stored board id that was
 * deleted in Jira can fall back to re-discovery without treating a 5xx the same
 * way.
 */
export async function getActiveSprint(
  baseUrl: string,
  creds: JiraCreds,
  boardId: number,
  opts?: JiraClientOpts,
): Promise<JiraSprint | null> {
  const params = new URLSearchParams({ state: "active", maxResults: "50" });
  const res = await jiraGet(
    `${baseUrl}${AGILE_API_PATH}/board/${boardId}/sprint?${params.toString()}`,
    creds,
    opts,
  );
  if (res.status === 401) {
    throw new JiraAuthError();
  }
  if (res.status === 404) {
    throw new JiraBoardNotFoundError(`Jira board ${boardId} no longer exists.`);
  }
  if (!res.ok) {
    throw new JiraUnavailableError(
      `Jira responded with ${res.status} while reading the active sprint. Please try again.`,
    );
  }

  let page: {
    values?: Array<{
      id?: unknown;
      state?: unknown;
      name?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    }>;
  };
  try {
    page = (await res.json()) as typeof page;
  } catch {
    throw new JiraUnavailableError(
      "Jira returned an unreadable sprint list. Please try again.",
    );
  }

  for (const sprint of page.values ?? []) {
    if (
      (typeof sprint.id === "string" || typeof sprint.id === "number") &&
      typeof sprint.state === "string" &&
      typeof sprint.name === "string"
    ) {
      return {
        id: Number(sprint.id),
        state: sprint.state,
        name: sprint.name,
        startDate:
          typeof sprint.startDate === "string" ? sprint.startDate : undefined,
        endDate: typeof sprint.endDate === "string" ? sprint.endDate : undefined,
      };
    }
  }
  return null;
}

/**
 * List the project's assignable users (roster seed) via
 * `GET {API_VERSION_PATH}/user/assignable/search?project={KEY}`. The response is
 * a **plain array** (not a `PageBean`): offset-page until an **empty** array — a
 * short page is NOT end-of-list on this endpoint. Capped at `MAX_AGILE_PAGES`.
 * Filters to `accountType == "atlassian"` to drop app/bot accounts. `timeZone`
 * and `emailAddress` are surfaced when present (email is often withheld — never
 * relied on for dedup).
 */
export async function listAssignableUsers(
  baseUrl: string,
  creds: JiraCreds,
  projectKey: string,
  opts?: JiraClientOpts,
): Promise<JiraProjectMember[]> {
  const members: JiraProjectMember[] = [];
  const maxResults = 50;
  let startAt = 0;
  let pageCount = 0;

  for (;;) {
    if (++pageCount > MAX_AGILE_PAGES) {
      throw new JiraUnavailableError(
        `Jira assignable-user list exceeded ${MAX_AGILE_PAGES} pages. Please try again.`,
      );
    }
    const params = new URLSearchParams({
      project: projectKey,
      startAt: String(startAt),
      maxResults: String(maxResults),
    });
    const res = await jiraGet(
      `${baseUrl}${API_VERSION_PATH}/user/assignable/search?${params.toString()}`,
      creds,
      opts,
    );
    if (!res.ok) {
      throw new JiraUnavailableError(
        `Jira responded with ${res.status} while listing project members. Please try again.`,
      );
    }

    let page: Array<{
      accountId?: unknown;
      accountType?: unknown;
      displayName?: unknown;
      emailAddress?: unknown;
      active?: unknown;
      timeZone?: unknown;
    }>;
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new JiraUnavailableError(
        "Jira returned an unreadable member list. Please try again.",
      );
    }

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    for (const user of page) {
      if (
        typeof user.accountId === "string" &&
        user.accountId.length > 0 &&
        user.accountType === "atlassian"
      ) {
        members.push({
          accountId: user.accountId,
          displayName:
            typeof user.displayName === "string" ? user.displayName : user.accountId,
          emailAddress:
            typeof user.emailAddress === "string" ? user.emailAddress : undefined,
          active: user.active === true,
          timeZone:
            typeof user.timeZone === "string" ? user.timeZone : undefined,
        });
      }
    }

    startAt += page.length;
  }

  return members;
}

// ============================================================================
// S-05 sync fetch methods — active-sprint issues + status-change history delta,
// via the NON-deprecated enhanced-search endpoint, plus story-point field
// resolution.
//
// `GET /rest/api/3/search` (PageBean `startAt`) is deprecated and being removed;
// this uses `GET /rest/api/3/search/jql` with **token pagination**
// (`nextPageToken`). Because that token is opaque and the request URL is always
// re-built from `baseUrl` (never a server-chosen absolute URL, unlike
// `listProjects`' `nextPage`), there is no cross-origin link to chase here — the
// page cap alone bounds the loop (lesson #4 origin-check is N/A by construction).
//
// These run on the cron/on-demand sync path, AFTER `validateCredentials` accepted
// the creds, so a 401 here means the token was revoked/expired mid-life →
// `JiraAuthError` (the sync records it as an integration ERROR); every other
// non-OK status → `JiraUnavailableError`.
// ============================================================================

/** A status transition parsed from an issue's changelog. `changelogId` is the
 * NOT NULL dedup half of `jira_status_history`'s unique key (lesson #1) — Jira's
 * own history id, stable across re-syncs. Status id→category mapping and
 * `lastStatusChangeAt` are the store's job (it owns the per-owner statusMapping). */
export type JiraStatusChange = {
  changelogId: string;
  changedAt: Date | null;
  fromStatusId: string | null;
  fromStatusName: string | null;
  toStatusId: string | null;
  toStatusName: string | null;
};

/** An active-sprint issue as consumed by the sync store. Raw status id/name and
 * `createdAt` are returned so the store can map categories (via statusMapping) and
 * derive `addedAfterSprintStart` (created vs sprint start) — kept out of the pure
 * client. */
export type JiraSprintIssue = {
  issueId: string;
  jiraKey: string;
  summary: string | null;
  storyPoints: number | null;
  currentStatusId: string | null;
  currentStatusName: string | null;
  assigneeJiraAccountId: string | null;
  createdAt: Date | null;
  statusHistory: JiraStatusChange[];
};

export type SearchSprintIssuesParams = {
  projectKey: string;
  sprintId: number;
  /** Resolved `customfield_*` id for story points, or null when unresolved. */
  storyPointFieldId: string | null;
  /** Delta cursor: only pull issues updated at/after this instant (FR-012). Null
   * on the first sync pulls the whole active sprint. */
  updatedSince?: Date | null;
};

/** Hard cap on enhanced-search token pages — bounds an unbounded `nextPageToken`
 * chain (100/page ⇒ ≤2000 issues, ample for one active sprint). */
const MAX_SEARCH_PAGES = 20;

/** Parse an ISO-8601 timestamp to a Date, or null when absent/unparseable. */
function parseJiraDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as a JQL datetime literal (`"yyyy-MM-dd HH:mm"`, UTC). Exactness
 * isn't required — an overlapping window only re-fetches idempotent rows. */
function toJqlDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Extract the status-change entries from one issue's expanded changelog. */
function parseStatusHistory(changelog: unknown): JiraStatusChange[] {
  const histories =
    changelog && typeof changelog === "object" && "histories" in changelog
      ? (changelog as { histories?: unknown }).histories
      : undefined;
  if (!Array.isArray(histories)) return [];

  const changes: JiraStatusChange[] = [];
  for (const history of histories) {
    if (!history || typeof history !== "object") continue;
    const h = history as { id?: unknown; created?: unknown; items?: unknown };
    if (typeof h.id !== "string" && typeof h.id !== "number") continue;
    if (!Array.isArray(h.items)) continue;
    for (const item of h.items) {
      if (!item || typeof item !== "object") continue;
      const it = item as {
        field?: unknown;
        from?: unknown;
        fromString?: unknown;
        to?: unknown;
        toString?: unknown;
      };
      if (it.field !== "status") continue;
      changes.push({
        changelogId: String(h.id),
        changedAt: parseJiraDate(h.created),
        fromStatusId: it.from != null ? String(it.from) : null,
        fromStatusName: typeof it.fromString === "string" ? it.fromString : null,
        toStatusId: it.to != null ? String(it.to) : null,
        toStatusName: typeof it.toString === "string" ? it.toString : null,
      });
    }
  }
  return changes;
}

/** Read the story-point value off an issue's `fields` under the resolved custom
 * field id. Jira returns it as a number (or null when unset). */
function extractStoryPoints(
  fields: Record<string, unknown>,
  storyPointFieldId: string | null,
): number | null {
  if (storyPointFieldId === null) return null;
  const raw = fields[storyPointFieldId];
  return typeof raw === "number" ? raw : null;
}

/**
 * Fetch the active sprint's issues (with expanded status-change history) for the
 * monitored project, incrementally via `updatedSince` (the delta cursor) and
 * paginated by `nextPageToken`. Maps each issue to {@link JiraSprintIssue}; leaves
 * category mapping + sprint-start derivation to the store.
 */
export async function searchSprintIssues(
  baseUrl: string,
  creds: JiraCreds,
  params: SearchSprintIssuesParams,
  opts?: JiraClientOpts,
): Promise<JiraSprintIssue[]> {
  const { projectKey, sprintId, storyPointFieldId, updatedSince } = params;

  // JQL: this sprint's issues in the monitored project, optionally only those
  // touched since the last sync. String literals are quoted; project key is
  // constrained to Jira's key charset so it needs no escaping.
  let jql = `project = "${projectKey}" AND sprint = ${sprintId}`;
  if (updatedSince) {
    jql += ` AND updated >= "${toJqlDateTime(updatedSince)}"`;
  }
  jql += " ORDER BY updated ASC";

  const fields = ["summary", "status", "assignee", "created"];
  if (storyPointFieldId !== null) fields.push(storyPointFieldId);

  const issues: JiraSprintIssue[] = [];
  let nextPageToken: string | null = null;
  let pageCount = 0;

  for (;;) {
    if (++pageCount > MAX_SEARCH_PAGES) {
      throw new JiraUnavailableError(
        `Jira issue search exceeded ${MAX_SEARCH_PAGES} pages. Please try again.`,
      );
    }
    const query = new URLSearchParams({
      jql,
      fields: fields.join(","),
      expand: "changelog",
      maxResults: "100",
    });
    if (nextPageToken !== null) query.set("nextPageToken", nextPageToken);

    const res = await jiraGet(
      `${baseUrl}${API_VERSION_PATH}/search/jql?${query.toString()}`,
      creds,
      opts,
    );
    if (res.status === 401) {
      throw new JiraAuthError();
    }
    if (!res.ok) {
      throw new JiraUnavailableError(
        `Jira responded with ${res.status} while searching issues. Please try again.`,
      );
    }

    let page: {
      issues?: Array<{
        id?: unknown;
        key?: unknown;
        fields?: Record<string, unknown>;
        changelog?: unknown;
      }>;
      nextPageToken?: unknown;
    };
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new JiraUnavailableError(
        "Jira returned an unreadable issue search. Please try again.",
      );
    }

    for (const issue of page.issues ?? []) {
      if (
        (typeof issue.id !== "string" && typeof issue.id !== "number") ||
        typeof issue.key !== "string"
      ) {
        continue;
      }
      const f = issue.fields ?? {};
      const status = f.status as { id?: unknown; name?: unknown } | undefined;
      const assignee = f.assignee as { accountId?: unknown } | undefined;
      issues.push({
        issueId: String(issue.id),
        jiraKey: issue.key,
        summary: typeof f.summary === "string" ? f.summary : null,
        storyPoints: extractStoryPoints(f, storyPointFieldId),
        currentStatusId:
          status?.id != null ? String(status.id) : null,
        currentStatusName: typeof status?.name === "string" ? status.name : null,
        assigneeJiraAccountId:
          typeof assignee?.accountId === "string" ? assignee.accountId : null,
        createdAt: parseJiraDate(f.created),
        statusHistory: parseStatusHistory(issue.changelog),
      });
    }

    nextPageToken =
      typeof page.nextPageToken === "string" && page.nextPageToken.length > 0
        ? page.nextPageToken
        : null;
    if (nextPageToken === null) break;
  }

  return issues;
}

/**
 * Resolve the site-specific `customfield_*` id for Story Points via
 * `GET /rest/api/3/field`. The id varies per Jira site, so it is discovered, not
 * hard-coded. Matches a custom field whose Greenhopper schema or name identifies
 * it as story points (covers both classic "Story Points" and next-gen "Story
 * point estimate"). Returns null when none is found — the sync then leaves
 * `storyPoints` NULL rather than failing.
 */
export async function resolveStoryPointFieldId(
  baseUrl: string,
  creds: JiraCreds,
  opts?: JiraClientOpts,
): Promise<string | null> {
  const res = await jiraGet(`${baseUrl}${API_VERSION_PATH}/field`, creds, opts);
  if (res.status === 401) {
    throw new JiraAuthError();
  }
  if (!res.ok) {
    throw new JiraUnavailableError(
      `Jira responded with ${res.status} while listing fields. Please try again.`,
    );
  }

  let fields: Array<{
    id?: unknown;
    name?: unknown;
    custom?: unknown;
    schema?: { custom?: unknown };
  }>;
  try {
    fields = (await res.json()) as typeof fields;
  } catch {
    throw new JiraUnavailableError(
      "Jira returned an unreadable field list. Please try again.",
    );
  }

  for (const field of fields ?? []) {
    if (typeof field.id !== "string" || field.custom !== true) continue;
    const schemaCustom =
      typeof field.schema?.custom === "string"
        ? field.schema.custom.toLowerCase()
        : "";
    const name = typeof field.name === "string" ? field.name.toLowerCase() : "";
    if (schemaCustom.includes("story-point") || /story point/.test(name)) {
      return field.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 * Refinement reader (S-13 phase 2)
 * ------------------------------------------------------------------------- */

/** One hop out of a ticket — a subtask or an issue link — with enough status to
 * answer "is the thing this depends on done?" without a second round trip. The
 * walk is deliberately ONE hop: a two-step blockage stays invisible (plan,
 * "What We're NOT Doing"). */
export type JiraRefinementRelation = {
  key: string;
  summary: string | null;
  status: string | null;
  /** Jira's own coarse `statusCategory.key` (`new` / `indeterminate` / `done`) —
   * raw, because the owner's 5-category mapping is the store's business, not the
   * client's. */
  category: string | null;
  /** `"subtask"`, or the link type's directional name ("is blocked by"). */
  relation: string;
};

/** A ticket as the Refinement analysis reads it: everything a lead would look at
 * during refinement, flattened to text. Deliberately NOT persisted — the plan
 * stores verdicts, never ticket bodies. */
export type JiraRefinementTicket = {
  key: string;
  summary: string | null;
  issueType: string | null;
  /** ADF flattened to text; `""` when Jira sent no description. */
  description: string;
  /** Flattened comment bodies, newest-last, capped at
   * {@link MAX_COMMENTS_PER_TICKET}. */
  comments: string[];
  /** Names and mime types ONLY. The user's test is whether the *name* implies
   * the right file, so no attachment bytes are ever fetched. */
  attachments: { filename: string; mimeType: string | null }[];
  links: JiraRefinementRelation[];
  subtasks: JiraRefinementRelation[];
  dueDate: string | null;
  labels: string[];
  priority: string | null;
  sourceUrl: string | null;
};

/**
 * The caller asked for something this reader will not do: no keys at all, a key
 * that is not a Jira key, or more tickets than one call may carry. Distinct from
 * `JiraAuthError` / `JiraUnavailableError` because Jira was never asked — the
 * fault is in the request, and the surface must say so rather than offering a
 * retry that cannot help. Never carries the token.
 */
export class JiraRefinementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraRefinementInputError";
  }
}

/** Tickets one call may read. Equal to the search page size, so the keys path is
 * always a single request. Exported so the surface can reject an oversized
 * selection before spending a model call on it. */
export const MAX_REFINEMENT_TICKETS_PER_CALL = 50;

/** Jira issue-key shape (`FM-12`). Validated rather than escaped: the key is
 * interpolated into JQL, and the only safe input is one that cannot contain a
 * quote in the first place — the discipline already applied to `projectKey`. */
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Newest comments kept per ticket. Refinement context lives at the end of a
 * thread; the first ten comments of a year-old ticket are noise in the prompt. */
const MAX_COMMENTS_PER_TICKET = 10;

/** Everything the analysis reads off an issue. `searchSprintIssues` asks for
 * four of these; refinement needs the ticket's actual content. */
const REFINEMENT_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "description",
  "comment",
  "attachment",
  "issuelinks",
  "subtasks",
  "duedate",
  "labels",
  "priority",
  "created",
];

export type FetchRefinementTicketsParams =
  | { keys: string[] }
  | { boardId: number };

/** What the reader returns. Not a bare array: `lessons.md` — an empty result
 * from a narrowed query must be distinguishable from "the narrowing value was
 * wrong", so keys Jira did not answer for are named, not silently absent. */
export type RefinementTicketsResult = {
  tickets: JiraRefinementTicket[];
  /** Requested keys Jira returned nothing for (typo, wrong project, no
   * permission). Empty on the board path. */
  missingKeys: string[];
};

function relationOf(
  raw: unknown,
  relation: string,
): JiraRefinementRelation | null {
  if (!raw || typeof raw !== "object") return null;
  const issue = raw as { key?: unknown; fields?: Record<string, unknown> };
  if (typeof issue.key !== "string") return null;
  const fields = issue.fields ?? {};
  const status = fields.status as
    | { name?: unknown; statusCategory?: { key?: unknown } }
    | undefined;
  return {
    key: issue.key,
    summary: typeof fields.summary === "string" ? fields.summary : null,
    status: typeof status?.name === "string" ? status.name : null,
    category:
      typeof status?.statusCategory?.key === "string"
        ? status.statusCategory.key
        : null,
    relation,
  };
}

function parseIssueLinks(raw: unknown): JiraRefinementRelation[] {
  if (!Array.isArray(raw)) return [];
  const links: JiraRefinementRelation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const link = entry as {
      type?: { inward?: unknown; outward?: unknown };
      inwardIssue?: unknown;
      outwardIssue?: unknown;
    };
    if (link.inwardIssue) {
      const name =
        typeof link.type?.inward === "string" ? link.type.inward : "relates to";
      const rel = relationOf(link.inwardIssue, name);
      if (rel) links.push(rel);
    }
    if (link.outwardIssue) {
      const name =
        typeof link.type?.outward === "string" ? link.type.outward : "relates to";
      const rel = relationOf(link.outwardIssue, name);
      if (rel) links.push(rel);
    }
  }
  return links;
}

function parseAttachments(
  raw: unknown,
): { filename: string; mimeType: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { filename: string; mimeType: string | null }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const att = entry as { filename?: unknown; mimeType?: unknown };
    if (typeof att.filename !== "string") continue;
    out.push({
      filename: att.filename,
      mimeType: typeof att.mimeType === "string" ? att.mimeType : null,
    });
  }
  return out;
}

function parseComments(raw: unknown): string[] {
  const comments =
    raw && typeof raw === "object" && "comments" in raw
      ? (raw as { comments?: unknown }).comments
      : undefined;
  if (!Array.isArray(comments)) return [];
  return comments
    .slice(-MAX_COMMENTS_PER_TICKET)
    .map((c) =>
      flattenAdf(
        c && typeof c === "object" ? (c as { body?: unknown }).body : null,
      ),
    )
    .filter((text) => text.length > 0);
}

/** Map one raw Jira issue onto the refinement shape. */
function toRefinementTicket(
  baseUrl: string,
  issue: { key?: unknown; fields?: Record<string, unknown> },
): JiraRefinementTicket | null {
  if (typeof issue.key !== "string") return null;
  const f = issue.fields ?? {};
  const issueType = f.issuetype as { name?: unknown } | undefined;
  const priority = f.priority as { name?: unknown } | undefined;

  return {
    key: issue.key,
    summary: typeof f.summary === "string" ? f.summary : null,
    issueType: typeof issueType?.name === "string" ? issueType.name : null,
    description: flattenAdf(f.description),
    comments: parseComments(f.comment),
    attachments: parseAttachments(f.attachment),
    links: parseIssueLinks(f.issuelinks),
    subtasks: Array.isArray(f.subtasks)
      ? f.subtasks
          .map((s) => relationOf(s, "subtask"))
          .filter((s): s is JiraRefinementRelation => s !== null)
      : [],
    dueDate: typeof f.duedate === "string" ? f.duedate : null,
    labels: Array.isArray(f.labels)
      ? f.labels.filter((l): l is string => typeof l === "string")
      : [],
    priority: typeof priority?.name === "string" ? priority.name : null,
    sourceUrl: `${baseUrl}/browse/${issue.key}`,
  };
}

/** Uppercase, de-duplicate and validate the caller's keys, or refuse. */
function normalizeRequestedKeys(raw: string[]): string[] {
  const keys: string[] = [];
  for (const key of raw) {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!JIRA_KEY_PATTERN.test(trimmed)) {
      throw new JiraRefinementInputError(
        `"${trimmed}" is not a Jira issue key (expected a form like FM-12).`,
      );
    }
    const upper = trimmed.toUpperCase();
    if (!keys.includes(upper)) keys.push(upper);
  }
  if (keys.length === 0) {
    throw new JiraRefinementInputError(
      "No tickets were selected to analyse.",
    );
  }
  if (keys.length > MAX_REFINEMENT_TICKETS_PER_CALL) {
    throw new JiraRefinementInputError(
      `Too many tickets in one request (${keys.length}); the limit is ${MAX_REFINEMENT_TICKETS_PER_CALL}.`,
    );
  }
  return keys;
}

/** Read `fields` off one page of issues into refinement tickets. */
function collectPage(
  baseUrl: string,
  issues: unknown,
  into: JiraRefinementTicket[],
): number {
  const list = Array.isArray(issues) ? issues : [];
  for (const issue of list) {
    if (!issue || typeof issue !== "object") continue;
    const ticket = toRefinementTicket(
      baseUrl,
      issue as { key?: unknown; fields?: Record<string, unknown> },
    );
    if (ticket) into.push(ticket);
  }
  return list.length;
}

/** The keys route: one `/search/jql` call, because the per-call cap equals the
 * page size, so there is never a second page to chase. */
async function fetchTicketsByKey(
  baseUrl: string,
  creds: JiraCreds,
  requested: string[],
  opts: JiraClientOpts | undefined,
): Promise<RefinementTicketsResult> {
  const keys = normalizeRequestedKeys(requested);
  const jql = `key IN (${keys.map((k) => `"${k}"`).join(", ")}) ORDER BY key ASC`;

  const query = new URLSearchParams({
    jql,
    fields: REFINEMENT_FIELDS.join(","),
    maxResults: String(MAX_REFINEMENT_TICKETS_PER_CALL),
  });

  const res = await jiraGet(
    `${baseUrl}${API_VERSION_PATH}/search/jql?${query.toString()}`,
    creds,
    opts,
  );
  if (res.status === 401) {
    throw new JiraAuthError();
  }
  if (!res.ok) {
    throw new JiraUnavailableError(
      `Jira responded with ${res.status} while reading tickets. Please try again.`,
    );
  }

  let page: { issues?: unknown };
  try {
    page = (await res.json()) as typeof page;
  } catch {
    throw new JiraUnavailableError(
      "Jira returned an unreadable ticket response. Please try again.",
    );
  }

  const tickets: JiraRefinementTicket[] = [];
  collectPage(baseUrl, page.issues, tickets);

  // lessons.md: a narrowed query returning less than was asked for must name
  // what is missing. A typo'd key, a key in another project, or one the token
  // cannot see all come back as silence from Jira — and silence that reads as
  // "that ticket is fine" is the failure this reporting exists to prevent.
  const returned = new Set(tickets.map((t) => t.key.toUpperCase()));
  return { tickets, missingKeys: keys.filter((k) => !returned.has(k)) };
}

/**
 * The board route: the Agile **backlog** endpoint, which is a different read
 * from anything the sync cycle does. `searchSprintIssues` narrows on
 * `sprint = <id>` and therefore can only ever see the active sprint; refinement
 * is about what has NOT entered a sprint yet. Offset-paginated like `listBoards`
 * (no server-directed link to chase) and capped at `MAX_AGILE_PAGES`.
 */
async function fetchBacklogTickets(
  baseUrl: string,
  creds: JiraCreds,
  boardId: number,
  opts: JiraClientOpts | undefined,
): Promise<JiraRefinementTicket[]> {
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw new JiraRefinementInputError(
      `"${boardId}" is not a Jira board id.`,
    );
  }

  const tickets: JiraRefinementTicket[] = [];
  const maxResults = 50;
  let startAt = 0;
  let pageCount = 0;

  for (;;) {
    if (++pageCount > MAX_AGILE_PAGES) {
      throw new JiraUnavailableError(
        `Jira backlog exceeded ${MAX_AGILE_PAGES} pages. Please try again.`,
      );
    }
    const query = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: REFINEMENT_FIELDS.join(","),
    });
    const res = await jiraGet(
      `${baseUrl}${AGILE_API_PATH}/board/${boardId}/backlog?${query.toString()}`,
      creds,
      opts,
    );
    if (res.status === 401) {
      throw new JiraAuthError();
    }
    if (res.status === 404) {
      throw new JiraBoardNotFoundError();
    }
    if (!res.ok) {
      throw new JiraUnavailableError(
        `Jira responded with ${res.status} while reading the backlog. Please try again.`,
      );
    }

    let page: { issues?: unknown; total?: unknown };
    try {
      page = (await res.json()) as typeof page;
    } catch {
      throw new JiraUnavailableError(
        "Jira returned an unreadable backlog. Please try again.",
      );
    }

    const seen = collectPage(baseUrl, page.issues, tickets);
    if (seen === 0 || seen < maxResults) break;
    startAt += seen;
    if (typeof page.total === "number" && startAt >= page.total) break;
  }

  return tickets;
}

/**
 * Read the full analysis-relevant content of a set of tickets, either by key or
 * from a board's backlog (S-13 phase 2). FR-020's three input routes minus the
 * pasted one, which never touches Jira.
 *
 * Nothing here is persisted: descriptions, comments and attachment names are
 * read on demand and dropped once the verdict is formed.
 */
export async function fetchRefinementTickets(
  baseUrl: string,
  creds: JiraCreds,
  params: FetchRefinementTicketsParams,
  opts?: JiraClientOpts,
): Promise<RefinementTicketsResult> {
  if ("boardId" in params) {
    return {
      tickets: await fetchBacklogTickets(baseUrl, creds, params.boardId, opts),
      // Nothing was requested by key, so nothing can be missing.
      missingKeys: [],
    };
  }
  return fetchTicketsByKey(baseUrl, creds, params.keys, opts);
}
