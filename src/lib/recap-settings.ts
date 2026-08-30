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
  /**
   * Why SPRINTFLOW switched the recap off — `BOUNCE_PERMANENT` or `COMPLAINT`
   * (S-12 Phase 4). NULL alongside `enabled: false` means the OWNER turned it
   * off themselves, which needs no explanation.
   */
  disabledReason: string | null;
  disabledAt: Date | null;
};

/**
 * FR-018's stated default: 15:00 local, on.
 *
 * Both disabled-* fields are null, which is the honest no-row state: an owner
 * who has never saved has never been disabled either.
 */
export const DEFAULT_RECAP_SETTINGS: RecapSettings = {
  sendHour: 15,
  sendMinute: 0,
  enabled: true,
  disabledReason: null,
  disabledAt: null,
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
      // Read in the SAME query, not a second one: `/settings/recap` keeps its
      // single `Promise.all` (`page.tsx:28-32`), and a second round trip for two
      // columns is the second fan-out `lessons.md` #3 rejects. Sharing one
      // handle (S-21) makes that trip cheap; it does not make it free.
      disabledReason: recapSettings.disabledReason,
      disabledAt: recapSettings.disabledAt,
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
 *
 * THE AUTO-DISABLE EXPLANATION IS CLEARED ONLY BY A SAVE THAT RE-ENABLES
 * (S-12 Phase 4). The distinction is load-bearing, not tidiness: changing the
 * send hour while the recap is off must NOT erase why it went off, or the next
 * thing the owner sees is an unexplained "off" switch and they flip it straight
 * back into the same bounce loop. Only `enabled: true` is the owner saying they
 * have dealt with it.
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
        // Spread, so the two columns are ABSENT from the SET list on a save that
        // does not re-enable — `undefined` would be a no-op in drizzle, but
        // omitting them says the intent out loud and cannot be undone by a
        // future change to how drizzle treats undefined.
        ...(input.enabled ? { disabledReason: null, disabledAt: null } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({
      sendHour: recapSettings.sendHour,
      sendMinute: recapSettings.sendMinute,
      enabled: recapSettings.enabled,
      disabledReason: recapSettings.disabledReason,
      disabledAt: recapSettings.disabledAt,
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
 * page does not render.
 *
 * OVERLAPS `listRecaps` (`recap/history.ts`) AND STAYS. That is S-12's list read
 * over the same table; this one is `limit(1)` and projects five columns for a
 * single line on the settings page, so collapsing them would either make the
 * settings page pay for a list it does not show or make the list carry a shape
 * it does not need. Two narrow reads, one table — but only two: a third reader
 * over `daily_recap` should extend one of these rather than appear beside them.
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
