import { and, eq, gte, lte } from "drizzle-orm";

import { absence, teamMember } from "@/db/schema";
import { countWorkingDaysInclusive } from "@/lib/anomaly/rules/helpers";
import type { getDb } from "@/lib/db";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";

/**
 * Sprint capacity (S-08, FR-010) — the third downstream effect of a recorded
 * absence, and `team_member.sp_capacity`'s first reader. Until now the roster
 * editor wrote that column and nothing read it.
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
  spCapacity: number | null;
  isActive: boolean;
};

export type CapacityAbsence = {
  teamMemberId: string;
  startDate: Date;
  endDate: Date;
};

export type SprintCapacity = {
  /** Team capacity after absences — the number the lead plans against. */
  adjustedSp: number;
  /** The same total with absences ignored, so the reduction is legible. */
  nominalSp: number;
  /**
   * Active members whose `sp_capacity` is unset.
   *
   * Surfaced rather than folded in, because a null is "not answered yet", never
   * zero. Reading it as zero would understate the team and the lead would have
   * no way to tell the number was wrong.
   */
  membersWithoutCapacity: number;
  /** The sprint's own working-day total — the divisor, and useful context. */
  sprintWorkingDays: number;
};

/**
 * Reduce roster + absences into the sprint's capacity.
 *
 * Each active member with a capacity contributes
 * `spCapacity × (available working days ÷ sprint working days)`.
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

  let adjustedSp = 0;
  let nominalSp = 0;
  let membersWithoutCapacity = 0;

  for (const member of members) {
    if (!member.isActive) continue;
    if (member.spCapacity == null) {
      membersWithoutCapacity += 1;
      continue;
    }

    nominalSp += member.spCapacity;

    // Nothing to divide by — and a sprint with no working days genuinely has no
    // capacity, so the reduced total is 0 while the ceiling above stays honest.
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
    adjustedSp += member.spCapacity * (available / sprintWorkingDays);
  }

  return { adjustedSp, nominalSp, membersWithoutCapacity, sprintWorkingDays };
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

  const [members, absences, timeZone] = await Promise.all([
    db
      .select({
        id: teamMember.id,
        name: teamMember.name,
        spCapacity: teamMember.spCapacity,
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

  return {
    capacity: computeSprintCapacity({
      members,
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
    members,
    absences,
  };
}
