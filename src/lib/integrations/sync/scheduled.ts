import { eq, isNull } from "drizzle-orm";

import { githubCredential, jiraProject, user } from "@/db/schema";
import { getDbWithPool } from "@/lib/db";
import { detectAnomalies } from "@/lib/anomaly/detect";
import { syncOwner } from "@/lib/integrations/sync/run-sync";
import { sweepSprintMeasurements } from "@/lib/measurement/sweep";
import { sendDailyRecap } from "@/lib/recap/send";

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
  // S-11: the recap rides this same cycle, so its transport config comes down
  // the same path.
  RESEND_API_KEY?: string;
  RESEND_FROM_ADDRESS?: string;
  BETTER_AUTH_URL?: string;
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
 *
 * DEMO OWNERS ARE EXCLUDED EXPLICITLY (S-09 / FR-008), and the exclusion is
 * mandatory rather than defensive: `github_commit.repo_id → monitored_repo
 * .credential_id → github_credential.id` is NOT NULL the whole way, so a demo
 * owner NECESSARILY holds a `github_credential` and therefore matches the join
 * above. Without `demo_of IS NULL` the cycle would attempt a real GitHub/Jira
 * sync with a fake token every 15 minutes and — worse — hand a fictional account
 * to `sendDailyRecap`, which this same loop drives. Still ONE set-based query;
 * the comment above about not going per-owner still governs.
 */
export async function enumerateOnboardedOwners(db: Db): Promise<string[]> {
  const rows = await db
    .select({ ownerId: jiraProject.ownerId })
    .from(jiraProject)
    .innerJoin(githubCredential, eq(githubCredential.ownerId, jiraProject.ownerId))
    .innerJoin(user, eq(user.id, jiraProject.ownerId))
    .where(isNull(user.demoOf));
  return rows.map((r) => r.ownerId);
}

export type ScheduledSyncResult = {
  enumerated: number;
  synced: number;
  failed: number;
  /** S-11: recaps actually handed to the transport this cycle. */
  recapsSent: number;
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
    detectAnomalies?: typeof detectAnomalies;
    sweepSprintMeasurements?: typeof sweepSprintMeasurements;
    sendDailyRecap?: typeof sendDailyRecap;
    now?: Date;
  },
): Promise<ScheduledSyncResult> {
  const { db, pool } = (deps?.getDbWithPool ?? getDbWithPool)(env);
  const runOwner = deps?.syncOwner ?? syncOwner;
  const runDetect = deps?.detectAnomalies ?? detectAnomalies;
  const runSweep = deps?.sweepSprintMeasurements ?? sweepSprintMeasurements;
  const runRecap = deps?.sendDailyRecap ?? sendDailyRecap;
  const now = deps?.now ?? new Date();

  try {
    const ownerIds = await enumerateOnboardedOwners(db);
    const batch = ownerIds.slice(0, MAX_OWNERS_PER_CYCLE);

    let synced = 0;
    let failed = 0;
    let recapsSent = 0;
    for (const ownerId of batch) {
      try {
        await runOwner({ db, ownerId, env, now });
        // Detection runs on best-available cached data, after the sync. A detection
        // throw counts the owner as failed but must not abort the batch.
        await runDetect({ db, ownerId, now });
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

      // S-23: ANOTHER sibling `try`, for the same structural reason and one of
      // its own. The measurement sweep must run whether or not the Jira pull
      // succeeded — a sprint that closed while the token was expired still has
      // to be recorded once the token is fixed, and "the sync is broken" is
      // precisely the moment a rollover is most likely to be missed. Best-effort
      // and DB-only: a sweep failure is not a sync failure.
      try {
        await runSweep({ db, ownerId, now });
      } catch (err) {
        console.error(
          `[measurement] sweep failed for owner ${ownerId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      // A SIBLING `try`, NOT nested inside the one above (plan-review F3).
      // Nesting reads naturally — "a third step" — but a throw from `runOwner`
      // or `runDetect` jumps straight to that catch and the recap is never
      // reached at all. The recap depends on none of the sync: every reader it
      // calls is DB-only. Silencing the day's email on an expired PAT or a Jira
      // 401 would blind exactly the off-hours lead FR-018 exists for, who cannot
      // see the dashboard's error banner. Ordered AFTER detection so it observes
      // the anomalies that run just wrote.
      try {
        const result = await runRecap({ db, ownerId, env, now });
        if (result.status === "SENT") recapsSent += 1;
      } catch (err) {
        // NOT counted as a sync failure (`actions.ts:90-97` is the mirror), and
        // `err.message` only — never the error object. `run-sync.ts:90-91`
        // records that sync errors are token-free BY CONSTRUCTION; a third-party
        // email error does not inherit that invariant.
        console.error(
          `[recap] daily recap failed for owner ${ownerId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { enumerated: ownerIds.length, synced, failed, recapsSent };
  } finally {
    // Close the Hyperdrive-backed pool AFTER the handler returns (lesson #3): the
    // scheduled path has no request after-hook, so it owns teardown.
    ctx.waitUntil(pool.end());
  }
}
