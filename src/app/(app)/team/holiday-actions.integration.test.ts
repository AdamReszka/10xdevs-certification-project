import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  holidayYearApproval,
  jiraCredential,
  jiraProject,
  sprint,
  teamDayOff,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { holidaysForYear } from "@/lib/holidays";
import { holidayProposal } from "@/lib/holidays/proposal";

/**
 * S-17 Phase 4 — the country and approval Server Actions against REAL Postgres.
 *
 * The store suite proves the persistence rules; this one proves the wrapper, and
 * three of its cases are the ones the whole slice rests on:
 *
 *  - **A deleted derived day is never re-proposed.** This is the S-30 class of
 *    defect — the lead's choice replaced by a plausible wrong value, silently —
 *    and the approval record is the only thing that closes it.
 *  - **A crafted day is refused.** The payload is client-authored, so without
 *    server-side re-validation an approval could write arbitrary dates under a
 *    year stamp that then closes the question forever.
 *  - **A failed approval leaves neither rows nor a stamp.** A half-applied
 *    approval would leave a year that LOOKS decided carrying only some of its
 *    days, indistinguishable afterwards from a lead who unchecked the rest.
 */

let currentOwnerId = "";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: currentOwnerId } })),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY },
  }),
}));

const detectAnomalies = vi.fn(async () => ({ status: "ok" as const }));
vi.mock("@/lib/anomaly/detect", () => ({
  detectAnomalies: (...args: unknown[]) => detectAnomalies(...(args as [])),
}));

/** Flipped by the atomicity case to make the year stamp fail mid-transaction. */
let failApproval = false;
vi.mock("@/lib/holidays/calendar-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/holidays/calendar-store")>();
  return {
    ...actual,
    approveHolidayYear: async (
      args: Parameters<typeof actual.approveHolidayYear>[0],
    ) => {
      if (failApproval) throw new Error("stamping the year failed");
      return actual.approveHolidayYear(args);
    },
  };
});

// Imported AFTER the mocks (vi.mock is hoisted).
import { approveHolidayYearAction, saveHolidayCountryAction } from "./actions";
import { getHolidayCalendar, listApprovedYears } from "@/lib/holidays/calendar-store";
import { getNonWorkingDays } from "@/lib/team-day-off-store";

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
    name: "Holiday Action Test",
    email: `ha-${ownerId}@example.test`,
  });
  currentOwnerId = ownerId;
  return ownerId;
}

beforeEach(() => {
  failApproval = false;
  detectAnomalies.mockClear();
  detectAnomalies.mockResolvedValue({ status: "ok" as const });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

/**
 * Give an owner a sprint running 2026-12-21 → 2027-01-04.
 *
 * Needed since impl-review F3: the server re-derives the reviewable years from
 * the owner's OWN sprint row, so a two-year approval is only legitimate for an
 * account whose sprint actually crosses the boundary. Before F3 this test passed
 * against an owner with no sprint at all — it asserted its name rather than its
 * subject.
 */
async function seedCrossingSprint(ownerId: string): Promise<void> {
  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_HolidayActionTok123456789", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "6789",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const [project] = await db
    .insert(jiraProject)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: "10000",
      projectKey: "SF",
      timeZone: "Europe/Warsaw",
    })
    .returning({ id: jiraProject.id });

  await db.insert(sprint).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: project.id,
    jiraSprintId: `ha-${ownerId}`,
    name: "Crosses new year",
    state: "ACTIVE",
    startDate: new Date("2026-12-21T08:00:00.000Z"),
    endDate: new Date("2027-01-04T08:00:00.000Z"),
  });
}

/** Every 2026 Polish holiday, as the editor would submit them. */
const DAYS_2026 = holidaysForYear("PL", 2026).map((h) => h.day);

describe("saveHolidayCountryAction", () => {
  it("stores the country and re-detects", async () => {
    const ownerId = await newOwner();

    const result = await saveHolidayCountryAction({ countryCode: "PL" });

    expect(result.ok).toBe(true);
    expect(await getHolidayCalendar({ db, ownerId })).toBe("PL");
    expect(detectAnomalies).toHaveBeenCalledTimes(1);
  });

  it("refuses a country the app has no rules for", async () => {
    await newOwner();

    const result = await saveHolidayCountryAction({ countryCode: "XX" });

    expect(result.ok).toBe(false);
  });
});

describe("approveHolidayYearAction", () => {
  it("writes the kept days as derived and stamps the year", async () => {
    const ownerId = await newOwner();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });

    expect(result.ok).toBe(true);
    const rows = await db
      .select()
      .from(teamDayOff)
      .where(eq(teamDayOff.ownerId, ownerId));
    expect(rows).toHaveLength(14);
    expect(rows.every((r) => r.source === "derived")).toBe(true);
    // The generator's own label, not the client's — the payload carries days only.
    expect(rows.some((r) => r.label === "Nowy Rok")).toBe(true);

    expect([...(await listApprovedYears({ db, ownerId, countryCode: "PL" }))]).toEqual(
      [2026],
    );
  });

  it("writes the rows exactly once when the same year is approved twice", async () => {
    const ownerId = await newOwner();
    await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });
    await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });

    const rows = await db
      .select()
      .from(teamDayOff)
      .where(eq(teamDayOff.ownerId, ownerId));
    const stamps = await db
      .select()
      .from(holidayYearApproval)
      .where(eq(holidayYearApproval.ownerId, ownerId));

    expect(rows).toHaveLength(14);
    expect(stamps).toHaveLength(1);
  });

  it("never re-proposes a derived day the lead deleted afterwards", async () => {
    // THE CASE THIS SLICE EXISTS FOR. A team that works 6 January removes it and
    // must never be offered it again.
    const ownerId = await newOwner();
    await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });

    await db
      .delete(teamDayOff)
      .where(and(eq(teamDayOff.ownerId, ownerId), eq(teamDayOff.day, "2026-01-06")));

    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026],
      approvedYears: await listApprovedYears({ db, ownerId, countryCode: "PL" }),
      existingDays: await getNonWorkingDays({ db, ownerId }),
    });

    expect(proposed).toEqual([]);
  });

  it("stamps a year in which the lead kept nothing", async () => {
    // A team that works every public holiday. Without the stamp the whole
    // calendar comes back on the next render.
    const ownerId = await newOwner();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: [],
    });

    expect(result.ok).toBe(true);
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      (await listApprovedYears({ db, ownerId, countryCode: "PL" })).has(2026),
    ).toBe(true);
  });

  it("approves two years in one transaction when the sprint crosses a boundary", async () => {
    const ownerId = await newOwner();
    await seedCrossingSprint(ownerId);

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026, 2027],
      days: [...DAYS_2026, ...holidaysForYear("PL", 2027).map((h) => h.day)],
    });

    expect(result.ok).toBe(true);
    const years = await listApprovedYears({ db, ownerId, countryCode: "PL" });
    expect([...years].sort()).toEqual([2026, 2027]);
  });

  it("refuses a day that is not in its own year's calendar", async () => {
    const ownerId = await newOwner();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      // An ordinary Tuesday. Nothing else in the payload is wrong.
      days: ["2026-03-17"],
    });

    expect(result.ok).toBe(false);
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(holidayYearApproval)
        .where(eq(holidayYearApproval.ownerId, ownerId)),
    ).toHaveLength(0);
  });

  it("refuses a day whose year was not submitted", async () => {
    // A real holiday, but in a year the lead is not approving — so it would land
    // under a stamp that never covered it.
    const ownerId = await newOwner();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: ["2027-01-01"],
    });

    expect(result.ok).toBe(false);
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(0);
  });

  it("leaves neither rows nor a stamp when the approval fails partway", async () => {
    const ownerId = await newOwner();
    vi.spyOn(console, "error").mockImplementation(() => {});
    failApproval = true;

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });

    expect(result.ok).toBe(false);
    // The days were inserted BEFORE the stamp threw; the transaction is what
    // takes them back out.
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(holidayYearApproval)
        .where(eq(holidayYearApproval.ownerId, ownerId)),
    ).toHaveLength(0);
  });

  it("refuses a year the account's own window does not reach", async () => {
    // IMPL-REVIEW F3. The days are real holidays and internally consistent —
    // only the YEAR is one the surface never offered. Stamping it would close
    // 2028 before its calendar was ever proposed, and therefore for good.
    const ownerId = await newOwner();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [2028],
      days: holidaysForYear("PL", 2028).map((h) => h.day),
    });

    expect(result.ok).toBe(false);
    expect(
      await db
        .select()
        .from(holidayYearApproval)
        .where(eq(holidayYearApproval.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(0);
  });

  it("still lets an account with no sprint approve the year it is living in", async () => {
    // The other half of F3, and the reason the window includes `now`'s year
    // unconditionally: a refusal that locked out an account between sprints
    // would be worse than the hole it closed.
    const ownerId = await newOwner();
    const thisYear = new Date().getUTCFullYear();

    const result = await approveHolidayYearAction({
      countryCode: "PL",
      years: [thisYear],
      days: [],
    });

    expect(result.ok).toBe(true);
    expect(
      (await listApprovedYears({ db, ownerId, countryCode: "PL" })).has(thisYear),
    ).toBe(true);
  });

  it("does not touch another account", async () => {
    const theirs = await newOwner();
    const mine = await newOwner(); // becomes the current session owner

    await approveHolidayYearAction({
      countryCode: "PL",
      years: [2026],
      days: DAYS_2026,
    });

    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, theirs)),
    ).toHaveLength(0);
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, mine)),
    ).toHaveLength(14);
  });
});
