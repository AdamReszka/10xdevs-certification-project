import { dayKeyInTimeZone } from "@/lib/dashboard/day-bucket";
import type { SprintCapacity } from "@/lib/dashboard/capacity";

/**
 * What the forecast window's capacity figure is ALLOWED to claim (S-18,
 * FR-010/FR-022). PURE — no React, no clock of its own.
 *
 * Same split as `capacity-adjustments-view.ts` and `calendar-notice.ts`, and for
 * the same reason: this repo has no component-test harness (no jsdom, no RTL;
 * CLAUDE.md), so a sentence assembled inside a `.tsx` is a sentence no test can
 * reach. Every string the block renders originates here.
 *
 * WHY THE CAVEAT IS UNCONDITIONAL. Two of the number's three inputs degrade past
 * the sprint's end and both degrade in the SAME direction, so there is no
 * offsetting term and the figure is systematically optimistic:
 *
 *  - **Unrecorded absences.** `absence` is free-dated, so nothing prevents
 *    forward entry — it simply is not done consistently (long holidays go in
 *    early, shorter ones and sickness do not). Every missing absence moves
 *    `adjustedMd` up.
 *  - **Unreviewed public holidays.** Closed by Phase 2 for the horizon, but a
 *    year that is reachable and still unapproved carries no `team_day_off` rows,
 *    so its holidays count as ordinary working days.
 *
 * It is also not a Jira sprint: no such row exists — `getActiveSprint`
 * hard-codes `state=active` — so the window is the team's cadence projected
 * forward, not a window anyone has committed to. FR-022's `Overridden`,
 * FR-023's `Corrected` and FR-024's withholding are the established convention:
 * a figure weaker than a measurement is LABELLED, never silently equalised.
 *
 * NO WITHHOLDING BRANCH, deliberately. A panel that stayed silent whenever
 * absence entry was incomplete would be silent almost always, and the slice
 * would not deliver the number it exists to deliver.
 */

export type NextWindowCapacityView = {
  /** Man-days after absences — the figure to show large. */
  md: number;
  /** The same total with absences ignored, or `null` when they did not reduce
   *  it, so the caller never renders "120 MD of 120 MD, after absences". */
  beforeAbsencesMd: number | null;
  /** The window's working-day count, on screen for the same reason FR-022 puts
   *  the sprint's there: it is what the figure was multiplied by. */
  workingDays: number;
  /** Working days the team-wide day-off calendar removed from this window. */
  teamDaysOff: number;
  /**
   * Is this window still ahead of the lead?
   *
   * A DECISION, NOT A CONSTANT (plan-review F3). The window is `sprintEnd + 1
   * day` unconditionally, and the sprint on screen is not always one that is
   * running: `getActiveSprintRow` falls back to the most-recently-STARTED sprint
   * when none is ACTIVE, and Jira can leave a sprint ACTIVE past its end date.
   * Between sprints, after a stalled sync or after a disconnect, the "next
   * window" is a fortnight that has already happened — and a figure badged
   * `Projected` would then assert the opposite of what is true, on the one
   * surface this slice exists to make honest. Same stale-sprint case S-17's
   * impl-review F1 already forced `holidayYears` to handle.
   */
  isProjected: boolean;
  /** Always present. Names both inflating terms in one sentence when the window
   *  is ahead; says the window is spent when it is not. */
  caveat: string;
  /** Non-null only when the account holds NO absence past the running sprint. */
  noForwardAbsencesNotice: string | null;
};

export function toNextWindowCapacityView({
  capacity,
  hasForwardAbsence,
  windowStart,
  now,
  timeZone,
}: {
  capacity: SprintCapacity;
  /** Has this lead EVER recorded an absence forward of the running sprint? A
   *  fact about their HABIT, not about this fortnight — see the reader. */
  hasForwardAbsence: boolean;
  windowStart: Date;
  /** Injected, like every other module here that reasons about time. */
  now: Date;
  timeZone: string | null;
}): NextWindowCapacityView {
  const { adjustedMd, nominalMd, sprintWorkingDays, teamDaysOff } = capacity;

  // Compared on DAY KEYS in the team's zone, not on instants: the window starts
  // at local midnight, so an instant comparison would call it "projected" for
  // the whole of its own first day.
  const isProjected =
    dayKeyInTimeZone(windowStart, timeZone) > dayKeyInTimeZone(now, timeZone);

  return {
    md: adjustedMd,
    beforeAbsencesMd: adjustedMd < nominalMd ? nominalMd : null,
    workingDays: sprintWorkingDays,
    teamDaysOff,
    isProjected,
    caveat: isProjected
      ? "Projected from your team's cadence, not from a sprint Jira has created — and absences beyond the current sprint may not all be recorded yet. This figure is more likely too high than too low."
      : "This window has already begun or ended, so the figure describes time that is spent rather than time you can promise. It follows the sprint on screen, which Jira has not replaced with a newer one.",
    noForwardAbsencesNotice: hasForwardAbsence
      ? null
      : "No absence anywhere on this account ends after the current sprint, so this figure has nothing to subtract — read it as a ceiling rather than a plan.",
  };
}
