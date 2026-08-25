import { overlaps } from "@/lib/absence-dates";
import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  clamp01,
  countWorkingDaysInclusive,
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
 *  3. unplanned absence (S-08, FR-010): a mid-sprint absence the commitment did
 *     not account for, sized by the working days it removes from what is left.
 *
 * WHY (3) IS ITS OWN ANOMALY rather than extra weight on (1) or (2): the
 * per-anomaly score is `WEIGHT[severity] × magnitude × 100/3`, this rule is
 * already HIGH by default, and `todo_near_end` already reaches magnitude 1 —
 * there is nothing to raise. An additional row with its own dedupKey is the only
 * mechanism that reliably increases the risk the lead actually sees, and it
 * matches the one-anomaly-per-condition contract above.
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

  // --- 3. Unplanned mid-sprint absences (S-08, FR-010) ----------------------
  //
  // Scoped to absences stamped with THIS sprint: one carried over from an earlier
  // sprint was unplanned *there*, and by D2's definition is planned here — it
  // must stop raising risk at the rollover rather than forever.
  if (endDate) {
    const workingDaysLeft = countWorkingDaysInclusive(
      now,
      endDate,
      snapshot.sprint.workingDays,
      snapshot.timeZone,
    );

    for (const absence of snapshot.absences) {
      // Strict `false`, per the `scope-creep.ts` precedent — never a truthiness
      // check on a column that used to be nullable.
      if (absence.isPlanned !== false) continue;
      // KNOWN GAP (impl-review F10): `createAbsence` stamps NULL when the owner
      // has no active sprint, and nothing re-stamps it later — so an unplanned
      // absence recorded BETWEEN sprints can never raise risk, not even once the
      // sprint it falls inside starts. Re-stamping belongs with S-16 (sprint
      // reconciliation), which is what would notice the rollover.
      if (absence.sprintId !== snapshot.sprint.id) continue;
      if (!overlaps(absence, now, endDate)) continue;

      const member = snapshot.teamMembers.find((m) => m.id === absence.teamMemberId);
      const name = member?.name ?? "A team member";

      // Only the part of the absence still ahead, clipped to the sprint: days
      // already spent are not days the remaining plan can lose.
      const lostFrom =
        absence.startDate > now ? absence.startDate : now;
      const lostTo = absence.endDate < endDate ? absence.endDate : endDate;
      const workingDaysLost = countWorkingDaysInclusive(
        lostFrom,
        lostTo,
        snapshot.sprint.workingDays,
        snapshot.timeZone,
      );

      // Zero denominator ⇒ an absence on what is left costs the whole of what is
      // left. Mirrors the `committed > 0 ? … : 1` guard above; never NaN.
      const magnitude =
        workingDaysLeft > 0 ? clamp01(workingDaysLost / workingDaysLeft) : 1;

      out.push({
        type: "SPRINT_AT_RISK",
        severity,
        dedupKey: `SPRINT_AT_RISK:absence:${absence.id}`,
        // Magnitude 0 still emits: a Sat–Sun sickness costs no working days, but
        // the lead still needs to know somebody is unexpectedly away. The risk
        // score simply reads 0. This is the deliberate opposite of suppressing.
        description: `${name} is unexpectedly away for ${workingDaysLost} of the ${workingDaysLeft} working day(s) left in the sprint — the commitment did not account for it.`,
        suggestedAction: suggestedAction.sprintAtRiskAbsence({
          name,
          lost: workingDaysLost,
          left: workingDaysLeft,
        }),
        context: {
          condition: "absence",
          absenceId: absence.id,
          teamMemberId: absence.teamMemberId,
          workingDaysLost,
          workingDaysLeft,
        },
        sourceUrl: null,
        relatedTeamMemberId: absence.teamMemberId,
        magnitude,
      });
    }
  }

  return out;
};
