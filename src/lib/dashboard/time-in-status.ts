/**
 * M3 — cumulative time per workflow category for one ticket (S-10, FR-017).
 * PURE and DB-free: `now` is a parameter, never read here, so the fold is
 * unit-testable without a clock or a database.
 *
 * The aging report needs two numbers per ticket: how long it has sat where it is
 * now (the default sort), and how long it has cumulatively spent in each of the
 * five categories (the inline columns). Both come from folding the ticket's
 * ordered `jira_status_history` transitions.
 */

import type { statusCategory } from "@/db/schema";

export type StatusCategory = (typeof statusCategory.enumValues)[number];

/**
 * The five mapped categories plus `UNKNOWN`.
 *
 * `UNKNOWN` is load-bearing, not defensive padding (plan review F4): every
 * category column in the DB is nullable, and `run-sync.ts` writes
 * `categoryOf.get(...) ?? null` — so any Jira status the owner never mapped
 * under FR-005 lands NULL, as does every history row written before a mapping
 * edit. Accruing that time to a real category would silently misreport it;
 * accruing it to `UNKNOWN` makes the mapping gap visible on the surface.
 */
export type CategoryKey = StatusCategory | "UNKNOWN";

export const CATEGORY_KEYS: readonly CategoryKey[] = [
  "TODO",
  "IN_PROGRESS",
  "CODE_REVIEW",
  "TESTING",
  "DONE",
  "UNKNOWN",
] as const;

/** One `jira_status_history` row, narrowed to what the fold needs. */
export type StatusTransition = {
  toCategory: StatusCategory | null;
  changedAt: Date | null;
};

export type TimeInStatus = {
  /** Milliseconds accrued per category. Every key is present, zero when unused. */
  byCategory: Record<CategoryKey, number>;
  /** Milliseconds since the ticket last moved — the aging report's default sort. */
  sinceLastMoveMs: number;
};

/** A zeroed bucket set with every key present. */
function emptyByCategory(): Record<CategoryKey, number> {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) as Record<
    CategoryKey,
    number
  >;
}

/** Null category → the `UNKNOWN` bucket, never a `null` key. */
function keyOf(category: StatusCategory | null | undefined): CategoryKey {
  return category ?? "UNKNOWN";
}

/**
 * Fold one ticket's transitions into cumulative time per category.
 *
 * Each `(changedAt[i], changedAt[i+1])` interval accrues to `toCategory[i]` — the
 * category the ticket moved *into* at `i` is where it sat until `i+1`. The final
 * open interval runs to `now` and accrues to `currentCategory`; when the ticket
 * has no history at all it runs from `lastStatusChangeAt` instead.
 *
 * Transitions with a null `changedAt` are dropped before the fold: without an
 * instant they cannot be ordered, so they cannot bound an interval (F4).
 * Transitions are sorted defensively — the reader orders by `changedAt`, but the
 * fold must not depend on its caller for correctness.
 */
export function foldTimeInStatus(
  transitions: readonly StatusTransition[],
  {
    currentCategory,
    lastStatusChangeAt,
    now,
  }: {
    currentCategory: StatusCategory | null;
    lastStatusChangeAt: Date | null;
    now: Date;
  },
): TimeInStatus {
  const byCategory = emptyByCategory();
  const nowMs = now.getTime();

  const ordered = transitions
    .filter((t): t is StatusTransition & { changedAt: Date } => t.changedAt !== null)
    .slice()
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());

  if (ordered.length === 0) {
    // No usable history: the whole known age sits in the current category.
    const from = lastStatusChangeAt?.getTime() ?? nowMs;
    const openMs = Math.max(0, nowMs - from);
    byCategory[keyOf(currentCategory)] += openMs;
    return { byCategory, sinceLastMoveMs: openMs };
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const span = ordered[i + 1].changedAt.getTime() - ordered[i].changedAt.getTime();
    // Clamped: an out-of-order pair that survived sorting (identical instants)
    // must not subtract time from a bucket.
    byCategory[keyOf(ordered[i].toCategory)] += Math.max(0, span);
  }

  const last = ordered[ordered.length - 1];
  const openMs = Math.max(0, nowMs - last.changedAt.getTime());
  // The open interval belongs to where the ticket *is* now. That is
  // `currentCategory` — which can disagree with the last transition's
  // `toCategory` when a status was re-mapped after the transition was recorded.
  byCategory[keyOf(currentCategory)] += openMs;

  return { byCategory, sinceLastMoveMs: openMs };
}
