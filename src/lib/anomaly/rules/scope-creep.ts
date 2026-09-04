import { suggestedAction } from "@/lib/anomaly/suggested-action";
import type { DetectedAnomaly } from "@/lib/anomaly/types";
import { clamp01, round, type Detector } from "@/lib/anomaly/rules/helpers";

/**
 * SCOPE_CREEP — story points added after sprint start exceed the allowed percentage
 * of committed scope. One sprint-level anomaly. Skipped when committed SP is unknown
 * or zero (no denominator → no divide-by-zero, no meaningless percentage).
 */
export const detectScopeCreep: Detector = (snapshot, effective) => {
  const { severity, thresholds } = effective.SCOPE_CREEP;
  const percent = (thresholds as { percent: number }).percent;
  const committed = snapshot.sprint.committedSp ?? 0;
  if (committed <= 0) return [];

  const addedSp = snapshot.tickets
    .filter((t) => t.addedAfterSprintStart === true)
    .reduce((s, t) => s + (t.storyPoints ?? 0), 0);
  if (addedSp <= 0) return [];

  const actualPercent = (addedSp / committed) * 100;
  if (actualPercent <= percent) return [];

  return [
    {
      type: "SCOPE_CREEP",
      severity,
      dedupKey: `SCOPE_CREEP:sprint:${snapshot.sprint.id}`,
      description: `${addedSp} SP added after sprint start — ${round(actualPercent)}% of the ${committed} SP committed (guideline ${percent}%).`,
      suggestedAction: suggestedAction.scopeCreep({
        addedSp,
        percent: round(actualPercent),
      }),
      context: {
        sprintId: snapshot.sprint.id,
        addedSp,
        committedSp: committed,
        actualPercent: round(actualPercent),
        thresholdPercent: percent,
      },
      sourceUrl: snapshot.sprintBoardUrl,
      relatedTeamMemberId: null,
      magnitude: clamp01(actualPercent / (2 * percent)),
    },
  ];
};
