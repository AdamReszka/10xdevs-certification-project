/**
 * Sprint-cadence derivation (S-04, FR-007). PURE and DB-free so the UTC→timezone
 * weekday math is unit-testable in isolation. Jira's Agile API gives us a sprint
 * `startDate`/`endDate` (ISO, treated as raw UTC) but no cadence fields — the
 * length, start-day, and working-days are DERIVED here.
 *
 * TIMEZONE (F3): `startDay` is the weekday of `startDate` AFTER converting UTC →
 * the Jira owner's IANA `timeZone`. Skipping the conversion yields off-by-one
 * weekdays whenever the sprint starts near midnight UTC. The zone resolution and
 * its UTC fallback live in `@/lib/time-zone` (shared with the S-10 dashboard
 * day-bucketing, which needs the identical rule).
 */

import { safeZone } from "@/lib/time-zone";

/** Weekday codes stored in `sprint.start_day` / `sprint.working_days` (jsonb). */
export type WeekdayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

/** Mon–Fri: the working-days default (Jira exposes no working-days field). */
export const DEFAULT_WORKING_DAYS: WeekdayCode[] = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
];

export type DerivedCadence = {
  lengthDays: number;
  startDay: WeekdayCode;
  workingDays: WeekdayCode[];
};

/**
 * What a reader substitutes when the sprint row's cadence columns are NULL.
 *
 * THIS MUST BE THE ONLY SPELLING OF THESE THREE VALUES (impl-review F2). All
 * three columns are nullable, and `saveCadence`'s dirty-check compares the
 * submitted cadence against the STORED one run through exactly these defaults —
 * so if a page prefilled a different number than the check normalises to, a lead
 * who confirmed without editing would score as having edited, and the account
 * would be frozen off FR-007's auto-pull. That is the S-29 defect one layer up.
 * Every reader spreads this constant rather than restating the literals; the
 * relationship is then a fact the compiler holds, not a promise in a comment.
 *
 * Spread `workingDays` at each use — the array is shared and callers hand it to
 * form state.
 */
export const DEFAULT_CADENCE: DerivedCadence = {
  lengthDays: 14,
  startDay: "MON",
  workingDays: [...DEFAULT_WORKING_DAYS],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `Intl`'s `en-US` short weekday → our code. */
const WEEKDAY_BY_SHORT: Record<string, WeekdayCode> = {
  Sun: "SUN",
  Mon: "MON",
  Tue: "TUE",
  Wed: "WED",
  Thu: "THU",
  Fri: "FRI",
  Sat: "SAT",
};

/**
 * Weekday of `date` as observed in `timeZone`. Uses `Intl.DateTimeFormat` so the
 * conversion honors DST; `safeZone` supplies the UTC fallback for a missing or
 * unrecognized zone.
 */
function weekdayInTimeZone(date: Date, timeZone?: string): WeekdayCode {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    weekday: "short",
  }).format(date);
  return WEEKDAY_BY_SHORT[short] ?? "MON";
}

/**
 * Derive cadence from a Jira active sprint's dates + the owner's timezone.
 * - `lengthDays` = day-rounded `endDate − startDate`, floored at 1.
 * - `startDay` = weekday of `startDate` in `timeZone` (UTC fallback).
 * - `workingDays` = the Mon–Fri default (no Jira source).
 */
export function deriveCadence({
  startDate,
  endDate,
  timeZone,
}: {
  startDate: Date | string;
  endDate: Date | string;
  timeZone?: string;
}): DerivedCadence {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);

  const lengthDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MS_PER_DAY),
  );

  return {
    lengthDays,
    startDay: weekdayInTimeZone(start, timeZone),
    workingDays: [...DEFAULT_WORKING_DAYS],
  };
}
