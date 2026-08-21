import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  jiraCredential,
  jiraProject,
  sprint,
  syncState,
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getActiveSprintRow } from "@/lib/sprint";
import { getSyncState } from "@/lib/sync-state";
import { listRoster } from "@/lib/roster";

/**
 * S-07 Phase 1 — owner-scoped dashboard readers against REAL Postgres (local
 * Supabase `:54322`). Guards cross-account isolation (another owner's rows never
 * returned), the getActiveSprintRow resolution rule (prefer ACTIVE, else most-
 * recent by startDate, else null), getSyncState's both-integrations shape, and
 * listRoster's active-only filter.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];
afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

async function seedOwner(): Promise<{ ownerId: string; projectId: string }> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db
    .insert(user)
    .values({ id: ownerId, name: "Lead", email: `lead-${ownerId}@example.test` });
  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_ReaderToken1234", { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });
  const [proj] = await db
    .insert(jiraProject)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: "1",
      projectKey: "SF",
    })
    .returning({ id: jiraProject.id });
  return { ownerId, projectId: proj.id };
}

describe("getActiveSprintRow", () => {
  it("prefers ACTIVE over a more-recently-started non-active sprint", async () => {
    const { ownerId, projectId } = await seedOwner();
    await db.insert(sprint).values([
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectId,
        jiraSprintId: "active",
        state: "ACTIVE",
        startDate: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectId,
        jiraSprintId: "future",
        state: "FUTURE",
        startDate: new Date("2026-08-20T00:00:00Z"),
      },
    ]);

    const row = await getActiveSprintRow(db, ownerId);
    expect(row?.jiraSprintId).toBe("active");
  });

  it("falls back to the most-recently-started sprint when none is ACTIVE", async () => {
    const { ownerId, projectId } = await seedOwner();
    await db.insert(sprint).values([
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectId,
        jiraSprintId: "old",
        state: "CLOSED",
        startDate: new Date("2026-07-01T00:00:00Z"),
      },
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectId,
        jiraSprintId: "recent",
        state: "CLOSED",
        startDate: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const row = await getActiveSprintRow(db, ownerId);
    expect(row?.jiraSprintId).toBe("recent");
  });

  it("returns null when the owner has no sprint", async () => {
    const { ownerId } = await seedOwner();
    expect(await getActiveSprintRow(db, ownerId)).toBeNull();
  });

  it("never returns another owner's sprint", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await db.insert(sprint).values({
      id: randomUUID(),
      ownerId: a.ownerId,
      jiraProjectId: a.projectId,
      jiraSprintId: "a-sprint",
      state: "ACTIVE",
      startDate: new Date("2026-08-01T00:00:00Z"),
    });
    expect(await getActiveSprintRow(db, b.ownerId)).toBeNull();
  });
});

describe("getSyncState", () => {
  it("returns both integrations, null-filled when a row is absent", async () => {
    const { ownerId } = await seedOwner();
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId,
      integration: "GITHUB",
      status: "OK",
      lastSuccessfulSyncAt: new Date("2026-08-21T09:00:00Z"),
    });

    const state = await getSyncState(db, ownerId);
    expect(state.GITHUB.status).toBe("OK");
    expect(state.GITHUB.lastSuccessfulSyncAt?.toISOString()).toBe(
      "2026-08-21T09:00:00.000Z",
    );
    // JIRA never synced → null-filled.
    expect(state.JIRA.status).toBeNull();
    expect(state.JIRA.lastSuccessfulSyncAt).toBeNull();
  });

  it("surfaces error status + lastError for the banner", async () => {
    const { ownerId } = await seedOwner();
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId,
      integration: "JIRA",
      status: "RATE_LIMITED",
      lastError: "429 from Jira",
    });

    const state = await getSyncState(db, ownerId);
    expect(state.JIRA.status).toBe("RATE_LIMITED");
    expect(state.JIRA.lastError).toBe("429 from Jira");
  });

  it("never returns another owner's sync state", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId: a.ownerId,
      integration: "GITHUB",
      status: "OK",
    });
    const state = await getSyncState(db, b.ownerId);
    expect(state.GITHUB.status).toBeNull();
  });
});

describe("listRoster", () => {
  it("returns active members only, owner-scoped", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await db.insert(teamMember).values([
      {
        id: randomUUID(),
        ownerId: a.ownerId,
        name: "Active Dev",
        source: "GITHUB",
        isActive: true,
      },
      {
        id: randomUUID(),
        ownerId: a.ownerId,
        name: "Inactive Dev",
        source: "GITHUB",
        isActive: false,
      },
      {
        id: randomUUID(),
        ownerId: b.ownerId,
        name: "Other Owner Dev",
        source: "GITHUB",
        isActive: true,
      },
    ]);

    const roster = await listRoster(db, a.ownerId);
    expect(roster.map((m) => m.name)).toEqual(["Active Dev"]);
  });
});
