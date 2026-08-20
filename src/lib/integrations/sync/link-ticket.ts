/**
 * PR↔ticket correlation at ingestion (S-05, D3). A pure helper — the sibling of
 * `suggestCategory` — that extracts the monitored project's Jira key from a PR's
 * branch / title / body so `github_pull_request.linked_ticket_key` is populated
 * when the row is written. S-06 anomaly detection then reads correlated rows
 * without a detection-time join.
 *
 * No I/O, no DB — trivially unit-testable in isolation.
 */

/** The text surfaces on a PR that may reference a Jira ticket. */
export type LinkablePullRequest = {
  branch: string | null;
  title: string | null;
  body: string | null;
};

/** Escape a project key for safe interpolation into a RegExp. Jira keys are
 * `[A-Z][A-Z0-9]+`, but escape defensively so a malformed key can't inject
 * regex metacharacters. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the first `{projectKey}-{number}` reference found across the PR's
 * branch, title, then body — scoped to the monitored project's key so a foreign
 * project's key is ignored — or null when none is present. The match is
 * case-insensitive (branches often lowercase the key) but the returned key is
 * canonicalized to the uppercase project key form Jira uses.
 */
export function linkTicketKey(
  pr: LinkablePullRequest,
  projectKey: string,
): string | null {
  if (!projectKey) return null;
  // \b…\b keeps the key project-scoped: `XSF-1` never matches project `SF`.
  const re = new RegExp(`\\b${escapeRegExp(projectKey)}-(\\d+)\\b`, "i");
  for (const text of [pr.branch, pr.title, pr.body]) {
    if (!text) continue;
    const match = text.match(re);
    if (match) return `${projectKey.toUpperCase()}-${match[1]}`;
  }
  return null;
}
