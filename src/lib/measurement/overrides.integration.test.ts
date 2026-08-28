import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
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
import {
  UnknownSprintError,
  getActiveSprintMeasurement,
  getSprintMeasurement,
  setCapacityOverride,
  setDeliveredCorrection,
} from "@/lib/measurement/overrides";
import { sweepSprintMeasurements } from "@/lib/measurement/sweep";

/**
 * S-23 Phase 5 — the lead's override and correction against REAL Postgres
 * (local Supabase `:54322`).
 *
 * What only a real database can prove here:
 *
 *  - the override's upsert lands on the SAME `unique(owner_id, jira_sprint_id)`
 *    row the sweep writes, without touching a single computed column;
 *  - a sweep running AFTER an override leaves the override alone — the two
 *    writers' conflict `set`s are disjoint by construction and that construction
 *    is only real once Postgres evaluates it;
 *  - `numeric(8,2)` comes back off the wire as a STRING, so a read that forgot
 *    to convert would compare unequal to the number that was written.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

/** The active sprint: Mon 2026-08-17 → Fri 2026-08-28. Ten Mon–Fri working days. */
const START = new Date("2026-08-17T08:00:00.000Z");
const END = new Date("2026-08-28T16:00:00.000Z");
const FROZEN_AT = new Date("2026-08-17T08:15:00.000Z");
/** A clock past `END`, so the sweep finalizes. */
const AFTER = new Date("2026-08-31T09:00:00.000Z");

const JIRA_SPRINT_ID = "5150";

type Seeded = { ownerId: string; projectRowId: string; sprintRowId: string };

const owners: string[] = [];

async function seed(jiraSprintId: string = JIRA_SPRINT_ID): Promise<Seeded> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Override Test",
    email: `ov-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_OverrideTokenABCDEFG123", {
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
      jiraProjectId: "10000",
      projectKey: "SF",
      timeZone: "UTC",
    })
    .returning({ id: jiraProject.id });

  const [row] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: project.id,
      jiraSprintId,
      name: "Sprint N",
      state: "ACTIVE",
      startDate: START,
      endDate: END,
      committedSp: 30,
      committedFrozenAt: FROZEN_AT,
    })
    .returning({ id: sprint.id });

  // Two full-time members over ten working days ⇒ 20 MD, nothing subtracted.
  for (const name of ["Ada", "Bo"]) {
    await db
      .insert(teamMember)
      .values({ id: randomUUID(), ownerId, name, source: "MANUAL", fte: "1.00" });
  }

  return { ownerId, projectRowId: project.id, sprintRowId: row.id };
}

/** One delivered ticket, so the sweep has a non-zero `delivered_sp` to write. */
async function addDeliveredTicket(s: Seeded, sp: number): Promise<void> {
  const [ticket] = await db
    .insert(jiraTicket)
    .values({
      id: randomUUID(),
      ownerId: s.ownerId,
      jiraProjectId: s.projectRowId,
      sprintId: s.sprintRowId,
      jiraKey: `SF-${sp}`,
      storyPoints: sp,
      currentCategory: "DONE",
    })
    .returning({ id: jiraTicket.id });

  await db.insert(jiraStatusHistory).values({
    id: randomUUID(),
    ownerId: s.ownerId,
    ticketId: ticket.id,
    toStatusId: "10003",
    toCategory: "DONE",
    changedAt: new Date("2026-08-20T10:00:00.000Z"),
    jiraChangelogId: `SF-${sp}-done`,
  });
}

async function rowsOf(ownerId: string) {
  return db
    .select()
    .from(sprintMeasurement)
    .where(eq(sprintMeasurement.ownerId, ownerId));
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("setCapacityOverride", () => {
  it("creates the record when the sweep has not run yet, filling only the identity columns", async () => {
    const s = await seed();

    await setCapacityOverride({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      md: 14.5,
    });

    const [row] = await rowsOf(s.ownerId);
    expect(row.jiraProjectId).toBe("10000");
    expect(row.jiraSprintId).toBe(JIRA_SPRINT_ID);
    expect(row.capacityOverrideMd).toBe("14.50");
    // Left for the sweep's next pass — which is free to fill them, because
    // nothing here stamped `finalized_at`.
    expect(row.capacityFullMd).toBeNull();
    expect(row.capacityAdjustedMd).toBeNull();
    expect(row.finalizedAt).toBeNull();
  });

  it("leaves the computed capacity untouched, and clearing restores the computed value", async () => {
    const s = await seed();
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: START });

    const [computed] = await rowsOf(s.ownerId);
    expect(computed.capacityAdjustedMd).toBe("20.00");

    await setCapacityOverride({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      md: 12,
    });

    const [overridden] = await rowsOf(s.ownerId);
    expect(overridden.capacityOverrideMd).toBe("12.00");
    // THE POINT OF THE WHOLE COLUMN: the measurement is still there beside it.
    expect(overridden.capacityAdjustedMd).toBe("20.00");
    expect(overridden.capacityFullMd).toBe("20.00");
    expect(overridden.workingDays).toBe(10);

    await setCapacityOverride({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      md: null,
    });

    const [cleared] = await rowsOf(s.ownerId);
    expect(cleared.capacityOverrideMd).toBeNull();
    expect(cleared.capacityAdjustedMd).toBe("20.00");
    // One row throughout — the upsert never forked the record.
    expect((await rowsOf(s.ownerId)).length).toBe(1);
  });

  it("survives a later sweep, including the one that finalizes the record", async () => {
    const s = await seed();
    await addDeliveredTicket(s, 8);
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: START });

    await setCapacityOverride({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      md: 12,
    });
    await setDeliveredCorrection({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      sp: 5,
    });

    // A sweep AFTER the sprint ended: it recomputes and freezes the record.
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: AFTER });

    const [row] = await rowsOf(s.ownerId);
    expect(row.finalizedAt).not.toBeNull();
    expect(row.deliveredSp).toBe(8);
    // Neither of the lead's columns is in the sweep's conflict SET.
    expect(row.capacityOverrideMd).toBe("12.00");
    expect(row.deliveredSpCorrected).toBe(5);
  });

  it("still accepts a correction once the record is finalized — that is the point of FR-023", async () => {
    const s = await seed();
    await addDeliveredTicket(s, 8);
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: AFTER });
    expect((await rowsOf(s.ownerId))[0].finalizedAt).not.toBeNull();

    await setDeliveredCorrection({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      sp: 13,
    });

    const [row] = await rowsOf(s.ownerId);
    expect(row.deliveredSpCorrected).toBe(13);
    // The measurement it corrects is untouched, so the correction stays legible
    // AS a correction.
    expect(row.deliveredSp).toBe(8);
  });

  it("refuses a sprint id that EXISTS but belongs to another owner, writing nothing", async () => {
    const mine = await seed();
    const theirs = await seed("7777");

    // The id is real — it resolves to a sprint row, a Jira project and a
    // credential. It is simply not mine. An owner-blind lookup would find it,
    // file a measurement under MY account carrying THEIR project id, and report
    // success; the `AND owner_id = ?` in the lookup is what makes that a refusal
    // instead (PRD cross-account isolation).
    await expect(
      setCapacityOverride({
        db,
        ownerId: mine.ownerId,
        jiraSprintId: "7777",
        md: 12,
      }),
    ).rejects.toBeInstanceOf(UnknownSprintError);

    await expect(
      setDeliveredCorrection({
        db,
        ownerId: mine.ownerId,
        jiraSprintId: "7777",
        sp: 5,
      }),
    ).rejects.toBeInstanceOf(UnknownSprintError);

    // Neither account gained a row: not mine (the write was refused) and not
    // theirs (nothing was written on their behalf either).
    expect(await rowsOf(mine.ownerId)).toHaveLength(0);
    expect(await rowsOf(theirs.ownerId)).toHaveLength(0);
  });
});

describe("getActiveSprintMeasurement", () => {
  it("returns null when no record exists yet", async () => {
    const s = await seed();
    expect(await getActiveSprintMeasurement(db, s.ownerId)).toBeNull();
  });

  it("converts the driver's numeric strings to numbers", async () => {
    const s = await seed();
    await sweepSprintMeasurements({ db, ownerId: s.ownerId, now: START });
    await setCapacityOverride({
      db,
      ownerId: s.ownerId,
      jiraSprintId: JIRA_SPRINT_ID,
      md: 12.5,
    });

    const record = await getActiveSprintMeasurement(db, s.ownerId);
    expect(record).not.toBeNull();
    // `'12.50' === 12.5` is false — this is the assertion, not a formality.
    expect(record?.capacityOverrideMd).toBe(12.5);
    expect(record?.capacityAdjustedMd).toBe(20);
    expect(record?.capacityFullMd).toBe(20);
  });

  it("is owner-scoped: another account's record is invisible", async () => {
    const mine = await seed();
    const theirs = await seed("7777");
    await sweepSprintMeasurements({ db, ownerId: theirs.ownerId, now: START });

    expect(await getSprintMeasurement(db, mine.ownerId, "7777")).toBeNull();
    expect(await getSprintMeasurement(db, theirs.ownerId, "7777")).not.toBeNull();
  });
});
