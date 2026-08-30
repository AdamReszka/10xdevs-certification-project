import { randomUUID } from "node:crypto";

import { and, eq, gte, lte, ne } from "drizzle-orm";

import { absence, teamMember, type SelectAbsence } from "@/db/schema";
import { absenceInstants } from "@/lib/absence-dates";
import type { DayKey } from "@/lib/dashboard/day-bucket";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import type { getDb } from "@/lib/db";
import { UnknownMemberError } from "@/lib/integrations/roster-store";
import { getActiveSprintRow } from "@/lib/sprint";
import type { AbsenceType } from "@/lib/validations/absence";

/**
 * Owner-scoped CRUD for recorded absences (S-08 / FR-010). The request-context-free
 * service core: `{ db, ownerId }` explicit, no session, no Cloudflare context.
 *
 * WHY SINGLE-ROW CRUD AND NOT THE ROSTER'S DIFFERENTIAL UPSERT: `saveRoster` is a
 * differential upsert because `team_member` has hand-entered children that a
 * delete-then-insert would cascade away (`context/foundation/lessons.md`).
 * `absence` has no such children, so create/update/delete of one row is honest
 * here. What IS copied verbatim from `roster-store.ts` is the isolation
 * discipline: an id outside the caller's set throws rather than being treated as
 * new, and every write carries `AND owner_id = ?` even where the preceding check
 * already makes it redundant — defence in depth on the PRD's cross-account
 * guarantee.
 *
 * OVERLAP LIVES HERE, NOT IN ZOD. `absenceSaveSchema` carries a single absence, so
 * a `superRefine` over it has nothing to compare against. "Does this member
 * already have a window covering these days?" is a database question, and
 * answering it with the owner-scoped read these functions already perform also
 * makes it unbypassable by a crafted payload.
 */

type Db = ReturnType<typeof getDb>;

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run a read — the pool or an open transaction. */
type Reader = Db | Tx;

/** One absence as the client submits it: whole days, never instants. */
export type AbsenceInput = {
  teamMemberId: string;
  type: AbsenceType;
  startDate: DayKey;
  endDate: DayKey;
  isPlanned: boolean;
};

/**
 * A submitted absence id that is not in the caller's set.
 *
 * Mirrors `UnknownMemberError`, and for the same reason: an `UPDATE … WHERE id = $1`
 * carries no owner guarantee of its own, so an unknown id MUST be refused rather
 * than silently treated as a new row. Mapped to `invalid_input` by the action layer.
 */
export class UnknownAbsenceError extends Error {
  constructor(message = "That absence does not belong to this account.") {
    super(message);
    this.name = "UnknownAbsenceError";
  }
}

/**
 * The member already has an absence covering one of these days.
 *
 * A user-fixable input problem, not an unexpected failure: the action maps it to a
 * field-level message and it never reaches the logging branch.
 */
export class OverlappingAbsenceError extends Error {
  constructor(
    message = "This person already has an absence covering some of those days.",
  ) {
    super(message);
    this.name = "OverlappingAbsenceError";
  }
}

/**
 * The owner's absences, optionally narrowed to those overlapping `[from, to]`.
 *
 * Both range endpoints are INCLUSIVE, matching the stored shape: `end_date` is
 * the last instant of the last absent day, so a window ending at 21:59:59.999Z
 * still overlaps a range beginning on that instant.
 *
 * Takes a `Reader` so it works on the pool or inside an open transaction.
 */
export async function listAbsences({
  db,
  ownerId,
  from,
  to,
}: {
  db: Reader;
  ownerId: string;
  from?: Date;
  to?: Date;
}): Promise<SelectAbsence[]> {
  return db
    .select()
    .from(absence)
    .where(
      and(
        eq(absence.ownerId, ownerId),
        // Overlap, not containment: a window straddling either edge of the range
        // is still someone being away during it.
        to ? lte(absence.startDate, to) : undefined,
        from ? gte(absence.endDate, from) : undefined,
      ),
    );
}

/**
 * Record a new absence.
 *
 * `sprint_id` is stamped SERVER-SIDE from the owner's active sprint (or left NULL
 * when they have none) and is deliberately absent from the wire, so a client
 * cannot pin an absence to a sprint of its choosing.
 *
 * WHAT THE COLUMN IS, since S-20 (2026-08-30): write-time provenance — which
 * sprint was active when the lead typed the row — and nothing more. It has **no
 * reader in the codebase**. `SPRINT_AT_RISK` used to compare it against the
 * snapshot's sprint (S-08's D2 rule); that predicate is gone, and risk now
 * follows the absence's DATES like every other absence reader here
 * (`listAbsences` above, `assertNoOverlap` below, `load-snapshot.ts:90-99`,
 * `capacity.ts:164-176`, `developer-inactive.ts:47`).
 *
 * WHY IT IS STILL WRITTEN, since S-26 (2026-08-30): because provenance is worth
 * keeping, and it now costs nothing. S-20 left the writer and the FK alone and
 * pointed at S-26; S-26 re-pointed `absence.sprint_id` at `ON DELETE SET NULL`
 * (`0021`), so a deleted sprint clears the stamp instead of taking the row with
 * it. The column records which sprint was active when the lead typed the row and
 * loses that note if the sprint is destroyed — which is the correct outcome for
 * a provenance field with no reader, and no longer a data-loss path.
 */
export async function createAbsence({
  db,
  ownerId,
  input,
}: {
  db: Db;
  ownerId: string;
  input: AbsenceInput;
}): Promise<{ id: string }> {
  // Reads before the transaction: neither needs to be in it, and holding a
  // Hyperdrive-backed connection open longer than necessary is what exhausts it.
  // They are independent, so one round trip rather than two.
  const [timeZone, activeSprint] = await Promise.all([
    getJiraTimeZone(db, ownerId),
    getActiveSprintRow(db, ownerId),
  ]);
  const window = absenceInstants(input.startDate, input.endDate, timeZone);

  return db.transaction(async (tx) => {
    await assertOwnedMember(tx, ownerId, input.teamMemberId);
    await assertNoOverlap(tx, ownerId, input.teamMemberId, window);

    const id = randomUUID();
    await tx.insert(absence).values({
      id,
      ownerId,
      teamMemberId: input.teamMemberId,
      sprintId: activeSprint?.id ?? null,
      type: input.type,
      startDate: window.startDate,
      endDate: window.endDate,
      isPlanned: input.isPlanned,
    });

    return { id };
  });
}

/**
 * Edit an existing absence in place.
 *
 * `sprint_id` is NOT re-stamped: it records which sprint was active when the row
 * was first typed, and moving the window does not change that fact. Since S-20
 * removed the column's only reader there is also nothing to keep in sync — see
 * `createAbsence` above.
 */
export async function updateAbsence({
  db,
  ownerId,
  absenceId,
  input,
}: {
  db: Db;
  ownerId: string;
  absenceId: string;
  input: AbsenceInput;
}): Promise<{ id: string }> {
  const timeZone = await getJiraTimeZone(db, ownerId);
  const window = absenceInstants(input.startDate, input.endDate, timeZone);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: absence.id })
      .from(absence)
      .where(and(eq(absence.id, absenceId), eq(absence.ownerId, ownerId)));
    // Not "insert it anyway" — see UnknownAbsenceError.
    if (!current) throw new UnknownAbsenceError();

    await assertOwnedMember(tx, ownerId, input.teamMemberId);
    // Excluding the row being edited, so re-saving an unchanged window is not a
    // self-collision.
    await assertNoOverlap(tx, ownerId, input.teamMemberId, window, absenceId);

    await tx
      .update(absence)
      .set({
        teamMemberId: input.teamMemberId,
        type: input.type,
        startDate: window.startDate,
        endDate: window.endDate,
        isPlanned: input.isPlanned,
      })
      // Redundant given the check above, and deliberately kept.
      .where(and(eq(absence.id, absenceId), eq(absence.ownerId, ownerId)));

    return { id: absenceId };
  });
}

/** Remove an absence. Owner-scoped in the DELETE itself, so a foreign id deletes nothing. */
export async function deleteAbsence({
  db,
  ownerId,
  absenceId,
}: {
  db: Db;
  ownerId: string;
  absenceId: string;
}): Promise<void> {
  const removed = await db
    .delete(absence)
    .where(and(eq(absence.id, absenceId), eq(absence.ownerId, ownerId)))
    .returning({ id: absence.id });

  if (removed.length === 0) throw new UnknownAbsenceError();
}

/**
 * The referenced member must belong to the caller — otherwise a crafted payload
 * could attach an absence to another account's member, which would then show up
 * in that account's capacity and suppress their `DEVELOPER_INACTIVE`.
 */
async function assertOwnedMember(
  db: Reader,
  ownerId: string,
  teamMemberId: string,
): Promise<void> {
  const [owned] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.id, teamMemberId), eq(teamMember.ownerId, ownerId)));
  if (!owned) throw new UnknownMemberError();
}

/** Throw when the member already has a window sharing a day with `window`. */
async function assertNoOverlap(
  db: Reader,
  ownerId: string,
  teamMemberId: string,
  window: { startDate: Date; endDate: Date },
  excludeId?: string,
): Promise<void> {
  const clashes = await db
    .select({ id: absence.id })
    .from(absence)
    .where(
      and(
        eq(absence.ownerId, ownerId),
        eq(absence.teamMemberId, teamMemberId),
        lte(absence.startDate, window.endDate),
        gte(absence.endDate, window.startDate),
        excludeId ? ne(absence.id, excludeId) : undefined,
      ),
    )
    .limit(1);

  if (clashes.length > 0) throw new OverlappingAbsenceError();
}
