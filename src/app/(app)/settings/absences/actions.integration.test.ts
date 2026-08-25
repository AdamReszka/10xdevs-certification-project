import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { absence, jiraCredential, jiraProject, sprint, teamMember, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";

/**
 * S-08 Phase 1 — absence Server Actions against REAL Postgres.
 *
 * The store suite proves the persistence rules; this one proves the wrapper: the
 * `toFailure` ladder (a user-fixable overlap is `invalid_input` and does NOT log,
 * an unexpected error does), and D1 — every absence mutation re-runs detection,
 * while a detection failure never fails the save the user already committed.
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

// Imported AFTER the mocks (vi.mock is hoisted).
import {
  createAbsenceAction,
  deleteAbsenceAction,
  updateAbsenceAction,
} from "./actions";

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
    name: "Absence Action Test",
    email: `aa-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_ActionTokenABCDEFGH1234", {
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
      timeZone: "Europe/Warsaw",
    })
    .returning({ id: jiraProject.id });

  await db.insert(sprint).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: project.id,
    jiraSprintId: `s08a-${ownerId}`,
    name: "Sprint 7",
    state: "ACTIVE",
    startDate: new Date("2026-05-04T00:00:00.000Z"),
    endDate: new Date("2026-05-15T00:00:00.000Z"),
  });

  return ownerId;
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

beforeEach(() => {
  detectAnomalies.mockClear();
  detectAnomalies.mockResolvedValue({ status: "ok" as const });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

function vacation(teamMemberId: string) {
  return {
    teamMemberId,
    type: "VACATION",
    startDate: "2026-05-05",
    endDate: "2026-05-09",
    isPlanned: true,
  };
}

// --- Tests ------------------------------------------------------------------

describe("createAbsenceAction", () => {
  it("persists the absence and re-runs detection (D1)", async () => {
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);

    const result = await createAbsenceAction(vacation(memberId));

    expect(result.ok).toBe(true);
    const rows = await db.select().from(absence).where(eq(absence.ownerId, currentOwnerId));
    expect(rows).toHaveLength(1);
    // Without this the inbox keeps showing a DEVELOPER_INACTIVE the owner has
    // just explained, until the next 15-minute cron cycle.
    expect(detectAnomalies).toHaveBeenCalledTimes(1);
  });

  it("keeps the save when re-detection throws", async () => {
    // The save is already committed; a detection failure must not tell the user
    // their absence was not recorded.
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);
    detectAnomalies.mockRejectedValue(new Error("detect exploded"));

    const result = await createAbsenceAction(vacation(memberId));

    expect(result.ok).toBe(true);
    const rows = await db.select().from(absence).where(eq(absence.ownerId, currentOwnerId));
    expect(rows).toHaveLength(1);
  });

  it("rejects an end date before the start date with the schema's message", async () => {
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);

    const result = await createAbsenceAction({
      ...vacation(memberId),
      startDate: "2026-05-09",
      endDate: "2026-05-05",
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toContain("before the first day");
    expect(detectAnomalies).not.toHaveBeenCalled();
  });

  it("maps an overlap to invalid_input without logging it as unexpected", async () => {
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);
    await createAbsenceAction(vacation(memberId));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createAbsenceAction(vacation(memberId));

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    // A user-fixable input problem is not an incident; only the unexpected
    // branch logs.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("refuses a team member belonging to another account", async () => {
    const victimId = await newOwner();
    const victimMember = await newMember(victimId, "Victim Dev");
    currentOwnerId = await newOwner();

    const result = await createAbsenceAction(vacation(victimMember));

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    const rows = await db
      .select()
      .from(absence)
      .where(eq(absence.teamMemberId, victimMember));
    expect(rows).toHaveLength(0);
  });
});

describe("updateAbsenceAction", () => {
  it("edits in place and re-runs detection", async () => {
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);
    const created = await createAbsenceAction(vacation(memberId));
    if (!created.ok) throw new Error("setup failed");
    detectAnomalies.mockClear();

    const result = await updateAbsenceAction({
      ...vacation(memberId),
      id: created.id,
      type: "SICKNESS",
      isPlanned: false,
    });

    expect(result.ok).toBe(true);
    const rows = await db.select().from(absence).where(eq(absence.ownerId, currentOwnerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("SICKNESS");
    expect(detectAnomalies).toHaveBeenCalledTimes(1);
  });

  it("refuses an absence id belonging to another account", async () => {
    const victimId = await newOwner();
    const victimMember = await newMember(victimId, "Victim Dev");
    currentOwnerId = victimId;
    const created = await createAbsenceAction(vacation(victimMember));
    if (!created.ok) throw new Error("setup failed");

    currentOwnerId = await newOwner();
    const attackerMember = await newMember(currentOwnerId, "Attacker Dev");
    const result = await updateAbsenceAction({
      teamMemberId: attackerMember,
      id: created.id,
      type: "SICKNESS",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      isPlanned: false,
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    const [row] = await db.select().from(absence).where(eq(absence.id, created.id));
    expect(row.type).toBe("VACATION");
  });
});

describe("deleteAbsenceAction", () => {
  it("removes the absence and re-runs detection", async () => {
    currentOwnerId = await newOwner();
    const memberId = await newMember(currentOwnerId);
    const created = await createAbsenceAction(vacation(memberId));
    if (!created.ok) throw new Error("setup failed");
    detectAnomalies.mockClear();

    const result = await deleteAbsenceAction(created.id);

    expect(result.ok).toBe(true);
    const rows = await db.select().from(absence).where(eq(absence.ownerId, currentOwnerId));
    expect(rows).toHaveLength(0);
    // A deleted absence must un-suppress DEVELOPER_INACTIVE just as promptly as
    // recording one suppressed it.
    expect(detectAnomalies).toHaveBeenCalledTimes(1);
  });

  it("refuses an absence id belonging to another account", async () => {
    const victimId = await newOwner();
    const victimMember = await newMember(victimId, "Victim Dev");
    currentOwnerId = victimId;
    const created = await createAbsenceAction(vacation(victimMember));
    if (!created.ok) throw new Error("setup failed");

    currentOwnerId = await newOwner();
    const result = await deleteAbsenceAction(created.id);

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    const rows = await db.select().from(absence).where(eq(absence.id, created.id));
    expect(rows).toHaveLength(1);
  });
});
