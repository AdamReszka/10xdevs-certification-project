import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  clamp01,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";
import {
  WORK_HOURS_PER_DAY,
  workingHoursBefore,
  workingHoursBetween,
} from "@/lib/anomaly/rules/working-time";

/** Word-boundary, case-insensitive match of a Jira key inside a commit message.
 * Commits carry no synced `branch`, so the message is the only correlation surface. */
function messageReferencesKey(message: string | null, jiraKey: string): boolean {
  if (!message) return false;
  const escaped = jiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(message);
}

/**
 * TICKET_NO_COMMIT_LINK — a ticket In Progress for ≥ the no-commit window with no
 * commit referencing its key in that window. Correlates Jira state with GitHub
 * commit messages (branch is not synced). Distinct from DEVELOPER_INACTIVE: this
 * is ticket-centric (the work item has no code trace), not developer-centric.
 *
 * BOTH HALVES ARE ASKED OVER WORKING DAYS (S-28). The rule asks two questions —
 * "is the ticket old enough to expect commits" and "has anything referenced it
 * lately" — and both are measured by `working-time.ts`, so a ticket picked up on
 * Friday afternoon is not two days old on Sunday. `noCommitDays` keeps its name
 * and its value; its days are now days the team could have committed on, and the
 * age this rule reports is stated in the unit it was measured in.
 */
export const detectTicketNoCommitLink: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.TICKET_NO_COMMIT_LINK;
  const noCommitDays = (thresholds as { noCommitDays: number }).noCommitDays;
  const windowHours = noCommitDays * WORK_HOURS_PER_DAY;
  const windowStart = workingHoursBefore(
    now,
    windowHours,
    snapshot.sprint.workingDays,
    snapshot.timeZone,
    snapshot.nonWorkingDays,
  );
  const out: DetectedAnomaly[] = [];

  for (const ticket of snapshot.tickets) {
    if (ticket.currentCategory !== "IN_PROGRESS") continue;
    const since = ticket.lastStatusChangeAt;
    if (!since) continue;

    const hoursInProgress = workingHoursBetween(
      since,
      now,
      snapshot.sprint.workingDays,
      snapshot.timeZone,
      snapshot.nonWorkingDays,
    );
    if (hoursInProgress < windowHours) continue; // too fresh to expect commits
    const daysInProgress = hoursInProgress / WORK_HOURS_PER_DAY;

    const linkedRecently = snapshot.commits.some(
      (c) =>
        c.authoredAt != null &&
        c.authoredAt >= windowStart &&
        messageReferencesKey(c.message, ticket.jiraKey),
    );
    if (linkedRecently) continue;

    out.push({
      type: "TICKET_NO_COMMIT_LINK",
      severity,
      dedupKey: `TICKET_NO_COMMIT_LINK:ticket:${ticket.jiraKey}`,
      description: `${ticket.jiraKey} "${ticket.summary ?? ""}" has been In Progress ${round(daysInProgress)} working days with no commit referencing it.`,
      suggestedAction: suggestedAction.ticketNoCommitLink({
        key: ticket.jiraKey,
        days: round(daysInProgress),
      }),
      context: {
        ticketId: ticket.id,
        jiraKey: ticket.jiraKey,
        daysInProgress: round(daysInProgress),
        noCommitDays,
      },
      sourceUrl: ticket.sourceUrl,
      relatedTeamMemberId: null,
      magnitude: clamp01(daysInProgress / (2 * noCommitDays)),
    });
  }
  return out;
};
