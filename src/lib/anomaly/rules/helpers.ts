import { type DayKey, enumerateDayKeys } from "@/lib/dashboard/day-bucket";
import type { WeekdayCode } from "@/lib/integrations/cadence";
import type { EffectiveThresholds } from "@/lib/anomaly/thresholds";
import type { DetectedAnomaly, SprintSnapshot } from "@/lib/anomaly/types";

/**
 * Shared pure utilities for the 8 detectors (S-06). No DB, no I/O. Kept in one
 * place so time math, roster lookups, category labels, and the working-day
 * calendar are consistent across rules.
 *
 * ELAPSED-TIME MEASUREMENT NO LONGER LIVES HERE (S-28). Every budget in the
 * engine is now denominated in WORKING hours and is measured by
 * `working-time.ts`, which imports this file's calendar (`workingDaySet`,
 * `weekdayOf`) rather than keeping a second copy. `hoursBetween` and
 * `daysBetween` below are raw wall-clock spans and remain correct for what
 * still wants one — a `detectedAt` delta, a display age — but a rule reaching
 * for one to check a threshold is the defect S-28 closed.
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
 * Count working days across a CLOSED range, resolved in the TEAM's zone.
 *
 * ONE INTENT SINCE S-28 (impl-review F5). There used to be two, sharing one
 * implementation: an exclusive-start `countWorkingDays` for
 * `TICKET_STATUS_AGING`, whose "day the ticket moved is not an elapsed day"
 * needed a half-open range, and this closed-range sibling for capacity and the
 * absence cost. S-28 moved every elapsed-time measurement onto
 * `working-time.ts`'s working-HOUR clock, which left the exclusive variant with
 * no caller at all. It was deleted rather than kept: an unread second counter is
 * the "two counters that disagree" failure `context/foundation/lessons.md`
 * records, with the disagreement guaranteed to go unnoticed.
 *
 * Both ends are counted. An absence from Monday to Friday costs 5 working days,
 * and a sprint's own working-day total is likewise closed. Mon→Fri is 5.
 *
 * WHY THE ZONE IS REQUIRED (and not optional): this used to bucket with
 * `setHours(0,0,0,0)` + `getDay()`, i.e. in whatever zone the server happened to
 * run in, while every dashboard day axis buckets in `jira_project.time_zone`
 * through `day-bucket.ts`. On Workers the server is UTC so the two agreed by
 * accident; a Warsaw team's absence would not. An unrecognized or absent zone
 * degrades to UTC via `safeZone`, never throws.
 *
 * `nonWorkingDays` is the team-wide day-off calendar (S-23, FR-007): the day keys
 * on which the WHOLE team is off. Declared as an empty seam in S-08 and filled in
 * by `team-day-off-store.ts`. Deriving these dates automatically from a country
 * is still S-17; this parameter is what that slice will populate.
 *
 * REQUIRED, not optional (impl-review F6 of S-08). It was optional, every caller
 * passed it, and the guarantee therefore rested on a grep rather than on the
 * compiler. An omission reads as "no holidays" and is silent. Pass an empty set
 * to mean "none".
 *
 * Falls back to Mon–Fri when `workingDays` is empty or carries no recognisable
 * weekday code (see {@link workingDaySet}). Day enumeration is capped by
 * `enumerateDayKeys` so a corrupt date cannot spin.
 */
export function countWorkingDaysInclusive(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): number {
  if (to < from) return 0;
  return countDays(from, to, workingDays, timeZone, nonWorkingDays);
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

/**
 * The team's working weekdays, defaulting to Mon–Fri when Jira told us nothing.
 *
 * EXPORTED for `working-time.ts` (S-28), which measures elapsed WORKING HOURS and
 * needs the identical calendar. A second copy of the Mon–Fri defaulting is the
 * exact "two counters that disagree" failure the doc block above and
 * `context/foundation/lessons.md` each already record once.
 */
export function workingDaySet(
  workingDays: readonly string[] | null | undefined,
): Set<string> {
  const fallback = new Set<string>(["MON", "TUE", "WED", "THU", "FRI"]);
  if (!workingDays || workingDays.length === 0) return fallback;

  // THE INTERSECTION IS THE POINT (impl-review F3), not the defaulting above it.
  // A stored array is only authoritative if `weekdayOf` can ever produce its
  // members, and `weekdayOf` emits exactly WEEKDAY_BY_INDEX. An array of
  // `["mon","tue",…]` or `["Monday",…]` matches nothing, so every day reads as
  // non-working and `workingHoursBetween` returns 0 for EVERY span, forever —
  // which silences the three time-based rules outright and collapses
  // SPRINT_AT_RISK's `hoursLeft` to 0, firing `todo_near_end` on day one of
  // every sprint. That reads as a quiet sprint with one nag, not as a stopped
  // clock, and it is `lessons.md`'s empty-result-reads-as-success shape again.
  //
  // Every writer is canonical today — `DEFAULT_CADENCE` and the cadence form
  // behind a zod enum, both funnelled through `resolveCadenceFor` — so this is a
  // guard against the NEXT writer of the pattern, not against today's.
  const known = new Set<string>(WEEKDAY_BY_INDEX);
  const recognised = new Set<string>(workingDays.filter((d) => known.has(d)));
  if (recognised.size > 0) return recognised;

  console.error(
    `[anomaly/helpers] the sprint's resolved working days carried no ` +
      `recognisable weekday code ` +
      `(${JSON.stringify(workingDays)}); expected ${JSON.stringify([...known])}. ` +
      `Falling back to Mon–Fri rather than treating every day as non-working`,
  );
  return fallback;
}

/** Shared iteration. Kept separate from its one caller so the day-key walk and
 *  the two exclusions stay in one place as more counters arrive. */
function countDays(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey> | undefined,
): number {
  const set = workingDaySet(workingDays);

  let count = 0;
  for (const dayKey of enumerateDayKeys(from, to, timeZone)) {
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
export function weekdayOf(dayKey: DayKey): WeekdayCode {
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
