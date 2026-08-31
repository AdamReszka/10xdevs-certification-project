import { overlaps } from "@/lib/absence-dates";
import { type DayKey, enumerateDayKeys } from "@/lib/dashboard/day-bucket";

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
