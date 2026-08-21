import type {
  SelectAbsence,
  SelectGithubCommit,
  SelectGithubPullRequest,
  SelectGithubReview,
  SelectJiraTicket,
  SelectSprint,
  SelectTeamMember,
  anomalyType,
  severity,
} from "@/db/schema";

/**
 * Shared contracts for the anomaly engine (S-06).
 *
 * `SprintSnapshot` is the in-memory correlated view the loader produces and every
 * pure detector consumes — no DB, no I/O inside a detector. `DetectedAnomaly` is
 * what a detector emits; the orchestrator maps it to an `anomaly` row (applying the
 * effective severity + risk score + the active sprint's id).
 *
 * `jira_status_history` is deliberately absent: no S-06 rule walks it (all use
 * `ticket.lastStatusChangeAt` / `currentCategory`); it is S-10's aging-report input.
 */

type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type SeverityValue = (typeof severity.enumValues)[number];

/** A synced PR with its (fully-replaced-per-sync) review rows. */
export type PullRequestWithReviews = SelectGithubPullRequest & {
  reviews: SelectGithubReview[];
};

/**
 * The correlated inputs for one owner's active sprint. PRs are scoped by the
 * owner's monitored repos (they have no sprint FK), not by the sprint; the sprint
 * is the detection *context* every anomaly is attributed to. `absences` is empty
 * this slice (S-08 wires real suppression on top without reshaping detectors).
 */
export type SprintSnapshot = {
  sprint: SelectSprint;
  tickets: SelectJiraTicket[];
  pullRequests: PullRequestWithReviews[];
  commits: SelectGithubCommit[];
  teamMembers: SelectTeamMember[];
  absences: SelectAbsence[];
};

/** One detected anomaly, pre-persistence. Carries the five FR-014 attributes plus
 * the stable dedup key and a normalized magnitude ∈ [0,1] the orchestrator turns
 * into `risk_score` via `severity × magnitude`. */
export type DetectedAnomaly = {
  type: AnomalyTypeValue;
  /** The rule's default (effective) severity; the orchestrator may still apply an
   * override, but detectors emit the resolved value they were handed. */
  severity: SeverityValue;
  dedupKey: string;
  description: string;
  suggestedAction: string;
  context: Record<string, unknown>;
  sourceUrl: string | null;
  relatedTeamMemberId: string | null;
  /** How far past threshold, capped to [0,1]; binary conditions emit 1. */
  magnitude: number;
};
