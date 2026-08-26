import { dayKeyInTimeZone, localTimeOfDay, type DayKey } from "@/lib/dashboard/day-bucket";

/**
 * "Should this owner get a recap on this tick?" (S-11, FR-018). PURE, so DST,
 * disabled settings and boundary minutes are exhaustively unit-testable.
 *
 * "AT OR AFTER", NOT "CROSSES" — an approved decision, and the reason this
 * predicate can be as permissive as it is. A missed cron tick, a Worker restart,
 * or a settings change at noon must still produce that day's recap rather than
 * silently losing it. Whether the day was ALREADY sent is deliberately not this
 * function's business: that is the database claim's job
 * (`unique(owner_id, recap_day)`), which is the only guard that survives a
 * restart mid-send anyway.
 *
 * ACCEPTED CONSEQUENCE: an owner who sets 08:00 and connects Jira at 14:00
 * receives a recap immediately rather than the next morning. Preferable to the
 * alternative, which loses the day entirely.
 */

export type RecapDueReason =
  | "due"
  | "disabled"
  | "before_send_time";

export type RecapDueResult = {
  due: boolean;
  /** The local calendar day the recap would be for. */
  dayKey: DayKey;
  reason: RecapDueReason;
};

export function isRecapDue({
  now,
  timeZone,
  sendHour,
  sendMinute,
  enabled,
}: {
  now: Date;
  timeZone: string | null;
  sendHour: number;
  sendMinute: number;
  enabled: boolean;
}): RecapDueResult {
  const dayKey = dayKeyInTimeZone(now, timeZone);
  if (!enabled) return { due: false, dayKey, reason: "disabled" };

  const { hour, minute } = localTimeOfDay(now, timeZone);
  // Compare as minutes-since-local-midnight so the hour and minute cannot be
  // compared independently — `(16, 05) >= (15, 30)` must be true even though
  // `05 < 30`.
  const nowMinutes = hour * 60 + minute;
  const sendMinutes = sendHour * 60 + sendMinute;

  return nowMinutes >= sendMinutes
    ? { due: true, dayKey, reason: "due" }
    : { due: false, dayKey, reason: "before_send_time" };
}
