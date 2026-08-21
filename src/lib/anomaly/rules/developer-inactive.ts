import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  MS_PER_DAY,
  type Detector,
} from "@/lib/anomaly/rules/helpers";

/**
 * DEVELOPER_INACTIVE — a team member with active assigned work (≥1 In-Progress
 * ticket) but zero commits authored within the no-commit window. Correlates Jira
 * assignment with GitHub authorship. Absence-based suppression is wired in S-08
 * (this slice ships with `absences: []`, so no suppression). Team/flow-framed —
 * the member id targets the check-in action, never a performance judgement.
 */
export const detectDeveloperInactive: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.DEVELOPER_INACTIVE;
  const noCommitDays = (thresholds as { noCommitDays: number }).noCommitDays;
  const windowStart = new Date(now.getTime() - noCommitDays * MS_PER_DAY);
  const out: DetectedAnomaly[] = [];

  for (const member of snapshot.teamMembers) {
    if (!member.isActive) continue;
    if (!member.jiraAccountId || !member.githubUsername) continue;

    const hasActiveWork = snapshot.tickets.some(
      (t) =>
        t.currentCategory === "IN_PROGRESS" &&
        t.assigneeJiraAccountId === member.jiraAccountId,
    );
    if (!hasActiveWork) continue;

    const committedInWindow = snapshot.commits.some(
      (c) =>
        c.authorGithubUsername === member.githubUsername &&
        c.authoredAt != null &&
        c.authoredAt >= windowStart,
    );
    if (committedInWindow) continue;

    out.push({
      type: "DEVELOPER_INACTIVE",
      severity,
      dedupKey: `DEVELOPER_INACTIVE:member:${member.id}`,
      description: `${member.name} has an In Progress ticket but no commits in the last ${noCommitDays} days.`,
      suggestedAction: suggestedAction.developerInactive({
        name: member.name,
        days: noCommitDays,
      }),
      context: {
        teamMemberId: member.id,
        githubUsername: member.githubUsername,
        noCommitDays,
      },
      sourceUrl: null,
      relatedTeamMemberId: member.id,
      // Binary condition (active work + zero commits in window) → full magnitude.
      magnitude: 1,
    });
  }
  return out;
};
