import { and, desc, eq } from "drizzle-orm";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  statusMapping,
  syncAttempt,
  syncState,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import type { SyncStatus } from "@/lib/integrations/failure-reason";

/**
 * One owner-scoped read behind the Connections settings tab (S-10 Phase 7).
 *
 * Follows the read-side convention: `(db, ownerId, …rest) → Promise<serializable>`.
 *
 * SECRETS. This never selects `encryptedToken` and never selects
 * `sync_state.last_error`. What it does expose is exactly what the setup wizard's
 * connected-state cards already show — login, workspace, `tokenLast4`, the
 * monitored selection — plus sync status. If a field is not already on a
 * connected-state card, it does not belong here either.
 *
 * OWNER SCOPING is explicit per table; there is no RLS behind this.
 */

type Db = ReturnType<typeof getDb>;

/** How many past attempts the history panel shows. Below the retention cap. */
export const RECENT_ATTEMPT_LIMIT = 15;

export type SyncAttemptView = {
  status: SyncStatus;
  /** Skip reason (e.g. `no_sprint`) when the cycle was a no-op. */
  outcome: string | null;
  finishedAt: string;
};

export type IntegrationHealth = {
  status: SyncStatus | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  recentAttempts: SyncAttemptView[];
};

export type GithubConnection =
  | { connected: false }
  | {
      connected: true;
      login: string | null;
      tokenLast4: string | null;
      repos: { id: string; fullName: string }[];
    };

export type JiraConnection =
  | { connected: false }
  | {
      connected: true;
      workspaceUrl: string;
      email: string;
      tokenLast4: string | null;
      projectKey: string | null;
      mappedStatusCount: number;
    };

export type ConnectionsOverview = {
  github: { connection: GithubConnection; health: IntegrationHealth };
  jira: { connection: JiraConnection; health: IntegrationHealth };
};

const EMPTY_HEALTH: IntegrationHealth = {
  status: null,
  lastSuccessfulSyncAt: null,
  lastAttemptAt: null,
  recentAttempts: [],
};

export async function getConnectionsOverview(
  db: Db,
  ownerId: string,
): Promise<ConnectionsOverview> {
  const [ghCred] = await db
    .select({
      githubLogin: githubCredential.githubLogin,
      tokenLast4: githubCredential.tokenLast4,
    })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId))
    .limit(1);

  const [jCred] = await db
    .select({
      workspaceUrl: jiraCredential.workspaceUrl,
      jiraEmail: jiraCredential.jiraEmail,
      tokenLast4: jiraCredential.tokenLast4,
    })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId))
    .limit(1);

  const repos = ghCred
    ? await db
        .select({ id: monitoredRepo.id, fullName: monitoredRepo.fullName })
        .from(monitoredRepo)
        .where(eq(monitoredRepo.ownerId, ownerId))
    : [];

  const [project] = jCred
    ? await db
        .select({ id: jiraProject.id, projectKey: jiraProject.projectKey })
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId))
        .limit(1)
    : [];

  const mappings = project
    ? await db
        .select({ id: statusMapping.id })
        .from(statusMapping)
        .where(
          and(
            eq(statusMapping.ownerId, ownerId),
            eq(statusMapping.jiraProjectId, project.id),
          ),
        )
    : [];

  const states = await db
    .select({
      integration: syncState.integration,
      status: syncState.status,
      lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt,
      lastAttemptAt: syncState.lastAttemptAt,
    })
    .from(syncState)
    .where(eq(syncState.ownerId, ownerId));

  const health = async (which: "GITHUB" | "JIRA"): Promise<IntegrationHealth> => {
    const row = states.find((s) => s.integration === which);
    if (!row) return EMPTY_HEALTH;

    const attempts = await db
      .select({
        status: syncAttempt.status,
        outcome: syncAttempt.outcome,
        finishedAt: syncAttempt.finishedAt,
      })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, which)))
      .orderBy(desc(syncAttempt.finishedAt))
      .limit(RECENT_ATTEMPT_LIMIT);

    return {
      status: row.status,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      recentAttempts: attempts.map((a) => ({
        status: a.status,
        outcome: a.outcome,
        finishedAt: a.finishedAt.toISOString(),
      })),
    };
  };

  return {
    github: {
      connection: ghCred
        ? {
            connected: true,
            login: ghCred.githubLogin,
            tokenLast4: ghCred.tokenLast4,
            repos,
          }
        : { connected: false },
      health: await health("GITHUB"),
    },
    jira: {
      connection: jCred
        ? {
            connected: true,
            workspaceUrl: jCred.workspaceUrl,
            email: jCred.jiraEmail,
            tokenLast4: jCred.tokenLast4,
            projectKey: project?.projectKey ?? null,
            mappedStatusCount: mappings.length,
          }
        : { connected: false },
      health: await health("JIRA"),
    },
  };
}
