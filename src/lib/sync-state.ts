import { eq } from "drizzle-orm";

import { syncState } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Per-integration freshness + error reader for the dashboard (S-07). Powers the
 * always-visible last-successful-sync timestamp (Jira separately from GitHub) and
 * the error banner. An integration that never synced has no row → represented as
 * a null-filled entry so the UI can always index both GITHUB and JIRA.
 */

type Db = ReturnType<typeof getDb>;

export type IntegrationName = "GITHUB" | "JIRA";
export type SyncStatusValue = "OK" | "ERROR" | "RATE_LIMITED";

export type IntegrationSyncState = {
  integration: IntegrationName;
  lastSuccessfulSyncAt: Date | null;
  status: SyncStatusValue | null;
  lastError: string | null;
};

export type SyncStateByIntegration = Record<
  IntegrationName,
  IntegrationSyncState
>;

export async function getSyncState(
  db: Db,
  ownerId: string,
): Promise<SyncStateByIntegration> {
  const rows = await db
    .select({
      integration: syncState.integration,
      lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt,
      status: syncState.status,
      lastError: syncState.lastError,
    })
    .from(syncState)
    .where(eq(syncState.ownerId, ownerId));

  const base: SyncStateByIntegration = {
    GITHUB: {
      integration: "GITHUB",
      lastSuccessfulSyncAt: null,
      status: null,
      lastError: null,
    },
    JIRA: {
      integration: "JIRA",
      lastSuccessfulSyncAt: null,
      status: null,
      lastError: null,
    },
  };

  for (const r of rows) {
    base[r.integration] = {
      integration: r.integration,
      lastSuccessfulSyncAt: r.lastSuccessfulSyncAt,
      status: r.status,
      lastError: r.lastError,
    };
  }

  return base;
}
