import { workingDaySet } from "@/lib/anomaly/rules/helpers";
import type { DayKey } from "@/lib/dashboard/day-bucket";

/**
 * Pure view logic for the team-days-off surface (S-23, FR-007). No React, no
 * DOM, no I/O — the same split as `absence-calendar-view.ts` /
 * `absence-editor.tsx`, and for the same reason: this project has no
 * component-test harness (no jsdom, no RTL), so any judgement a `.tsx` makes is
 * only testable once it is extracted here.
 */

/** The weekday codes the sprint cadence uses, indexed by `Date#getUTCDay()`. */
const WEEKDAY_BY_INDEX = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** One recorded day off, ready to render. */
export type TeamDayOffRow = {
  id: string;
  day: DayKey;
  label: string | null;
  /** `2026-08-05` → `Wed 5 Aug 2026`. */
  formatted: string;
  /**
   * True when the day is not one the team works anyway.
   *
   * Worth showing, not worth refusing: the lead may well record the whole
   * national calendar and only some of it lands on a working day. Saying so on
   * the row is what stops "I added a holiday and capacity did not move" from
   * reading as a bug — because it is not one, and
   * `countTeamDaysOffInclusive` deliberately does not count it either.
   */
  costsNothing: boolean;
};

/**
 * The weekday a `YYYY-MM-DD` day key falls on.
 *
 * Zone-free, exactly as in `rules/helpers.ts`: a calendar date's weekday is the
 * same fact everywhere. Midday UTC so no offset can push the parse onto a
 * neighbouring day.
 */
export function weekdayOfDayKey(dayKey: DayKey): string {
  return WEEKDAY_BY_INDEX[new Date(`${dayKey}T12:00:00Z`).getUTCDay()];
}

/**
 * `2026-08-05` → `Wed 5 Aug 2026`.
 *
 * Formatted in UTC from the day key itself, so the label never drifts to a
 * neighbouring day in the VIEWER's zone — which is not the team's zone and is
 * not what the row is about.
 */
export function formatDayOff(dayKey: DayKey): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dayKey}T12:00:00Z`));
}

/**
 * Stored rows → render rows, oldest first.
 *
 * Sorted here rather than relying on the store's `ORDER BY`: day keys are
 * `YYYY-MM-DD`, so the lexicographic compare is the chronological one, and a
 * list that is sorted wherever it is built cannot drift when a second caller
 * appears.
 */
export function toTeamDayOffRows({
  daysOff,
  workingDays,
}: {
  daysOff: { id: string; day: DayKey; label: string | null }[];
  /** The sprint's working weekdays; Mon–Fri when Jira told us nothing. */
  workingDays: readonly string[] | null | undefined;
}): TeamDayOffRow[] {
  // THROUGH `workingDaySet`, not a local fallback (S-30). This module used to
  // declare its own Mon–Fri constant and coalesce without S-28's intersection
  // guard, so under a non-canonical array every holiday here would render
  // `costsNothing: true` while the guarded engine still subtracted it — two
  // counters disagreeing, which is the exact failure `helpers.ts` and
  // `lessons.md` each already record once. The defect slept while nobody held a
  // pattern other than Mon–Fri; S-30 is what wakes it.
  const working = workingDaySet(workingDays);

  return [...daysOff]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) => ({
      id: d.id,
      day: d.day,
      label: d.label,
      formatted: formatDayOff(d.day),
      costsNothing: !working.has(weekdayOfDayKey(d.day)),
    }));
}

/**
 * A picker `Date` → the `YYYY-MM-DD` the wire and the column both use.
 *
 * Read from the LOCAL parts, because that is what the viewer clicked: the picker
 * hands back local midnight, and reading it in UTC would move a click made east
 * of Greenwich onto the previous day.
 */
export function pickerDateToDayKey(date: Date): DayKey {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A day key as the `Date` the picker wants back for its selection.
 *
 * Anchored at local MIDDAY: local midnight does not exist on some spring-forward
 * days, and a `Date` constructed there silently rolls to the next day.
 */
export function dayKeyToPickerDate(dayKey: DayKey): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}
