import { getCloudflareContext } from "@opennextjs/cloudflare";

import { Badge } from "@/components/ui/badge";
import ActivityMatrix from "@/components/organisms/dashboard/activity-matrix";
import AgingReport from "@/components/organisms/dashboard/aging-report";
import SprintDetailTabs from "@/components/organisms/dashboard/sprint-detail-tabs";
import SubBurndownChart from "@/components/organisms/dashboard/sub-burndown-chart";
import SyncStatusBar from "@/components/organisms/dashboard/sync-status-bar";
import type { AgingRow } from "@/components/organisms/dashboard/aging-report-controls";
import type { InboxSyncState } from "@/components/organisms/anomaly/types";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getActivityRollup } from "@/lib/dashboard/activity";
import { getTicketAging } from "@/lib/dashboard/aging";
import { getBurndownSeries } from "@/lib/dashboard/burndown";
import { listRoster } from "@/lib/roster";
import { getActiveSprintRow } from "@/lib/sprint";
import { getSyncState } from "@/lib/sync-state";

/**
 * Dashboard "Sprint Detail" (S-10, FR-017) — aging report, Team Activity Matrix,
 * and per-technology sub-burndowns.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic`, so neither is re-declared here. All reads run on ONE
 * request-scoped `getDb` handle (never `getDbWithPool` — that owns teardown and
 * is the sync/cron path) and every one is owner-scoped, since cross-account
 * isolation is app-enforced with no RLS behind it.
 */
export default async function SprintDetailPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;
  const now = new Date();

  // NULL-SPRINT GUARD (plan review F2). `middleware.ts` gates only on the session
  // cookie — there is no setup gate — so a freshly signed-up owner can reach this
  // route from the nav with no sprint row at all. The three sprint-scoped
  // reducers all take a non-optional sprintId, so resolve the sprint FIRST and
  // never call them with null.
  const sprint = await getActiveSprintRow(db, ownerId);

  if (!sprint) {
    const [syncStateRaw] = await Promise.all([getSyncState(db, ownerId)]);
    return (
      <PageShell
        syncState={toInboxSyncState(syncStateRaw)}
        sprintName={null}
        stateLabel={null}
      >
        <EmptyState />
      </PageShell>
    );
  }

  // MATRIX RANGE (F7): the same window M1 gives the sub-burndown x-axis, so the
  // matrix columns and the chart are one calendar rather than two that nearly
  // agree. Falls back to the sprint's own bounds only when startDate is absent.
  const rangeFrom = sprint.startDate ?? new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const rangeTo =
    sprint.endDate === null ? now : new Date(Math.min(sprint.endDate.getTime(), now.getTime()));

  const [aging, activity, burndown, syncStateRaw, roster] = await Promise.all([
    getTicketAging(db, ownerId, sprint.id, now),
    getActivityRollup(db, ownerId, { from: rangeFrom, to: rangeTo }),
    getBurndownSeries(db, ownerId, sprint.id, now),
    getSyncState(db, ownerId),
    listRoster(db, ownerId),
  ]);

  // Name map covers ALL members incl. deactivated (S-07 impl-review F1): a
  // ticket assigned to someone who left must still resolve to their name.
  const nameByJiraAccount = new Map(
    roster.filter((m) => m.jiraAccountId).map((m) => [m.jiraAccountId!, m.name]),
  );

  const agingRows: AgingRow[] = aging.map((t) => ({
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

  return (
    <PageShell
      syncState={toInboxSyncState(syncStateRaw)}
      sprintName={sprint.name}
      stateLabel={sprint.state === "ACTIVE" ? null : (sprint.state ?? "CLOSED")}
    >
      <SprintDetailTabs
        aging={<AgingReport rows={agingRows} />}
        matrix={<ActivityMatrix grid={activity} />}
        burndown={<SubBurndownChart series={burndown} />}
      />
    </PageShell>
  );
}

/** Shared chrome so the null-sprint path renders the same header and bar. */
function PageShell({
  syncState,
  sprintName,
  stateLabel,
  children,
}: {
  syncState: InboxSyncState;
  /** The Jira sprint's own name — which sprint the reader is looking at. */
  sprintName: string | null;
  /** Set only when the sprint is NOT active, so a closed one is unmistakable. */
  stateLabel: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Dashboard — Sprint Detail
          </h1>
          {/* The Jira sprint's own name. Every number on this page is scoped to
              one sprint, so which one it is belongs in the heading — not only in
              Jira. Especially once a team has several sprints behind them. */}
          {sprintName ? <Badge variant="secondary">{sprintName}</Badge> : null}
          {stateLabel ? (
            <Badge variant="outline" className="text-muted-foreground">
              Sprint {stateLabel.toLowerCase()}
            </Badge>
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
        SprintFlow found no active sprint for your Jira project. Point SprintFlow
        at a project with a running sprint (start + end dates) in setup, and this
        dashboard will populate on the next sync.
      </p>
    </div>
  );
}

/**
 * Raw `lastError` is deliberately NOT forwarded (S-07 impl-review F2): the bar
 * renders friendly copy from `status` alone, so a raw API error string can never
 * reach a client payload.
 */
function toInboxSyncState(raw: Awaited<ReturnType<typeof getSyncState>>): InboxSyncState {
  return {
    GITHUB: {
      integration: "GITHUB",
      lastSuccessfulSyncAt: raw.GITHUB.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: raw.GITHUB.status,
    },
    JIRA: {
      integration: "JIRA",
      lastSuccessfulSyncAt: raw.JIRA.lastSuccessfulSyncAt?.toISOString() ?? null,
      status: raw.JIRA.status,
    },
  };
}
