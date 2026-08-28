import { and, desc, eq, isNotNull } from "drizzle-orm";

import { sprintMeasurement } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * The per-sprint measurement series (S-23, FR-023/FR-024) — the read side every
 * later phase averages over.
 *
 * FILTERED TO ONE JIRA PROJECT, always. The record deliberately outlives a
 * project switch, which means one owner's table can hold two different teams'
 * sprints; averaging across them would produce a number describing nobody. When
 * the current project has no history the honest answer is an empty series, and
 * FR-023 requires the surface to say "no data" rather than substitute a default
 * conversion.
 *
 * FINALIZED ROWS ONLY. An open record tracks a sprint that is still moving (or
 * one that closed without its commitment ever being frozen — see
 * `sweep.ts:shouldFinalize`), and neither is history. The active sprint's own
 * record is read separately.
 */

type Db = ReturnType<typeof getDb>;

/** One frozen sprint, numerics already converted at the boundary. */
export type SprintMeasurement = {
  id: string;
  ownerId: string;
  jiraProjectId: string;
  jiraSprintId: string;
  sprintName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  workingDays: number | null;
  capacityFullMd: number | null;
  capacityAdjustedMd: number | null;
  capacityOverrideMd: number | null;
  committedSp: number | null;
  deliveredSp: number | null;
  deliveredSpCorrected: number | null;
  committedFrozenAt: Date | null;
  state: "ACTIVE" | "CLOSED" | "FUTURE" | null;
  finalizedAt: Date | null;
  measuredAt: Date;
};

/**
 * The `pg` driver hands `numeric` back as a STRING (`'25.00'`, not `25`).
 * Converting HERE, once, is what keeps every consumer from having to remember —
 * the same boundary discipline `lib/fte.ts` applies to `team_member.fte`, and
 * the same trap that would otherwise make `===` comparisons quietly false.
 */
export function toMd(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** How many closed sprints a series read pulls unless the caller says otherwise. */
const DEFAULT_LIMIT = 12;

export async function listSprintMeasurements(
  db: Db,
  ownerId: string,
  jiraProjectId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SprintMeasurement[]> {
  const rows = await db
    .select()
    .from(sprintMeasurement)
    .where(
      and(
        eq(sprintMeasurement.ownerId, ownerId),
        eq(sprintMeasurement.jiraProjectId, jiraProjectId),
        isNotNull(sprintMeasurement.finalizedAt),
      ),
    )
    .orderBy(desc(sprintMeasurement.startDate))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    capacityFullMd: toMd(row.capacityFullMd),
    capacityAdjustedMd: toMd(row.capacityAdjustedMd),
    capacityOverrideMd: toMd(row.capacityOverrideMd),
  }));
}
