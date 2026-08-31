import { and, eq, gte, lte } from "drizzle-orm";

import { absence, teamMember, type SelectSprint } from "@/db/schema";
import {
  countTeamDaysOffInclusive,
  countWorkingDaysInclusive,
} from "@/lib/anomaly/rules/helpers";
import { resolveCadenceFor } from "@/lib/cadence-override";
import type { DayKey } from "@/lib/dashboard/day-bucket";
import type { getDb } from "@/lib/db";
import { toFte } from "@/lib/fte";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";
import { getNonWorkingDays } from "@/lib/team-day-off-store";

/**
 * Sprint capacity in MAN-DAYS (S-23, FR-010/FR-022) — the third downstream
 * effect of a recorded absence, and `team_member.fte`'s only reader.
 *
 * THE SHAPE CHANGED, NOT ONLY THE UNIT. The S-08 version computed
 * `spCapacity × (available ÷ sprintWorkingDays)` — a ratio that cancels the day
 * dimension, so a hand-entered story-point total came out the other side as a
 * story-point total. Man-days are `fte × availableWorkingDays`: the divisor
 * disappears, and the sprint's working-day count stops being an invisible
 * intermediate and becomes the thing the number is built from. FR-022 requires
 * it on screen next to the capacity for exactly that reason.
 *
 * Split the way every other dashboard module is (`aging.ts`): a PURE reducer that
 * a unit test can reach, plus an owner-scoped reader beside it.
 *
 * A STANDALONE READER, not an extension of `getBurndownSeries`: the availability
 * tab renders two member × day grids and one capacity number, and never draws a
 * series, so extending `burndown.ts` would make it pay for one it does not use.
 *
 * Working days come from the ONE counter (`countWorkingDaysInclusive`), on its
 * closed-range boundary: a sprint running Mon → Fri is 5 working days, and an
 * absence covering Mon → Fri costs 5, not 4.
 */

type Db = ReturnType<typeof getDb>;

export type CapacityMember = {
  id: string;
  /** Availability fraction, already converted from the driver's `numeric`
   *  string by the reader — see `lib/fte.ts`. */
  fte: number;
  isActive: boolean;
};

export type CapacityAbsence = {
  teamMemberId: string;
  startDate: Date;
  endDate: Date;
};

export type SprintCapacity = {
  /** Man-days after absences — the number the lead plans against. */
  adjustedMd: number;
  /** The same total with absences ignored, so the reduction is legible. */
  nominalMd: number;
  /**
   * The sprint's own working-day total, ALREADY NET of team-wide days off.
   *
   * No longer a divisor — it is now a MULTIPLIER, and FR-022 puts it on screen
   * beside the capacity so the lead can see what the number was computed from.
   * It has been computed since S-08 and rendered nowhere, which is precisely why
   * a wrong divisor was invisible for as long as it was.
   */
  sprintWorkingDays: number;
  /**
   * How many working days the team-wide day-off calendar removed from this
   * sprint (S-23, FR-007). Zero when the sprint spans no holiday, or when the
   * holidays it spans all fall on non-working weekdays.
   *
   * Reported separately from {@link sprintWorkingDays} rather than folded into
   * it, because the two answer different questions: the total is what the
   * capacity was multiplied by, and this is WHY that total is lower than the
   * calendar suggests. Without it, a holiday looks like an arithmetic error.
   */
  teamDaysOff: number;
  /**
   * Does the account hold NO team-wide day off at all, on any date (S-17,
   * FR-007)?
   *
   * A THIRD fact rather than a reading of {@link teamDaysOff}, because that one
   * cannot answer the question. `teamDaysOff` is zero for two different
   * accounts: one with a full calendar whose sprint happens to span no holiday,
   * and one that has never recorded a day off in its life. Only the second
   * deserves to be told that its capacity and its aging budgets assume nobody
   * is ever off; saying it to the first aims the sentence at the lead who
   * already did the work.
   *
   * Sound because the set it is derived from is UNBOUNDED BY DATE by
   * construction (`team-day-off-store.ts:93-97`), so an empty set means the
   * account holds no rows at all rather than "none in this window". Costs no
   * query — the reducer already receives the set.
   */
  calendarIsEmpty: boolean;
};

/**
 * There is no `membersWithoutCapacity` any more, deliberately.
 *
 * `sp_capacity` was nullable, so "nobody answered yet" was a state the panel had
 * to surface — a null read as 0 would have understated the team with no way for
 * the lead to tell. `fte` is NOT NULL with a default, so that state cannot
 * exist. What replaced it is a different problem in a different place: a value
 * the MIGRATION guessed, surfaced by the `/settings/team` banner via
 * `team_member.fte_confirmed_at`, not by this reducer.
 */

/**
 * Reduce roster + absences into the sprint's capacity in man-days.
 *
 * Each active member contributes `fte × available working days`, where
 * "available" is the sprint's working days minus the ones they are away for.
 *
 * No `now` parameter, deliberately, though the house convention injects one:
 * capacity is a property of the WHOLE sprint, not of the moment it is read, so a
 * clock here would be an unused input that invites a future reader to assume the
 * number is "remaining capacity". It is not.
 */
export function computeSprintCapacity({
  members,
  absences,
  sprintStart,
  sprintEnd,
  workingDays,
  timeZone,
  nonWorkingDays,
}: {
  members: CapacityMember[];
  absences: CapacityAbsence[];
  sprintStart: Date;
  sprintEnd: Date;
  workingDays: readonly string[] | null | undefined;
  timeZone: string | null;
  /**
   * Days the WHOLE team is off (S-23, FR-007). REQUIRED, not optional: an
   * omission here would silently keep the old, holiday-blind number, and the
   * caller would have no way to tell. Pass an empty set to mean "none".
   */
  nonWorkingDays: ReadonlySet<DayKey>;
}): SprintCapacity {
  const sprintWorkingDays = countWorkingDaysInclusive(
    sprintStart,
    sprintEnd,
    workingDays,
    timeZone,
    nonWorkingDays,
  );
  const teamDaysOff = countTeamDaysOffInclusive(
    sprintStart,
    sprintEnd,
    workingDays,
    timeZone,
    nonWorkingDays,
  );

  const byMember = new Map<string, CapacityAbsence[]>();
  for (const a of absences) {
    byMember.set(a.teamMemberId, [...(byMember.get(a.teamMemberId) ?? []), a]);
  }

  let adjustedMd = 0;
  let nominalMd = 0;

  for (const member of members) {
    if (!member.isActive) continue;

    nominalMd += member.fte * sprintWorkingDays;

    // A sprint with no working days genuinely has no capacity. The guard is kept
    // from the S-08 version even though nothing divides any more: without it the
    // absence loop below would run to produce a guaranteed zero, and the ceiling
    // above stays honest at 0 either way.
    if (sprintWorkingDays === 0) continue;

    // Summing is safe because the store rejects overlapping windows for one
    // member, so no day can be subtracted twice.
    let absentWorkingDays = 0;
    for (const a of byMember.get(member.id) ?? []) {
      // Clipped to the sprint: a three-week holiday costs this sprint at most
      // this sprint.
      const from = a.startDate > sprintStart ? a.startDate : sprintStart;
      const to = a.endDate < sprintEnd ? a.endDate : sprintEnd;
      // The same `nonWorkingDays` the sprint total used. Passing it here is what
      // stops a public holiday INSIDE someone's vacation from being subtracted
      // twice — once as a day the sprint never had, once as a day they were away.
      absentWorkingDays += countWorkingDaysInclusive(
        from,
        to,
        workingDays,
        timeZone,
        nonWorkingDays,
      );
    }

    const available = Math.max(0, sprintWorkingDays - absentWorkingDays);
    adjustedMd += member.fte * available;
  }

  return {
    adjustedMd,
    nominalMd,
    sprintWorkingDays,
    teamDaysOff,
    calendarIsEmpty: nonWorkingDays.size === 0,
  };
}

export type CapacityReadResult = {
  capacity: SprintCapacity;
  sprintStart: Date;
  sprintEnd: Date;
  timeZone: string | null;
  members: (CapacityMember & { name: string })[];
  absences: CapacityAbsence[];
};

/**
 * Owner-scoped load for the availability tab. Returns null when the owner has no
 * sprint, or one without dates to bound the window.
 *
 * The absence read is shaped to the `(team_member_id, start_date, end_date)`
 * index — the only one `absence` has — and is bounded to the two windows the tab
 * renders: this sprint, and the next window of the same length.
 */
export async function getSprintCapacity(
  db: Db,
  ownerId: string,
): Promise<CapacityReadResult | null> {
  const sprint = await getActiveSprintRow(db, ownerId);
  if (sprint === null) return null;
  return getSprintCapacityFor(db, ownerId, sprint);
}

/**
 * The same load for an ARBITRARY sprint row.
 *
 * Split out for S-23 Phase 4: {@link getSprintCapacity} was pinned to
 * `getActiveSprintRow`, so no function in the system could answer "what was the
 * capacity of the sprint that just closed?" — and the measurement sweep exists
 * precisely to ask that, sometimes days late. Returns null for a sprint without
 * both dates: a window that cannot be bounded has no working-day count, and an
 * unbounded guess is worse than no measurement (FR-023).
 */
export async function getSprintCapacityFor(
  db: Db,
  ownerId: string,
  sprint: SelectSprint,
): Promise<CapacityReadResult | null> {
  if (!sprint.startDate || !sprint.endDate) return null;

  const sprintStart = sprint.startDate;
  const sprintEnd = sprint.endDate;
  // Far edge of the "next window" the tab also draws.
  const lookahead = new Date(sprintEnd.getTime() + (sprintEnd.getTime() - sprintStart.getTime()));

  const [rows, absences, timeZone, nonWorkingDays, cadence] = await Promise.all([
    db
      .select({
        id: teamMember.id,
        name: teamMember.name,
        fte: teamMember.fte,
        isActive: teamMember.isActive,
      })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId))
      .orderBy(teamMember.name),
    db
      .select({
        teamMemberId: absence.teamMemberId,
        startDate: absence.startDate,
        endDate: absence.endDate,
      })
      .from(absence)
      .where(
        and(
          eq(absence.ownerId, ownerId),
          lte(absence.startDate, lookahead),
          gte(absence.endDate, sprintStart),
        ),
      ),
    getJiraTimeZone(db, ownerId),
    // The team-wide day-off calendar (S-23, FR-007). Loaded here rather than
    // inside the reducer for the same reason the zone is: the reducer is pure.
    getNonWorkingDays({ db, ownerId }),
    // S-30 (FR-007): the working-day pattern the LEAD chose. ONE call covers
    // both callers of this function — the dashboard and the measurement sweep —
    // and it is the sweep that makes the resolver's `start_date <=` ordering
    // load-bearing: an unfinalized closed sprint is recomputed on every cycle,
    // so a later record must not reach back over it.
    resolveCadenceFor(db, ownerId, sprint),
  ]);

  // The driver hands `numeric` back as a string. Converting once, HERE, is what
  // keeps every consumer of this reader — the reducer and the tab's grids alike
  // — from having to remember (`lib/fte.ts`).
  const rosterMembers = rows.map((m) => ({ ...m, fte: toFte(m.fte) }));

  return {
    capacity: computeSprintCapacity({
      members: rosterMembers,
      // Only this sprint's window feeds the capacity number; the reader pulls a
      // wider range because the tab's second grid needs it.
      absences,
      sprintStart,
      sprintEnd,
      workingDays: cadence.workingDays,
      timeZone,
      nonWorkingDays,
    }),
    sprintStart,
    sprintEnd,
    timeZone,
    members: rosterMembers,
    absences,
  };
}
