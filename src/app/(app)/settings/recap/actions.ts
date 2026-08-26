"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveRecapSettings } from "@/lib/recap-settings";
import { recapSettingsSchema } from "@/lib/validations/recap";

/**
 * S-11 Daily Recap settings mutation (FR-018) — deliberately thin, mirroring
 * `settings/absences/actions.ts`. `requireSession()` + `getCloudflareContext().env`
 * + `getDb(env)` in the body, then straight to the request-context-free service
 * core with `ownerId = session.user.id`. No business logic here.
 *
 * NO DETECTION RE-RUN, unlike the absence actions. Those re-detect because
 * recording an absence changes which anomalies are true; the send TIME affects
 * nothing already computed, so a re-run here would be pure cost.
 */

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_input" | "integration_unavailable";
  message: string;
};

export type RecapSettingsResult = { ok: true } | ActionFailure;

export async function saveRecapSettingsAction(input: unknown): Promise<RecapSettingsResult> {
  const session = await requireSession();

  const parsed = recapSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Pick a time between 00:00 and 23:59.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await saveRecapSettings({ db, ownerId: session.user.id, input: parsed.data });
    return { ok: true };
  } catch (err) {
    // Only the unexpected branch logs — there is no user-fixable domain error on
    // this path, so anything reaching here is ours.
    console.error("[settings/recap] saveRecapSettings unexpected error:", err);
    return {
      ok: false,
      error: "integration_unavailable",
      message: "Something went wrong. Please try again.",
    };
  }
}
