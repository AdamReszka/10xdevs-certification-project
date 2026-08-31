import {
  type DayKey,
  dayKeyInTimeZone,
  dayRangeInTimeZone,
} from "@/lib/dashboard/day-bucket";

/**
 * The window immediately after the sprint (S-18, FR-010/FR-022). PURE — no
 * database, no clock — like every other module under `lib/dashboard/`.
 *
 * ONE DEFINITION, THREE CONSUMERS: the capacity reader, the holiday-review
 * horizon and the availability grid all have to mean the same fortnight, or the
 * number under the second grid describes days the grid does not draw.
 *
 * IT COMES FROM THE LEAD'S CADENCE, NOT FROM THE SPRINT'S OWN SPAN. The S-08
 * version lived in `availability-view.ts` and derived the length as
 * `sprintEnd − sprintStart` in milliseconds, justified by a comment saying the
 * cadence columns are "written by the Jira importer and read by nothing". S-29 /
 * S-30 / S-32 made that false: `resolveCadenceFor` now resolves a durable,
 * project-scoped, lead-owned length whose bottom tier is the same Jira-derived
 * number the ms-span rule was reading, cached at sync time. So this is a strict
 * superset of the old LENGTH SOURCE — and deliberately NOT of the old drawn
 * days, see below.
 *
 * IT STARTS ON THE NEXT DAY KEY, NOT ONE MILLISECOND LATER (S-08 impl-review
 * F1). Both windows render as calendar DAYS, and a real Jira sprint ends at an
 * arbitrary instant — `2026-08-28T08:00:00.000Z`, not end-of-day. Adding a
 * millisecond leaves the cursor on the same local day, so the sprint's final day
 * was drawn again as the first column of "next", and an absence on it was
 * painted in both grids. Resolving the boundary through the same zone-aware day
 * axis the grids use makes the overlap impossible by construction.
 *
 * IT DRAWS `lengthDays` DAYS, WHICH IS ONE FEWER THAN THE OLD RULE DREW. The
 * cadence editor's field is labelled "Sprint length (days)"
 * (`setup/cadence-fields.tsx`), so 14 means fourteen calendar days: `to` is
 * `from` plus `lengthDays − 1` day keys. A real Jira sprint ends at the same time
 * of day it starts, so `enumerateDayKeys(start, end)` draws BOTH boundary days
 * and the old ms-span window came out at `lengthDays + 1` columns. The extra day
 * is not reproduced: it would inflate the forecast capacity by one working day
 * per FTE, in the same direction as every other error this slice exists to
 * close. The visible consequence — "This sprint … over 11 working days" beside
 * "Next window … over 10 working days" for two nominally identical sprints — is
 * accepted, and named here so it is not rediscovered as a bug.
 *
 * DAY-KEY ARITHMETIC, NOT MILLISECOND ARITHMETIC: a DST transition inside the
 * window must not move either boundary, and `from + 13 × 86_400_000` does move
 * it by an hour in a zone that changes offset.
 */
export function nextWindowAfter({
  sprintEnd,
  lengthDays,
  timeZone,
}: {
  sprintEnd: Date;
  /** The RESOLVED cadence length (`resolveCadenceFor`), never the raw column. */
  lengthDays: number;
  timeZone: string | null;
}): { from: Date; to: Date } {
  const firstKey = addDayKeys(dayKeyInTimeZone(sprintEnd, timeZone), 1);
  // A cadence of 1 day is a one-day window: the last key IS the first one. The
  // resolver's own floor is 1 (`validations/roster.ts`), and `DEFAULT_CADENCE`
  // is 14, so a non-positive length cannot reach here — the clamp is what keeps
  // `to` from landing before `from` if one ever did.
  const lastKey = addDayKeys(firstKey, Math.max(1, lengthDays) - 1);

  return {
    from: dayRangeInTimeZone(firstKey, timeZone).from,
    to: dayRangeInTimeZone(lastKey, timeZone).to,
  };
}

/** `2026-08-28` + 1 → `2026-08-29`. Pure calendar arithmetic on the key itself,
 *  so no zone offset can shift it. */
function addDayKeys(dayKey: DayKey, days: number): DayKey {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
