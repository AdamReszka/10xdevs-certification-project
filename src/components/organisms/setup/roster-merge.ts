/**
 * Pure merge logic for `RosterEditor`, extracted so it is unit-testable without
 * component-test infrastructure (same split as `repo-selection`).
 *
 * Two defects live here, both invisible until S-15 made the roster save an
 * upsert:
 *
 * 1. **The surviving id.** The old code set `merged.id = a.id` where `a` was the
 *    FIRST-SELECTED row, but chose the surviving *row* by array INDEX. Select the
 *    pair in the other order and the grid kept row B while writing A's id, so the
 *    save updated A's row and left B's untouched in the database — the merge
 *    DUPLICATED the person instead of fusing them. Under the old
 *    delete-then-insert save the whole set was replaced, so it never showed.
 *
 * 2. **The surviving name.** The comment claimed name selection preferred the
 *    Jira `displayName`; the code was `a.name || b.name`, and both imported rows
 *    always carry a name, so the first-selected row always won. Merging a GitHub
 *    row first therefore yielded the bare login instead of the person's name.
 *
 * Both are fixed by deciding EVERYTHING from one place: the kept row is the one
 * the grid keeps, and the name is the one that is actually a name.
 */

/** The subset of a grid row this decision reads. */
export type MergeCandidate = {
  id?: string;
  name: string;
  githubUsername?: string | null;
  jiraAccountId?: string | null;
  role?: string | null;
  /** Availability fraction (FR-006). Required, unlike every profile field here:
   *  the column is NOT NULL, so there is nothing to fall through to and the kept
   *  row simply wins. */
  fte: number;
  technologyTrack?: "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | null;
  isActive?: boolean;
};

export type MergeDecision = {
  /** The row the grid keeps and the server updates. */
  keepId?: string;
  /** The row the grid removes; present only when it has a DB row to delete. */
  dropId?: string;
  /** True when BOTH rows are persisted, i.e. a row genuinely disappears server-side. */
  needsServerMerge: boolean;
  /** The merged field set, ready for the field array and for `mergeMembersAction`. */
  merged: MergeCandidate;
};

/**
 * A name that is just the GitHub login, case-insensitively — what auto-import
 * writes for a GitHub-sourced row when it has nothing better.
 */
export function looksLikeLogin(name: string, githubUsername?: string | null): boolean {
  if (!githubUsername) return false;
  return name.trim().toLowerCase() === githubUsername.trim().toLowerCase();
}

/**
 * Decide the merge of two grid rows.
 *
 * `keep` is the row the grid keeps (the lower array index, so the remaining index
 * stays stable) and `drop` the row it removes. Everything else follows from that:
 * the surviving id is the KEPT row's, never the first-selected one.
 *
 * Name: prefer the row whose name is not merely its login. When both are logins,
 * or neither is, the kept row wins.
 *
 * Identity keys union across both — that is the whole point of the operation.
 * Remaining profile fields prefer the kept row and fall back to the dropped one,
 * so a value entered on either side survives.
 */
export function decideMerge(keep: MergeCandidate, drop: MergeCandidate): MergeDecision {
  const keepIsLogin = looksLikeLogin(keep.name, keep.githubUsername);
  const dropIsLogin = looksLikeLogin(drop.name, drop.githubUsername);

  let name: string;
  if (keepIsLogin && !dropIsLogin && drop.name) name = drop.name;
  else name = keep.name || drop.name;

  const merged: MergeCandidate = {
    // The kept row's id when it has one; otherwise the dropped row's, so a merge
    // of an unsaved row with a persisted one carries the persisted row forward
    // instead of orphaning it.
    id: keep.id ?? drop.id,
    name,
    githubUsername: keep.githubUsername || drop.githubUsername || "",
    jiraAccountId: keep.jiraAccountId || drop.jiraAccountId || "",
    role: keep.role || drop.role || "",
    // No `?? drop.fte ?? null` chain here, unlike the profile fields above: a
    // NOT NULL column has no absent state to fall through, so "prefer whichever
    // side answered" is not a question that can arise. The kept row wins.
    fte: keep.fte,
    technologyTrack: keep.technologyTrack ?? drop.technologyTrack ?? null,
    isActive: keep.isActive ?? drop.isActive,
  };

  // Only when BOTH are persisted does a database row have to be deleted. With one
  // or zero persisted rows the upsert save expresses the whole merge on its own.
  const needsServerMerge = !!keep.id && !!drop.id;

  return {
    keepId: keep.id,
    dropId: needsServerMerge ? drop.id : undefined,
    needsServerMerge,
    merged,
  };
}
