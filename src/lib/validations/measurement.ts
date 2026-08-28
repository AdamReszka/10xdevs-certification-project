import { z } from "zod";

/**
 * Shared zod schemas for the lead's two manual entries on a sprint's
 * measurement (S-23 Phase 5, FR-022/FR-023): the capacity override in man-days
 * and the delivered-story-point correction.
 *
 * Centralized like `validations/team-day-off.ts` so the client form and the
 * server-side re-validation agree on one source of truth, and — like it — free
 * of any server-only import so the form can pull these without dragging Node
 * globals into the browser bundle.
 *
 * BOTH ARE NULLABLE, and that is the point rather than a convenience. `null` is
 * how the lead says "clear it, go back to what you computed" — the escape hatch
 * needs an exit. An empty input therefore has to reach the store as an explicit
 * `null`, never as `0`, which is itself a legitimate (if bleak) capacity.
 */

/**
 * The ceiling on an overridden capacity.
 *
 * A bound rather than only the column's own `numeric(8,2)` limit, because the
 * failure this guards is a fat-fingered `1200` for `120` — a value the database
 * accepts happily and that then feeds FR-024's normalisation, where it skews
 * every later average rather than announcing itself. Ten thousand man-days is a
 * 500-person team over a 20-day sprint, comfortably past anything the PRD's
 * 3–10-person scale can mean and still far short of the column's limit.
 */
export const MAX_CAPACITY_MD = 10_000;

/** The ceiling on a corrected delivered figure — same motive, story-point scale. */
export const MAX_DELIVERED_SP = 100_000;

/**
 * Two decimals, no more.
 *
 * Checked with a tolerance rather than `Number.isInteger(v * 100)`: the latter
 * rejects `0.29`, because `0.29 * 100` is `28.999999999999996` in IEEE 754. The
 * question being asked is "did the lead type more precision than a man-day
 * figure carries", and a float artefact in the fifteenth decimal place is not
 * that.
 */
function atMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * The per-sprint capacity override in man-days (FR-022). `null` clears it.
 *
 * Half-days are expressible on purpose — a 0.5 FTE over an odd number of
 * working days produces one, so a lead correcting such a sprint by hand must be
 * able to enter what the model itself would have produced.
 */
export const capacityOverrideMdSchema = z
  .number()
  .finite("Enter a number of man-days.")
  .min(0, "Capacity cannot be negative.")
  .max(MAX_CAPACITY_MD, `Capacity cannot exceed ${MAX_CAPACITY_MD} MD.`)
  .refine(atMostTwoDecimals, "Use at most two decimal places.")
  .nullable();

/**
 * The corrected delivered story points (FR-023). `null` clears the correction
 * and puts the computed measurement back on screen.
 *
 * An integer because story points are: the estimates SprintFlow reads are a
 * Fibonacci-ish scale, and a delivered *sum* of them is whole by construction.
 * (A `0.5` estimate on a single ticket is a real thing Jira allows and Phase 3
 * already rounds at ingestion — that is a different number in a different
 * place.)
 */
export const deliveredSpCorrectedSchema = z
  .number()
  .int("Story points are whole numbers.")
  .min(0, "Delivered story points cannot be negative.")
  .max(MAX_DELIVERED_SP, `That is more than ${MAX_DELIVERED_SP} story points.`)
  .nullable();

/** The two wire payloads. One field each — the surface writes one at a time. */
export const capacityOverrideSaveSchema = z.object({ md: capacityOverrideMdSchema });
export const deliveredCorrectionSaveSchema = z.object({ sp: deliveredSpCorrectedSchema });

export type CapacityOverrideSaveValues = z.infer<typeof capacityOverrideSaveSchema>;
export type DeliveredCorrectionSaveValues = z.infer<typeof deliveredCorrectionSaveSchema>;
