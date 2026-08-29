import { z } from "zod";

/**
 * Shared zod schemas for the S-14 anomaly settings page (FR-009, FR-014).
 *
 * THIS MODULE IS THE ONLY RUNTIME TYPE CHECK THAT EVER RUNS AGAINST
 * `anomaly_settings.thresholds`. The column is `jsonb` and every detector reads
 * its body through an unchecked `as` cast (`ticket-status-aging.ts:16`,
 * `pr-review-stalled.ts`, …), so a malformed body does not fail at the write —
 * it misbehaves at detection, in one of two ways:
 *
 *  - a missing or non-numeric field propagates `NaN` through the magnitude into
 *    `riskScore` (`risk-score.ts:16-20`, `Math.max(0, Math.min(1, NaN))` is
 *    `NaN`) and the `integer` column rejects it — aborting the WHOLE detection
 *    transaction, not just that rule;
 *  - an inverted or emptied predicate produces a false-positive storm or, worse,
 *    an empty result that reads exactly like a healthy sprint (`lessons.md`,
 *    "a narrowing predicate turns 'wrong value' into 'empty result'").
 *
 * It is applied on BOTH sides of the column: `saveAnomalyRuleAction` parses the
 * inbound payload, and `mergeRule` (`src/lib/anomaly/thresholds.ts`) parses the
 * STORED body before merging it, because a validated write is not the same thing
 * as a validated column and the column outlives this slice.
 *
 * Two house rules, as in `validations/recap.ts` and `validations/team-day-off.ts`:
 * NO server-only import (the client form pulls this same module), and NO
 * cross-row or database question (uniqueness belongs to
 * `anomaly_settings_owner_type_uq`).
 *
 * WHAT DOES **NOT** LIVE HERE: the `"8_WORKING_DAYS"` sentinel's meaning. The
 * schema permits it as a value; resolving it against the sprint's working-day
 * calendar is the detector's job (`ticket-status-aging.ts:63-74`).
 */

const severitySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

/**
 * Every numeric threshold is a POSITIVE integer with an explicit upper bound.
 *
 * `0` is excluded deliberately and is not a nitpick: a zero-hour or zero-day
 * budget makes the rule fire on every single row the moment a sprint opens,
 * which is the false-positive storm above. The upper bound exists so a typo
 * (`5000` for `500`) cannot silence a rule forever without any error.
 */
function positiveInt(max: number, label: string) {
  return z
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(max, `${label} cannot exceed ${max}.`);
}

/** The seven story-point buckets `DEFAULT_THRESHOLDS` ships (`defaults.ts:33-41`). */
export const SP_BUCKET_KEYS = ["1", "2", "3", "5", "8", "13", "21"] as const;

/** The three workflow categories `SPRINT_AT_RISK` counts parallel work in. */
export const PARALLEL_CATEGORY_KEYS = [
  "IN_PROGRESS",
  "CODE_REVIEW",
  "TESTING",
] as const;

/**
 * One In-Progress budget: hours, or the working-day sentinel.
 *
 * The sentinel is accepted on ANY bucket, not only 21 SP, because the detector
 * branches on the VALUE and never on the key (`ticket-status-aging.ts:63`).
 * Constraining it to one key here would be a rule the code does not have.
 */
const inProgressBudgetSchema = z.union([
  positiveInt(2000, "The In-Progress budget"),
  z.literal("8_WORKING_DAYS"),
]);

/**
 * `inProgressHoursBySp` must carry EXACTLY the seven default keys.
 *
 * This is the single most load-bearing rule in the file. `mergeRule` spreads the
 * override one level deep (`thresholds.ts`), so a stored map REPLACES the
 * default map rather than merging into it — a payload carrying one changed
 * bucket would delete the other six, and `inProgressBudget` then silently falls
 * back to the nearest remaining bucket, or returns `null` for an empty map,
 * which skips every In-Progress ticket and renders as a healthy sprint. Keys are
 * strings because JSON object keys always are, which is also what the detector
 * consumes (`Record<string, …>`, `ticket-status-aging.ts:14`).
 */
const inProgressHoursBySpSchema = z
  .object(
    Object.fromEntries(
      SP_BUCKET_KEYS.map((k) => [k, inProgressBudgetSchema]),
    ) as Record<(typeof SP_BUCKET_KEYS)[number], typeof inProgressBudgetSchema>,
  )
  .strict();

const maxParallelByCategorySchema = z
  .object(
    Object.fromEntries(
      PARALLEL_CATEGORY_KEYS.map((k) => [
        k,
        positiveInt(50, "The parallel-work limit"),
      ]),
    ) as Record<
      (typeof PARALLEL_CATEGORY_KEYS)[number],
      ReturnType<typeof positiveInt>
    >,
  )
  .strict();

/*
 * ---------------------------------------------------------------------------
 * The eight rule bodies. Field names and shapes follow `DEFAULT_THRESHOLDS`
 * EXACTLY — a name that differs on one side only produces a body the detector
 * reads as `undefined`, which is the `NaN` failure above.
 * ---------------------------------------------------------------------------
 */

export const prReviewStalledThresholdsSchema = z
  .object({ hours: positiveInt(2000, "The review timeout") })
  .strict();

export const ticketStatusAgingThresholdsSchema = z
  .object({
    inProgressHoursBySp: inProgressHoursBySpSchema,
    codeReviewHours: positiveInt(2000, "The Code Review budget"),
    testingHours: positiveInt(2000, "The Testing budget"),
  })
  .strict();

export const noCommitDaysThresholdsSchema = z
  .object({ noCommitDays: positiveInt(90, "The no-commit window") })
  .strict();

export const sprintAtRiskThresholdsSchema = z
  .object({
    maxParallelByCategory: maxParallelByCategorySchema,
    toDoBeforeSprintEndLeadTimeHours: positiveInt(2000, "The ToDo lead time"),
  })
  .strict();

export const prTooBigThresholdsSchema = z
  .object({ maxLines: positiveInt(100000, "The PR size limit") })
  .strict();

export const scopeCreepThresholdsSchema = z
  .object({
    percent: z
      .number({ message: "The scope-creep limit must be a number." })
      .int("The scope-creep limit must be a whole number.")
      .min(1, "The scope-creep limit must be at least 1%.")
      .max(100, "The scope-creep limit cannot exceed 100%."),
  })
  .strict();

/**
 * `PR_TICKET_DESYNC` has no tunable numbers — the rule is a pure state
 * comparison (PR merged while its ticket is not Done). Its card offers severity
 * alone, and its body is the empty object rather than an absent field, so the
 * stored shape matches `DEFAULT_THRESHOLDS.PR_TICKET_DESYNC.thresholds`.
 */
export const prTicketDesyncThresholdsSchema = z.object({}).strict();

/** Per-anomaly-type body schemas, exported by name for the read guard. */
export const THRESHOLD_BODY_SCHEMAS = {
  PR_REVIEW_STALLED: prReviewStalledThresholdsSchema,
  TICKET_STATUS_AGING: ticketStatusAgingThresholdsSchema,
  DEVELOPER_INACTIVE: noCommitDaysThresholdsSchema,
  TICKET_NO_COMMIT_LINK: noCommitDaysThresholdsSchema,
  SPRINT_AT_RISK: sprintAtRiskThresholdsSchema,
  PR_TOO_BIG: prTooBigThresholdsSchema,
  SCOPE_CREEP: scopeCreepThresholdsSchema,
  PR_TICKET_DESYNC: prTicketDesyncThresholdsSchema,
} as const;

/*
 * ---------------------------------------------------------------------------
 * The wire payloads. Each member is exported UNDER ITS OWN NAME as well as
 * through the union: Phase 3 gives every card its own `zodResolver`, and each
 * needs exactly one member — a `zodResolver` over the discriminated union would
 * validate a card against whichever branch its `anomalyType` selects, which is
 * right, but react-hook-form's inferred field types would then be the union of
 * all eight bodies.
 * ---------------------------------------------------------------------------
 */

export const prReviewStalledRuleSchema = z.object({
  anomalyType: z.literal("PR_REVIEW_STALLED"),
  severity: severitySchema,
  thresholds: prReviewStalledThresholdsSchema,
});

export const ticketStatusAgingRuleSchema = z.object({
  anomalyType: z.literal("TICKET_STATUS_AGING"),
  severity: severitySchema,
  thresholds: ticketStatusAgingThresholdsSchema,
});

export const developerInactiveRuleSchema = z.object({
  anomalyType: z.literal("DEVELOPER_INACTIVE"),
  severity: severitySchema,
  thresholds: noCommitDaysThresholdsSchema,
});

export const ticketNoCommitLinkRuleSchema = z.object({
  anomalyType: z.literal("TICKET_NO_COMMIT_LINK"),
  severity: severitySchema,
  thresholds: noCommitDaysThresholdsSchema,
});

export const sprintAtRiskRuleSchema = z.object({
  anomalyType: z.literal("SPRINT_AT_RISK"),
  severity: severitySchema,
  thresholds: sprintAtRiskThresholdsSchema,
});

export const prTooBigRuleSchema = z.object({
  anomalyType: z.literal("PR_TOO_BIG"),
  severity: severitySchema,
  thresholds: prTooBigThresholdsSchema,
});

export const scopeCreepRuleSchema = z.object({
  anomalyType: z.literal("SCOPE_CREEP"),
  severity: severitySchema,
  thresholds: scopeCreepThresholdsSchema,
});

export const prTicketDesyncRuleSchema = z.object({
  anomalyType: z.literal("PR_TICKET_DESYNC"),
  severity: severitySchema,
  thresholds: prTicketDesyncThresholdsSchema,
});

/** The save payload: one rule's COMPLETE configuration, never a partial patch. */
export const anomalyRuleSaveSchema = z.discriminatedUnion("anomalyType", [
  prReviewStalledRuleSchema,
  ticketStatusAgingRuleSchema,
  developerInactiveRuleSchema,
  ticketNoCommitLinkRuleSchema,
  sprintAtRiskRuleSchema,
  prTooBigRuleSchema,
  scopeCreepRuleSchema,
  prTicketDesyncRuleSchema,
]);

export type AnomalyRuleSaveValues = z.infer<typeof anomalyRuleSaveSchema>;

/** The reset payload — an anomaly type and nothing else. */
export const anomalyRuleResetSchema = z.object({
  anomalyType: z.enum([
    "PR_REVIEW_STALLED",
    "TICKET_STATUS_AGING",
    "DEVELOPER_INACTIVE",
    "TICKET_NO_COMMIT_LINK",
    "SPRINT_AT_RISK",
    "PR_TOO_BIG",
    "SCOPE_CREEP",
    "PR_TICKET_DESYNC",
  ]),
});

export type AnomalyRuleResetValues = z.infer<typeof anomalyRuleResetSchema>;

/**
 * The union members keyed by anomaly type.
 *
 * Phase 3 gives every card its own `zodResolver`, and each needs exactly ONE
 * member: a resolver over the whole union would validate correctly but hand
 * react-hook-form the union of all eight bodies as its field type.
 */
export const RULE_SAVE_SCHEMAS = {
  PR_REVIEW_STALLED: prReviewStalledRuleSchema,
  TICKET_STATUS_AGING: ticketStatusAgingRuleSchema,
  DEVELOPER_INACTIVE: developerInactiveRuleSchema,
  TICKET_NO_COMMIT_LINK: ticketNoCommitLinkRuleSchema,
  SPRINT_AT_RISK: sprintAtRiskRuleSchema,
  PR_TOO_BIG: prTooBigRuleSchema,
  SCOPE_CREEP: scopeCreepRuleSchema,
  PR_TICKET_DESYNC: prTicketDesyncRuleSchema,
} as const;
