// `import type`, deliberately: this module is pulled by the CLIENT settings
// organism (`anomaly-rules-view.ts`), and a value import of the schema drags
// the whole Drizzle table graph into the browser bundle. Both names are used
// only in type position (`typeof …enumValues`), so nothing is lost.
import type { anomalyType, severity } from "@/db/schema";

/**
 * FR-009 sensible default thresholds + default severity for every anomaly rule.
 *
 * This is a typed constant only — neither F-02 nor S-06 seeds `anomaly_settings`
 * rows. S-06 reads this as the fallback: the effective per-rule config is
 * `stored anomaly_settings override ?? this default` (see
 * `src/lib/anomaly/thresholds.ts`), and a settings row is written only when the
 * user overrides a rule from the S-14 settings page. The `Record<AnomalyTypeValue, …>`
 * shape forces this map to stay exhaustive over the 8 enum values at compile
 * time; severities are checked against the `severity` enum.
 *
 * `thresholds` bodies are intentionally rule-specific (open shape) — each rule's
 * detector (S-06) owns the precise interpretation.
 */

type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type SeverityValue = (typeof severity.enumValues)[number];

export type AnomalyDefault = {
  /** Default severity tier for the rule (user-overridable per FR-014). */
  severity: SeverityValue;
  /** Rule-specific threshold config (open shape; owning slice refines). */
  thresholds: Record<string, unknown>;
};

/**
 * In-Progress time-in-status budget by story-point estimate (FR-009), in
 * WORKING hours — eight to the working day.
 *
 * Every bucket keeps the intent it shipped with and changes its unit: 24 h was
 * meant as "a day", and a day is 8 working hours, so the number is 8. The 21-SP
 * bucket stops being the `"8_WORKING_DAYS"` sentinel and becomes 64, an ordinary
 * number like the other six — with the unit in working hours there is nothing
 * left for a sentinel to say (S-28).
 */
const IN_PROGRESS_HOURS_BY_SP: Record<number, number> = {
  1: 8, // 1 day
  2: 8, // 1 day
  3: 16, // 2 days
  5: 24, // 3 days
  8: 40, // 5 days
  13: 40, // 5 days
  21: 64, // 8 working days
};

export const DEFAULT_THRESHOLDS: Record<AnomalyTypeValue, AnomalyDefault> = {
  PR_REVIEW_STALLED: {
    severity: "MEDIUM",
    thresholds: { hours: 8 }, // 1 day
  },
  TICKET_STATUS_AGING: {
    severity: "MEDIUM",
    thresholds: {
      inProgressHoursBySp: IN_PROGRESS_HOURS_BY_SP,
      codeReviewHours: 8, // 1 day
      testingHours: 16, // 2 days
    },
  },
  DEVELOPER_INACTIVE: {
    severity: "MEDIUM",
    thresholds: { noCommitDays: 2 },
  },
  TICKET_NO_COMMIT_LINK: {
    severity: "MEDIUM",
    thresholds: { noCommitDays: 2 },
  },
  SPRINT_AT_RISK: {
    severity: "HIGH",
    thresholds: {
      // Max tickets a single developer may hold in parallel per category before
      // it counts toward sprint risk.
      maxParallelByCategory: { IN_PROGRESS: 2, CODE_REVIEW: 2, TESTING: 3 },
      // Alert when ToDo tickets remain this close to sprint end, in WORKING
      // hours — 16 is two working days, not two calendar days.
      toDoBeforeSprintEndLeadTimeHours: 16,
    },
  },
  PR_TOO_BIG: {
    severity: "LOW",
    thresholds: { maxLines: 500 },
  },
  SCOPE_CREEP: {
    severity: "MEDIUM",
    thresholds: { percent: 20 },
  },
  PR_TICKET_DESYNC: {
    severity: "LOW",
    thresholds: {},
  },
};
