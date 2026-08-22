import { getCloudflareContext } from "@opennextjs/cloudflare";

import IntegrationCard from "@/components/organisms/settings/integration-card";
import JiraProjectEditor from "@/components/organisms/settings/jira-project-editor";
import RepoSelectionEditor from "@/components/organisms/settings/repo-selection-editor";
import SyncHistory from "@/components/organisms/settings/sync-history";
import SyncNowButton from "@/components/organisms/settings/sync-now-button";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getConnectionsOverview } from "@/lib/settings/connections";
import { disconnectGithub } from "@/app/(app)/setup/github/actions";
import { disconnectJira } from "@/app/(app)/setup/jira/actions";
import {
  testGithubConnection,
  testJiraConnection,
} from "@/app/(app)/settings/connections/actions";

/**
 * Connections settings (S-10 Phase 8) — both integrations' state and sync health
 * in one place, with a live connection test, forced sync, selection editing, and
 * the recent attempt log.
 *
 * WHY THIS PAGE EXISTS: the setup wizard has rendered a connected-state card for
 * each integration since S-02/S-03, but nothing has linked back to those pages
 * after first run. A failing integration surfaced only as a dashboard banner
 * with no route to any detail.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic`. One `getDb` handle, one owner-scoped read.
 */
export default async function ConnectionsSettingsPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const overview = await getConnectionsOverview(db, session.user.id);
  const gh = overview.github;
  const jira = overview.jira;

  return (
    <div className="flex flex-col gap-6">
      <SyncNowButton />

      <div className="grid gap-6 lg:grid-cols-2">
        <IntegrationCard
          name="GitHub"
          connected={gh.connection.connected}
          status={gh.health.status}
          lastSuccessfulSyncAt={gh.health.lastSuccessfulSyncAt}
          onTest={testGithubConnection}
          reconnectHref="/setup/github"
          onDisconnect={disconnectGithub}
          editSlot={gh.connection.connected ? <RepoSelectionEditor /> : undefined}
        >
          {gh.connection.connected ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-medium">{gh.connection.login ?? "unknown"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Token</dt>
                <dd className="font-medium tabular-nums">
                  ••••{gh.connection.tokenLast4 ?? "????"}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">
                  Monitored repositories ({gh.connection.repos.length})
                </dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 font-medium">
                  {gh.connection.repos.length === 0
                    ? "none"
                    : gh.connection.repos.map((r) => <span key={r.id}>{r.fullName}</span>)}
                </dd>
              </div>
            </dl>
          ) : null}
        </IntegrationCard>

        <IntegrationCard
          name="Jira"
          connected={jira.connection.connected}
          status={jira.health.status}
          lastSuccessfulSyncAt={jira.health.lastSuccessfulSyncAt}
          onTest={testJiraConnection}
          reconnectHref="/setup/jira"
          onDisconnect={disconnectJira}
          editSlot={
            jira.connection.connected ? (
              <JiraProjectEditor currentProjectKey={jira.connection.projectKey} />
            ) : undefined
          }
        >
          {jira.connection.connected ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="font-medium break-all">{jira.connection.workspaceUrl}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-medium break-all">{jira.connection.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Token</dt>
                <dd className="font-medium tabular-nums">
                  ••••{jira.connection.tokenLast4 ?? "????"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Project</dt>
                <dd className="font-medium">
                  {jira.connection.projectKey ?? "none"} ·{" "}
                  {jira.connection.mappedStatusCount} mapped statuses
                </dd>
              </div>
            </dl>
          ) : null}
        </IntegrationCard>
      </div>

      <SyncHistory
        github={gh.health.recentAttempts}
        jira={jira.health.recentAttempts}
      />
    </div>
  );
}
