import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { equalsDefaults } from "@/components/organisms/settings/anomaly-rules-view";
import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalySettings, anomalyType, severity } from "@/db/schema";
import { mergeRule } from "@/lib/anomaly/thresholds";
import type { getDb } from "@/lib/db";
import type { AnomalyRuleSaveValues } from "@/lib/validations/anomaly-settings";

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

/**
 * Persist one rule's COMPLETE configuration, or remove its override when the
 * submitted values are the shipped defaults.
 *
 * THE PAYLOAD IS ALWAYS THE WHOLE RULE BODY, never a partial patch. `mergeRule`
 * spreads one level deep, so a stored `inProgressHoursBySp` REPLACES the default
 * map rather than merging into it — a payload carrying only the changed bucket
 * would delete the other six and silently drop In-Progress aging to the nearest
 * remaining budget. `anomalyRuleSaveSchema` enforces the completeness; this
 * function relies on it.
 *
 * NORMALISATION FIRST: a save whose severity and body equal
 * `DEFAULT_THRESHOLDS[type]` DELETES the row instead of writing one. That is what
 * keeps "a row exists iff the rule is modified" true, so the badge, the Reset
 * button and `isOverridden` never disagree.
 *
 * `onConflictDoUpdate` on `anomaly_settings_owner_type_uq`, never
 * delete-then-insert: `lessons.md` names "future settings/threshold sets" by
 * hand, and it is the only form safe against two saves racing. `updatedAt` is set
 * EXPLICITLY inside the `set` because Drizzle's `$onUpdate` does not fire on the
 * conflict path (`measurement/overrides.ts:171`, `recap-settings.ts:88`).
 */
export async function saveAnomalyRule({
  db,
  ownerId,
  input,
}: {
  db: Db;
  ownerId: string;
  input: AnomalyRuleSaveValues;
}): Promise<{ stored: boolean }> {
  const thresholds = input.thresholds as Record<string, unknown>;

  if (equalsDefaults(input.anomalyType, { severity: input.severity, thresholds })) {
    await resetAnomalyRule({ db, ownerId, anomalyType: input.anomalyType });
    return { stored: false };
  }

  const now = new Date();
  await db
    .insert(anomalySettings)
    .values({
      id: randomUUID(),
      ownerId,
      anomalyType: input.anomalyType,
      severityOverride: input.severity,
      thresholds,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [anomalySettings.ownerId, anomalySettings.anomalyType],
      set: {
        severityOverride: input.severity,
        thresholds,
        // `$onUpdate` does not fire on the conflict path.
        updatedAt: now,
      },
    });

  return { stored: true };
}

/**
 * Remove one rule's override, returning it to the shipped defaults.
 *
 * The `ownerId` predicate stays even though `(owner_id, anomaly_type)` is the
 * whole key: every table carries its own owner predicate and never inherits
 * scoping (S-10 F9). There is no RLS behind this.
 *
 * Deleting a row that does not exist is a NO-OP, not an error — resetting an
 * already-default rule is a legitimate thing for the surface to do, and there is
 * no id here to forge: both key parts come from the session and the enum.
 */
export async function resetAnomalyRule({
  db,
  ownerId,
  anomalyType: type,
}: {
  db: Db;
  ownerId: string;
  anomalyType: AnomalyTypeValue;
}): Promise<void> {
  await db
    .delete(anomalySettings)
    .where(
      and(
        eq(anomalySettings.ownerId, ownerId),
        eq(anomalySettings.anomalyType, type),
      ),
    );
}
