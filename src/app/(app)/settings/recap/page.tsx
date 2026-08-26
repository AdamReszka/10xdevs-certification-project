import { getCloudflareContext } from "@opennextjs/cloudflare";

import RecapSettingsForm from "@/components/organisms/settings/recap-settings-form";
import { requireSession } from "@/lib/auth";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getDb } from "@/lib/db";
import { getLastRecap, getRecapSettings } from "@/lib/recap-settings";

/**
 * Daily Recap settings (S-11, FR-018) — when the email arrives, and whether it
 * arrives at all.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` — do NOT re-declare either. One
 * `getDb` handle, owner-scoped reads only, plain data handed to the client
 * organism.
 *
 * THE TIME ZONE IS READ-ONLY, and comes from `jira_project.time_zone` — the
 * column every Jira cycle rewrites. An editable second zone here would drift
 * from it, and the drift would be invisible: the recap would fire at a time the
 * settings page did not show.
 */
export default async function RecapSettingsPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  const [settings, timeZone, lastRecap] = await Promise.all([
    getRecapSettings({ db, ownerId }),
    getJiraTimeZone(db, ownerId),
    getLastRecap({ db, ownerId }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Daily recap</h2>
        <p className="text-sm text-muted-foreground">
          One email a day with the sprint&apos;s anomalies, each with the same
          suggested action the inbox shows, plus yesterday&apos;s team activity and
          sprint progress. It exists for the days you are not at the dashboard —
          if you already check it every morning, you can safely ignore the email.
        </p>
      </div>

      <RecapSettingsForm
        sendHour={settings.sendHour}
        sendMinute={settings.sendMinute}
        enabled={settings.enabled}
        timeZone={timeZone}
        lastRecap={
          lastRecap
            ? {
                recapDay: lastRecap.recapDay,
                sendStatus: lastRecap.sendStatus,
                // Dates cross as ISO strings, per the convention stated at
                // `organisms/anomaly/types.ts`.
                sentAt: lastRecap.sentAt?.toISOString() ?? null,
                attemptCount: lastRecap.attemptCount,
                lastAttemptAt: lastRecap.lastAttemptAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
}
