import { type DayKey, enumerateDayKeys } from "@/lib/dashboard/day-bucket";
import type { WeekdayCode } from "@/lib/integrations/cadence";
import type { EffectiveThresholds } from "@/lib/anomaly/thresholds";
import type { DetectedAnomaly, SprintSnapshot } from "@/lib/anomaly/types";

/**
 * Shared pure utilities for the 8 detectors (S-06). No DB, no I/O. Kept in one
 * place so time math, roster lookups, category labels, and the working-day
 * calendar (the `8_WORKING_DAYS` sentinel) are consistent across rules.
 */

/** Every detector has this shape: pure over the snapshot + effective config + an
 * injected clock, returning zero or more anomalies. */
export type Detector = (
  snapshot: SprintSnapshot,
  effective: EffectiveThresholds,
  now: Date,
) => DetectedAnomaly[];

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/** Clamp to [0,1] — magnitude guard so a runaway ratio never escapes the range. */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Human labels for the 5 workflow categories (used in descriptions/actions). */
export const CATEGORY_LABEL: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  CODE_REVIEW: "Code Review",
  TESTING: "Testing",
  DONE: "Done",
};

const WEEKDAY_BY_INDEX: WeekdayCode[] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
];

/**
 * Count working days between two instants, resolved in the TEAM's zone.
 *
 * TWO NAMED INTENTS, ONE IMPLEMENTATION (S-08). The boundary is explicit because
 * the two callers need different ones and the difference is a silent off-by-one:
 *
 *  - {@link countWorkingDays} counts days STRICTLY AFTER `from`, through `to`
 *    inclusive — a half-open range. `TICKET_STATUS_AGING` measures elapsed time
 *    since a movement, and the day the ticket moved is not an elapsed day.
 *    Mon→Fri is 4.
 *  - {@link countWorkingDaysInclusive} counts a CLOSED range, both ends included.
 *    An absence from Monday to Friday costs 5 working days, and a sprint's own
 *    working-day total is likewise closed. Mon→Fri is 5.
 *
 * WHY THE ZONE IS REQUIRED (and not optional): this used to bucket with
 * `setHours(0,0,0,0)` + `getDay()`, i.e. in whatever zone the server happened to
 * run in, while every dashboard day axis buckets in `jira_project.time_zone`
 * through `day-bucket.ts`. On Workers the server is UTC so the two agreed by
 * accident; a Warsaw team's absence would not. Two counters that disagree is a
 * failure mode `context/foundation/lessons.md` already records once — hence one
 * implementation, and a zone the caller cannot forget to pass. An unrecognized or
 * absent zone degrades to UTC via `safeZone`, never throws.
 *
 * `nonWorkingDays` is the team-wide day-off calendar (S-23, FR-007): the day keys
 * on which the WHOLE team is off. Declared as an empty seam in S-08 and filled in
 * by `team-day-off-store.ts`. Every production caller passes it — a public
 * holiday that is not a working day for capacity but still an ageing day for
 * `TICKET_STATUS_AGING` would be two counters disagreeing, which is the failure
 * `context/foundation/lessons.md` already records once. Deriving these dates
 * automatically from a country is still S-17; this parameter is what that slice
 * will populate.
 *
 * Falls back to Mon–Fri when `workingDays` is empty/absent. Day enumeration is
 * capped by `enumerateDayKeys` so a corrupt date cannot spin.
 */
export function countWorkingDays(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays?: ReadonlySet<DayKey>,
): number {
  if (to <= from) return 0;
  // Drop the first day: it is the day of `from`, which a half-open range excludes.
  return countDays(from, to, workingDays, timeZone, nonWorkingDays, 1);
}

/** The closed-range sibling of {@link countWorkingDays} — both ends counted. */
export function countWorkingDaysInclusive(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays?: ReadonlySet<DayKey>,
): number {
  if (to < from) return 0;
  return countDays(from, to, workingDays, timeZone, nonWorkingDays, 0);
}

/**
 * How many of a closed range's WORKING days `nonWorkingDays` removes (S-23).
 *
 * Not the size of the set, and not the number of its days inside the range: a
 * holiday landing on a Saturday costs the team nothing, and counting it would
 * put a "− 1 team day off" on screen next to a working-day total that never
 * moved. This counts only the days that would otherwise have been worked, which
 * is exactly the reduction `countWorkingDaysInclusive` applied.
 *
 * Exists so the availability panel can SHOW the reduction (FR-022) without
 * re-deriving the calendar, and without a second call that omits the set — an
 * omission that would read as the half-wiring this seam exists to prevent.
 */
export function countTeamDaysOffInclusive(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): number {
  if (to < from || nonWorkingDays.size === 0) return 0;

  const set = workingDaySet(workingDays);
  let count = 0;
  for (const dayKey of enumerateDayKeys(from, to, timeZone)) {
    if (!nonWorkingDays.has(dayKey)) continue;
    if (set.has(weekdayOf(dayKey))) count += 1;
  }
  return count;
}

/** The team's working weekdays, defaulting to Mon–Fri when Jira told us nothing. */
function workingDaySet(
  workingDays: readonly string[] | null | undefined,
): Set<string> {
  return new Set<string>(
    workingDays && workingDays.length > 0
      ? workingDays
      : ["MON", "TUE", "WED", "THU", "FRI"],
  );
}

/** Shared iteration. `skipFirst` is what separates the two boundary semantics. */
function countDays(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey> | undefined,
  skipFirst: 0 | 1,
): number {
  const set = workingDaySet(workingDays);

  let count = 0;
  for (const dayKey of enumerateDayKeys(from, to, timeZone).slice(skipFirst)) {
    if (nonWorkingDays?.has(dayKey)) continue;
    if (set.has(weekdayOf(dayKey))) count += 1;
  }
  return count;
}

/**
 * The weekday a `YYYY-MM-DD` day key falls on.
 *
 * Zone-free on purpose: a calendar date's weekday is the same fact everywhere —
 * 2026-08-17 is a Monday in Warsaw and in Los Angeles. The zone has already done
 * its job upstream, deciding WHICH day keys the instants map to.
 */
function weekdayOf(dayKey: DayKey): WeekdayCode {
  return WEEKDAY_BY_INDEX[new Date(`${dayKey}T12:00:00Z`).getUTCDay()];
}

/** Index team members by a key, skipping members whose key is null. */
export function indexBy<K extends string>(
  members: SprintSnapshot["teamMembers"],
  key: (m: SprintSnapshot["teamMembers"][number]) => string | null,
): Map<string, SprintSnapshot["teamMembers"][number]> {
  const map = new Map<string, SprintSnapshot["teamMembers"][number]>();
  for (const m of members) {
    const k = key(m);
    if (k) map.set(k, m);
  }
  return map;
}

/** Round to an integer for display in descriptions/actions. */
export function round(n: number): number {
  return Math.round(n);
}
