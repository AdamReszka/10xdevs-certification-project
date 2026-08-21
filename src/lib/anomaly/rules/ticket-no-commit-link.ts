import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  MS_PER_DAY,
  clamp01,
  daysBetween,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";

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
 */
export const detectTicketNoCommitLink: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.TICKET_NO_COMMIT_LINK;
  const noCommitDays = (thresholds as { noCommitDays: number }).noCommitDays;
  const windowStart = new Date(now.getTime() - noCommitDays * MS_PER_DAY);
  const out: DetectedAnomaly[] = [];

  for (const ticket of snapshot.tickets) {
    if (ticket.currentCategory !== "IN_PROGRESS") continue;
    const since = ticket.lastStatusChangeAt;
    if (!since) continue;

    const daysInProgress = daysBetween(since, now);
    if (daysInProgress < noCommitDays) continue; // too fresh to expect commits

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
      description: `${ticket.jiraKey} "${ticket.summary ?? ""}" has been In Progress ${round(daysInProgress)}d with no commit referencing it.`,
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
