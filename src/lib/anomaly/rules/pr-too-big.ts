import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import { clamp01, indexBy, type Detector } from "@/lib/anomaly/rules/helpers";

/**
 * PR_TOO_BIG — an open (or recently-merged) PR whose additions+deletions exceed the
 * size guideline. Recently-merged = merged on/after the sprint start, so long-closed
 * PRs aren't re-flagged every cycle. Pure GitHub signal, no ticket link required.
 */
export const detectPrTooBig: Detector = (snapshot, effective) => {
  const { severity, thresholds } = effective.PR_TOO_BIG;
  const maxLines = (thresholds as { maxLines: number }).maxLines;
  const byGithub = indexBy(snapshot.teamMembers, (m) => m.githubUsername);
  const sprintStart = snapshot.sprint.startDate;
  const out: DetectedAnomaly[] = [];

  for (const pr of snapshot.pullRequests) {
    const recentlyMerged =
      pr.state === "MERGED" &&
      pr.mergedAt != null &&
      (!sprintStart || pr.mergedAt >= sprintStart);
    if (pr.state !== "OPEN" && !recentlyMerged) continue;

    const lines = (pr.additions ?? 0) + (pr.deletions ?? 0);
    if (lines <= maxLines) continue;

    const author = pr.authorGithubUsername
      ? byGithub.get(pr.authorGithubUsername)
      : undefined;

    out.push({
      type: "PR_TOO_BIG",
      severity,
      dedupKey: `PR_TOO_BIG:pr:${pr.githubPrId}`,
      description: `PR #${pr.number} "${pr.title ?? "(untitled)"}" changes ${lines} lines (guideline ${maxLines}).`,
      suggestedAction: suggestedAction.prTooBig({
        number: pr.number ?? 0,
        lines,
        limit: maxLines,
      }),
      context: {
        pullRequestId: pr.id,
        number: pr.number,
        lines,
        maxLines,
      },
      sourceUrl: pr.sourceUrl,
      relatedTeamMemberId: author?.id ?? null,
      magnitude: clamp01((lines - maxLines) / maxLines),
    });
  }
  return out;
};
