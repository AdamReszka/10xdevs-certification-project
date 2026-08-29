import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq, getTableColumns, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { anomaly, githubCredential, jiraCredential, user } from "@/db/schema";
import { detectAnomalies } from "@/lib/anomaly/detect";
import { encryptToken } from "@/lib/crypto";
import { loadDemo, resetDemo } from "@/lib/demo/load";
import { findDemoOwner } from "@/lib/workspace";

/**
 * S-09 Phase 2 — the demo world's lifecycle against REAL Postgres.
 *
 * Four properties, each of which the plan calls out as load-bearing:
 *  - the demo's anomalies come from the ENGINE, not from fixture literals, and
 *    there are enough distinct types for US-02's tour to land;
 *  - re-detecting at the anchor is a no-op, which is what makes demo anomalies
 *    survive every reconcile (cron, "Sync now", an absence save);
 *  - reset removes the demo world exactly, across every owner-scoped table;
 *  - and reset can reach NOTHING outside it — the safety property, asserted on
 *    an account that holds real credentials.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

/** The anchor is passed in rather than taken from the clock — the demo freezes
 * whatever instant it was loaded at, so the test picks one. */
const ANCHOR = new Date("2026-08-26T09:30:00.000Z");

const owners: string[] = [];

async function seedRealOwner(): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Lead",
    email: `demo-lifecycle-${ownerId}@example.test`,
  });
  owners.push(ownerId);
  return ownerId;
}

afterEach(async () => {
  // Deleting the real owner cascades its demo away too.
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

/**
 * Every product table scoped by `owner_id`, discovered from the schema module
 * rather than hand-listed: a table added later must not silently escape the
 * reset assertion below.
 */
function ownerScopedTables(): { name: string; table: PgTable }[] {
  const out: { name: string; table: PgTable }[] = [];
  for (const [name, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;
    const columns = getTableColumns(value as PgTable);
    if ("ownerId" in columns) out.push({ name, table: value as PgTable });
  }
  return out;
}

describe("loadDemo", () => {
  it("produces engine-written anomalies of at least four distinct types", async () => {
    const realOwnerId = await seedRealOwner();

    const result = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const rows = await db
      .select({ type: anomaly.type, status: anomaly.status })
      .from(anomaly)
      .where(eq(anomaly.ownerId, result.demoOwnerId));

    const active = rows.filter((r) => r.status === "ACTIVE");
    const types = new Set(active.map((r) => r.type));

    expect(types.size).toBeGreaterThanOrEqual(4);
    expect(result.anomaliesDetected).toBe(active.length);
  });

  it("creates a demo owner that is anchored and cannot be signed into", async () => {
    const realOwnerId = await seedRealOwner();

    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const demoOwner = await findDemoOwner(db, realOwnerId);
    expect(demoOwner?.id).toBe(demoOwnerId);
    expect(demoOwner?.demoAnchorAt?.getTime()).toBe(ANCHOR.getTime());

    // No `account` row means no password and no provider identity — the demo
    // owner is a data scope, not a user.
    const accounts = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(eq(schema.account.userId, demoOwnerId));
    expect(accounts).toHaveLength(0);
  });

  it("is idempotent — a second load replaces the first", async () => {
    const realOwnerId = await seedRealOwner();

    const first = await loadDemo({ db, realOwnerId, now: ANCHOR });
    const second = await loadDemo({ db, realOwnerId, now: ANCHOR });

    expect(second.demoOwnerId).not.toBe(first.demoOwnerId);

    const demoOwners = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.demoOf, realOwnerId));
    expect(demoOwners.map((r) => r.id)).toEqual([second.demoOwnerId]);
  });

  /**
   * The frame's dimension-4 regression guard. Hand-written demo anomalies were
   * flipped to RESOLVED by the next reconcile; because both the fixture and the
   * clock are frozen, the engine now re-derives exactly the same set.
   */
  it("re-detecting at the anchor resolves nothing and inserts nothing", async () => {
    const realOwnerId = await seedRealOwner();
    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const before = await db
      .select({ id: anomaly.id, dedupKey: anomaly.dedupKey, detectedAt: anomaly.detectedAt })
      .from(anomaly)
      .where(eq(anomaly.ownerId, demoOwnerId));

    const again = await detectAnomalies({ db, ownerId: demoOwnerId, now: ANCHOR });

    expect(again.status).toBe("ok");
    if (again.status !== "ok") return;
    expect(again.resolved).toBe(0);
    expect(again.inserted).toBe(0);
    expect(again.updated).toBe(before.length);

    const after = await db
      .select({ id: anomaly.id, dedupKey: anomaly.dedupKey, detectedAt: anomaly.detectedAt })
      .from(anomaly)
      .where(eq(anomaly.ownerId, demoOwnerId));

    // Same rows, same ids, same detection clock — the FR-015 recency signal is
    // stable, so the inbox copy does not age between views.
    expect(sortByKey(after)).toEqual(sortByKey(before));
  });
});

describe("loadDemo — the two screens that must not call out", () => {
  it("saves a refinement run carrying both a DOR_MET verdict and one with gaps", async () => {
    const realOwnerId = await seedRealOwner();
    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const [run] = await db
      .select()
      .from(schema.refinementRun)
      .where(eq(schema.refinementRun.ownerId, demoOwnerId));
    expect(run).toBeDefined();
    // Recorded for legibility: a verdict is only interpretable against the model
    // that produced it, and the demo's were produced by nothing at all.
    expect(run.model).toBe("claude-sonnet-5");

    const verdicts = await db
      .select()
      .from(schema.refinementTicketVerdict)
      .where(eq(schema.refinementTicketVerdict.ownerId, demoOwnerId));

    // FR-020's BOTH halves: a mechanism that only ever finds gaps is as useless
    // as one that only ever rephrases, so the demo has to show it can say
    // "this ticket is ready".
    expect(verdicts.map((v) => v.verdict).sort()).toEqual([
      "DOR_MET",
      "GAPS",
      "NOT_VIABLE",
    ]);
    const withGaps = verdicts.find((v) => v.verdict === "GAPS");
    expect(withGaps!.gaps.length).toBeGreaterThan(0);
    // Grounded in the ticket's own content, per FR-020 — not a generic DOR question.
    expect(withGaps!.gaps[0].groundingClause).toContain("regulamin");
    expect(verdicts.find((v) => v.verdict === "DOR_MET")!.gaps).toEqual([]);
  });

  it("saves a recap HISTORY: five terminal rows on distinct days, exactly one FAILED", async () => {
    const realOwnerId = await seedRealOwner();
    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const recaps = await db
      .select()
      .from(schema.dailyRecap)
      .where(eq(schema.dailyRecap.ownerId, demoOwnerId));

    // S-12: one row proves the page renders; a list is what US-02 asks the demo
    // to show in one sitting.
    expect(recaps).toHaveLength(5);

    // Load-bearing TWICE (S-11 plan-review F5): it keeps the rows out of the
    // sender's reach, AND it keeps the one browser clock in the tree —
    // `classifyRecapSend` compares Date.now() on the PENDING branch alone — out
    // of the demo. A PENDING demo recap would be a frozen-clock regression.
    for (const recap of recaps) {
      expect(recap.sendStatus).not.toBe("PENDING");
      // Legible rather than blank: the FAILED row keeps its payload and its
      // frozen bytes too, so the drill-in has something to show.
      expect(recap.payload).not.toBeNull();
      expect(recap.renderedMessage?.subject).toBeTruthy();
    }

    // A failed send is the most valuable thing on the archive — it is what the
    // list exists to let the lead notice.
    expect(recaps.filter((r) => r.sendStatus === "FAILED")).toHaveLength(1);

    // `daily_recap_owner_day_uq(owner_id, recap_day)` would reject a repeat, so
    // this asserts the fixture's day offsets are genuinely distinct rather than
    // relying on the insert to have failed loudly.
    expect(new Set(recaps.map((r) => r.recapDay)).size).toBe(5);

    // A FAILED row never left, so it has no `sent_at`. Handing it one would make
    // the history list's timestamp column lie.
    expect(recaps.find((r) => r.sendStatus === "FAILED")!.sentAt).toBeNull();
  });
});

describe("resetDemo", () => {
  it("leaves zero rows for the demo owner across every owner-scoped table", async () => {
    const realOwnerId = await seedRealOwner();
    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const tables = ownerScopedTables();
    // Sanity: the discovery above must actually find the product tables, or the
    // assertion below would pass vacuously.
    expect(tables.length).toBeGreaterThan(10);

    const removed = await resetDemo({ db, realOwnerId });
    expect(removed).toBe(true);

    for (const { name, table } of tables) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .where(sql`owner_id = ${demoOwnerId}`);
      expect(`${name}=${row.count}`).toBe(`${name}=0`);
    }

    const demoUser = await db.select({ id: user.id }).from(user).where(eq(user.id, demoOwnerId));
    expect(demoUser).toHaveLength(0);
  });

  it("takes the whole recap archive with it", async () => {
    // S-12 named explicitly rather than left to the sweep above: the archive is
    // the one demo surface whose row COUNT grew, and FR-008's "reset returns the
    // user to the uninitialized state" has to hold for all five, not for the one
    // the fixture used to write.
    const realOwnerId = await seedRealOwner();
    const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });

    const before = await db
      .select()
      .from(schema.dailyRecap)
      .where(eq(schema.dailyRecap.ownerId, demoOwnerId));
    expect(before).toHaveLength(5);

    expect(await resetDemo({ db, realOwnerId })).toBe(true);

    const after = await db
      .select()
      .from(schema.dailyRecap)
      .where(eq(schema.dailyRecap.ownerId, demoOwnerId));
    expect(after).toHaveLength(0);
  });

  it("reports false when there is no demo to remove", async () => {
    const realOwnerId = await seedRealOwner();
    expect(await resetDemo({ db, realOwnerId })).toBe(false);
  });

  /**
   * THE SAFETY PROPERTY. The settled scope is that any account may load demo,
   * including one holding real Jira + GitHub tokens — so load-then-reset has to
   * be provably unable to touch them. The old CLI seed `DELETE`d both credential
   * tables by `owner_id`, which under this scope would have been a token-loss
   * event with no recovery.
   */
  it("leaves an account's real credentials byte-identical across load and reset", async () => {
    const realOwnerId = await seedRealOwner();

    await db.insert(githubCredential).values({
      id: randomUUID(),
      ownerId: realOwnerId,
      encryptedToken: encryptToken("gh_RealPat9876", { ownerId: realOwnerId, provider: "GITHUB" }),
      tokenLast4: "9876",
      githubLogin: "real-lead",
    });
    await db.insert(jiraCredential).values({
      id: randomUUID(),
      ownerId: realOwnerId,
      encryptedToken: encryptToken("jira_RealToken5432", { ownerId: realOwnerId, provider: "JIRA" }),
      tokenLast4: "5432",
      workspaceUrl: "https://real.atlassian.net",
      jiraEmail: "real@example.test",
    });

    const before = await readCredentials(realOwnerId);

    await loadDemo({ db, realOwnerId, now: ANCHOR });
    expect(await readCredentials(realOwnerId)).toEqual(before);

    await resetDemo({ db, realOwnerId });
    expect(await readCredentials(realOwnerId)).toEqual(before);
  });
});

async function readCredentials(ownerId: string) {
  const gh = await db
    .select()
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId));
  const jira = await db
    .select()
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId));
  return { gh, jira };
}

function sortByKey<T extends { dedupKey: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.dedupKey.localeCompare(b.dedupKey));
}
