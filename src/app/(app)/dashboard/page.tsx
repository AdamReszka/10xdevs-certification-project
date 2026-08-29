import { getCloudflareContext } from "@opennextjs/cloudflare";

import AnomalyInbox from "@/components/organisms/anomaly/anomaly-inbox";
import Availability from "@/components/organisms/dashboard/availability";
import DashboardTodayTabs from "@/components/organisms/dashboard/today-tabs";
import ReliabilityKpi from "@/components/organisms/dashboard/reliability-kpi";
import SprintPulse from "@/components/organisms/dashboard/sprint-pulse";
import SyncStatusBar from "@/components/organisms/dashboard/sync-status-bar";
import VelocityEstimatePanel from "@/components/organisms/dashboard/velocity-estimate";
import YesterdayActivity from "@/components/organisms/dashboard/yesterday-activity";
import { toCapacityHeadline } from "@/components/organisms/dashboard/capacity-adjustments-view";
import { getDb } from "@/lib/db";
import { listAnomaliesForSprint } from "@/lib/anomaly/reader";
import { toInboxAnomalies } from "@/lib/anomaly/inbox-view";
import { getActivityRollup } from "@/lib/dashboard/activity";
import { getBurndownSeries } from "@/lib/dashboard/burndown";
import { getSprintCapacity } from "@/lib/dashboard/capacity";
import { dayKeyInTimeZone, dayRangeInTimeZone } from "@/lib/dashboard/day-bucket";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { toVelocityEstimateView } from "@/lib/measurement/estimate";
import { getSprintMeasurement } from "@/lib/measurement/overrides";
import { listSprintMeasurementsForOwner } from "@/lib/measurement/reader";
import { getActiveSprintRow } from "@/lib/sprint";
import { getSyncState } from "@/lib/sync-state";
import { resolveWorkspace } from "@/lib/workspace";
import { listRoster } from "@/lib/roster";
import type {
  InboxAnomaly,
  InboxSyncState,
} from "@/components/organisms/anomaly/types";
import type { BurndownSeries } from "@/lib/dashboard/burndown-series";

/**
 * Dashboard "Today" (S-07, US-01) — the Anomaly Inbox headline. Gated server
 * component under `(app)` (inherits `requireSession()` + `force-dynamic`; do NOT
 * re-declare either). Resolves the active sprint, then reads the inbox anomalies,
 * per-integration sync state, and roster on ONE request-scoped `getDb` handle
 * (never `getDbWithPool` — that owns teardown and is the sync/cron path only), and
 * maps them to fully-serializable props for the client organism. Every read is
 * owner-scoped (app-enforced cross-account isolation; no RLS).
 */
export default async function DashboardPage() {
  // S-09: the owner AND the clock both come from the workspace. In demo `now` is
  // the frozen anchor, so every reader below — the burndown, the "yesterday"
  // bucket, the capacity window — describes the same coherent moment however
  // long after loading the demo is viewed.
  const { ownerId, now } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const sprint = await getActiveSprintRow(db, ownerId);

  // "Yesterday" is a calendar day in the TEAM's zone, not a UTC one — resolving
  // it needs the zone up front, before the rollup's range can be built.
  const timeZone = await getJiraTimeZone(db, ownerId);
  const yesterdayKey = dayKeyInTimeZone(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeZone,
  );
  const yesterdayRange = dayRangeInTimeZone(yesterdayKey, timeZone);

  // ONE Promise.all on the SAME `db` handle — no second pool, no second fan-out
  // (lessons.md #3). The two S-10 reads and S-08's availability read join the
  // original three.
  const [
    rows,
    syncStateRaw,
    roster,
    burndown,
    yesterdayGrid,
    availability,
    measurement,
    history,
  ] = await Promise.all([
    sprint ? listAnomaliesForSprint(db, ownerId, sprint.id) : Promise.resolve([]),
    getSyncState(db, ownerId),
    listRoster(db, ownerId),
    sprint
      ? getBurndownSeries(db, ownerId, sprint.id, now)
      : Promise.resolve(EMPTY_BURNDOWN),
    // The zone is already resolved above — pass it rather than re-reading it.
    getActivityRollup(db, ownerId, yesterdayRange, timeZone),
    // S-08: who is away, plus the capacity number absences reduce.
    getSprintCapacity(db, ownerId),
    // S-23 Phase 5: the lead's own override / correction for this sprint. Joined
    // to the SAME fan-out on the SAME handle (lessons.md #3); `getSprintMeasurement`
    // rather than `getActiveSprintMeasurement` because the active sprint is
    // already resolved above and re-resolving it would be a second query for an
    // answer we hold.
    sprint
      ? getSprintMeasurement(db, ownerId, sprint.jiraSprintId)
      : Promise.resolve(null),
    // S-23 Phase 6: the closed-sprint series FR-024 averages. Joined to the SAME
    // fan-out on the SAME handle — the estimate adds one read, not a second
    // round of them (`lessons.md` #3).
    listSprintMeasurementsForOwner(db, ownerId),
  ]);

  // The lead's override replaces the WHOLE computed capacity (FR-022), so the
  // ratio FR-024 scales by has to be taken over the same figure the Availability
  // tab puts on its headline. Resolving it once, here, is what keeps the two
  // surfaces from disagreeing about the number that feeds the average.
  const currentCapacity = availability
    ? {
        adjustedMd: toCapacityHeadline({
          adjustedMd: availability.capacity.adjustedMd,
          nominalMd: availability.capacity.nominalMd,
          overrideMd: measurement?.capacityOverrideMd ?? null,
        }).md,
        fullMd: availability.capacity.nominalMd,
      }
    : null;

  // The active sprint is excluded even when it carries a finalized record: Jira
  // can leave a sprint ACTIVE past its end date, and averaging a window still in
  // flight would fold a part-delivered figure into the history it is compared
  // against.
  const closedSprints = history.filter((r) => r.jiraSprintId !== sprint?.jiraSprintId);
  // The reducer resolves the estimate AND why there isn't one — the panel used
  // to re-derive that from loose props and could contradict itself on screen
  // (impl-review phase-6 F2).
  const estimateView = toVelocityEstimateView(closedSprints, currentCapacity);

  // Name map covers ALL members (incl. deactivated) so an anomaly referencing a
  // deactivated member still resolves its name; the filter dropdown (below) uses
  // only the active subset.
  const memberNameById = new Map(roster.map((m) => [m.id, m.name]));

  // ONE mapping, shared with the S-11 recap email (`inbox-view.ts`). Inlining it
  // here again is how the two surfaces would drift.
  const anomalies: InboxAnomaly[] = toInboxAnomalies(rows, memberNameById);

  const syncState: InboxSyncState = {
    // Raw `lastError` is intentionally NOT forwarded to the client — see
    // InboxIntegrationState. The banner renders a friendly message from `status`.
    GITHUB: {
      integration: "GITHUB",
      lastSuccessfulSyncAt:
        syncStateRaw.GITHUB.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: syncStateRaw.GITHUB.status,
    },
    JIRA: {
      integration: "JIRA",
      lastSuccessfulSyncAt:
        syncStateRaw.JIRA.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: syncStateRaw.JIRA.status,
    },
  };

  const rosterMembers = roster
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard — Today</h1>
        <p className="text-muted-foreground">
          Your sprint&apos;s anomalies, ranked by severity — the 3–5 things to act
          on today.
        </p>
      </div>
      {/* Outside the tabs on purpose: freshness and the error banner must stay
          visible whichever panel the lead is looking at. */}
      <SyncStatusBar syncState={syncState} />
      <DashboardTodayTabs
        inbox={
          <AnomalyInbox
            anomalies={anomalies}
            roster={rosterMembers}
            hasActiveSprint={sprint != null}
          />
        }
        pulse={<SprintPulse series={burndown} />}
        yesterday={<YesterdayActivity grid={yesterdayGrid} dayKey={yesterdayKey} />}
        reliability={
          <div className="flex flex-col gap-6">
            <ReliabilityKpi
              committedSp={sprint?.committedSp ?? null}
              // The FALLBACK, not the source: the delivered figure comes from
              // the measurement record whenever there is one (impl-review F9),
              // so the panel shows the same number FR-024 averages.
              syncedDeliveredSp={sprint?.completedSp ?? null}
              hasActiveSprint={sprint != null}
              measurement={
                measurement
                  ? {
                      deliveredSp: measurement.deliveredSp,
                      deliveredSpCorrected: measurement.deliveredSpCorrected,
                      capacityOverrideMd: measurement.capacityOverrideMd,
                    }
                  : null
              }
              capacity={availability?.capacity ?? null}
            />
            <VelocityEstimatePanel
              view={estimateView}
              sprintName={sprint?.name ?? null}
            />
          </div>
        }
        availability={
          <Availability
            members={roster.map((m) => ({
              id: m.id,
              name: m.name,
              isActive: m.isActive,
            }))}
            // Dates cross the client boundary as ISO strings, per the convention
            // at `organisms/anomaly/types.ts`. (React's Flight serializer would
            // carry a `Date` — the convention is a house rule, not a limitation.)
            absences={(availability?.absences ?? []).map((a) => ({
              teamMemberId: a.teamMemberId,
              startDate: a.startDate.toISOString(),
              endDate: a.endDate.toISOString(),
            }))}
            sprintStart={availability?.sprintStart.toISOString() ?? null}
            sprintEnd={availability?.sprintEnd.toISOString() ?? null}
            timeZone={timeZone}
            capacity={availability?.capacity ?? null}
            jiraSprintId={sprint?.jiraSprintId ?? null}
            // A null record is ordinary, not an error: the sweep has simply not
            // run since this sprint appeared. The override form creates one.
            adjustments={
              measurement
                ? {
                    capacityOverrideMd: measurement.capacityOverrideMd,
                    deliveredSp: measurement.deliveredSp,
                    deliveredSpCorrected: measurement.deliveredSpCorrected,
                    isFinalized: measurement.finalizedAt !== null,
                  }
                : null
            }
          />
        }
      />
    </div>
  );
}

/** The no-sprint shape, so Sprint Pulse renders its own empty state uniformly. */
const EMPTY_BURNDOWN: BurndownSeries = {
  days: [],
  committedSp: null,
  total: [],
  byTrack: { FRONTEND: [], BACKEND: [], MOBILE: [], QA: [], UNKNOWN: [] },
  byCategory: {
    TODO: 0,
    IN_PROGRESS: 0,
    CODE_REVIEW: 0,
    TESTING: 0,
    DONE: 0,
    UNKNOWN: 0,
  },
};
