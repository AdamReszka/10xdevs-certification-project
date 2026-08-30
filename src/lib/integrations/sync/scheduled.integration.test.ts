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

/** A user with NO integration at all — the only shape the cycle must skip. */
async function seedBareUser(): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({ id: ownerId, name: "Bare", email: `bare-${ownerId}@example.test` });
  owners.push(ownerId);
  return ownerId;
}

/** Jira connected, GitHub not — what an owner looks like after S-26's
 *  "Keep my GitHub data" disconnect, or while a PAT is being rotated. */
async function seedJiraOnlyUser(): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({ id: ownerId, name: "Jira", email: `jo-${ownerId}@example.test` });
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
  owners.push(ownerId);
  return ownerId;
}

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
  it("returns an owner with EITHER integration, and skips one with neither", async () => {
    const both = await seedUser(true);
    const ghOnly = await seedUser(false);
    const bare = await seedBareUser();

    const result = await enumerateOnboardedOwners(db);

    expect(result).toContain(both);
    expect(result).toContain(ghOnly);
    expect(result).not.toContain(bare);
  });

  /**
   * S-26 impl-review F3. This used to require BOTH integrations, so a lead who
   * disconnected GitHub — now an advertised, reversible, "keep my data" act —
   * silently lost their JIRA sync too: no anomaly refresh and no daily recap,
   * with nothing saying so. The Jira half must keep running on its own.
   */
  it("keeps syncing an owner whose GitHub is disconnected but whose Jira is not", async () => {
    const jiraOnly = await seedJiraOnlyUser();

    const result = await enumerateOnboardedOwners(db);

    expect(result).toContain(jiraOnly);
  });

  /**
   * S-09 / FR-008. `demo_of IS NULL` is now the ONLY thing excluding a demo
   * owner, and this test is what holds it there. The old argument — that
   * `github_commit → monitored_repo → github_credential` is NOT NULL end to end,
   * so a demo owner necessarily matches — was falsified twice over: `0021` made
   * `monitored_repo.credential_id` nullable, and the enumeration now admits an
   * owner holding EITHER side alone. Without the explicit filter this loop would
   * sync a fictional account with a fake token every 15 minutes and hand it to
   * `sendDailyRecap`.
   */
  it("excludes a demo owner even though it has both a jira project and a github credential", async () => {
    const real = await seedUser(true);
    const demo = await seedUser(true);
    await db.update(user).set({ demoOf: real }).where(eq(user.id, demo));

    const result = await enumerateOnboardedOwners(db);

    expect(result).toContain(real);
    expect(result).not.toContain(demo);
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

  it("STILL sweeps the measurement record for an owner whose sync threw", async () => {
    // S-23 Phase 4. A sprint that closed while the Jira token was expired must
    // be recorded once the token is fixed — the sweep's whole reason for
    // existing is that a rollover missed is a sprint lost forever, and the sync
    // is exactly what is broken at the moment that matters most.
    const owner = await seedUser(true);

    const throwingSync = vi.fn(async () => {
      throw new Error("Jira rejected the token (invalid or expired).");
    }) as unknown as typeof import("@/lib/integrations/sync/run-sync").syncOwner;
    const swept: string[] = [];
    const sweep = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      swept.push(ownerId);
      return { upserted: 0, finalized: 0 };
    }) as unknown as typeof import("@/lib/measurement/sweep").sweepSprintMeasurements;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      syncOwner: throwingSync,
      sweepSprintMeasurements: sweep,
    });

    expect(swept).toContain(owner);
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

/**
 * S-12 — the retention purge is a FOURTH sibling `try`, and it is the repo's
 * first irreversible deletion. Two things follow: it must not be able to take
 * the cycle down, and it must run last, so a recap written this cycle is never a
 * candidate for the delete that follows it.
 */
describe("runScheduledSync — retention purge", () => {
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

  it("leaves synced, failed and recapsSent untouched when the purge throws", async () => {
    await seedUser(true);

    const recap = vi.fn(async () => ({ status: "SENT" as const })) as unknown as typeof import("@/lib/recap/send").sendDailyRecap;
    const purge = vi.fn(async () => {
      throw new Error("delete blew up");
    }) as unknown as typeof import("@/lib/recap/retention").purgeOldRecaps;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      sendDailyRecap: recap,
      purgeOldRecaps: purge,
    });

    // A purge failure is nobody else's failure. Above all the email already went
    // out this cycle and must stay counted.
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
    expect(result.recapsSent).toBeGreaterThanOrEqual(1);
    expect(result.recapsPurged).toBe(0);
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("retention purge failed");
    errorSpy.mockRestore();
  });

  it("runs the purge AFTER the recap send and totals what it deleted", async () => {
    const owner = await seedUser(true);

    // Scoped to OUR owner: the local database holds other onboarded accounts,
    // and the loop visits every one of them.
    const order: string[] = [];
    const recap = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      if (ownerId === owner) order.push("recap");
      return { status: "SENT" as const };
    }) as unknown as typeof import("@/lib/recap/send").sendDailyRecap;
    const purge = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      if (ownerId !== owner) return { cutoff: null, deleted: 0 };
      order.push("purge");
      return { cutoff: "2026-07-20", deleted: 4 };
    }) as unknown as typeof import("@/lib/recap/retention").purgeOldRecaps;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      sendDailyRecap: recap,
      purgeOldRecaps: purge,
    });

    // Ordering is load-bearing, not incidental: today's recap must exist before
    // the delete runs, never the other way round.
    expect(order).toEqual(["recap", "purge"]);
    expect(result.recapsPurged).toBe(4);
    // The cycle's own result is discarded by `worker.ts:46`, so this log line is
    // the only thing an operator can see of the deletion.
    expect(JSON.stringify(infoSpy.mock.calls)).toContain("2026-07-20");
    infoSpy.mockRestore();
  });

  it("STILL purges for an owner whose sync threw", async () => {
    const owner = await seedUser(true);

    const throwingSync = vi.fn(async () => {
      throw new Error("Jira rejected the token (invalid or expired).");
    }) as unknown as typeof import("@/lib/integrations/sync/run-sync").syncOwner;
    const purged: string[] = [];
    const purge = vi.fn(async ({ ownerId }: { ownerId: string }) => {
      purged.push(ownerId);
      return { cutoff: null, deleted: 0 };
    }) as unknown as typeof import("@/lib/recap/retention").purgeOldRecaps;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runScheduledSync({}, { waitUntil: vi.fn() }, {
      ...harness(),
      syncOwner: throwingSync,
      purgeOldRecaps: purge,
    });

    // Retention is DB-only, like the sweep: an expired token is no reason to let
    // an owner's archive grow past its bound indefinitely.
    expect(purged).toContain(owner);
    errorSpy.mockRestore();
  });
});
