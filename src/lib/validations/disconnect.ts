import { z } from "zod";

/**
 * The disconnect outcome the lead chose (S-26, FR-002/FR-003).
 *
 * Disconnect stopped meaning one thing when the cascade was narrowed: `keep`
 * leaves everything the narrowed FKs now spare — the hand-entered absences, the
 * monitored repos and their synced history — while `clear` deletes them
 * deliberately, which is what the old cascade did by accident.
 *
 * WHY THIS IS PARSED AT ALL, given the union is right there in the types: a
 * Server Action parameter is a PUBLIC HTTP parameter, and `"keep" | "clear"` is
 * erased at runtime. The four typed call sites guard nothing an attacker — or a
 * future caller passing `undefined` — has to respect, so the destructive branch
 * would be one crafted POST away from being reachable without a dialog.
 *
 * Kept free of any server-only import, like `validations/absence.ts`, so a
 * client component can import the type without dragging Node globals into the
 * browser bundle.
 */
export const disconnectModeSchema = z.enum(["keep", "clear"]);

export type DisconnectMode = z.infer<typeof disconnectModeSchema>;

/**
 * Resolve an inbound mode, FAILING TOWARD `keep`.
 *
 * Anything that is not exactly `"clear"` — `undefined`, a garbage string, an
 * object — becomes `"keep"`. The safe branch is also the product default, so the
 * guard and the design agree rather than pulling apart: a malformed payload can
 * only ever reach the outcome that destroys nothing.
 *
 * Belongs in the ACTION, above the store call, never in the store — the store's
 * contract stays the honest two-member union that says what it will do.
 */
export function parseDisconnectMode(value: unknown): DisconnectMode {
  const parsed = disconnectModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "keep";
}
