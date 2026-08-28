/**
 * FR-023's delivered-SP primitive: the instant a ticket FIRST entered the Done
 * category, and the sum of story points whose first Done fell inside a sprint's
 * window. PURE and DB-free; `now` is a parameter.
 *
 * The rule already existed — twenty lines inside `burndown-series.ts`, which
 * burns a ticket's SP on its first transition into DONE and never un-burns it —
 * and was simply never persisted as velocity. It lives here so the burndown and
 * the sprint's stored `completed_sp` read the SAME primitive and cannot drift.
 *
 * Why "first entry", and why bounded: the scalar this replaces was
 * `sum(sp) filter (current_category = 'DONE')`, a snapshot of what is in Done
 * *right now*, rewritten by every sync cycle — including the ones that run after
 * the sprint closed. A first-DONE instant never moves, so bounding the count to
 * the sprint window makes a post-close cycle idempotent: the sprint's velocity
 * stops being unrecoverable a day later.
 */

import type { StatusCategory } from "@/lib/dashboard/time-in-status";

/** A DONE-relevant transition. `toCategory` null means an unmapped status. */
export type FirstDoneTransition = {
  ticketId: string;
  toCategory: StatusCategory | null;
  changedAt: Date | null;
};

/**
 * Earliest DONE transition per ticket. A ticket re-opened and re-closed keeps
 * its FIRST completion (FR-023: "a ticket that later reopened or carried over
 * still counts"). A null `changedAt` drops (unorderable); a null `toCategory` is
 * not DONE, so a ticket completed through an unmapped status never appears —
 * deliberate under-reporting, surfaced by the burndown's `byCategory.UNKNOWN`.
 */
export function firstDoneAtByTicket(
  transitions: readonly FirstDoneTransition[],
): Map<string, Date> {
  const firstDone = new Map<string, Date>();
  for (const tr of transitions) {
    if (tr.changedAt === null || tr.toCategory !== "DONE") continue;
    const seen = firstDone.get(tr.ticketId);
    if (seen === undefined || tr.changedAt.getTime() < seen.getTime()) {
      firstDone.set(tr.ticketId, tr.changedAt);
    }
  }
  return firstDone;
}

/** One sprint ticket, narrowed to what the sum needs. */
export type DeliveredTicket = {
  ticketId: string;
  storyPoints: number | null;
};

/**
 * Σ story points of tickets whose first entry into Done falls in
 * `[sprintStart, min(sprintEnd, now)]`, both bounds inclusive.
 *
 * A ticket whose first DONE PREDATES this sprint's start does not count here —
 * it was delivered in the sprint that closed it, and a carried-over ticket is
 * re-stamped into the current sprint by the sync (`run-sync.ts`), so without the
 * lower bound every carry-in would be double-counted.
 *
 * Degradations, both deliberate: an unestimated ticket contributes 0, not NaN;
 * and a sprint with no recorded `startDate` counts everything up to the upper
 * bound rather than returning 0 — "delivered nothing" is a stronger and falser
 * claim than "could not exclude carry-ins".
 */
export function computeDeliveredSp({
  tickets,
  firstDoneAt,
  sprintStart,
  sprintEnd,
  now,
}: {
  tickets: readonly DeliveredTicket[];
  firstDoneAt: ReadonlyMap<string, Date>;
  sprintStart: Date | null;
  sprintEnd: Date | null;
  now: Date;
}): number {
  const lower = sprintStart === null ? Number.NEGATIVE_INFINITY : sprintStart.getTime();
  const upper =
    sprintEnd === null ? now.getTime() : Math.min(sprintEnd.getTime(), now.getTime());

  let delivered = 0;
  for (const ticket of tickets) {
    const at = firstDoneAt.get(ticket.ticketId);
    if (at === undefined) continue;
    const ms = at.getTime();
    if (ms < lower || ms > upper) continue;
    delivered += ticket.storyPoints ?? 0;
  }
  return delivered;
}
