import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { holidayCalendar, holidayYearApproval, teamDayOff, user } from "@/db/schema";
import {
  approveHolidayYear,
  getHolidayCalendar,
  listApprovedYears,
  setHolidayCountry,
} from "@/lib/holidays/calendar-store";
import { createDerivedDaysOff, listTeamDaysOff } from "@/lib/team-day-off-store";

/**
 * S-17 Phase 2 — the country and the year approvals against REAL Postgres
 * (local Supabase `:54322`).
 *
 * Three things can only be checked here:
 *
 *  - **The dedup key exists and holds.** `approveHolidayYear` leans on
 *    `unique(owner_id, country_code, year)` and `ON CONFLICT DO NOTHING` rather
 *    than a read-then-write, so a missing constraint would show up as a second
 *    approval row and nowhere else. That record is the ONLY thing standing
 *    between a regeneration and a resurrected holiday, so a silent duplicate is
 *    not cosmetic.
 *  - **The upsert on the country.** A second save must move the value, not
 *    collide.
 *  - **Cross-owner isolation.** Every read and write is owner-scoped; a foreign
 *    id must see nothing and touch nothing (PRD cross-account isolation).
 *
 * Seed/cleanup style follows `team-day-off-store.integration.test.ts`.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

async function newOwner(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Holiday Calendar Test",
    email: `hc-${ownerId}@example.test`,
  });
  return ownerId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("getHolidayCalendar / setHolidayCountry", () => {
  it("reports null before the lead has picked a country", async () => {
    const ownerId = await newOwner();
    expect(await getHolidayCalendar({ db, ownerId })).toBeNull();
  });

  it("stores the country the lead picked", async () => {
    const ownerId = await newOwner();
    await setHolidayCountry({ db, ownerId, countryCode: "PL" });

    expect(await getHolidayCalendar({ db, ownerId })).toBe("PL");
  });

  it("upserts rather than duplicating on a second save", async () => {
    const ownerId = await newOwner();
    await setHolidayCountry({ db, ownerId, countryCode: "PL" });
    await setHolidayCountry({ db, ownerId, countryCode: "DE" });

    const rows = await db
      .select()
      .from(holidayCalendar)
      .where(eq(holidayCalendar.ownerId, ownerId));

    expect(rows).toHaveLength(1);
    expect(rows[0].countryCode).toBe("DE");
  });

  it("is owner-scoped: a foreign account's country is invisible", async () => {
    const mine = await newOwner();
    const theirs = await newOwner();
    await setHolidayCountry({ db, ownerId: theirs, countryCode: "PL" });

    expect(await getHolidayCalendar({ db, ownerId: mine })).toBeNull();
  });

  it("is owner-scoped on the write: my save leaves theirs intact", async () => {
    const mine = await newOwner();
    const theirs = await newOwner();
    await setHolidayCountry({ db, ownerId: theirs, countryCode: "PL" });
    await setHolidayCountry({ db, ownerId: mine, countryCode: "DE" });

    expect(await getHolidayCalendar({ db, ownerId: theirs })).toBe("PL");
  });
});

describe("approveHolidayYear / listApprovedYears", () => {
  it("stamps a year and reports it back", async () => {
    const ownerId = await newOwner();
    await approveHolidayYear({ db, ownerId, countryCode: "PL", year: 2026 });

    const years = await listApprovedYears({ db, ownerId, countryCode: "PL" });
    expect([...years]).toEqual([2026]);
  });

  it("is a no-op the second time, keeping the original approval date", async () => {
    const ownerId = await newOwner();
    await approveHolidayYear({ db, ownerId, countryCode: "PL", year: 2026 });

    const [first] = await db
      .select()
      .from(holidayYearApproval)
      .where(eq(holidayYearApproval.ownerId, ownerId));

    await approveHolidayYear({ db, ownerId, countryCode: "PL", year: 2026 });

    const rows = await db
      .select()
      .from(holidayYearApproval)
      .where(eq(holidayYearApproval.ownerId, ownerId));

    expect(rows).toHaveLength(1);
    // The date the decision was actually made, not the date it was re-submitted.
    expect(rows[0].approvedAt).toEqual(first.approvedAt);
  });

  it("does not close a year approved under a DIFFERENT country", async () => {
    // A country switch must re-open the year rather than inherit a decision the
    // lead made about a different calendar.
    const ownerId = await newOwner();
    await approveHolidayYear({ db, ownerId, countryCode: "PL", year: 2026 });

    const years = await listApprovedYears({ db, ownerId, countryCode: "DE" });
    expect(years.size).toBe(0);
  });

  it("is owner-scoped: a foreign account's approval closes nothing here", async () => {
    const mine = await newOwner();
    const theirs = await newOwner();
    await approveHolidayYear({ db, ownerId: theirs, countryCode: "PL", year: 2026 });

    const years = await listApprovedYears({ db, ownerId: mine, countryCode: "PL" });
    expect(years.size).toBe(0);
  });
});

describe("createDerivedDaysOff", () => {
  it("writes a batch in one statement, marked as derived", async () => {
    const ownerId = await newOwner();
    await createDerivedDaysOff({
      db,
      ownerId,
      days: [
        { day: "2026-01-01", label: "Nowy Rok" },
        { day: "2026-05-01", label: "Święto Pracy" },
      ],
    });

    const rows = await listTeamDaysOff({ db, ownerId });
    expect(rows.map((r) => r.day)).toEqual(["2026-01-01", "2026-05-01"]);
    expect(rows.every((r) => r.source === "derived")).toBe(true);
  });

  it("leaves a day the lead typed by hand entirely alone", async () => {
    const ownerId = await newOwner();
    await db.insert(teamDayOff).values({
      id: randomUUID(),
      ownerId,
      day: "2026-01-01",
      label: "Our own name for it",
    });

    await createDerivedDaysOff({
      db,
      ownerId,
      days: [{ day: "2026-01-01", label: "Nowy Rok" }],
    });

    const [row] = await db
      .select()
      .from(teamDayOff)
      .where(and(eq(teamDayOff.ownerId, ownerId), eq(teamDayOff.day, "2026-01-01")));

    // Both the wording AND the provenance survive: the generator never
    // overwrites a human.
    expect(row.label).toBe("Our own name for it");
    expect(row.source).toBe("manual");
  });

  it("classifies a row written before the migration as manual", async () => {
    // The column is NOT NULL with a DEFAULT, so an insert that names no source
    // — which is every row that existed before `0025` — reads as the lead's.
    const ownerId = await newOwner();
    await db.insert(teamDayOff).values({
      id: randomUUID(),
      ownerId,
      day: "2026-08-15",
      label: null,
    });

    const [row] = await listTeamDaysOff({ db, ownerId });
    expect(row.source).toBe("manual");
  });

  it("does nothing, and does not throw, on an empty batch", async () => {
    const ownerId = await newOwner();
    await createDerivedDaysOff({ db, ownerId, days: [] });

    expect(await listTeamDaysOff({ db, ownerId })).toHaveLength(0);
  });

  it("writes only to the calling owner", async () => {
    const mine = await newOwner();
    const theirs = await newOwner();
    await createDerivedDaysOff({
      db,
      ownerId: mine,
      days: [{ day: "2026-01-01", label: "Nowy Rok" }],
    });

    expect(await listTeamDaysOff({ db, ownerId: theirs })).toHaveLength(0);
  });
});
