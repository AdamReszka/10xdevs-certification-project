import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
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
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getActivityRollup } from "@/lib/dashboard/activity";
import { UNKNOWN_MEMBER_ID } from "@/lib/dashboard/activity-grid";
import { getTicketAging } from "@/lib/dashboard/aging";
import { getBurndownSeries } from "@/lib/dashboard/burndown";
import { dayRangeInTimeZone } from "@/lib/dashboard/day-bucket";

/**
 * S-10 Phase 2 — the three dashboard reducers against REAL Postgres (local
 * Supabase `:54322`).
 *
 * Every reader gets a happy path AND a two-owner isolation test. The isolation
 * assertions are the load-bearing ones: there is no RLS behind these readers
 * (memory: `project_supabase_isolation_model`), so cross-account leakage is a
 * PRD-guardrail failure that only an app-level test can catch.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const ZONE = "Europe/Warsaw";
const SPRINT_START = new Date("2026-08-17T08:00:00Z");
const SPRINT_END = new Date("2026-08-28T08:00:00Z");
const NOW = new Date("2026-08-20T12:00:00Z");

const owners: string[] = [];
afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

type Seeded = {
  ownerId: string;
  projectId: string;
  sprintId: string;
  repoId: string;
};

async function seedOwner(opts: { timeZone?: string | null } = {}): Promise<Seeded> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db
    .insert(user)
    .values({ id: ownerId, name: "Lead", email: `lead-${ownerId}@example.test` });

  const [jCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_ReducerToken1234", { ownerId, provider: "JIRA" }),
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
      credentialId: jCred.id,
      jiraProjectId: "10000",
      projectKey: "SF",
      timeZone: opts.timeZone === undefined ? ZONE : opts.timeZone,
    })
    .returning({ id: jiraProject.id });

  const [gCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("gh_ReducerPat1234ABCD", { ownerId, provider: "GITHUB" }),
      tokenLast4: "ABCD",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  const [repo] = await db
    .insert(monitoredRepo)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: gCred.id,
      githubRepoId: Math.floor(Math.random() * 1_000_000),
      fullName: "acme/app",
    })
    .returning({ id: monitoredRepo.id });

  const [sprintRow] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: proj.id,
      jiraSprintId: "42",
      name: "Sprint 7",
      state: "ACTIVE",
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      committedSp: 13,
      completedSp: 5,
    })
    .returning({ id: sprint.id });

  return { ownerId, projectId: proj.id, sprintId: sprintRow.id, repoId: repo.id };
}

async function addMember(
  s: Seeded,
  opts: {
    name: string;
    githubUsername?: string | null;
    jiraAccountId?: string | null;
    track?: "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | null;
    isActive?: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(teamMember).values({
    id,
    ownerId: s.ownerId,
    name: opts.name,
    githubUsername: opts.githubUsername ?? null,
    jiraAccountId: opts.jiraAccountId ?? null,
    technologyTrack: opts.track ?? null,
    source: "MANUAL",
    isActive: opts.isActive ?? true,
  });
  return id;
}

async function addTicket(
  s: Seeded,
  opts: {
    key: string;
    storyPoints?: number | null;
    category?: "TODO" | "IN_PROGRESS" | "CODE_REVIEW" | "TESTING" | "DONE" | null;
    assignee?: string | null;
    lastStatusChangeAt?: Date | null;
    inSprint?: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(jiraTicket).values({
    id,
    ownerId: s.ownerId,
    jiraProjectId: s.projectId,
    sprintId: opts.inSprint === false ? null : s.sprintId,
    jiraKey: opts.key,
    summary: `Summary for ${opts.key}`,
    storyPoints: opts.storyPoints ?? null,
    currentCategory: opts.category ?? null,
    assigneeJiraAccountId: opts.assignee ?? null,
    lastStatusChangeAt: opts.lastStatusChangeAt ?? null,
    sourceUrl: `https://acme.atlassian.net/browse/${opts.key}`,
  });
  return id;
}

async function addTransition(
  s: Seeded,
  ticketId: string,
  opts: {
    to: "TODO" | "IN_PROGRESS" | "CODE_REVIEW" | "TESTING" | "DONE" | null;
    at: Date | null;
    changelogId?: string;
  },
): Promise<void> {
  await db.insert(jiraStatusHistory).values({
    id: randomUUID(),
    ownerId: s.ownerId,
    ticketId,
    toCategory: opts.to,
    changedAt: opts.at,
    jiraChangelogId: opts.changelogId ?? randomUUID(),
  });
}

// ---------------------------------------------------------------------------
// M3 — getTicketAging
// ---------------------------------------------------------------------------

describe("getTicketAging", () => {
  it("folds each ticket's transitions into cumulative per-category time", async () => {
    const s = await seedOwner();
    const t = await addTicket(s, {
      key: "SF-1",
      storyPoints: 5,
      category: "CODE_REVIEW",
      assignee: "acc-1",
      lastStatusChangeAt: new Date("2026-08-20T10:00:00Z"),
    });
    await addTransition(s, t, { to: "TODO", at: new Date("2026-08-20T06:00:00Z") });
    await addTransition(s, t, { to: "IN_PROGRESS", at: new Date("2026-08-20T08:00:00Z") });
    await addTransition(s, t, { to: "CODE_REVIEW", at: new Date("2026-08-20T10:00:00Z") });

    const rows = await getTicketAging(db, s.ownerId, s.sprintId, NOW);

    expect(rows).toHaveLength(1);
    const HOUR = 60 * 60 * 1000;
    expect(rows[0].jiraKey).toBe("SF-1");
    expect(rows[0].storyPoints).toBe(5);
    expect(rows[0].sourceUrl).toBe("https://acme.atlassian.net/browse/SF-1");
    expect(rows[0].byCategory.TODO).toBe(2 * HOUR);
    expect(rows[0].byCategory.IN_PROGRESS).toBe(2 * HOUR);
    expect(rows[0].byCategory.CODE_REVIEW).toBe(2 * HOUR);
    expect(rows[0].sinceLastMoveMs).toBe(2 * HOUR);
  });

  it("excludes DONE tickets but keeps unmapped (null-category) ones", async () => {
    const s = await seedOwner();
    await addTicket(s, { key: "SF-DONE", category: "DONE" });
    await addTicket(s, { key: "SF-NULL", category: null });
    await addTicket(s, { key: "SF-WIP", category: "IN_PROGRESS" });

    const rows = await getTicketAging(db, s.ownerId, s.sprintId, NOW);

    expect(rows.map((r) => r.jiraKey).sort()).toEqual(["SF-NULL", "SF-WIP"]);
  });

  it("returns a ticket with no history rather than dropping it", async () => {
    const s = await seedOwner();
    await addTicket(s, {
      key: "SF-2",
      category: "TODO",
      lastStatusChangeAt: new Date("2026-08-20T09:00:00Z"),
    });

    const rows = await getTicketAging(db, s.ownerId, s.sprintId, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].sinceLastMoveMs).toBe(3 * 60 * 60 * 1000);
    expect(rows[0].byCategory.TODO).toBe(3 * 60 * 60 * 1000);
  });

  it("ignores tickets from another sprint", async () => {
    const s = await seedOwner();
    await addTicket(s, { key: "SF-IN", category: "TODO" });
    await addTicket(s, { key: "SF-OUT", category: "TODO", inSprint: false });

    const rows = await getTicketAging(db, s.ownerId, s.sprintId, NOW);

    expect(rows.map((r) => r.jiraKey)).toEqual(["SF-IN"]);
  });

  it("never returns another owner's tickets or transitions", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    const ta = await addTicket(a, { key: "A-1", category: "TODO" });
    const tb = await addTicket(b, { key: "B-1", category: "TODO" });
    await addTransition(a, ta, { to: "TODO", at: new Date("2026-08-19T08:00:00Z") });
    await addTransition(b, tb, { to: "TODO", at: new Date("2026-08-19T08:00:00Z") });

    const rowsA = await getTicketAging(db, a.ownerId, a.sprintId, NOW);
    const rowsB = await getTicketAging(db, b.ownerId, b.sprintId, NOW);

    expect(rowsA.map((r) => r.jiraKey)).toEqual(["A-1"]);
    expect(rowsB.map((r) => r.jiraKey)).toEqual(["B-1"]);
    // Owner A's sprint id must return nothing for owner B even though the id is
    // a valid sprint — the owner filter, not the join, is what protects this.
    expect(await getTicketAging(db, b.ownerId, a.sprintId, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M1 — getBurndownSeries
// ---------------------------------------------------------------------------

describe("getBurndownSeries", () => {
  it("derives the series and resolves tracks through the roster", async () => {
    const s = await seedOwner();
    await addMember(s, { name: "Ada", jiraAccountId: "acc-fe", track: "FRONTEND" });
    await addMember(s, { name: "Bo", jiraAccountId: "acc-be", track: "BACKEND" });

    const t1 = await addTicket(s, {
      key: "SF-1",
      storyPoints: 5,
      category: "DONE",
      assignee: "acc-fe",
    });
    await addTicket(s, { key: "SF-2", storyPoints: 8, category: "IN_PROGRESS", assignee: "acc-be" });
    await addTransition(s, t1, { to: "DONE", at: new Date("2026-08-19T10:00:00Z") });

    const series = await getBurndownSeries(db, s.ownerId, s.sprintId, NOW);

    expect(series.days).toEqual(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]);
    expect(series.committedSp).toBe(13);
    expect(series.total.map((p) => p.remainingSp)).toEqual([13, 13, 8, 8]);
    expect(series.byTrack.FRONTEND.map((p) => p.remainingSp)).toEqual([5, 5, 0, 0]);
    expect(series.byTrack.BACKEND.map((p) => p.remainingSp)).toEqual([8, 8, 8, 8]);
    expect(series.byCategory.DONE).toBe(1);
    expect(series.byCategory.IN_PROGRESS).toBe(1);
  });

  it("resolves the track of a DEACTIVATED member rather than bucketing them UNKNOWN", async () => {
    const s = await seedOwner();
    await addMember(s, {
      name: "Left the team",
      jiraAccountId: "acc-gone",
      track: "QA",
      isActive: false,
    });
    await addTicket(s, { key: "SF-1", storyPoints: 5, category: "TESTING", assignee: "acc-gone" });

    const series = await getBurndownSeries(db, s.ownerId, s.sprintId, NOW);

    expect(series.byTrack.QA[0].remainingSp).toBe(5);
    expect(series.byTrack.UNKNOWN[0].remainingSp).toBe(0);
  });

  it("buckets unattributable SP into UNKNOWN so the tracks still sum to total", async () => {
    const s = await seedOwner();
    await addMember(s, { name: "Ada", jiraAccountId: "acc-fe", track: "FRONTEND" });
    await addTicket(s, { key: "SF-1", storyPoints: 5, category: "TODO", assignee: "acc-fe" });
    // Unassigned, and assigned-to-a-stranger: both unattributable.
    await addTicket(s, { key: "SF-2", storyPoints: 3, category: "TODO", assignee: null });
    await addTicket(s, { key: "SF-3", storyPoints: 2, category: "TODO", assignee: "acc-ghost" });

    const series = await getBurndownSeries(db, s.ownerId, s.sprintId, NOW);

    expect(series.byTrack.UNKNOWN[0].remainingSp).toBe(5);
    expect(series.total[0].remainingSp).toBe(10);
  });

  it("falls back to UTC bucketing when the project has no time zone", async () => {
    const s = await seedOwner({ timeZone: null });
    const t = await addTicket(s, { key: "SF-1", storyPoints: 5, category: "DONE" });
    // 22:30 UTC on the 18th: the 18th in UTC, the 19th in Warsaw.
    await addTransition(s, t, { to: "DONE", at: new Date("2026-08-18T22:30:00Z") });

    const series = await getBurndownSeries(db, s.ownerId, s.sprintId, NOW);

    expect(series.total.map((p) => p.remainingSp)).toEqual([5, 0, 0, 0]);
  });

  it("never mixes another owner's tickets into the series", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await addTicket(a, { key: "A-1", storyPoints: 5, category: "TODO" });
    await addTicket(b, { key: "B-1", storyPoints: 100, category: "TODO" });

    const seriesA = await getBurndownSeries(db, a.ownerId, a.sprintId, NOW);

    expect(seriesA.total[0].remainingSp).toBe(5);
    // Owner B asking for owner A's sprint id sees an empty sprint, not A's data.
    const crossed = await getBurndownSeries(db, b.ownerId, a.sprintId, NOW);
    expect(crossed.total.every((p) => p.remainingSp === 0)).toBe(true);
    expect(crossed.committedSp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M2 — getActivityRollup
// ---------------------------------------------------------------------------

async function addCommit(
  s: Seeded,
  opts: { sha: string; login: string | null; at: Date; additions?: number | null },
): Promise<void> {
  await db.insert(githubCommit).values({
    id: randomUUID(),
    ownerId: s.ownerId,
    repoId: s.repoId,
    sha: opts.sha,
    authorGithubUsername: opts.login,
    authoredAt: opts.at,
    additions: opts.additions ?? null,
    deletions: opts.additions === null || opts.additions === undefined ? null : 1,
  });
}

describe("getActivityRollup", () => {
  it("builds the Dev × Day grid over the requested range", async () => {
    const s = await seedOwner();
    await addMember(s, { name: "Ada", githubUsername: "ada" });
    await addMember(s, { name: "Bo", githubUsername: "bo" });

    await addCommit(s, { sha: "c1", login: "ada", at: new Date("2026-08-18T10:00:00Z"), additions: 10 });
    await addCommit(s, { sha: "c2", login: "ada", at: new Date("2026-08-18T14:00:00Z"), additions: 5 });
    // Over-cap commit: churn never measured.
    await addCommit(s, { sha: "c3", login: "bo", at: new Date("2026-08-19T09:00:00Z"), additions: null });

    const [pr] = await db
      .insert(githubPullRequest)
      .values({
        id: randomUUID(),
        ownerId: s.ownerId,
        repoId: s.repoId,
        githubPrId: 9001,
        number: 7,
        authorGithubUsername: "ada",
        state: "MERGED",
        openedAt: new Date("2026-08-18T09:00:00Z"),
        mergedAt: new Date("2026-08-19T09:00:00Z"),
      })
      .returning({ id: githubPullRequest.id });

    await db.insert(githubReview).values({
      id: randomUUID(),
      ownerId: s.ownerId,
      pullRequestId: pr.id,
      reviewerGithubUsername: "bo",
      state: "APPROVED",
      submittedAt: new Date("2026-08-19T08:00:00Z"),
    });

    const grid = await getActivityRollup(db, s.ownerId, {
      from: SPRINT_START,
      to: NOW,
    });

    const ada = grid.rows.find((r) => r.memberName === "Ada")!;
    const bo = grid.rows.find((r) => r.memberName === "Bo")!;
    expect(ada.cells["2026-08-18"].commits).toBe(2);
    expect(ada.cells["2026-08-18"].additions).toBe(15);
    expect(ada.cells["2026-08-18"].prsOpened).toBe(1);
    expect(ada.cells["2026-08-19"].prsMerged).toBe(1);
    expect(bo.cells["2026-08-19"].reviews).toBe(1);
    // Unmeasured churn stays null so the UI can render "—" rather than 0.
    expect(bo.cells["2026-08-19"].commits).toBe(1);
    expect(bo.cells["2026-08-19"].additions).toBeNull();
  });

  it("serves a single zone-local day for Yesterday's Activity", async () => {
    const s = await seedOwner();
    await addMember(s, { name: "Ada", githubUsername: "ada" });
    // 22:30 UTC on the 18th is 00:30 Warsaw on the 19th — belongs to the 19th.
    await addCommit(s, { sha: "c1", login: "ada", at: new Date("2026-08-18T22:30:00Z"), additions: 3 });
    await addCommit(s, { sha: "c2", login: "ada", at: new Date("2026-08-19T10:00:00Z"), additions: 4 });

    const { from, to } = dayRangeInTimeZone("2026-08-19", ZONE);
    const grid = await getActivityRollup(db, s.ownerId, { from, to });

    expect(grid.days).toEqual(["2026-08-19"]);
    expect(grid.rows[0].cells["2026-08-19"].commits).toBe(2);
    expect(grid.rows[0].cells["2026-08-19"].additions).toBe(7);
  });

  it("aggregates an unmatched author into the trailing UNKNOWN row", async () => {
    const s = await seedOwner();
    await addMember(s, { name: "Ada", githubUsername: "ada" });
    await addCommit(s, {
      sha: "c1",
      login: "drive-by",
      at: new Date("2026-08-18T10:00:00Z"),
      additions: 2,
    });

    const grid = await getActivityRollup(db, s.ownerId, { from: SPRINT_START, to: NOW });

    const last = grid.rows[grid.rows.length - 1];
    expect(last.memberId).toBe(UNKNOWN_MEMBER_ID);
    expect(last.cells["2026-08-18"].commits).toBe(1);
  });

  it("never returns another owner's commits, PRs, or reviews", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    await addMember(a, { name: "Ada", githubUsername: "ada" });
    await addMember(b, { name: "Bea", githubUsername: "ada" }); // same login, different owner

    await addCommit(a, { sha: "a1", login: "ada", at: new Date("2026-08-18T10:00:00Z"), additions: 1 });
    await addCommit(b, { sha: "b1", login: "ada", at: new Date("2026-08-18T10:00:00Z"), additions: 99 });

    const gridA = await getActivityRollup(db, a.ownerId, { from: SPRINT_START, to: NOW });

    expect(gridA.rows.map((r) => r.memberName)).toEqual(["Ada"]);
    expect(gridA.rows[0].cells["2026-08-18"].commits).toBe(1);
    expect(gridA.rows[0].cells["2026-08-18"].additions).toBe(1);
  });
});
