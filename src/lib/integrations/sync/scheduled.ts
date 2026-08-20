import { eq } from "drizzle-orm";

import { githubCredential, jiraProject } from "@/db/schema";
import { getDbWithPool } from "@/lib/db";
import { syncOwner } from "@/lib/integrations/sync/run-sync";

/**
 * The cron entry point (S-05, Phase 5). A single global `scheduled()` invocation
 * iterates onboarded owners and syncs each within one invocation's shared
 * subrequest/CPU budget (MVP — Queues/self-fetch fan-out is deferred). The
 * per-`(owner, integration)` lease + freshness due-check live inside `syncOwner`,
 * so this loop just enumerates, caps, isolates per-owner failures, and — the
 * load-bearing teardown (lesson #3) — closes the pool via `ctx.waitUntil`.
 */

/** Env surface both `getDbWithPool` and `syncOwner` accept. */
type ScheduledEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
  GITHUB_API_BASE_URL?: string;
  JIRA_API_BASE_URL?: string;
};

/** The single capability we need off the Workers `ExecutionContext` — kept
 * structural so the loop is trivially unit/integration-testable with a spy. */
type WaitUntilCtx = { waitUntil: (promise: Promise<unknown>) => void };

/** Hard per-cycle owner cap so the shared 10k-subrequest budget isn't exhausted;
 * any overflow drains on the next fire (cursor-driven). */
const MAX_OWNERS_PER_CYCLE = 50;

type Db = ReturnType<typeof getDbWithPool>["db"];

/**
 * Enumerate onboarded owners with ONE set-based query — never the per-owner
 * `isOnboardingComplete` predicate (6 sequential queries × N owners would burn
 * the invocation budget before any sync runs). An owner with a `jira_project` AND
 * a `github_credential` is a cheap onboarded proxy; both tables are unique on
 * `owner_id`, so the join yields one row per owner.
 */
export async function enumerateOnboardedOwners(db: Db): Promise<string[]> {
  const rows = await db
    .select({ ownerId: jiraProject.ownerId })
    .from(jiraProject)
    .innerJoin(githubCredential, eq(githubCredential.ownerId, jiraProject.ownerId));
  return rows.map((r) => r.ownerId);
}

export type ScheduledSyncResult = {
  enumerated: number;
  synced: number;
  failed: number;
};

/**
 * Run one scheduled sync cycle. Injectable deps keep it testable without a real
 * Workers runtime.
 */
export async function runScheduledSync(
  env: ScheduledEnv,
  ctx: WaitUntilCtx,
  deps?: {
    getDbWithPool?: typeof getDbWithPool;
    syncOwner?: typeof syncOwner;
    now?: Date;
  },
): Promise<ScheduledSyncResult> {
  const { db, pool } = (deps?.getDbWithPool ?? getDbWithPool)(env);
  const runOwner = deps?.syncOwner ?? syncOwner;
  const now = deps?.now ?? new Date();

  try {
    const ownerIds = await enumerateOnboardedOwners(db);
    const batch = ownerIds.slice(0, MAX_OWNERS_PER_CYCLE);

    let synced = 0;
    let failed = 0;
    for (const ownerId of batch) {
      try {
        await runOwner({ db, ownerId, env, now });
        synced += 1;
      } catch (err) {
        // One owner's throw must never abort the loop. The error carries no
        // token (client errors are token-free by construction).
        failed += 1;
        console.error(
          `[sync] scheduled sync failed for owner ${ownerId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { enumerated: ownerIds.length, synced, failed };
  } finally {
    // Close the Hyperdrive-backed pool AFTER the handler returns (lesson #3): the
    // scheduled path has no request after-hook, so it owns teardown.
    ctx.waitUntil(pool.end());
  }
}
