"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { demoRefusal } from "@/lib/demo/refusal";
import { getDbWithPool } from "@/lib/db";
import { detectAnomalies } from "@/lib/anomaly/detect";
import { syncOwner, type IntegrationOutcome } from "@/lib/integrations/sync/run-sync";
import { sweepSprintMeasurements } from "@/lib/measurement/sweep";
import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";

/**
 * On-demand sync Server Action (S-05, Phase 5). Lets the just-finished-setup UI
 * (and a future "sync now" button) trigger the CURRENT owner's sync immediately —
 * so S-07's Dashboard "Today" has data without waiting for the next 15-min cron.
 * Reuses the exact store layer the scheduled loop calls, bypassing the freshness
 * due-check (an explicit user request always syncs).
 *
 * Thin by design, mirroring the setup actions: workspace resolution →
 * `getCloudflareContext().env` → `getDbWithPool(env)` → `syncOwner`.
 *
 * ALWAYS-REAL, AND REFUSED IN DEMO (S-09 / FR-008). Syncing is not a thing to
 * simulate: the demo owner holds a fake token, so a real call would spend it
 * against GitHub and Jira and come back 401. The refusal is here, on the server,
 * because a Server Action is its own entry point — Phase 4 disables the button
 * too, but this is the half that is a boundary rather than a courtesy.
 *
 * TAKES ITS OWN POOL (`getDbWithPool`) and closes it via
 * `ctx.waitUntil(pool.end())`, or an awaited close when no `ctx` is present
 * (e.g. `next dev`). Unlike the cron path this action DOES run inside a request
 * context, so it could share the memoized handle (lesson #3); it deliberately
 * does not, because a full sync is a long-running fan-out that outlives the
 * useful life of the request's handle. **Never call `.end()` on a handle that
 * came from `getDb`** — in `next dev` that pool is process-global and closing it
 * poisons the dev server for the rest of its life. Returns non-secret
 * per-integration status — see `SyncNowOutcome` for what is deliberately
 * withheld.
 */
/**
 * The client-facing projection of `IntegrationOutcome` — same discriminants,
 * WITHOUT the `error` string (impl-review F3).
 *
 * `classifyError` (`run-sync.ts:339-358`) has a fallback branch that puts an
 * arbitrary `err.message` here: a Postgres error, a driver error, any untyped
 * throw. That is an unbounded string nobody has audited for secrets, and it is
 * precisely why `sync_state.last_error` is never forwarded to the client
 * (S-07 impl-review F2; the same reasoning is written out in
 * `failure-reason.ts:9-15`). A Server Action's return value is serialized into
 * the response payload whether or not the component renders it, so the string
 * has to be dropped HERE, not merely left unrendered.
 *
 * The union shape is preserved so callers keep exhaustive `switch` narrowing.
 */
export type SyncNowOutcome =
  | { status: "OK" }
  | {
      status: "SKIPPED";
      reason:
        | "leased"
        | "not_due"
        | "not_connected"
        | "no_sprint"
        // Kept in lockstep with `IntegrationOutcome` (S-16). `sync-now-button`
        // renders reasons generically (`reason.replace(/_/g, " ")`), so widening
        // the union needs no UI switch.
        | "board_ambiguous"
        | "no_board"
        | "no_active_sprint"
        | "sprint_undated";
    }
  | { status: "ERROR" | "RATE_LIMITED" };

export type SyncNowResult =
  | {
      ok?: undefined;
      github: SyncNowOutcome;
      jira: SyncNowOutcome;
    }
  /** S-09: the account is viewing demo data; nothing was synced. */
  | { ok: false; error: "demo_mode"; message: string };

function toClientOutcome(outcome: IntegrationOutcome): SyncNowOutcome {
  if (outcome.status === "SKIPPED") {
    return { status: "SKIPPED", reason: outcome.reason };
  }
  if (outcome.status === "OK") return { status: "OK" };
  // `error` deliberately not carried across — see SyncNowOutcome above. The
  // surface classifies `status` instead (`failure-reason.ts`).
  return { status: outcome.status };
}

export async function syncNow(): Promise<SyncNowResult> {
  // Both resolvers carry the same session guard. The real owner is the one whose
  // credentials would be used; the demo flag is what stops us using them from a
  // screen that says "demo".
  const [{ ownerId }, { isDemo }] = await Promise.all([
    requireRealWorkspace(),
    resolveWorkspace(),
  ]);
  // BEFORE `getDbWithPool` — a refused sync must not open a connection it then
  // has to tear down, and must never reach `syncOwner`.
  if (isDemo) return demoRefusal();

  const { env, ctx } = getCloudflareContext();
  const { db, pool } = getDbWithPool(env);
  // One clock shared by sync and detection for this cycle.
  const now = new Date();

  try {
    const result = await syncOwner({
      db,
      ownerId,
      env,
      now,
      bypassDueCheck: true,
    });
    // Detect on the freshly-synced (best-available) data before pool teardown.
    // Best-effort: a detection failure must not fail the user's sync/setup finish
    // (the cron loop isolates detection per owner the same way).
    try {
      await detectAnomalies({ db, ownerId, now });
    } catch (err) {
      console.error(
        "[detect] syncNow detection failed:",
        err instanceof Error ? err.message : err,
      );
    }
    // S-23: record what each sprint was, on the same cycle (FR-023). Separate
    // from the detection try/catch above so neither swallows the other, and
    // best-effort for the same reason: a measurement the sweep can retry next
    // cycle must never fail the owner's explicit "sync now".
    try {
      await sweepSprintMeasurements({ db, ownerId, now });
    } catch (err) {
      console.error(
        "[measurement] syncNow sweep failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return { github: toClientOutcome(result.github), jira: toClientOutcome(result.jira) };
  } finally {
    // The queries have already resolved (syncOwner is awaited), so closing now is
    // safe. Prefer the request after-hook; fall back to an awaited close in dev.
    if (ctx?.waitUntil) {
      ctx.waitUntil(pool.end());
    } else {
      await pool.end();
    }
  }
}
