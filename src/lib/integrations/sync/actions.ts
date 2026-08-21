"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { getDbWithPool } from "@/lib/db";
import { detectAnomalies } from "@/lib/anomaly/detect";
import { syncOwner, type IntegrationOutcome } from "@/lib/integrations/sync/run-sync";

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
 * no `ctx` is present (e.g. `next dev`). Returns non-secret per-integration status.
 */
export type SyncNowResult = {
  github: IntegrationOutcome;
  jira: IntegrationOutcome;
};

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
    await detectAnomalies({ db, ownerId: session.user.id, now });
    return { github: result.github, jira: result.jira };
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
