import { z } from "zod";

/**
 * Shared zod schemas for the S-08 absence calendar (FR-010). Centralized like
 * `validations/roster.ts` so the client form and the server-side re-validation
 * agree on one source of truth, and — like it — kept free of any server-only
 * import so the client form can pull these without dragging Node globals into
 * the browser bundle.
 *
 * WHAT DOES **NOT** LIVE HERE:
 *
 *  - **Overlap with the member's other absences.** `absenceSaveSchema` carries a
 *    SINGLE absence, so a `superRefine` over it has nothing to compare against
 *    (the roster's cross-row check works only because `rosterSaveSchema` receives
 *    the whole array). Overlap is a database question — "does this member already
 *    have a window covering these days?" — answered in `absence-store.ts` with an
 *    owner-scoped read, which also makes it unbypassable by a crafted payload.
 *  - **`sprintId`.** Server-derived when the absence is recorded, so a client
 *    cannot pin an absence to a sprint of its choosing.
 */

/** Recorded absence kind (FR-010) — mirrors the `absence_type` pgEnum. */
export const absenceTypeSchema = z.enum(["VACATION", "SICKNESS", "TRAINING"]);

/**
 * A calendar day as `YYYY-MM-DD`.
 *
 * Absences cross the wire as DAY KEYS, never as instants: the day→instant
 * conversion has to happen in the TEAM's Jira zone (`absence-dates.ts`), and the
 * browser only knows its own. `z.iso.date()` also rejects calendar-shaped
 * non-dates like `2026-02-30`, which `new Date()` would silently roll into March.
 */
export const dayKeySchema = z.iso.date();

/** An absence id as it arrives from the client — opaque, only ever non-empty. */
export const absenceIdSchema = z.string().min(1).max(64);

/**
 * One recorded absence. `id` present ⇒ an edit of that row; absent ⇒ a new one.
 *
 * `isPlanned` is REQUIRED. Leaving it optional would let it arrive undefined,
 * which means "the form did not ask" — a UI gap, not a domain fact — while
 * `SPRINT_AT_RISK` keys off unplanned-ness and would read the gap as a signal.
 */
export const absenceSaveSchema = z
  .object({
    id: absenceIdSchema.optional(),
    teamMemberId: z.string().min(1).max(64),
    type: absenceTypeSchema,
    startDate: dayKeySchema,
    endDate: dayKeySchema,
    isPlanned: z.boolean(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    // Day keys are `YYYY-MM-DD`, so the lexicographic compare is the
    // chronological one — no parsing needed.
    message: "The last day cannot be before the first day.",
    path: ["endDate"],
  });

export type AbsenceType = z.infer<typeof absenceTypeSchema>;
export type AbsenceSaveValues = z.infer<typeof absenceSaveSchema>;
