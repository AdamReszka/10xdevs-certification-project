import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  absence,
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
import { createAbsence, deleteAbsence } from "@/lib/absence-store";
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

  // Above the early return on purpose (S-20): the roster does not depend on the
  // sprint row, and the NULL-stamp case needs an owner who has a team member but
  // no sprint — the only state `createAbsence` can stamp NULL from.
  await db.insert(teamMember).values({
    id: randomUUID(),
    ownerId,
    name: "Alex Dev",
    githubUsername: "alexdev",
    jiraAccountId: "jira-alex",
    source: "BOTH",
  });

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

/**
 * S-08 — the two FR-010 anomaly effects, end to end through the real reconcile
 * loop rather than against the pure rules.
 *
 * Detection is a RECONCILE: a `dedupKey` that stops being emitted is flipped to
 * RESOLVED. So suppression needs no removal code of its own — the proof is that
 * an existing ACTIVE row leaves the inbox after an absence is recorded, and comes
 * back when it is deleted.
 *
 * The seeded scenario has Alex Dev on an In-Progress ticket with zero commits, so
 * DEVELOPER_INACTIVE is ACTIVE on the first run. The sprint runs 2026-08-05 →
 * 2026-08-20 and the clock is 2026-08-10T12:00Z.
 */
describe("detectAnomalies — absences (S-08, FR-010)", () => {
  async function onlyMemberId(ownerId: string) {
    const [row] = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    return row.id;
  }

  /** The owner's Jira project — `seedScenario` creates it but does not return it. */
  async function projectIdOf(ownerId: string) {
    const [row] = await db
      .select({ id: jiraProject.id })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    return row.id;
  }

  function absencesOf(ownerId: string, condition: string) {
    return db
      .select()
      .from(anomaly)
      .where(and(eq(anomaly.ownerId, ownerId), eq(anomaly.status, "ACTIVE")))
      .then((rows) =>
        rows.filter(
          (r) => (r.context as { condition?: string } | null)?.condition === condition,
        ),
      );
  }

  it("resolves an ACTIVE DEVELOPER_INACTIVE once the member's absence is recorded", async () => {
    const { ownerId } = await newScenario();
    const memberId = await onlyMemberId(ownerId);

    // --- Run 1: the developer looks inactive ---
    await detectAnomalies({ db, ownerId, now: NOW1 });
    const before = await activeAnomalies(ownerId);
    const inactive = before.find((r) => r.type === "DEVELOPER_INACTIVE");
    expect(inactive).toBeDefined();

    // --- The owner explains it: a planned holiday across the window ---
    await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "VACATION",
        startDate: "2026-08-09",
        endDate: "2026-08-12",
        isPlanned: true,
      },
    });

    // --- Run 2: the row is reconciled away, not left stale ---
    await detectAnomalies({ db, ownerId, now: NOW2 });
    const [after] = await db.select().from(anomaly).where(eq(anomaly.id, inactive!.id));
    expect(after.status).toBe("RESOLVED");
    const stillActive = await activeAnomalies(ownerId);
    expect(stillActive.some((r) => r.type === "DEVELOPER_INACTIVE")).toBe(false);
  });

  it("brings DEVELOPER_INACTIVE back when the absence is deleted", async () => {
    const { ownerId } = await newScenario();
    const memberId = await onlyMemberId(ownerId);
    const { id: absenceId } = await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "SICKNESS",
        startDate: "2026-08-09",
        endDate: "2026-08-12",
        isPlanned: true,
      },
    });

    await detectAnomalies({ db, ownerId, now: NOW1 });
    expect((await activeAnomalies(ownerId)).some((r) => r.type === "DEVELOPER_INACTIVE")).toBe(
      false,
    );

    // The absence was entered by mistake and removed.
    await deleteAbsence({ db, ownerId, absenceId });
    await detectAnomalies({ db, ownerId, now: NOW2 });

    expect((await activeAnomalies(ownerId)).some((r) => r.type === "DEVELOPER_INACTIVE")).toBe(
      true,
    );
  });

  it("raises a SPRINT_AT_RISK row for an unplanned mid-sprint absence and resolves it on delete", async () => {
    const { ownerId } = await newScenario();
    const memberId = await onlyMemberId(ownerId);

    await detectAnomalies({ db, ownerId, now: NOW1 });
    expect(await absencesOf(ownerId, "absence")).toHaveLength(0);

    const { id: absenceId } = await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "SICKNESS",
        startDate: "2026-08-11",
        endDate: "2026-08-14",
        isPlanned: false,
      },
    });

    await detectAnomalies({ db, ownerId, now: NOW2 });
    const raised = await absencesOf(ownerId, "absence");
    expect(raised).toHaveLength(1);
    expect(raised[0].type).toBe("SPRINT_AT_RISK");
    expect(raised[0].dedupKey).toBe(`SPRINT_AT_RISK:absence:${absenceId}`);
    expect(raised[0].relatedTeamMemberId).toBe(memberId);
    // Hand-derived, not lifted from engine output: NOW2 is Mon 10 Aug 13:00Z and
    // the sprint runs to Thu 20 Aug, so the working days left are
    // 10,11,12,13,14,17,18,19,20 = 9, of which the absence (Tue 11 → Fri 14)
    // takes 11,12,13,14 = 4.
    expect(raised[0].context).toMatchObject({
      condition: "absence",
      workingDaysLost: 4,
      workingDaysLeft: 9,
    });
    expect(raised[0].riskScore).toBeGreaterThan(0);

    // --- The absence is removed → the risk row reconciles away ---
    await deleteAbsence({ db, ownerId, absenceId });
    await detectAnomalies({ db, ownerId, now: NOW3 });
    expect(await absencesOf(ownerId, "absence")).toHaveLength(0);
    const [resolved] = await db
      .select()
      .from(anomaly)
      .where(eq(anomaly.dedupKey, `SPRINT_AT_RISK:absence:${absenceId}`));
    expect(resolved.status).toBe("RESOLVED");
  });

  /**
   * S-20 — the two cases D2's `sprint_id` predicate made unreachable. Both go
   * through the real store and the real reconcile loop rather than the pure
   * rule: impl-review F10's own complaint was that "the store test asserts the
   * NULL is stored; nothing covers the downstream consequence".
   */
  it("raises risk for an absence recorded with NO sprint, once a sprint appears", async () => {
    // The first-run window: the owner signed up, entered an absence, and the
    // first sync has not ingested a sprint yet — so `getActiveSprintRow` finds
    // nothing and `createAbsence` stamps NULL. NULL is unequal to every sprint
    // id, so the old predicate dropped this row in every sprint, forever.
    const { ownerId } = await newScenario(false);
    const memberId = await onlyMemberId(ownerId);

    const { id: absenceId } = await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "SICKNESS",
        startDate: "2026-08-11",
        endDate: "2026-08-14",
        isPlanned: false,
      },
    });

    const [stored] = await db.select().from(absence).where(eq(absence.id, absenceId));
    expect(stored.sprintId).toBeNull();

    // The first sync lands and the owner finally has a sprint.
    await db.insert(sprint).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: await projectIdOf(ownerId),
      jiraSprintId: "42",
      name: "Sprint 7",
      state: "ACTIVE",
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      committedSp: 40,
    });

    await detectAnomalies({ db, ownerId, now: NOW1 });

    const raised = await absencesOf(ownerId, "absence");
    expect(raised).toHaveLength(1);
    expect(raised[0].type).toBe("SPRINT_AT_RISK");
    expect(raised[0].dedupKey).toBe(`SPRINT_AT_RISK:absence:${absenceId}`);
    // Hand-derived, not lifted from engine output: NOW1 is Mon 10 Aug 12:00Z and
    // the sprint runs to Thu 20 Aug, so the working days left are
    // 10,11,12,13,14,17,18,19,20 = 9, of which the absence (Tue 11 → Fri 14)
    // takes 11,12,13,14 = 4.
    expect(raised[0].context).toMatchObject({
      condition: "absence",
      workingDaysLost: 4,
      workingDaysLeft: 9,
    });
  });

  it("raises risk in sprint N+1 for an absence stamped with sprint N", async () => {
    // The D2 reversal itself. The absence is typed during sprint N — so it is
    // stamped N — but its window runs past N's end into N+1, where it is still
    // an unexpected loss of working days.
    const { ownerId, sprintId: sprintN } = await newScenario();
    const memberId = await onlyMemberId(ownerId);

    const { id: absenceId } = await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "SICKNESS",
        startDate: "2026-08-18",
        endDate: "2026-08-26",
        isPlanned: false,
      },
    });

    const [stored] = await db.select().from(absence).where(eq(absence.id, absenceId));
    expect(stored.sprintId).toBe(sprintN);

    // The rollover. N is CLOSED rather than deleted on purpose:
    // `absence.sprint_id` is ON DELETE CASCADE, so deleting N would take the
    // absence with it and the test would prove nothing.
    await db.update(sprint).set({ state: "CLOSED" }).where(eq(sprint.id, sprintN));
    const nextSprintId = randomUUID();
    await db.insert(sprint).values({
      id: nextSprintId,
      ownerId,
      jiraProjectId: await projectIdOf(ownerId),
      jiraSprintId: "43",
      name: "Sprint 8",
      state: "ACTIVE",
      startDate: new Date("2026-08-21T08:00:00.000Z"),
      endDate: new Date("2026-09-04T08:00:00.000Z"),
      committedSp: 40,
    });

    const nowInNext = new Date("2026-08-24T12:00:00.000Z");
    await detectAnomalies({ db, ownerId, now: nowInNext });

    const raised = await absencesOf(ownerId, "absence");
    expect(raised).toHaveLength(1);
    expect(raised[0].dedupKey).toBe(`SPRINT_AT_RISK:absence:${absenceId}`);
    // Attributed to N+1, the sprint being detected against — not to the sprint
    // the row happens to be stamped with.
    expect(raised[0].sprintId).toBe(nextSprintId);
    // Hand-derived: `nowInNext` is Mon 24 Aug and N+1 runs to Fri 4 Sep, so the
    // working days left are 24,25,26,27,28,31 + 1,2,3,4 Sep = 10, of which the
    // absence (Tue 18 Aug → Wed 26 Aug, clipped at `now`) takes 24,25,26 = 3.
    expect(raised[0].context).toMatchObject({
      condition: "absence",
      workingDaysLost: 3,
      workingDaysLeft: 10,
    });
  });

  it("never writes the absence type into the persisted anomaly row", async () => {
    // FR-018 mails these rows out. A SICKNESS absence must not become health
    // information about a named person in the recap.
    const { ownerId } = await newScenario();
    const memberId = await onlyMemberId(ownerId);
    await createAbsence({
      db,
      ownerId,
      input: {
        teamMemberId: memberId,
        type: "SICKNESS",
        startDate: "2026-08-11",
        endDate: "2026-08-14",
        isPlanned: false,
      },
    });

    await detectAnomalies({ db, ownerId, now: NOW1 });
    const [row] = await absencesOf(ownerId, "absence");
    const readable = JSON.stringify([row.description, row.suggestedAction, row.context]);
    expect(readable.toLowerCase()).not.toContain("sick");
  });

  it("keeps absences out of the snapshot when they belong to another owner", async () => {
    const mine = await newScenario();
    const theirs = await newScenario();
    const theirMember = await onlyMemberId(theirs.ownerId);
    await createAbsence({
      db,
      ownerId: theirs.ownerId,
      input: {
        teamMemberId: theirMember,
        type: "VACATION",
        startDate: "2026-08-09",
        endDate: "2026-08-12",
        isPlanned: true,
      },
    });

    await detectAnomalies({ db, ownerId: mine.ownerId, now: NOW1 });

    // Their holiday must not silence MY inactive developer.
    expect(
      (await activeAnomalies(mine.ownerId)).some((r) => r.type === "DEVELOPER_INACTIVE"),
    ).toBe(true);
    expect(await db.select().from(absence).where(eq(absence.ownerId, mine.ownerId))).toEqual(
      [],
    );
  });
});
