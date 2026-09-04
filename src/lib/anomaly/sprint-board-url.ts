/**
 * Where a SPRINT-LEVEL anomaly points (FR-014). PURE — no I/O, no clock.
 *
 * ## Why this exists
 *
 * FR-014 lists five attributes every anomaly carries, and the fifth is "a
 * deep-link to the source". Six of the eight rules satisfy it by borrowing the
 * ticket's or the pull request's own stored URL. The other two —
 * `SPRINT_AT_RISK` and `SCOPE_CREEP` — are about the sprint as a whole: their
 * context holds a `sprintId`, not an issue key, so there is no single ticket to
 * borrow from. Both shipped with `sourceUrl: null`.
 *
 * That was found on production during the S-07 5.2 manual run (2026-09-04) and
 * is not a cosmetic gap: the deep-link is one fifth of a promise the PRD makes
 * about EVERY anomaly, and the two rules missing it include the only
 * HIGH-severity rule in the engine — the one a lead meets first.
 *
 * ## The URL, verified against a real Jira rather than guessed
 *
 * The board form is not in the Atlassian developer docs this project can reach,
 * so it was checked by hand against a live Jira Cloud site before being written
 * down (owner, 2026-09-04). Three candidates were tried; this one lands on the
 * sprint itself rather than merely on the board:
 *
 *     {workspace}/jira/software/projects/{KEY}/boards/{boardId}?sprint={sprintId}
 *
 * ## Falling back rather than returning null
 *
 * `jira_project.board_id` is nullable — a project with no scrum board is a real
 * account, not a corrupt one. Rather than hand such an owner the same `null`
 * this module exists to remove, it degrades to the project's own issue view,
 * which is always constructible because `project_key` is NOT NULL:
 *
 *     {workspace}/browse/{KEY}
 *
 * Worse than the board, better than nowhere: the lead still lands in the project
 * the anomaly is about.
 */

export type SprintBoardUrlInput = {
  /** Normalised workspace origin, e.g. `https://acme.atlassian.net`. Stored on
   *  `jira_credential.workspace_url`. */
  workspaceUrl: string | null | undefined;
  /** `jira_project.project_key`, e.g. `FM`. NOT NULL in the schema, but typed
   *  loosely here so a caller cannot smuggle an empty string past the check. */
  projectKey: string | null | undefined;
  /** `jira_project.board_id` — nullable by design. */
  boardId: string | null | undefined;
  /** `sprint.jira_sprint_id`, the Jira-side id. */
  jiraSprintId: string | null | undefined;
};

/**
 * The best available link for a sprint-level anomaly, or `null` when even the
 * project view cannot be built.
 *
 * `null` survives as an outcome deliberately. An owner whose Jira credential was
 * disconnected still has anomaly rows on screen (that is the graceful-degradation
 * guardrail), and inventing a URL from a missing workspace would send them to a
 * broken link — which is worse than no link, because a dead link looks like a
 * product defect while an absent one looks like what it is.
 */
export function sprintBoardUrl({
  workspaceUrl,
  projectKey,
  boardId,
  jiraSprintId,
}: SprintBoardUrlInput): string | null {
  const base = trimTrailingSlash(workspaceUrl);
  const key = nonEmpty(projectKey);
  if (base === null || key === null) return null;

  const board = nonEmpty(boardId);
  const sprint = nonEmpty(jiraSprintId);

  if (board === null) return `${base}/browse/${encodeURIComponent(key)}`;

  const url = `${base}/jira/software/projects/${encodeURIComponent(key)}/boards/${encodeURIComponent(board)}`;
  // The sprint id only narrows the board view; without it the link is still
  // correct, just less precise. So a missing id degrades the query string
  // rather than the whole URL.
  return sprint === null ? url : `${url}?sprint=${encodeURIComponent(sprint)}`;
}

/** A value that is present and not blank, else null. Blank strings reach here
 *  from environments and hand-edited rows, and `""` must not read as "set". */
function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `https://acme.atlassian.net/` → `https://acme.atlassian.net`, so joining a
 *  path never yields a double slash. */
function trimTrailingSlash(value: string | null | undefined): string | null {
  const v = nonEmpty(value);
  return v === null ? null : v.replace(/\/+$/, "");
}
