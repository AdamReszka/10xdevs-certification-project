import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  clamp01,
  indexBy,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";
import { workingHoursBetween } from "@/lib/anomaly/rules/working-time";

/**
 * PR_REVIEW_STALLED — an OPEN, non-draft PR that has been ready for review longer
 * than the threshold with no review submitted since it became ready. `branch`-less
 * PRs need no ticket link. Draft PRs are excluded (their `readyForReviewAt` is null).
 *
 * The wait is measured in WORKING hours (S-28): a review clock stops overnight,
 * over the weekend and on a team-wide day off, because nobody was there to
 * review. Every number this rule reports therefore says "working hours" — an
 * unqualified `h` would read as a calendar claim the figure no longer makes.
 */
export const detectPrReviewStalled: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.PR_REVIEW_STALLED;
  const hours = (thresholds as { hours: number }).hours;
  const byGithub = indexBy(snapshot.teamMembers, (m) => m.githubUsername);
  const out: DetectedAnomaly[] = [];

  for (const pr of snapshot.pullRequests) {
    if (pr.state !== "OPEN") continue;
    if (!pr.readyForReviewAt) continue; // draft or unknown → not "ready"
    const ready = pr.readyForReviewAt;
    const reviewedSinceReady = pr.reviews.some(
      (r) => r.submittedAt != null && r.submittedAt >= ready,
    );
    if (reviewedSinceReady) continue;

    const ageHours = workingHoursBetween(
      ready,
      now,
      snapshot.workingDays,
      snapshot.timeZone,
      snapshot.nonWorkingDays,
    );
    if (ageHours < hours) continue;

    const author = pr.authorGithubUsername
      ? byGithub.get(pr.authorGithubUsername)
      : undefined;

    out.push({
      type: "PR_REVIEW_STALLED",
      severity,
      dedupKey: `PR_REVIEW_STALLED:pr:${pr.githubPrId}`,
      description: `PR #${pr.number} "${pr.title ?? "(untitled)"}" has awaited review for ${round(ageHours)} working hours (team target ${hours}).`,
      suggestedAction: suggestedAction.prReviewStalled({
        number: pr.number ?? 0,
        hours: round(ageHours),
      }),
      context: {
        pullRequestId: pr.id,
        number: pr.number,
        ageHours: round(ageHours),
        thresholdHours: hours,
      },
      sourceUrl: pr.sourceUrl,
      relatedTeamMemberId: author?.id ?? null,
      magnitude: clamp01(ageHours / (2 * hours)),
    });
  }
  return out;
};
