import { detectDeveloperInactive } from "@/lib/anomaly/rules/developer-inactive";
import { detectPrReviewStalled } from "@/lib/anomaly/rules/pr-review-stalled";
import { detectPrTicketDesync } from "@/lib/anomaly/rules/pr-ticket-desync";
import { detectPrTooBig } from "@/lib/anomaly/rules/pr-too-big";
import { detectScopeCreep } from "@/lib/anomaly/rules/scope-creep";
import { detectSprintAtRisk } from "@/lib/anomaly/rules/sprint-at-risk";
import { detectTicketNoCommitLink } from "@/lib/anomaly/rules/ticket-no-commit-link";
import { detectTicketStatusAging } from "@/lib/anomaly/rules/ticket-status-aging";
import type { Detector } from "@/lib/anomaly/rules/helpers";

/**
 * The 8 detection rules (FR-013). The orchestrator runs every entry over the same
 * snapshot; order here does not affect correctness (default inbox ordering is
 * applied at read time by severity → recency).
 */
export const ALL_DETECTORS: Detector[] = [
  detectPrReviewStalled,
  detectTicketStatusAging,
  detectDeveloperInactive,
  detectTicketNoCommitLink,
  detectSprintAtRisk,
  detectPrTooBig,
  detectScopeCreep,
  detectPrTicketDesync,
];

export {
  detectDeveloperInactive,
  detectPrReviewStalled,
  detectPrTicketDesync,
  detectPrTooBig,
  detectScopeCreep,
  detectSprintAtRisk,
  detectTicketNoCommitLink,
  detectTicketStatusAging,
};
