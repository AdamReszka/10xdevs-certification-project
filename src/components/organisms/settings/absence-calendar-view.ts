import { absenceDayKeys, absenceInstants } from "@/lib/absence-dates";
import { type DayKey, enumerateDayKeys } from "@/lib/dashboard/day-bucket";
import type { AbsenceType } from "@/lib/validations/absence";

/**
 * Decision logic for the `/team/absences` editor. PURE — no React, no DB.
 *
 * WHY IT IS A SEPARATE FILE: there is no component-test harness in this project
 * (no jsdom, no RTL — `context/foundation/test-plan.md`), so anything the editor
 * *decides* is extracted here where a unit test can reach it, following the
 * `roster-merge.ts` / `inbox-controls.ts` precedent. The `.tsx` sibling keeps
 * only rendering and wiring.
 *
 * Day math goes through the zone-aware `day-bucket` family, never `date-fns` —
 * which is installed only because the `calendar` primitive depends on it. Two
 * idioms for the same problem is how day axes drift apart.
 */

/** One stored absence as the server component hands it to the client. */
export type StoredAbsence = {
  id: string;
  teamMemberId: string;
  type: AbsenceType;
  isPlanned: boolean;
  startDate: Date;
  endDate: Date;
};

/** A roster entry, reduced to what the editor needs to label a row. */
export type AbsenceMember = { id: string; name: string };

/** A stored absence resolved into the team's calendar days. */
export type AbsenceRow = {
  id: string;
  teamMemberId: string;
  memberName: string;
  type: AbsenceType;
  isPlanned: boolean;
  startDay: DayKey;
  endDay: DayKey;
  /** Every day the window covers, both ends included — what the grid marks. */
  days: DayKey[];
};

/** A window the user is currently editing, before it has been saved. */
export type CandidateWindow = {
  id?: string;
  teamMemberId: string;
  startDay: DayKey;
  endDay: DayKey;
};

const TYPE_LABELS: Record<AbsenceType, string> = {
  VACATION: "vacation",
  SICKNESS: "sickness",
  TRAINING: "training",
};

/**
 * Every calendar day from `startDay` to `endDay` inclusive, in the team's zone.
 *
 * Routed through the stored-instant conversion and `enumerateDayKeys` rather than
 * incremented as a string: the enumerator re-derives each label in the zone, so a
 * DST transition neither skips nor repeats a day.
 */
export function coveredDays(
  startDay: DayKey,
  endDay: DayKey,
  timeZone?: string | null,
): DayKey[] {
  const { startDate, endDate } = absenceInstants(startDay, endDay, timeZone);
  return enumerateDayKeys(startDate, endDate, timeZone);
}

/**
 * Resolve stored absences into rows the editor can render, ordered the way the
 * owner scans them: soonest first, then alphabetically within a day.
 */
export function toAbsenceRows({
  absences,
  members,
  timeZone,
}: {
  absences: StoredAbsence[];
  members: AbsenceMember[];
  timeZone?: string | null;
}): AbsenceRow[] {
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  return absences
    .map((a) => {
      const { startDay, endDay } = absenceDayKeys(a, timeZone);
      return {
        id: a.id,
        teamMemberId: a.teamMemberId,
        // A row whose member is missing is still the owner's data and still has
        // to be deletable — dropping it would hide it behind a roster edit.
        memberName: nameById.get(a.teamMemberId) ?? "Unknown member",
        type: a.type,
        isPlanned: a.isPlanned,
        startDay,
        endDay,
        days: coveredDays(startDay, endDay, timeZone),
      };
    })
    .sort(
      (a, b) =>
        a.startDay.localeCompare(b.startDay) || a.memberName.localeCompare(b.memberName),
    );
}

/**
 * Does the candidate window collide with one this member already has?
 *
 * ADVISORY ONLY — a client-side copy of the predicate the store enforces, so the
 * owner sees the problem before submitting. The authoritative check is
 * `assertNoOverlap` in `absence-store.ts`; this one is never load-bearing.
 *
 * Day keys are `YYYY-MM-DD`, so the lexicographic compare is the chronological one.
 */
export function hasClientOverlap(
  candidate: CandidateWindow,
  rows: AbsenceRow[],
): boolean {
  return rows.some(
    (row) =>
      row.teamMemberId === candidate.teamMemberId &&
      // The row being edited is not a collision with itself.
      row.id !== candidate.id &&
      row.startDay <= candidate.endDay &&
      row.endDay >= candidate.startDay,
  );
}

/**
 * The "planned" checkbox's starting state, derived from timing (D2).
 *
 * Planned-ness is TEMPORAL, not a property of the absence type: an absence the
 * team knew about before committing the sprint is planned; one that appears once
 * the sprint is running is the surprise `SPRINT_AT_RISK` exists to flag. An
 * absence starting ON the first day is already unplanned — the commitment was
 * made without it.
 *
 * The owner can always override; this only chooses the sensible default.
 */
export function defaultIsPlanned(
  startDay: DayKey,
  sprintStartDay: DayKey | null,
): boolean {
  if (!sprintStartDay) return true;
  return startDay < sprintStartDay;
}

/**
 * One sentence naming what a delete would destroy, for the confirmation dialog.
 *
 * The dialog has to NAME the thing (S-15's confirmation convention), and the
 * person + kind + days is what makes it unmistakable when someone has several.
 */
export function describeAbsence(row: AbsenceRow): string {
  return `${row.memberName} — ${TYPE_LABELS[row.type]}, ${formatWindow(row)}`;
}

/** Just the days — `5 May 2026 – 9 May 2026`, collapsed to one date for a single day. */
export function formatWindow(row: Pick<AbsenceRow, "startDay" | "endDay">): string {
  return row.startDay === row.endDay
    ? formatDay(row.startDay)
    : `${formatDay(row.startDay)} – ${formatDay(row.endDay)}`;
}

/**
 * The calendar cell the user clicked, as a day key.
 *
 * `react-day-picker` deals in BROWSER-LOCAL `Date`s, so this pair — and only
 * this pair — reads and writes local calendar fields directly instead of going
 * through `day-bucket`. Routing a picked cell through the TEAM's zone would be
 * wrong: a lead in Warsaw picking 5 May for a team zoned to Los Angeles is
 * recording 5 May, not the 4th. The team's zone enters exactly once, server-side,
 * when the day key becomes a stored instant (`absence-dates.ts`).
 */
export function pickerDateToDayKey(date: Date): DayKey {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A day key as the `Date` the picker wants back for its selected range.
 *
 * Anchored at local MIDDAY: local midnight does not exist on some spring-forward
 * days, and a `Date` constructed there silently rolls to the next day.
 */
export function dayKeyToPickerDate(dayKey: DayKey): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** `2026-05-05` → `5 May 2026`. Formatted in UTC from the day key itself, so the
 *  label never drifts to a neighbouring day in the viewer's own zone. */
function formatDay(dayKey: DayKey): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dayKey}T12:00:00Z`));
}
