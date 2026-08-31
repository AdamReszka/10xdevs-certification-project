import { dayKeyInTimeZone, type DayKey } from "@/lib/dashboard/day-bucket";
import { holidaysForYear } from "@/lib/holidays";

/**
 * What to offer the lead, and — more importantly — what NOT to offer (S-17,
 * FR-007). Pure: no database, no clock of its own.
 *
 * THE RULE THAT STOPS A RESURRECTION LIVES HERE, and it is one line: a year in
 * `approvedYears` contributes NOTHING. Not "contributes the days that are
 * missing" — nothing at all. An approved year is closed, so a derived holiday
 * the lead deleted afterwards, because their team works that day, is never
 * offered again. `team_day_off.source` could not have done this job: a deleted
 * row leaves no provenance behind to consult.
 *
 * WHICH YEARS ARE ASKED ABOUT COMES FROM THE CALLER, never from `new Date()` in
 * here — the same discipline as every other module in this repo that reasons
 * about time.
 */

export type ProposedHoliday = {
  /** The year this day belongs to — carried so a two-year proposal can be
   *  approved as two independent stamps in one transaction. */
  year: number;
  day: DayKey;
  label: string;
};

/**
 * The years a proposal must cover: TODAY'S year, plus every year the sprint
 * window touches.
 *
 * NOT JUST THE YEAR `now` FALLS IN, and the difference is a guaranteed annual
 * failure rather than an edge case. In mid-December the current year is approved,
 * so a single-year proposal is empty and every surface goes quiet — while the
 * sprint runs on into January and its capacity divisor and all five aging budgets
 * count 1 and 6 January as ordinary working days. "On 2027-01-01 the question
 * answers itself" is true, and it answers itself one to three weeks after the
 * lead committed to that sprint.
 *
 * AND NOT JUST THE SPRINT'S YEARS EITHER (impl-review F1). The callers feed this
 * `getActiveSprintRow`, whose rule is "prefer the ACTIVE sprint; ELSE the
 * most-recently-started one" — so between sprints, after a stalled sync, or after
 * a disconnect that left the last synced sprint behind, the window belongs to a
 * sprint that is over. Taking it alone reproduced the very failure the paragraph
 * above exists to prevent, one level up: a team whose last sprint ended in
 * December 2026, opening the dashboard on 5 January 2027, was asked about 2026 —
 * already approved — and told nothing, while 1 and 6 January went on counting as
 * ordinary working days.
 *
 * `now` IS THEREFORE UNCONDITIONAL, not a fallback. The union is monotonic: a
 * sprint spanning today already contributes today's year, so this adds a year in
 * exactly the stale case and in no other. The module still owns no clock — `now`
 * is a parameter, as it was.
 *
 * Read in the TEAM's zone, so a sprint ending just after midnight UTC on 1
 * January is not silently attributed to the wrong year.
 */
export function holidayYears({
  sprintStart,
  sprintEnd,
  now,
  timeZone,
}: {
  sprintStart: Date | null;
  sprintEnd: Date | null;
  now: Date;
  timeZone: string | null;
}): number[] {
  const dates = [now, ...(sprintStart && sprintEnd ? [sprintStart, sprintEnd] : [])];
  const years = dates.map((d) => Number(dayKeyInTimeZone(d, timeZone).slice(0, 4)));
  return [...new Set(years)].sort((a, b) => a - b);
}

/**
 * The days to put in front of the lead for review.
 *
 * Two subtractions, and they are not the same subtraction:
 *
 *  - **An approved year is skipped whole**, which is what keeps a deleted
 *    holiday deleted.
 *  - **Within an unapproved year, days already recorded are omitted**, so a date
 *    the lead typed by hand is never offered back to them. Their label and their
 *    `'manual'` provenance survive untouched, because the row is never rewritten.
 *
 * An unknown country yields `[]` from {@link holidaysForYear} rather than a
 * throw; the caller must not read that as "nothing to do" — see
 * `calendar-notice.ts`'s `country_unavailable` branch.
 */
export function holidayProposal({
  countryCode,
  years,
  approvedYears,
  existingDays,
}: {
  countryCode: string;
  years: readonly number[];
  approvedYears: ReadonlySet<number>;
  /** Every day key already on the account, from `getNonWorkingDays`. */
  existingDays: ReadonlySet<DayKey>;
}): ProposedHoliday[] {
  const proposed: ProposedHoliday[] = [];

  for (const year of years) {
    if (approvedYears.has(year)) continue;

    for (const holiday of holidaysForYear(countryCode, year)) {
      if (existingDays.has(holiday.day)) continue;
      proposed.push({ year, day: holiday.day, label: holiday.label });
    }
  }

  return proposed.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
