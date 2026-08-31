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
  sprintCadenceOverride,
  sprintMeasurement,
  statusMapping,
  syncAttempt,
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

/** Per-commit `stats`, keyed by sha — the detail endpoint the list omits. */
const COMMIT_STATS: Record<string, { additions: number; deletions: number }> = {
  "sha-1": { additions: 42, deletions: 7 },
  "sha-2": { additions: 100, deletions: 3 },
};

function githubFetch(opts?: {
  failStatus?: number;
  commits?: unknown[];
  /** Make the per-commit DETAIL endpoint fail for one sha only (impl-review F4). */
  failDetailFor?: string;
}): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    if (opts?.failStatus) return jsonRes({ message: "Bad credentials" }, opts.failStatus);
    if (/\/commits\/[^/?]+$/.test(url)) {
      const sha = url.split("/").pop()!;
      if (opts?.failDetailFor === sha) return jsonRes({ message: "Not Found" }, 404);
      const stats = COMMIT_STATS[sha];
      return jsonRes(stats ? { sha, stats } : { sha });
    }
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
    if (url.includes("/commits?")) return jsonRes(opts?.commits ?? COMMITS);
    throw new Error(`unexpected GitHub mock URL: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// --- Jira mock --------------------------------------------------------------

const SP_FIELD = "customfield_10016";
/** The Jira Software `Sprint` field. Its display name in the mock is
 *  deliberately NOT the English "Sprint" — the parser must find it by id. */
const SPRINT_FIELD = "customfield_10020";

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

const JIRA_TIME_ZONE = "Europe/Warsaw";

/** The board `seedOwner` stamps onto `jira_project.board_id`. */
const JIRA_BOARD = { id: 77, name: "SF Scrum", type: "scrum" };

/** Default active sprint the agile mock reports — matches the SEEDED row
 *  (`jira_sprint_id: "42"`, same dates), so every pre-existing test sees a
 *  no-op reconcile rather than a rollover. */
const JIRA_ACTIVE_SPRINT = {
  id: 42,
  state: "active",
  name: "Sprint 7",
  startDate: "2026-08-17T08:00:00.000Z",
  endDate: "2026-08-31T08:00:00.000Z",
};

function jiraFetch(opts?: {
  failStatus?: number;
  issues?: unknown[];
  timeZone?: string | null;
  /** Override the agile active-sprint response; `null` = between sprints. */
  activeSprint?: typeof JIRA_ACTIVE_SPRINT | null;
  /** Override the board list — more than one drives `board_ambiguous`. */
  boards?: Array<{ id: number; name: string; type: string }>;
  /** Status returned by the AGILE endpoints only, leaving `/myself` at 200.
   *  A blanket `failStatus` is caught by `validateCredentials` first and would
   *  never exercise the reconcile's own 401 branch. */
  agileStatus?: number;
  /** Drop the sprint field from `/field`, so the changelog parser falls back to
   *  the English display name (S-23 phase 3 §2). */
  hideSprintField?: boolean;
}): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    if (opts?.failStatus) return jsonRes({ message: "Unauthorized" }, opts.failStatus);
    if (url.includes("/rest/agile/1.0/")) {
      if (opts?.agileStatus && opts.agileStatus !== 200) {
        return jsonRes({ message: "Unauthorized" }, opts.agileStatus);
      }
      if (url.includes("/sprint?")) {
        const active =
          opts?.activeSprint === undefined ? JIRA_ACTIVE_SPRINT : opts.activeSprint;
        return jsonRes({ values: active ? [active] : [] });
      }
      if (url.includes("/board?")) {
        return jsonRes({ isLast: true, values: opts?.boards ?? [JIRA_BOARD] });
      }
    }
    if (url.includes("/rest/api/3/myself")) {
      const zone = opts?.timeZone === undefined ? JIRA_TIME_ZONE : opts.timeZone;
      return jsonRes({
        accountId: "acc-lead",
        emailAddress: "lead@example.com",
        ...(zone === null ? {} : { timeZone: zone }),
      });
    }
    if (url.includes("/rest/api/3/field")) {
      return jsonRes([
        {
          id: SP_FIELD,
          name: "Story Points",
          custom: true,
          schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" },
        },
        ...(opts?.hideSprintField
          ? []
          : [
              {
                id: SPRINT_FIELD,
                name: "Sprintti",
                custom: true,
                schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
              },
            ]),
      ]);
    }
    if (url.includes("/rest/api/3/search/jql")) {
      return jsonRes({ issues: opts?.issues ?? [JIRA_ISSUE], nextPageToken: null });
    }
    throw new Error(`unexpected Jira mock URL: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// --- Seed / cleanup ---------------------------------------------------------

async function seedOwner(): Promise<{
  ownerId: string;
  repoId: string;
  sprintId: string;
  jiraProjectId: string;
}> {
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
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: jiraCred.id,
      jiraProjectId: "10000",
      projectKey: "SF",
      // S-16: without a stored board the reconcile pays a `listBoards` every
      // cycle. Seeded so the default path costs ONE agile subrequest.
      boardId: String(JIRA_BOARD.id),
    })
    .returning({ id: jiraProject.id });

  await db.insert(statusMapping).values([
    { id: randomUUID(), ownerId, jiraProjectId: proj.id, jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" },
    { id: randomUUID(), ownerId, jiraProjectId: proj.id, jiraStatusId: "3", jiraStatusName: "In Progress", category: "IN_PROGRESS" },
  ]);

  const [sprintRow] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: proj.id,
      jiraSprintId: "42",
      name: "Sprint 7",
      state: "ACTIVE",
      startDate: new Date("2026-08-17T08:00:00.000Z"),
      endDate: new Date("2026-08-31T08:00:00.000Z"),
    })
    .returning({ id: sprint.id });

  return { ownerId, repoId: repo.id, sprintId: sprintRow.id, jiraProjectId: proj.id };
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
    // S-10: per-commit churn now comes from the detail endpoint, under a per-repo cap.
    expect(commits[0].additions).toBe(42);
    expect(commits[0].deletions).toBe(7);

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

describe("syncOwner — per-commit churn (S-10)", () => {
  it("skips the detail fetch for an already-persisted sha", async () => {
    const { ownerId } = await newOwner();

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    // Second cycle re-lists the same commit; it is already persisted, so the
    // per-commit GET must not fire again.
    const gh2 = githubFetch();
    await syncOwner({
      ...baseArgs(ownerId, gh2.fetchImpl, jiraFetch().fetchImpl),
      bypassDueCheck: true,
    });

    expect(gh2.calls.some((u) => /\/commits\/sha-1$/.test(u))).toBe(false);
  });

  it("inserts an over-cap commit with NULL churn, newest-first", async () => {
    const { ownerId } = await newOwner();
    // Two new commits, cap of 1 → only the newest (sha-2) is enriched.
    const gh = githubFetch({
      commits: [
        {
          sha: "sha-1",
          author: { login: "octocat" },
          commit: { author: { date: "2026-08-18T09:00:00.000Z" }, message: "older" },
        },
        {
          sha: "sha-2",
          author: { login: "octocat" },
          commit: { author: { date: "2026-08-19T09:00:00.000Z" }, message: "newer" },
        },
      ],
    });

    await syncOwner({
      ...baseArgs(ownerId, gh.fetchImpl, jiraFetch().fetchImpl),
      maxCommitStats: 1,
    });

    const commits = await db.select().from(githubCommit).where(eq(githubCommit.ownerId, ownerId));
    const newer = commits.find((c) => c.sha === "sha-2")!;
    const older = commits.find((c) => c.sha === "sha-1")!;
    expect(newer.additions).toBe(100);
    // Over-cap commit is still persisted — with NULL churn, permanently.
    expect(older.additions).toBeNull();
    expect(older.deletions).toBeNull();
    expect(gh.calls.some((u) => /\/commits\/sha-1$/.test(u))).toBe(false);
  });

  // impl-review F4. Enrichment runs inside the per-repo loop, BEFORE the PR leg
  // and before any write, inside the cycle-wide try. Unguarded, a single 404 on
  // one sha discarded the cycle's commits, PRs and reviews for every repo — and
  // the next cycle re-listed the same window and hit the same sha, stalling
  // permanently. Churn is an enrichment; losing it must never lose the cycle.
  it("survives a failing commit-detail fetch — NULL churn, cycle still completes", async () => {
    const { ownerId } = await newOwner();
    const gh = githubFetch({ failDetailFor: "sha-1" });

    const result = await syncOwner(baseArgs(ownerId, gh.fetchImpl, jiraFetch().fetchImpl));

    expect(result.github.status).toBe("OK");

    const commits = await db
      .select()
      .from(githubCommit)
      .where(eq(githubCommit.ownerId, ownerId));
    const failed = commits.find((c) => c.sha === "sha-1")!;
    expect(failed.additions).toBeNull();
    expect(failed.deletions).toBeNull();

    // The PR leg runs after enrichment — an escaping throw would have lost it.
    const prs = await db
      .select()
      .from(githubPullRequest)
      .where(eq(githubPullRequest.ownerId, ownerId));
    expect(prs.length).toBeGreaterThan(0);
  });
});

describe("syncOwner — Jira time zone (S-10)", () => {
  it("persists the owner's IANA zone from /myself", async () => {
    const { ownerId, jiraProjectId } = await newOwner();

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const [proj] = await db.select().from(jiraProject).where(eq(jiraProject.id, jiraProjectId));
    expect(proj.timeZone).toBe(JIRA_TIME_ZONE);
  });

  it("writes NULL when Jira omits timeZone", async () => {
    const { ownerId, jiraProjectId } = await newOwner();

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ timeZone: null }).fetchImpl),
    );

    const [proj] = await db.select().from(jiraProject).where(eq(jiraProject.id, jiraProjectId));
    expect(proj.timeZone).toBeNull();
  });

  it("persists the zone even when the cycle finds NO active sprint (S-11)", async () => {
    // The zone write used to sit inside the ticket transaction, which is BELOW
    // the `!chosenSprint` early return — so an owner between sprints never got
    // one. That is not cosmetic: S-11's recap fires at the owner's LOCAL send
    // time, resolved through this column, so a missing zone silently turned
    // "15:00 local" into 15:00 UTC for exactly the owners least likely to notice.
    const { ownerId, jiraProjectId } = await newOwner();
    // Both halves absent — a stored sprint alone would let the cycle proceed past
    // the early return and prove nothing.
    await db.delete(sprint).where(eq(sprint.ownerId, ownerId));

    const result = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ activeSprint: null }).fetchImpl),
    );
    expect(result.jira).toEqual({ status: "SKIPPED", reason: "no_active_sprint" });

    const [proj] = await db.select().from(jiraProject).where(eq(jiraProject.id, jiraProjectId));
    expect(proj.timeZone).toBe(JIRA_TIME_ZONE);
  });
});

describe("syncOwner — sprint commitment scalars (S-10, reshaped by S-23)", () => {
  /** Insert one sprint ticket plus, optionally, the DONE transition that is now
   *  what makes it count as delivered (FR-023 — first entry into Done). */
  async function seedTicket(args: {
    ownerId: string;
    jiraProjectId: string;
    sprintId: string;
    jiraKey: string;
    storyPoints: number | null;
    currentCategory: "TODO" | "IN_PROGRESS" | "DONE";
    addedAfterSprintStart: boolean | null;
    firstDoneAt?: string;
  }): Promise<string> {
    const ticketId = randomUUID();
    await db.insert(jiraTicket).values({
      id: ticketId,
      ownerId: args.ownerId,
      jiraProjectId: args.jiraProjectId,
      sprintId: args.sprintId,
      jiraKey: args.jiraKey,
      storyPoints: args.storyPoints,
      currentCategory: args.currentCategory,
      addedAfterSprintStart: args.addedAfterSprintStart,
    });
    if (args.firstDoneAt) {
      await db.insert(jiraStatusHistory).values({
        id: randomUUID(),
        ownerId: args.ownerId,
        ticketId,
        toStatusId: "5",
        toCategory: "DONE",
        changedAt: new Date(args.firstDoneAt),
        jiraChangelogId: `done-${args.jiraKey}`,
      });
    }
    return ticketId;
  }

  it("aggregates committed SP from the ticket table, not the delta payload", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();
    const common = { ownerId, jiraProjectId, sprintId };

    // Pre-existing sprint tickets that this cycle's delta pull will NOT return.
    await seedTicket({ ...common, jiraKey: "SF-90", storyPoints: 3, currentCategory: "TODO", addedAfterSprintStart: false });
    await seedTicket({ ...common, jiraKey: "SF-91", storyPoints: 5, currentCategory: "DONE", addedAfterSprintStart: false, firstDoneAt: "2026-08-19T10:00:00.000Z" });
    // Scope crept in after start → excluded from committed, still delivered.
    await seedTicket({ ...common, jiraKey: "SF-92", storyPoints: 2, currentCategory: "DONE", addedAfterSprintStart: true, firstDoneAt: "2026-08-19T12:00:00.000Z" });
    // NULL addedAfterSprintStart means "couldn't tell" → counts as committed.
    await seedTicket({ ...common, jiraKey: "SF-93", storyPoints: 1, currentCategory: "IN_PROGRESS", addedAfterSprintStart: null });

    // Empty delta: `issues` is [], so a payload-sourced aggregate would write 0.
    const result = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
    );
    expect(result.jira.status).toBe("OK");

    const [row] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(row.committedSp).toBe(9); // 3 + 5 + 1 (SF-92 crept in)
    expect(row.completedSp).toBe(7); // 5 + 2, by FIRST entry into Done
    expect(row.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("writes 0 rather than NULL when the sprint has no estimated tickets", async () => {
    const { ownerId, sprintId } = await newOwner();

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
    );

    const [row] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(row.committedSp).toBe(0);
    expect(row.completedSp).toBe(0);
  });

  it("counts a DONE ticket only when its FIRST entry into Done is inside the window", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();
    const common = { ownerId, jiraProjectId, sprintId };

    // Carried over: finished in the PREVIOUS sprint, re-stamped into this one by
    // the sync. Counting it again would double-count the team's own velocity.
    await seedTicket({ ...common, jiraKey: "SF-80", storyPoints: 13, currentCategory: "DONE", addedAfterSprintStart: false, firstDoneAt: "2026-08-10T10:00:00.000Z" });
    // Sitting in Done today, but it got there during this sprint.
    await seedTicket({ ...common, jiraKey: "SF-81", storyPoints: 5, currentCategory: "DONE", addedAfterSprintStart: false, firstDoneAt: "2026-08-19T10:00:00.000Z" });
    // In Done now but with NO recorded transition — the old rule counted this.
    await seedTicket({ ...common, jiraKey: "SF-82", storyPoints: 8, currentCategory: "DONE", addedAfterSprintStart: false });

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
    );

    const [row] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(row.completedSp).toBe(5);
  });

  it("freezes committed SP at first sighting; a later cycle moves neither it nor the stamp", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();
    const common = { ownerId, jiraProjectId, sprintId };

    await seedTicket({ ...common, jiraKey: "SF-90", storyPoints: 3, currentCategory: "TODO", addedAfterSprintStart: false });

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl));

    const [afterFirst] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(afterFirst.committedSp).toBe(3);
    expect(afterFirst.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());

    // A ticket added mid-sprint that the store could not classify (NULL) would,
    // under the old recompute-every-cycle rule, quietly raise the commitment.
    await seedTicket({ ...common, jiraKey: "SF-94", storyPoints: 21, currentCategory: "TODO", addedAfterSprintStart: null });

    const later = new Date("2026-08-21T12:00:00.000Z");
    await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
      now: later,
      bypassDueCheck: true,
    });

    const [afterSecond] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(afterSecond.committedSp).toBe(3);
    expect(afterSecond.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("does not freeze on a delta cycle — the stamp waits for a full pull", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();
    const common = { ownerId, jiraProjectId, sprintId };

    // A ticket this cycle's delta will NOT return, still carrying whatever rule
    // classified it last. `committed_sp` sums the WHOLE table, so a freeze here
    // would bake that stale verdict in permanently — the `case when` guard means
    // no later cycle could correct it, and FR-023's record would inherit it.
    await seedTicket({ ...common, jiraKey: "SF-95", storyPoints: 8, currentCategory: "TODO", addedAfterSprintStart: false });

    // A cursor pointing at THIS sprint is exactly what makes the pull a delta.
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId,
      integration: "JIRA",
      jiraHistoryCursor: "2026-08-20T10:00:00.000Z",
      jiraCursorSprintId: sprintId,
      lastSuccessfulSyncAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl));

    const [afterDelta] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    // Still recomputing every cycle — which is safe precisely BECAUSE it is not
    // frozen. Late is recoverable; wrong is not.
    expect(afterDelta.committedSp).toBe(8);
    expect(afterDelta.committedFrozenAt).toBeNull();

    // Re-point the cursor at another sprint: the next cycle drops the delta
    // clause and pulls in full, which is the cycle allowed to freeze.
    await db
      .update(syncState)
      .set({ jiraCursorSprintId: randomUUID() })
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "JIRA")));

    const later = new Date("2026-08-21T12:00:00.000Z");
    await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
      now: later,
      bypassDueCheck: true,
    });

    const [afterFull] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(afterFull.committedFrozenAt?.toISOString()).toBe(later.toISOString());
  });

  it("leaves completed SP untouched by a cycle that runs after the sprint ended", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();
    const common = { ownerId, jiraProjectId, sprintId };

    await seedTicket({ ...common, jiraKey: "SF-91", storyPoints: 5, currentCategory: "DONE", addedAfterSprintStart: false, firstDoneAt: "2026-08-19T10:00:00.000Z" });

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl));
    const [duringSprint] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(duringSprint.completedSp).toBe(5);

    // A ticket finished a week AFTER the sprint's endDate (2026-08-31). Under the
    // old "what is in Done right now" rule this rewrote the closed sprint's
    // velocity — the loss the whole slice exists to stop.
    await seedTicket({ ...common, jiraKey: "SF-95", storyPoints: 8, currentCategory: "DONE", addedAfterSprintStart: false, firstDoneAt: "2026-09-07T10:00:00.000Z" });

    await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
      now: new Date("2026-09-08T12:00:00.000Z"),
      bypassDueCheck: true,
    });

    const [afterClose] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(afterClose.completedSp).toBe(5);
  });

  /**
   * S-26 Phase 5 — the whole round trip, because a test that stops at the
   * disconnect passes without the fix.
   *
   * The corruption needs all four steps: freeze mid-sprint, lose the `sprint`
   * row to a disconnect, reconnect, and let the next FULL pull run. The pull is
   * forced rather than incidental — `jiraCursorSprintId` still points at the
   * DELETED row's id, so `cursorMatchesSprint` is false and the delta clause is
   * dropped. That is precisely the cycle allowed to stamp `committed_frozen_at`.
   */
  it("recovers the frozen commitment across a disconnect and reconnect", async () => {
    const { ownerId, sprintId, jiraProjectId } = await newOwner();

    await seedTicket({
      ownerId,
      jiraProjectId,
      sprintId,
      jiraKey: "SF-90",
      storyPoints: 3,
      currentCategory: "TODO",
      addedAfterSprintStart: false,
    });

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl));
    const [beforeDisconnect] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(beforeDisconnect.committedSp).toBe(3);
    expect(beforeDisconnect.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());

    // What the FR-023 sweep leaves behind for a sprint still in flight. It is
    // the ONLY copy that outlives the disconnect: `sprint_measurement` has no
    // foreign key, by design.
    await db.insert(sprintMeasurement).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "42",
      sprintName: "Sprint 7",
      committedSp: beforeDisconnect.committedSp,
      committedFrozenAt: beforeDisconnect.committedFrozenAt,
      finalizedAt: null,
    });

    // --- Disconnect: the real cascade, not a targeted delete ----------------
    await db.delete(jiraCredential).where(eq(jiraCredential.ownerId, ownerId));
    expect(await db.select().from(sprint).where(eq(sprint.ownerId, ownerId))).toEqual([]);
    expect(
      await db.select().from(sprintMeasurement).where(eq(sprintMeasurement.ownerId, ownerId)),
    ).toHaveLength(1);

    // --- Reconnect: same workspace, same project, same status mapping -------
    const [newCred] = await db
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
    const [newProj] = await db
      .insert(jiraProject)
      .values({
        id: randomUUID(),
        ownerId,
        credentialId: newCred.id,
        jiraProjectId: "10000",
        projectKey: "SF",
        boardId: String(JIRA_BOARD.id),
      })
      .returning({ id: jiraProject.id });
    await db.insert(statusMapping).values([
      { id: randomUUID(), ownerId, jiraProjectId: newProj.id, jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" },
      { id: randomUUID(), ownerId, jiraProjectId: newProj.id, jiraStatusId: "3", jiraStatusName: "In Progress", category: "IN_PROGRESS" },
    ]);

    // --- The cycle that used to re-freeze -----------------------------------
    const later = new Date("2026-08-22T12:00:00.000Z");
    const result = await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [] }).fetchImpl),
      now: later,
      bypassDueCheck: true,
    });
    expect(result.jira.status).toBe("OK");

    const [recreated] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    // A NEW row — the id is `randomUUID()` and the old one is gone. This is what
    // made the re-created sprint indistinguishable from one never seen.
    expect(recreated.id).not.toBe(sprintId);
    expect(recreated.jiraSprintId).toBe("42");
    // Both halves restored. Before the fix this row froze at the reconnect-time
    // sum — 0, since the disconnect took the tickets with the sprint — stamped
    // `later`, and `sprint_measurement.committed_sp` is copied and never
    // recomputed, so that figure would have fed FR-024 for the team's lifetime.
    expect(recreated.committedSp).toBe(3);
    expect(recreated.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());

    // §2 of the phase: the existing `case when … is null` guard needs no second
    // guard once the stamp is back — asserted rather than assumed.
    const [measurement] = await db
      .select()
      .from(sprintMeasurement)
      .where(eq(sprintMeasurement.ownerId, ownerId));
    expect(measurement.committedSp).toBe(3);
    expect(measurement.committedFrozenAt?.toISOString()).toBe(NOW.toISOString());
  });
});

/**
 * S-23 phase 3 §3 — the reliability DENOMINATOR. `created_at > sprint_start`
 * calls an old backlog item dragged in mid-sprint "committed", and since the
 * commitment is now frozen at first sighting that verdict would be permanent.
 */
describe("syncOwner — added_after_sprint_start from the Sprint changelog", () => {
  /** Created a MONTH before the sprint, so the `createdAt` rule alone would
   *  always answer `false` — every branch below is therefore discriminating. */
  const OLD_ISSUE_BASE = {
    id: "2001",
    key: "SF-200",
    fields: {
      summary: "Long-lived backlog item",
      status: { id: "1", name: "To Do" },
      created: "2026-07-15T08:00:00.000Z",
      [SP_FIELD]: 3,
    },
  };

  function sprintChange(item: Record<string, unknown>, created: string) {
    return {
      ...OLD_ISSUE_BASE,
      changelog: { histories: [{ id: "h-sprint", created, items: [item] }] },
    };
  }

  async function addedAfterFor(issue: unknown, jiraOpts?: { hideSprintField?: boolean }) {
    const { ownerId } = await newOwner();
    await syncOwner(
      baseArgs(
        ownerId,
        githubFetch().fetchImpl,
        jiraFetch({ issues: [issue], ...jiraOpts }).fetchImpl,
      ),
    );
    const [ticket] = await db
      .select()
      .from(jiraTicket)
      .where(and(eq(jiraTicket.ownerId, ownerId), eq(jiraTicket.jiraKey, "SF-200")));
    return ticket.addedAfterSprintStart;
  }

  it("is TRUE when the Sprint transition follows sprint start, though the ticket is older", async () => {
    const added = await addedAfterFor(
      sprintChange(
        { field: "Sprintti", fieldId: SPRINT_FIELD, from: null, to: "42" },
        "2026-08-20T09:00:00.000Z", // sprint started 08-17
      ),
    );

    expect(added).toBe(true);
  });

  it("is FALSE when the Sprint transition predates sprint start", async () => {
    const added = await addedAfterFor(
      sprintChange(
        { field: "Sprintti", fieldId: SPRINT_FIELD, from: "41", to: "41, 42" },
        "2026-08-15T09:00:00.000Z",
      ),
    );

    expect(added).toBe(false);
  });

  it("ignores a transition into a DIFFERENT sprint and falls back to createdAt", async () => {
    const added = await addedAfterFor(
      sprintChange(
        { field: "Sprintti", fieldId: SPRINT_FIELD, from: "42", to: "43" },
        "2026-08-20T09:00:00.000Z",
      ),
    );

    // Moved OUT of sprint 42 after it started — that says nothing about when it
    // arrived, so the createdAt fallback answers, and it was created long ago.
    expect(added).toBe(false);
  });

  it("falls back to createdAt when the issue carries no Sprint change at all", async () => {
    const added = await addedAfterFor({
      ...OLD_ISSUE_BASE,
      changelog: {
        histories: [
          {
            id: "h1",
            created: "2026-08-20T09:00:00.000Z",
            items: [{ field: "status", from: "1", fromString: "To Do", to: "3", toString: "In Progress" }],
          },
        ],
      },
    });

    expect(added).toBe(false);
  });

  it("still reads the change by display name when the field id is unresolvable", async () => {
    const added = await addedAfterFor(
      sprintChange({ field: "Sprint", from: null, to: "42" }, "2026-08-20T09:00:00.000Z"),
      { hideSprintField: true },
    );

    expect(added).toBe(true);
  });

  /** The durable half of the narrowing-predicate rule (impl-review F3/F5): the
   *  operator log must tell "nobody moved sprints" apart from "the sprint id I
   *  matched against is wrong", and must stay quiet when neither happened. */
  async function jiraOutcomeFor(issue: unknown, jiraOpts?: { hideSprintField?: boolean }) {
    const { ownerId } = await newOwner();
    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch({ issues: [issue], ...jiraOpts }).fetchImpl),
    );
    const rows = await db
      .select({ outcome: syncAttempt.outcome })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    return rows.at(-1)?.outcome ?? null;
  }

  it("records Sprint changes that named no known sprint in the attempt log", async () => {
    // Same input as the "different sprint" case above: the issue HAS the evidence
    // that should answer the question, and none of it names sprint 42. A stale
    // stored `jira_sprint_id` produces exactly this shape for EVERY issue.
    const outcome = await jiraOutcomeFor(
      sprintChange(
        { field: "Sprintti", fieldId: SPRINT_FIELD, from: "42", to: "43" },
        "2026-08-20T09:00:00.000Z",
      ),
    );

    expect(outcome).toContain("sprint_changes_naming_no_sprint=1");
  });

  it("records the unresolved sprint field, and stays silent on a healthy cycle", async () => {
    const unresolved = await jiraOutcomeFor(
      sprintChange({ field: "Sprint", from: null, to: "42" }, "2026-08-20T09:00:00.000Z"),
      { hideSprintField: true },
    );
    expect(unresolved).toContain("sprint_field_unresolved");

    // An issue whose only changelog is a status move is the NORMAL state of a
    // ticket that was in the sprint from the start. The old `console.info` fired
    // here, on essentially every healthy cycle; a signal that always fires is
    // not a signal.
    const healthy = await jiraOutcomeFor({
      ...OLD_ISSUE_BASE,
      changelog: {
        histories: [
          {
            id: "h1",
            created: "2026-08-20T09:00:00.000Z",
            items: [{ field: "status", from: "1", fromString: "To Do", to: "3", toString: "In Progress" }],
          },
        ],
      },
    });
    expect(healthy).toBeNull();
  });

  it("records `cadence_default_fallback` when THIS project's record fails to apply (S-30)", async () => {
    // The same `lessons.md` obligation, pointed at S-30's own failure mode: the
    // cycle resolved a cadence from the DEFAULT while this account holds a
    // record for the project it is monitoring RIGHT NOW — the recency predicate
    // having failed to find what the lead chose. Reported, rather than finalized
    // as an ordinary green run.
    const { ownerId } = await newOwner();
    // SEEDED BEFORE THE ONE CYCLE, not between two: `baseArgs` pins the same
    // `NOW` on every call, so a second `syncOwner` in the same test is skipped
    // on a still-fresh lease and writes no attempt row at all.
    //
    // SAME Jira-side project as `seedOwner`'s, a different sprint, and dated
    // AFTER the fixture's active sprint (2026-08-17) — a record this account
    // owns that `start_date <=` correctly refuses to inherit, which is precisely
    // "we hold your cadence and could not attach it".
    await db.insert(sprintCadenceOverride).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "9999",
      startDate: new Date("2026-08-24T08:00:00.000Z"),
      workingDays: ["MON", "TUE", "WED"],
    });

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    const rows = await db
      .select({ outcome: syncAttempt.outcome })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    expect(rows.at(-1)?.outcome).toContain("cadence_default_fallback");
  });

  it("stays silent for a record left behind by a DIFFERENT Jira-side project", async () => {
    // The shape of a project switch, which `DISCONNECT_IMPACT.projectSwitch`
    // promises the lead BEFORE they commit to it: the cadence stays with the
    // project it was set for, and the new project follows Jira until they set
    // one. Counting those records made EVERY cycle of a deliberately switched
    // account report a failure, indefinitely — the lead has no reason to open
    // `/team/cadence` again, and nothing else clears it.
    const { ownerId } = await newOwner();
    await db.insert(sprintCadenceOverride).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: "99999",
      jiraSprintId: "9999",
      startDate: new Date("2026-08-01T08:00:00.000Z"),
      workingDays: ["MON", "TUE", "WED"],
    });

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    const rows = await db
      .select({ outcome: syncAttempt.outcome })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    expect(rows.at(-1)?.outcome).toBeNull();
  });

  it("stays silent when the cadence resolves from a record that DOES apply", async () => {
    // A signal that fires on a healthy account is not a signal.
    //
    // ONE CYCLE, with the record seeded first, for the reason the sibling above
    // records: a second `syncOwner` under the same pinned `NOW` is skipped on a
    // fresh lease and writes no attempt, so a two-cycle version of this would
    // assert `null` against the FIRST cycle and pass whatever the resolver did.
    const { ownerId } = await newOwner();
    await db.insert(sprintCadenceOverride).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: "10000",
      // The fixture's active sprint, at its own start date: tier 1 answers.
      jiraSprintId: String(JIRA_ACTIVE_SPRINT.id),
      startDate: new Date(JIRA_ACTIVE_SPRINT.startDate),
      workingDays: ["MON", "TUE", "WED"],
    });

    await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    const rows = await db
      .select({ outcome: syncAttempt.outcome })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    expect(rows.at(-1)?.outcome).toBeNull();
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

describe("syncOwner — the delta cursor is scoped to its sprint", () => {
  /** JQL of the issue search on the given mock, decoded. */
  function searchJql(calls: string[]): string {
    const url = calls.find((u) => u.includes("/search/jql"))!;
    return decodeURIComponent(url.replace(/\+/g, " "));
  }

  it("drops the delta clause when the cursor belongs to a different sprint", async () => {
    const { ownerId, sprintId } = await newOwner();
    // A cursor left behind by a PREVIOUS sprint — exactly what a sprint switch
    // (or a corrected sprint row) leaves in place.
    await db.insert(syncState).values({
      id: randomUUID(),
      ownerId,
      integration: "JIRA",
      jiraHistoryCursor: "2026-08-20T10:00:00.000Z",
      jiraCursorSprintId: randomUUID(),
      lastSuccessfulSyncAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    const jira = jiraFetch();
    await syncOwner({ ...baseArgs(ownerId, githubFetch().fetchImpl, jira.fetchImpl) });

    // Without this, every pre-existing ticket in the new sprint stays invisible
    // while the cycle still reports OK.
    expect(searchJql(jira.calls)).not.toContain("updated >=");
    // …and the cursor is re-pointed at the sprint it now describes.
    const [state] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "JIRA")));
    expect(state.jiraCursorSprintId).toBe(sprintId);
  });

  it("keeps the delta clause when the cursor belongs to the sprint being synced", async () => {
    const { ownerId } = await newOwner();

    // First cycle records the cursor against this sprint…
    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    // …so the second one may legitimately ask only for what changed (FR-012).
    const jira2 = jiraFetch();
    await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jira2.fetchImpl),
      bypassDueCheck: true,
    });

    expect(searchJql(jira2.calls)).toContain("updated >=");
  });
});

describe("syncOwner — the reconcile inside the cycle (S-16, FR-007)", () => {
  /** JQL of the issue search on the given mock, decoded. */
  function searchJql(calls: string[]): string {
    const url = calls.find((u) => u.includes("/search/jql"))!;
    return decodeURIComponent(url.replace(/\+/g, " "));
  }

  const SPRINT_8 = {
    id: 43,
    state: "active",
    name: "Sprint 8",
    startDate: "2026-08-31T08:00:00.000Z",
    endDate: "2026-09-14T08:00:00.000Z",
  };

  // (a) The slice itself: Jira names a different sprint, and the cycle FOLLOWS
  // it within one run instead of syncing the setup-time sprint forever.
  it("(a) follows a rollover: pulls the new sprint and leaves one ACTIVE row", async () => {
    const { ownerId, sprintId } = await newOwner();
    // First cycle records a cursor against the OLD sprint.
    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const jira = jiraFetch({ activeSprint: SPRINT_8 });
    const result = await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jira.fetchImpl),
      bypassDueCheck: true,
    });

    expect(result.jira).toEqual({ status: "OK" });

    const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    const created = rows.find((r) => r.jiraSprintId === "43")!;
    expect(created.state).toBe("ACTIVE");
    expect(created.name).toBe("Sprint 8");
    expect(rows.find((r) => r.id === sprintId)?.state).toBe("CLOSED");
    expect(rows.filter((r) => r.state === "ACTIVE")).toHaveLength(1);

    // The cursor guard must drop the delta clause: the stored cursor describes
    // the PREVIOUS sprint, and reusing it would hide every ticket in the new one
    // that has not been edited since — silently, with the cycle reporting OK.
    expect(searchJql(jira.calls)).not.toContain("updated >=");

    // Tickets are re-stamped onto the new sprint.
    const tickets = await db
      .select({ sprintId: jiraTicket.sprintId })
      .from(jiraTicket)
      .where(eq(jiraTicket.ownerId, ownerId));
    expect(tickets.every((t) => t.sprintId === created.id)).toBe(true);
  });

  // (b) C4 — the between-sprints onboarding case. Before S-16 this owner was
  // permanently dead AND permanently green: SKIPPED{no_sprint} forever while
  // stamping a fresh OK.
  it("(b) creates a sprint row for an owner seeded with none, and syncs it", async () => {
    const { ownerId } = await newOwner();
    await db.delete(sprint).where(eq(sprint.ownerId, ownerId));

    const result = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    expect(result.jira).toEqual({ status: "OK" });
    const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].jiraSprintId).toBe("42");
    expect(rows[0].state).toBe("ACTIVE");
    // Cadence was derived, not left NULL — a dateless row would outrank a dated
    // one in both branches of `getActiveSprintRow`.
    expect(rows[0].lengthDays).toBe(14);
  });

  // (c) C5 — a PAT that `/myself` accepts but that lacks Agile permission. The
  // mock must answer 200 on /myself and 401 on the agile endpoints: a blanket
  // 401 is caught by `validateCredentials` first and would never reach here.
  it("(c) an agile-only 401 classifies as ERROR, not RATE_LIMITED", async () => {
    const { ownerId } = await newOwner();

    const result = await syncOwner(
      baseArgs(
        ownerId,
        githubFetch().fetchImpl,
        jiraFetch({ agileStatus: 401 }).fetchImpl,
      ),
    );

    // Before Phase 1 this was JiraUnavailableError → RATE_LIMITED, i.e. the
    // owner was told "nothing to do" instead of "reconnect Jira".
    expect(result.jira.status).toBe("ERROR");
  });

  // (d) C3 — a reconcile that cannot conclude must not stop a working account.
  it("(d) no active sprint but a stored one present: still pulls, row unchanged", async () => {
    const { ownerId, sprintId } = await newOwner();
    // Keep the stored sprint inside its window so the ended-sprint demotion
    // (plan-review F4) does not fire — this case is about the PULL continuing.
    await db
      .update(sprint)
      .set({ endDate: new Date(Date.now() + 5 * 86_400_000) })
      .where(eq(sprint.id, sprintId));
    const [before] = await db.select().from(sprint).where(eq(sprint.id, sprintId));

    const result = await syncOwner(
      baseArgs(
        ownerId,
        githubFetch().fetchImpl,
        jiraFetch({ activeSprint: null }).fetchImpl,
      ),
    );

    expect(result.jira).toEqual({ status: "OK" });
    const [after] = await db.select().from(sprint).where(eq(sprint.id, sprintId));
    expect(after.state).toBe("ACTIVE");
    expect(after.jiraSprintId).toBe(before.jiraSprintId);
    expect(after.name).toBe(before.name);

    const tickets = await db
      .select()
      .from(jiraTicket)
      .where(eq(jiraTicket.ownerId, ownerId));
    expect(tickets.length).toBeGreaterThan(0);
  });

  // (e) An ambiguous board must degrade, not halt. The cost, accepted at plan
  // time: an owner WITH a stored sprint is never told to pick a board, because
  // the cycle reports plain OK. Only an owner without one records the diagnostic.
  it("(e) ambiguous board: syncs normally with a stored sprint, skips without one", async () => {
    const { ownerId, jiraProjectId } = await newOwner();
    // board_id NULL forces discovery, and two sprint-capable boards make the
    // choice ambiguous with no UI to ask in a headless cycle.
    await db
      .update(jiraProject)
      .set({ boardId: null })
      .where(eq(jiraProject.id, jiraProjectId));
    const twoBoards = {
      boards: [JIRA_BOARD, { id: 78, name: "SF Delivery", type: "scrum" }],
    };

    const withStored = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch(twoBoards).fetchImpl),
    );
    expect(withStored.jira).toEqual({ status: "OK" });
    // Nothing was persisted, so the ambiguity is still there next cycle.
    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.id, jiraProjectId));
    expect(proj.boardId).toBeNull();

    await db.delete(sprint).where(eq(sprint.ownerId, ownerId));
    const withoutStored = await syncOwner({
      ...baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch(twoBoards).fetchImpl),
      bypassDueCheck: true,
    });
    expect(withoutStored.jira).toEqual({
      status: "SKIPPED",
      reason: "board_ambiguous",
    });

    const attempts = await db
      .select({ outcome: syncAttempt.outcome })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    // No ORDER BY on the select, so assert membership rather than position.
    expect(attempts.map((a) => a.outcome)).toContain("board_ambiguous");
  });
});

describe("syncOwner — attempt history (S-10 Phase 7)", () => {
  it("records one attempt per integration per cycle", async () => {
    const { ownerId } = await newOwner();

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const attempts = await db
      .select()
      .from(syncAttempt)
      .where(eq(syncAttempt.ownerId, ownerId));

    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.integration).sort()).toEqual(["GITHUB", "JIRA"]);
    expect(attempts.every((a) => a.status === "OK")).toBe(true);
  });

  it("records the failing status without storing any error text", async () => {
    const { ownerId } = await newOwner();

    await syncOwner(
      baseArgs(ownerId, githubFetch({ failStatus: 401 }).fetchImpl, jiraFetch().fetchImpl),
    );

    const [gh] = await db
      .select()
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "GITHUB")));

    expect(gh.status).toBe("ERROR");
    // The table has no error column at all — the row carries a bounded status.
    expect(Object.keys(gh)).not.toContain("lastError");
    expect(JSON.stringify(gh)).not.toContain("Unauthorized");
  });

  it("labels a no-op Jira cycle so 'OK but nothing happened' is legible", async () => {
    const { ownerId } = await newOwner();
    // Remove the sprint AND have Jira report none active. Deleting the row alone
    // is no longer a no-op cycle: since S-16 the reconcile CREATES one, which is
    // the whole point of C4 — see "creates a sprint row for an owner seeded with
    // none" below. A genuinely empty cycle now needs both halves absent.
    await db.delete(sprint).where(eq(sprint.ownerId, ownerId));

    const result = await syncOwner(
      baseArgs(
        ownerId,
        githubFetch().fetchImpl,
        jiraFetch({ activeSprint: null }).fetchImpl,
      ),
    );
    // The reason now names the reconcile's own verdict rather than the generic
    // `no_sprint`, so an operator reading the log can tell "Jira has no sprint
    // running" apart from "we never resolved one".
    expect(result.jira).toEqual({ status: "SKIPPED", reason: "no_active_sprint" });

    const [jira] = await db
      .select()
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    expect(jira.status).toBe("OK");
    expect(jira.outcome).toBe("no_active_sprint");
  });

  it("prunes to the retention cap so the log cannot grow unbounded", async () => {
    const { ownerId } = await newOwner();

    // Pre-fill well past the cap, then run one real cycle to trigger the prune.
    await db.insert(syncAttempt).values(
      Array.from({ length: 60 }, (_, i) => ({
        id: randomUUID(),
        ownerId,
        integration: "GITHUB" as const,
        status: "OK" as const,
        outcome: null,
        finishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const rows = await db
      .select({ finishedAt: syncAttempt.finishedAt })
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "GITHUB")));

    expect(rows).toHaveLength(50);
    // The survivors are the newest — including the cycle just run.
    expect(Math.max(...rows.map((r) => r.finishedAt.getTime()))).toBe(NOW.getTime());
  });

  it("keeps each integration's retention independent", async () => {
    const { ownerId } = await newOwner();
    await db.insert(syncAttempt).values(
      Array.from({ length: 55 }, (_, i) => ({
        id: randomUUID(),
        ownerId,
        integration: "GITHUB" as const,
        status: "OK" as const,
        outcome: null,
        finishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const jira = await db
      .select()
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    // Pruning GitHub must not have touched Jira's single row.
    expect(jira).toHaveLength(1);
  });
});

describe("syncOwner — undecryptable credential (S-10 Phase 10)", () => {
  /** Corrupt the stored envelope the way a key rotation or a cross-environment
   * DB restore would — the value is well-formed text, just not our ciphertext. */
  async function corruptJiraToken(ownerId: string): Promise<void> {
    await db
      .update(jiraCredential)
      .set({ encryptedToken: "not-an-envelope" })
      .where(eq(jiraCredential.ownerId, ownerId));
  }

  it("reports ERROR for that integration instead of throwing", async () => {
    const { ownerId } = await newOwner();
    await corruptJiraToken(ownerId);

    const result = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    expect(result.jira.status).toBe("ERROR");
  });

  it("leaves the OTHER integration's sync intact — the point of separate rows", async () => {
    const { ownerId } = await newOwner();
    await corruptJiraToken(ownerId);

    // Before Phase 10 the Jira throw escaped syncOwner, so this whole call
    // rejected and GitHub's completed work was reported as a 500.
    const result = await syncOwner(
      baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl),
    );

    expect(result.github.status).toBe("OK");
    const commits = await db
      .select()
      .from(githubCommit)
      .where(eq(githubCommit.ownerId, ownerId));
    expect(commits).toHaveLength(1);
  });

  it("stamps sync_state so the owner actually sees the failure", async () => {
    const { ownerId } = await newOwner();
    await corruptJiraToken(ownerId);

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const [jState] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "JIRA")));
    expect(jState.status).toBe("ERROR");
    // The lease is released, so the next cycle is not blocked by a stuck claim.
    expect(jState.claimedUntil).toBeNull();
  });

  it("records the attempt with a reason that is not an error message", async () => {
    const { ownerId } = await newOwner();
    await corruptJiraToken(ownerId);

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const [attempt] = await db
      .select()
      .from(syncAttempt)
      .where(and(eq(syncAttempt.ownerId, ownerId), eq(syncAttempt.integration, "JIRA")));
    expect(attempt.status).toBe("ERROR");
    expect(attempt.outcome).toBe("credential_unreadable");
  });

  it("still stamps a status when no sync_state row exists yet (first-ever sync)", async () => {
    const { ownerId } = await newOwner();
    await corruptJiraToken(ownerId);
    // The credential load runs BEFORE acquireLease, which is what creates the
    // row — without ensureSyncStateRow the stamp would be a silent no-op here.
    await db.delete(syncState).where(eq(syncState.ownerId, ownerId));

    await syncOwner(baseArgs(ownerId, githubFetch().fetchImpl, jiraFetch().fetchImpl));

    const [jState] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, "JIRA")));
    expect(jState?.status).toBe("ERROR");
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
