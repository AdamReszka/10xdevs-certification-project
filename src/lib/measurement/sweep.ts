import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import {
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  sprint,
  sprintMeasurement,
  type SelectSprint,
} from "@/db/schema";
import { getSprintCapacityFor } from "@/lib/dashboard/capacity";
import { computeDeliveredSp, firstDoneAtByTicket } from "@/lib/dashboard/first-done";
import type { getDb } from "@/lib/db";

/**
 * S-23 Phase 4 — the per-sprint measurement sweep (FR-023).
 *
 * A SWEEP, NOT A HOOK, deliberately. Hanging the write off
 * `reconcileActiveSprint`'s `switched` flag would mean a stalled cron or an
 * expired token at the exact moment of rollover loses that sprint FOREVER —
 * the class of silent, one-sprint-at-a-time loss the framing named as the
 * substance of the problem. "Every sprint without a current record: compute and
 * write" delays the record instead of losing it.
 */

/** The three sprint columns the finalization decision reads. */
export type FinalizeCandidate = {
  state: SelectSprint["state"];
  endDate: Date | null;
  committedFrozenAt: Date | null;
};

/**
 * Is this sprint over AND measurable — i.e. may its record be frozen?
 *
 * Two independent "it is over" signals, because Jira's state flip is not
 * prompt: the reported `CLOSED`, and a `end_date` the clock has passed. Waiting
 * only for the flip would leave the record open to post-close rewriting, which
 * is the defect FR-023 exists to close.
 *
 * The `committed_frozen_at` precondition is NOT a nicety. Phase 3 freezes
 * `committed_sp` only on a FULL Jira pull (the sum runs over the whole ticket
 * table while `added_after_sprint_start` is rewritten only for the issues a
 * cycle pulled), so a sprint can legitimately sit unfrozen for a while.
 * Finalizing then would bake in a commitment that was still moving, and every
 * later normalisation would divide by a denominator nobody committed to. A
 * sprint that closed without ever being frozen is FR-023's honest "no data".
 */
export function shouldFinalize(sprint: FinalizeCandidate, now: Date): boolean {
  if (sprint.committedFrozenAt === null) return false;
  if (sprint.state === "CLOSED") return true;
  return sprint.endDate !== null && sprint.endDate.getTime() <= now.getTime();
}

/**
 * May the sweep write the computed columns of this record?
 *
 * Absent record → yes. Open record → yes, it tracks the running sprint. Once
 * `finalized_at` is stamped the record is a historical fact and no later cycle
 * may move it — which is what makes the series durable rather than a rolling
 * snapshot.
 */
export function shouldRecompute(existing: { finalizedAt: Date | null } | null): boolean {
  return existing === null || existing.finalizedAt === null;
}

type Db = ReturnType<typeof getDb>;

/** `numeric(8,2)` is a STRING on the wire in both directions (`lib/fte.ts`). */
function mdToColumn(value: number): string {
  return value.toFixed(2);
}

export type SweepResult = {
  /** Records written or refreshed this run. */
  upserted: number;
  /** Of those, the ones this run turned into history. */
  finalized: number;
};

/**
 * Record what each of the owner's sprints WAS, once per sync cycle (FR-023).
 *
 * Runs over EVERY sprint row the owner has, not just the active one, and skips
 * any record already finalized — which is what lets a sweep that first runs days
 * after a rollover still capture the sprint it slept through. The cost of being
 * late is a delayed record; the cost of a hook would have been no record at all.
 *
 * Idempotent by construction: a second call with the same `now` writes the same
 * values through the `(owner_id, jira_sprint_id)` conflict target, and touches
 * nothing at all once a record is finalized.
 *
 * The lead's `capacity_override_md` / `delivered_sp_corrected` are absent from
 * the conflict SET on purpose — a sweep that clobbered a correction would make
 * the correction path worthless (FR-022, FR-023).
 */
export async function sweepSprintMeasurements({
  db,
  ownerId,
  now,
}: {
  db: Db;
  ownerId: string;
  now: Date;
}): Promise<SweepResult> {
  // Joined to `jira_project` for the JIRA-SIDE project id: that, not the
  // internal row id, is the team identity the record is filed under, because the
  // settings path updates the project row IN PLACE on a switch.
  const rows = await db
    .select({ sprint, jiraProjectKey: jiraProject.jiraProjectId })
    .from(sprint)
    .innerJoin(jiraProject, eq(sprint.jiraProjectId, jiraProject.id))
    .where(eq(sprint.ownerId, ownerId));
  if (rows.length === 0) return { upserted: 0, finalized: 0 };

  const existing = await db
    .select({
      jiraSprintId: sprintMeasurement.jiraSprintId,
      finalizedAt: sprintMeasurement.finalizedAt,
    })
    .from(sprintMeasurement)
    .where(eq(sprintMeasurement.ownerId, ownerId));
  const known = new Map(existing.map((r) => [r.jiraSprintId, r]));

  // Delivered SP is recomputed from the OWNER'S WHOLE ticket set, deliberately
  // NOT narrowed by `jira_ticket.sprint_id`. The sync re-stamps a carried-over
  // ticket into the next sprint, so a sprint-scoped sum would silently lose the
  // work that sprint actually finished. Under one monitored Jira project, a
  // ticket whose FIRST entry into Done falls inside a sprint's window belongs to
  // that sprint, so the window alone is a sufficient predicate.
  const [tickets, doneTransitions] = await Promise.all([
    db
      .select({ ticketId: jiraTicket.id, storyPoints: jiraTicket.storyPoints })
      .from(jiraTicket)
      .where(eq(jiraTicket.ownerId, ownerId)),
    db
      .select({
        ticketId: jiraStatusHistory.ticketId,
        toCategory: jiraStatusHistory.toCategory,
        changedAt: jiraStatusHistory.changedAt,
      })
      .from(jiraStatusHistory)
      .where(
        and(
          eq(jiraStatusHistory.ownerId, ownerId),
          eq(jiraStatusHistory.toCategory, "DONE"),
        ),
      ),
  ]);
  const firstDoneAt = firstDoneAtByTicket(doneTransitions);

  let upserted = 0;
  let finalized = 0;

  for (const { sprint: sprintRow, jiraProjectKey } of rows) {
    if (!shouldRecompute(known.get(sprintRow.jiraSprintId) ?? null)) continue;

    // A sprint without both dates has no window, so neither its working days nor
    // its delivered SP are answerable. No record beats a fabricated one.
    const capacity = await getSprintCapacityFor(db, ownerId, sprintRow);
    if (capacity === null) continue;

    const deliveredSp = computeDeliveredSp({
      tickets,
      firstDoneAt,
      sprintStart: capacity.sprintStart,
      sprintEnd: capacity.sprintEnd,
      now,
    });
    const finalizeNow = shouldFinalize(sprintRow, now);

    const measured = {
      jiraProjectId: jiraProjectKey,
      sprintName: sprintRow.name,
      startDate: capacity.sprintStart,
      endDate: capacity.sprintEnd,
      workingDays: capacity.capacity.sprintWorkingDays,
      capacityFullMd: mdToColumn(capacity.capacity.nominalMd),
      capacityAdjustedMd: mdToColumn(capacity.capacity.adjustedMd),
      // COPIED, never recomputed — see the column's note in `schema.ts`.
      committedSp: sprintRow.committedSp,
      committedFrozenAt: sprintRow.committedFrozenAt,
      deliveredSp,
      state: sprintRow.state,
      finalizedAt: finalizeNow ? now : null,
      measuredAt: now,
      updatedAt: now,
    };

    await db
      .insert(sprintMeasurement)
      .values({
        id: randomUUID(),
        ownerId,
        jiraSprintId: sprintRow.jiraSprintId,
        createdAt: now,
        ...measured,
      })
      .onConflictDoUpdate({
        target: [sprintMeasurement.ownerId, sprintMeasurement.jiraSprintId],
        set: measured,
        // The finalization guard, enforced by POSTGRES rather than by the map
        // read above (impl-review F1). `shouldRecompute` is a cheap early-out
        // that saves four capacity queries; it is not a lock. Two sweeps can
        // overlap — the 15-minute cron and a user's "Sync now" — and one that
        // started before the sprint ended would otherwise write its
        // `finalizedAt: null` over a row the other just froze. This repo has
        // already settled the same argument once in writing
        // (`team-day-off-store.ts`): an insert that has to ask "is it already
        // there?" first races, and a constraint the database evaluates cannot.
        setWhere: isNull(sprintMeasurement.finalizedAt),
      });

    upserted += 1;
    if (finalizeNow) finalized += 1;
    // Both counters are best-effort telemetry, not a guarantee: `setWhere` can
    // refuse a write this loop decided to make. Over-reporting by one in a race
    // is the honest cost of not adding a round trip to count it exactly.
  }

  return { upserted, finalized };
}
