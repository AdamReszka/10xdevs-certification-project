"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { detectAnomalies } from "@/lib/anomaly/detect";
import { resetAnomalyRule, saveAnomalyRule } from "@/lib/anomaly-settings";
import { getDb } from "@/lib/db";
import {
  anomalyRuleResetSchema,
  anomalyRuleSaveSchema,
} from "@/lib/validations/anomaly-settings";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * S-14 anomaly-rule mutations (FR-009, FR-014) — deliberately thin, mirroring
 * `settings/recap/actions.ts`: `resolveWorkspace()` → validate →
 * `getCloudflareContext()` + `getDb(env)` in the BODY (Workers expose no
 * bindings at module scope) → straight to the request-context-free store. No
 * business logic here.
 *
 * NO DEMO REFUSAL, unlike `/settings/recap`. Changing a threshold makes no
 * outbound call, a demo write lands under the DEMO owner (`resolveWorkspace`
 * resolves it) and is undone by "Reset demo data" — so this tab behaves like
 * `/settings/absences`, which also writes freely in demo. It is also the only
 * workspace where the re-detect below is guaranteed to have an active sprint to
 * run against, which makes it the workspace the D1 behaviour is verifiable in.
 *
 * DETECTION IS RE-RUN AFTER EVERY WRITE (decision D1). Thresholds and severity
 * are stamped onto the `anomaly` row at detection time, so without this the lead
 * would change a number, see the inbox unchanged, and have no way to tell a
 * working save from a broken one until the next cron tick.
 */

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_input" | "integration_unavailable";
  message: string;
};

export type AnomalyRuleResult = { ok: true } | ActionFailure;

export async function saveAnomalyRuleAction(input: unknown): Promise<AnomalyRuleResult> {
  const { ownerId, now } = await resolveWorkspace();

  const parsed = anomalyRuleSaveSchema.safeParse(input);
  if (!parsed.success) {
    // Never the raw zod dump (S-07 F2) — the schema's messages are written as
    // user-facing sentences precisely so this line can pass one through.
    return {
      ok: false,
      error: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Check the values and try again.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await saveAnomalyRule({ db, ownerId, input: parsed.data });
    await redetect(db, ownerId, now);
    return { ok: true };
  } catch (err) {
    return unexpected(err, "saveAnomalyRule");
  }
}

export async function resetAnomalyRuleAction(input: unknown): Promise<AnomalyRuleResult> {
  const { ownerId, now } = await resolveWorkspace();

  const parsed = anomalyRuleResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: "That rule is not one SprintFlow knows. Reload the page and try again.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await resetAnomalyRule({ db, ownerId, anomalyType: parsed.data.anomalyType });
    await redetect(db, ownerId, now);
    return { ok: true };
  } catch (err) {
    return unexpected(err, "resetAnomalyRule");
  }
}

/**
 * Re-run detection after a committed write (D1). NEVER THROWS: the save the lead
 * asked for has already succeeded, and a stale inbox for one cron cycle is a far
 * smaller failure than telling them their threshold was not recorded. Shape
 * copied from `settings/absences/actions.ts:222-232`.
 *
 * `now` is the WORKSPACE clock, not `new Date()` — in demo it is the frozen
 * anchor, and passing wall-clock time would silently produce a wrong picture for
 * exactly the visitors demo mode exists to serve.
 */
async function redetect(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  now: Date,
): Promise<void> {
  try {
    await detectAnomalies({ db, ownerId, now });
  } catch (err) {
    console.error("[settings/anomalies] re-detect after save failed:", err);
  }
}

/** Only the unexpected branch logs — every user-fixable problem is caught by zod above. */
function unexpected(err: unknown, tag: string): ActionFailure {
  console.error(`[settings/anomalies] ${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "integration_unavailable",
    message: "Something went wrong. Please try again.",
  };
}
