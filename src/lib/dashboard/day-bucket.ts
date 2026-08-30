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
// One formatter per resolved zone, reused (impl-review F8). This is the hot path
// of the activity matrix — once per commit, twice per PR, once per review, and
// ~112 times per `dayRangeInTimeZone` binary search — and formatter construction
// dominates `.format()`. Keyed by the ALREADY-resolved zone, so every invalid
// input collapses onto the single "UTC" entry.
const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(resolvedZone: string): Intl.DateTimeFormat {
  let formatter = dayKeyFormatters.get(resolvedZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatters.set(resolvedZone, formatter);
  }
  return formatter;
}

export function dayKeyInTimeZone(date: Date, timeZone?: string | null): DayKey {
  return dayKeyFormatter(safeZone(timeZone)).format(date);
}

// Same cache-per-resolved-zone pattern as above, and for the same reason: the
// recap's send predicate runs once per owner per 15-minute tick, and formatter
// construction dominates `.format()`.
const timeOfDayFormatters = new Map<string, Intl.DateTimeFormat>();

function timeOfDayFormatter(resolvedZone: string): Intl.DateTimeFormat {
  let formatter = timeOfDayFormatters.get(resolvedZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: resolvedZone,
      hour: "2-digit",
      minute: "2-digit",
      // `h23` is load-bearing: without it midnight formats as `24:00` in some
      // locale/zone combinations, and `24 >= 15` would fire a 15:00 recap at
      // midnight.
      hourCycle: "h23",
    });
    timeOfDayFormatters.set(resolvedZone, formatter);
  }
  return formatter;
}

/**
 * The WALL-CLOCK hour and minute `date` shows in `timeZone` (S-11, FR-018).
 *
 * The tempting alternative — `dayRangeInTimeZone(today, tz).from + hour × 3_600_000`
 * — is WRONG on DST-transition days: local midnight plus 15h is 14:00 or 16:00
 * local, not 15:00, so an owner's recap would arrive an hour early or late twice
 * a year. Reading the wall clock directly is the only formulation that has no
 * such edge.
 *
 * Degrades to UTC through the shared `safeZone`, like every other helper here.
 */
export function localTimeOfDay(
  date: Date,
  timeZone?: string | null,
): { hour: number; minute: number } {
  const parts = timeOfDayFormatter(safeZone(timeZone)).formatToParts(date);
  const read = (type: "hour" | "minute"): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { hour: read("hour"), minute: read("minute") };
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

/**
 * The instant at which a given wall-clock hour begins on a given local day
 * (S-28, FR-009).
 *
 * Returns the EARLIEST instant inside `dayKey`'s local range whose local hour is
 * `>= hour`, and the day's exclusive end when the day holds no such instant.
 * "`>=`" rather than "`===`" is what makes the spring-forward gap answerable: on
 * 2026-03-29 in Warsaw the local clock steps 02:00 → 03:00, so hour 2 never
 * occurs and the honest answer for "when does 02:00 begin" is 03:00 local — the
 * first moment the team could have been working had the window started then.
 *
 * WHY NOT `dayRangeInTimeZone(dayKey, tz).from + hour × 3_600_000`: that is the
 * formulation {@link localTimeOfDay}'s own doc block records as WRONG. Local
 * midnight plus 8h is 07:00 or 09:00 local on a transition day, so a working-hours
 * window built that way would drift by an hour twice a year — on exactly the two
 * days a lead is least likely to check the arithmetic by hand.
 *
 * Found by binary search over {@link localTimeOfDay}'s reading, the same idiom
 * {@link dayRangeInTimeZone} uses over day keys, and for the same reason: zone
 * offsets are not all whole hours (Kathmandu is +05:45), so probing on the hour
 * would miss the true boundary by up to 59 minutes. The predicate is monotone
 * within a local day even across a fall-back — the wall clock repeats an hour
 * (…1, 2, 2, 3…) but never runs backwards past a lower hour — so the search is
 * well-defined on both transition days.
 *
 * Degrades to UTC through the shared `safeZone`, like every other helper here.
 */
// Same cache-per-resolved-zone rationale as the two formatter caches above, one
// level up: a single call is ~28 `formatToParts` on top of a `dayRangeInTimeZone`
// binary search, and the working-hours clock (S-28) asks for the SAME two hours
// on the same handful of local days once per ticket, per PR and per developer in
// a detect run. The answer is a pure function of (zone, day, hour), so a verdict
// is safe to keep for the isolate's lifetime.
const localHourInstants = new Map<string, number>();

export function localHourInstant(
  dayKey: DayKey,
  hour: number,
  timeZone?: string | null,
): Date {
  const zone = safeZone(timeZone);
  const cacheKey = `${zone}|${dayKey}|${hour}`;
  const cached = localHourInstants.get(cacheKey);
  if (cached !== undefined) return new Date(cached);

  const instant = computeLocalHourInstant(dayKey, hour, zone);
  localHourInstants.set(cacheKey, instant);
  return new Date(instant);
}

/** The uncached search. `zone` is ALREADY resolved by the caller. */
function computeLocalHourInstant(
  dayKey: DayKey,
  hour: number,
  zone: string,
): number {
  const { from, to } = dayRangeInTimeZone(dayKey, zone);
  const dayStart = from.getTime();
  // `to` is the last millisecond of the local day; callers want a half-open end.
  const dayEnd = to.getTime() + 1;

  // A local day can be empty when a zone skips a whole calendar date (Pacific/Apia
  // had no 2011-12-30). `dayRangeInTimeZone` then reports `to < from`; reading the
  // wall clock at `dayEnd - 1` would answer for the PREVIOUS day.
  if (dayEnd <= dayStart) return dayEnd;

  const reached = (t: number): boolean =>
    localTimeOfDay(new Date(t), zone).hour >= hour;

  if (!reached(dayEnd - 1)) return dayEnd;

  let low = dayStart;
  let high = dayEnd - 1;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (reached(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}
