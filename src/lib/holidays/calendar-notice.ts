/**
 * What, if anything, SprintFlow should say about the team's working-day
 * calendar (S-17, FR-007/FR-009/FR-022). No React, no DOM, no I/O.
 *
 * WHY A MODULE AND NOT A TERNARY IN THE ORGANISM: two surfaces consume this
 * decision — the dashboard Availability panel and `/team/days-off` — and this
 * project has no component-test harness (no jsdom, no RTL; CLAUDE.md), so a
 * sentence assembled inside a `.tsx` is untestable. Same split, and the same
 * reason, as `absence-calendar-view.ts` and `cadence-editor-view.ts`.
 *
 * WHAT THE SENTENCE IS FOR. `getNonWorkingDays` reaches all five elapsed-time
 * anomaly rules (`anomaly/load-snapshot.ts`) and the man-day divisor
 * (`dashboard/capacity.ts`), and every one of them was wired by S-23 — but no
 * real account holds a single `team_day_off` row, so the whole mechanism runs
 * against an empty calendar and says nothing about it. `/team/days-off`
 * promises a recorded day "stops tickets ageing across it" and
 * `WORKING_TIME_HINT` asserts the clock never runs "on a company day off": both
 * true of the mechanism, both currently vacuous. Zero holidays is
 * indistinguishable from a verified-empty calendar, and only one of those two
 * deserves silence.
 *
 * THE COPY FOLLOWS `CADENCE_PROVENANCE.workingDays`' three beats — name the
 * missing input, name what it silently defaulted to, name the number it moves —
 * because that is the house pattern for a defaulted input the lead never chose.
 * It must mention BOTH the capacity figure and the aging budgets: one calendar
 * drives both, and a lead who reads it as "a capacity setting" will skip it.
 *
 * THE UNION IS DISCRIMINATED BY `kind` so later members can be added without
 * touching either call site's shape.
 */

export type HolidayCalendarNotice = {
  /** The account holds no team-wide day off at all. */
  kind: "empty";
  title: string;
  body: string;
};

/**
 * Decide whether to say anything about the working-day calendar.
 *
 * Returns `null` when the account holds any team day off — a calendar with rows
 * in it needs no disclosure, and the panel's existing "− N team days off already
 * subtracted" line is the honest report for that state.
 */
export function holidayCalendarNotice(input: {
  /**
   * Does the account hold ZERO team-wide days off, on any date?
   *
   * NOT "did this sprint lose any" — that is `SprintCapacity.teamDaysOff`, which
   * is zero both for an account with a full calendar and a holiday-free sprint
   * and for an account with no calendar at all. Those are the two states this
   * notice exists to separate, so the caller must pass the unwindowed fact
   * (`capacity.calendarIsEmpty`, or `daysOff.length === 0` on the page that
   * already holds the whole list).
   */
  calendarIsEmpty: boolean;
}): HolidayCalendarNotice | null {
  if (!input.calendarIsEmpty) return null;

  return {
    kind: "empty",
    title: "No public holidays are recorded",
    body:
      "SprintFlow has no team-wide days off for your team, so every day in your " +
      "working pattern is being counted as a full working day — public holidays " +
      "included. That assumption is in two numbers at once: your capacity in " +
      "man-days, and how fast tickets and PRs age before they are flagged. " +
      "Record the days your whole team is off and both follow your real calendar.",
  };
}
