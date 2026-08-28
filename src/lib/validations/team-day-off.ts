import { z } from "zod";

/**
 * Shared zod schemas for team-wide days off (S-23, FR-007/FR-022). Centralized
 * like `validations/absence.ts` so the client form and the server-side
 * re-validation agree on one source of truth, and — like it — free of any
 * server-only import so the client form can pull these without dragging Node
 * globals into the browser bundle.
 *
 * WHAT DOES **NOT** LIVE HERE: duplicate-date rejection. "Is this day already
 * recorded for this owner?" is a database question, answered by the
 * `unique(owner_id, day)` constraint the store's idempotent insert relies on —
 * which also makes it unbypassable by a crafted payload.
 */

/**
 * A calendar day as `YYYY-MM-DD`.
 *
 * The same shape `validations/absence.ts` uses, and for a stronger reason here:
 * `team_day_off.day` is a `date` column, so this string IS the stored value —
 * there is no instant conversion in between. `z.iso.date()` also rejects
 * calendar-shaped non-dates like `2026-02-30`, which `new Date()` would silently
 * roll into March.
 */
export const dayKeySchema = z.iso.date();

/** A team-day-off id as it arrives from the client — opaque, only ever non-empty. */
export const teamDayOffIdSchema = z.string().min(1).max(64);

/**
 * One team-wide day off. There is no `id` on the wire: the surface offers add
 * and remove, never edit — a holiday moving to a different date is a different
 * holiday, and "delete then add" says that more honestly than an update would.
 *
 * The label is optional and trimmed to nothing when blank, so an empty input and
 * an absent field store the same NULL rather than an empty string that reads as
 * a label nobody typed.
 */
export const teamDayOffSaveSchema = z.object({
  day: dayKeySchema,
  label: z
    .string()
    .max(120, "Keep the label under 120 characters.")
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});

export type TeamDayOffSaveValues = z.infer<typeof teamDayOffSaveSchema>;
