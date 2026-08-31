import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { teamDayOff, type SelectTeamDayOff } from "@/db/schema";
import type { DayKey } from "@/lib/dashboard/day-bucket";
import type { getDb } from "@/lib/db";

/**
 * Owner-scoped CRUD for team-wide days off (S-23, FR-007/FR-022). The
 * request-context-free service core: `{ db, ownerId }` explicit, no session, no
 * Cloudflare context — the same shape as `absence-store.ts`.
 *
 * NO ZONE CONVERSION ANYWHERE IN THIS FILE, deliberately. An absence is entered
 * against a person's working window, so `absence-dates.ts` has to turn day keys
 * into instants in the TEAM's zone. A public holiday is a bare calendar fact:
 * the column is `date`, the driver returns `'YYYY-MM-DD'`, and that string is
 * byte-identical to the {@link DayKey} `countWorkingDays` compares against. Any
 * conversion here would be a chance to shift a holiday by a day for no gain.
 *
 * WHAT IS COPIED FROM `absence-store.ts`: the isolation discipline. Every read
 * and every write carries `AND owner_id = ?`, so a foreign id touches nothing —
 * defence in depth on the PRD's cross-account guarantee.
 *
 * WHAT IS DELIBERATELY DIFFERENT: a duplicate date is a NO-OP, not an error.
 * `absence` rejects an overlap because two windows for one person are a genuine
 * contradiction the owner must resolve; the same holiday recorded twice is the
 * same fact stated twice, and S-17 will later generate these rows from a country
 * onto a set the owner may already have entered by hand. An insert that has to
 * ask "is it already there?" first would race; `ON CONFLICT DO NOTHING` against
 * the `unique(owner_id, day)` key cannot.
 */

type Db = ReturnType<typeof getDb>;

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run a read — the pool or an open transaction. */
type Reader = Db | Tx;

/** Anything that can run a write — same two, named for what the caller does. */
type Writer = Db | Tx;

/** Where a row came from (S-17). See `schema.ts`'s `team_day_off.source`. */
export type TeamDayOffSource = "manual" | "derived";

/** One team day off as the client submits it. */
export type TeamDayOffInput = {
  day: DayKey;
  label: string | null;
  /**
   * Optional, defaulting to `'manual'`, so every call site that existed before
   * S-17 is unchanged and still means what it said: a human typed this.
   */
  source?: TeamDayOffSource;
};

/**
 * A submitted id that is not in the caller's set.
 *
 * Mirrors `UnknownAbsenceError` and `UnknownMemberError`: a stale list, or a
 * crafted payload naming another account's row. Refused rather than silently
 * ignored, so the surface can tell the owner to reload instead of showing a
 * delete that appeared to work.
 */
export class UnknownTeamDayOffError extends Error {
  constructor(message = "That day off does not belong to this account.") {
    super(message);
    this.name = "UnknownTeamDayOffError";
  }
}

/**
 * Every team-wide day off on the account, oldest first.
 *
 * NO WINDOW, for the same reason `/settings/absences` lists absences whole: a
 * holiday entered for next quarter that vanished from the list would read as a
 * failed save. At the PRD's scale this is a few dozen rows a year.
 *
 * Takes a `Reader` so it works on the pool or inside an open transaction.
 */
export async function listTeamDaysOff({
  db,
  ownerId,
}: {
  db: Reader;
  ownerId: string;
}): Promise<SelectTeamDayOff[]> {
  return db
    .select()
    .from(teamDayOff)
    .where(eq(teamDayOff.ownerId, ownerId))
    .orderBy(asc(teamDayOff.day));
}

/**
 * The set the working-day counter consumes (`rules/helpers.ts`).
 *
 * A `Set` rather than an array because every consumer asks exactly one question
 * — "is this day key in it?" — once per day of a range, inside loops that run
 * per member and per ticket.
 *
 * UNBOUNDED BY DATE, on purpose: the counter is called with ranges from three
 * different slices (a sprint, an absence window clipped to it, a ticket's age),
 * and narrowing here to "this sprint" would silently stop excluding a holiday
 * for whichever caller happened to look outside it — the half-wiring failure
 * `context/foundation/lessons.md` records.
 */
export async function getNonWorkingDays({
  db,
  ownerId,
}: {
  db: Reader;
  ownerId: string;
}): Promise<ReadonlySet<DayKey>> {
  const rows = await db
    .select({ day: teamDayOff.day })
    .from(teamDayOff)
    .where(eq(teamDayOff.ownerId, ownerId));

  // `date` comes back from `pg` as `'YYYY-MM-DD'` — already a DayKey, no parse.
  return new Set(rows.map((r) => r.day));
}

/**
 * Record a team-wide day off.
 *
 * IDEMPOTENT. `ON CONFLICT (owner_id, day) DO NOTHING` makes re-recording the
 * same date the no-op it should be, and returns the existing row's id so the
 * caller gets the same answer either way. `label` on an existing row is left
 * alone: the owner's own wording outranks whatever a later re-entry — or S-17's
 * generator — calls it. Since S-17 that is shipped behaviour rather than an
 * intention, and `source` is left alone for the same reason: a date the lead
 * typed by hand stays THEIRS even when the generator would also have produced
 * it.
 */
export async function createTeamDayOff({
  db,
  ownerId,
  input,
}: {
  db: Db;
  ownerId: string;
  input: TeamDayOffInput;
}): Promise<{ id: string; created: boolean }> {
  const inserted = await db
    .insert(teamDayOff)
    .values({
      id: randomUUID(),
      ownerId,
      day: input.day,
      label: input.label,
      source: input.source ?? "manual",
    })
    .onConflictDoNothing({ target: [teamDayOff.ownerId, teamDayOff.day] })
    .returning({ id: teamDayOff.id });

  if (inserted.length > 0) return { id: inserted[0].id, created: true };

  // The conflict path: the row is already there, so report ITS id rather than
  // the one we generated and threw away.
  const [existing] = await db
    .select({ id: teamDayOff.id })
    .from(teamDayOff)
    .where(and(eq(teamDayOff.ownerId, ownerId), eq(teamDayOff.day, input.day)));

  // Only reachable if the row was deleted between the insert and this read.
  if (!existing) throw new UnknownTeamDayOffError();

  return { id: existing.id, created: false };
}

/**
 * Write many DERIVED days off in one statement (S-17).
 *
 * ONE ROUND TRIP, not fourteen `createTeamDayOff` calls: an approval writes a
 * whole year at once, and it has to do so inside a transaction that also stamps
 * the year — so the cost of the loop would be paid with the transaction open.
 *
 * The SAME conflict target as the single insert, so a day the lead already typed
 * by hand is left untouched — its label AND its `'manual'` provenance both
 * survive. That is why this is a plain `DO NOTHING` and not an upsert: the
 * generator never overwrites a human.
 *
 * Takes a `Writer` so it can run inside the approval's transaction. Accepts an
 * empty list and does nothing, because a year in which the lead unchecked
 * everything is a real and meaningful approval — the year is still stamped.
 */
export async function createDerivedDaysOff({
  db,
  ownerId,
  days,
}: {
  db: Writer;
  ownerId: string;
  days: readonly { day: DayKey; label: string | null }[];
}): Promise<void> {
  if (days.length === 0) return;

  await db
    .insert(teamDayOff)
    .values(
      days.map((d) => ({
        id: randomUUID(),
        ownerId,
        day: d.day,
        label: d.label,
        source: "derived" as const,
      })),
    )
    .onConflictDoNothing({ target: [teamDayOff.ownerId, teamDayOff.day] });
}

/**
 * Remove a team-wide day off. Owner-scoped in the DELETE itself, so a foreign id
 * deletes nothing — and the empty `returning` is what turns that into a refusal
 * rather than a silent success.
 */
export async function deleteTeamDayOff({
  db,
  ownerId,
  teamDayOffId,
}: {
  db: Db;
  ownerId: string;
  teamDayOffId: string;
}): Promise<void> {
  const removed = await db
    .delete(teamDayOff)
    .where(and(eq(teamDayOff.id, teamDayOffId), eq(teamDayOff.ownerId, ownerId)))
    .returning({ id: teamDayOff.id });

  if (removed.length === 0) throw new UnknownTeamDayOffError();
}
