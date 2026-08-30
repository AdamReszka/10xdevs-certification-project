import { getCloudflareContext } from "@opennextjs/cloudflare";

import { Badge } from "@/components/ui/badge";
import SprintIdentityBar from "@/components/molecules/sprint-identity-bar";
import ActivityMatrix from "@/components/organisms/dashboard/activity-matrix";
import AgingReport from "@/components/organisms/dashboard/aging-report";
import CapacityAdjustments from "@/components/organisms/dashboard/capacity-adjustments";
import ReliabilityKpi from "@/components/organisms/dashboard/reliability-kpi";
import SprintDetailTabs from "@/components/organisms/dashboard/sprint-detail-tabs";
import SprintSwitcher from "@/components/organisms/dashboard/sprint-switcher";
import SubBurndownChart from "@/components/organisms/dashboard/sub-burndown-chart";
import SyncStatusBar from "@/components/organisms/dashboard/sync-status-bar";
import type { AgingRow } from "@/components/organisms/dashboard/aging-report-controls";
import type { InboxSyncState } from "@/components/organisms/anomaly/types";
import {
  resolveAdjustmentAvailability,
  resolveSprintSelection,
  toSprintOptions,
} from "@/app/(app)/dashboard/sprint-detail/sprint-selection";
import { getDb } from "@/lib/db";
import { getActivityRollup } from "@/lib/dashboard/activity";
import { getTicketAging } from "@/lib/dashboard/aging";
import { getBurndownSeries } from "@/lib/dashboard/burndown";
import { listRoster } from "@/lib/roster";
import {
  listRecordedSprintsForOwner,
  type SprintMeasurement,
} from "@/lib/measurement/reader";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow, getSprintRowByJiraId } from "@/lib/sprint";
import {
  toSprintIdentity,
  type SprintIdentityView,
} from "@/lib/sprint-identity";
import { getSyncState } from "@/lib/sync-state";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * Dashboard "Sprint Detail" (S-10, FR-017) — aging report, Team Activity Matrix,
 * and per-technology sub-burndowns, for ONE sprint.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic`, so neither is re-declared here. All reads run on ONE
 * request-scoped `getDb` handle (never `getDbWithPool` — that owns teardown and
 * is the sync/cron path) and every one is owner-scoped, since cross-account
 * isolation is app-enforced with no RLS behind it.
 *
 * S-23 PHASE 7 UNPINNED IT FROM THE ACTIVE SPRINT. `?sprint=<jira_sprint_id>`
 * renders a closed one; the three-way decision behind that (and the case where a
 * sprint's measurement outlived its raw data) lives in the pure
 * `sprint-selection.ts` sibling, because this repo has no component-test harness.
 */
export default async function SprintDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ sprint?: string | string[] }>;
}) {
  // S-09: owner and clock together — in demo, `now` is the frozen anchor.
  const { ownerId, now } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const requestedRaw = (await searchParams).sprint;
  // A repeated `?sprint=` gives an array. First wins rather than erroring — a
  // malformed URL is a stale link, not an attack, and the id is resolved against
  // the owner's own recorded series either way.
  const requestedJiraSprintId = Array.isArray(requestedRaw)
    ? (requestedRaw[0] ?? null)
    : (requestedRaw ?? null);

  // NULL-SPRINT GUARD (plan review F2). `middleware.ts` gates only on the session
  // cookie — there is no setup gate — so a freshly signed-up owner can reach this
  // route from the nav with no sprint row at all. The three sprint-scoped
  // reducers all take a non-optional sprintId, so resolve the sprint FIRST and
  // never call them with null.
  //
  // ONE WAVE, not three (impl-review phase-7 F3). Only the three sprint-scoped
  // reducers below genuinely have to wait for the resolved `sprint.id`; the sync
  // state and the roster depend on nothing here, and leaving them in a third
  // await cost every render an extra serialized Hyperdrive round trip. The
  // no-sprint branch now pays for a roster it does not use — a rare branch on a
  // fresh account, against a saved round trip on every ordinary render.
  const [
    activeSprint,
    recorded,
    requestedSprint,
    syncStateRaw,
    roster,
    timeZone,
  ] = await Promise.all([
    getActiveSprintRow(db, ownerId),
    // The switcher's list AND the resolver's authority on what `?sprint=` may
    // name — owner-scoped and filtered to the currently monitored Jira project.
    listRecordedSprintsForOwner(db, ownerId),
    requestedJiraSprintId === null
      ? Promise.resolve(null)
      : getSprintRowByJiraId(db, ownerId, requestedJiraSprintId),
    getSyncState(db, ownerId),
    listRoster(db, ownerId),
    // S-25: this page had no zone of its own. The identity line's dates are
    // read in the TEAM's zone, the same one Today and the cadence step use, so
    // a sprint Jira calls 30.08 is not named 29.08 here.
    getJiraTimeZone(db, ownerId),
  ]);

  const selection = resolveSprintSelection({
    requestedJiraSprintId,
    activeSprint,
    requestedSprint,
    measurements: recorded,
  });
  const options = toSprintOptions({ measurements: recorded, activeSprint });

  // Built from the SELECTION, not from `activeSprint` — the switcher can be
  // showing a sprint whose raw row was cascade-deleted, and Phase 2 is what
  // makes its dates come from its own measurement record rather than from
  // whatever sprint happens to be active.
  const identity = toSprintIdentity({
    name: selection.name,
    jiraSprintId: selection.jiraSprintId,
    startDate: selection.startDate,
    endDate: selection.endDate,
    timeZone,
    now,
  });

  if (selection.jiraSprintId === null) {
    return (
      <PageShell
        syncState={toInboxSyncState(syncStateRaw)}
        identity={identity}
        stateLabel={null}
        options={options}
        selectedJiraSprintId={null}
      >
        <EmptyState />
      </PageShell>
    );
  }

  const measurement =
    recorded.find((m) => m.jiraSprintId === selection.jiraSprintId) ?? null;
  const sprintRow =
    selection.kind === "active"
      ? activeSprint
      : selection.sprintRowId === null
        ? null
        : requestedSprint;

  // MATRIX RANGE (F7): the same window M1 gives the sub-burndown x-axis, so the
  // matrix columns and the chart are one calendar rather than two that nearly
  // agree. Falls back to the sprint's own bounds only when startDate is absent.
  const startDate = sprintRow?.startDate ?? null;
  const endDate = sprintRow?.endDate ?? null;
  const rangeFrom =
    startDate ?? new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const rangeTo =
    endDate === null
      ? now
      : new Date(Math.min(endDate.getTime(), now.getTime()));

  // THE AGING CLOCK STOPS WHEN THE SPRINT DOES (impl-review phase-7 F2). The
  // fold accrues its open interval up to whatever instant it is given, so a
  // ticket left In Progress in a sprint that closed six weeks ago would report
  // six weeks of aging — and every per-category total with it. Both other
  // reducers already clamp (`rangeTo` above, and the burndown's own axis), and
  // this one only ever saw the active sprint until Phase 7. An ACTIVE sprint
  // past its end date is deliberately NOT clamped: its tickets really are still
  // aging, and that is the case the report exists to surface.
  const agingNow =
    sprintRow !== null && sprintRow.state !== "ACTIVE" && endDate !== null
      ? new Date(Math.min(endDate.getTime(), now.getTime()))
      : now;

  // Only the branch with a `sprint` row has raw data to reduce. The other one
  // reads its whole story off the measurement record.
  const detail =
    sprintRow === null
      ? null
      : await Promise.all([
          getTicketAging(db, ownerId, sprintRow.id, agingNow),
          getActivityRollup(db, ownerId, { from: rangeFrom, to: rangeTo }),
          getBurndownSeries(db, ownerId, sprintRow.id, now),
        ]);

  // Name map covers ALL members incl. deactivated (S-07 impl-review F1): a
  // ticket assigned to someone who left must still resolve to their name.
  const nameByJiraAccount = new Map(
    roster
      .filter((m) => m.jiraAccountId)
      .map((m) => [m.jiraAccountId!, m.name]),
  );

  const agingRows: AgingRow[] = (detail?.[0] ?? []).map((t) => ({
    ticketId: t.ticketId,
    jiraKey: t.jiraKey,
    summary: t.summary,
    storyPoints: t.storyPoints,
    currentCategory: t.currentCategory,
    assigneeName: t.assigneeJiraAccountId
      ? (nameByJiraAccount.get(t.assigneeJiraAccountId) ?? null)
      : null,
    sourceUrl: t.sourceUrl,
    sinceLastMoveMs: t.sinceLastMoveMs,
    byCategory: t.byCategory,
  }));

  const adjustments = resolveAdjustmentAvailability({
    sprintRowId: selection.sprintRowId,
    isFinalized: measurement?.finalizedAt != null,
  });

  return (
    <PageShell
      syncState={toInboxSyncState(syncStateRaw)}
      identity={identity}
      stateLabel={toStateLabel(
        selection.kind,
        sprintRow?.state ?? measurement?.state ?? null,
      )}
      options={options}
      selectedJiraSprintId={selection.jiraSprintId}
    >
      {/* What this sprint WAS — capacity beside reliability (FR-016/FR-022). On
          a closed sprint these are the only numbers left once raw data ages out,
          which is the whole reason the measurement record exists. */}
      <ReliabilityKpi
        {...toReliabilityProps(measurement, sprintRow)}
        isClosed={
          (sprintRow?.state ?? measurement?.state ?? "CLOSED") !== "ACTIVE"
        }
      />

      {adjustments.kind === "editable" ? (
        <CapacityAdjustments
          // REMOUNT ON A SPRINT CHANGE (impl-review phase-7 F1). The fields hold
          // their text in `useState` seeded from props, and switching sprints is
          // a soft navigation — same component, same tree position — so without
          // a key the initializer never re-runs and the PREVIOUS sprint's number
          // sits in the input under the new sprint's label. Saving then writes it
          // onto the wrong sprint, and a delivered-SP correction goes straight
          // into FR-024's average.
          key={selection.jiraSprintId}
          jiraSprintId={selection.jiraSprintId}
          computedMd={measurement?.capacityAdjustedMd ?? null}
          overrideMd={measurement?.capacityOverrideMd ?? null}
          computedSp={measurement?.deliveredSp ?? null}
          correctedSp={measurement?.deliveredSpCorrected ?? null}
          canCorrectDelivered={adjustments.canCorrectDelivered}
        />
      ) : (
        <NoAdjustmentsNotice />
      )}

      <SprintDetailTabs
        aging={<AgingReport rows={agingRows} />}
        matrix={detail ? <ActivityMatrix grid={detail[1]} /> : null}
        burndown={detail ? <SubBurndownChart series={detail[2]} /> : null}
        notice={detail === null ? <RawDataNotice /> : undefined}
      />
    </PageShell>
  );
}

/**
 * Map the sprint on screen onto the Reliability panel's props.
 *
 * The measurement record is the source; `sprint.completed_sp` stays the fallback
 * for a sprint the sweep has not recorded yet, exactly as on Dashboard "Today"
 * (`reliability-kpi-view.ts`, impl-review F9). Capacity is passed only when the
 * record carries all three figures — a partial capacity line would invite the
 * lead to check arithmetic against a number that is not there.
 */
function toReliabilityProps(
  measurement: SprintMeasurement | null,
  sprintRow: { committedSp: number | null; completedSp: number | null } | null,
): React.ComponentProps<typeof ReliabilityKpi> {
  const capacity =
    measurement?.capacityAdjustedMd != null &&
    measurement.capacityFullMd != null &&
    measurement.workingDays != null
      ? {
          adjustedMd: measurement.capacityAdjustedMd,
          nominalMd: measurement.capacityFullMd,
          sprintWorkingDays: measurement.workingDays,
        }
      : null;

  return {
    committedSp: measurement?.committedSp ?? sprintRow?.committedSp ?? null,
    syncedDeliveredSp: sprintRow?.completedSp ?? null,
    // "There is a sprint on screen" — which is what the prop gates, and what
    // separates "no sprint at all, finish setup" from "not recorded yet".
    hasActiveSprint: true,
    measurement: measurement
      ? {
          deliveredSp: measurement.deliveredSp,
          deliveredSpCorrected: measurement.deliveredSpCorrected,
          capacityOverrideMd: measurement.capacityOverrideMd,
        }
      : null,
    capacity,
  };
}

/**
 * The state badge beside the heading.
 *
 * The sprint the page LANDS on by default carries no badge when it is genuinely
 * active — the absence of a badge is what "this is now" looks like. Anything the
 * lead navigated to deliberately is labelled, and a record whose `state` was
 * never written still says CLOSED: the switcher only offers sprints that are
 * recorded or active, so an unlabelled non-active one would be the only
 * ambiguous entry in the list.
 */
function toStateLabel(
  kind: "active" | "selected" | "measurement-only" | "none",
  state: string | null,
): string | null {
  if (kind === "active") return state === "ACTIVE" ? null : (state ?? "CLOSED");
  return state ?? "CLOSED";
}

/** Shared chrome so the null-sprint path renders the same header and bar. */
function PageShell({
  syncState,
  identity,
  stateLabel,
  options,
  selectedJiraSprintId,
  children,
}: {
  syncState: InboxSyncState;
  /** Which sprint the reader is looking at, with its dates (S-25). */
  identity: SprintIdentityView;
  /** Set only when the sprint is NOT active, so a closed one is unmistakable. */
  stateLabel: string | null;
  options: React.ComponentProps<typeof SprintSwitcher>["options"];
  selectedJiraSprintId: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Dashboard — Sprint Detail
          </h1>
          {/* Every number on this page is scoped to one sprint, so which one it
              is belongs beside the heading — not only in Jira. It replaced a
              muted `<Badge variant="secondary">` in S-25: a name the lead has
              to hunt for is not a fact they can check, and the badge carried no
              dates to check it against. */}
          <SprintIdentityBar view={identity} />
          {stateLabel ? (
            <Badge variant="outline" className="text-muted-foreground">
              Sprint {stateLabel.toLowerCase()}
            </Badge>
          ) : null}
          {/* Gated on the LIST, not on the selection (impl-review phase-7 F5).
              An account whose active sprint row is gone still has recorded
              sprints to reach, and gating on `selectedJiraSprintId` hid the only
              control that could reach them. */}
          {options.length > 0 ? (
            <div className="ms-auto">
              <SprintSwitcher options={options} value={selectedJiraSprintId} />
            </div>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          Where the sprint is aging, where the work landed, and how each
          technology track is burning down.
        </p>
      </div>
      <SyncStatusBar syncState={syncState} />
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">No active sprint</p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        SprintFlow found no active sprint for your Jira project. Point
        SprintFlow at a project with a running sprint (start + end dates) in
        setup, and this dashboard will populate on the next sync.
      </p>
    </div>
  );
}

/**
 * The selected sprint has a measurement record but no raw data left (S-23
 * Phase 7 §3).
 *
 * It NAMES the two ways that happens rather than showing a generic empty state,
 * because both are expected and neither is a fault the lead can fix: the record
 * is retained for the team's whole lifetime while tickets, PRs and commits are
 * bounded to the current + 2 sprints, and a monitored-Jira-project switch
 * cascade-deletes the raw sprint rows outright. Left unexplained, an empty aging
 * report reads as a sprint in which nothing aged.
 */
function RawDataNotice() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">
        This sprint&apos;s detail data is no longer stored
      </p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        SprintFlow keeps each sprint&apos;s measurement — capacity, committed
        and delivered story points — for good, but the tickets, pull requests
        and commits behind it only for the current sprint and the two before it.
        This sprint&apos;s raw data has either aged out of that window or was
        removed when the monitored Jira project was switched. The figures above
        are what was recorded at the time.
      </p>
    </div>
  );
}

/**
 * Why the manual entries are not offered here.
 *
 * `writeLeadColumn` resolves the owner's `sprint` row before writing, so a
 * sprint whose row cascaded away on a project switch cannot be corrected — the
 * save would be refused. Rendering the form anyway would teach the lead that
 * saves fail.
 */
function NoAdjustmentsNotice() {
  return (
    <div className="rounded-md border border-dashed p-4">
      <h3 className="text-sm font-medium">Adjust this sprint by hand</h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Not available for this sprint: SprintFlow no longer holds the sprint it
        would attach the entry to. Its recorded measurement stays as it is.
      </p>
    </div>
  );
}

/**
 * Raw `lastError` is deliberately NOT forwarded (S-07 impl-review F2): the bar
 * renders friendly copy from `status` alone, so a raw API error string can never
 * reach a client payload.
 */
function toInboxSyncState(
  raw: Awaited<ReturnType<typeof getSyncState>>,
): InboxSyncState {
  return {
    GITHUB: {
      integration: "GITHUB",
      lastSuccessfulSyncAt:
        raw.GITHUB.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: raw.GITHUB.status,
    },
    JIRA: {
      integration: "JIRA",
      lastSuccessfulSyncAt:
        raw.JIRA.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: raw.JIRA.status,
    },
  };
}
