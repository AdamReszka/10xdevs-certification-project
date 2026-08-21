import { eq } from "drizzle-orm";

import { DEFAULT_THRESHOLDS, type AnomalyDefault } from "@/db/defaults";
import { anomalySettings, anomalyType } from "@/db/schema";
import type { getDb } from "@/lib/db";

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
    const base = DEFAULT_THRESHOLDS[type];
    const override = overrides.get(type);
    result[type] = {
      severity: override?.severityOverride ?? base.severity,
      thresholds: {
        ...base.thresholds,
        ...((override?.thresholds as Record<string, unknown> | null) ?? {}),
      },
    };
  }
  return result;
}
