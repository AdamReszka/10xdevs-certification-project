import {
  formatDayOff,
  weekdayOfDayKey,
} from "@/components/organisms/settings/team-days-off-view";
import { workingDaySet } from "@/lib/anomaly/rules/helpers";
import type { DayKey } from "@/lib/dashboard/day-bucket";
import type { ProposedHoliday } from "@/lib/holidays/proposal";

/**
 * Pure view logic for the holiday-calendar surface (S-17, FR-007). No React, no
 * DOM, no I/O — the same split as `team-days-off-view.ts`, and for the same
 * reason: this project has no component-test harness, so any judgement a `.tsx`
 * makes is only testable once it is extracted here.
 */

/** One proposed holiday, ready to render as a checkbox row. */
export type HolidayProposalRow = {
  day: DayKey;
  label: string;
  year: number;
  /** `2026-01-01` → `Thu, 1 Jan 2026`. */
  formatted: string;
  /**
   * True when the day is not one the team works anyway.
   *
   * SHOWN BEFORE THE LEAD APPROVES, not after. Two of Poland's fourteen always
   * fall on a Sunday and several more land on a weekend in any given year, so
   * without this the lead approves fourteen days, watches capacity drop by ten,
   * and has no way to tell that from an arithmetic error. Computed through the
   * SAME `workingDaySet` the engine uses (S-30), never a local Mon–Fri constant.
   */
  costsNothing: boolean;
};

/**
 * Proposed holidays → render rows, oldest first.
 *
 * Sorted here as well as in `holidayProposal`, for the reason `toTeamDayOffRows`
 * gives: a list that is sorted wherever it is built cannot drift when a second
 * caller appears.
 */
export function toHolidayProposalRows({
  proposed,
  workingDays,
}: {
  proposed: readonly ProposedHoliday[];
  /** The sprint's working weekdays; Mon–Fri when Jira told us nothing. */
  workingDays: readonly string[] | null | undefined;
}): HolidayProposalRow[] {
  const working = workingDaySet(workingDays);

  return [...proposed]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((p) => ({
      day: p.day,
      label: p.label,
      year: p.year,
      formatted: formatDayOff(p.day),
      costsNothing: !working.has(weekdayOfDayKey(p.day)),
    }));
}

/**
 * How many of the kept days will actually move the numbers.
 *
 * The honest headline for the approve button's neighbourhood: "14 days, 10 of
 * them working days" is the sentence that stops the capacity drop reading as a
 * bug.
 */
export function proposalImpact(rows: readonly HolidayProposalRow[]): {
  total: number;
  costing: number;
} {
  return {
    total: rows.length,
    costing: rows.filter((r) => !r.costsNothing).length,
  };
}

/**
 * What the review list is offering, in one sentence.
 *
 * Named per year rather than "this year", because the list genuinely spans two
 * of them when the active sprint crosses 31 December — and a lead approving
 * January's holidays in December needs to see that is what they are doing.
 */
export function proposalHeadline(rows: readonly HolidayProposalRow[]): string {
  const { total, costing } = proposalImpact(rows);
  if (total === 0) return "Nothing left to review — every day is already recorded.";

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const yearsLabel = years.join(" and ");
  const dayWord = total === 1 ? "public holiday" : "public holidays";
  const costingClause =
    costing === total
      ? "each one costs your team a working day"
      : `${costing} of them fall on days your team works`;

  return `${total} ${dayWord} in ${yearsLabel} — ${costingClause}.`;
}

/**
 * The sentence under the country picker.
 *
 * A ONE-ENTRY LIST NEEDS SAYING SO. Without it, a picker offering exactly one
 * country reads as a bug rather than as a boundary the product has not crossed
 * yet — and the lead of a team elsewhere is left wondering whether their pick
 * failed to load.
 */
export const COUNTRY_PICKER_HINT =
  "SprintFlow generates public holidays from your team's country. More " +
  "countries are coming; for now this is the list we have rules for. Whatever " +
  "you pick, nothing is recorded until you review the proposal and approve it.";

/** The approve button's two labels. */
export function approveButtonLabel(isSaving: boolean): string {
  return isSaving ? "Saving…" : "Approve selected days";
}

/**
 * What approving with nothing checked means, spelled out.
 *
 * A REAL AND MEANINGFUL ACTION, not an empty submit to be disabled: a team that
 * works every public holiday says so by keeping none, and the year is stamped
 * all the same. If the button were disabled here, that team would be re-offered
 * the whole calendar on every render forever.
 */
export function emptyApprovalHint(keptCount: number): string | null {
  if (keptCount > 0) return null;
  return (
    "You have unchecked everything. Approving records no days off and marks " +
    "these years as reviewed, so SprintFlow stops asking."
  );
}
