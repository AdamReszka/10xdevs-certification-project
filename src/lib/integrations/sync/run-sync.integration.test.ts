import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  githubCommit,
  githubCredential,
  githubPullRequest,
  githubReview,
  jiraCredential,
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  monitoredRepo,
  sprint,
  statusMapping,
  syncState,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { syncOwner } from "@/lib/integrations/sync/run-sync";

/**
 * S-05 Phase 4 — `syncOwner` integration tests against REAL Postgres (local
 * Supabase `:54322`). The store core is request-context-free; the GitHub + Jira
 * HTTP edges are mocked via injectable `fetchImpl` / base overrides (no network).
 *
 * Coverage: GitHub upsert + PR↔ticket link at ingestion; Jira ticket + status
 * history + category mapping + cursor advance; per-integration INDEPENDENCE (a
 * GitHub 401 leaves Jira OK); the per-cycle PR cap; and the fresh-lease skip.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const NOW = new Date("2026-08-20T12:00:00.000Z");
const GH_BASE = "https://gh.test";
const JIRA_BASE = "https://jira.test";
const REPO = "acme/app";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- GitHub mock ------------------------------------------------------------

const COMMITS = [
  {
    sha: "sha-1",
    author: { login: "octocat" },
    commit: { author: { date: "2026-08-19T09:00:00.000Z" }, message: "feat: sync" },
  },
];

/** Two PRs, newest-updated first (as GitHub returns with sort=updated desc). */
const PULLS = [
  {
    id: 501,
    number: 7,
    title: "Add sync engine",
    body: "Implements SF-123 end to end",
    user: { login: "octocat" },
    state: "open",
    merged_at: null,
    closed_at: null,
    created_at: "2026-08-18T09:00:00.000Z",
    updated_at: "2026-08-19T10:00:00.000Z",
    draft: false,
    head: { ref: "feature/SF-123" },
    html_url: "https://gh.test/acme/app/pull/7",
  },
  {
    id: 502,
    number: 8,
    title: "Chore no ticket",
    body: "",
    user: { login: "devtwo" },
    state: "open",
    merged_at: null,
    closed_at: null,
    created_at: "2026-08-17T09:00:00.000Z",
    updated_at: "2026-08-18T10:00:00.000Z",
    draft: false,
    head: { ref: "chore/cleanup" },
    html_url: "https://gh.test/acme/app/pull/8",
  },
];

function githubFetch(opts?: { failStatus?: number }): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    if (opts?.failStatus) return jsonRes({ message: "Bad credentials" }, opts.failStatus);
    if (/\/pulls\/\d+\/reviews/.test(url)) {
      const n = Number(url.match(/\/pulls\/(\d+)\/reviews/)![1]);
      return jsonRes(
        n === 7
          ? [{ id: 9001, user: { login: "rev" }, state: "APPROVED", submitted_at: "2026-08-19T11:00:00.000Z" }]
          : [],
      );
    }
    if (/\/pulls\/\d+$/.test(url)) {
      return jsonRes({ additions: 120, deletions: 12, changed_files: 5 });
    }
    if (url.includes("/pulls?")) return jsonRes(PULLS);
    if (url.includes("/commits?")) return jsonRes(COMMITS);
    throw new Error(`unexpected GitHub mock URL: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// --- Jira mock --------------------------------------------------------------

const SP_FIELD = "customfield_10016";

const JIRA_ISSUE = {
  id: "1001",
  key: "SF-1",
  fields: {
    summary: "Build the engine",
    status: { id: "3", name: "In Progress" },
    assignee: { accountId: "acc-1" },
    created: "2026-08-18T08:00:00.000Z",
    [SP_FIELD]: 5,
  },
  changelog: {
    histories: [
      {
        id: "h1",
        created: "2026-08-19T08:00:00.000Z",
        items: [{ field: "status", from: "1", fromString: "To Do", to: "3", toString: "In Progress" }],
      },
    ],
  },
};

function jiraFetch(opts?: { failStatus?: number }): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    if (opts?.failStatus) return jsonRes({ message: "Unauthorized" }, opts.failStatus);
    if (url.includes("/rest/api/3/field")) {
      return jsonRes([
        {
          id: SP_FIELD,
          name: "Story Points",
          custom: true,
          schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" },
        },
      ]);
    }
    if (url.includes("/rest/api/3/search/jql")) {
      return jsonRes({ issues: [JIRA_ISSUE], nextPageToken: null });
    }
    throw new Error(`unexpected Jira mock URL: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// --- Seed / cleanup ---------------------------------------------------------

async function seedOwner(): Promise<{ ownerId: string; repoId: string }> {
  const ownerId = randomUUID();
  await db.insert(user).values({ id: ownerId, name: "Sync Test", email: `st-${ownerId}@example.test` });

  const [ghCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("gh_SyncPatABCDEFGH1234", { ownerId, provider: "GITHUB" }),
      tokenLast4: "1234",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  const [repo] = await db
    .insert(monitoredRepo)
    .values({ id: randomUUID(), ownerId, credentialId: ghCred.id, githubRepoId: 555, fullName: REPO })
    .returning({ id: monitoredRepo.id });

  const [jiraCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_SyncTokenABCDEFGH1234", { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const [proj] = await db
    .insert(jiraProject)
    .values({ id: randomUUID(), ownerId, credentialId: jiraCred.id, jiraProjectId: "10000", projectKey: "SF" })
    .returning({ id: jiraProject.id });

  await db.insert(statusMapping).values([
    { id: randomUUID(), ownerId, jiraProjectId: proj.id, jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" },
    { id: randomUUID(), ownerId, jiraProjectId: proj.id, jiraStatusId: "3", jiraStatusName: "In Progress", category: "IN_PROGRESS" },
  ]);

  await db.insert(sprint).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: proj.id,
    jiraSprintId: "42",
    name: "Sprint 7",
    state: "ACTIVE",
    startDate: new Date("2026-08-17T08:00:00.000Z"),
    endDate: new Date("2026-08-31T08:00:00.000Z"),
  });

  return { ownerId, repoId: repo.id };
}

const owners: string[] = [];
async function newOwner() {
  const seeded = await seedOwner();
  owners.push(seeded.ownerId);
  return seeded;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

function baseArgs(ownerId: string, gh: typeof fetch, jira: typeof fetch) {
  return {
    db,
    ownerId,
    now: NOW,
    githubOpts: { baseUrl: GH_BASE, fetchImpl: gh },
    jiraBaseUrl: JIRA_BASE,
    jiraOpts: { fetchImpl: jira },
  };
}

// --- Tests ------------------------------------------------------------------

describe("syncOwner — GitHub ingestion + PR↔ticket link", () => {
  it("upserts commits/PRs/reviews and sets linked_ticket_key from the branch", async () => {
    const { ownerId } = await newOwner();
    const gh = githubFetch();
    const jira = jiraFetch();

    const result = await syncOwner(baseArgs(ownerId, gh.fetchImpl, jira.fetchImpl));

    expect(result.github.status).toBe("OK");

    const commits = await db.select().from(githubCommit).where(eq(githubCommit.ownerId, ownerId));
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("sha-1");
    // F4: per-commit size is not fetched — left NULL in MVP.
    expect(commits[0].additions).toBeNull();

    const prs = await db.select().from(githubPullRequest).where(eq(githubPullRequest.ownerId, ownerId));
    const pr7 = prs.find((p) => p.number === 7)!;
    expect(pr7.linkedTicketKey).toBe("SF-123");
    expect(pr7.additions).toBe(120);
    expect(pr7.changedFiles).toBe(5);
    const pr8 = prs.find((p) => p.number === 8)!;
    expect(pr8.linkedTicketKey).toBeNull();

    const reviews = await db.select().from(githubReview).where(eq(githubReview.pullRequestId, pr7.id));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].state).toBe("APPROVED");

    const [ghState] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "GITHUB")));
    expect(ghState.status).toBe("OK");
    expect(ghState.lastSuccessfulSyncAt?.toISOString()).toBe(NOW.toISOString());
    expect(ghState.claimedUntil).toBeNull();
  });
});

describe("syncOwner — Jira ingestion + status history + cursor", () => {
  it("upserts the ticket with mapped category, status history, and advances the cursor", async () => {
    const { ownerId } = await newOwner();
    const gh = githubFetch();
    const jira = jiraFetch();

    const result = await syncOwner(baseArgs(ownerId, gh.fetchImpl, jira.fetchImpl));

    expect(result.jira.status).toBe("OK");

    const [ticket] = await db.select().from(jiraTicket).where(eq(jiraTicket.ownerId, ownerId));
    expect(ticket.jiraKey).toBe("SF-1");
    expect(ticket.storyPoints).toBe(5);
    expect(ticket.currentCategory).toBe("IN_PROGRESS");
    expect(ticket.addedAfterSprintStart).toBe(true); // created 08-18 > sprint start 08-17
    expect(ticket.sourceUrl).toBe(`${JIRA_BASE}/browse/SF-1`);

    const history = await db.select().from(jiraStatusHistory).where(eq(jiraStatusHistory.ticketId, ticket.id));
    expect(history).toHaveLength(1);
    expect(history[0].jiraChangelogId).toBe("h1");
    expect(history[0].fromCategory).toBe("TODO");
    expect(history[0].toCategory).toBe("IN_PROGRESS");

    const [jState] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "JIRA")));
    expect(jState.status).toBe("OK");
    expect(jState.jiraHistoryCursor).toBe(NOW.toISOString());
  });

  it("passes an `updated >=` delta clause on the second sync using the stored cursor", async () => {
    const { ownerId } = await newOwner();

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    // Second run bypasses the due-check (the on-demand path) and captures the JQL.
    const jira2 = jiraFetch();
    await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jira2.fetchImpl),
      bypassDueCheck: true,
    });

    const searchCall = jira2.calls.find((u) => u.includes("/search/jql"))!;
    expect(decodeURIComponent(searchCall.replace(/\+/g, " "))).toContain("updated >=");
  });
});

describe("syncOwner — per-integration independence", () => {
  it("records a GitHub auth failure as ERROR while Jira stays OK", async () => {
    const { ownerId } = await newOwner();
    const gh = githubFetch({ failStatus: 401 });
    const jira = jiraFetch();

    const result = await syncOwner(baseArgs(ownerId, gh.fetchImpl, jira.fetchImpl));

    expect(result.github.status).toBe("ERROR");
    expect(result.jira.status).toBe("OK");

    const states = await db.select().from(syncState).where(eq(syncState.ownerId, ownerId));
    const ghState = states.find((s) => s.integration === "GITHUB")!;
    const jState = states.find((s) => s.integration === "JIRA")!;
    expect(ghState.status).toBe("ERROR");
    expect(ghState.lastSuccessfulSyncAt).toBeNull(); // never stamped fresh on failure
    expect(jState.status).toBe("OK");
    expect(jState.lastSuccessfulSyncAt?.toISOString()).toBe(NOW.toISOString());

    // Jira wrote its ticket; GitHub wrote nothing.
    expect(await db.select().from(jiraTicket).where(eq(jiraTicket.ownerId, ownerId))).toHaveLength(1);
    expect(await db.select().from(githubCommit).where(eq(githubCommit.ownerId, ownerId))).toHaveLength(0);
  });
});

describe("syncOwner — per-cycle PR cap", () => {
  it("processes only the newest N PRs when capped", async () => {
    const { ownerId } = await newOwner();
    const gh = githubFetch();

    await syncOwner({
      ...baseArgs(ownerId, gh.fetchImpl, jiraFetch().fetchImpl),
      maxPrs: 1,
    });

    const prs = await db.select().from(githubPullRequest).where(eq(githubPullRequest.ownerId, ownerId));
    // Only the newest-updated PR (#7) is enriched + written under the cap.
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(7);
    // The capped PR's detail endpoint was never called.
    expect(gh.calls.some((u) => /\/pulls\/8$/.test(u))).toBe(false);
  });
});

describe("syncOwner — fresh-lease skip", () => {
  it("skips an integration whose lease is still fresh", async () => {
    const { ownerId } = await newOwner();
    // Pre-stamp a fresh GitHub lease (as if another fire is mid-sync).
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId,
      integration: "GITHUB",
      claimedUntil: new Date(NOW.getTime() + 5 * 60_000),
    });

    const gh = githubFetch();
    const result = await syncOwner(baseArgs(ownerId, gh.fetchImpl, jiraFetch().fetchImpl));

    expect(result.github).toEqual({ status: "SKIPPED", reason: "leased" });
    // No GitHub fetch happened and no rows were written.
    expect(gh.calls).toHaveLength(0);
    expect(await db.select().from(githubCommit).where(eq(githubCommit.ownerId, ownerId))).toHaveLength(0);
    // Jira was unaffected.
    expect(result.jira.status).toBe("OK");
  });
});
