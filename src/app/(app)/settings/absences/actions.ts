"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { detectAnomalies } from "@/lib/anomaly/detect";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  type AbsenceInput,
  OverlappingAbsenceError,
  UnknownAbsenceError,
  createAbsence as createAbsenceService,
  deleteAbsence as deleteAbsenceService,
  updateAbsence as updateAbsenceService,
} from "@/lib/absence-store";
import { UnknownMemberError } from "@/lib/integrations/roster-store";
import { absenceIdSchema, absenceSaveSchema } from "@/lib/validations/absence";

/**
 * S-08 absence mutations — deliberately thin, mirroring `setup/team/actions.ts`.
 * Each action does `requireSession()` + `getCloudflareContext().env` +
 * `getDb(env)` inside the body, then delegates to the request-context-free
 * service core with `ownerId = session.user.id`. No business logic here.
 *
 * EVERY MUTATION RE-RUNS DETECTION (owner decision D1). Detection is a
 * *reconcile*: a `dedupKey` that stops being emitted is flipped to `RESOLVED`, so
 * recording an absence removes the now-explained `DEVELOPER_INACTIVE` from the
 * inbox and deleting it brings the row back. Without the re-run the owner would
 * record an absence and watch the anomaly they just explained sit there until the
 * next 15-minute cron cycle — the surface would look broken.
 *
 * The re-run is deliberately best-effort: it happens AFTER the write has
 * committed, inside a try/catch that swallows failures. The user's save
 * succeeded; reporting it as failed because a downstream recompute stumbled would
 * be a lie, and would push them to save again.
 *
 * SCOPE OF D1 (a known, accepted gap): only THIS slice's writes re-detect.
 * `saveRoster` is also anomaly-affecting — deactivating a member changes
 * `DEVELOPER_INACTIVE` — but widening D1 to it is out of scope here, so roster
 * saves keep waiting for the cron cycle.
 */

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_input" | "integration_unavailable";
  message: string;
};

export type AbsenceMutationResult = { ok: true; id: string } | ActionFailure;

/** Record a new absence. `sprint_id` and the day→instant conversion are server-side. */
export async function createAbsenceAction(input: unknown): Promise<AbsenceMutationResult> {
  const session = await requireSession();

  const parsed = absenceSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the absence and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  try {
    const { id } = await createAbsenceService({
      db,
      ownerId,
      input: toInput(parsed.data),
    });
    await redetect(db, ownerId);
    return { ok: true, id };
  } catch (err) {
    return toFailure(err, "[settings/absences] createAbsence");
  }
}

/** Edit an existing absence. The payload's `id` names the row. */
export async function updateAbsenceAction(input: unknown): Promise<AbsenceMutationResult> {
  const session = await requireSession();

  const parsed = absenceSaveSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the absence and try again.",
    );
  }
  if (!parsed.data.id) return invalidInput("Pick an absence and try again.");

  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  try {
    const { id } = await updateAbsenceService({
      db,
      ownerId,
      absenceId: parsed.data.id,
      input: toInput(parsed.data),
    });
    await redetect(db, ownerId);
    return { ok: true, id };
  } catch (err) {
    return toFailure(err, "[settings/absences] updateAbsence");
  }
}

/** Remove an absence. Un-suppresses whatever it was explaining. */
export async function deleteAbsenceAction(
  absenceId: unknown,
): Promise<AbsenceMutationResult> {
  const session = await requireSession();

  const parsed = absenceIdSchema.safeParse(absenceId);
  if (!parsed.success) return invalidInput("Pick an absence and try again.");

  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  try {
    await deleteAbsenceService({ db, ownerId, absenceId: parsed.data });
    await redetect(db, ownerId);
    return { ok: true, id: parsed.data };
  } catch (err) {
    return toFailure(err, "[settings/absences] deleteAbsence");
  }
}

/** The wire shape minus `id` — everything the store persists. */
function toInput(data: { id?: string } & AbsenceInput): AbsenceInput {
  return {
    teamMemberId: data.teamMemberId,
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate,
    isPlanned: data.isPlanned,
  };
}

/**
 * Re-run detection after a committed write (D1). Never throws: the save the user
 * asked for has already succeeded, and a stale inbox for one cron cycle is a far
 * smaller failure than telling them their absence was not recorded.
 */
async function redetect(db: ReturnType<typeof getDb>, ownerId: string): Promise<void> {
  try {
    await detectAnomalies({ db, ownerId });
  } catch (err) {
    console.error("[settings/absences] re-detect after save failed:", err);
  }
}

function invalidInput(message: string): ActionFailure {
  return { ok: false, error: "invalid_input", message };
}

/**
 * Map a service error to a typed failure. Both domain errors here are
 * user-fixable input problems, so — as in `setup/team/actions.ts` — only the
 * unexpected branch logs.
 */
function toFailure(err: unknown, tag: string): ActionFailure {
  // A stale grid, or a crafted payload naming another account's row. Refused
  // rather than treated as new (PRD cross-account isolation).
  if (err instanceof UnknownAbsenceError || err instanceof UnknownMemberError) {
    return invalidInput("That list is out of date. Reload the page and try again.");
  }
  if (err instanceof OverlappingAbsenceError) {
    return invalidInput(err.message);
  }
  console.error(`${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "integration_unavailable",
    message: "Something went wrong. Please try again.",
  };
}
