import { eq } from "drizzle-orm";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalySettings, anomalyType, severity } from "@/db/schema";
import { mergeRule } from "@/lib/anomaly/thresholds";
import type { getDb } from "@/lib/db";

/**
 * Owner-scoped read/write of the per-rule anomaly configuration (S-14, FR-009 +
 * FR-014). The request-context-free service core: `{ db, ownerId }` explicit, no
 * session, no Cloudflare context — the same shape as `src/lib/recap-settings.ts`.
 *
 * NO ROW MEANS DEFAULTS. `src/db/defaults.ts` is never seeded; a row exists here
 * IF AND ONLY IF the rule differs from what SprintFlow ships. That single
 * invariant drives the "Modified" badge, the Reset button, and the reader's
 * `isOverridden` flag, and it is what `saveAnomalyRule` enforces by DELETING a
 * row whose values have been returned to the defaults.
 *
 * OWNER SCOPING is explicit on every statement — there is no RLS behind this,
 * and every table carries its own `ownerId` predicate rather than inheriting one.
 */

type Db = ReturnType<typeof getDb>;
type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type SeverityValue = (typeof severity.enumValues)[number];

/** One rule as the settings surface renders it: what is in force, and whether the lead set it. */
export type AnomalyRuleState = {
  anomalyType: AnomalyTypeValue;
  severity: SeverityValue;
  thresholds: Record<string, unknown>;
  /**
   * Whether a row exists for this rule. Equivalent to "differs from the shipped
   * defaults" because `saveAnomalyRule` normalises a defaults-equal save into a
   * delete — the two are the same fact, deliberately.
   */
  isOverridden: boolean;
};

/**
 * All eight rules for one owner, in `anomaly_type` enum order.
 *
 * Exhaustive by construction: a fresh account with zero rows gets eight entries
 * carrying the defaults and `isOverridden: false`, so the page never has to
 * reason about a missing rule.
 *
 * The layering goes through `mergeRule` rather than being re-implemented here —
 * duplicating it would let the settings surface and the detector drift, and the
 * form would then seed from a body the detector does not actually use. It also
 * inherits the read guard: a stored body that fails validation renders as the
 * defaults, which is what detection will use.
 */
export async function readAnomalyRules({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<AnomalyRuleState[]> {
  const rows = await db
    .select({
      anomalyType: anomalySettings.anomalyType,
      severityOverride: anomalySettings.severityOverride,
      thresholds: anomalySettings.thresholds,
    })
    .from(anomalySettings)
    .where(eq(anomalySettings.ownerId, ownerId));

  const overrides = new Map(rows.map((r) => [r.anomalyType, r]));

  return anomalyType.enumValues.map((type) => {
    const override = overrides.get(type);
    const effective = mergeRule(type, DEFAULT_THRESHOLDS[type], override);
    return {
      anomalyType: type,
      severity: effective.severity,
      thresholds: effective.thresholds,
      isOverridden: override !== undefined,
    };
  });
}
