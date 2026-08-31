import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  absence,
  jiraCredential,
  jiraProject,
  sprint,
  teamMember,
  user,
} from "@/db/schema";
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
 * S-18 ADDS A SECOND SUBJECT to the same file: the forecast window's capacity
 * and `hasForwardAbsence`. Both are integration-only for the same shape of
 * reason. The forecast figure rests on the absence read's UPPER BOUND — which a
 * unit test cannot see at all, because the reducer is handed the rows
 * ready-made — and the bound is exactly what the old `lookahead` got wrong once
 * the window's length stopped being the sprint's own span. And
 * `hasForwardAbsence` is an account-level existence read, so the case that
 * matters is an absence starting BEYOND the forecast window: it must still count.
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

/** One full-time active member, so the capacity figures are non-zero. */
async function addMember(ownerId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(teamMember).values({
    id,
    ownerId,
    name: "Mia Krystof",
    fte: "1.00",
    source: "MANUAL",
  });
  return id;
}

async function addAbsence(
  ownerId: string,
  teamMemberId: string,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  await db.insert(absence).values({
    id: randomUUID(),
    ownerId,
    teamMemberId,
    type: "VACATION",
    startDate,
    endDate,
  });
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

/**
 * The sprint is Mon 2026-08-03 → Fri 2026-08-14 with `length_days = 14`, so the
 * forecast window is Sat 2026-08-15 → Fri 2026-08-28: fourteen calendar days,
 * ten of them Mon–Fri.
 */
describe("getSprintCapacity — the forecast window", () => {
  it("returns a capacity for the window after the sprint", async () => {
    const ownerId = await newOwnerWithSprint();
    await addMember(ownerId);

    const result = await getSprintCapacity(db, ownerId);

    expect(result?.nextWindow.from.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(result?.nextWindowCapacity.sprintWorkingDays).toBe(10);
    expect(result?.nextWindowCapacity.adjustedMd).toBe(10);
    expect(result?.nextWindowCapacity.nominalMd).toBe(10);
    // The sprint's own figure is untouched.
    expect(result?.capacity.adjustedMd).toBe(10);
  });

  it("subtracts an absence that falls ONLY in the forecast window", async () => {
    // THE CASE THE OLD BOUND DROPPED. The absence read used to stop at the
    // sprint's own span past its end — here 2026-08-25T08:00Z — and once the
    // window's length came from the cadence rather than from that span, anything
    // past the bound silently vanished and the forecast figure silently ROSE
    // (`lessons.md`'s narrowing-predicate rule, one window right). These dates
    // are deliberately chosen to sit beyond the old bound and inside the window.
    const ownerId = await newOwnerWithSprint();
    const memberId = await addMember(ownerId);
    // Thu 2026-08-27 → Fri 2026-08-28: two working days.
    await addAbsence(
      ownerId,
      memberId,
      new Date("2026-08-27T00:00:00.000Z"),
      new Date("2026-08-28T23:59:59.999Z"),
    );

    const result = await getSprintCapacity(db, ownerId);

    expect(result?.nextWindowCapacity.adjustedMd).toBe(8);
    expect(result?.nextWindowCapacity.nominalMd).toBe(10);
    // And the sprint's own capacity does not move.
    expect(result?.capacity.adjustedMd).toBe(10);
  });

  it("subtracts a team-wide day off inside the forecast window", async () => {
    const ownerId = await newOwnerWithSprint();
    await addMember(ownerId);
    // Mon 2026-08-17, inside the forecast window and outside the sprint.
    await createTeamDayOff({
      db,
      ownerId,
      input: { day: "2026-08-17", label: "Company day off" },
    });

    const result = await getSprintCapacity(db, ownerId);

    expect(result?.nextWindowCapacity.sprintWorkingDays).toBe(9);
    expect(result?.nextWindowCapacity.teamDaysOff).toBe(1);
    expect(result?.capacity.sprintWorkingDays).toBe(10);
  });
});

describe("getSprintCapacity — hasForwardAbsence", () => {
  it("is false when the account holds no absence at all", async () => {
    const ownerId = await newOwnerWithSprint();
    await addMember(ownerId);

    expect((await getSprintCapacity(db, ownerId))?.hasForwardAbsence).toBe(false);
  });

  it("is false when the only absence ends inside the running sprint", async () => {
    // The lead has recorded absences, but nothing forward — which is what the
    // stronger notice is about.
    const ownerId = await newOwnerWithSprint();
    const memberId = await addMember(ownerId);
    await addAbsence(
      ownerId,
      memberId,
      new Date("2026-08-05T00:00:00.000Z"),
      new Date("2026-08-07T23:59:59.999Z"),
    );

    expect((await getSprintCapacity(db, ownerId))?.hasForwardAbsence).toBe(false);
  });

  it("is true for an absence starting BEYOND the forecast window", async () => {
    // This is what makes the fact ACCOUNT-LEVEL rather than windowed
    // (plan-review F2): a lead who records next quarter's holiday has done the
    // work, and a notice keyed on the fortnight would tell them otherwise.
    const ownerId = await newOwnerWithSprint();
    const memberId = await addMember(ownerId);
    await addAbsence(
      ownerId,
      memberId,
      new Date("2026-12-21T00:00:00.000Z"),
      new Date("2026-12-31T23:59:59.999Z"),
    );

    const result = await getSprintCapacity(db, ownerId);

    expect(result?.hasForwardAbsence).toBe(true);
    // And it changed nothing about either figure — it is outside both windows.
    expect(result?.nextWindowCapacity.adjustedMd).toBe(10);
  });

  it("is owner-scoped: another account's forward absence does not count", async () => {
    const mine = await newOwnerWithSprint();
    await addMember(mine);
    const theirs = await newOwnerWithSprint();
    const theirMember = await addMember(theirs);
    await addAbsence(
      theirs,
      theirMember,
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-04T23:59:59.999Z"),
    );

    expect((await getSprintCapacity(db, mine))?.hasForwardAbsence).toBe(false);
    expect((await getSprintCapacity(db, theirs))?.hasForwardAbsence).toBe(true);
  });
});
