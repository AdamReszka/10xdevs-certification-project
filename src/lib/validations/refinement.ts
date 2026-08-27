import { z } from "zod";

/**
 * The shape a refinement run may be requested in (S-13 phase 6, FR-020).
 *
 * Centralized like `validations/absence.ts` and free of any server-only import,
 * so the client form and the Server Action's re-validation share one source of
 * truth without dragging Node globals into the browser bundle.
 *
 * WHAT DOES **NOT** LIVE HERE:
 *
 *  - **The ticket cap.** `MAX_TICKETS_PER_RUN` is a wall-clock budget measured
 *    against the model, and it lives beside the thing it protects
 *    (`refinement/analyze.ts`). Duplicating the number in a schema is how the
 *    two drift apart; `run-service.ts` enforces it against the real constant.
 *  - **Key shape.** Validated in `normalizeSelection` after trimming and
 *    de-duplication, because the error the lead needs names the offending key.
 *
 * What this schema IS for is the discriminant: `source` decides which branch of
 * the dispatch runs and is written straight into a Postgres enum column, so an
 * unrecognised value must be refused at the boundary rather than at the INSERT.
 */
export const refinementRequestSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("BACKLOG"),
    ticketKeys: z.array(z.string().max(64)).max(200),
  }),
  z.object({
    source: z.literal("KEYS"),
    ticketKeys: z.array(z.string().max(64)).max(200),
  }),
  z.object({
    source: z.literal("PASTED_TEXT"),
    // Generous, but bounded: the analysis reads whole ticket bodies, and an
    // unbounded paste is a way to spend `max_tokens` on nothing.
    text: z.string().max(50_000),
  }),
]);

export type RefinementRequestInput = z.infer<typeof refinementRequestSchema>;
