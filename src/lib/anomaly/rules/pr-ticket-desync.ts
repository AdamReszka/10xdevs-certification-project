import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  indexBy,
  type Detector,
} from "@/lib/anomaly/rules/helpers";

/**
 * PR_TICKET_DESYNC — a merged PR whose linked ticket is not yet Done (a workflow
 * desync: code shipped, ticket left behind). Uses the ingestion-time
 * `linked_ticket_key`. Skipped when the ticket isn't in the current sprint snapshot
 * (can't assert its status). Binary condition → magnitude 1.
 */
export const detectPrTicketDesync: Detector = (snapshot, effective) => {
  const { severity } = effective.PR_TICKET_DESYNC;
  const byGithub = indexBy(snapshot.teamMembers, (m) => m.githubUsername);
  const ticketByKey = new Map(snapshot.tickets.map((t) => [t.jiraKey, t]));
  const out: DetectedAnomaly[] = [];

  for (const pr of snapshot.pullRequests) {
    if (pr.state !== "MERGED" || !pr.linkedTicketKey) continue;
    const ticket = ticketByKey.get(pr.linkedTicketKey);
    if (!ticket) continue; // ticket not in this sprint → can't assert desync
    if (ticket.currentCategory === "DONE") continue;

    const label = ticket.currentCategory
      ? CATEGORY_LABEL[ticket.currentCategory] ?? ticket.currentCategory
      : "an open status";
    const author = pr.authorGithubUsername
      ? byGithub.get(pr.authorGithubUsername)
      : undefined;

    out.push({
      type: "PR_TICKET_DESYNC",
      severity,
      dedupKey: `PR_TICKET_DESYNC:pr:${pr.githubPrId}`,
      description: `PR #${pr.number} is merged but ${pr.linkedTicketKey} is still in ${label}.`,
      suggestedAction: suggestedAction.prTicketDesync({
        number: pr.number ?? 0,
        key: pr.linkedTicketKey,
        category: ticket.currentCategory ?? "",
        label,
      }),
      context: {
        pullRequestId: pr.id,
        number: pr.number,
        linkedTicketKey: pr.linkedTicketKey,
        ticketCategory: ticket.currentCategory,
      },
      sourceUrl: pr.sourceUrl,
      relatedTeamMemberId: author?.id ?? null,
      magnitude: 1,
    });
  }
  return out;
};
