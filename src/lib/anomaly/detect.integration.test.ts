import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  anomaly,
  githubCredential,
  githubPullRequest,
  githubReview,
  jiraCredential,
  jiraProject,
  jiraTicket,
  monitoredRepo,
  sprint,
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { detectAnomalies } from "@/lib/anomaly/detect";

/**
 * S-06 Phase 3 — `detectAnomalies` reconcile lifecycle against REAL Postgres
 * (local Supabase :54322). Verifies: first-run insert with all attributes; a
 * no-op second run keeping `id` + `detectedAt` stable; RESOLVED on a cleared
 * condition; and reactivation with a fresh `detectedAt` on recurrence.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const NOW1 = new Date("2026-08-10T12:00:00.000Z");
const NOW2 = new Date("2026-08-10T13:00:00.000Z");
const NOW3 = new Date("2026-08-10T14:00:00.000Z");
const SPRINT_START = new Date("2026-08-05T08:00:00.000Z");
const SPRINT_END = new Date("2026-08-20T08:00:00.000Z");

type Seeded = { ownerId: string; sprintId: string; stalledPrRowId: string };

async function seedScenario(withSprint = true): Promise<Seeded> {
  const ownerId = randomUUID();
  await db
    .insert(user)
    .values({ id: ownerId, name: "Lead", email: `lead-${ownerId}@example.test` });

  const [ghCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("gh_DetectPat1234", { ownerId, provider: "GITHUB" }),
      tokenLast4: "1234",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  const [repo] = await db
    .insert(monitoredRepo)
    .values({ id: randomUUID(), ownerId, credentialId: ghCred.id, githubRepoId: 777, fullName: "acme/app" })
    .returning({ id: monitoredRepo.id });

  const [jCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_DetectToken1234", { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const [proj] = await db
    .insert(jiraProject)
    .values({ id: randomUUID(), ownerId, credentialId: jCred.id, jiraProjectId: "10000", projectKey: "SF" })
    .returning({ id: jiraProject.id });

  if (!withSprint) return { ownerId, sprintId: "", stalledPrRowId: "" };

  const [spr] = await db
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
      committedSp: 40,
    })
    .returning({ id: sprint.id });

  await db.insert(teamMember).values({
    id: randomUUID(),
    ownerId,
    name: "Alex Dev",
    githubUsername: "alexdev",
    jiraAccountId: "jira-alex",
    source: "BOTH",
  });

  // SF-1: aging In-Progress ticket, assigned, no linked commit → 3 anomalies.
  await db.insert(jiraTicket).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: proj.id,
    sprintId: spr.id,
    jiraKey: "SF-1",
    summary: "Build the thing",
    storyPoints: 3,
    currentCategory: "IN_PROGRESS",
    assigneeJiraAccountId: "jira-alex",
    lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"),
    addedAfterSprintStart: false,
    sourceUrl: "https://acme.atlassian.net/browse/SF-1",
  });

  // SF-2: post-start addition → scope creep contributor (10 SP of 40).
  await db.insert(jiraTicket).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: proj.id,
    sprintId: spr.id,
    jiraKey: "SF-2",
    summary: "Late addition",
    storyPoints: 10,
    currentCategory: "TODO",
    addedAfterSprintStart: true,
    lastStatusChangeAt: NOW1,
    sourceUrl: "https://acme.atlassian.net/browse/SF-2",
  });

  // SF-3: fresh Code-Review ticket linked to a merged PR → desync (no aging).
  await db.insert(jiraTicket).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId: proj.id,
    sprintId: spr.id,
    jiraKey: "SF-3",
    summary: "Shipped but not closed",
    storyPoints: 2,
    currentCategory: "CODE_REVIEW",
    lastStatusChangeAt: NOW1,
    addedAfterSprintStart: false,
    sourceUrl: "https://acme.atlassian.net/browse/SF-3",
  });

  // PR #42: OPEN, ready 2d ago, no reviews → PR_REVIEW_STALLED.
  const [stalledPr] = await db
    .insert(githubPullRequest)
    .values({
      id: randomUUID(),
      ownerId,
      repoId: repo.id,
      githubPrId: 5001,
      number: 42,
      title: "Stalled PR",
      authorGithubUsername: "alexdev",
      state: "OPEN",
      additions: 100,
      deletions: 20,
      changedFiles: 3,
      openedAt: new Date("2026-08-08T12:00:00.000Z"),
      readyForReviewAt: new Date("2026-08-08T12:00:00.000Z"),
      sourceUrl: "https://github.com/acme/app/pull/42",
    })
    .returning({ id: githubPullRequest.id });

  // PR #43: OPEN, fresh, oversized → PR_TOO_BIG only.
  await db.insert(githubPullRequest).values({
    id: randomUUID(),
    ownerId,
    repoId: repo.id,
    githubPrId: 5002,
    number: 43,
    title: "Huge PR",
    authorGithubUsername: "alexdev",
    state: "OPEN",
    additions: 600,
    deletions: 100,
    changedFiles: 40,
    openedAt: NOW1,
    readyForReviewAt: NOW1,
    sourceUrl: "https://github.com/acme/app/pull/43",
  });

  // PR #44: MERGED, linked to SF-3 (not Done) → PR_TICKET_DESYNC.
  await db.insert(githubPullRequest).values({
    id: randomUUID(),
    ownerId,
    repoId: repo.id,
    githubPrId: 5003,
    number: 44,
    title: "Merged PR",
    authorGithubUsername: "alexdev",
    state: "MERGED",
    additions: 50,
    deletions: 10,
    changedFiles: 2,
    openedAt: SPRINT_START,
    mergedAt: new Date("2026-08-09T00:00:00.000Z"),
    linkedTicketKey: "SF-3",
    sourceUrl: "https://github.com/acme/app/pull/44",
  });

  return { ownerId, sprintId: spr.id, stalledPrRowId: stalledPr.id };
}

const owners: string[] = [];
async function newScenario(withSprint = true) {
  const seeded = await seedScenario(withSprint);
  owners.push(seeded.ownerId);
  return seeded;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

function activeAnomalies(ownerId: string) {
  return db
    .select()
    .from(anomaly)
    .where(and(eq(anomaly.ownerId, ownerId), eq(anomaly.status, "ACTIVE")));
}

describe("detectAnomalies", () => {
  it("skips when the owner has no sprint", async () => {
    const { ownerId } = await newScenario(false);
    const result = await detectAnomalies({ db, ownerId, now: NOW1 });
    expect(result).toEqual({ status: "skipped", reason: "no_sprint" });
  });

  it("inserts ACTIVE anomalies with all five attributes on first run", async () => {
    const { ownerId, sprintId } = await newScenario();
    const result = await detectAnomalies({ db, ownerId, now: NOW1 });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.inserted).toBeGreaterThanOrEqual(4);
    expect(result.updated).toBe(0);
    expect(result.resolved).toBe(0);

    const rows = await activeAnomalies(ownerId);
    const types = new Set(rows.map((r) => r.type));
    expect(types.size).toBeGreaterThanOrEqual(4);
    expect(types).toContain("PR_REVIEW_STALLED");
    expect(types).toContain("SCOPE_CREEP");
    expect(types).toContain("PR_TICKET_DESYNC");

    for (const r of rows) {
      expect(r.sprintId).toBe(sprintId); // all attributed to the active sprint
      expect(r.severity).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.suggestedAction).toBeTruthy();
      expect(r.riskScore).not.toBeNull();
      expect(r.detectedAt?.toISOString()).toBe(NOW1.toISOString());
    }
  });

  it("keeps id + detectedAt stable on an unchanged re-run, then resolves and reactivates", async () => {
    const { ownerId, stalledPrRowId } = await newScenario();

    // --- Run 1: insert ---
    await detectAnomalies({ db, ownerId, now: NOW1 });
    const first = await activeAnomalies(ownerId);
    const stalled1 = first.find((r) => r.type === "PR_REVIEW_STALLED")!;
    expect(stalled1).toBeDefined();

    // --- Run 2 (later clock, unchanged data): no-op, stable id + detectedAt ---
    const r2 = await detectAnomalies({ db, ownerId, now: NOW2 });
    expect(r2.status === "ok" && r2.inserted).toBe(0);
    const second = await activeAnomalies(ownerId);
    expect(second).toHaveLength(first.length);
    const stalled2 = second.find((r) => r.id === stalled1.id)!;
    expect(stalled2.detectedAt?.toISOString()).toBe(NOW1.toISOString());

    // --- Clear the stalled condition (PR reviewed/ready now) → RESOLVED ---
    await db
      .update(githubPullRequest)
      .set({ readyForReviewAt: NOW2 })
      .where(eq(githubPullRequest.id, stalledPrRowId));
    const r3 = await detectAnomalies({ db, ownerId, now: NOW2 });
    expect(r3.status === "ok" && r3.resolved).toBeGreaterThanOrEqual(1);
    const [resolvedRow] = await db
      .select()
      .from(anomaly)
      .where(eq(anomaly.id, stalled1.id));
    expect(resolvedRow.status).toBe("RESOLVED");
    expect((await activeAnomalies(ownerId)).some((r) => r.id === stalled1.id)).toBe(false);

    // --- Recurrence: restore the condition → reactivated with a fresh detectedAt ---
    await db
      .update(githubPullRequest)
      .set({ readyForReviewAt: new Date("2026-08-08T12:00:00.000Z") })
      .where(eq(githubPullRequest.id, stalledPrRowId));
    await detectAnomalies({ db, ownerId, now: NOW3 });
    const [reactivated] = await db
      .select()
      .from(anomaly)
      .where(eq(anomaly.id, stalled1.id));
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.detectedAt?.toISOString()).toBe(NOW3.toISOString());
  });
});
