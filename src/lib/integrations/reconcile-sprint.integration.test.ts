import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  anomaly,
  jiraCredential,
  jiraProject,
  sprint,
  user,
  type SelectSprint,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { JiraUnavailableError } from "@/lib/jira";
import { getActiveSprintRow } from "@/lib/sprint";

import { reconcileActiveSprint } from "./reconcile-sprint";

/**
 * S-16 Phase 2 — the shared sprint reconciler against REAL Postgres (local
 * Supabase `:54322`). Every invariant here is a DATABASE-level guarantee that a
 * mocked DB could not prove: "at most one ACTIVE row per owner", the
 * `cadence_overridden` three-way SET, and "a failed reconcile writes nothing".
 *
 * The Jira HTTP edge is mocked via the injectable `fetchImpl`; no network, no
 * real credentials. Seed/assertion style follows
 * `roster-store.integration.test.ts`.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const JIRA_BASE = "https://jira.test";
const JIRA_TOKEN = "jira_ReconcileTokenABCDEFGH1234";
const JIRA_EMAIL = "lead@example.com";
const CREDS = { email: JIRA_EMAIL, token: JIRA_TOKEN };

const BOARD = { id: 77, name: "SF Scrum", type: "scrum" };
const SECOND_BOARD = { id: 78, name: "SF Delivery", type: "scrum" };

/** Sprint 7: 2026-08-17T08:00Z (Mon) → +14d. */
const SPRINT_7 = {
  id: 4242,
  state: "active",
  name: "Sprint 7",
  startDate: "2026-08-17T08:00:00.000Z",
  endDate: "2026-08-31T08:00:00.000Z",
};

/** Sprint 8: the rollover target — a DIFFERENT `jira_sprint_id`. */
const SPRINT_8 = {
  id: 4343,
  state: "active",
  name: "Sprint 8",
  startDate: "2026-08-31T08:00:00.000Z",
  endDate: "2026-09-14T08:00:00.000Z",
};

// --- HTTP edge mock ---------------------------------------------------------

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type JiraSprintFixture = typeof SPRINT_7 | null;

function jiraFetch(opts?: {
  sprint?: JiraSprintFixture;
  boards?: Array<{ id: number; name: string; type: string }>;
  sprintStatus?: number;
}): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/sprint")) {
      if (opts?.sprintStatus && opts.sprintStatus !== 200) {
        return jsonRes({ message: "boom" }, opts.sprintStatus);
      }
      const s = opts?.sprint === undefined ? SPRINT_7 : opts.sprint;
      return jsonRes({ values: s ? [s] : [] });
    }
    if (url.includes("/board")) {
      return jsonRes({ isLast: true, values: opts?.boards ?? [BOARD] });
    }
    throw new Error(`unexpected Jira mock URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup ---------------------------------------------------------

type Seeded = { ownerId: string; projectId: string };

async function seedOwner(opts?: { boardId?: string | null }): Promise<Seeded> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Reconcile Test",
    email: `rc-${ownerId}@example.test`,
  });

  const [cred] = await db
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

  const [project] = await db
    .insert(jiraProject)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: "10000",
      projectKey: "SF",
      boardId: opts?.boardId === undefined ? String(BOARD.id) : opts.boardId,
    })
    .returning({ id: jiraProject.id });

  return { ownerId, projectId: project.id };
}

const owners: string[] = [];

async function newOwner(opts?: { boardId?: string | null }): Promise<Seeded> {
  const s = await seedOwner(opts);
  owners.push(s.ownerId);
  return s;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

// --- Helpers ----------------------------------------------------------------

function run(
  seeded: Seeded,
  opts?: Parameters<typeof jiraFetch>[0] & { chosenBoardId?: number },
) {
  return reconcileActiveSprint({
    db,
    ownerId: seeded.ownerId,
    baseUrl: JIRA_BASE,
    creds: CREDS,
    projectId: seeded.projectId,
    projectKey: "SF",
    storedBoardId: BOARD.id,
    timeZone: "UTC",
    chosenBoardId: opts?.chosenBoardId,
    jiraOpts: { fetchImpl: jiraFetch(opts) },
  });
}

/** Insert a stored sprint row directly, bypassing the reconciler. */
async function seedSprint(
  seeded: Seeded,
  values: Partial<SelectSprint> & { jiraSprintId: string },
): Promise<SelectSprint> {
  const [row] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId: seeded.ownerId,
      jiraProjectId: seeded.projectId,
      name: "Seeded",
      state: "ACTIVE",
      startDate: new Date("2026-08-17T08:00:00.000Z"),
      endDate: new Date("2026-08-31T08:00:00.000Z"),
      lengthDays: 14,
      startDay: "MON",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      cadenceOverridden: false,
      ...values,
    })
    .returning();
  return row;
}

function rows(ownerId: string) {
  return db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
}

function activeCount(ownerId: string) {
  return db
    .select()
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.state, "ACTIVE")));
}

// ============================================================================

describe("reconcileActiveSprint — creation and refresh (C1, C4)", () => {
  // C4: the between-sprints onboarding case. Today such an account is
  // permanently dead AND permanently green — `syncJira` returns
  // SKIPPED{no_sprint} forever while stamping a fresh OK.
  it("(a) creates the row for an owner with ZERO sprint rows", async () => {
    const seeded = await newOwner();

    const result = await run(seeded);

    expect(result.status).toBe("reconciled");
    const all = await rows(seeded.ownerId);
    expect(all).toHaveLength(1);
    expect(all[0].jiraSprintId).toBe("4242");
    expect(all[0].state).toBe("ACTIVE");
    expect(all[0].name).toBe("Sprint 7");
    expect(all[0].lengthDays).toBe(14);
    expect(all[0].startDay).toBe("MON");
    if (result.status === "reconciled") expect(result.switched).toBe(false);
  });

  // C2: the roadmap's explicit constraint. Demotion is keyed on the RETURNED
  // row id, not on jira_sprint_id, so it cannot misfire on the conflict branch.
  it("(b) rollover demotes the previous ACTIVE row; exactly one stays ACTIVE", async () => {
    const seeded = await newOwner();
    await run(seeded); // Sprint 7 lands ACTIVE.

    const result = await run(seeded, { sprint: SPRINT_8 });

    expect(result.status).toBe("reconciled");
    if (result.status === "reconciled") expect(result.switched).toBe(true);

    const all = await rows(seeded.ownerId);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.jiraSprintId === "4343")?.state).toBe("ACTIVE");
    expect(all.find((r) => r.jiraSprintId === "4242")?.state).toBe("CLOSED");
    expect(await activeCount(seeded.ownerId)).toHaveLength(1);
  });

  // FR-007 "the override persists" — the CONFLICT branch (same sprint).
  it("(c) cadence_overridden=true: cadence columns hold, metadata refreshes", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, {
      jiraSprintId: "4242",
      name: "Stale name",
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      cadenceOverridden: true,
    });

    await run(seeded);

    const [row] = await rows(seeded.ownerId);
    expect(row.lengthDays).toBe(21);
    expect(row.startDay).toBe("WED");
    expect(row.workingDays).toEqual(["MON", "TUE", "WED"]);
    expect(row.cadenceOverridden).toBe(true);
    // Metadata still refreshes from Jira.
    expect(row.name).toBe("Sprint 7");
    expect(row.state).toBe("ACTIVE");
  });

  it("(d) cadence_overridden=false: cadence columns refresh from Jira", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, {
      jiraSprintId: "4242",
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      cadenceOverridden: false,
    });

    await run(seeded);

    const [row] = await rows(seeded.ownerId);
    expect(row.lengthDays).toBe(14);
    expect(row.startDay).toBe("MON");
    expect(row.workingDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });
});

describe("reconcileActiveSprint — rollover sweeps old anomalies (item B)", () => {
  // `detect.ts` scopes its resolve sweep to ONE sprint, so without this a
  // previous sprint's anomalies freeze status='ACTIVE' forever — invisible on
  // today's inbox, but S-12's recap history would read them as live.
  it("(e) closes the previous sprint's ACTIVE anomalies, leaves the new one's alone", async () => {
    const seeded = await newOwner();
    const first = await run(seeded);
    if (first.status !== "reconciled") throw new Error("expected reconciled");

    const oldAnomalyId = randomUUID();
    await db.insert(anomaly).values({
      id: oldAnomalyId,
      ownerId: seeded.ownerId,
      sprintId: first.sprint.id,
      dedupKey: "PR_REVIEW_STALLED:pr:1",
      type: "PR_REVIEW_STALLED",
      severity: "HIGH",
      status: "ACTIVE",
    });

    const second = await run(seeded, { sprint: SPRINT_8 });
    if (second.status !== "reconciled") throw new Error("expected reconciled");

    // A fresh anomaly on the NEW sprint must be untouched by a later reconcile.
    const newAnomalyId = randomUUID();
    await db.insert(anomaly).values({
      id: newAnomalyId,
      ownerId: seeded.ownerId,
      sprintId: second.sprint.id,
      dedupKey: "PR_REVIEW_STALLED:pr:2",
      type: "PR_REVIEW_STALLED",
      severity: "HIGH",
      status: "ACTIVE",
    });
    await run(seeded, { sprint: SPRINT_8 });

    const all = await db
      .select()
      .from(anomaly)
      .where(eq(anomaly.ownerId, seeded.ownerId));
    expect(all.find((a) => a.id === oldAnomalyId)?.status).toBe("RESOLVED");
    expect(all.find((a) => a.id === newAnomalyId)?.status).toBe("ACTIVE");
  });
});

describe("reconcileActiveSprint — never blanks the stored row (C3)", () => {
  it("(f) no active sprint, stored endDate still in the FUTURE → row untouched", async () => {
    const seeded = await newOwner();
    const before = await seedSprint(seeded, {
      jiraSprintId: "4242",
      state: "ACTIVE",
      startDate: new Date(Date.now() - 2 * 86_400_000),
      endDate: new Date(Date.now() + 5 * 86_400_000),
    });

    const result = await run(seeded, { sprint: null });

    expect(result.status).toBe("no_active_sprint");
    const [after] = await rows(seeded.ownerId);
    expect(after.state).toBe("ACTIVE");
    expect(after).toEqual(before);
  });

  it("(g) a thrown JiraUnavailableError leaves the stored row byte-identical", async () => {
    const seeded = await newOwner();
    const before = await seedSprint(seeded, { jiraSprintId: "4242" });

    await expect(run(seeded, { sprintStatus: 503 })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );

    const all = await rows(seeded.ownerId);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(before);
  });

  // Board ambiguity persists NOTHING: a headless cycle has no chooser UI, and
  // silently auto-picking is the defect class `type === "scrum"` already cost us.
  it("(h) two boards and no chosenBoardId → board_ambiguous, board_id still NULL", async () => {
    const seeded = await newOwner({ boardId: null });

    const result = await reconcileActiveSprint({
      db,
      ownerId: seeded.ownerId,
      baseUrl: JIRA_BASE,
      creds: CREDS,
      projectId: seeded.projectId,
      projectKey: "SF",
      storedBoardId: null,
      timeZone: "UTC",
      jiraOpts: { fetchImpl: jiraFetch({ boards: [BOARD, SECOND_BOARD] }) },
    });

    expect(result.status).toBe("board_ambiguous");
    if (result.status === "board_ambiguous") {
      expect(result.candidates.map((b) => b.id)).toEqual([77, 78]);
    }

    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, seeded.ownerId));
    expect(proj.boardId).toBeNull();
    expect(await rows(seeded.ownerId)).toHaveLength(0);
  });
});

describe("reconcileActiveSprint — an override survives a ROLLOVER (plan-review F1)", () => {
  // The case (c) cannot reach: (c) exercises the CONFLICT branch, this one the
  // INSERT branch. `importCadence`'s INSERT hard-codes cadenceOverridden:false,
  // so a verbatim copy would erase the override at exactly the event this slice
  // exists to handle — and the owner could not re-apply it, since /setup/team is
  // the only mount of CadenceForm.
  it("(i) rollover carries cadence_overridden and its columns onto the NEW row", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, {
      jiraSprintId: "4242",
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      cadenceOverridden: true,
    });

    await run(seeded, { sprint: SPRINT_8 });

    const all = await rows(seeded.ownerId);
    const created = all.find((r) => r.jiraSprintId === "4343")!;
    expect(created.cadenceOverridden).toBe(true);
    expect(created.lengthDays).toBe(21);
    expect(created.startDay).toBe("WED");
    expect(created.workingDays).toEqual(["MON", "TUE", "WED"]);
    // Metadata comes from Jira, not from the outgoing row.
    expect(created.name).toBe("Sprint 8");
    expect(created.state).toBe("ACTIVE");
    expect(all.find((r) => r.jiraSprintId === "4242")?.state).toBe("CLOSED");
  });
});

describe("reconcileActiveSprint — between sprints closes an ENDED row (plan-review F4)", () => {
  it("(j) no active sprint and stored endDate in the PAST → row flips to CLOSED only", async () => {
    const seeded = await newOwner();
    const before = await seedSprint(seeded, {
      jiraSprintId: "4242",
      state: "ACTIVE",
      startDate: new Date(Date.now() - 20 * 86_400_000),
      endDate: new Date(Date.now() - 3 * 86_400_000),
    });

    const result = await run(seeded, { sprint: null });

    expect(result.status).toBe("no_active_sprint");
    const [after] = await rows(seeded.ownerId);
    expect(after.state).toBe("CLOSED");
    // Everything else is byte-identical — demoting is not blanking (C3).
    // `updatedAt` is excluded because `$onUpdate` bumps it on any UPDATE; the
    // point of the assertion is that no OTHER column moved.
    expect({ ...after, state: null, updatedAt: null }).toEqual({
      ...before,
      state: null,
      updatedAt: null,
    });

    // And the dashboard keeps rendering it via the fallback branch.
    const resolved = await getActiveSprintRow(db, seeded.ownerId);
    expect(resolved?.id).toBe(before.id);
  });

  // The interaction between (i) and (j): the carry-forward read is scoped to
  // "most-recently-started", NOT to state='ACTIVE', precisely so an override
  // survives a rollover that FOLLOWS a between-sprints demotion.
  it("(k) rollover after a demotion still carries the override forward", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, {
      jiraSprintId: "4242",
      state: "ACTIVE",
      startDate: new Date(Date.now() - 20 * 86_400_000),
      endDate: new Date(Date.now() - 3 * 86_400_000),
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      cadenceOverridden: true,
    });

    await run(seeded, { sprint: null }); // demotes to CLOSED
    await run(seeded, { sprint: SPRINT_8 }); // then the new sprint goes active

    const all = await rows(seeded.ownerId);
    const created = all.find((r) => r.jiraSprintId === "4343")!;
    expect(created.cadenceOverridden).toBe(true);
    expect(created.lengthDays).toBe(21);
    expect(created.startDay).toBe("WED");
    expect(await activeCount(seeded.ownerId)).toHaveLength(1);
  });
});
