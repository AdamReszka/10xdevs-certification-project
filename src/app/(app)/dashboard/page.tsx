import { getCloudflareContext } from "@opennextjs/cloudflare";

import AnomalyInbox from "@/components/organisms/anomaly/anomaly-inbox";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listAnomaliesForSprint } from "@/lib/anomaly/reader";
import { anomalyContextChips, anomalyIdentity } from "@/lib/anomaly/context";
import { getActiveSprintRow } from "@/lib/sprint";
import { getSyncState } from "@/lib/sync-state";
import { listRoster } from "@/lib/roster";
import type {
  InboxAnomaly,
  InboxSyncState,
} from "@/components/organisms/anomaly/types";

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
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  const sprint = await getActiveSprintRow(db, ownerId);
  const [rows, syncStateRaw, roster] = await Promise.all([
    sprint ? listAnomaliesForSprint(db, ownerId, sprint.id) : Promise.resolve([]),
    getSyncState(db, ownerId),
    listRoster(db, ownerId),
  ]);

  // Name map covers ALL members (incl. deactivated) so an anomaly referencing a
  // deactivated member still resolves its name; the filter dropdown (below) uses
  // only the active subset.
  const memberNameById = new Map(roster.map((m) => [m.id, m.name]));

  const anomalies: InboxAnomaly[] = rows.map((r) => {
    const identity = anomalyIdentity(r);
    return {
      id: r.id,
      type: r.type,
      severity: r.severity,
      description: r.description ?? "",
      suggestedAction: r.suggestedAction ?? "",
      sourceUrl: r.sourceUrl,
      riskScore: r.riskScore,
      detectedAt: r.detectedAt ? r.detectedAt.toISOString() : null,
      memberId: r.relatedTeamMemberId,
      memberName: r.relatedTeamMemberId
        ? (memberNameById.get(r.relatedTeamMemberId) ?? null)
        : null,
      identityKind: identity.kind,
      identityLabel: identity.label,
      identitySortKey: identity.sortKey,
      contextChips: anomalyContextChips(r),
      dedupKey: r.dedupKey,
    };
  });

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
      <AnomalyInbox
        anomalies={anomalies}
        roster={rosterMembers}
        syncState={syncState}
        hasActiveSprint={sprint != null}
      />
    </div>
  );
}
