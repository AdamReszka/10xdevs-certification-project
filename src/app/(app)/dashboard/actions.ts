"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { getDb } from "@/lib/db";
import {
  UnknownSprintError,
  setCapacityOverride as setCapacityOverrideService,
  setDeliveredCorrection as setDeliveredCorrectionService,
} from "@/lib/measurement/overrides";
import {
  capacityOverrideSaveSchema,
  deliveredCorrectionSaveSchema,
} from "@/lib/validations/measurement";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * Mutations for the Dashboard "Today" availability tab — the lead's per-sprint
 * capacity override (FR-022) and delivered-SP correction (FR-023).
 *
 * Deliberately thin, mirroring `settings/absences/actions.ts`:
 * `resolveWorkspace()` + `getCloudflareContext().env` + `getDb(env)` inside the
 * body, then delegate to the request-context-free service core with the resolved
 * `ownerId`. No business logic here. The resolver carries the session guard, so
 * the override follows the workspace: in demo it writes the DEMO sprint's
 * measurement record, and the real account's is untouched.
 *
 * THE SPRINT COMES FROM THE PAYLOAD, and it is the one the surface was DISPLAYING
 * (impl-review F2). Re-resolving "the active sprint" here would read a different
 * moment than the render did: a rollover in between files the lead's number
 * against a sprint they never looked at, and `router.refresh()` repaints over the
 * substitution silently. Accepting the id is not a trust decision — the store's
 * owner-scoped lookup refuses any id outside the caller's own set and raises
 * `UnknownSprintError`, which `toFailure` turns into "reload the page".
 *
 * NO RE-DETECTION, unlike the absence actions. An override changes a planning
 * figure and a stored measurement; it changes no anomaly input — none of the
 * eight rules read capacity — so re-running detection here would be cost with no
 * effect.
 */

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_input" | "integration_unavailable";
  message: string;
};

export type MeasurementMutationResult = { ok: true; id: string } | ActionFailure;

/**
 * Set or clear the active sprint's capacity override, in man-days.
 * `{ md: null }` clears it and restores the computed figure.
 */
export async function setCapacityOverrideAction(
  input: unknown,
): Promise<MeasurementMutationResult> {
  const { ownerId } = await resolveWorkspace();

  const parsed = capacityOverrideSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the capacity and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const { id } = await setCapacityOverrideService({
      db,
      ownerId,
      jiraSprintId: parsed.data.jiraSprintId,
      md: parsed.data.md,
    });
    return { ok: true, id };
  } catch (err) {
    return toFailure(err, "[dashboard] setCapacityOverride");
  }
}

/**
 * Set or clear the active sprint's delivered-SP correction.
 * `{ sp: null }` clears it and puts the measurement back on screen.
 */
export async function setDeliveredCorrectionAction(
  input: unknown,
): Promise<MeasurementMutationResult> {
  const { ownerId } = await resolveWorkspace();

  const parsed = deliveredCorrectionSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the story points and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const { id } = await setDeliveredCorrectionService({
      db,
      ownerId,
      jiraSprintId: parsed.data.jiraSprintId,
      sp: parsed.data.sp,
    });
    return { ok: true, id };
  } catch (err) {
    return toFailure(err, "[dashboard] setDeliveredCorrection");
  }
}

function invalidInput(message: string): ActionFailure {
  return { ok: false, error: "invalid_input", message };
}

/**
 * Map a service error to a typed failure. The domain error here is a stale page
 * or a crafted payload, so — as in `settings/absences/actions.ts` — only the
 * unexpected branch logs.
 */
function toFailure(err: unknown, tag: string): ActionFailure {
  if (err instanceof UnknownSprintError) {
    return invalidInput("That sprint is out of date. Reload the page and try again.");
  }
  console.error(`${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "integration_unavailable",
    message: "Something went wrong. Please try again.",
  };
}
