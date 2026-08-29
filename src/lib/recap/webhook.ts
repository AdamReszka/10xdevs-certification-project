import { randomUUID } from "node:crypto";

import { and, inArray, isNull, sql } from "drizzle-orm";

import { recapSettings, user } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Turning a VERIFIED Resend webhook delivery into at most one owner-scoped
 * write (S-12 Phase 4, closing S-11 plan-review F6).
 *
 * NOTHING HERE AUTHENTICATES ANYTHING. Every value this module touches — the
 * event name, the bounce type, the address — comes out of a body a stranger
 * would happily forge; `webhook-signature.ts` is what makes it trustworthy, and
 * the route must verify BEFORE calling in here. Keeping the two apart is
 * deliberate: the parser is then free to be permissive about shape without that
 * permissiveness being a security decision.
 */

type Db = ReturnType<typeof getDb>;

/**
 * Why the recap was switched off, as a STABLE CODE rather than display copy.
 *
 * The column is free text, but what goes in it is one of these two. Storing the
 * sentence the owner reads would freeze today's wording into the database and
 * make every copy edit a migration; the mapping to prose lives in
 * `recap-settings-view.ts` where the rest of the copy is.
 */
export type RecapDisableReason = "BOUNCE_PERMANENT" | "COMPLAINT";

/** What the route should do with a delivery. */
export type ResendEvent =
  | { kind: "disable"; addresses: string[]; reason: RecapDisableReason }
  /**
   * Not an error. Resend delivers every subscribed event type, and a transient
   * bounce genuinely must NOT disable anyone — the address is fine, the mailbox
   * was briefly unavailable. `why` is a fixed code for the operator log.
   */
  | { kind: "ignore"; why: IgnoreReason };

export type IgnoreReason =
  | "not-an-object"
  | "unhandled-event-type"
  | "bounce-not-permanent"
  | "no-recipients";

/** Narrow structural read of the payload. No zod: four fields, all optional. */
type RawEvent = {
  type?: unknown;
  data?: {
    to?: unknown;
    bounce?: { type?: unknown } | null;
  } | null;
};

/** `data.to` is an ARRAY in Resend's payloads, not a string. */
function readRecipients(data: RawEvent["data"]): string[] {
  const to = data?.to;
  const list = Array.isArray(to) ? to : typeof to === "string" ? [to] : [];
  return list.filter((v): v is string => typeof v === "string" && v.includes("@"));
}

/**
 * Classify a verified delivery.
 *
 * ACCEPTS exactly two things: a `Permanent` bounce and a complaint. A permanent
 * bounce says the address is bad regardless of WHICH message hit it — which is
 * why the password-reset email arriving on this same webhook is a feature, not
 * noise: it is the cheapest detector of a typo'd sign-up address.
 *
 * Everything else — `email.delivered`, `email.opened`, a `Transient` bounce — is
 * an `ignore`, never a throw. An endpoint that 500s on an event type it did not
 * expect teaches the provider to retry it forever.
 */
export function parseResendEvent(payload: unknown): ResendEvent {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "ignore", why: "not-an-object" };
  }

  const event = payload as RawEvent;
  const addresses = readRecipients(event.data);

  if (event.type === "email.bounced") {
    // Only `Permanent`. A transient bounce is a full mailbox or a greylist —
    // disabling on it would switch the recap off for a healthy address.
    if (event.data?.bounce?.type !== "Permanent") {
      return { kind: "ignore", why: "bounce-not-permanent" };
    }
    if (addresses.length === 0) return { kind: "ignore", why: "no-recipients" };
    return { kind: "disable", addresses, reason: "BOUNCE_PERMANENT" };
  }

  if (event.type === "email.complained") {
    if (addresses.length === 0) return { kind: "ignore", why: "no-recipients" };
    return { kind: "disable", addresses, reason: "COMPLAINT" };
  }

  return { kind: "ignore", why: "unhandled-event-type" };
}

/**
 * What happened, in a shape the route can log.
 *
 * `matched` is a COUNT, never the address. The address is the one piece of
 * personal data on this path and it must not reach an operator log — the rule
 * `email.ts:19-23` states for the API key, applied to the recipient.
 */
export type DisableResult = { matched: number; reason: RecapDisableReason };

/**
 * Switch the daily recap off for whoever owns these addresses.
 *
 * CASE-INSENSITIVE MATCH: mail systems treat the local part as case-insensitive
 * in practice and Resend echoes back whatever the message carried, so a
 * `Lead@Acme.test` bounce must find the owner stored as `lead@acme.test`.
 *
 * DEMO OWNERS ARE EXCLUDED, the same `demo_of IS NULL` exclusion
 * `scheduled.ts:60-67` already applies to the send path. A synthetic demo user
 * carries its parent account's shape and must never be disabled by a real
 * bounce — and, since nothing ever emails it, could never have earned one.
 *
 * AN UPSERT, NOT AN UPDATE: most owners have no `recap_settings` row at all
 * (`recap-settings.ts:14-19` — no row means defaults, and the default is
 * enabled), so an UPDATE would match nothing and silently leave the recap on.
 * That is the entire bug this function exists to avoid.
 *
 * IDEMPOTENT BY CONSTRUCTION. A repeated delivery of the same event rewrites the
 * same three values; webhooks are at-least-once and the route must not care.
 *
 * An unknown address is a no-op returning `matched: 0` — the route still answers
 * 200, because "we have no such user" is not the provider's problem to retry.
 */
export async function disableRecapForAddress({
  db,
  addresses,
  reason,
  now = new Date(),
}: {
  db: Db;
  addresses: string[];
  reason: RecapDisableReason;
  now?: Date;
}): Promise<DisableResult> {
  if (addresses.length === 0) return { matched: 0, reason };

  const lowered = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return { matched: 0, reason };

  const owners = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(sql`lower(${user.email})`, lowered),
        // The send path's own exclusion, mirrored. A demo row must never be
        // disabled by a real bounce.
        isNull(user.demoOf),
      ),
    );

  for (const owner of owners) {
    await db
      .insert(recapSettings)
      .values({
        id: randomUUID(),
        ownerId: owner.id,
        enabled: false,
        disabledReason: reason,
        disabledAt: now,
        // Set explicitly so the INSERT and the UPDATE below agree. Left to
        // `defaultNow()` it would be the wall clock on one path and `now` on the
        // other, which makes a repeated delivery write a different row.
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: recapSettings.ownerId,
        set: {
          enabled: false,
          disabledReason: reason,
          // KEEP the first time we disabled for THIS reason. A bare `now` would
          // let every at-least-once redelivery drag the timestamp forward, so
          // "disabled since" would end up meaning "when the provider last
          // retried" rather than when the address actually went bad. A change of
          // reason (a bounce, then a complaint) is a new fact and does move it.
          // `excluded.*` is the row we just tried to insert, so the fallback
          // reuses the value drizzle ALREADY mapped for this column. Binding
          // `now` into the raw SQL instead skips that mapper: `disabled_at` is
          // `timestamp WITHOUT time zone`, and a raw JS Date lands as local wall
          // time — the insert path stored 10:00 and the update path 12:00 for
          // the same instant, which the integration test caught.
          disabledAt: sql`case
            when ${recapSettings.disabledReason} = excluded.disabled_reason
             and ${recapSettings.disabledAt} is not null
            then ${recapSettings.disabledAt}
            else excluded.disabled_at
          end`,
          updatedAt: now,
        },
      });
  }

  return { matched: owners.length, reason };
}
