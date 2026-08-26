import { and, between, eq } from "drizzle-orm";

import { jiraStatusHistory, jiraTicket } from "@/db/schema";
import type { getDb } from "@/lib/db";
import type { CategoryKey } from "@/lib/dashboard/time-in-status";

/**
 * "Tickets moved to Done" — the one activity number the PRD's summary asks for
 * that nothing in the codebase folded (S-11).
 *
 * `ActivityCell` (`activity-grid.ts:14-28`) carries commits, churn, PRs and
 * reviews; the DONE transitions live in `jira_status_history`, the same table
 * `burndown.ts:82-98` already reads.
 *
 * TEAM GRANULARITY ONLY, deliberately. The PRD Guardrail forbids per-developer
 * performance framing, and this number ships in an EMAIL, where a "who closed how
 * many" table would read as exactly the leaderboard the product promises not to
 * build. There is no per-member variant of this function on purpose.
 *
 * Split the way every other dashboard module is (`aging.ts`, `capacity.ts`): a
 * pure reducer a unit test can reach, plus an owner-scoped reader beside it.
 */

type Db = ReturnType<typeof getDb>;

/** One `jira_status_history` row, narrowed to what the fold needs. */
export type DoneTransition = {
  ticketId: string;
  /** Null means the owner never mapped that Jira status under FR-005. */
  toCategory: CategoryKey | null;
  changedAt: Date | null;
};

/**
 * How many DISTINCT tickets entered `DONE` within `[from, to]`.
 *
 * Distinct, not a transition count: a ticket bounced out of Done and back in on
 * the same day is one ticket finished, not two. Counting rows would overstate the
 * day's output in exactly the churny situations the lead is trying to see clearly.
 *
 * Rows with a null `changedAt` are dropped — an undated transition cannot be
 * attributed to a day, and treating it as in-range would silently inflate today.
 */
export function countTicketsMovedToDone(
  transitions: DoneTransition[],
  { from, to }: { from: Date; to: Date },
): number {
  const seen = new Set<string>();
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const t of transitions) {
    if (t.toCategory !== "DONE") continue;
    if (!t.changedAt) continue;
    const at = t.changedAt.getTime();
    // Inclusive on both ends: `dayRangeInTimeZone` returns `to` as the last
    // millisecond of the local day, so an exclusive upper bound would drop a
    // transition landing exactly on midnight-minus-one.
    if (at < fromMs || at > toMs) continue;
    seen.add(t.ticketId);
  }

  return seen.size;
}

/**
 * Owner-scoped reader for the above.
 *
 * Scoped on BOTH tables — `jira_status_history.owner_id` directly and through the
 * joined ticket — the same belt-and-braces `burndown.ts` uses. There is no RLS
 * behind this.
 *
 * Bounded on `changed_at` so the scan stays proportional to the window rather
 * than to account age; shaped to the existing `(ticket_id, changed_at)` index.
 */
export async function getTicketsMovedToDone(
  db: Db,
  ownerId: string,
  { from, to }: { from: Date; to: Date },
): Promise<number> {
  const rows = await db
    .select({
      ticketId: jiraStatusHistory.ticketId,
      toCategory: jiraStatusHistory.toCategory,
      changedAt: jiraStatusHistory.changedAt,
    })
    .from(jiraStatusHistory)
    .innerJoin(jiraTicket, eq(jiraStatusHistory.ticketId, jiraTicket.id))
    .where(
      and(
        eq(jiraStatusHistory.ownerId, ownerId),
        eq(jiraTicket.ownerId, ownerId),
        eq(jiraStatusHistory.toCategory, "DONE"),
        between(jiraStatusHistory.changedAt, from, to),
      ),
    );

  return countTicketsMovedToDone(rows, { from, to });
}
