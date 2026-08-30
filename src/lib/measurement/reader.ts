import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { jiraProject, sprintMeasurement } from "@/db/schema";
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

/**
 * How far back the Sprint Detail switcher can reach (impl-review phase-7 F10).
 *
 * Deliberately larger than {@link DEFAULT_LIMIT}, because the two bounds answer
 * different questions: twelve sprints is a sensible window to AVERAGE over
 * (FR-024), but it is not a sensible limit on what a lead may LOOK at, and a
 * sprint past the ceiling is not merely absent from the list — a `?sprint=`
 * naming it falls into the unknown-id branch and silently renders the active
 * sprint instead. Sixty is roughly two and a half years of two-week sprints, so
 * the ceiling stops being reachable in the MVP's lifetime while the query stays
 * bounded.
 */
const SWITCHER_LIMIT = 60;

export async function listSprintMeasurements(
  db: Db,
  ownerId: string,
  jiraProjectId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SprintMeasurement[]> {
  return selectMeasurements(db, ownerId, jiraProjectId, limit, true);
}

/**
 * The same series with the FINALIZED filter lifted — the Sprint Detail switcher's
 * list (S-23 Phase 7).
 *
 * Separate from {@link listSprintMeasurements} rather than a flag on it, because
 * the two answer different questions and only one of them may ever feed FR-024:
 * an open record tracks a sprint still in flight, which is not history and must
 * not enter an average. It IS, however, a sprint the lead can look at — the
 * active one's own record is open by definition — so the switcher reads the
 * unfiltered set.
 */
export async function listRecordedSprints(
  db: Db,
  ownerId: string,
  jiraProjectId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SprintMeasurement[]> {
  return selectMeasurements(db, ownerId, jiraProjectId, limit, false);
}

async function selectMeasurements(
  db: Db,
  ownerId: string,
  jiraProjectId: string,
  limit: number,
  finalizedOnly: boolean,
): Promise<SprintMeasurement[]> {
  const rows = await db
    .select()
    .from(sprintMeasurement)
    .where(
      and(
        eq(sprintMeasurement.ownerId, ownerId),
        eq(sprintMeasurement.jiraProjectId, jiraProjectId),
        ...(finalizedOnly ? [isNotNull(sprintMeasurement.finalizedAt)] : []),
      ),
    )
    // NULLS LAST, explicitly (impl-review phase-7 F6). Postgres orders a DESC
    // sort NULLS FIRST, which cost nothing while every caller filtered on
    // `finalized_at IS NOT NULL` — the switcher's read lifts that filter, and
    // `writeLeadColumn` inserts a record carrying only the identity columns when
    // a lead overrides ahead of the sweep. Left alone, that start-date-less row
    // would sort above the newest sprint. `measured_at` breaks the tie among
    // rows that genuinely share a start date.
    .orderBy(
      sql`${sprintMeasurement.startDate} desc nulls last`,
      desc(sprintMeasurement.measuredAt),
    )
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    capacityFullMd: toMd(row.capacityFullMd),
    capacityAdjustedMd: toMd(row.capacityAdjustedMd),
    capacityOverrideMd: toMd(row.capacityOverrideMd),
  }));
}

/**
 * The same series for the owner's CURRENTLY monitored Jira project.
 *
 * A convenience over {@link listSprintMeasurements} for callers that hold an
 * owner but not the Jira-side project id — the dashboard holds the `sprint` row,
 * whose `jira_project_id` is the INTERNAL row id, while the record is filed
 * under the Jira-side one (the settings path updates the project row in place on
 * a switch, so the internal id survives a change of team and the Jira-side one
 * does not). One monitored project per account (PRD non-goal), hence `limit(1)`.
 *
 * No project ⇒ an empty series, which is the same honest "no data" an owner with
 * no closed sprints gets. Two sequential queries on ONE handle, not a second
 * fan-out: since S-21 the handle is memoized per request (`lessons.md` #3), so
 * one handle buys one round of reads rather than one pool.
 */
export async function listSprintMeasurementsForOwner(
  db: Db,
  ownerId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SprintMeasurement[]> {
  const jiraProjectId = await currentJiraProjectId(db, ownerId);
  if (jiraProjectId === null) return [];

  return listSprintMeasurements(db, ownerId, jiraProjectId, limit);
}

/**
 * {@link listRecordedSprints} for the owner's currently monitored project — what
 * the Sprint Detail switcher lists.
 *
 * Same project filter as the finalized series, and for the same reason: the
 * record outlives a project switch on purpose, so one owner's table can hold two
 * different teams' sprints. Offering the lead a sprint from a team they no
 * longer monitor would be offering them a page they cannot read.
 */
export async function listRecordedSprintsForOwner(
  db: Db,
  ownerId: string,
  limit: number = SWITCHER_LIMIT,
): Promise<SprintMeasurement[]> {
  const jiraProjectId = await currentJiraProjectId(db, ownerId);
  if (jiraProjectId === null) return [];

  return listRecordedSprints(db, ownerId, jiraProjectId, limit);
}

/** One monitored project per account (PRD non-goal), hence `limit(1)`. */
async function currentJiraProjectId(db: Db, ownerId: string): Promise<string | null> {
  const [project] = await db
    .select({ jiraProjectId: jiraProject.jiraProjectId })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);

  return project?.jiraProjectId ?? null;
}
