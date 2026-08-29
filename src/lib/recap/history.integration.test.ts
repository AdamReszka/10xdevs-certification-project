import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  dailyRecap,
  jiraCredential,
  jiraProject,
  sprint,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { getRecap, listRecaps } from "@/lib/recap/history";
import type { RecapPayload, RenderedEmail } from "@/lib/recap/types";

/**
 * S-12 Phase 1 — the history readers and the reshaped `sprint_id` FK, against
 * REAL Postgres (local Supabase `:54322`).
 *
 * The `ON DELETE SET NULL` test is the load-bearing one. It asserts a DATABASE
 * referential action, not application logic, which is the only way to prove that
 * a Jira project switch — a delete issued by code that knows nothing about
 * recaps (`connection-service.ts:405-411`) — leaves the archive standing. Under
 * the old CASCADE this test's recap rows would simply be gone.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/** An owner with a Jira project and one sprint, mirroring
 * `recap-settings.integration.test.ts:newOwner`. */
async function newOwner(): Promise<{ ownerId: string; sprintId: string }> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Recap History Test",
    email: `rh-${ownerId}@example.test`,
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
    jiraSprintId: `s12-${sprintId}`,
    name: "Sprint 12",
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

/** A minimal but SHAPE-VALID payload — `schemaVersion` is what the detail page
 * branches on (`recap/types.ts:22-26`), so a stub that omits it would not
 * exercise the column the way the surface reads it. */
function samplePayload(dayKey: string): RecapPayload {
  return {
    schemaVersion: 1,
    generatedAt: `${dayKey}T13:00:00.000Z`,
    dayKey,
    timeZone: "Europe/Warsaw",
    sprint: {
      name: "Sprint 12",
      dayNumber: 3,
      totalDays: 10,
      committedSp: 40,
      remainingSp: 22,
      byCategory: {
        TODO: 2,
        IN_PROGRESS: 3,
        CODE_REVIEW: 1,
        TESTING: 0,
        DONE: 4,
        UNKNOWN: 0,
      },
    },
    activity: {
      commits: 7,
      additions: 210,
      deletions: 40,
      prsOpened: 2,
      prsMerged: 1,
      reviews: 3,
      ticketsMovedToDone: 1,
    },
    syncState: {
      GITHUB: { lastSuccessfulSyncAt: `${dayKey}T12:45:00.000Z`, status: "OK" },
      JIRA: { lastSuccessfulSyncAt: `${dayKey}T12:45:00.000Z`, status: "OK" },
    },
    anomalies: [],
  };
}

function sampleMessage(dayKey: string): RenderedEmail {
  return {
    subject: `SprintFlow recap — ${dayKey}`,
    html: `<html><body><p>Recap for ${dayKey}</p></body></html>`,
    text: `Recap for ${dayKey}`,
  };
}

describe("daily_recap.sprint_id ON DELETE SET NULL", () => {
  it("keeps the recaps and nulls the sprint when the sprint row is deleted", async () => {
    const { ownerId, sprintId } = await newOwner();

    await db.insert(dailyRecap).values([
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-24", sendStatus: "SENT" },
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-25", sendStatus: "SENT" },
    ]);

    // Exactly what a Jira PROJECT SWITCH does to the owner's sprint rows.
    await db.delete(sprint).where(eq(sprint.id, sprintId));

    const rows = await db
      .select()
      .from(dailyRecap)
      .where(eq(dailyRecap.ownerId, ownerId));

    // Under the pre-0019 CASCADE this would be 0 — the archive destroyed by a
    // product action that has nothing to do with recaps.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sprintId === null)).toBe(true);
  });
});

describe("listRecaps", () => {
  it("returns the owner's recaps newest local day first", async () => {
    const { ownerId, sprintId } = await newOwner();

    // Inserted out of order on purpose: the sort must be on `recap_day`, not on
    // insertion order or `created_at`.
    await db.insert(dailyRecap).values([
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-24", sendStatus: "SENT" },
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-26", sendStatus: "FAILED" },
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-25", sendStatus: "SENT" },
    ]);

    const rows = await listRecaps(db, ownerId);

    expect(rows.map((row) => row.recapDay)).toEqual([
      "2026-08-26",
      "2026-08-25",
      "2026-08-24",
    ]);
    // Every row, not only the successful ones — a failed send is the most
    // valuable thing on this list.
    expect(rows[0].sendStatus).toBe("FAILED");
  });

  it("marks whether the frozen bytes are present without pulling them", async () => {
    const { ownerId, sprintId } = await newOwner();

    await db.insert(dailyRecap).values([
      {
        id: randomUUID(),
        ownerId,
        sprintId,
        recapDay: "2026-08-26",
        sendStatus: "SENT",
        payload: samplePayload("2026-08-26"),
        renderedMessage: sampleMessage("2026-08-26"),
      },
      // The state `send.ts:223-231` leaves forever on a row that failed at the
      // recipient check: no payload, no rendered message.
      { id: randomUUID(), ownerId, sprintId, recapDay: "2026-08-25", sendStatus: "FAILED" },
    ]);

    const rows = await listRecaps(db, ownerId);

    expect(rows[0].hasRenderedMessage).toBe(true);
    expect(rows[1].hasRenderedMessage).toBe(false);
    // The list projection must not carry the JSONB itself.
    expect(rows[0]).not.toHaveProperty("renderedMessage");
    expect(rows[0]).not.toHaveProperty("payload");
  });

  it("is owner-scoped", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await db.insert(dailyRecap).values([
      {
        id: randomUUID(),
        ownerId: b.ownerId,
        sprintId: b.sprintId,
        recapDay: "2026-08-26",
        sendStatus: "SENT",
      },
      {
        id: randomUUID(),
        ownerId: a.ownerId,
        sprintId: a.sprintId,
        recapDay: "2026-08-25",
        sendStatus: "SENT",
      },
    ]);

    const rows = await listRecaps(db, a.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].recapDay).toBe("2026-08-25");
  });

  it("honours its limit, keeping the newest days", async () => {
    const { ownerId, sprintId } = await newOwner();

    await db.insert(dailyRecap).values(
      ["2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25"].map((recapDay) => ({
        id: randomUUID(),
        ownerId,
        sprintId,
        recapDay,
        sendStatus: "SENT" as const,
      })),
    );

    const rows = await listRecaps(db, ownerId, 2);
    expect(rows.map((row) => row.recapDay)).toEqual(["2026-08-25", "2026-08-24"]);
  });

  it("returns an empty list for an owner who has never been sent one", async () => {
    const { ownerId } = await newOwner();
    await expect(listRecaps(db, ownerId)).resolves.toEqual([]);
  });
});

describe("getRecap", () => {
  it("returns the full row including the payload and the frozen bytes", async () => {
    const { ownerId, sprintId } = await newOwner();
    const id = randomUUID();

    await db.insert(dailyRecap).values({
      id,
      ownerId,
      sprintId,
      recapDay: "2026-08-26",
      sendStatus: "SENT",
      sentAt: new Date("2026-08-26T13:00:00.000Z"),
      attemptCount: 1,
      payload: samplePayload("2026-08-26"),
      renderedMessage: sampleMessage("2026-08-26"),
      anomalyIds: ["a-1", "a-2"],
    });

    const row = await getRecap(db, ownerId, id);

    expect(row).not.toBeNull();
    expect(row?.recapDay).toBe("2026-08-26");
    expect(row?.payload?.schemaVersion).toBe(1);
    expect(row?.payload?.sprint.name).toBe("Sprint 12");
    expect(row?.renderedMessage?.subject).toBe("SprintFlow recap — 2026-08-26");
    expect(row?.anomalyIds).toEqual(["a-1", "a-2"]);
    expect(row?.hasRenderedMessage).toBe(true);
  });

  it("returns null for another owner's recap id", async () => {
    const a = await newOwner();
    const b = await newOwner();
    const id = randomUUID();

    await db.insert(dailyRecap).values({
      id,
      ownerId: b.ownerId,
      sprintId: b.sprintId,
      recapDay: "2026-08-26",
      sendStatus: "SENT",
      renderedMessage: sampleMessage("2026-08-26"),
    });

    // Identical to the missing-id result below, on purpose: distinguishing them
    // would confirm the row exists to someone who cannot read it.
    await expect(getRecap(db, a.ownerId, id)).resolves.toBeNull();
  });

  it("returns null for an id that does not exist", async () => {
    const { ownerId } = await newOwner();
    await expect(getRecap(db, ownerId, randomUUID())).resolves.toBeNull();
  });

  it("tolerates a row whose payload and rendered_message are NULL", async () => {
    const { ownerId, sprintId } = await newOwner();
    const id = randomUUID();

    // The claim row `send.ts:143-155` writes before the render-persist, and the
    // permanent state of a row that failed at the recipient check.
    await db.insert(dailyRecap).values({
      id,
      ownerId,
      sprintId,
      recapDay: "2026-08-26",
      sendStatus: "FAILED",
      attemptCount: 3,
    });

    const row = await getRecap(db, ownerId, id);

    expect(row).not.toBeNull();
    expect(row?.payload).toBeNull();
    expect(row?.renderedMessage).toBeNull();
    expect(row?.anomalyIds).toBeNull();
    expect(row?.hasRenderedMessage).toBe(false);
    expect(row?.sendStatus).toBe("FAILED");
  });
});
