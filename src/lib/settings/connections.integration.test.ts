import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  githubCommit,
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  sprint,
  statusMapping,
  syncAttempt,
  syncState,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getConnectionsOverview } from "@/lib/settings/connections";
import {
  listAvailableRepos,
  testGithubConnection,
  updateJiraProject,
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

  it("reports credential_unreadable rather than throwing on a corrupt envelope", async () => {
    const { ownerId } = await seedOwner();
    // What a TOKEN_ENCRYPTION_KEY rotation or a cross-environment DB restore
    // leaves behind. The diagnostic tool must survive the case it diagnoses.
    await db
      .update(githubCredential)
      .set({ encryptedToken: "not-an-envelope" })
      .where(eq(githubCredential.ownerId, ownerId));

    const result = await testGithubConnection({ db, ownerId });

    expect(result).toEqual({ ok: false, reason: "credential_unreadable" });
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

  // impl-review F1. The original implementation deleted every monitored_repo row
  // and re-inserted with fresh UUIDs; `github_commit.repo_id` cascades off that
  // id, so ADDING a repo silently wiped the history of the ones being kept — and
  // unrecoverably, since the sync cursor is left untouched.
  it("keeps a retained repo's synced history when the selection grows", async () => {
    const { ownerId } = await seedOwner();
    const [before] = await db
      .select({ id: monitoredRepo.id })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));

    await db.insert(githubCommit).values({
      id: randomUUID(),
      ownerId,
      repoId: before.id,
      sha: "cafe1234",
      message: "must survive a selection edit",
    });

    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;
    // Keep acme/app (555), ADD acme/api (777).
    const result = await updateMonitoredRepos({
      db,
      ownerId,
      selectedRepoIds: ["555", "777"],
      opts: { baseUrl: GH_BASE, fetchImpl },
    });
    expect(result.repoCount).toBe(2);

    // Stable row id is the mechanism — without it the cascade fires.
    const [after] = await db
      .select({ id: monitoredRepo.id })
      .from(monitoredRepo)
      .where(and(eq(monitoredRepo.ownerId, ownerId), eq(monitoredRepo.githubRepoId, 555)));
    expect(after.id).toBe(before.id);

    const commits = await db
      .select({ sha: githubCommit.sha })
      .from(githubCommit)
      .where(eq(githubCommit.ownerId, ownerId));
    expect(commits).toEqual([{ sha: "cafe1234" }]);
  });

  it("still drops a deselected repo, and its history with it", async () => {
    const { ownerId } = await seedOwner();
    const [seeded] = await db
      .select({ id: monitoredRepo.id })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    await db.insert(githubCommit).values({
      id: randomUUID(),
      ownerId,
      repoId: seeded.id,
      sha: "dead5678",
      message: "belongs to a repo being dropped",
    });

    const fetchImpl = (async () => jsonRes(repoList)) as unknown as typeof fetch;
    // Deselect acme/app (555) entirely.
    await updateMonitoredRepos({
      db,
      ownerId,
      selectedRepoIds: ["777"],
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    const rows = await db
      .select({ fullName: monitoredRepo.fullName })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    expect(rows).toEqual([{ fullName: "acme/api" }]);

    const commits = await db
      .select({ sha: githubCommit.sha })
      .from(githubCommit)
      .where(eq(githubCommit.ownerId, ownerId));
    expect(commits).toEqual([]);
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

describe("listAvailableRepos", () => {
  const repoList = [
    { id: 555, full_name: "acme/app", private: false },
    { id: 777, full_name: "acme/api", private: false },
  ];

  // The picker opens pre-checked from this field. Without it the edit flow
  // opened empty, so saving "add one repo" deselected — and cascade-deleted —
  // every repo the owner was keeping.
  it("reports which repos the owner monitors today, scoped to that owner", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/user/repos")) return jsonRes(repoList);
      return jsonRes({ login: "lead" }, 200);
    }) as unknown as typeof fetch;

    const result = await listAvailableRepos({
      db,
      ownerId: a.ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });

    // seedOwner monitors acme/app (555) only.
    expect(result.monitoredRepoIds).toEqual([555]);
    expect(result.repos.map((r) => r.githubRepoId).sort()).toEqual([555, 777]);

    // Owner b's identical selection must not leak into a's answer.
    await db
      .insert(monitoredRepo)
      .values({
        id: randomUUID(),
        ownerId: b.ownerId,
        credentialId: (
          await db
            .select({ id: githubCredential.id })
            .from(githubCredential)
            .where(eq(githubCredential.ownerId, b.ownerId))
        )[0].id,
        githubRepoId: 777,
        fullName: "acme/api",
      });

    const again = await listAvailableRepos({
      db,
      ownerId: a.ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });
    expect(again.monitoredRepoIds).toEqual([555]);
  });

  it("reports an empty selection when nothing is monitored yet", async () => {
    const { ownerId } = await seedOwner({ github: false });
    await db.insert(githubCredential).values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("gh_ConnPat1234ABCD", { ownerId, provider: "GITHUB" }),
      tokenLast4: "ABCD",
      githubLogin: "lead",
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/user/repos")) return jsonRes(repoList);
      return jsonRes({ login: "lead" }, 200);
    }) as unknown as typeof fetch;

    const result = await listAvailableRepos({
      db,
      ownerId,
      opts: { baseUrl: GH_BASE, fetchImpl },
    });
    expect(result.monitoredRepoIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("updateJiraProject", () => {
  const JIRA_BASE = "https://acme.atlassian.net";

  const jiraFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/project/search")) {
      return jsonRes({
        isLast: true,
        values: [
          { id: "10000", key: "SF", name: "SprintFlow" },
          { id: "20000", key: "OTHER", name: "Other Project" },
        ],
      });
    }
    if (url.includes("/statuses")) {
      return jsonRes([
        {
          statuses: [
            { id: "1", name: "To Do", statusCategory: { key: "new" } },
            { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
          ],
        },
      ]);
    }
    return jsonRes({}, 404);
  }) as unknown as typeof fetch;

  const mappings = [
    { jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" as const },
    { jiraStatusId: "3", jiraStatusName: "In Progress", category: "IN_PROGRESS" as const },
  ];

  async function seedSprint(ownerId: string, projectId: string): Promise<void> {
    await db.insert(sprint).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: projectId,
      jiraSprintId: "1001",
      name: "Sprint 24",
      state: "ACTIVE",
    });
  }

  // impl-review F2. The row is UPDATEd in place, which cascades nothing — so
  // without an explicit delete the OLD project's sprint survived, re-labelled,
  // and `getActiveSprintRow` (owner-scoped, not project-scoped) kept serving it
  // while the sync queried the NEW key against the OLD sprint id and reported OK.
  it("discards the previous project's sprints when the project actually changes", async () => {
    const { ownerId, projectId } = await seedOwner();
    await seedSprint(ownerId, projectId);

    const result = await updateJiraProject({
      db,
      ownerId,
      jiraProjectId: "20000",
      mappings,
      baseUrl: JIRA_BASE,
      opts: { fetchImpl: jiraFetch },
    });

    expect(result.sprintsDiscarded).toBe(true);
    const rows = await db
      .select({ id: sprint.id })
      .from(sprint)
      .where(eq(sprint.ownerId, ownerId));
    expect(rows).toEqual([]);
  });

  // The other half of the contract: re-saving the SAME project (e.g. to fix a
  // status mapping) must not be destructive.
  it("keeps the sprints when the same project is re-saved", async () => {
    const { ownerId, projectId } = await seedOwner();
    await seedSprint(ownerId, projectId);

    const result = await updateJiraProject({
      db,
      ownerId,
      jiraProjectId: "10000",
      mappings,
      baseUrl: JIRA_BASE,
      opts: { fetchImpl: jiraFetch },
    });

    expect(result.sprintsDiscarded).toBe(false);
    const rows = await db
      .select({ id: sprint.id })
      .from(sprint)
      .where(eq(sprint.ownerId, ownerId));
    expect(rows).toHaveLength(1);
  });

  it("never discards another owner's sprints", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await seedSprint(a.ownerId, a.projectId);
    await seedSprint(b.ownerId, b.projectId);

    await updateJiraProject({
      db,
      ownerId: a.ownerId,
      jiraProjectId: "20000",
      mappings,
      baseUrl: JIRA_BASE,
      opts: { fetchImpl: jiraFetch },
    });

    const bRows = await db
      .select({ id: sprint.id })
      .from(sprint)
      .where(eq(sprint.ownerId, b.ownerId));
    expect(bRows).toHaveLength(1);
  });
});
