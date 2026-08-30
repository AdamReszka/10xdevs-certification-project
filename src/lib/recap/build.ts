import type { SelectSprint } from "@/db/schema";
import { toInboxAnomalies } from "@/lib/anomaly/inbox-view";
import { listAnomaliesForSprint } from "@/lib/anomaly/reader";
import { getActivityRollup } from "@/lib/dashboard/activity";
import { getTicketsMovedToDone } from "@/lib/dashboard/activity-done";
import { getBurndownSeries } from "@/lib/dashboard/burndown";
import {
  dayKeyInTimeZone,
  dayRangeInTimeZone,
  enumerateDayKeys,
} from "@/lib/dashboard/day-bucket";
import type { getDb } from "@/lib/db";
import { RECAP_SCHEMA_VERSION } from "@/lib/recap/schema-version";
import { listRoster } from "@/lib/roster";
import { getSyncState } from "@/lib/sync-state";
import type {
  RecapActivity,
  RecapAnomaly,
  RecapPayload,
  RecapSprint,
} from "@/lib/recap/types";

/**
 * Assemble the Daily Recap payload from the readers that already exist (S-11).
 *
 * Every content input for FR-018 was already headless — `listAnomaliesForSprint`,
 * `getActivityRollup`, `getBurndownSeries`, `getSyncState` all take
 * `(db, ownerId, …)` with no request context, precisely so a cron could call
 * them. This module composes them; it adds no new data source beyond
 * `getTicketsMovedToDone`.
 *
 * THE ZONE AND THE SPRINT ARE RESOLVED BY THE CALLER and passed in. Both are
 * needed before the reads can even be shaped (the activity window is a LOCAL
 * calendar day), and re-resolving them inside would repeat work `sendDailyRecap`
 * has already done for its send-time predicate.
 *
 * All reads go into ONE `Promise.all` on ONE handle (lessons.md #3) — the way
 * both dashboard pages do it. Since S-21 that handle is memoized per request
 * context, so what a single fan-out avoids is the second round trip, not a
 * second pool.
 *
 * NOTHING HERE MAY IMPORT `suggested-action.ts`. The action string is copied off
 * the row by `toInboxAnomalies`; regenerating it would need detection-time `now`,
 * which is gone. That is the whole anti-divergence contract.
 */

type Db = ReturnType<typeof getDb>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function buildRecapPayload({
  db,
  ownerId,
  now,
  timeZone,
  sprint,
}: {
  db: Db;
  ownerId: string;
  now: Date;
  timeZone: string | null;
  sprint: SelectSprint;
}): Promise<RecapPayload> {
  const dayKey = dayKeyInTimeZone(now, timeZone);
  // "Yesterday" in the TEAM's zone, matching Today's "Yesterday's Activity"
  // panel exactly — the email and the dashboard must not disagree about which
  // day they are describing.
  const yesterdayKey = dayKeyInTimeZone(
    new Date(now.getTime() - MS_PER_DAY),
    timeZone,
  );
  const yesterdayRange = dayRangeInTimeZone(yesterdayKey, timeZone);

  const [rows, roster, burndown, grid, ticketsMovedToDone, syncStateRaw] =
    await Promise.all([
      listAnomaliesForSprint(db, ownerId, sprint.id),
      listRoster(db, ownerId),
      getBurndownSeries(db, ownerId, sprint.id, now),
      getActivityRollup(db, ownerId, yesterdayRange, timeZone),
      getTicketsMovedToDone(db, ownerId, yesterdayRange),
      getSyncState(db, ownerId),
    ]);

  // ALL members, deactivated included — an anomaly referencing someone who left
  // mid-sprint must still resolve to a name rather than going blank in the email.
  const memberNameById = new Map(roster.map((m) => [m.id, m.name]));

  const anomalies: RecapAnomaly[] = toInboxAnomalies(rows, memberNameById).map(
    (a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      description: a.description,
      // Copied, never recomputed. See the module header.
      suggestedAction: a.suggestedAction,
      sourceUrl: a.sourceUrl,
      identityLabel: a.identityLabel ?? "",
      memberName: a.memberName,
      riskScore: a.riskScore,
    }),
  );

  const days =
    sprint.startDate && sprint.endDate
      ? enumerateDayKeys(sprint.startDate, sprint.endDate, timeZone)
      : [];
  const dayIndex = days.indexOf(dayKey);

  const sprintSummary: RecapSprint = {
    name: sprint.name ?? null,
    // The same two dates the day-axis above is built from, kept so the email can
    // state WHICH sprint it is about and not only how far into it we are (S-25).
    startDate: sprint.startDate?.toISOString() ?? null,
    endDate: sprint.endDate?.toISOString() ?? null,
    // 1-based, and null when today falls outside the sprint's own axis rather
    // than reporting a misleading 0 or a clamped last day.
    dayNumber: dayIndex >= 0 ? dayIndex + 1 : null,
    totalDays: days.length > 0 ? days.length : null,
    committedSp: burndown.committedSp,
    remainingSp: burndown.total.at(-1)?.remainingSp ?? null,
    byCategory: burndown.byCategory,
  };

  const activity: RecapActivity = {
    ...foldTeamActivity(grid),
    ticketsMovedToDone,
  };

  return {
    schemaVersion: RECAP_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    dayKey,
    timeZone,
    sprint: sprintSummary,
    activity,
    syncState: {
      // `lastError` deliberately does NOT cross over, for the same reason
      // `InboxIntegrationState` withholds it from the client
      // (`dashboard/page.tsx:100-102`): it is operator text that can echo a
      // third-party response.
      GITHUB: {
        lastSuccessfulSyncAt:
          syncStateRaw.GITHUB.lastSuccessfulSyncAt?.toISOString() ?? null,
        status: syncStateRaw.GITHUB.status,
      },
      JIRA: {
        lastSuccessfulSyncAt:
          syncStateRaw.JIRA.lastSuccessfulSyncAt?.toISOString() ?? null,
        status: syncStateRaw.JIRA.status,
      },
    },
    anomalies,
  };
}

/**
 * Collapse the Dev × Day grid into ONE team row. PURE, exported for its unit test.
 *
 * The per-developer breakdown is discarded here on purpose and not carried into
 * the payload at all: the PRD Guardrail forbids per-developer performance
 * framing, and a per-person table in an email is the clearest possible violation
 * of it. Keeping the shape team-only means a later renderer cannot accidentally
 * re-introduce one.
 *
 * NULL CHURN STAYS NULL. Null is not zero — an over-cap commit keeps NULL churn
 * permanently (`activity-grid.ts:18-24`) — so the sum is null only when EVERY
 * contributing cell was null, and a real 0 is preserved as 0.
 */
export function foldTeamActivity(grid: {
  days: string[];
  rows: Array<{
    cells: Record<
      string,
      {
        commits: number;
        additions: number | null;
        deletions: number | null;
        prsOpened: number;
        prsMerged: number;
        reviews: number;
      }
    >;
  }>;
}): Omit<RecapActivity, "ticketsMovedToDone"> {
  let commits = 0;
  let prsOpened = 0;
  let prsMerged = 0;
  let reviews = 0;
  let additions: number | null = null;
  let deletions: number | null = null;

  for (const row of grid.rows) {
    for (const day of grid.days) {
      const cell = row.cells[day];
      if (!cell) continue;
      commits += cell.commits;
      prsOpened += cell.prsOpened;
      prsMerged += cell.prsMerged;
      reviews += cell.reviews;
      if (cell.additions !== null)
        additions = (additions ?? 0) + cell.additions;
      if (cell.deletions !== null)
        deletions = (deletions ?? 0) + cell.deletions;
    }
  }

  return { commits, additions, deletions, prsOpened, prsMerged, reviews };
}
