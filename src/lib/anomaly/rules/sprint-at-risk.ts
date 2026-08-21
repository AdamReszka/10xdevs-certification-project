import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  clamp01,
  hoursBetween,
  indexBy,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";

type SprintRiskThresholds = {
  maxParallelByCategory: Record<string, number>;
  toDoBeforeSprintEndLeadTimeHours: number;
};

const PARALLEL_CATEGORIES = ["IN_PROGRESS", "CODE_REVIEW", "TESTING"] as const;

/**
 * SPRINT_AT_RISK — emitted per triggering CONDITION (not one aggregate), each kept
 * strictly team/sprint-level per the PRD guardrail (no per-developer performance
 * framing):
 *  1. max-parallel: a roster member holding more tickets in a category than the
 *     team guideline — framed as a flow imbalance; `relatedTeamMemberId` only
 *     targets the rebalance action.
 *  2. ToDo-before-end: To Do tickets still open within the lead-time window before
 *     sprint end — sprint-level, no member attribution.
 * Absence weighting is added in S-08.
 */
export const detectSprintAtRisk: Detector = (snapshot, effective, now) => {
  const { severity, thresholds } = effective.SPRINT_AT_RISK;
  const t = thresholds as unknown as SprintRiskThresholds;
  const byJira = indexBy(snapshot.teamMembers, (m) => m.jiraAccountId);
  const out: DetectedAnomaly[] = [];

  // --- 1. Max-parallel per roster member per category -----------------------
  for (const member of snapshot.teamMembers) {
    if (!member.jiraAccountId) continue;
    for (const category of PARALLEL_CATEGORIES) {
      const limit = t.maxParallelByCategory[category];
      if (limit == null) continue;
      const count = snapshot.tickets.filter(
        (tk) =>
          tk.currentCategory === category &&
          tk.assigneeJiraAccountId === member.jiraAccountId,
      ).length;
      if (count <= limit) continue;

      const label = CATEGORY_LABEL[category] ?? category;
      out.push({
        type: "SPRINT_AT_RISK",
        severity,
        dedupKey: `SPRINT_AT_RISK:parallel:${member.id}:${category}`,
        description: `${count} tickets held in parallel in ${label} (team guideline ${limit}) — a flow bottleneck for the sprint.`,
        suggestedAction: suggestedAction.sprintAtRiskParallel({
          name: member.name,
          count,
          label,
          limit,
        }),
        context: {
          condition: "max_parallel",
          category,
          count,
          limit,
          teamMemberId: member.id,
        },
        sourceUrl: null,
        relatedTeamMemberId: member.id,
        magnitude: clamp01((count - limit) / limit),
      });
    }
  }

  // --- 2. ToDo tickets remaining near sprint end ----------------------------
  const endDate = snapshot.sprint.endDate;
  if (endDate) {
    const hoursLeft = hoursBetween(now, endDate);
    if (hoursLeft <= t.toDoBeforeSprintEndLeadTimeHours) {
      const todo = snapshot.tickets.filter((tk) => tk.currentCategory === "TODO");
      if (todo.length > 0) {
        const todoSp = todo.reduce((s, tk) => s + (tk.storyPoints ?? 0), 0);
        const committed = snapshot.sprint.committedSp ?? 0;
        const magnitude =
          committed > 0 ? clamp01(todoSp / committed) : todo.length > 0 ? 1 : 0;
        out.push({
          type: "SPRINT_AT_RISK",
          severity,
          dedupKey: `SPRINT_AT_RISK:todo_near_end:${snapshot.sprint.id}`,
          description: `${todo.length} ticket(s) still in To Do with ${round(hoursLeft)}h left in the sprint.`,
          suggestedAction: suggestedAction.sprintAtRiskTodoNearEnd({
            count: todo.length,
            hours: round(hoursLeft),
          }),
          context: {
            condition: "todo_near_end",
            todoCount: todo.length,
            todoSp,
            hoursLeft: round(hoursLeft),
          },
          sourceUrl: null,
          relatedTeamMemberId: null,
          magnitude,
        });
      }
    }
  }

  return out;
};
