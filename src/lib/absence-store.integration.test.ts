import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { absence, jiraCredential, jiraProject, sprint, teamMember, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { UnknownMemberError } from "@/lib/integrations/roster-store";
import {
  OverlappingAbsenceError,
  UnknownAbsenceError,
  createAbsence,
  deleteAbsence,
  listAbsences,
  updateAbsence,
} from "@/lib/absence-store";

/**
 * S-08 Phase 1 — the absence store against REAL Postgres (local Supabase `:54322`).
 *
 * Coverage, in the order the risks were ranked during planning:
 *  - CRUD round-trip with whole-day semantics resolved in the TEAM's zone.
 *  - `sprint_id` stamped server-side from the active sprint (D2 needs a sprint to
 *    judge planned-ness against; without it `is_planned` is unmoored).
 *  - CROSS-OWNER SIBLINGS for every write: a foreign absence id is refused and the
 *    victim's row is left byte-for-byte untouched (PRD cross-account isolation).
 *  - A foreign `team_member_id` is refused, so a crafted payload cannot attach an
 *    absence to another account's member.
 *  - Overlap is rejected — and re-saving the edited row's OWN unchanged window is
 *    not a self-collision.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// --- Seed / cleanup ---------------------------------------------------------

const owners: string[] = [];

/** An owner with a Warsaw-zoned Jira project and one ACTIVE sprint. */
async function newOwner(timeZone: string | null = "Europe/Warsaw"): Promise<{
  ownerId: string;
  sprintId: string;
}> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Absence Test",
    email: `at-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_AbsenceTokenABCDEFGH1234", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "1234",
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
      timeZone,
    })
    .returning({ id: jiraProject.id });

  const sprintId = randomUUID();
  await db.insert(sprint).values({
    id: sprintId,
    ownerId,
    jiraProjectId: project.id,
    jiraSprintId: `s08-${sprintId}`,
    name: "Sprint 7",
    state: "ACTIVE",
    startDate: new Date("2026-05-04T00:00:00.000Z"),
    endDate: new Date("2026-05-15T00:00:00.000Z"),
  });

  return { ownerId, sprintId };
}

async function newMember(ownerId: string, name = "Mia Krystof"): Promise<string> {
  const id = randomUUID();
  await db.insert(teamMember).values({
    id,
    ownerId,
    name,
    githubUsername: name.toLowerCase().replace(/\W+/g, ""),
    source: "GITHUB",
  });
  return id;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

function vacation(teamMemberId: string, startDate: string, endDate: string) {
  return { teamMemberId, type: "VACATION" as const, startDate, endDate, isPlanned: true };
}

// --- Tests ------------------------------------------------------------------

describe("createAbsence", () => {
  it("stores the window as whole days in the team's zone, end inclusive", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);

    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    const [row] = await db.select().from(absence).where(eq(absence.id, id));
    // Warsaw is UTC+2 in May: the local day starts at 22:00Z the evening before,
    // and the last absent day runs to 21:59:59.999Z.
    expect(row.startDate.toISOString()).toBe("2026-05-04T22:00:00.000Z");
    expect(row.endDate.toISOString()).toBe("2026-05-09T21:59:59.999Z");
    expect(row.isPlanned).toBe(true);
    expect(row.ownerId).toBe(ownerId);
  });

  it("stamps sprint_id with the owner's active sprint", async () => {
    // D2 judges planned-ness RELATIVE to a sprint. Without the stamp, an absence
    // entered mid-sprint keeps raising SPRINT_AT_RISK after the rollover, when by
    // D2's own definition it is planned in the next sprint.
    const { ownerId, sprintId } = await newOwner();
    const memberId = await newMember(ownerId);

    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    const [row] = await db.select().from(absence).where(eq(absence.id, id));
    expect(row.sprintId).toBe(sprintId);
  });

  it("leaves sprint_id null when the owner has no sprint at all", async () => {
    const ownerId = randomUUID();
    owners.push(ownerId);
    await db.insert(user).values({
      id: ownerId,
      name: "No Sprint",
      email: `ns-${ownerId}@example.test`,
    });
    const memberId = await newMember(ownerId);

    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    const [row] = await db.select().from(absence).where(eq(absence.id, id));
    expect(row.sprintId).toBeNull();
  });

  it("refuses a team member belonging to another account", async () => {
    const victim = await newOwner();
    const attacker = await newOwner();
    const victimMember = await newMember(victim.ownerId, "Victim Dev");

    await expect(
      createAbsence({
        db,
        ownerId: attacker.ownerId,
        input: vacation(victimMember, "2026-05-05", "2026-05-09"),
      }),
    ).rejects.toBeInstanceOf(UnknownMemberError);

    const rows = await db
      .select()
      .from(absence)
      .where(eq(absence.teamMemberId, victimMember));
    expect(rows).toHaveLength(0);
  });

  it("rejects a window overlapping one the member already has", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-05", "2026-05-09") });

    await expect(
      createAbsence({
        db,
        ownerId,
        // Shares only 2026-05-09 — one shared day is a collision.
        input: vacation(memberId, "2026-05-09", "2026-05-12"),
      }),
    ).rejects.toBeInstanceOf(OverlappingAbsenceError);

    const rows = await db.select().from(absence).where(eq(absence.teamMemberId, memberId));
    expect(rows).toHaveLength(1);
  });

  it("accepts an adjacent window that shares no day", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-05", "2026-05-09") });

    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-10", "2026-05-12") });

    const rows = await db.select().from(absence).where(eq(absence.teamMemberId, memberId));
    expect(rows).toHaveLength(2);
  });

  it("does not treat another member's overlapping window as a collision", async () => {
    const { ownerId } = await newOwner();
    const mia = await newMember(ownerId, "Mia");
    const sam = await newMember(ownerId, "Sam");
    await createAbsence({ db, ownerId, input: vacation(mia, "2026-05-05", "2026-05-09") });

    await createAbsence({ db, ownerId, input: vacation(sam, "2026-05-05", "2026-05-09") });

    const rows = await db.select().from(absence).where(eq(absence.ownerId, ownerId));
    expect(rows).toHaveLength(2);
  });
});

describe("updateAbsence", () => {
  it("changes the window in place rather than creating a second row", async () => {
    const { ownerId, sprintId } = await newOwner();
    const memberId = await newMember(ownerId);
    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    await updateAbsence({
      db,
      ownerId,
      absenceId: id,
      input: { ...vacation(memberId, "2026-05-06", "2026-05-07"), type: "SICKNESS", isPlanned: false },
    });

    const rows = await db.select().from(absence).where(eq(absence.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].type).toBe("SICKNESS");
    expect(rows[0].isPlanned).toBe(false);
    expect(rows[0].startDate.toISOString()).toBe("2026-05-05T22:00:00.000Z");
    // The sprint the planned-ness judgement was made against does not move when
    // the window is edited (D2).
    expect(rows[0].sprintId).toBe(sprintId);
  });

  it("does not treat the edited row's own unchanged window as an overlap", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    await updateAbsence({
      db,
      ownerId,
      absenceId: id,
      // Same window, only the type changes — re-saving must not self-collide.
      input: { ...vacation(memberId, "2026-05-05", "2026-05-09"), type: "TRAINING" },
    });

    const [row] = await db.select().from(absence).where(eq(absence.id, id));
    expect(row.type).toBe("TRAINING");
  });

  it("still rejects an edit that collides with the member's OTHER absence", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });
    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-18", "2026-05-20") });

    await expect(
      updateAbsence({
        db,
        ownerId,
        absenceId: id,
        input: vacation(memberId, "2026-05-05", "2026-05-19"),
      }),
    ).rejects.toBeInstanceOf(OverlappingAbsenceError);
  });

  it("refuses an absence id belonging to another account and leaves it untouched", async () => {
    const victim = await newOwner();
    const attacker = await newOwner();
    const victimMember = await newMember(victim.ownerId, "Victim Dev");
    const attackerMember = await newMember(attacker.ownerId, "Attacker Dev");
    const { id } = await createAbsence({
      db,
      ownerId: victim.ownerId,
      input: vacation(victimMember, "2026-05-05", "2026-05-09"),
    });

    await expect(
      updateAbsence({
        db,
        ownerId: attacker.ownerId,
        absenceId: id,
        input: { ...vacation(attackerMember, "2026-06-01", "2026-06-02"), type: "SICKNESS" },
      }),
    ).rejects.toBeInstanceOf(UnknownAbsenceError);

    const [row] = await db.select().from(absence).where(eq(absence.id, id));
    expect(row.type).toBe("VACATION");
    expect(row.teamMemberId).toBe(victimMember);
    expect(row.startDate.toISOString()).toBe("2026-05-04T22:00:00.000Z");
  });
});

describe("deleteAbsence", () => {
  it("removes the row", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    const { id } = await createAbsence({
      db,
      ownerId,
      input: vacation(memberId, "2026-05-05", "2026-05-09"),
    });

    await deleteAbsence({ db, ownerId, absenceId: id });

    const rows = await db.select().from(absence).where(eq(absence.id, id));
    expect(rows).toHaveLength(0);
  });

  it("refuses an absence id belonging to another account and leaves it in place", async () => {
    const victim = await newOwner();
    const attacker = await newOwner();
    const victimMember = await newMember(victim.ownerId, "Victim Dev");
    const { id } = await createAbsence({
      db,
      ownerId: victim.ownerId,
      input: vacation(victimMember, "2026-05-05", "2026-05-09"),
    });

    await expect(
      deleteAbsence({ db, ownerId: attacker.ownerId, absenceId: id }),
    ).rejects.toBeInstanceOf(UnknownAbsenceError);

    const rows = await db
      .select()
      .from(absence)
      .where(and(eq(absence.id, id), eq(absence.ownerId, victim.ownerId)));
    expect(rows).toHaveLength(1);
  });
});

describe("listAbsences", () => {
  it("returns only the caller's absences", async () => {
    const mine = await newOwner();
    const theirs = await newOwner();
    const myMember = await newMember(mine.ownerId, "Mine");
    const theirMember = await newMember(theirs.ownerId, "Theirs");
    await createAbsence({
      db,
      ownerId: mine.ownerId,
      input: vacation(myMember, "2026-05-05", "2026-05-09"),
    });
    await createAbsence({
      db,
      ownerId: theirs.ownerId,
      input: vacation(theirMember, "2026-05-05", "2026-05-09"),
    });

    const rows = await listAbsences({ db, ownerId: mine.ownerId });

    expect(rows).toHaveLength(1);
    expect(rows[0].teamMemberId).toBe(myMember);
  });

  it("keeps a window that only partially overlaps the requested range", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-05", "2026-05-09") });

    const rows = await listAbsences({
      db,
      ownerId,
      // Starts on the absence's LAST day — one shared day is enough.
      from: new Date("2026-05-09T12:00:00.000Z"),
      to: new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(rows).toHaveLength(1);
  });

  it("drops a window that shares no day with the requested range", async () => {
    const { ownerId } = await newOwner();
    const memberId = await newMember(ownerId);
    await createAbsence({ db, ownerId, input: vacation(memberId, "2026-05-05", "2026-05-09") });

    const rows = await listAbsences({
      db,
      ownerId,
      from: new Date("2026-05-10T00:00:00.000Z"),
      to: new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(rows).toHaveLength(0);
  });
});
