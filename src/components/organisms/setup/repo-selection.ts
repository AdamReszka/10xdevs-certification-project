/**
 * Pure selection logic for `RepoSelector`, extracted so it is unit-testable
 * without component-test infrastructure (same split as `aging-report-controls`).
 *
 * The one rule worth encoding: `updateMonitoredRepos` treats a save as the WHOLE
 * selection, and a repo dropped from it has its commits, PRs and reviews deleted
 * by cascade — unrecoverably, because the next sync's `since` window starts at
 * `sync_state.lastSuccessfulSyncAt`, which the selection path never rewinds. So
 * the picker has to be able to say, before the click, which repos a save would
 * drop.
 */

export type SelectableRepo = { id: string; fullName: string };

/**
 * Repos that are monitored today but are NOT in the pending selection — i.e.
 * exactly what this save would delete, with its synced history.
 *
 * Returns full names (what the user recognises), in the order the picker lists
 * them. A monitored id the current token can no longer see is skipped: it would
 * be dropped by the save, but naming an id the user cannot match to a row is
 * noise, and `updateMonitoredRepos` validates against GitHub's list anyway.
 */
export function reposBeingDropped({
  repos,
  monitoredIds,
  selectedIds,
}: {
  repos: SelectableRepo[];
  monitoredIds: readonly string[];
  selectedIds: ReadonlySet<string>;
}): string[] {
  const monitored = new Set(monitoredIds);
  return repos
    .filter((r) => monitored.has(r.id) && !selectedIds.has(r.id))
    .map((r) => r.fullName);
}
