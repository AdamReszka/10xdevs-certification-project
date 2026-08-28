import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { teamDayOff, user } from "@/db/schema";
import {
  UnknownTeamDayOffError,
  createTeamDayOff,
  deleteTeamDayOff,
  getNonWorkingDays,
  listTeamDaysOff,
} from "@/lib/team-day-off-store";

/**
 * S-23 Phase 2 — team-wide days off against REAL Postgres (local Supabase
 * `:54322`).
 *
 * Three things can only be checked here, not in a unit test:
 *
 *  - **The `date` column's round trip.** The whole seam rests on `pg` handing a
 *    `date` back as the `'YYYY-MM-DD'` string `countWorkingDays` compares
 *    against. A driver that parsed it into a `Date` — which is what it does for
 *    `timestamp` — would make every set membership test silently false, and no
 *    type error would say so.
 *  - **Idempotence.** `createTeamDayOff` leans on the `unique(owner_id, day)`
 *    constraint and `ON CONFLICT DO NOTHING` rather than a read-then-write, so
 *    the constraint has to actually exist. S-17 will generate these rows onto a
 *    set the owner may already have entered by hand.
 *  - **Cross-owner isolation.** Every read and write is owner-scoped; a foreign
 *    id must touch nothing and leave the victim's row byte-for-byte intact
 *    (PRD cross-account isolation).
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/** A bare owner — days off hang off the account, not off a project or sprint. */
async function newOwner(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Day Off Test",
    email: `dot-${ownerId}@example.test`,
  });
  return ownerId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("createTeamDayOff", () => {
  it("stores the day as a bare calendar date, with no zone conversion", async () => {
    const ownerId = await newOwner();

    const { id, created } = await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-15", label: "Assumption of Mary" },
    });

    expect(created).toBe(true);

    const [row] = await db.select().from(teamDayOff).where(eq(teamDayOff.id, id));
    // The exact string in, the exact string out. An absence goes through
    // `absence-dates.ts` and comes back as instants; this deliberately does not.
    expect(row.day).toBe("2026-08-15");
    expect(typeof row.day).toBe("string");
    expect(row.label).toBe("Assumption of Mary");
  });

  it("stores a null label rather than an empty string", async () => {
    const ownerId = await newOwner();
    const { id } = await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-15", label: null },
    });

    const [row] = await db.select().from(teamDayOff).where(eq(teamDayOff.id, id));
    expect(row.label).toBeNull();
  });

  it("is a no-op on a duplicate date, returning the existing row's id", async () => {
    const ownerId = await newOwner();

    const first = await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-15", label: "Assumption of Mary" },
    });
    const second = await createTeamDayOff({
      db,
      ownerId,
      // A different label on the same date: the owner's original wording wins.
      input: { day: "2026-08-15", label: "public holiday" },
    });

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const rows = await listTeamDaysOff({ db, ownerId });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Assumption of Mary");
  });

  it("lets two owners record the same date independently", async () => {
    const [a, b] = [await newOwner(), await newOwner()];

    await createTeamDayOff({ db, ownerId: a, input: { day: "2026-08-15", label: null } });
    await createTeamDayOff({ db, ownerId: b, input: { day: "2026-08-15", label: null } });

    expect(await listTeamDaysOff({ db, ownerId: a })).toHaveLength(1);
    expect(await listTeamDaysOff({ db, ownerId: b })).toHaveLength(1);
  });
});

describe("listTeamDaysOff", () => {
  it("returns only the caller's rows, oldest first", async () => {
    const [mine, theirs] = [await newOwner(), await newOwner()];

    await createTeamDayOff({ db, ownerId: mine, input: { day: "2026-12-25", label: null } });
    await createTeamDayOff({ db, ownerId: mine, input: { day: "2026-08-15", label: null } });
    await createTeamDayOff({ db, ownerId: theirs, input: { day: "2026-11-11", label: null } });

    const rows = await listTeamDaysOff({ db, ownerId: mine });
    expect(rows.map((r) => r.day)).toEqual(["2026-08-15", "2026-12-25"]);
  });
});

describe("getNonWorkingDays", () => {
  it("returns a set of day keys the working-day counter can test directly", async () => {
    const ownerId = await newOwner();
    await createTeamDayOff({ db, ownerId, input: { day: "2026-08-15", label: null } });
    await createTeamDayOff({ db, ownerId, input: { day: "2026-12-25", label: null } });

    const set = await getNonWorkingDays({ db, ownerId });

    expect(set.size).toBe(2);
    // The membership test the seam performs, verbatim.
    expect(set.has("2026-08-15")).toBe(true);
    expect(set.has("2026-12-25")).toBe(true);
    expect(set.has("2026-08-16")).toBe(false);
  });

  it("is owner-scoped — another account's holidays are invisible", async () => {
    const [mine, theirs] = [await newOwner(), await newOwner()];
    await createTeamDayOff({ db, ownerId: theirs, input: { day: "2026-08-15", label: null } });

    const set = await getNonWorkingDays({ db, ownerId: mine });
    expect(set.size).toBe(0);
  });

  it("is an empty set, not null, when nothing is recorded", async () => {
    const ownerId = await newOwner();
    expect((await getNonWorkingDays({ db, ownerId })).size).toBe(0);
  });
});

describe("deleteTeamDayOff", () => {
  it("removes the caller's own row", async () => {
    const ownerId = await newOwner();
    const { id } = await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-15", label: null },
    });

    await deleteTeamDayOff({ db, ownerId, teamDayOffId: id });
    expect(await listTeamDaysOff({ db, ownerId })).toHaveLength(0);
  });

  it("refuses a foreign id and leaves the victim's row untouched", async () => {
    const [mine, theirs] = [await newOwner(), await newOwner()];
    const victim = await createTeamDayOff({
      db,
      ownerId: theirs,
      input: { day: "2026-08-15", label: "theirs" },
    });

    await expect(
      deleteTeamDayOff({ db, ownerId: mine, teamDayOffId: victim.id }),
    ).rejects.toBeInstanceOf(UnknownTeamDayOffError);

    const [row] = await db
      .select()
      .from(teamDayOff)
      .where(eq(teamDayOff.id, victim.id));
    expect(row.label).toBe("theirs");
  });

  it("refuses an id that does not exist at all", async () => {
    const ownerId = await newOwner();
    await expect(
      deleteTeamDayOff({ db, ownerId, teamDayOffId: randomUUID() }),
    ).rejects.toBeInstanceOf(UnknownTeamDayOffError);
  });
});

describe("account deletion", () => {
  it("cascades the owner's days off away", async () => {
    const ownerId = await newOwner();
    const { id } = await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-15", label: null },
    });

    await db.delete(user).where(eq(user.id, ownerId));
    owners.splice(owners.indexOf(ownerId), 1);

    const rows = await db.select().from(teamDayOff).where(eq(teamDayOff.id, id));
    expect(rows).toHaveLength(0);
  });
});
