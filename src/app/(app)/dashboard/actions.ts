"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  UnknownSprintError,
  setCapacityOverride as setCapacityOverrideService,
  setDeliveredCorrection as setDeliveredCorrectionService,
} from "@/lib/measurement/overrides";
import { getActiveSprintRow } from "@/lib/sprint";
import {
  capacityOverrideSaveSchema,
  deliveredCorrectionSaveSchema,
} from "@/lib/validations/measurement";

/**
 * Mutations for the Dashboard "Today" availability tab — the lead's per-sprint
 * capacity override (FR-022) and delivered-SP correction (FR-023).
 *
 * Deliberately thin, mirroring `settings/absences/actions.ts`: `requireSession()`
 * + `getCloudflareContext().env` + `getDb(env)` inside the body, then delegate to
 * the request-context-free service core with `ownerId = session.user.id`. No
 * business logic here.
 *
 * THE SPRINT IS RESOLVED SERVER-SIDE, never taken from the payload. The surface
 * only ever edits the sprint it is displaying, which is the active one, so there
 * is no reason to let a client name a sprint — and every reason not to. (The
 * store still refuses a foreign id on its own; this is the belt to that
 * braces.)
 *
 * NO RE-DETECTION, unlike the absence actions. An override changes a planning
 * figure and a stored measurement; it changes no anomaly input — none of the
 * eight rules read capacity — so re-running detection here would be cost with no
 * effect.
 */

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_input" | "no_active_sprint" | "integration_unavailable";
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
  const session = await requireSession();

  const parsed = capacityOverrideSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the capacity and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  try {
    const sprint = await getActiveSprintRow(db, ownerId);
    if (sprint === null) return noActiveSprint();

    const { id } = await setCapacityOverrideService({
      db,
      ownerId,
      jiraSprintId: sprint.jiraSprintId,
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
  const session = await requireSession();

  const parsed = deliveredCorrectionSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the story points and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  try {
    const sprint = await getActiveSprintRow(db, ownerId);
    if (sprint === null) return noActiveSprint();

    const { id } = await setDeliveredCorrectionService({
      db,
      ownerId,
      jiraSprintId: sprint.jiraSprintId,
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
 * Its own error rather than `invalid_input`: nothing the lead typed is wrong,
 * there is simply no sprint to file the number against, and "check your input"
 * would send them looking for a mistake that isn't there.
 */
function noActiveSprint(): ActionFailure {
  return {
    ok: false,
    error: "no_active_sprint",
    message: "There is no active sprint to adjust yet. Finish Jira setup first.",
  };
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
