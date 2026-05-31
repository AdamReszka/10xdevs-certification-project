import { anomalyType, severity } from "@/db/schema";

/**
 * FR-009 sensible default thresholds + default severity for every anomaly rule.
 *
 * This is a typed constant only — F-02 does NOT seed `anomaly_settings` rows.
 * S-06 reads this to write the per-account default rows (and the user re-tunes
 * thresholds/severity from the settings page). The `Record<AnomalyTypeValue, …>`
 * shape forces this map to stay exhaustive over the 8 enum values at compile
 * time; severities are checked against the `severity` enum.
 *
 * `thresholds` bodies are intentionally rule-specific (open shape) — each rule's
 * detector (S-07…) owns the precise interpretation.
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
 * In-Progress time-in-status budget by story-point estimate (FR-009). Hours,
 * except the 21-SP bucket which is "8 working days" — represented as a sentinel
 * the detector resolves against the sprint's working-day calendar.
 */
const IN_PROGRESS_HOURS_BY_SP: Record<number, number | "8_WORKING_DAYS"> = {
  1: 24,
  2: 24,
  3: 48,
  5: 72,
  8: 120, // 5 days
  13: 120, // 5 days
  21: "8_WORKING_DAYS",
};

export const DEFAULT_THRESHOLDS: Record<AnomalyTypeValue, AnomalyDefault> = {
  PR_REVIEW_STALLED: {
    severity: "MEDIUM",
    thresholds: { hours: 24 },
  },
  TICKET_STATUS_AGING: {
    severity: "MEDIUM",
    thresholds: {
      inProgressHoursBySp: IN_PROGRESS_HOURS_BY_SP,
      codeReviewHours: 24,
      testingHours: 48,
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
      // Alert when ToDo tickets remain this close (hours) to sprint end.
      toDoBeforeSprintEndLeadTimeHours: 48,
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
