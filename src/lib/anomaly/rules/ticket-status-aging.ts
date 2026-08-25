import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  clamp01,
  countWorkingDays,
  hoursBetween,
  indexBy,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";

type AgingThresholds = {
  inProgressHoursBySp: Record<string, number | "8_WORKING_DAYS">;
  codeReviewHours: number;
  testingHours: number;
};

/** Resolve the In-Progress budget for a story-point estimate: exact bucket, else
 * the nearest defined bucket ≤ sp, else the smallest bucket. Returns the raw
 * value (hours or the working-day sentinel), or null when sp is unknown. */
function inProgressBudget(
  sp: number | null,
  map: Record<string, number | "8_WORKING_DAYS">,
): number | "8_WORKING_DAYS" | null {
  if (sp == null) return null;
  const keys = Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b);
  if (keys.length === 0) return null;
  if (map[String(sp)] !== undefined) return map[String(sp)];
  let chosen = keys[0];
  for (const k of keys) if (k <= sp) chosen = k;
  return map[String(chosen)];
}

/**
 * TICKET_STATUS_AGING — a ticket sitting in In Progress / Code Review / Testing
 * longer than the category budget. In Progress is story-point-aware (FR-009); the
 * `8_WORKING_DAYS` bucket (21 SP) is resolved against the sprint's working-day
 * calendar. Tickets with an unknown SP get no In-Progress budget (skipped).
 */
export const detectTicketStatusAging: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.TICKET_STATUS_AGING;
  const t = thresholds as unknown as AgingThresholds;
  const byJira = indexBy(snapshot.teamMembers, (m) => m.jiraAccountId);
  const out: DetectedAnomaly[] = [];

  for (const ticket of snapshot.tickets) {
    const cat = ticket.currentCategory;
    if (cat !== "IN_PROGRESS" && cat !== "CODE_REVIEW" && cat !== "TESTING") {
      continue;
    }
    const since = ticket.lastStatusChangeAt;
    if (!since) continue;

    let triggered = false;
    let magnitude = 0;

    if (cat === "IN_PROGRESS") {
      const budget = inProgressBudget(ticket.storyPoints, t.inProgressHoursBySp);
      if (budget == null) continue;
      if (budget === "8_WORKING_DAYS") {
        const elapsed = countWorkingDays(
          since,
          now,
          snapshot.sprint.workingDays,
          snapshot.timeZone,
        );
        triggered = elapsed >= 8;
        magnitude = clamp01(elapsed / 16);
      } else {
        const ageHours = hoursBetween(since, now);
        triggered = ageHours >= budget;
        magnitude = clamp01(ageHours / (2 * budget));
      }
    } else {
      const budget = cat === "CODE_REVIEW" ? t.codeReviewHours : t.testingHours;
      const ageHours = hoursBetween(since, now);
      triggered = ageHours >= budget;
      magnitude = clamp01(ageHours / (2 * budget));
    }

    if (!triggered) continue;

    const label = CATEGORY_LABEL[cat] ?? cat;
    const assignee = ticket.assigneeJiraAccountId
      ? byJira.get(ticket.assigneeJiraAccountId)
      : undefined;

    out.push({
      type: "TICKET_STATUS_AGING",
      severity,
      dedupKey: `TICKET_STATUS_AGING:ticket:${ticket.jiraKey}`,
      description: `${ticket.jiraKey} "${ticket.summary ?? ""}" has sat in ${label} since ${since.toISOString().slice(0, 10)}, past the team's aging budget.`,
      suggestedAction: suggestedAction.ticketStatusAging({
        key: ticket.jiraKey,
        category: cat,
        label,
      }),
      context: {
        ticketId: ticket.id,
        jiraKey: ticket.jiraKey,
        category: cat,
        storyPoints: ticket.storyPoints,
        sinceIso: since.toISOString(),
      },
      sourceUrl: ticket.sourceUrl,
      relatedTeamMemberId: assignee?.id ?? null,
      magnitude,
    });
  }
  return out;
};
