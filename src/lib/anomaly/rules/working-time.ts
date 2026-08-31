import {
  type DayKey,
  dayKeyInTimeZone,
  dayRangeInTimeZone,
  enumerateDayKeys,
  localHourInstant,
} from "@/lib/dashboard/day-bucket";
import {
  MS_PER_HOUR,
  weekdayOf,
  workingDaySet,
} from "@/lib/anomaly/rules/helpers";
import { safeZone } from "@/lib/time-zone";

/**
 * Elapsed time measured in WORKING hours (S-28, FR-009/FR-013). PURE and DB-free.
 *
 * Every elapsed-time budget in the anomaly engine is a budget of time somebody
 * could have acted in. A 3 SP ticket moved to In Progress on Friday at 16:00 has
 * a 48 h budget; measured on the wall clock it fires on Sunday at 16:00, into the
 * Monday morning-sync inbox that FR-016 calls the product's headline surface,
 * having consumed nothing but a weekend. Measured here, the clock advances only
 * between {@link WORK_DAY_START_HOUR} and {@link WORK_DAY_END_HOUR} in the team's
 * zone, only on days in the sprint's RESOLVED working-day pattern (handed to
 * the rules as `SprintSnapshot.workingDays`), and never on a day the lead has
 * marked as a team-wide day off (S-23, FR-007).
 *
 * WHAT DOES NOT STOP THE CLOCK: an individual's recorded absence. The sprint is
 * the team's and the inbox is an alert for the lead, not a device pointed at a
 * person — a ticket left in Code Review does not become less stalled because its
 * assignee is on leave. This is the behaviour the engine already had; it is
 * recorded here as a decision rather than left as an accident.
 *
 * WHY ITS OWN FILE rather than `helpers.ts`: this is the only piece of the
 * engine's time math with a DST contract worth isolating, and it must sit under
 * `rules/` so `stryker.conf.json`'s mutate glob covers it. The working-day
 * CALENDAR is not duplicated — `workingDaySet` and `weekdayOf` are imported from
 * `helpers.ts`, because a second copy of the Mon–Fri defaulting is the exact "two
 * counters that disagree" failure `context/foundation/lessons.md` records.
 *
 * The window is a hard-coded constant, not configuration. Jira exposes no
 * working-hours field (PRD FR-007's own Socratic note), and a budget measured in
 * whole shifts is long enough that an hour either side of a person's real start
 * time cannot change which day the anomaly lands on.
 */

/** First wall-clock hour of the team's working day, in the team's zone. */
export const WORK_DAY_START_HOUR = 8;

/** Exclusive last wall-clock hour of the team's working day. */
export const WORK_DAY_END_HOUR = 16;

/**
 * One working day's worth of working hours.
 *
 * Exported so the fixture, the rules and the settings copy cannot disagree about
 * what "8 working hours" is worth: with the unit in working hours, FR-009's
 * "8 working days" bucket is 64 — an ordinary number, not a sentinel.
 */
export const WORK_HOURS_PER_DAY = WORK_DAY_END_HOUR - WORK_DAY_START_HOUR;

/** The `[start, end)` instants of one local day's working window. */
function workWindow(
  dayKey: DayKey,
  zone: string,
): { start: number; end: number } {
  return {
    start: localHourInstant(dayKey, WORK_DAY_START_HOUR, zone).getTime(),
    end: localHourInstant(dayKey, WORK_DAY_END_HOUR, zone).getTime(),
  };
}

/** A day the team could have worked: a working weekday that is not a day off. */
function isWorkingDay(
  dayKey: DayKey,
  days: ReadonlySet<string>,
  nonWorkingDays: ReadonlySet<DayKey>,
): boolean {
  return !nonWorkingDays.has(dayKey) && days.has(weekdayOf(dayKey));
}

/**
 * Working hours elapsed between two instants, resolved in the TEAM's zone.
 *
 * The sum, over the local days `[from, to]` touches, of each qualifying day's
 * overlap with `[from, to]` ∩ that day's `[08:00, 16:00)`. Nights, weekends and
 * team-wide days off contribute nothing. Returns 0 when `to <= from`.
 *
 * BOUNDED by wall-clock hours, MEASURED in elapsed real time (impl-review F6).
 * The day's window is found by reading the local clock — `localHourInstant`
 * binary-searches for 08:00 and 16:00 rather than adding to local midnight, which
 * is what makes it right across DST — but the contribution is then
 * `(hi - lo) / MS_PER_HOUR`, i.e. real milliseconds. The distinction is invisible
 * today: no IANA zone transitions between 08:00 and 16:00 local, so every window
 * measures 8. Were one ever to, this would return 7, not 8.
 *
 * That is stated precisely because an earlier draft of this comment claimed the
 * opposite — that the span reads as 8 "even though 7 hours of real time passed".
 * It does not, and the claim was dangerous rather than merely wrong: a future
 * reader "repairing" the code to match it would break the round-trip property
 * `shiftWorkingHours` depends on, since that function measures with the same
 * real-elapsed formula. The two must agree; which of the two readings they
 * agree on matters far less.
 *
 * `workingDays` falls back to Mon–Fri when Jira told us nothing, exactly as
 * `countWorkingDaysInclusive` does. An unrecognized or absent zone degrades to UTC via
 * `safeZone`; nothing here throws. Day enumeration is capped by
 * `enumerateDayKeys`, so a corrupt timestamp cannot spin.
 */
export function workingHoursBetween(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): number {
  if (to <= from) return 0;

  const zone = safeZone(timeZone);
  const days = workingDaySet(workingDays);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  let hours = 0;
  for (const dayKey of enumerateDayKeys(from, to, zone)) {
    if (!isWorkingDay(dayKey, days, nonWorkingDays)) continue;
    const { start, end } = workWindow(dayKey, zone);
    const lo = Math.max(fromMs, start);
    const hi = Math.min(toMs, end);
    if (hi > lo) hours += (hi - lo) / MS_PER_HOUR;
  }
  return hours;
}

/**
 * The instant a signed number of WORKING hours away from `from`.
 *
 * SIGNED, WITH NAMED WRAPPERS (the two-named-intents pattern `helpers.ts` already
 * uses for `countWorkingDays` / `countWorkingDaysInclusive`): negative walks
 * backwards, positive forwards, and no caller has to remember which direction a
 * negative means — see {@link workingHoursBefore} and {@link workingHoursAfter}.
 * The rules only need backwards; the demo fixture needs forwards. One
 * implementation is what stops the fixture and the detectors from disagreeing
 * about where a working hour is.
 *
 * The result is the inverse of {@link workingHoursBetween}: for a negative shift
 * `workingHoursBetween(result, from) === |hours|`, and for a positive one
 * `workingHoursBetween(from, result) === hours`, up to floating-point equality.
 *
 * TERMINATION: the walk is bounded by `maxDays` below. A calendar that cannot
 * supply the requested hours — every day marked off, a one-day working week, a
 * threshold typed with an extra zero — CLAMPS to that bound rather than spinning.
 * Detect runs on a request path; a hang there is worse than a stale boundary.
 */
export function shiftWorkingHours(
  from: Date,
  hours: number,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): Date {
  if (hours === 0) return new Date(from.getTime());

  const zone = safeZone(timeZone);
  const days = workingDaySet(workingDays);
  const backwards = hours < 0;
  let remaining = Math.abs(hours);

  // One whole week per working day needed covers even a team with a single
  // working weekday; the two extra weeks absorb a run of holidays on top.
  const maxDays = Math.ceil(remaining / WORK_HOURS_PER_DAY) * 7 + 14;

  let cursor = from.getTime();
  for (let stepped = 0; stepped < maxDays; stepped += 1) {
    const dayKey = dayKeyInTimeZone(new Date(cursor), zone);
    const dayRange = dayRangeInTimeZone(dayKey, zone);

    if (isWorkingDay(dayKey, days, nonWorkingDays)) {
      const { start, end } = workWindow(dayKey, zone);
      // The part of this day's window still ahead of the cursor, in the direction
      // of travel. On the first step the cursor sits inside the day; afterwards it
      // sits on the neighbouring day's boundary, so the whole window counts.
      const lo = backwards ? start : Math.max(cursor, start);
      const hi = backwards ? Math.min(cursor, end) : end;
      const available = hi > lo ? (hi - lo) / MS_PER_HOUR : 0;
      if (remaining <= available) {
        return new Date(
          backwards
            ? hi - remaining * MS_PER_HOUR
            : lo + remaining * MS_PER_HOUR,
        );
      }
      remaining -= available;
    }

    cursor = backwards
      ? dayRange.from.getTime() - 1
      : dayRange.to.getTime() + 1;
  }

  // THE CLAMP, AND WHY IT SPEAKS (impl-review F2). Falling out of the loop means
  // the calendar could not supply the hours asked for within `maxDays` — every
  // day in range was a weekend, a company day off, or outside `workingDays`. The
  // instant returned is then NOT `hours` away from `from`; it is as far as the
  // walk got, and it is shaped exactly like a successful answer.
  //
  // That matters because of the direction the failure takes. Both callers use
  // this to open a lookback window (`developer-inactive.ts`,
  // `ticket-no-commit-link.ts`), so a clamp WIDENS the window — the rule asks
  // "any commit since a month ago?" instead of "since two working days ago",
  // gets yes, and emits nothing. Silence reads as a healthy sprint. It is
  // reachable with ordinary FR-007 data: a four-week company shutdown recorded
  // as team-wide days off swallows a 16-working-hour lookback whole.
  //
  // `context/foundation/lessons.md` names this shape — an empty result that
  // reads as success — and its obligation (a) is that the operator log must
  // distinguish the cases. `thresholds.ts` honours it for a discarded override;
  // this honours it for an unsatisfiable calendar. The value is still returned:
  // a clamped window is a better answer than a thrown request, and the caller
  // has nothing better to do with the failure than the log already does.
  console.error(
    `[anomaly/working-time] the calendar could not supply ${Math.abs(hours)} working ` +
      `hours within ${maxDays} days of ${from.toISOString()} (zone ${zone}); ` +
      `${remaining} working hours short, so the window was clamped and any rule ` +
      `using it is measuring a WIDER span than it asked for`,
  );
  return new Date(cursor);
}

/**
 * The instant `hours` working hours BEFORE `to` — the backwards wrapper every
 * detector calls, so no rule spells a negative sign.
 *
 * Pass a non-negative count; a negative one walks forwards, which is
 * {@link workingHoursAfter}'s job.
 */
export function workingHoursBefore(
  to: Date,
  hours: number,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): Date {
  return shiftWorkingHours(to, -hours, workingDays, timeZone, nonWorkingDays);
}

/**
 * The instant `hours` working hours AFTER `from` — the forwards wrapper the demo
 * fixture places its sprint end with.
 */
export function workingHoursAfter(
  from: Date,
  hours: number,
  workingDays: readonly string[] | null | undefined,
  timeZone: string | null | undefined,
  nonWorkingDays: ReadonlySet<DayKey>,
): Date {
  return shiftWorkingHours(from, hours, workingDays, timeZone, nonWorkingDays);
}
