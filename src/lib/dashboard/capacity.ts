import { and, desc, eq, gt, gte, lte } from "drizzle-orm";

import { absence, teamMember, type SelectSprint } from "@/db/schema";
import {
  countTeamDaysOffInclusive,
  countWorkingDaysInclusive,
} from "@/lib/anomaly/rules/helpers";
import { type ResolvedCadence, resolveCadenceFor } from "@/lib/cadence-override";
import { type DayKey, dayKeyInTimeZone } from "@/lib/dashboard/day-bucket";
import { nextWindowAfter } from "@/lib/dashboard/next-window";
import type { getDb } from "@/lib/db";
import { toFte } from "@/lib/fte";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";
import { getNonWorkingDays } from "@/lib/team-day-off-store";
import { MAX_CADENCE_LENGTH_DAYS } from "@/lib/validations/roster";

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
  /**
   * The forecast window the availability tab's second grid draws (S-18): the
   * lead's resolved cadence length, starting the day after this sprint's last
   * day key.
   *
   * RESOLVED HERE rather than in the client component, because its length now
   * comes from a record only the server can read (`resolveCadenceFor`). Three
   * things then agree by construction instead of by coincidence: the grid, this
   * reader's forecast capacity, and the holiday-review horizon.
   */
  nextWindow: { from: Date; to: Date };
  /** The cadence the two above were resolved from, so callers that need it —
   *  the holiday horizon on the dashboard — do not re-read it. */
  cadence: ResolvedCadence;
  /**
   * The SAME reducer over {@link nextWindow} (S-18, FR-022). Costs no query: the
   * roster, the absences, the zone, the day-off calendar and the cadence are all
   * already in hand, and `computeSprintCapacity` is pure.
   *
   * It is a PROJECTION, not a measurement, and two of its three inputs degrade
   * past the sprint's end in the same direction — see
   * `next-window-capacity-view.ts`, which owns what the panel is allowed to
   * claim about it. The measurement sweep reads this field and persists nothing
   * from it: the forecast window has no Jira sprint id to key a record on.
   */
  nextWindowCapacity: SprintCapacity;
  /**
   * Does this account hold ANY absence, on any date, ending after the current
   * sprint's end (S-18)?
   *
   * NOT "how many absences fall inside the forecast window", and the difference
   * is what makes the notice readable. Zero absences in a fortnight is the
   * ordinary state of a 3–10-person team, so a notice keyed on that would be on
   * almost always — and it could not separate "checked, nobody is away" from
   * "nothing entered", because both render as zero.
   *
   * The distinction S-17 actually drew is account-level and UNBOUNDED BY DATE
   * ({@link SprintCapacity.calendarIsEmpty}), which is what makes an empty set
   * mean "this lead has never done the work". The same shape here is a fact
   * about the LEAD'S HABIT — has anything ever been recorded forward of the
   * running sprint — rather than about this particular fortnight's weather.
   *
   * "After the sprint's end" is decided on DAY KEYS in the team's zone, not on
   * the raw instants (impl-review F1): an absence recorded on the sprint's own
   * final day is stored as that day's last instant and would otherwise read as
   * forward.
   *
   * One `limit(1)` on the index the absence query already uses, joined to the
   * same fan-out because it depends only on `sprintEnd`.
   */
  hasForwardAbsence: boolean;
};

/**
 * Owner-scoped load for the availability tab. Returns null when the owner has no
 * sprint, or one without dates to bound the window.
 *
 * The absence read is shaped to the `(team_member_id, start_date, end_date)`
 * index — the only one `absence` has — and is bounded to this sprint plus the
 * longest forecast window the cadence resolver can produce.
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
  /**
   * A `Pick`, not the whole row (S-18): the function reads exactly these five
   * fields, and typing it for `SelectSprint` demanded a sprint row from every
   * caller — which no unstarted window can supply. A superset of
   * `resolveCadenceFor`'s own `Pick` (which has no `endDate`), so it stays
   * assignable there unchanged; both existing callers pass full rows.
   */
  sprint: Pick<
    SelectSprint,
    "jiraProjectId" | "jiraSprintId" | "startDate" | "endDate" | "lengthDays" | "startDay"
  >,
): Promise<CapacityReadResult | null> {
  if (!sprint.startDate || !sprint.endDate) return null;

  const sprintStart = sprint.startDate;
  const sprintEnd = sprint.endDate;
  // Far edge of any forecast window the cadence resolver can produce.
  //
  // NOT the window itself, deliberately, and the fan-out is why (plan-review
  // F4). Bounding on the resolved window would make the cadence read sequential
  // — and this function runs once per recomputable sprint inside the measurement
  // sweep's loop (`sweep.ts`), so a cron cycle over N sprints would go from N
  // round trips to 2N. `lessons.md` #3's surviving rule is one handle, ONE
  // fan-out. The editor's own ceiling bounds it, so nothing the window draws can
  // fall outside the loaded set, and the extra rows are inert:
  // `computeSprintCapacity` clips every absence to the window it is given, and
  // `buildAvailabilityGrid` filters to its own axis. At most a quarter's
  // absences per owner, on the index the query already uses.
  //
  // PLUS TWO DAYS OF SLACK (impl-review F2). The ceiling alone leaves a margin of
  // exactly zero at `lengthDays = 90`, and this is millisecond arithmetic over an
  // instant while the window is drawn in day keys: a DST fall-back inside the
  // window puts `sprintEnd + 90 days` an hour EARLIER in local terms, so an
  // absence starting on the window's last day can sit past the bound and vanish.
  // The symptom would be silent and one-directional — the row disappears and
  // `adjustedMd` rises — which is `lessons.md`'s narrowing-predicate rule, the
  // rule this constant exists to honour. Two days absorb every zone offset
  // (-12…+14) and both DST directions; the rows they add are inert like the rest.
  const lookahead = new Date(
    sprintEnd.getTime() + (MAX_CADENCE_LENGTH_DAYS + 2) * 24 * 60 * 60 * 1000,
  );

  const [rows, absences, forwardAbsence, timeZone, nonWorkingDays, cadence] =
    await Promise.all([
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
      // S-18: has this lead EVER recorded an absence past the running sprint?
      // Unbounded above on purpose — an absence starting six months out still
      // proves the habit, which is what the notice is about. Same
      // `(team_member_id, start_date, end_date)` index, same fan-out: it depends
      // only on `sprintEnd`, so it costs no extra round trip.
      //
      // THE LATEST END DATE, NOT AN EXISTENCE CHECK (impl-review F1). `gt` on the
      // raw instants cannot answer the question on its own: `absence.end_date` is
      // the LAST INSTANT of its local day (`absence-dates.ts`), while
      // `sprint.end_date` is Jira's arbitrary instant — 08:00Z on a typical
      // sprint. An absence recorded on the sprint's OWN final day therefore ends
      // at 23:59:59.999 local, satisfies `gt`, and would report a lead who has
      // recorded nothing forward as one who has — silencing the notice for
      // exactly the account it was written for. Taking the sprint's last day off
      // is an ordinary thing to record, not a corner case. The predicate below
      // stays as a cheap pre-filter (it can only over-select); the DAY KEYS in the
      // team's zone decide, once the zone this fan-out is also loading resolves.
      db
        .select({ endDate: absence.endDate })
        .from(absence)
        .where(and(eq(absence.ownerId, ownerId), gt(absence.endDate, sprintEnd)))
        .orderBy(desc(absence.endDate))
        .limit(1),
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

  const nextWindow = nextWindowAfter({
    sprintEnd,
    lengthDays: cadence.lengthDays,
    timeZone,
  });

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
    // Built AFTER the fan-out, from the length it resolved — pure arithmetic
    // over data already in hand, so it costs no query.
    nextWindow,
    cadence,
    // The SAME reducer, the SAME inputs, a different window. The absence set was
    // loaded to cover any window the resolver can produce, and the reducer clips
    // each absence to the window it is given, so nothing outside this one leaks
    // into the figure.
    nextWindowCapacity: computeSprintCapacity({
      members: rosterMembers,
      absences,
      sprintStart: nextWindow.from,
      sprintEnd: nextWindow.to,
      workingDays: cadence.workingDays,
      timeZone,
      nonWorkingDays,
    }),
    hasForwardAbsence:
      forwardAbsence[0] != null &&
      dayKeyInTimeZone(forwardAbsence[0].endDate, timeZone) >
        dayKeyInTimeZone(sprintEnd, timeZone),
  };
}
