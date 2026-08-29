import { eq } from "drizzle-orm";

import { DEFAULT_THRESHOLDS, type AnomalyDefault } from "@/db/defaults";
import { anomalySettings, anomalyType } from "@/db/schema";
import type { getDb } from "@/lib/db";
import { THRESHOLD_BODY_SCHEMAS } from "@/lib/validations/anomaly-settings";

/**
 * Effective per-rule threshold + severity resolver (S-06).
 *
 * F-02/S-06 do NOT seed `anomaly_settings`; `DEFAULT_THRESHOLDS` (src/db/defaults.ts)
 * is the fallback. The effective config for a rule is
 * `stored override ?? default` for severity, and `{ ...default, ...override }` for
 * the thresholds body — so an un-overridden rule needs no DB row, and a user
 * override (written by the S-14 settings page) layers on top. The result is always
 * exhaustive over the 8 anomaly types, so every detector can read its config
 * unconditionally.
 */

type Db = ReturnType<typeof getDb>;
type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];

export type EffectiveThresholds = Record<AnomalyTypeValue, AnomalyDefault>;

/** One owner's stored override row, as both callers read it. */
export type StoredOverride = {
  severityOverride: AnomalyDefault["severity"] | null;
  thresholds: unknown;
};

/**
 * Layer one stored override onto one rule's defaults — the merge, extracted so
 * the settings surface and the detector cannot drift apart.
 *
 * THE STORED BODY IS PARSED BEFORE IT IS MERGED (S-14). The write path validates
 * too, but a validated write is not a validated column: the column outlives this
 * slice, and two writers reach it that the form never sees.
 *
 *  - **A body written under an older or newer shape.** The merge below spreads
 *    ONE level deep, so a stored `inProgressHoursBySp` REPLACES the default map
 *    rather than merging into it. The day a later slice adds a story-point
 *    bucket, every account that ever saved `TICKET_STATUS_AGING` would hold a
 *    seven-key map hiding the new eight-key default, `inProgressBudget` would
 *    quietly fall to the nearest lower bucket, and the write schema would by
 *    then reject the stored shape too — so the lead could not re-save their way
 *    out of it.
 *  - **A hand-edited or otherwise out-of-band row** reaching the eight unchecked
 *    `as` casts in the detectors.
 *
 * ON FAILURE THE OVERRIDE IS IGNORED WHOLESALE — severity included — and the
 * rule runs on `DEFAULT_THRESHOLDS`. A PARTIAL merge is the one outcome that is
 * not allowed: a half-applied body is exactly `lessons.md`'s "narrowing
 * predicate turns 'wrong value' into 'empty result', which reads as success",
 * and the log is that lesson's obligation (a) — a rule silently reverting to its
 * defaults must never be reported as an ordinary run.
 */
export function mergeRule(
  type: AnomalyTypeValue,
  base: AnomalyDefault,
  override: StoredOverride | undefined,
): AnomalyDefault {
  if (!override) return { severity: base.severity, thresholds: { ...base.thresholds } };

  // A NULL body is an ABSENT override, not a malformed one — the column is
  // nullable and the pre-S-14 merge spread `{}` for it. Severity still applies;
  // only a body that is present AND wrong is discarded below.
  if (override.thresholds == null) {
    return {
      severity: override.severityOverride ?? base.severity,
      thresholds: { ...base.thresholds },
    };
  }

  const parsed = THRESHOLD_BODY_SCHEMAS[type].safeParse(override.thresholds);
  if (!parsed.success) {
    console.error(
      `[anomaly/thresholds] stored override for ${type} failed validation and was ignored; the rule falls back to its defaults:`,
      parsed.error.issues[0]?.message ?? "unknown issue",
    );
    return { severity: base.severity, thresholds: { ...base.thresholds } };
  }

  return {
    severity: override.severityOverride ?? base.severity,
    thresholds: { ...base.thresholds, ...parsed.data },
  };
}

export async function resolveEffectiveThresholds(
  db: Db,
  ownerId: string,
): Promise<EffectiveThresholds> {
  const rows = await db
    .select({
      anomalyType: anomalySettings.anomalyType,
      severityOverride: anomalySettings.severityOverride,
      thresholds: anomalySettings.thresholds,
    })
    .from(anomalySettings)
    .where(eq(anomalySettings.ownerId, ownerId));

  const overrides = new Map(rows.map((r) => [r.anomalyType, r]));

  const result = {} as EffectiveThresholds;
  for (const type of anomalyType.enumValues) {
    result[type] = mergeRule(type, DEFAULT_THRESHOLDS[type], overrides.get(type));
  }
  return result;
}
