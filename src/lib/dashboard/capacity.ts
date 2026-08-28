import { and, eq, gte, lte } from "drizzle-orm";

import { absence, teamMember } from "@/db/schema";
import { countWorkingDaysInclusive } from "@/lib/anomaly/rules/helpers";
import type { getDb } from "@/lib/db";
import { toFte } from "@/lib/fte";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";

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
   * The sprint's own working-day total.
   *
   * No longer a divisor — it is now a MULTIPLIER, and FR-022 puts it on screen
   * beside the capacity so the lead can see what the number was computed from.
   * It has been computed since S-08 and rendered nowhere, which is precisely why
   * a wrong divisor was invisible for as long as it was.
   */
  sprintWorkingDays: number;
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
}: {
  members: CapacityMember[];
  absences: CapacityAbsence[];
  sprintStart: Date;
  sprintEnd: Date;
  workingDays: readonly string[] | null | undefined;
  timeZone: string | null;
}): SprintCapacity {
  const sprintWorkingDays = countWorkingDaysInclusive(
    sprintStart,
    sprintEnd,
    workingDays,
    timeZone,
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
      absentWorkingDays += countWorkingDaysInclusive(from, to, workingDays, timeZone);
    }

    const available = Math.max(0, sprintWorkingDays - absentWorkingDays);
    adjustedMd += member.fte * available;
  }

  return { adjustedMd, nominalMd, sprintWorkingDays };
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
  if (!sprint?.startDate || !sprint.endDate) return null;

  const sprintStart = sprint.startDate;
  const sprintEnd = sprint.endDate;
  // Far edge of the "next window" the tab also draws.
  const lookahead = new Date(sprintEnd.getTime() + (sprintEnd.getTime() - sprintStart.getTime()));

  const [rows, absences, timeZone] = await Promise.all([
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
      workingDays: sprint.workingDays,
      timeZone,
    }),
    sprintStart,
    sprintEnd,
    timeZone,
    members: rosterMembers,
    absences,
  };
}
