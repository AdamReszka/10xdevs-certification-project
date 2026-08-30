import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  clamp01,
  indexBy,
  type Detector,
} from "@/lib/anomaly/rules/helpers";
import { workingHoursBetween } from "@/lib/anomaly/rules/working-time";

type AgingThresholds = {
  inProgressHoursBySp: Record<string, number>;
  codeReviewHours: number;
  testingHours: number;
};

/** Resolve the In-Progress budget for a story-point estimate: exact bucket, else
 * the nearest defined bucket ≤ sp, else the smallest bucket. Returns working
 * hours, or null when sp is unknown. */
function inProgressBudget(
  sp: number | null,
  map: Record<string, number>,
): number | null {
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
 * longer than the category budget. In Progress is story-point-aware (FR-009);
 * tickets with an unknown SP get no In-Progress budget (skipped).
 *
 * EVERY BRANCH MEASURES IN WORKING HOURS (S-28). A ticket does not age on a night,
 * a weekend, or a day the whole team is off (S-23, FR-007) — the budget is a
 * budget of time somebody could have moved it, and none of those is that time.
 * Before S-28 this principle was stated here but applied to exactly one of the
 * five branches: the 21-SP bucket counted working days while every other bucket
 * counted wall-clock hours, so a 3 SP ticket moved to In Progress on Friday at
 * 16:00 fired on Sunday at 16:00 having consumed nothing but a weekend. With the
 * unit in working hours the `"8_WORKING_DAYS"` sentinel dissolves into an
 * ordinary 64 and all five branches share one measurement.
 *
 * WHAT DOES NOT PAUSE THE CLOCK: an individual's recorded absence (FR-010). The
 * sprint is the team's and the inbox is an alert for the lead, not a device
 * pointed at a person — a ticket left in Code Review does not become less stalled
 * because its assignee is on leave.
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

    let budget: number | null;
    if (cat === "IN_PROGRESS") {
      budget = inProgressBudget(ticket.storyPoints, t.inProgressHoursBySp);
    } else {
      budget = cat === "CODE_REVIEW" ? t.codeReviewHours : t.testingHours;
    }
    if (budget == null) continue;

    const ageHours = workingHoursBetween(
      since,
      now,
      snapshot.sprint.workingDays,
      snapshot.timeZone,
      snapshot.nonWorkingDays,
    );
    if (ageHours < budget) continue;
    const magnitude = clamp01(ageHours / (2 * budget));

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
