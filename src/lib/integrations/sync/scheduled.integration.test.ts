import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  user,
} from "@/db/schema";
import {
  enumerateOnboardedOwners,
  runScheduledSync,
} from "@/lib/integrations/sync/scheduled";

/**
 * S-05 Phase 5 — scheduled loop integration tests against REAL Postgres. Verifies
 * the set-based onboarded-owner enumeration, per-owner error isolation, and pool
 * teardown scheduling. `syncOwner` + the pool are injected so the loop mechanics
 * are exercised without real network or a real Workers runtime.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/** Seed a user; `onboarded` adds the jira credential+project that the
 * enumeration join requires (a github-credential-only owner is NOT onboarded). */
async function seedUser(onboarded: boolean): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({ id: ownerId, name: "Sched", email: `sc-${ownerId}@example.test` });
  await db.insert(githubCredential).values({
    id: randomUUID(),
    ownerId,
    encryptedToken: "x",
    tokenLast4: "1234",
    githubLogin: "lead",
  });
  if (onboarded) {
    const [cred] = await db
      .insert(jiraCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken: "x",
        tokenLast4: "1234",
        workspaceUrl: "https://acme.atlassian.net",
        jiraEmail: "lead@example.com",
      })
      .returning({ id: jiraCredential.id });
    await db.insert(jiraProject).values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: "1",
      projectKey: "SF",
    });
  }
  owners.push(ownerId);
  return ownerId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("enumerateOnboardedOwners", () => {
  it("returns only owners with BOTH a jira project and a github credential", async () => {
    const onboarded = await seedUser(true);
    const ghOnly = await seedUser(false);

    const result = await enumerateOnboardedOwners(db);

    expect(result).toContain(onboarded);
    expect(result).not.toContain(ghOnly);
  });
});

describe("runScheduledSync", () => {
  it("syncs each onboarded owner, isolates a per-owner throw, and schedules pool teardown", async () => {
    const a = await seedUser(true);
    const b = await seedUser(true);

    const endSpy = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();
    const seen: string[] = [];

    const fakeSyncOwner = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      seen.push(ownerId);
      if (ownerId === b) throw new Error("boom for b");
      return { github: { status: "OK" as const }, jira: { status: "OK" as const } };
    });

    const result = await runScheduledSync(
      {},
      { waitUntil },
      {
        getDbWithPool: () => ({ db, pool: { end: endSpy } as unknown as Pool }),
        syncOwner: fakeSyncOwner as unknown as typeof import("@/lib/integrations/sync/run-sync").syncOwner,
      },
    );

    // Both onboarded owners were attempted; the throw for b didn't abort a.
    expect(seen).toContain(a);
    expect(seen).toContain(b);
    expect(result.enumerated).toBeGreaterThanOrEqual(2);
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    // Pool teardown was scheduled on the execution context.
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
