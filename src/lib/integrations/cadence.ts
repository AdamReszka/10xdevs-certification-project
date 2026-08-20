/**
 * Sprint-cadence derivation (S-04, FR-007). PURE and DB-free so the UTC→timezone
 * weekday math is unit-testable in isolation. Jira's Agile API gives us a sprint
 * `startDate`/`endDate` (ISO, treated as raw UTC) but no cadence fields — the
 * length, start-day, and working-days are DERIVED here.
 *
 * TIMEZONE (F3): `startDay` is the weekday of `startDate` AFTER converting UTC →
 * the Jira owner's IANA `timeZone`. Skipping the conversion yields off-by-one
 * weekdays whenever the sprint starts near midnight UTC (a sprint starting
 * `2026-08-17T00:00Z` — Monday UTC — is Sunday 17:00 in `America/Los_Angeles`).
 * When `timeZone` is absent or unrecognized we fall back to UTC rather than throw.
 */

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
 * conversion honors DST. Falls back to UTC when `timeZone` is missing or invalid
 * (an unknown zone makes `Intl` throw — we catch and retry in UTC).
 */
function weekdayInTimeZone(date: Date, timeZone?: string): WeekdayCode {
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
      date,
    );
  let short: string;
  try {
    short = format(timeZone && timeZone.length > 0 ? timeZone : "UTC");
  } catch {
    short = format("UTC");
  }
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
