import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { dailyRecap, recapSettings } from "@/db/schema";
import type { getDb } from "@/lib/db";
import type { RecapSettingsValues } from "@/lib/validations/recap";

/**
 * Owner-scoped read/upsert of the Daily Recap send time (S-11, FR-018). The
 * request-context-free service core: `{ db, ownerId }` explicit, no session, no
 * Cloudflare context — so the cron can call it exactly as the settings page does.
 *
 * NO ROW MEANS DEFAULTS, not "recap off". This is the `src/db/defaults.ts` shape:
 * `recap_settings` is written only when the owner actually visits
 * `/settings/recap` and saves, and every owner before that gets FR-018's stated
 * default of 15:00 local with the recap enabled. Seeding a row at sign-up would
 * put a second copy of the defaults in the database, where it would drift from
 * this one.
 *
 * OWNER SCOPING is explicit on every statement — there is no RLS behind this.
 */

type Db = ReturnType<typeof getDb>;

export type RecapSettings = {
  /** Local wall-clock hour in the team's zone (`jira_project.time_zone`). */
  sendHour: number;
  sendMinute: number;
  enabled: boolean;
};

/** FR-018's stated default: 15:00 local, on. */
export const DEFAULT_RECAP_SETTINGS: RecapSettings = {
  sendHour: 15,
  sendMinute: 0,
  enabled: true,
};

export async function getRecapSettings({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<RecapSettings> {
  const [row] = await db
    .select({
      sendHour: recapSettings.sendHour,
      sendMinute: recapSettings.sendMinute,
      enabled: recapSettings.enabled,
    })
    .from(recapSettings)
    .where(eq(recapSettings.ownerId, ownerId))
    .limit(1);

  return row ?? DEFAULT_RECAP_SETTINGS;
}

/**
 * Upsert the owner's send time.
 *
 * Conflicts on `recap_settings_owner_uq` rather than reading-then-branching: the
 * singleton-per-owner shape of `githubCredential` / `jiraCredential` /
 * `jiraProject`, and the only form that is safe against two saves racing.
 */
export async function saveRecapSettings({
  db,
  ownerId,
  input,
}: {
  db: Db;
  ownerId: string;
  input: RecapSettingsValues;
}): Promise<RecapSettings> {
  const [row] = await db
    .insert(recapSettings)
    .values({
      id: randomUUID(),
      ownerId,
      sendHour: input.sendHour,
      sendMinute: input.sendMinute,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: recapSettings.ownerId,
      set: {
        sendHour: input.sendHour,
        sendMinute: input.sendMinute,
        enabled: input.enabled,
        updatedAt: new Date(),
      },
    })
    .returning({
      sendHour: recapSettings.sendHour,
      sendMinute: recapSettings.sendMinute,
      enabled: recapSettings.enabled,
    });

  return row ?? DEFAULT_RECAP_SETTINGS;
}

/** The one "did it actually work" signal `/settings/recap` renders. */
export type LastRecap = {
  recapDay: string;
  sendStatus: "PENDING" | "SENT" | "FAILED";
  sentAt: Date | null;
  attemptCount: number;
  /**
   * When the current attempt claimed the row. Read so the settings page can tell
   * "sending right now" from a claim orphaned by a dead Worker (impl-review F6)
   * — without it, a stalled PENDING renders as in-progress indefinitely.
   */
  lastAttemptAt: Date | null;
};

/**
 * The owner's most recent recap row, newest local day first.
 *
 * DELIBERATELY NOT A DASHBOARD BANNER: a recap failure must not dilute the US-01
 * integration-error banner, which means "your Jira/GitHub data is stale" and is
 * the thing the lead has to act on. This is a pull surface on the page the owner
 * is already on when they care.
 *
 * `payload` and `rendered_message` are excluded — they are kilobytes of JSONB the
 * page does not render. Listing and drilling into past recaps is S-12 (FR-019).
 */
export async function getLastRecap({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<LastRecap | null> {
  const [row] = await db
    .select({
      recapDay: dailyRecap.recapDay,
      sendStatus: dailyRecap.sendStatus,
      sentAt: dailyRecap.sentAt,
      attemptCount: dailyRecap.attemptCount,
      lastAttemptAt: dailyRecap.lastAttemptAt,
    })
    .from(dailyRecap)
    .where(eq(dailyRecap.ownerId, ownerId))
    // `recap_day` is `YYYY-MM-DD`, so the lexicographic sort is the chronological
    // one — no cast needed.
    .orderBy(desc(dailyRecap.recapDay))
    .limit(1);

  return row ?? null;
}
