import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  anomaly,
  jiraCredential,
  jiraProject,
  sprint,
  user,
  type InsertAnomaly,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { listAnomaliesForSprint } from "@/lib/anomaly/reader";

/**
 * S-06 Phase 4 — `listAnomaliesForSprint` default ordering + ACTIVE-only filter
 * against real Postgres. Guards the FR-015 default order (severity HIGH→MEDIUM→LOW,
 * then detectedAt desc) and that RESOLVED rows are excluded.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

async function seedOwnerSprint(): Promise<{ ownerId: string; sprintId: string }> {
  const ownerId = randomUUID();
  await db
    .insert(user)
    .values({ id: ownerId, name: "Lead", email: `lead-${ownerId}@example.test` });
  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_ReaderToken1234", { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });
  const [proj] = await db
    .insert(jiraProject)
    .values({ id: randomUUID(), ownerId, credentialId: cred.id, jiraProjectId: "1", projectKey: "SF" })
    .returning({ id: jiraProject.id });
  const [spr] = await db
    .insert(sprint)
    .values({ id: randomUUID(), ownerId, jiraProjectId: proj.id, jiraSprintId: "1", state: "ACTIVE" })
    .returning({ id: sprint.id });
  return { ownerId, sprintId: spr.id };
}

function row(
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
    detectedAt: new Date("2026-08-10T12:00:00.000Z"),
    description: "d",
    suggestedAction: "a",
    riskScore: 50,
    ...over,
  };
}

const owners: string[] = [];
afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("listAnomaliesForSprint", () => {
  it("orders by severity (HIGH→MEDIUM→LOW) then recency, ACTIVE only", async () => {
    const { ownerId, sprintId } = await seedOwnerSprint();
    owners.push(ownerId);

    await db.insert(anomaly).values([
      row(ownerId, sprintId, {
        severity: "MEDIUM",
        dedupKey: "med",
        detectedAt: new Date("2026-08-10T10:00:00.000Z"),
      }),
      row(ownerId, sprintId, {
        severity: "HIGH",
        dedupKey: "high-old",
        detectedAt: new Date("2026-08-09T10:00:00.000Z"),
      }),
      row(ownerId, sprintId, {
        severity: "HIGH",
        dedupKey: "high-new",
        detectedAt: new Date("2026-08-10T11:00:00.000Z"),
      }),
      row(ownerId, sprintId, { severity: "LOW", dedupKey: "low" }),
      row(ownerId, sprintId, {
        severity: "HIGH",
        dedupKey: "resolved",
        status: "RESOLVED",
      }),
    ]);

    const out = await listAnomaliesForSprint(db, ownerId, sprintId);
    expect(out.map((r) => r.severity)).toEqual(["HIGH", "HIGH", "MEDIUM", "LOW"]);
    // Within HIGH, newer detectedAt first.
    expect(out[0].detectedAt?.toISOString()).toBe("2026-08-10T11:00:00.000Z");
    // RESOLVED excluded.
    expect(out).toHaveLength(4);
    // S-07 widening: dedupKey is projected as a stable identity/sort-key fallback.
    expect(out.every((r) => typeof r.dedupKey === "string" && r.dedupKey.length > 0)).toBe(
      true,
    );
    expect(out[0].dedupKey).toBe("high-new");
  });
});
