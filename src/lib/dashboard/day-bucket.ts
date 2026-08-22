/**
 * Calendar-day bucketing in the team's zone (S-10). PURE and DB-free.
 *
 * Every dashboard surface that has a day axis — the burndown series, the Dev ×
 * Day activity matrix, "yesterday" on Today — must agree on where a day starts.
 * Bucketing in UTC would put a 22:30 Warsaw commit on the following day and
 * shift the whole matrix by one column for half the team's working hours.
 *
 * The zone comes from `jira_project.time_zone` (nullable) and is resolved
 * through the shared `safeZone`, so an absent or unrecognized zone degrades to
 * UTC rather than throwing.
 */

import { safeZone } from "@/lib/time-zone";

/** `YYYY-MM-DD` in the team's zone. */
export type DayKey = string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The calendar day `date` falls on, as observed in `timeZone`.
 *
 * `en-CA` is the locale trick: it formats as `YYYY-MM-DD` natively, so no part
 * re-assembly is needed and the result sorts lexicographically.
 */
export function dayKeyInTimeZone(date: Date, timeZone?: string | null): DayKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * The instant range covering one local calendar day, as an inclusive
 * `[from, to]`.
 *
 * Callers that want "yesterday" cannot build this with UTC arithmetic: in
 * Warsaw, `2026-08-18T23:59:59Z` is already the 19th locally, so a naive
 * midnight-to-midnight-UTC range spills into the next column.
 *
 * The boundary is found by binary search rather than by probing on the hour,
 * because zone offsets are not all whole hours (Kolkata is +05:30, Kathmandu
 * +05:45) — an hourly probe would miss the true start by up to 59 minutes.
 * Day keys are `YYYY-MM-DD`, so the lexicographic compare the search relies on
 * is also the chronological one.
 */
export function dayRangeInTimeZone(
  dayKey: DayKey,
  timeZone?: string | null,
): { from: Date; to: Date } {
  const zone = safeZone(timeZone);
  const utcMidnight = new Date(`${dayKey}T00:00:00Z`).getTime();
  const HOUR = 60 * 60 * 1000;

  // Offsets span -12h…+14h, so the local day starts within [-14h, +12h] of UTC
  // midnight and ends within 24h of that. These bounds bracket both edges.
  const lo = utcMidnight - 18 * HOUR;
  const hi = utcMidnight + 38 * HOUR;

  /** Smallest t in (lo, hi] whose day key satisfies `reached`. */
  const firstWhere = (reached: (key: DayKey) => boolean): number => {
    let low = lo;
    let high = hi;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (reached(dayKeyInTimeZone(new Date(mid), zone))) high = mid;
      else low = mid + 1;
    }
    return low;
  };

  const from = firstWhere((k) => k >= dayKey);
  const nextDayStart = firstWhere((k) => k > dayKey);
  return { from: new Date(from), to: new Date(nextDayStart - 1) };
}

/**
 * The inclusive, ordered day axis from `start` to `end` in the team's zone.
 *
 * Walks in UTC-day steps and re-derives each key through `dayKeyInTimeZone`,
 * deduping as it goes: a DST shift can make two consecutive steps land on the
 * same local day (fall back) or skip none (spring forward), and stepping by a
 * fixed 24h is only used to advance the cursor, never to compute the label.
 * Returns `[]` when `end` precedes `start`.
 */
export function enumerateDayKeys(
  start: Date,
  end: Date,
  timeZone?: string | null,
): DayKey[] {
  if (end.getTime() < start.getTime()) return [];

  const zone = safeZone(timeZone);
  const keys: DayKey[] = [];
  const endKey = dayKeyInTimeZone(end, zone);

  let cursor = start;
  let guard = 0;
  // Guard: sprint ranges are weeks, not years. A pathological range (a bad
  // sprint end date from Jira) must not spin forever.
  const MAX_DAYS = 400;

  for (;;) {
    const key = dayKeyInTimeZone(cursor, zone);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (key >= endKey || ++guard > MAX_DAYS) break;
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }

  return keys;
}
