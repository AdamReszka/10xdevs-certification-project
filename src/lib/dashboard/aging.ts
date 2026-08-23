import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { jiraStatusHistory, jiraTicket } from "@/db/schema";
import type { getDb } from "@/lib/db";
import {
  foldTimeInStatus,
  type CategoryKey,
  type StatusCategory,
  type StatusTransition,
} from "@/lib/dashboard/time-in-status";

/**
 * M3 reader — the Sprint Detail aging report (S-10, FR-017).
 *
 * Follows the established read-side convention: `(db, ownerId, …rest) →
 * Promise<serializable>` with `now` injected rather than read here.
 *
 * OWNER SCOPING: there is no RLS behind this — isolation is app-enforced, so
 * every table is filtered on `ownerId` explicitly and never inherits scope
 * through a join. `jiraStatusHistory` is additionally reached *through* the
 * owner-scoped ticket set because it has no `ownerId` index of its own
 * (`schema.ts` indexes `(ticketId, changedAt)`).
 *
 * SORTING IS THE CLIENT'S JOB. This returns the folded rows; the report's
 * default sort and per-column re-sort live in `aging-report-controls.ts`.
 */

type Db = ReturnType<typeof getDb>;

export type TicketAging = {
  ticketId: string;
  jiraKey: string;
  summary: string | null;
  storyPoints: number | null;
  currentCategory: StatusCategory | null;
  assigneeJiraAccountId: string | null;
  sourceUrl: string | null;
  /** Milliseconds since the ticket last moved. */
  sinceLastMoveMs: number;
  /** Milliseconds accrued per category; every key present. */
  byCategory: Record<CategoryKey, number>;
};

export async function getTicketAging(
  db: Db,
  ownerId: string,
  sprintId: string,
  now: Date,
): Promise<TicketAging[]> {
  const tickets = await db
    .select({
      id: jiraTicket.id,
      jiraKey: jiraTicket.jiraKey,
      summary: jiraTicket.summary,
      storyPoints: jiraTicket.storyPoints,
      currentCategory: jiraTicket.currentCategory,
      assigneeJiraAccountId: jiraTicket.assigneeJiraAccountId,
      lastStatusChangeAt: jiraTicket.lastStatusChangeAt,
      sourceUrl: jiraTicket.sourceUrl,
    })
    .from(jiraTicket)
    .where(
      and(
        eq(jiraTicket.ownerId, ownerId),
        eq(jiraTicket.sprintId, sprintId),
        // DONE tickets have stopped moving, so their "time since last movement"
        // grows without meaning and would dominate the default sort. A NULL
        // category is NOT done — an unmapped status still needs surfacing.
        or(isNull(jiraTicket.currentCategory), ne(jiraTicket.currentCategory, "DONE")),
      ),
    );

  if (tickets.length === 0) return [];

  const transitions = await db
    .select({
      ticketId: jiraStatusHistory.ticketId,
      toCategory: jiraStatusHistory.toCategory,
      changedAt: jiraStatusHistory.changedAt,
    })
    .from(jiraStatusHistory)
    .innerJoin(jiraTicket, eq(jiraStatusHistory.ticketId, jiraTicket.id))
    .where(
      and(
        // Both legs owner-scoped: the join gives the sprint bound, the direct
        // filter gives the isolation guarantee independent of the join.
        eq(jiraStatusHistory.ownerId, ownerId),
        eq(jiraTicket.ownerId, ownerId),
        eq(jiraTicket.sprintId, sprintId),
      ),
    )
    .orderBy(asc(jiraStatusHistory.ticketId), asc(jiraStatusHistory.changedAt));

  const byTicket = new Map<string, StatusTransition[]>();
  for (const t of transitions) {
    const list = byTicket.get(t.ticketId);
    if (list) list.push(t);
    else byTicket.set(t.ticketId, [t]);
  }

  return tickets.map((t) => {
    const folded = foldTimeInStatus(byTicket.get(t.id) ?? [], {
      currentCategory: t.currentCategory,
      lastStatusChangeAt: t.lastStatusChangeAt,
      now,
    });
    return {
      ticketId: t.id,
      jiraKey: t.jiraKey,
      summary: t.summary,
      storyPoints: t.storyPoints,
      currentCategory: t.currentCategory,
      assigneeJiraAccountId: t.assigneeJiraAccountId,
      sourceUrl: t.sourceUrl,
      sinceLastMoveMs: folded.sinceLastMoveMs,
      byCategory: folded.byCategory,
    };
  });
}
