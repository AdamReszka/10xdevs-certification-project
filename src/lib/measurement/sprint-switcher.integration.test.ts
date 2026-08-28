import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  jiraCredential,
  jiraProject,
  sprint,
  sprintMeasurement,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { setDeliveredCorrection } from "@/lib/measurement/overrides";
import {
  listRecordedSprintsForOwner,
  listSprintMeasurementsForOwner,
} from "@/lib/measurement/reader";
import {
  resolveAdjustmentAvailability,
  resolveSprintSelection,
} from "@/app/(app)/dashboard/sprint-detail/sprint-selection";
import { getSprintRowByJiraId } from "@/lib/sprint";

/**
 * S-23 Phase 7 — the Sprint Detail switcher against REAL Postgres (local
 * Supabase `:54322`).
 *
 * What only a real database can prove here:
 *
 *  - the list the switcher offers is scoped to the owner AND to the Jira project
 *    they monitor TODAY. The record deliberately outlives a project switch, so
 *    one owner's table legitimately holds two teams' sprints; a switcher that
 *    offered both would invite the lead onto a page describing a team they no
 *    longer track;
 *  - a delivered-SP correction lands on the SELECTED closed sprint and leaves
 *    the active one alone. Until Phase 7 the form only ever existed on a surface
 *    pinned to the active sprint, which is exactly the mistake this asserts
 *    against;
 *  - a sprint whose RAW data is gone while its measurement survives resolves to
 *    the notice rather than to the active sprint. The PRD's "current + 2 sprints"
 *    purge does not exist in `src/` yet, so that half of §3 cannot be reached on
 *    a real account — the rows are deleted here directly instead, which is the
 *    coverage §3 names in place of a manual row.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const CLOSED_START = new Date("2026-08-03T08:00:00.000Z");
const CLOSED_END = new Date("2026-08-14T16:00:00.000Z");
const ACTIVE_START = new Date("2026-08-17T08:00:00.000Z");
const ACTIVE_END = new Date("2026-08-28T16:00:00.000Z");

const owners: string[] = [];

/** One account monitoring one Jira project, with no sprints yet. */
async function seedOwner(jiraProjectId: string): Promise<{
  ownerId: string;
  projectRowId: string;
}> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Switcher Test",
    email: `sw-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_SwitcherTokenABCDEFG123", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "0123",
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
      jiraProjectId,
      projectKey: "SF",
      timeZone: "UTC",
    })
    .returning({ id: jiraProject.id });

  return { ownerId, projectRowId: project.id };
}

async function addSprintRow(
  ownerId: string,
  projectRowId: string,
  jiraSprintId: string,
  state: "ACTIVE" | "CLOSED",
): Promise<string> {
  const [row] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: projectRowId,
      jiraSprintId,
      name: `Sprint ${jiraSprintId}`,
      state,
      startDate: state === "ACTIVE" ? ACTIVE_START : CLOSED_START,
      endDate: state === "ACTIVE" ? ACTIVE_END : CLOSED_END,
      committedSp: 30,
      committedFrozenAt: state === "ACTIVE" ? ACTIVE_START : CLOSED_START,
    })
    .returning({ id: sprint.id });

  return row.id;
}

async function addMeasurement({
  ownerId,
  jiraProjectId,
  jiraSprintId,
  finalized,
  deliveredSp,
}: {
  ownerId: string;
  jiraProjectId: string;
  jiraSprintId: string;
  finalized: boolean;
  deliveredSp: number;
}): Promise<void> {
  await db.insert(sprintMeasurement).values({
    id: randomUUID(),
    ownerId,
    jiraProjectId,
    jiraSprintId,
    sprintName: `Sprint ${jiraSprintId}`,
    startDate: finalized ? CLOSED_START : ACTIVE_START,
    endDate: finalized ? CLOSED_END : ACTIVE_END,
    workingDays: 10,
    capacityFullMd: "20.00",
    capacityAdjustedMd: "20.00",
    committedSp: 30,
    deliveredSp,
    state: finalized ? "CLOSED" : "ACTIVE",
    finalizedAt: finalized ? CLOSED_END : null,
  });
}

async function recordOf(ownerId: string, jiraSprintId: string) {
  const [row] = await db
    .select()
    .from(sprintMeasurement)
    .where(
      and(
        eq(sprintMeasurement.ownerId, ownerId),
        eq(sprintMeasurement.jiraSprintId, jiraSprintId),
      ),
    );
  return row;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("listRecordedSprintsForOwner", () => {
  it("offers the open record too, unlike the finalized series FR-024 averages", async () => {
    const { ownerId } = await seedOwner("10000");
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "900",
      finalized: false,
      deliveredSp: 8,
    });

    // The switcher must be able to name the sprint in flight; the average must
    // not include it. One filter apart, and the difference is load-bearing.
    expect(
      (await listRecordedSprintsForOwner(db, ownerId)).map((m) => m.jiraSprintId),
    ).toEqual(["900", "899"]);
    expect(
      (await listSprintMeasurementsForOwner(db, ownerId)).map((m) => m.jiraSprintId),
    ).toEqual(["899"]);
  });

  it("hides the sprints of a Jira project the owner no longer monitors", async () => {
    const { ownerId, projectRowId } = await seedOwner("10000");
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });
    // A record left behind by a project the owner monitored earlier. It survives
    // by design — the column carries no foreign key precisely so a switch cannot
    // cascade it away — which is exactly why the READ has to filter.
    await addMeasurement({
      ownerId,
      jiraProjectId: "20000",
      jiraSprintId: "700",
      finalized: true,
      deliveredSp: 55,
    });

    expect(
      (await listRecordedSprintsForOwner(db, ownerId)).map((m) => m.jiraSprintId),
    ).toEqual(["899"]);

    // Switch the monitored project the way the settings path does — UPDATE the
    // row in place — and the other team's sprint becomes the visible one.
    await db
      .update(jiraProject)
      .set({ jiraProjectId: "20000" })
      .where(eq(jiraProject.id, projectRowId));

    expect(
      (await listRecordedSprintsForOwner(db, ownerId)).map((m) => m.jiraSprintId),
    ).toEqual(["700"]);
  });

  it("is owner-scoped: another account's sprints are invisible", async () => {
    const mine = await seedOwner("10000");
    const theirs = await seedOwner("10000");
    await addMeasurement({
      ownerId: theirs.ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });

    // Same Jira project id on both accounts — two leads on one company's Jira is
    // ordinary. Only `owner_id` separates them.
    expect(await listRecordedSprintsForOwner(db, mine.ownerId)).toHaveLength(0);
    expect(await listRecordedSprintsForOwner(db, theirs.ownerId)).toHaveLength(1);
  });

  it("returns nothing for an owner with no monitored project at all", async () => {
    const ownerId = randomUUID();
    owners.push(ownerId);
    await db.insert(user).values({
      id: ownerId,
      name: "No Project",
      email: `np-${ownerId}@example.test`,
    });

    expect(await listRecordedSprintsForOwner(db, ownerId)).toEqual([]);
  });
});

describe("a correction written against the SELECTED sprint", () => {
  it("lands on the closed sprint and leaves the active one untouched", async () => {
    const { ownerId, projectRowId } = await seedOwner("10000");
    await addSprintRow(ownerId, projectRowId, "899", "CLOSED");
    await addSprintRow(ownerId, projectRowId, "900", "ACTIVE");
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "900",
      finalized: false,
      deliveredSp: 8,
    });

    // The whole point of Phase 7 §4: the sprint comes from the SURFACE, and the
    // surface is no longer pinned to the active one. Before this, a lead
    // correcting last sprint's figure was writing on this sprint's record.
    await setDeliveredCorrection({
      db,
      ownerId,
      jiraSprintId: "899",
      sp: 26,
    });

    const rows = await db
      .select()
      .from(sprintMeasurement)
      .where(eq(sprintMeasurement.ownerId, ownerId));
    const closed = rows.find((r) => r.jiraSprintId === "899");
    const active = rows.find((r) => r.jiraSprintId === "900");

    expect(closed?.deliveredSpCorrected).toBe(26);
    // The measurement it corrects is untouched, so the correction stays legible
    // AS a correction (FR-023).
    expect(closed?.deliveredSp).toBe(21);
    expect(active?.deliveredSpCorrected).toBeNull();
    expect(active?.deliveredSp).toBe(8);
    // And no third row was forged along the way.
    expect(rows).toHaveLength(2);
  });

  it("refuses a sprint whose row cascaded away on a project switch", async () => {
    // Row 2 of the plan's three-way table, proven rather than asserted in prose:
    // `writeLeadColumn` resolves the owner's `sprint` row first, so the record
    // alone is not enough to write against. The surface withholds the form for
    // exactly this reason (`resolveAdjustmentAvailability`).
    const { ownerId } = await seedOwner("10000");
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });

    await expect(
      setDeliveredCorrection({ db, ownerId, jiraSprintId: "899", sp: 26 }),
    ).rejects.toThrow();

    expect((await recordOf(ownerId, "899"))?.deliveredSpCorrected).toBeNull();
  });
});


describe("getSprintRowByJiraId", () => {
  it("is owner-scoped: another account's sprint id resolves to nothing", async () => {
    // The ONE new query that consumes `?sprint=` directly. Isolation here is
    // app-enforced — there is no RLS behind these tables — so the predicate is
    // the whole guarantee, and two leads sharing a company Jira really do meet
    // the same `jira_sprint_id`.
    const mine = await seedOwner("10000");
    const theirs = await seedOwner("10000");
    await addSprintRow(theirs.ownerId, theirs.projectRowId, "899", "CLOSED");

    expect(await getSprintRowByJiraId(db, mine.ownerId, "899")).toBeNull();
    expect((await getSprintRowByJiraId(db, theirs.ownerId, "899"))?.jiraSprintId).toBe(
      "899",
    );
  });
});

describe("a sprint whose raw data is gone but whose measurement survives", () => {
  it("resolves to that sprint and its notice, never to the active one", async () => {
    // THE RETENTION HALF OF §3, deleted into existence. Nothing in `src/` purges
    // aged product data yet, so this is the only way to stand the case up — and
    // it has to be stood up, because the failure it guards is silent: falling
    // back to the active sprint would render THIS sprint's numbers under the
    // heading of the one the lead asked for.
    //
    // It runs through the REAL readers rather than hand-built fixtures, so the
    // owner predicate in `getSprintRowByJiraId` and the project filter in
    // `listRecordedSprintsForOwner` are part of what is being asserted
    // (`lessons.md`: test the path through the real resolver).
    const { ownerId, projectRowId } = await seedOwner("10000");
    await addSprintRow(ownerId, projectRowId, "899", "CLOSED");
    const activeRowId = await addSprintRow(ownerId, projectRowId, "900", "ACTIVE");
    await addMeasurement({
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "899",
      finalized: true,
      deliveredSp: 21,
    });

    // The purge — or the project-switch cascade, which lands in the same state.
    await db
      .delete(sprint)
      .where(and(eq(sprint.ownerId, ownerId), eq(sprint.jiraSprintId, "899")));

    const [activeSprint, recorded, requestedSprint] = await Promise.all([
      db
        .select()
        .from(sprint)
        .where(eq(sprint.id, activeRowId))
        .then(([row]) => row ?? null),
      listRecordedSprintsForOwner(db, ownerId),
      getSprintRowByJiraId(db, ownerId, "899"),
    ]);

    // The record outlived its raw data, so the switcher can still name it.
    expect(recorded.map((m) => m.jiraSprintId)).toEqual(["899"]);
    expect(requestedSprint).toBeNull();

    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint,
      requestedSprint,
      measurements: recorded,
    });

    expect(selection).toEqual({
      jiraSprintId: "899",
      name: "Sprint 899",
      sprintRowId: null,
      kind: "measurement-only",
    });
    // `sprintRowId === null` is what makes the page skip all three reducers and
    // render the notice; it is also what withholds the adjustment form, because
    // `writeLeadColumn` would refuse the save.
    expect(
      resolveAdjustmentAvailability({
        sprintRowId: selection.sprintRowId,
        isFinalized: recorded[0].finalizedAt != null,
      }),
    ).toEqual({ kind: "unavailable" });
  });
});
