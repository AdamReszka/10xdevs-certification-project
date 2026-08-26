import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { dailyRecap, user } from "@/db/schema";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import type { getDb } from "@/lib/db";
import { EmailRequestError, EmailUnavailableError } from "@/lib/email";
import {
  resolveEmailTransport,
  resolveFromAddress,
  type EmailEnv,
  type EmailTransport,
} from "@/lib/email-transport";
import { getRecapSettings } from "@/lib/recap-settings";
import { buildRecapPayload as buildRecapPayloadImpl } from "@/lib/recap/build";
import { isRecapDue } from "@/lib/recap/due";
import { renderRecapEmail as renderRecapEmailImpl } from "@/lib/recap/render";
import type { RenderedEmail } from "@/lib/recap/types";
import { getActiveSprintRow } from "@/lib/sprint";

/**
 * Send one owner's Daily Recap, exactly once per local day (S-11, FR-018).
 *
 * THE DATABASE IS THE CONCURRENCY GUARD, not this function.
 * `unique(owner_id, recap_day)` plus a claim-first
 * `INSERT … ON CONFLICT DO NOTHING RETURNING id` holds across a Worker restart
 * mid-send in a way an in-process lease cannot, and it is how the rest of the
 * repo does idempotency (`anomaly.dedupKey`, `sync_state`,
 * `jira_status_history`). The claim happens BEFORE any work, so a crash after it
 * costs the day one attempt rather than producing a second email.
 *
 * RENDER ONCE, THEN FREEZE. The rendered bytes are persisted on the claim row
 * before the transport is called, and every retry re-sends those stored bytes.
 * This is what keeps the `Idempotency-Key` usable (plan-review F1): Resend
 * answers a repeated key carrying a DIFFERENT payload with `409
 * invalid_idempotent_request`, and `runDetect` runs on every 15-minute tick
 * immediately before this — so a retry that rebuilt from live state would differ
 * from attempt 1 and 409 in exactly the case retries exist for. NOTHING on a
 * retry path may call `renderRecapEmail` again.
 *
 * Accepted consequence, and correct for a document titled "your recap for
 * <day>": a retry reports the picture as of the FIRST attempt, not the current
 * one.
 */

type Db = ReturnType<typeof getDb>;

/**
 * Reclaim window for a PENDING row left behind by a crashed invocation.
 * Deliberately UNDER the 15-minute cron interval so a crashed run self-recovers
 * on the next fire — the `LEASE_TTL_MS` reasoning at `run-sync.ts:80-83`.
 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Three tries, then silence until tomorrow. Enough to ride out a 429 or a
 * restart; few enough that a permanent misconfiguration does not generate ~96
 * failed provider calls a day per owner.
 */
const MAX_ATTEMPTS = 3;

export type SendRecapReason =
  | "no_sprint"
  | "not_due"
  | "disabled"
  | "already_sent"
  | "in_flight"
  | "attempts_exhausted"
  | "no_recipient"
  | "no_sender"
  | "lost_race";

export type SendRecapResult = {
  status: "SENT" | "SKIPPED" | "FAILED";
  reason?: SendRecapReason | string;
};

export type SendDailyRecapDeps = {
  transport?: EmailTransport;
  buildRecapPayload?: typeof buildRecapPayloadImpl;
  renderRecapEmail?: typeof renderRecapEmailImpl;
};

export type SendRecapEnv = EmailEnv & { BETTER_AUTH_URL?: string };

export async function sendDailyRecap({
  db,
  ownerId,
  env,
  now,
  deps,
}: {
  db: Db;
  ownerId: string;
  env?: SendRecapEnv;
  now: Date;
  deps?: SendDailyRecapDeps;
}): Promise<SendRecapResult> {
  const buildPayload = deps?.buildRecapPayload ?? buildRecapPayloadImpl;
  const render = deps?.renderRecapEmail ?? renderRecapEmailImpl;

  // --- 1. Settings, zone, sprint -------------------------------------------
  const [settings, timeZone, sprint] = await Promise.all([
    getRecapSettings({ db, ownerId }),
    getJiraTimeZone(db, ownerId),
    getActiveSprintRow(db, ownerId),
  ]);

  // Approved decision: `daily_recap.sprint_id` is NOT NULL, so a between-sprints
  // owner has nowhere to store the claim. Skipped entirely rather than sent
  // without one.
  if (!sprint) return { status: "SKIPPED", reason: "no_sprint" };

  // --- 2. Due? --------------------------------------------------------------
  const due = isRecapDue({
    now,
    timeZone,
    sendHour: settings.sendHour,
    sendMinute: settings.sendMinute,
    enabled: settings.enabled,
  });
  if (!due.due) {
    return { status: "SKIPPED", reason: due.reason === "disabled" ? "disabled" : "not_due" };
  }

  // --- 3. Claim the day's slot ---------------------------------------------
  const [claimed] = await db
    .insert(dailyRecap)
    .values({
      id: randomUUID(),
      ownerId,
      sprintId: sprint.id,
      recapDay: due.dayKey,
      sendStatus: "PENDING",
      attemptCount: 1,
      lastAttemptAt: now,
    })
    .onConflictDoNothing({ target: [dailyRecap.ownerId, dailyRecap.recapDay] })
    .returning({ id: dailyRecap.id });

  let rowId: string;
  let frozen: RenderedEmail | null = null;

  if (claimed) {
    rowId = claimed.id;
  } else {
    // --- 4. A row already exists — read it and decide -----------------------
    const [existing] = await db
      .select({
        id: dailyRecap.id,
        sendStatus: dailyRecap.sendStatus,
        attemptCount: dailyRecap.attemptCount,
        lastAttemptAt: dailyRecap.lastAttemptAt,
        renderedMessage: dailyRecap.renderedMessage,
      })
      .from(dailyRecap)
      .where(and(eq(dailyRecap.ownerId, ownerId), eq(dailyRecap.recapDay, due.dayKey)))
      .limit(1);

    // The unique constraint refused our insert, so the row is there. A miss here
    // means it was deleted between the two statements (a Jira project switch
    // cascades sprints away) — treat it as another invocation's business.
    if (!existing) return { status: "SKIPPED", reason: "in_flight" };

    if (existing.sendStatus === "SENT") return { status: "SKIPPED", reason: "already_sent" };

    const fresh =
      existing.lastAttemptAt !== null &&
      now.getTime() - existing.lastAttemptAt.getTime() < CLAIM_TTL_MS;
    if (existing.sendStatus === "PENDING" && fresh) {
      return { status: "SKIPPED", reason: "in_flight" };
    }

    if (existing.attemptCount >= MAX_ATTEMPTS) {
      return { status: "SKIPPED", reason: "attempts_exhausted" };
    }

    // Guarded reclaim: the `send_status` and `attempt_count` predicates make
    // this a compare-and-swap, so two invocations racing to reclaim the same
    // stale row produce exactly one winner.
    const [reclaimed] = await db
      .update(dailyRecap)
      .set({
        sendStatus: "PENDING",
        attemptCount: sql`${dailyRecap.attemptCount} + 1`,
        lastAttemptAt: now,
      })
      .where(
        and(
          eq(dailyRecap.id, existing.id),
          eq(dailyRecap.ownerId, ownerId),
          eq(dailyRecap.sendStatus, existing.sendStatus),
          eq(dailyRecap.attemptCount, existing.attemptCount),
        ),
      )
      .returning({ id: dailyRecap.id });

    if (!reclaimed) return { status: "SKIPPED", reason: "lost_race" };

    rowId = reclaimed.id;
    // THE RETRY PATH. Stored bytes exist ⇒ re-send them verbatim and do not
    // re-render. See the module header.
    frozen = existing.renderedMessage ?? null;
  }

  // --- 5. Recipient + sender ------------------------------------------------
  const [recipient] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, ownerId))
    .limit(1);
  if (!recipient?.email) return await fail(db, rowId, ownerId, "no_recipient");

  const from = resolveFromAddress(env);
  if (!from) return await fail(db, rowId, ownerId, "no_sender");

  // --- 6. Render once, persist, then send -----------------------------------
  if (!frozen) {
    const payload = await buildPayload({ db, ownerId, now, timeZone, sprint });
    frozen = render(payload);
    // Persist BEFORE calling the transport. Load-bearing, not tidiness: this is
    // what makes attempts 2 and 3 byte-identical to attempt 1.
    await db
      .update(dailyRecap)
      .set({
        payload,
        renderedMessage: frozen,
        anomalyIds: payload.anomalies.map((a) => a.id),
      })
      .where(and(eq(dailyRecap.id, rowId), eq(dailyRecap.ownerId, ownerId)));
  }

  const transport = deps?.transport ?? resolveEmailTransport(env);

  try {
    await transport.send({
      from,
      to: recipient.email,
      subject: frozen.subject,
      html: frozen.html,
      text: frozen.text,
      // NO ATTEMPT SUFFIX. If attempt 1 failed at the network layer AFTER Resend
      // accepted the message, replaying this exact key is what prevents a second
      // email; an attempt suffix would send one.
      idempotencyKey: `${ownerId}:${due.dayKey}`,
      headers: unsubscribeHeaders(env),
    });
  } catch (err) {
    // `409 concurrent_idempotent_requests` means another attempt is mid-flight at
    // Resend — come back later, never "give up".
    if (err instanceof EmailRequestError && err.status === 409) {
      return { status: "SKIPPED", reason: "in_flight" };
    }
    // A retryable failure leaves `attempt_count` where the claim put it, so the
    // next tick can reclaim. A non-retryable one (bad sender, bad key, malformed
    // request) burns the cap immediately rather than repeating a call that can
    // never succeed.
    const retryable = err instanceof EmailUnavailableError;
    await db
      .update(dailyRecap)
      .set({
        sendStatus: "FAILED",
        ...(retryable ? {} : { attemptCount: MAX_ATTEMPTS }),
      })
      .where(and(eq(dailyRecap.id, rowId), eq(dailyRecap.ownerId, ownerId)));
    return {
      status: "FAILED",
      // `err.message` only — a third-party email error does not inherit the
      // token-free-by-construction invariant `run-sync.ts:90-91` records.
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  await db
    .update(dailyRecap)
    .set({ sendStatus: "SENT", sentAt: now })
    .where(and(eq(dailyRecap.id, rowId), eq(dailyRecap.ownerId, ownerId)));

  return { status: "SENT" };
}

/**
 * One-click unsubscribe headers pointing at the settings page.
 *
 * Not a preference centre and not an email-verification gate — both are
 * explicitly out of scope. This is the pair that keeps a recipient reaching for
 * "spam" instead of an off switch from burning a two-week-old domain's
 * reputation, and it costs one header. Frozen with the rendered bytes, so it is
 * identical across retries.
 */
function unsubscribeHeaders(env?: SendRecapEnv): Record<string, string> | undefined {
  const baseUrl = env?.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL;
  if (!baseUrl) return undefined;
  return {
    "List-Unsubscribe": `<${baseUrl}/settings/recap>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Mark the claim FAILED at the cap — these branches cannot succeed on a retry. */
async function fail(
  db: Db,
  rowId: string,
  ownerId: string,
  reason: SendRecapReason,
): Promise<SendRecapResult> {
  await db
    .update(dailyRecap)
    .set({ sendStatus: "FAILED", attemptCount: MAX_ATTEMPTS })
    .where(and(eq(dailyRecap.id, rowId), eq(dailyRecap.ownerId, ownerId)));
  return { status: "FAILED", reason };
}
