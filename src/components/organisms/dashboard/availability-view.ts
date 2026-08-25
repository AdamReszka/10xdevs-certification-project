import { overlaps } from "@/lib/absence-dates";
import {
  type DayKey,
  dayKeyInTimeZone,
  dayRangeInTimeZone,
  enumerateDayKeys,
} from "@/lib/dashboard/day-bucket";

/**
 * Grid logic for the Dashboard "Today" availability tab (S-08). PURE — no React.
 *
 * Same split as `activity-matrix-view.ts`: the `.tsx` renders, this decides. The
 * day axis reuses the zone-aware `enumerateDayKeys` every other grid in the app
 * shares, so the availability columns line up with the activity matrix's.
 */

export type AvailabilityMember = { id: string; name: string; isActive: boolean };

export type AvailabilityAbsence = {
  teamMemberId: string;
  startDate: Date;
  endDate: Date;
};

export type AvailabilityRow = {
  memberId: string;
  memberName: string;
  /** The days of THIS window the member is away. Empty ⇒ around all window. */
  absentDays: Set<DayKey>;
};

export type AvailabilityGrid = {
  days: DayKey[];
  rows: AvailabilityRow[];
};

/**
 * The window immediately after the sprint, of the same length.
 *
 * Derived from the sprint's OWN dates rather than from `sprint.length_days` /
 * `start_day`: those cadence columns are written by the Jira importer and read by
 * nothing, so they carry no test coverage and no guarantee of agreeing with the
 * dates the sprint actually ran on.
 *
 * IT STARTS ON THE NEXT DAY KEY, NOT ONE MILLISECOND LATER (impl-review F1). Both
 * windows are rendered as calendar DAYS, and a real Jira sprint ends at an
 * arbitrary instant — `2026-08-28T08:00:00.000Z`, not end-of-day. Adding a
 * millisecond to that leaves the cursor on the same local day, so the sprint's
 * final day was drawn again as the first column of "next", and an absence on it
 * was painted in both grids. Resolving the boundary through the same zone-aware
 * day axis the grids use makes the overlap impossible by construction.
 */
export function nextWindowAfter(
  sprintStart: Date,
  sprintEnd: Date,
  timeZone: string | null,
): { from: Date; to: Date } {
  const from = dayRangeInTimeZone(
    nextDayKey(dayKeyInTimeZone(sprintEnd, timeZone)),
    timeZone,
  ).from;
  const length = sprintEnd.getTime() - sprintStart.getTime();
  return { from, to: new Date(from.getTime() + length) };
}

/** `2026-08-28` → `2026-08-29`. Pure calendar arithmetic on the key itself, so no
 *  zone offset can shift it. */
function nextDayKey(dayKey: DayKey): DayKey {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the member × day grid for one window.
 *
 * Only ACTIVE members get a row — a deactivated person is not part of the team's
 * availability picture. A member who is never away keeps an empty row: that IS
 * the "around all window" signal, and dropping it would leave the grid unreadable
 * as a team view.
 */
export function buildAvailabilityGrid({
  members,
  absences,
  from,
  to,
  timeZone,
}: {
  members: AvailabilityMember[];
  absences: AvailabilityAbsence[];
  from: Date;
  to: Date;
  timeZone: string | null;
}): AvailabilityGrid {
  const days = enumerateDayKeys(from, to, timeZone);
  const dayIndex = new Set(days);

  const rows: AvailabilityRow[] = members
    .filter((m) => m.isActive)
    .map((m) => ({ memberId: m.id, memberName: m.name, absentDays: new Set<DayKey>() }));
  const rowById = new Map(rows.map((r) => [r.memberId, r]));

  for (const a of absences) {
    const row = rowById.get(a.teamMemberId);
    if (!row) continue;
    if (!overlaps(a, from, to)) continue;

    // Enumerated over the absence's own instants, then filtered to the axis:
    // marking a day the grid does not draw would claim coverage it cannot show.
    for (const day of enumerateDayKeys(a.startDate, a.endDate, timeZone)) {
      if (dayIndex.has(day)) row.absentDays.add(day);
    }
  }

  return { days, rows };
}
