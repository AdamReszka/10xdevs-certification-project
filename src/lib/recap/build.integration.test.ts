import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  anomaly,
  jiraCredential,
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  sprint,
  teamMember,
  user,
  type InsertAnomaly,
  type SelectSprint,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { listAnomaliesForSprint } from "@/lib/anomaly/reader";
import { getTicketsMovedToDone } from "@/lib/dashboard/activity-done";
import { buildRecapPayload } from "@/lib/recap/build";

/**
 * S-11 Phase 4 — the recap payload builder and the "moved to Done" reader against
 * REAL Postgres (local Supabase `:54322`).
 *
 * The load-bearing assertion is the ANTI-DIVERGENCE one: the anomaly list the
 * email carries must be the same list, in the same order, with byte-identical
 * suggested actions, as `listAnomaliesForSprint` — the reader the Anomaly Inbox
 * renders. That contract was written at S-06 time
 * (`suggested-action.ts:6-7`) and this is the test that holds it.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const NOW = new Date("2026-08-26T13:00:00.000Z");
const TIME_ZONE = "Europe/Warsaw";

const owners: string[] = [];

async function newOwner(): Promise<{
  ownerId: string;
  sprintRow: SelectSprint;
  jiraProjectId: string;
}> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Recap Build Test",
    email: `rb-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_BuildTokenABCDEFGH1234", {
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
      timeZone: TIME_ZONE,
    })
    .returning({ id: jiraProject.id });

  const [sprintRow] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: project.id,
      jiraSprintId: `s11-${randomUUID()}`,
      name: "Sprint 11",
      state: "ACTIVE",
      startDate: new Date("2026-08-20T06:00:00.000Z"),
      endDate: new Date("2026-09-02T06:00:00.000Z"),
      committedSp: 34,
    })
    .returning();

  return { ownerId, sprintRow, jiraProjectId: project.id };
}

function anomalyRow(
  ownerId: string,
  sprintId: string,
  over: Partial<InsertAnomaly>,
): InsertAnomaly {
  return {
    id: randomUUID(),
    ownerId,
    sprintId,
    dedupKey: randomUUID(),
    type: "PR_TOO_BIG",
    severity: "MEDIUM",
    status: "ACTIVE",
    detectedAt: new Date("2026-08-26T09:00:00.000Z"),
    description: "PR #7 changes 900 lines",
    suggestedAction: "Ask the author to split PR #7",
    sourceUrl: "https://github.test/acme/app/pull/7",
    riskScore: 50,
    context: { number: 7 },
    ...over,
  };
}

/** A ticket plus one status transition into `DONE` at `changedAt`. */
async function seedDoneTicket(
  ownerId: string,
  jiraProjectId: string,
  sprintId: string,
  jiraKey: string,
  changedAt: Date,
  toCategory: "DONE" | "TESTING" = "DONE",
): Promise<string> {
  const ticketId = randomUUID();
  await db.insert(jiraTicket).values({
    id: ticketId,
    ownerId,
    jiraProjectId,
    sprintId,
    jiraKey,
    summary: "Something",
  });
  await db.insert(jiraStatusHistory).values({
    id: randomUUID(),
    ownerId,
    ticketId,
    toCategory,
    changedAt,
    // NOT NULL and half of the dedup key (lessons.md #1) — a null here would
    // defeat the very constraint that stops S-05's incremental upsert from
    // duplicating rows.
    jiraChangelogId: randomUUID(),
  });
  return ticketId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("getTicketsMovedToDone", () => {
  // Yesterday, 2026-08-25, in Warsaw (UTC+2 in August).
  const range = {
    from: new Date("2026-08-24T22:00:00.000Z"),
    to: new Date("2026-08-25T21:59:59.999Z"),
  };

  it("counts the owner's DONE transitions inside the window", async () => {
    const { ownerId, sprintRow, jiraProjectId } = await newOwner();

    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-1", new Date("2026-08-25T10:00:00.000Z"));
    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-2", new Date("2026-08-25T16:00:00.000Z"));
    // Outside the window and a non-DONE transition — neither counts.
    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-3", new Date("2026-08-26T10:00:00.000Z"));
    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-4", new Date("2026-08-25T11:00:00.000Z"), "TESTING");

    await expect(getTicketsMovedToDone(db, ownerId, range)).resolves.toBe(2);
  });

  it("is OWNER-SCOPED — a second owner's transitions are not counted", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await seedDoneTicket(b.ownerId, b.jiraProjectId, b.sprintRow.id, "SF-9", new Date("2026-08-25T10:00:00.000Z"));

    // App-enforced cross-account isolation — there is no RLS behind this reader.
    await expect(getTicketsMovedToDone(db, a.ownerId, range)).resolves.toBe(0);
    await expect(getTicketsMovedToDone(db, b.ownerId, range)).resolves.toBe(1);
  });
});

describe("buildRecapPayload", () => {
  it("carries the SAME anomalies, in the same order, as listAnomaliesForSprint", async () => {
    const { ownerId, sprintRow } = await newOwner();

    await db.insert(anomaly).values([
      anomalyRow(ownerId, sprintRow.id, {
        severity: "MEDIUM",
        description: "medium one",
        suggestedAction: "Do the medium thing",
        detectedAt: new Date("2026-08-26T10:00:00.000Z"),
      }),
      anomalyRow(ownerId, sprintRow.id, {
        severity: "HIGH",
        description: "high one",
        suggestedAction: "Do the high thing",
        detectedAt: new Date("2026-08-26T11:00:00.000Z"),
      }),
      anomalyRow(ownerId, sprintRow.id, {
        severity: "LOW",
        description: "low one",
        suggestedAction: "Do the low thing",
      }),
      // RESOLVED rows belong to neither surface.
      anomalyRow(ownerId, sprintRow.id, { status: "RESOLVED", description: "resolved one" }),
    ]);

    const rows = await listAnomaliesForSprint(db, ownerId, sprintRow.id);
    const payload = await buildRecapPayload({
      db,
      ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: sprintRow,
    });

    expect(payload.anomalies.map((a) => a.id)).toEqual(rows.map((r) => r.id));
    expect(payload.anomalies.map((a) => a.severity)).toEqual(["HIGH", "MEDIUM", "LOW"]);
    // THE anti-divergence assertion: the action string is copied off the row,
    // never regenerated. A recap that rebuilt it would need detection-time `now`,
    // which is gone by the time this runs.
    expect(payload.anomalies.map((a) => a.suggestedAction)).toEqual(
      rows.map((r) => r.suggestedAction),
    );
    expect(payload.anomalies.map((a) => a.description)).toEqual(
      rows.map((r) => r.description),
    );
    expect(payload.anomalies.map((a) => a.sourceUrl)).toEqual(rows.map((r) => r.sourceUrl));
  });

  it("resolves the member name for an attributed anomaly", async () => {
    const { ownerId, sprintRow } = await newOwner();
    const memberId = randomUUID();
    await db.insert(teamMember).values({
      id: memberId,
      ownerId,
      name: "Mia Krystof",
      githubUsername: "mia",
      source: "GITHUB",
    });
    await db.insert(anomaly).values(
      anomalyRow(ownerId, sprintRow.id, {
        type: "DEVELOPER_INACTIVE",
        sourceUrl: null,
        relatedTeamMemberId: memberId,
        context: { noCommitDays: 3 },
      }),
    );

    const payload = await buildRecapPayload({
      db,
      ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: sprintRow,
    });

    expect(payload.anomalies[0].memberName).toBe("Mia Krystof");
    // The no-deep-link branch reaches the payload as a real null, not "".
    expect(payload.anomalies[0].sourceUrl).toBeNull();
  });

  it("folds yesterday's Done transitions into the activity summary", async () => {
    const { ownerId, sprintRow, jiraProjectId } = await newOwner();
    // 2026-08-25 in Warsaw.
    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-1", new Date("2026-08-25T10:00:00.000Z"));
    await seedDoneTicket(ownerId, jiraProjectId, sprintRow.id, "SF-2", new Date("2026-08-25T18:00:00.000Z"));

    const payload = await buildRecapPayload({
      db,
      ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: sprintRow,
    });

    expect(payload.activity.ticketsMovedToDone).toBe(2);
  });

  it("carries sprint metadata, the day key and the zone", async () => {
    const { ownerId, sprintRow } = await newOwner();

    const payload = await buildRecapPayload({
      db,
      ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: sprintRow,
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.dayKey).toBe("2026-08-26");
    expect(payload.timeZone).toBe(TIME_ZONE);
    expect(payload.sprint.name).toBe("Sprint 11");
    expect(payload.sprint.committedSp).toBe(34);
    // 2026-08-20 → 2026-09-02 inclusive is 14 local days; today is the 7th.
    expect(payload.sprint.totalDays).toBe(14);
    expect(payload.sprint.dayNumber).toBe(7);
  });

  it("NEVER carries lastError into the payload", async () => {
    const { ownerId, sprintRow } = await newOwner();

    const payload = await buildRecapPayload({
      db,
      ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: sprintRow,
    });

    // Same reason `InboxIntegrationState` withholds it from the client: it is
    // operator text that can echo a third-party response.
    expect(Object.keys(payload.syncState.GITHUB)).toEqual([
      "lastSuccessfulSyncAt",
      "status",
    ]);
    expect(JSON.stringify(payload)).not.toContain("lastError");
  });

  it("does not read another owner's anomalies", async () => {
    const a = await newOwner();
    const b = await newOwner();

    await db
      .insert(anomaly)
      .values(anomalyRow(b.ownerId, b.sprintRow.id, { description: "belongs to B" }));

    const payload = await buildRecapPayload({
      db,
      ownerId: a.ownerId,
      now: NOW,
      timeZone: TIME_ZONE,
      sprint: a.sprintRow,
    });

    expect(payload.anomalies).toHaveLength(0);
  });
});
