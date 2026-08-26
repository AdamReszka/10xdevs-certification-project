/**
 * Display logic for `/settings/recap` (S-11 Phase 6). PURE, no React.
 *
 * Split out because there is no component-test harness in this project (no
 * jsdom, no RTL) — CLAUDE.md's stated convention is that any judgement a `.tsx`
 * makes moves to a `.ts` sibling so a unit test can reach it. Same split as
 * `absence-calendar-view.ts` and `roster-merge.ts`.
 */

export type LastRecapRow = {
  recapDay: string;
  sendStatus: "PENDING" | "SENT" | "FAILED";
  /** ISO instant, or null when the send never completed. */
  sentAt: string | null;
  attemptCount: number;
  /** ISO instant the current attempt claimed the row; null on an unclaimed one. */
  lastAttemptAt: string | null;
};

/**
 * The claim TTL from `recap/send.ts`. A PENDING row older than this was orphaned
 * by a crashed invocation and the next cron tick reclaims it — so the copy must
 * stop saying "being sent right now".
 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

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

  switch (row.sendStatus) {
    case "SENT":
      return `Last recap sent for ${row.recapDay}.`;
    case "PENDING": {
      // Two different situations wear the same status. Inside the claim TTL the
      // send really is in flight; past it, the Worker died mid-send and the row
      // is waiting to be reclaimed. Reporting the second as the first is how a
      // stalled recap reads as healthy indefinitely (impl-review F6).
      const claimedAt = row.lastAttemptAt ? Date.parse(row.lastAttemptAt) : NaN;
      const stalled = Number.isNaN(claimedAt) || now.getTime() - claimedAt >= CLAIM_TTL_MS;
      return stalled
        ? `The recap for ${row.recapDay} stalled mid-send. SprintFlow will retry it within 15 minutes.`
        : `A recap for ${row.recapDay} is being sent right now.`;
    }
    case "FAILED":
      return row.attemptCount >= 3
        ? `The recap for ${row.recapDay} could not be delivered after 3 attempts. The next one is tomorrow.`
        : `The recap for ${row.recapDay} failed on attempt ${row.attemptCount}. SprintFlow will try again within 15 minutes.`;
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
