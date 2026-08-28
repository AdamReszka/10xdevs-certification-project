import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { jiraProject, sprint, sprintMeasurement } from "@/db/schema";
import type { getDb } from "@/lib/db";
import { type SprintMeasurement, toMd } from "@/lib/measurement/reader";
import { getActiveSprintRow } from "@/lib/sprint";

/**
 * The lead's two manual entries on a sprint measurement (S-23 Phase 5,
 * FR-022/FR-023): a capacity override in man-days, and a correction to the
 * delivered story points.
 *
 * WHY THEY ARE THEIR OWN COLUMNS, and their own writers. The whole point of
 * FR-023 is that a correction stays visible *as* a correction: the computed
 * figure and the lead's figure are both kept, so nobody later has to wonder
 * whether a number was measured or typed. Writing the lead's value into
 * `capacity_adjusted_md` would erase exactly that distinction, and would also be
 * undone by the next sweep, which owns those columns.
 *
 * THE SWEEP AND THESE WRITERS DO NOT COLLIDE, by construction on both sides.
 * `sweep.ts`'s conflict `set` omits `capacity_override_md` and
 * `delivered_sp_corrected`; the `set` here names ONLY the column being written.
 * Neither needs to know what the other computed.
 *
 * THE FINALIZATION GUARD DOES NOT APPLY HERE, deliberately. `sweep.ts` refuses
 * to touch a finalized record because a *measurement* is a historical fact. A
 * correction is the opposite: FR-023 exists so the lead can fix a closed
 * sprint's recorded figure, which is the only kind of sprint whose figure is
 * worth fixing. So no `setWhere` — but still nothing that moves a computed
 * column.
 *
 * Owner-scoped throughout, in the SQL rather than in a caller's discipline: the
 * sprint lookup carries `AND owner_id = ?`, so a `jiraSprintId` from another
 * account resolves to nothing and is refused rather than silently creating a
 * record filed under the caller.
 */

type Db = ReturnType<typeof getDb>;

/**
 * A submitted sprint id that is not in the caller's set.
 *
 * Mirrors `UnknownTeamDayOffError` / `UnknownAbsenceError`: a stale page, or a
 * crafted payload naming another account's sprint. Refused rather than ignored,
 * so the surface can say "reload" instead of showing a save that appeared to
 * work.
 */
export class UnknownSprintError extends Error {
  constructor(message = "That sprint does not belong to this account.") {
    super(message);
    this.name = "UnknownSprintError";
  }
}

/** `numeric(8,2)` is a STRING on the wire in both directions (`lib/fte.ts`). */
function mdToColumn(value: number): string {
  return value.toFixed(2);
}

/**
 * Set (or clear, with `null`) the sprint's capacity override in man-days.
 *
 * FR-022's marked exception: what the lead enters when reality diverges from
 * the model — a training week, an outage, half the team at a conference.
 */
export async function setCapacityOverride({
  db,
  ownerId,
  jiraSprintId,
  md,
  now = new Date(),
}: {
  db: Db;
  ownerId: string;
  jiraSprintId: string;
  md: number | null;
  now?: Date;
}): Promise<{ id: string }> {
  return writeLeadColumn({
    db,
    ownerId,
    jiraSprintId,
    now,
    patch: { capacityOverrideMd: md === null ? null : mdToColumn(md) },
  });
}

/**
 * Set (or clear, with `null`) the sprint's corrected delivered story points.
 *
 * FR-023's correction path. The computed `delivered_sp` beside it is untouched,
 * which is what makes the correction auditable — the very property the owner's
 * earlier "hand-enter it" note could never have had.
 */
export async function setDeliveredCorrection({
  db,
  ownerId,
  jiraSprintId,
  sp,
  now = new Date(),
}: {
  db: Db;
  ownerId: string;
  jiraSprintId: string;
  sp: number | null;
  now?: Date;
}): Promise<{ id: string }> {
  return writeLeadColumn({
    db,
    ownerId,
    jiraSprintId,
    now,
    patch: { deliveredSpCorrected: sp },
  });
}

/**
 * The shared write: resolve the owner's sprint, then upsert ONLY the named
 * column.
 *
 * THE RECORD MAY NOT EXIST YET. The sweep writes one per cycle, so a lead who
 * overrides the active sprint's capacity within fifteen minutes of it starting
 * is ahead of it. Creating the row here — with the three NOT NULL identity
 * columns and nothing else — is what stops that from being a lost save. The
 * computed columns stay NULL for the sweep's next pass, which is free to fill
 * them precisely because `finalized_at` is still NULL.
 *
 * The Jira-side project id comes from the joined `jira_project` row, not from
 * the internal `sprint.jira_project_id`: that, as `sweep.ts` explains at length,
 * is the team identity the record is filed under, because a project switch
 * updates the project row IN PLACE.
 */
async function writeLeadColumn({
  db,
  ownerId,
  jiraSprintId,
  now,
  patch,
}: {
  db: Db;
  ownerId: string;
  jiraSprintId: string;
  now: Date;
  patch: { capacityOverrideMd?: string | null; deliveredSpCorrected?: number | null };
}): Promise<{ id: string }> {
  const [row] = await db
    .select({ jiraProjectKey: jiraProject.jiraProjectId, sprintName: sprint.name })
    .from(sprint)
    .innerJoin(jiraProject, eq(sprint.jiraProjectId, jiraProject.id))
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.jiraSprintId, jiraSprintId)))
    .limit(1);

  if (!row) throw new UnknownSprintError();

  const [written] = await db
    .insert(sprintMeasurement)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: row.jiraProjectKey,
      jiraSprintId,
      sprintName: row.sprintName,
      measuredAt: now,
      createdAt: now,
      updatedAt: now,
      ...patch,
    })
    .onConflictDoUpdate({
      target: [sprintMeasurement.ownerId, sprintMeasurement.jiraSprintId],
      // ONLY the lead's column, plus the timestamp. Naming any computed column
      // here would let a correction quietly overwrite a measurement — and would
      // reintroduce the rewriting FR-023 exists to stop.
      set: { ...patch, updatedAt: now },
    })
    .returning({ id: sprintMeasurement.id });

  return { id: written.id };
}

/**
 * One sprint's measurement record, numerics converted at the boundary.
 *
 * Returns `null` when no record exists yet — which is an ordinary state, not an
 * error: the sweep has simply not run since the sprint appeared, and the
 * surfaces fall back to the live computed figures.
 */
export async function getSprintMeasurement(
  db: Db,
  ownerId: string,
  jiraSprintId: string,
): Promise<SprintMeasurement | null> {
  const [row] = await db
    .select()
    .from(sprintMeasurement)
    .where(
      and(
        eq(sprintMeasurement.ownerId, ownerId),
        eq(sprintMeasurement.jiraSprintId, jiraSprintId),
      ),
    )
    .limit(1);

  if (!row) return null;

  // The `pg` driver hands `numeric` back as a STRING. Converting HERE, once, is
  // the same boundary discipline `reader.ts` and `lib/fte.ts` apply — and the
  // reason it is not optional: `'25.00' === 25` is false, so an unconverted read
  // would make the override compare unequal to itself.
  return {
    ...row,
    capacityFullMd: toMd(row.capacityFullMd),
    capacityAdjustedMd: toMd(row.capacityAdjustedMd),
    capacityOverrideMd: toMd(row.capacityOverrideMd),
  };
}

/**
 * The ACTIVE sprint's measurement record — the read the dashboard needs, and the
 * one the server actions resolve their target sprint through.
 *
 * Routed through `getActiveSprintRow` rather than a `state = 'ACTIVE'` join, so
 * "which sprint are we looking at" is answered in exactly one place: that
 * resolver also handles the between-sprints fallback (most recently started),
 * and a join here would silently disagree with the dashboard the moment a team
 * is between sprints.
 */
export async function getActiveSprintMeasurement(
  db: Db,
  ownerId: string,
): Promise<SprintMeasurement | null> {
  const active = await getActiveSprintRow(db, ownerId);
  if (active === null) return null;
  return getSprintMeasurement(db, ownerId, active.jiraSprintId);
}
