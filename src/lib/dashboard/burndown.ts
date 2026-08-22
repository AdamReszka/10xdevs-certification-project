import { and, eq } from "drizzle-orm";

import { jiraProject, jiraStatusHistory, jiraTicket, sprint, teamMember } from "@/db/schema";
import type { getDb } from "@/lib/db";
import {
  buildBurndownSeries,
  type BurndownSeries,
  type BurndownTicket,
  type TrackKey,
} from "@/lib/dashboard/burndown-series";

/**
 * M1 reader — the burndown series (S-10). Serves Sprint Detail's per-technology
 * sub-burndowns and Today's Sprint Pulse from one query set.
 *
 * OWNER SCOPING is explicit per table (no RLS behind this). The transitions leg
 * reaches `jiraStatusHistory` through the owner-scoped ticket set *and* filters
 * it on `ownerId` directly.
 */

type Db = ReturnType<typeof getDb>;

export async function getBurndownSeries(
  db: Db,
  ownerId: string,
  sprintId: string,
  now: Date,
): Promise<BurndownSeries> {
  const [sprintRow] = await db
    .select({
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      committedSp: sprint.committedSp,
    })
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.id, sprintId)))
    .limit(1);

  const [projectRow] = await db
    .select({ timeZone: jiraProject.timeZone })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);

  // The FULL roster, deactivated members included (S-07 impl-review F1): a
  // member who left the team still authored the tickets in this sprint, and
  // their track must still resolve or their SP falls into UNKNOWN wrongly.
  const roster = await db
    .select({
      jiraAccountId: teamMember.jiraAccountId,
      technologyTrack: teamMember.technologyTrack,
    })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId));

  const trackByAccount = new Map<string, TrackKey>();
  for (const m of roster) {
    if (m.jiraAccountId && m.technologyTrack) {
      trackByAccount.set(m.jiraAccountId, m.technologyTrack);
    }
  }

  const ticketRows = await db
    .select({
      id: jiraTicket.id,
      storyPoints: jiraTicket.storyPoints,
      currentCategory: jiraTicket.currentCategory,
      assigneeJiraAccountId: jiraTicket.assigneeJiraAccountId,
    })
    .from(jiraTicket)
    .where(and(eq(jiraTicket.ownerId, ownerId), eq(jiraTicket.sprintId, sprintId)));

  const tickets: BurndownTicket[] = ticketRows.map((t) => ({
    ticketId: t.id,
    storyPoints: t.storyPoints,
    currentCategory: t.currentCategory,
    track: t.assigneeJiraAccountId
      ? trackByAccount.get(t.assigneeJiraAccountId) ?? null
      : null,
  }));

  const transitions = ticketRows.length
    ? await db
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
            eq(jiraTicket.sprintId, sprintId),
          ),
        )
    : [];

  return buildBurndownSeries({
    tickets,
    transitions,
    sprintStart: sprintRow?.startDate ?? null,
    sprintEnd: sprintRow?.endDate ?? null,
    committedSp: sprintRow?.committedSp ?? null,
    timeZone: projectRow?.timeZone ?? null,
    now,
  });
}
