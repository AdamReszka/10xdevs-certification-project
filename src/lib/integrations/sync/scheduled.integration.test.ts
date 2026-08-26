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

/**
 * S-11 — the recap's own `try` is a SIBLING of the sync's, not nested inside it
 * (plan-review F3). Nesting reads naturally as "a third step", and is wrong: a
 * throw from `runOwner` or `runDetect` jumps straight to that catch and the
 * recap is never reached — silencing the day's email for exactly the off-hours
 * lead FR-018 exists for, who cannot see the dashboard's error banner.
 */
describe("runScheduledSync — daily recap", () => {
  const noopSync = vi.fn(async () => ({
    github: { status: "OK" as const },
    jira: { status: "OK" as const },
  })) as unknown as typeof import("@/lib/integrations/sync/run-sync").syncOwner;
  const noopDetect = vi.fn(async () => undefined) as unknown as typeof import("@/lib/anomaly/detect").detectAnomalies;

  function harness() {
    return {
      getDbWithPool: () => ({ db, pool: { end: vi.fn().mockResolvedValue(undefined) } as unknown as Pool }),
      syncOwner: noopSync,
      detectAnomalies: noopDetect,
    };
  }

  it("counts recapsSent and leaves failed at 0 when the transport throws", async () => {
    await seedUser(true);

    const recap = vi.fn(async () => {
      throw new Error("Could not reach Resend. Please try again.");
    }) as unknown as typeof import("@/lib/recap/send").sendDailyRecap;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      sendDailyRecap: recap,
    });

    // A Resend failure is NOT a sync failure (`actions.ts:90-97` is the mirror).
    expect(result.failed).toBe(0);
    expect(result.recapsSent).toBe(0);
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("[recap]");
    errorSpy.mockRestore();
  });

  it("STILL reaches the recap for an owner whose sync threw", async () => {
    const owner = await seedUser(true);

    const throwingSync = vi.fn(async () => {
      throw new Error("GitHub rejected the token (invalid or expired).");
    }) as unknown as typeof import("@/lib/integrations/sync/run-sync").syncOwner;
    const seen: string[] = [];
    const recap = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      seen.push(ownerId);
      return { status: "SENT" as const };
    }) as unknown as typeof import("@/lib/recap/send").sendDailyRecap;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      syncOwner: throwingSync,
      sendDailyRecap: recap,
    });

    // The whole point: an expired PAT or a Hyperdrive blip must not cost the
    // owner their email. Every reader the recap calls is DB-only.
    expect(seen).toContain(owner);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.recapsSent).toBeGreaterThanOrEqual(1);
    errorSpy.mockRestore();
  });

  it("counts only SENT results, not SKIPPED ones", async () => {
    await seedUser(true);

    const recap = vi.fn(async () => ({
      status: "SKIPPED" as const,
      reason: "not_due",
    })) as unknown as typeof import("@/lib/recap/send").sendDailyRecap;

    const result = await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      sendDailyRecap: recap,
    });

    expect(result.recapsSent).toBe(0);
  });
});
