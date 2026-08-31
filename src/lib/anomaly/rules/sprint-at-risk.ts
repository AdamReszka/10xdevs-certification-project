import { overlaps } from "@/lib/absence-dates";
import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import {
  CATEGORY_LABEL,
  clamp01,
  countWorkingDaysInclusive,
  indexBy,
  round,
  type Detector,
} from "@/lib/anomaly/rules/helpers";
import { workingHoursBetween } from "@/lib/anomaly/rules/working-time";

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
    // WORKING hours, not calendar hours (S-28). This is the one place in the
    // slice where the change makes a number LESS like the calendar: "16 hours
    // left" now means two working days, which is why every surface that renders
    // it names the unit. One unit governs the whole engine — a lead-time in
    // wall-clock hours beside budgets in working hours would be unreadable.
    const hoursLeft = workingHoursBetween(
      now,
      endDate,
      snapshot.workingDays,
      snapshot.timeZone,
      snapshot.nonWorkingDays,
    );
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
          description: `${todo.length} ticket(s) still in To Do with ${round(hoursLeft)} working hours left in the sprint.`,
          suggestedAction: suggestedAction.sprintAtRiskTodoNearEnd({
            count: todo.length,
            hours: round(hoursLeft),
          }),
          context: {
            condition: "todo_near_end",
            todoCount: todo.length,
            todoSp,
            /** WORKING hours (S-28), eight to the day — not calendar hours. The
             *  key keeps its name so stored anomaly contexts stay readable. */
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
  // Matched by DATES, like every other absence reader in this codebase
  // (capacity.ts:164-176, developer-inactive.ts:47, absence-store.ts:103,263,
  // load-snapshot.ts:90-99). It used to be scoped to `absence.sprint_id`
  // instead — S-08's D2 rule, REVERSED 2026-08-30 (S-20) by the owner: risk
  // follows the absence's dates into whichever sprint they fall in.
  //
  // D2 feared an absence that "keeps raising risk after the rollover, forever".
  // It cannot: `overlaps(absence, now, endDate)` below stops firing the moment
  // the absence ends, so the exposure is the one rollover the absence actually
  // spans. `sprint_id` also records write-time provenance — which sprint was
  // active when the lead typed the row — not membership, so comparing it
  // answered a different question from the one asked here. A NULL stamp is
  // unequal to every sprint id, which is why the old predicate silently
  // dropped between-sprints absences in EVERY sprint (impl-review F10) —
  // lessons.md, "a narrowing predicate turns 'wrong value' into 'empty
  // result'". `is_planned` remains the surprise flag; only the scoping changed.
  if (endDate) {
    // The team-wide day-off calendar is passed here and below (S-23, FR-007): a
    // sprint ending across a public holiday has one fewer working day left, and
    // an absence spanning that holiday costs one fewer. Omitting it at either
    // site would put a ratio between two counters that disagree.
    const workingDaysLeft = countWorkingDaysInclusive(
      now,
      endDate,
      snapshot.workingDays,
      snapshot.timeZone,
      snapshot.nonWorkingDays,
    );

    for (const absence of snapshot.absences) {
      // Strict `false`, per the `scope-creep.ts` precedent — never a truthiness
      // check on a column that used to be nullable.
      if (absence.isPlanned !== false) continue;
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
        snapshot.workingDays,
        snapshot.timeZone,
        snapshot.nonWorkingDays,
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
        description: `${name} is unexpectedly away for ${workingDaysLost} of the ${workingDaysLeft} working day(s) left in the sprint.`,
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
