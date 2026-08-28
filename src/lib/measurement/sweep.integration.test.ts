import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  absence,
  jiraCredential,
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  sprint,
  sprintMeasurement,
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { listSprintMeasurements } from "@/lib/measurement/reader";
import { sweepSprintMeasurements } from "@/lib/measurement/sweep";

/**
 * S-23 Phase 4 — the measurement sweep against REAL Postgres (local Supabase
 * `:54322`). Everything asserted here is a database-level guarantee a mocked DB
 * could not prove:
 *
 *  - the `unique(owner_id, jira_sprint_id)` key the upsert's idempotence rests on;
 *  - that `sprint_measurement` survives the cascade a Jira-project switch fires
 *    on `sprint` — the whole reason the record lives in its own table with
 *    `jira_project_id` stored as PLAIN TEXT and no foreign key;
 *  - that delivered SP is recomputed from `jira_status_history` rather than
 *    copied off `sprint.completed_sp`, so a ticket the sync RE-STAMPED into the
 *    next sprint still counts in the one that actually finished it.
 *
 * Clocks are parameters throughout, so "the sweep first ran three cycles after
 * the rollover" is an argument rather than a wait.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

/** Sprint N: Mon 2026-08-03 → Fri 2026-08-14. Ten Mon–Fri working days. */
const N_START = new Date("2026-08-03T08:00:00.000Z");
const N_END = new Date("2026-08-14T16:00:00.000Z");
/** Sprint N+1, the rollover target. */
const NEXT_START = new Date("2026-08-17T08:00:00.000Z");
const NEXT_END = new Date("2026-08-28T16:00:00.000Z");
/** Three 15-minute cycles after sprint N ended — the "late sweep" clock. */
const LATE = new Date("2026-08-20T09:00:00.000Z");
const FROZEN_AT = new Date("2026-08-03T08:15:00.000Z");

const JIRA_PROJECT_ID = "10000";

type Seeded = {
  ownerId: string;
  projectRowId: string;
  sprintNId: string;
  sprintNextId: string;
  memberIds: string[];
};

const owners: string[] = [];

async function seed(opts?: {
  /** Jira-side project id, so a second project can be seeded for the same owner's history. */
  jiraProjectId?: string;
  committedFrozenAt?: Date | null;
  sprintNState?: "ACTIVE" | "CLOSED";
}): Promise<Seeded> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Sweep Test",
    email: `sw-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_SweepTokenABCDEFGH1234", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const [project] = await db
    .insert(jiraProject)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: opts?.jiraProjectId ?? JIRA_PROJECT_ID,
      projectKey: "SF",
      timeZone: "UTC",
    })
    .returning({ id: jiraProject.id });

  const [sprintN] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: project.id,
      jiraSprintId: "4242",
      name: "Sprint N",
      state: opts?.sprintNState ?? "CLOSED",
      startDate: N_START,
      endDate: N_END,
      committedSp: 30,
      committedFrozenAt:
        opts?.committedFrozenAt === undefined ? FROZEN_AT : opts.committedFrozenAt,
      completedSp: 999, // deliberately wrong: the sweep must NOT copy this.
    })
    .returning({ id: sprint.id });

  const [sprintNext] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: project.id,
      jiraSprintId: "4343",
      name: "Sprint N+1",
      state: "ACTIVE",
      startDate: NEXT_START,
      endDate: NEXT_END,
      committedSp: 21,
      committedFrozenAt: NEXT_START,
    })
    .returning({ id: sprint.id });

  // Three full-time members; one is away for the sprint's whole second week
  // (Mon 10th → Fri 14th = 5 working days), so full ≠ adjusted.
  const memberIds: string[] = [];
  for (const name of ["Ada", "Bo", "Cy"]) {
    const [m] = await db
      .insert(teamMember)
      .values({ id: randomUUID(), ownerId, name, source: "MANUAL", fte: "1.00" })
      .returning({ id: teamMember.id });
    memberIds.push(m.id);
  }
  await db.insert(absence).values({
    id: randomUUID(),
    ownerId,
    teamMemberId: memberIds[2],
    type: "VACATION",
    startDate: new Date("2026-08-10T00:00:00.000Z"),
    endDate: new Date("2026-08-14T23:59:00.000Z"),
  });

  return {
    ownerId,
    projectRowId: project.id,
    sprintNId: sprintN.id,
    sprintNextId: sprintNext.id,
    memberIds,
  };
}

/** One ticket plus its first-DONE transition. `sprintId` is which sprint row it
 *  is currently STAMPED to — not which sprint delivered it. */
async function addTicket(
  s: Seeded,
  opts: { key: string; sp: number; sprintId: string | null; doneAt: Date | null },
): Promise<string> {
  const [ticket] = await db
    .insert(jiraTicket)
    .values({
      id: randomUUID(),
      ownerId: s.ownerId,
      jiraProjectId: s.projectRowId,
      sprintId: opts.sprintId,
      jiraKey: opts.key,
      storyPoints: opts.sp,
      currentCategory: opts.doneAt ? "DONE" : "IN_PROGRESS",
    })
    .returning({ id: jiraTicket.id });

  if (opts.doneAt) {
    await db.insert(jiraStatusHistory).values({
      id: randomUUID(),
      ownerId: s.ownerId,
      ticketId: ticket.id,
      toStatusId: "10003",
      toCategory: "DONE",
      changedAt: opts.doneAt,
      jiraChangelogId: `${opts.key}-done`,
    });
  }
  return ticket.id;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

async function measurementsOf(ownerId: string) {
  return db
    .select()
    .from(sprintMeasurement)
    .where(eq(sprintMeasurement.ownerId, ownerId))
    .orderBy(sprintMeasurement.jiraSprintId);
}

describe("sweepSprintMeasurements", () => {
  it("writes one finalized record per closed sprint, and a second run with the same clock changes nothing", async () => {
    const s = await seed();
    await addTicket(s, {
      key: "SF-1",
      sp: 8,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-12T10:00:00.000Z"),
    });

    const first = await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });
    expect(first.upserted).toBe(2); // sprint N and the running N+1
    expect(first.finalized).toBe(1); // only N is over

    const after = await measurementsOf(s.ownerId);
    expect(after).toHaveLength(2);

    const recordN = after.find((r) => r.jiraSprintId === "4242")!;
    expect(recordN.finalizedAt).not.toBeNull();
    expect(recordN.workingDays).toBe(10);
    // 3 members × 10 working days = 30 MD, minus Cy's 5-day absence = 25 MD.
    expect(recordN.capacityFullMd).toBe("30.00");
    expect(recordN.capacityAdjustedMd).toBe("25.00");
    // Copied from the frozen sprint row, NOT recomputed.
    expect(recordN.committedSp).toBe(30);
    expect(recordN.committedFrozenAt?.toISOString()).toBe(FROZEN_AT.toISOString());
    // Recomputed from first-entry-into-Done — never the sprint row's stale 999.
    expect(recordN.deliveredSp).toBe(8);
    // The team identity is the JIRA-side project id, so it survives a switch.
    expect(recordN.jiraProjectId).toBe(JIRA_PROJECT_ID);
    // The lead's columns are the sweep's business to leave alone (Phase 5).
    expect(recordN.capacityOverrideMd).toBeNull();
    expect(recordN.deliveredSpCorrected).toBeNull();

    // A second pass in the same cycle must be a no-op, byte for byte.
    const second = await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });
    expect(second.finalized).toBe(0);
    expect(await measurementsOf(s.ownerId)).toEqual(after);
  });

  it("still records a sprint whose rollover the sweep slept through", async () => {
    // The loss the hook design would have caused: nothing ran while sprint N was
    // active, and the first sweep happens days after it closed.
    const s = await seed();
    await addTicket(s, {
      key: "SF-2",
      sp: 13,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-06T10:00:00.000Z"),
    });

    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });

    const [record] = await db
      .select()
      .from(sprintMeasurement)
      .where(
        and(
          eq(sprintMeasurement.ownerId, s.ownerId),
          eq(sprintMeasurement.jiraSprintId, "4242"),
        ),
      );
    expect(record.deliveredSp).toBe(13);
    expect(record.finalizedAt).not.toBeNull();
  });

  it("counts a carried-over ticket in the sprint that finished it, before and after the re-stamp", async () => {
    const s = await seed();
    const ticketId = await addTicket(s, {
      key: "SF-3",
      sp: 5,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-13T09:00:00.000Z"),
    });

    const beforeRollover = await sweepSprintMeasurements({
      db,
      ownerId: s.ownerId,
      now: new Date("2026-08-14T18:00:00.000Z"),
    });
    expect(beforeRollover.finalized).toBe(1);
    const [before] = await measurementsOf(s.ownerId);
    expect(before.deliveredSp).toBe(5);

    // The sync re-stamps a carried ticket into the NEXT sprint (`jira_ticket` is
    // unique on `(owner_id, jira_key)` and the upsert overwrites `sprint_id`).
    // A `where sprint_id = N` sum would silently lose it here.
    await db
      .update(jiraTicket)
      .set({ sprintId: s.sprintNextId })
      .where(eq(jiraTicket.id, ticketId));

    await db.delete(sprintMeasurement).where(eq(sprintMeasurement.ownerId, s.ownerId));
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });

    const [afterRestamp] = await measurementsOf(s.ownerId);
    expect(afterRestamp.deliveredSp).toBe(5);
  });

  it("never moves a finalized record's computed columns again", async () => {
    const s = await seed();
    await addTicket(s, {
      key: "SF-4",
      sp: 3,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-05T10:00:00.000Z"),
    });
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });
    const [frozen] = await measurementsOf(s.ownerId);

    // Everything the record was derived from changes underneath it.
    await db
      .update(sprint)
      .set({ committedSp: 99 })
      .where(eq(sprint.id, s.sprintNId));
    await addTicket(s, {
      key: "SF-5",
      sp: 21,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-11T10:00:00.000Z"),
    });
    await db.delete(absence).where(eq(absence.ownerId, s.ownerId));

    await sweepSprintMeasurements({
      db,
      ownerId: s.ownerId,
      now: new Date("2026-08-25T09:00:00.000Z"),
    });

    const [again] = await measurementsOf(s.ownerId);
    expect(again).toEqual(frozen);
  });

  it("leaves a closed sprint whose commitment was never frozen unfinalized", async () => {
    // FR-023's honest "no data": a commitment that was still moving must not be
    // baked in as the denominator of every later normalisation.
    const s = await seed({ committedFrozenAt: null });

    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });

    const [record] = await measurementsOf(s.ownerId);
    expect(record.jiraSprintId).toBe("4242");
    expect(record.finalizedAt).toBeNull();
    // And so it never reaches the history series.
    const series = await listSprintMeasurements(db, s.ownerId, JIRA_PROJECT_ID);
    expect(series).toHaveLength(0);
  });

  it("keeps its records when a Jira-project switch cascades the sprint rows away", async () => {
    const s = await seed();
    await addTicket(s, {
      key: "SF-6",
      sp: 8,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-12T10:00:00.000Z"),
    });
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });

    // What `connection-service.ts` / `jira-store.ts` do on a project switch.
    await db.delete(jiraProject).where(eq(jiraProject.id, s.projectRowId));

    expect(
      await db.select().from(sprint).where(eq(sprint.ownerId, s.ownerId)),
    ).toHaveLength(0);
    const survivors = await measurementsOf(s.ownerId);
    expect(survivors).toHaveLength(2);
    expect(survivors[0].deliveredSp).toBe(8);
  });
});

describe("listSprintMeasurements", () => {
  it("returns finalized rows of the current project only, with numerics as numbers", async () => {
    const s = await seed();
    await addTicket(s, {
      key: "SF-7",
      sp: 8,
      sprintId: s.sprintNId,
      doneAt: new Date("2026-08-12T10:00:00.000Z"),
    });
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: LATE });

    const series = await listSprintMeasurements(db, s.ownerId, JIRA_PROJECT_ID);
    expect(series).toHaveLength(1); // the running N+1 is not history yet
    expect(series[0].jiraSprintId).toBe("4242");
    // `numeric` arrives from `pg` as a STRING; the reader is the boundary that
    // converts, so no consumer has to remember.
    expect(series[0].capacityFullMd).toBe(30);
    expect(series[0].capacityAdjustedMd).toBe(25);
    expect(typeof series[0].capacityAdjustedMd).toBe("number");

    // Another team's history must never join this average.
    expect(await listSprintMeasurements(db, s.ownerId, "99999")).toHaveLength(0);
  });
});
