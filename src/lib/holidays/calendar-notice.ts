import { holidaysForYear } from "@/lib/holidays";

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
 * true of the mechanism, both currently vacuous.
 *
 * THE COPY FOLLOWS `CADENCE_PROVENANCE.workingDays`' three beats — name the
 * missing input, name what it silently defaulted to, name the number it moves.
 * Every branch must mention BOTH the capacity figure and the aging budgets: one
 * calendar drives both, and a lead who reads this as "a capacity setting" will
 * skip it.
 *
 * ## The precedence is a table, not an accident
 *
 * Four conditions can be true at once, so the branch that wins is decided here
 * rather than discovered:
 *
 * | # | Condition | Result |
 * | - | --------- | ------ |
 * | 0 | `isDemo` | `null` |
 * | 1 | a country is set and we have no rules for any year asked about | `country_unavailable` |
 * | 2 | no country | `no_country` |
 * | 3 | a year asked about is not approved | `year_unapproved` |
 * | 4 | otherwise | `null` |
 *
 * **Row 0** — a demo visitor deliberately skipped configuration; an offer to
 * pick a country is a prompt to configure the tenant they chose not to
 * configure. It sits first so no later row can reach a demo screen.
 *
 * **Row 1** is reachable only if a code is dropped from `SUPPORTED_COUNTRIES`
 * after being stored. Without it the lead reviews an empty list and approves a
 * year with zero holidays — `lessons.md`'s narrowing-predicate failure exactly:
 * a wrong value narrowed into an empty result that reads as success.
 *
 * **Row 2 outranks the row count deliberately.** An account that typed holidays
 * by hand still has no jurisdiction, no recurrence and no answer for next
 * January, which is the state this slice exists to close. Its copy has to carry
 * the consequence: the offer is NOT a complaint about the rows they typed — the
 * proposal excludes every day already present, so accepting it adds only what
 * they are missing. Without that sentence the notice reads as a nag aimed at the
 * accounts that did the most work.
 *
 * ## Why there is no "your calendar is empty" branch any more
 *
 * Rows 2 and 3 between them catch every account that has not yet decided about
 * this year, so the only state left for an emptiness notice would be: a country
 * set, the year approved, and no rows — which is precisely a lead who picked
 * Poland, unchecked every day because their team works them, and approved.
 * Telling THAT account its numbers "assume nobody is ever off" aims the sentence
 * at the one person who verified the opposite. The APPROVAL RECORD, not the row
 * count, is what says the calendar was reviewed.
 */

export type HolidayCalendarNotice = {
  kind: "no_country" | "year_unapproved" | "country_unavailable";
  title: string;
  body: string;
};

export function holidayCalendarNotice(input: {
  /**
   * Is this a demo workspace? Row 0 of the table above — silence, whatever else
   * is true.
   */
  isDemo: boolean;
  /** The account's jurisdiction, or `null` when the lead has not picked one. */
  countryCode: string | null;
  /**
   * Every year the active sprint touches (`holidayYears`), so a sprint crossing
   * 31 December asks about both. Never derived in here from a clock.
   */
  years: readonly number[];
  /** Years already decided about UNDER `countryCode` (`listApprovedYears`). */
  approvedYears: ReadonlySet<number>;
  /**
   * Does the account hold NO team-wide day off at all, on any date?
   *
   * Not a branch of its own — see the header. It only chooses which half of the
   * `no_country` body is true: a lead with rows already typed must be told the
   * offer adds to them rather than replacing them.
   */
  calendarIsEmpty: boolean;
}): HolidayCalendarNotice | null {
  const { isDemo, countryCode, years, approvedYears, calendarIsEmpty } = input;

  // Row 0.
  if (isDemo) return null;

  // Row 1. Asked before the null check because a stored-but-unsupported code is
  // NOT the same state as no code at all, and the lead needs to be told which.
  if (
    countryCode !== null &&
    years.every((year) => holidaysForYear(countryCode, year).length === 0)
  ) {
    return {
      kind: "country_unavailable",
      title: "SprintFlow no longer has a holiday calendar for your country",
      body:
        `Your team is set to ${countryCode}, and this version of SprintFlow has ` +
        "no public-holiday rules for it — so nothing can be proposed, and your " +
        "capacity in man-days and your ticket and PR aging budgets are being " +
        "computed as though nobody is ever off. Pick a different country, or " +
        "record the days your whole team is off by hand.",
    };
  }

  // Row 2.
  if (countryCode === null) {
    return {
      kind: "no_country",
      title: "SprintFlow does not know where your team is",
      body:
        "Without a country there are no public holidays to work from, so every " +
        "day in your working pattern is counted as a full working day. That " +
        "assumption is in two numbers at once: your capacity in man-days, and " +
        "how fast tickets and PRs age before they are flagged. " +
        (calendarIsEmpty
          ? "Pick your country and SprintFlow will propose this year's public " +
            "holidays for you to review."
          : "Pick your country and SprintFlow will propose this year's public " +
            "holidays for you to review — the days you have already recorded " +
            "stay exactly as they are, and are not offered back to you."),
    };
  }

  // Row 3.
  const unapproved = years.filter((year) => !approvedYears.has(year));
  if (unapproved.length > 0) {
    const named = unapproved.join(" and ");
    return {
      kind: "year_unapproved",
      title:
        unapproved.length === 1
          ? `${named} has not been reviewed yet`
          : `${named} have not been reviewed yet`,
      body:
        "Your sprint runs across " +
        (unapproved.length === 1 ? "a year" : "years") +
        " whose public holidays you have not looked at, so those days are " +
        "currently counted as ordinary working days — in your capacity in " +
        "man-days and in how fast tickets and PRs age. Review what SprintFlow " +
        "proposes and approve the ones your team actually takes off.",
    };
  }

  // Row 4.
  return null;
}
