/**
 * Display logic for `/settings/recap` (S-11 Phase 6). PURE, no React.
 *
 * Split out because there is no component-test harness in this project (no
 * jsdom, no RTL) — CLAUDE.md's stated convention is that any judgement a `.tsx`
 * makes moves to a `.ts` sibling so a unit test can reach it. Same split as
 * `absence-calendar-view.ts` and `roster-merge.ts`.
 */

import { classifyRecapSend, MAX_ATTEMPTS, type RecapSendRow } from "./recap-history-view";

/**
 * The last-send row this card renders. An alias, not a second declaration:
 * S-12 moved the shape — and the send-state mapping over it — into
 * `recap-history-view.ts`, so the history list and this card cannot drift apart
 * about the same row.
 */
export type LastRecapRow = RecapSendRow;

/**
 * The one "did it actually work" line.
 *
 * Deliberately a PULL surface on the page the owner is already on, not a
 * dashboard banner: a recap failure must not dilute the US-01 integration-error
 * banner, which means "your Jira/GitHub data is stale" and is a different thing
 * to act on.
 */
export function describeLastSend(row: LastRecapRow | null, now: Date = new Date()): string {
  if (!row) {
    return "No recap has been sent yet. The first one goes out at your chosen time, once Jira has an active sprint.";
  }

  // The five-way split — PENDING in-flight vs stalled, FAILED retryable vs
  // exhausted — is `classifyRecapSend`'s, shared with the history list. Only the
  // wording is this card's, because it speaks about "the last one" and the list
  // speaks about "this one".
  switch (classifyRecapSend(row, now)) {
    case "SENT":
      return `Last recap sent for ${row.recapDay}.`;
    case "PENDING_STALLED":
      return `The recap for ${row.recapDay} stalled mid-send. SprintFlow will retry it within 15 minutes.`;
    case "PENDING_IN_FLIGHT":
      return `A recap for ${row.recapDay} is being sent right now.`;
    case "FAILED_EXHAUSTED":
      return `The recap for ${row.recapDay} could not be delivered after ${MAX_ATTEMPTS} attempts. The next one is tomorrow.`;
    case "FAILED_RETRYABLE":
      return `The recap for ${row.recapDay} failed on attempt ${row.attemptCount}. SprintFlow will try again within 15 minutes.`;
  }
}

/**
 * The auto-disable explanation, or null when there is nothing to explain.
 *
 * WHY THIS EXISTS AT ALL: a switch that flipped itself is indistinguishable from
 * a decision the owner made months ago, and the first thing they do with an
 * unexplained "off" is turn it back on — into the same bounce loop. Naming what
 * happened is what makes re-enabling an informed act.
 *
 * A NULL `disabledReason` returns null even when the recap is off: that is the
 * owner having turned it off themselves, which needs no explanation and must not
 * be dressed up as a fault. The stored value is a stable CODE
 * (`recap/webhook.ts`), so the prose lives here with the rest of the copy and a
 * wording change is never a migration.
 */
export function describeAutoDisable(settings: {
  disabledReason: string | null;
  disabledAt: Date | string | null;
}): string | null {
  if (!settings.disabledReason) return null;

  const when = settings.disabledAt
    ? new Date(settings.disabledAt).toISOString().slice(0, 10)
    : null;
  const on = when ? ` on ${when}` : "";

  switch (settings.disabledReason) {
    case "BOUNCE_PERMANENT":
      return `SprintFlow stopped sending your daily recap${on} because your email provider rejected it permanently — the address could not be delivered to. Check the address on your account is right and can receive mail, then turn the recap back on below.`;
    case "COMPLAINT":
      return `SprintFlow stopped sending your daily recap${on} because a recap was reported as spam from your address. Mark SprintFlow as safe in your mail client before turning it back on, or the next send will be blocked the same way.`;
    default:
      // An unknown code is still worth showing: it means SOMETHING switched the
      // recap off, and silence would put the owner back in the dark this
      // function exists to end.
      return `SprintFlow stopped sending your daily recap${on}. Turn it back on below once the problem with your email address is resolved.`;
  }
}

/**
 * The send-time helper text.
 *
 * LOAD-BEARING, not decoration. The cron resolution is 15 minutes
 * (`wrangler.jsonc:12-14`), so the system cannot honour a minute exactly.
 * Shipping a minute picker that silently rounds would be a defect; saying so
 * turns it into a documented bound.
 */
export function sendTimeHint(timeZone: string | null): string {
  const where = timeZone
    ? `Times are in ${timeZone}, your team's Jira time zone.`
    : "SprintFlow has no time zone for your team yet, so this is UTC until the next Jira sync picks one up.";
  return `${where} This is the EARLIEST time — SprintFlow checks every 15 minutes, so the recap arrives at or shortly after it.`;
}

/** `15`, `0` → `"15:00"`, for the `<input type="time">` value. */
export function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * `"15:30"` → `{ hour: 15, minute: 30 }`, or null when the field is empty or
 * malformed.
 *
 * `<input type="time">` yields `""` when cleared, and browsers differ on whether
 * they emit seconds — hence the parse rather than a `split(":").map(Number)`,
 * which would turn `""` into `{ hour: NaN }` and hand NaN to the zod schema as a
 * "number".
 */
export function fromTimeValue(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}
