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
  statusMapping,
  syncAttempt,
  syncState,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getConnectionsOverview } from "@/lib/settings/connections";
import {
  testGithubConnection,
  updateMonitoredRepos,
} from "@/lib/settings/connection-service";

/**
 * S-10 Phase 7 — the Connections surface against REAL Postgres (local Supabase
 * `:54322`). The GitHub HTTP edge is mocked via the injectable `fetchImpl`.
 *
 * The load-bearing assertions: cross-account isolation (no RLS behind this), and
 * that nothing secret reaches the overview payload.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const GH_BASE = "https://gh.test";
const owners: string[] = [];

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Seeded = { ownerId: string; projectId: string };

async function seedOwner(opts: { github?: boolean; jira?: boolean } = {}): Promise<Seeded> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db
    .insert(user)
    .values({ id: ownerId, name: "Lead", email: `conn-${ownerId}@example.test` });

  let projectId = "";

  if (opts.jira !== false) {
    const [cred] = await db
      .insert(jiraCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken: encryptToken("jira_ConnToken1234", { ownerId, provider: "JIRA" }),
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
        jiraProjectId: "10000",
        projectKey: "SF",
      })
      .returning({ id: jiraProject.id });
    projectId = proj.id;

    await db.insert(statusMapping).values([
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: proj.id,
        jiraStatusId: "1",
        jiraStatusName: "To Do",
        category: "TODO",
      },
      {
        id: randomUUID(),
        ownerId,
        jiraProjectId: proj.id,
        jiraStatusId: "3",
        jiraStatusName: "In Progress",
        category: "IN_PROGRESS",
      },
    ]);
  }

  if (opts.github !== false) {
    const [cred] = await db
      .insert(githubCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken: encryptToken("gh_ConnPat1234ABCD", { ownerId, provider: "GITHUB" }),
        tokenLast4: "ABCD",
        githubLogin: "lead",
      })
      .returning({ id: githubCredential.id });

    await db.insert(monitoredRepo).values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      githubRepoId: 555,
      fullName: "acme/app",
    });
  }

  return { ownerId, projectId };
}

async function seedState(
  ownerId: string,
  integration: "GITHUB" | "JIRA",
  status: "OK" | "ERROR" | "RATE_LIMITED",
  lastError: string | null = null,
): Promise<void> {
  await db.insert(syncState).values({
    id: randomUUID(),
    ownerId,
    integration,
    status,
    lastError,
    lastSuccessfulSyncAt: status === "OK" ? new Date("2026-08-22T10:00:00Z") : null,
    lastAttemptAt: new Date("2026-08-22T10:05:00Z"),
  });
}

// ---------------------------------------------------------------------------

describe("getConnectionsOverview", () => {
  it("reports both integrations' identity, selection, and health", async () => {
    const { ownerId } = await seedOwner();
    await seedState(ownerId, "GITHUB", "OK");
    await seedState(ownerId, "JIRA", "RATE_LIMITED");

    const overview = await getConnectionsOverview(db, ownerId);

    expect(overview.github.connection).toMatchObject({
      connected: true,
      login: "lead",
      tokenLast4: "ABCD",
    });
    expect(
      overview.github.connection.connected && overview.github.connection.repos,
    ).toEqual([expect.objectContaining({ fullName: "acme/app" })]);
    expect(overview.github.health.status).toBe("OK");
    expect(overview.github.health.lastSuccessfulSyncAt).toBe("2026-08-22T10:00:00.000Z");

    expect(overview.jira.connection).toMatchObject({
      connected: true,
      workspaceUrl: "https://acme.atlassian.net",
      email: "lead@example.com",
      projectKey: "SF",
      mappedStatusCount: 2,
    });
    expect(overview.jira.health.status).toBe("RATE_LIMITED");
  });

  it("reports not-connected as a first-class state, not an error", async () => {
    const { ownerId } = await seedOwner({ github: false, jira: false });

    const overview = await getConnectionsOverview(db, ownerId);

    expect(overview.github.connection.connected).toBe(false);
    expect(overview.jira.connection.connected).toBe(false);
    expect(overview.github.health.status).toBeNull();
  });

  it("never exposes the encrypted token or the stored error text", async () => {
    const { ownerId } = await seedOwner();
    await seedState(ownerId, "GITHUB", "ERROR", "401 Unauthorized calling https://api.github.com");

    const overview = await getConnectionsOverview(db, ownerId);
    const serialized = JSON.stringify(overview);

    // The guardrail this whole surface is built around.
    expect(serialized).not.toContain("401 Unauthorized");
    expect(serialized).not.toContain("api.github.com");
    expect(serialized).not.toMatch(/gh_ConnPat|jira_ConnToken/);
    expect(serialized).not.toContain("encryptedToken");
    // The classifiable status IS exposed — that is what the UI renders from.
    expect(overview.github.health.status).toBe("ERROR");
  });

  it("returns the recent attempts newest-first", async () => {
    const { ownerId } = await seedOwner();
    await seedState(ownerId, "GITHUB", "OK");
    for (const [i, status] of (["ERROR", "RATE_LIMITED", "OK"] as const).entries()) {
      await db.insert(syncAttempt).values({
        id: randomUUID(),
        ownerId,
        integration: "GITHUB",
        status,
        outcome: null,
        finishedAt: new Date(Date.UTC(2026, 7, 22, 10, i)),
      });
    }

    const overview = await getConnectionsOverview(db, ownerId);

    expect(overview.github.health.recentAttempts.map((a) => a.status)).toEqual([
      "OK",
      "RATE_LIMITED",
      "ERROR",
    ]);
  });

  it("never returns another owner's connection or attempts", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await seedState(a.ownerId, "GITHUB", "OK");
    await seedState(b.ownerId, "GITHUB", "ERROR");
    await db.insert(syncAttempt).values({
      id: randomUUID(),
      ownerId: b.ownerId,
      integration: "GITHUB",
      status: "ERROR",
      outcome: null,
      finishedAt: new Date(),
    });

    const overviewA = await getConnectionsOverview(db, a.ownerId);

    expect(overviewA.github.health.status).toBe("OK");
    expect(overviewA.github.health.recentAttempts).toHaveLength(0);
  });
});

describe("testGithubConnection", () => {
  it("returns the live identity when the stored token still works", async () => {
    const { ownerId } = await seedOwner();
    const fetchImpl = (async () =>
      jsonRes({ login: "lead" }, 200)) as unknown as typeof fetch;

    const result = await testGithubConnection({
      db,
      ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    expect(result).toEqual({ ok: true, identity: "lead" });
  });

  it("reports auth failure when the stored token is now rejected", async () => {
    const { ownerId } = await seedOwner();
    const fetchImpl = (async () =>
      jsonRes({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;

    const result = await testGithubConnection({
      db,
      ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    // This is the answer a stale sync_state row cannot give.
    expect(result).toEqual({ ok: false, reason: "auth" });
  });

  it("separates an unavailable API from a dead token", async () => {
    const { ownerId } = await seedOwner();
    const fetchImpl = (async () => jsonRes({ message: "boom" }, 503)) as unknown as typeof fetch;

    const result = await testGithubConnection({
      db,
      ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports not_connected rather than throwing when nothing is connected", async () => {
    const { ownerId } = await seedOwner({ github: false });

    const result = await testGithubConnection({ db, ownerId });

    expect(result).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("updateMonitoredRepos", () => {
  const repoList = [
    { id: 555, full_name: "acme/app", private: false },
    { id: 777, full_name: "acme/api", private: false },
  ];

  it("replaces the selection rather than appending to it", async () => {
    const { ownerId } = await seedOwner();
    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;

    const result = await updateMonitoredRepos({
      db,
      ownerId,
      selectedRepoIds: ["777"],
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    expect(result.repoCount).toBe(1);
    const rows = await db
      .select({ fullName: monitoredRepo.fullName })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    expect(rows).toEqual([{ fullName: "acme/api" }]);
  });

  it("keeps the credential intact — no token is re-entered", async () => {
    const { ownerId } = await seedOwner();
    const [before] = await db
      .select({ id: githubCredential.id, token: githubCredential.encryptedToken })
      .from(githubCredential)
      .where(eq(githubCredential.ownerId, ownerId));
    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;

    await updateMonitoredRepos({
      db,
      ownerId,
      selectedRepoIds: ["555", "777"],
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    const [after] = await db
      .select({ id: githubCredential.id, token: githubCredential.encryptedToken })
      .from(githubCredential)
      .where(eq(githubCredential.ownerId, ownerId));
    expect(after.id).toBe(before.id);
    expect(after.token).toBe(before.token);
  });

  it("rejects a selection GitHub no longer knows about", async () => {
    const { ownerId } = await seedOwner();
    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;

    await expect(
      updateMonitoredRepos({
        db,
        ownerId,
        selectedRepoIds: ["999999"],
        opts: { baseUrl: GH_BASE, fetchImpl },
      }),
    ).rejects.toThrow();

    // The previous selection survives a rejected update.
    const rows = await db
      .select({ fullName: monitoredRepo.fullName })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    expect(rows).toEqual([{ fullName: "acme/app" }]);
  });

  it("never touches another owner's repos", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;

    await updateMonitoredRepos({
      db,
      ownerId: a.ownerId,
      selectedRepoIds: ["777"],
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    const bRows = await db
      .select({ fullName: monitoredRepo.fullName })
      .from(monitoredRepo)
      .where(and(eq(monitoredRepo.ownerId, b.ownerId)));
    expect(bRows).toEqual([{ fullName: "acme/app" }]);
  });
});
