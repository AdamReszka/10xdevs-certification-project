import type { DayKey } from "@/lib/dashboard/day-bucket";

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
 * is the detection *context* every anomaly is attributed to.
 */
export type SprintSnapshot = {
  sprint: SelectSprint;
  tickets: SelectJiraTicket[];
  pullRequests: PullRequestWithReviews[];
  commits: SelectGithubCommit[];
  teamMembers: SelectTeamMember[];
  absences: SelectAbsence[];
  /**
   * The team's IANA zone from `jira_project.time_zone`, or null (S-08).
   *
   * Rules are pure over the snapshot, so every day-boundary decision they make
   * has to arrive this way. Without it `countWorkingDays` would bucket in the
   * server's zone while the dashboards bucket in the team's — the same day axis,
   * two answers. Null degrades to UTC through `safeZone`.
   */
  timeZone: string | null;
  /**
   * Days the WHOLE team is off — public holidays, company days off (S-23,
   * FR-007).
   *
   * Arrives through the snapshot for exactly the reason `timeZone` does: rules
   * are pure, so every day-boundary decision they make has to be handed to them.
   * A ticket does not age on a public holiday, and a day nobody was working is
   * not a working day lost to one person's absence — so a rule that could not
   * see this calendar would disagree with the capacity number computed from the
   * same dates. Empty set when the owner has recorded none.
   */
  nonWorkingDays: ReadonlySet<DayKey>;
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
