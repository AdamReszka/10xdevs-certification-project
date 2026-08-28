"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { getDbWithPool } from "@/lib/db";
import { detectAnomalies } from "@/lib/anomaly/detect";
import { syncOwner, type IntegrationOutcome } from "@/lib/integrations/sync/run-sync";
import { sweepSprintMeasurements } from "@/lib/measurement/sweep";

/**
 * On-demand sync Server Action (S-05, Phase 5). Lets the just-finished-setup UI
 * (and a future "sync now" button) trigger the CURRENT owner's sync immediately —
 * so S-07's Dashboard "Today" has data without waiting for the next 15-min cron.
 * Reuses the exact store layer the scheduled loop calls, bypassing the freshness
 * due-check (an explicit user request always syncs).
 *
 * Thin by design, mirroring the setup actions: `requireSession` →
 * `getCloudflareContext().env` → `getDbWithPool(env)` → `syncOwner`. Owns pool
 * teardown (lesson #3) via `ctx.waitUntil(pool.end())`, or an awaited close when
 * no `ctx` is present (e.g. `next dev`). Returns non-secret per-integration
 * status — see `SyncNowOutcome` for what is deliberately withheld.
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

export type SyncNowResult = {
  github: SyncNowOutcome;
  jira: SyncNowOutcome;
};

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
  const session = await requireSession();
  const { env, ctx } = getCloudflareContext();
  const { db, pool } = getDbWithPool(env);
  // One clock shared by sync and detection for this cycle.
  const now = new Date();

  try {
    const result = await syncOwner({
      db,
      ownerId: session.user.id,
      env,
      now,
      bypassDueCheck: true,
    });
    // Detect on the freshly-synced (best-available) data before pool teardown.
    // Best-effort: a detection failure must not fail the user's sync/setup finish
    // (the cron loop isolates detection per owner the same way).
    try {
      await detectAnomalies({ db, ownerId: session.user.id, now });
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
      await sweepSprintMeasurements({ db, ownerId: session.user.id, now });
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
