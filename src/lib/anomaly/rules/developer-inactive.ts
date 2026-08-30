import { overlaps } from "@/lib/absence-dates";
import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import { type Detector } from "@/lib/anomaly/rules/helpers";
import {
  WORK_HOURS_PER_DAY,
  workingHoursBefore,
} from "@/lib/anomaly/rules/working-time";

/**
 * DEVELOPER_INACTIVE — a team member with active assigned work (≥1 In-Progress
 * ticket) but zero commits authored within the no-commit window. Correlates Jira
 * assignment with GitHub authorship. Team/flow-framed — the member id targets the
 * check-in action, never a performance judgement.
 *
 * THE WINDOW IS N WORKING DAYS (S-28). `noCommitDays` keeps its name and its
 * value; what changes is that its days are days the team could have committed on.
 * A developer is not "silent for two days" because the two days were Saturday and
 * Sunday, and a Monday inbox that says so is the defect this slice closed.
 *
 * SUPPRESSED BY A RECORDED ABSENCE (S-08, FR-010): an absent developer with no
 * commits is explained, not anomalous, and an inbox that keeps flagging someone
 * the owner has already told it is on holiday teaches the lead to ignore the
 * inbox. Suppression is unconditional on absence type — sickness explains missing
 * commits exactly as vacation does.
 *
 * SUPPRESSION IS NOT THE CLOCK. The two mechanisms are deliberately separate: an
 * individual's absence does not pause the working-hour window (`working-time.ts`
 * counts the TEAM's calendar and nothing else), it removes this member from the
 * question entirely for as long as it overlaps that window. Folding one into the
 * other would make a half-covered absence shorten the window instead of
 * explaining it.
 *
 * WHY THE GUARD IS INSIDE THE RULE and not a roster pre-filter: `teamMembers` is
 * shared by five other detectors that index it for `relatedTeamMemberId`
 * attribution, so removing an absent member from that array would silently strip
 * attribution from unrelated anomalies. It is also not a post-detection filter,
 * because the window the absence has to overlap is the RULE's own evaluation
 * window, which only the rule knows.
 */
export const detectDeveloperInactive: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.DEVELOPER_INACTIVE;
  const noCommitDays = (thresholds as { noCommitDays: number }).noCommitDays;
  const windowStart = workingHoursBefore(
    now,
    noCommitDays * WORK_HOURS_PER_DAY,
    snapshot.sprint.workingDays,
    snapshot.timeZone,
    snapshot.nonWorkingDays,
  );
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

    // After the cheap ticket filter, before the commit scan: an absent developer
    // never reaches the "why has nobody committed?" question.
    const isAway = snapshot.absences.some(
      (a) => a.teamMemberId === member.id && overlaps(a, windowStart, now),
    );
    if (isAway) continue;

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
      description: `${member.name} has an In Progress ticket but no commits in the last ${noCommitDays} working days.`,
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
