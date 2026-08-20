import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  sprint,
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import {
  importCadence,
  importRoster,
  saveCadence,
} from "@/lib/integrations/roster-store";

/**
 * S-04 Phase 2 — roster + cadence service-core integration tests against REAL
 * Postgres (local Supabase `:54322`). Targets the request-context-free core
 * (`roster-store.ts`) with `{ db, ownerId }` explicit; the GitHub + Jira HTTP
 * edges are mocked via injectable `fetchImpl` / base overrides (no network).
 *
 * Coverage:
 *  - fresh import seeds from both sources; re-import PRESERVES user edits and
 *    never touches MANUAL rows (merge-by-key, FR-006).
 *  - importCadence persists board_id + upserts the sprint when active; the
 *    no-active-sprint path persists board_id only and writes NO sprint row (F1).
 *  - cadence override survives re-import (FR-007): only metadata refreshes.
 *  - GitHub 403 degrades (no throw) and Jira-seeded members still persist.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// --- Fake bases + tokens ----------------------------------------------------

const GH_BASE = "https://gh.test";
const JIRA_BASE = "https://jira.test";
const GH_TOKEN = "gh_IntegrationPatABCDEFGH1234";
const JIRA_TOKEN = "jira_IntegrationTokenABCDEFGH1234";
const JIRA_EMAIL = "lead@example.com";

// --- Fixtures ---------------------------------------------------------------

const COLLABORATORS = [
  { login: "octocat", id: 1, type: "User", role_name: "admin" },
  { login: "devtwo", id: 2, type: "User", role_name: "write" },
  { login: "ci-bot", id: 3, type: "Bot", role_name: "write" },
];

const JIRA_MEMBERS = [
  { accountId: "acc-1", accountType: "atlassian", displayName: "Mia Krystof", active: true },
  { accountId: "acc-2", accountType: "atlassian", displayName: "Sam Lee", active: true },
  { accountId: "app-9", accountType: "app", displayName: "Automation for Jira" },
];

const BOARD = { id: 77, name: "SF Scrum", type: "scrum" };

/** Fixed active sprint: 2026-08-17T00:00Z (Mon UTC) → +14d. */
const ACTIVE_SPRINT = {
  id: 4242,
  state: "active",
  name: "Sprint 7",
  startDate: "2026-08-17T08:00:00.000Z",
  endDate: "2026-08-31T08:00:00.000Z",
};

// --- HTTP edge mocks --------------------------------------------------------

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** GitHub collaborators mock; `status` forces a degradation (e.g. 403). */
function githubFetch(opts?: { status?: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/collaborators")) {
      if (opts?.status && opts.status !== 200) return jsonRes({ message: "Forbidden" }, opts.status);
      return jsonRes(COLLABORATORS);
    }
    throw new Error(`unexpected GitHub mock URL: ${url}`);
  }) as typeof fetch;
}

/**
 * Jira mock answering /myself, /board, /board/{id}/sprint, and
 * /user/assignable/search. `noActiveSprint` empties the sprint response;
 * `timeZone` seeds /myself.
 */
function jiraFetch(opts?: { noActiveSprint?: boolean; timeZone?: string }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/user/assignable/search")) {
      // Offset paging: first page the members, then an empty page to terminate.
      return url.includes("startAt=0") ? jsonRes(JIRA_MEMBERS) : jsonRes([]);
    }
    if (url.includes("/sprint")) {
      return jsonRes({ values: opts?.noActiveSprint ? [] : [ACTIVE_SPRINT] });
    }
    if (url.includes("/board")) {
      return jsonRes({ isLast: true, values: [BOARD] });
    }
    if (url.includes("/myself")) {
      return jsonRes({ accountId: "acc-owner", timeZone: opts?.timeZone ?? "UTC" });
    }
    throw new Error(`unexpected Jira mock URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup ---------------------------------------------------------

async function seedOwner(): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Roster Test",
    email: `rt-${ownerId}@example.test`,
  });

  const [ghCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken(GH_TOKEN, { ownerId, provider: "GITHUB" }),
      tokenLast4: "1234",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  await db.insert(monitoredRepo).values({
    id: randomUUID(),
    ownerId,
    credentialId: ghCred.id,
    githubRepoId: 555,
    fullName: "acme/app",
  });

  const [jiraCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken(JIRA_TOKEN, { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: JIRA_EMAIL,
    })
    .returning({ id: jiraCredential.id });

  await db.insert(jiraProject).values({
    id: randomUUID(),
    ownerId,
    credentialId: jiraCred.id,
    jiraProjectId: "10000",
    projectKey: "SF",
  });

  return ownerId;
}

const owners: string[] = [];

async function newOwner(): Promise<string> {
  const id = await seedOwner();
  owners.push(id);
  return id;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

// --- Tests ------------------------------------------------------------------

describe("importRoster — merge-by-key (FR-006)", () => {
  it("fresh import seeds members from both sources (bots filtered)", async () => {
    const ownerId = await newOwner();

    const result = await importRoster({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch() },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(result.githubDegraded).toBe(false);
    // 2 human collaborators (bot dropped) + 2 atlassian members (app dropped).
    expect(result.members).toHaveLength(4);
    const byGithub = result.members.filter((m) => m.source === "GITHUB");
    const byJira = result.members.filter((m) => m.source === "JIRA");
    expect(byGithub.map((m) => m.githubUsername).sort()).toEqual(["devtwo", "octocat"]);
    expect(byJira.map((m) => m.jiraAccountId).sort()).toEqual(["acc-1", "acc-2"]);
    expect(byJira.find((m) => m.jiraAccountId === "acc-1")?.name).toBe("Mia Krystof");
  });

  it("re-import preserves edited fields and never touches MANUAL rows", async () => {
    const ownerId = await newOwner();

    await importRoster({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch() },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    // Simulate a user edit on an auto-imported GitHub row.
    await db
      .update(teamMember)
      .set({ role: "Tech Lead", spCapacity: 8, technologyTrack: "BACKEND" })
      .where(and(eq(teamMember.ownerId, ownerId), eq(teamMember.githubUsername, "octocat")));

    // Add a MANUAL member that import must never touch.
    const manualId = randomUUID();
    await db.insert(teamMember).values({
      id: manualId,
      ownerId,
      name: "Contractor",
      role: "Consultant",
      source: "MANUAL",
    });

    const result = await importRoster({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch() },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    // No duplicates created: 4 auto + 1 manual.
    expect(result.members).toHaveLength(5);

    const edited = result.members.find((m) => m.githubUsername === "octocat");
    expect(edited?.role).toBe("Tech Lead");
    expect(edited?.spCapacity).toBe(8);
    expect(edited?.technologyTrack).toBe("BACKEND");

    const manual = result.members.find((m) => m.id === manualId);
    expect(manual?.source).toBe("MANUAL");
    expect(manual?.name).toBe("Contractor");
    expect(manual?.role).toBe("Consultant");
  });

  it("GitHub 403 degrades without throwing; Jira members still persist", async () => {
    const ownerId = await newOwner();

    const result = await importRoster({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch({ status: 403 }) },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(result.githubDegraded).toBe(true);
    expect(result.reason).toContain("read:org");
    // Only the 2 Jira members were seeded; no GitHub rows.
    expect(result.members).toHaveLength(2);
    expect(result.members.every((m) => m.source === "JIRA")).toBe(true);
  });
});

describe("importCadence — board + sprint persistence (FR-007)", () => {
  it("persists board_id and upserts the sprint when active", async () => {
    const ownerId = await newOwner();

    const result = await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch({ timeZone: "UTC" }) },
    });

    expect(result.boardId).toBe(77);
    expect(result.noActiveSprint).toBe(false);
    expect(result.jiraSprintId).toBe("4242");
    expect(result.cadence.lengthDays).toBe(14);
    expect(result.cadence.startDay).toBe("MON");

    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    expect(proj.boardId).toBe("77");

    const [row] = await db
      .select()
      .from(sprint)
      .where(eq(sprint.ownerId, ownerId));
    expect(row.jiraSprintId).toBe("4242");
    expect(row.state).toBe("ACTIVE");
    expect(row.lengthDays).toBe(14);
    expect(row.startDay).toBe("MON");
    expect(row.workingDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(row.cadenceOverridden).toBe(false);
  });

  it("no active sprint: persists board_id but writes NO sprint row (F1)", async () => {
    const ownerId = await newOwner();

    const result = await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch({ noActiveSprint: true }) },
    });

    expect(result.noActiveSprint).toBe(true);
    expect(result.boardId).toBe(77);
    expect(result.jiraSprintId).toBeNull();
    // Editable defaults returned.
    expect(result.cadence.lengthDays).toBe(14);

    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    expect(proj.boardId).toBe("77");

    const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it("cadence override survives re-import; only metadata refreshes (FR-007)", async () => {
    const ownerId = await newOwner();

    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    // User overrides the cadence.
    const override = await saveCadence({
      db,
      ownerId,
      cadence: { lengthDays: 21, startDay: "WED", workingDays: ["MON", "TUE", "WED"] },
    });
    expect(override.updated).toBe(1);

    // Re-import (same active sprint) must NOT clobber the override.
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    const [row] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(row.cadenceOverridden).toBe(true);
    expect(row.lengthDays).toBe(21);
    expect(row.startDay).toBe("WED");
    expect(row.workingDays).toEqual(["MON", "TUE", "WED"]);
    // Metadata still refreshed from the sprint.
    expect(row.name).toBe("Sprint 7");
    expect(row.state).toBe("ACTIVE");
  });
});
