import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { jiraCredential, jiraProject, sprint, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getSprintCapacity } from "@/lib/dashboard/capacity";
import { createTeamDayOff } from "@/lib/team-day-off-store";

/**
 * S-17 Phase 1 — `calendarIsEmpty` through the REAL reader against REAL Postgres
 * (local Supabase `:54322`).
 *
 * WHY THIS CANNOT BE A UNIT TEST (`lessons.md`: "Test the no-configuration path
 * through the real resolver"). `computeSprintCapacity` is handed the day-off set
 * ready-made, so a unit test asserts only that an empty `Set` is reported as
 * empty — it can never see the thing the disclosure actually rests on, which is
 * that `getNonWorkingDays` is UNBOUNDED BY DATE. If that reader ever narrowed to
 * the sprint window, an account with a full calendar and a holiday-free sprint
 * would be told its numbers assume nobody is ever off, every gate would stay
 * green, and the sentence would be aimed at exactly the lead who did the work.
 *
 * So the second case seeds a day off deliberately OUTSIDE the sprint window: the
 * sprint loses nothing (`teamDaysOff === 0`) and the calendar is nevertheless
 * not empty. That pair is the claim.
 *
 * Seed/cleanup style follows `cadence-override.integration.test.ts`.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

/** Mon 2026-08-03 → Fri 2026-08-14, Mon–Fri: 10 working days. */
const SPRINT_START = new Date("2026-08-03T08:00:00.000Z");
const SPRINT_END = new Date("2026-08-14T08:00:00.000Z");

const owners: string[] = [];

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

/** An owner with a Jira project and one ACTIVE sprint carrying both dates. */
async function newOwnerWithSprint(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Capacity Calendar Test",
    email: `cap-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_CapacityCalendarTok1234567", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "4567",
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
      timeZone: "UTC",
    })
    .returning({ id: jiraProject.id });

  await db.insert(sprint).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: project.id,
    jiraSprintId: `s-${randomUUID()}`,
    name: "Seeded",
    state: "ACTIVE",
    startDate: SPRINT_START,
    endDate: SPRINT_END,
    lengthDays: 14,
    startDay: "MON",
  });

  return ownerId;
}

describe("getSprintCapacity — calendarIsEmpty", () => {
  it("reports an empty calendar for an owner with no team days off", async () => {
    const ownerId = await newOwnerWithSprint();

    const result = await getSprintCapacity(db, ownerId);

    expect(result).not.toBeNull();
    expect(result?.capacity.calendarIsEmpty).toBe(true);
    expect(result?.capacity.teamDaysOff).toBe(0);
  });

  it("reports a non-empty calendar for a day off OUTSIDE the sprint window", async () => {
    const ownerId = await newOwnerWithSprint();
    // Wed 2026-12-24, five months past the sprint's end.
    await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-12-24", label: "Wigilia" },
    });

    const result = await getSprintCapacity(db, ownerId);

    // The sprint lost nothing — which is exactly why `teamDaysOff` cannot be
    // the disclosure's input.
    expect(result?.capacity.teamDaysOff).toBe(0);
    expect(result?.capacity.calendarIsEmpty).toBe(false);
  });

  it("is owner-scoped: another account's day off does not fill this calendar", async () => {
    const mine = await newOwnerWithSprint();
    const theirs = await newOwnerWithSprint();
    await createTeamDayOff({
      db,
      ownerId: theirs,
      input: { day: "2026-08-05", label: "Their holiday" },
    });

    const result = await getSprintCapacity(db, mine);

    expect(result?.capacity.calendarIsEmpty).toBe(true);
  });
});
