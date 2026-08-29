import { getCloudflareContext } from "@opennextjs/cloudflare";

import AnomalyRulesEditor from "@/components/organisms/settings/anomaly-rules-editor";
import { readAnomalyRules } from "@/lib/anomaly-settings";
import { getDb } from "@/lib/db";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * Anomaly rules settings (S-14, FR-009 + FR-014) — the sixth settings tab, and
 * the surface FR-009 promised when it moved threshold tuning OUT of the setup
 * wizard: "threshold tuning is NOT part of the initial setup wizard — it lives
 * on a dedicated settings page the user reaches after first run".
 *
 * `resolveWorkspace()`, not `requireRealWorkspace()`: these are per-workspace
 * numbers with no outbound call, so the tab behaves like `/settings/absences`.
 * Demo writes land under the demo owner and are undone by "Reset demo data" —
 * and demo is the one workspace guaranteed to have an active sprint, which makes
 * it where the immediate re-detect is actually observable.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` — do NOT re-declare either. One `getDb` handle, one
 * owner-scoped read that is exhaustive over all eight rules.
 */
export default async function AnomalySettingsPage() {
  const { ownerId } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const rules = await readAnomalyRules({ db, ownerId });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Anomaly rules</h2>
        <p className="text-sm text-muted-foreground">
          What SprintFlow counts as worth your attention. Every rule ships with a
          sensible default — change a number only where your team&apos;s reality
          differs, and reset it when it does not.
        </p>
      </div>

      <AnomalyRulesEditor rules={rules} />
    </div>
  );
}
