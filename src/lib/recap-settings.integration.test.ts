import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { dailyRecap, jiraCredential, jiraProject, recapSettings, sprint, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import {
  DEFAULT_RECAP_SETTINGS,
  getLastRecap,
  getRecapSettings,
  saveRecapSettings,
} from "@/lib/recap-settings";

/**
 * S-11 Phase 1 — the recap settings store and the `daily_recap` dedup key against
 * REAL Postgres (local Supabase `:54322`).
 *
 * The unique-constraint test is the load-bearing one: the whole exactly-once
 * design rests on the DATABASE refusing a second `(owner_id, recap_day)`, not on
 * application logic — which is what makes it hold across a Worker restart
 * mid-send. `recap_day` is NOT NULL for the reason `lessons.md` #1 records: a
 * nullable member of a UNIQUE key never collides, so the constraint would
 * silently stop deduping.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/** An owner with a Jira project and one ACTIVE sprint (`daily_recap.sprint_id` is NOT NULL). */
async function newOwner(): Promise<{ ownerId: string; sprintId: string }> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Recap Test",
    email: `rt-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_RecapTokenABCDEFGH1234", {
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
      jiraProjectId: "10000",
      projectKey: "SF",
      timeZone: "Europe/Warsaw",
    })
    .returning({ id: jiraProject.id });

  const sprintId = randomUUID();
  await db.insert(sprint).values({
    id: sprintId,
    ownerId,
    jiraProjectId: project.id,
    jiraSprintId: `s11-${sprintId}`,
    name: "Sprint 11",
    state: "ACTIVE",
    startDate: new Date("2026-08-17T08:00:00.000Z"),
    endDate: new Date("2026-08-31T08:00:00.000Z"),
  });

  return { ownerId, sprintId };
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("getRecapSettings / saveRecapSettings", () => {
  it("returns FR-018's 15:00 defaults for an owner with no row", async () => {
    const { ownerId } = await newOwner();

    await expect(getRecapSettings({ db, ownerId })).resolves.toEqual({
      sendHour: 15,
      sendMinute: 0,
      enabled: true,
    });
    // No row is written by reading — the defaults live in code, not in a seeded
    // row that would drift from them.
    const rows = await db
      .select()
      .from(recapSettings)
      .where(eq(recapSettings.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it("round-trips the stored values and upserts on the second save", async () => {
    const { ownerId } = await newOwner();

    await saveRecapSettings({
      db,
      ownerId,
      input: { sendHour: 8, sendMinute: 30, enabled: true },
    });
    await expect(getRecapSettings({ db, ownerId })).resolves.toEqual({
      sendHour: 8,
      sendMinute: 30,
      enabled: true,
    });

    // Second save UPDATES rather than inserting a second row — the singleton
    // shape the owner-unique constraint enforces.
    await saveRecapSettings({
      db,
      ownerId,
      input: { sendHour: 17, sendMinute: 0, enabled: false },
    });
    await expect(getRecapSettings({ db, ownerId })).resolves.toEqual({
      sendHour: 17,
      sendMinute: 0,
      enabled: false,
    });

    const rows = await db
      .select()
      .from(recapSettings)
      .where(eq(recapSettings.ownerId, ownerId));
    expect(rows).toHaveLength(1);
  });

  it("is owner-scoped: saving for A does not touch B's row", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await saveRecapSettings({
      db,
      ownerId: b.ownerId,
      input: { sendHour: 9, sendMinute: 15, enabled: true },
    });
    await saveRecapSettings({
      db,
      ownerId: a.ownerId,
      input: { sendHour: 20, sendMinute: 45, enabled: false },
    });

    await expect(getRecapSettings({ db, ownerId: b.ownerId })).resolves.toEqual({
      sendHour: 9,
      sendMinute: 15,
      enabled: true,
    });
  });
});

describe("daily_recap dedup key", () => {
  it("rejects a second row for the same (owner_id, recap_day)", async () => {
    const { ownerId, sprintId } = await newOwner();

    await db.insert(dailyRecap).values({
      id: randomUUID(),
      ownerId,
      sprintId,
      recapDay: "2026-08-26",
    });

    // Asserted on the DRIVER error, not on the message: drizzle wraps the pg
    // error and its own message is the failed SQL, so a `toThrow(/uq/)` here
    // would pass for any insert failure — including one caused by a typo in the
    // fixture. The `23505` + constraint name is what proves the DATABASE refused
    // the duplicate.
    const err = await db
      .insert(dailyRecap)
      .values({ id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-26" })
      .then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string; constraint?: string } },
      );

    expect(err).not.toBeNull();
    expect(err?.cause?.code).toBe("23505");
    expect(err?.cause?.constraint).toBe("daily_recap_owner_day_uq");
  });

  it("lets a different day and a different owner through", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await db.insert(dailyRecap).values([
      { id: randomUUID(), ownerId: a.ownerId, sprintId: a.sprintId, recapDay: "2026-08-26" },
      { id: randomUUID(), ownerId: a.ownerId, sprintId: a.sprintId, recapDay: "2026-08-27" },
      { id: randomUUID(), ownerId: b.ownerId, sprintId: b.sprintId, recapDay: "2026-08-26" },
    ]);

    const rows = await db
      .select()
      .from(dailyRecap)
      .where(eq(dailyRecap.ownerId, a.ownerId));
    expect(rows).toHaveLength(2);
    // The claim defaults every new row lands on.
    expect(rows[0].sendStatus).toBe("PENDING");
    expect(rows[0].attemptCount).toBe(0);
  });
});

describe("getLastRecap", () => {
  it("returns null for an owner who has never been sent one", async () => {
    const { ownerId } = await newOwner();
    await expect(getLastRecap({ db, ownerId })).resolves.toBeNull();
  });

  it("returns the newest local day, not the newest insert", async () => {
    const { ownerId, sprintId } = await newOwner();

    // Inserted out of order on purpose: `recap_day` is `YYYY-MM-DD`, so the sort
    // must be on the day key, not on insertion order or `created_at`.
    await db.insert(dailyRecap).values([
      {
        id: randomUUID(),
        ownerId,
        sprintId,
        recapDay: "2026-08-26",
        sendStatus: "SENT",
        sentAt: new Date("2026-08-26T13:00:00.000Z"),
        attemptCount: 1,
      },
      {
        id: randomUUID(),
        ownerId,
        sprintId,
        recapDay: "2026-08-24",
        sendStatus: "FAILED",
        attemptCount: 3,
      },
    ]);

    const last = await getLastRecap({ db, ownerId });
    expect(last).toMatchObject({
      recapDay: "2026-08-26",
      sendStatus: "SENT",
      attemptCount: 1,
    });
  });

  it("does not read another owner's recap", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await db.insert(dailyRecap).values({
      id: randomUUID(),
      ownerId: b.ownerId,
      sprintId: b.sprintId,
      recapDay: "2026-08-26",
      sendStatus: "SENT",
    });

    await expect(getLastRecap({ db, ownerId: a.ownerId })).resolves.toBeNull();
  });
});

describe("DEFAULT_RECAP_SETTINGS", () => {
  it("matches FR-018's stated default of 15:00 local", () => {
    expect(DEFAULT_RECAP_SETTINGS).toEqual({
      sendHour: 15,
      sendMinute: 0,
      enabled: true,
    });
  });
});
