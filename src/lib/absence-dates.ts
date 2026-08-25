/**
 * Whole-day semantics for a recorded absence (S-08 / FR-010). PURE and DB-free.
 *
 * An absence is a DATE RANGE the owner picks on a calendar, but `absence.start_date`
 * and `absence.end_date` are `timestamp` columns. This module pins the mapping once
 * so the calendar, the store, the anomaly rules and the capacity reducer cannot
 * drift apart:
 *
 *   start_date = the FIRST instant of the first absent day
 *   end_date   = the LAST  instant of the last  absent day   (INCLUSIVE)
 *
 * Inclusive `end_date` is the contract a user expects: picking 5–9 May means being
 * away through the whole of the 9th, not until its first second.
 *
 * The zone is the team's `jira_project.time_zone`, resolved through the same
 * zone-aware family every other day axis in the app already uses
 * (`dashboard/day-bucket.ts`) — never `date-fns`, never server-local `Date` math.
 * A Warsaw day starts at 22:00Z the evening before; bucketing in UTC would move
 * the first two hours of every absence onto the wrong day.
 */

import {
  type DayKey,
  dayKeyInTimeZone,
  dayRangeInTimeZone,
} from "@/lib/dashboard/day-bucket";

/** The stored instant pair for an absence. */
export type AbsenceWindow = { startDate: Date; endDate: Date };

/** The inclusive day-key pair an absence covers. */
export type AbsenceDays = { startDay: DayKey; endDay: DayKey };

/**
 * The instants to persist for an absence covering `[startDay, endDay]` inclusive,
 * as observed in `timeZone`.
 */
export function absenceInstants(
  startDay: DayKey,
  endDay: DayKey,
  timeZone?: string | null,
): AbsenceWindow {
  return {
    startDate: dayRangeInTimeZone(startDay, timeZone).from,
    endDate: dayRangeInTimeZone(endDay, timeZone).to,
  };
}

/**
 * The inclusive day keys a stored window covers, as observed in `timeZone`.
 *
 * The inverse of `absenceInstants`: because `end_date` is the last instant of its
 * local day, reading it back through the same zone yields that day, not the next.
 */
export function absenceDayKeys(
  window: AbsenceWindow,
  timeZone?: string | null,
): AbsenceDays {
  return {
    startDay: dayKeyInTimeZone(window.startDate, timeZone),
    endDay: dayKeyInTimeZone(window.endDate, timeZone),
  };
}

/**
 * Does the absence share any instant with the closed range `[from, to]`?
 *
 * Both endpoints are inclusive on both sides, which is what the stored shape
 * demands: an absence ending at 21:59:59.999Z overlaps a window that begins on
 * exactly that instant. Zone-free on purpose — it compares instants, and both
 * sides were already resolved in the team's zone when they were built.
 */
export function overlaps(window: AbsenceWindow, from: Date, to: Date): boolean {
  return (
    window.startDate.getTime() <= to.getTime() &&
    window.endDate.getTime() >= from.getTime()
  );
}
