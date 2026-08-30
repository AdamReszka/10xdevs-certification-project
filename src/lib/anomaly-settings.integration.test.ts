import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalySettings, anomalyType, user } from "@/db/schema";
import { resolveEffectiveThresholds } from "@/lib/anomaly/thresholds";
import {
  readAnomalyRules,
  resetAnomalyRule,
  saveAnomalyRule,
} from "@/lib/anomaly-settings";
import type { AnomalyRuleSaveValues } from "@/lib/validations/anomaly-settings";

/**
 * S-14 Phase 2 — the anomaly-settings write path against REAL Postgres (local
 * Supabase `:54322`).
 *
 * Four things can only be checked here, not in a unit test:
 *
 *  - **The upsert really conflicts.** `saveAnomalyRule` leans on
 *    `anomaly_settings_owner_type_uq` and `onConflictDoUpdate` rather than a
 *    read-then-write, so the constraint has to actually exist — and a second
 *    save must UPDATE, never insert a duplicate.
 *  - **`updatedAt` advances on the conflict path.** Drizzle's `$onUpdate` does
 *    NOT fire inside a conflict `set`; only a real round trip proves the manual
 *    assignment took.
 *  - **The normalise-to-delete invariant.** "A row exists iff the rule differs
 *    from its defaults" is a statement about the table, so it is asserted
 *    against the table.
 *  - **Cross-owner isolation.** Every read and write is owner-scoped; one
 *    owner's save and reset must leave the other's row byte-for-byte intact
 *    (PRD cross-account isolation). There is no RLS behind this.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/** A bare owner — `anomaly_settings` hangs off `user` alone, no project or sprint. */
async function newOwner(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Anomaly Settings Test",
    email: `ast-${ownerId}@example.test`,
  });
  return ownerId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

/** A complete `PR_TOO_BIG` payload — the whole body, as the form always submits. */
function prTooBig(maxLines: number, severity: "HIGH" | "MEDIUM" | "LOW" = "LOW") {
  return {
    anomalyType: "PR_TOO_BIG",
    severity,
    thresholds: { maxLines },
  } satisfies AnomalyRuleSaveValues;
}

async function rowsFor(ownerId: string) {
  return db.select().from(anomalySettings).where(eq(anomalySettings.ownerId, ownerId));
}

describe("readAnomalyRules", () => {
  it("returns eight un-overridden rules for a fresh owner with zero rows", async () => {
    const ownerId = await newOwner();

    const rules = await readAnomalyRules({ db, ownerId });

    expect(rules).toHaveLength(8);
    expect(rules.map((r) => r.anomalyType)).toEqual([...anomalyType.enumValues]);
    for (const rule of rules) {
      expect(rule.isOverridden).toBe(false);
      expect(rule.severity).toBe(DEFAULT_THRESHOLDS[rule.anomalyType].severity);
      expect(rule.thresholds).toEqual(DEFAULT_THRESHOLDS[rule.anomalyType].thresholds);
    }
  });

  it("marks only the saved rule as overridden", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({ db, ownerId, input: prTooBig(250, "HIGH") });

    const rules = await readAnomalyRules({ db, ownerId });
    const overridden = rules.filter((r) => r.isOverridden);

    expect(overridden).toHaveLength(1);
    expect(overridden[0].anomalyType).toBe("PR_TOO_BIG");
    expect(overridden[0].severity).toBe("HIGH");
    expect(overridden[0].thresholds).toEqual({ maxLines: 250 });
  });
});

describe("saveAnomalyRule", () => {
  it("writes exactly one row and leaves the other seven rules absent", async () => {
    const ownerId = await newOwner();

    const result = await saveAnomalyRule({ db, ownerId, input: prTooBig(250) });

    expect(result.stored).toBe(true);
    const rows = await rowsFor(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].anomalyType).toBe("PR_TOO_BIG");
    expect(rows[0].thresholds).toEqual({ maxLines: 250 });
  });

  it("updates in place on a second save, with updatedAt advanced", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({ db, ownerId, input: prTooBig(250) });
    const [first] = await rowsFor(ownerId);

    // `$onUpdate` does not fire on the conflict path — the store sets the
    // timestamp by hand, and only a real round trip proves it took.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveAnomalyRule({ db, ownerId, input: prTooBig(400, "MEDIUM") });

    const rows = await rowsFor(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].thresholds).toEqual({ maxLines: 400 });
    expect(rows[0].severityOverride).toBe("MEDIUM");
    expect(rows[0].updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("leaves NO row behind when the submitted values equal the defaults", async () => {
    const ownerId = await newOwner();

    const result = await saveAnomalyRule({
      db,
      ownerId,
      input: prTooBig(500, "LOW"), // exactly what `DEFAULT_THRESHOLDS` ships
    });

    expect(result.stored).toBe(false);
    expect(await rowsFor(ownerId)).toHaveLength(0);
  });

  it("DELETES an existing override when the lead types the defaults back in", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({ db, ownerId, input: prTooBig(250, "HIGH") });
    expect(await rowsFor(ownerId)).toHaveLength(1);

    await saveAnomalyRule({ db, ownerId, input: prTooBig(500, "LOW") });

    // The invariant: a row exists IFF the rule differs from its defaults.
    expect(await rowsFor(ownerId)).toHaveLength(0);
    const rules = await readAnomalyRules({ db, ownerId });
    expect(rules.find((r) => r.anomalyType === "PR_TOO_BIG")?.isOverridden).toBe(false);
  });

  it("stores a full seven-bucket TICKET_STATUS_AGING body without losing a key", async () => {
    const ownerId = await newOwner();

    await saveAnomalyRule({
      db,
      ownerId,
      input: {
        anomalyType: "TICKET_STATUS_AGING",
        severity: "HIGH",
        thresholds: {
          inProgressHoursBySp: {
            "1": 12,
            "2": 24,
            "3": 48,
            "5": 72,
            "8": 120,
            "13": 120,
            "21": 64,
          },
          codeReviewHours: 8,
          testingHours: 48,
        },
      },
    });

    const [row] = await rowsFor(ownerId);
    const stored = row.thresholds as { inProgressHoursBySp: Record<string, unknown> };
    // The jsonb round trip keeps every bucket — the merge is shallow, so a lost
    // key here would silently drop In-Progress aging to the nearest lower budget.
    expect(Object.keys(stored.inProgressHoursBySp)).toHaveLength(7);
    expect(stored.inProgressHoursBySp["21"]).toBe(64);
  });
});

describe("resetAnomalyRule", () => {
  it("removes the row and returns the rule to its defaults", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({ db, ownerId, input: prTooBig(250, "HIGH") });

    await resetAnomalyRule({ db, ownerId, anomalyType: "PR_TOO_BIG" });

    expect(await rowsFor(ownerId)).toHaveLength(0);
    const rules = await readAnomalyRules({ db, ownerId });
    const rule = rules.find((r) => r.anomalyType === "PR_TOO_BIG");
    expect(rule?.isOverridden).toBe(false);
    expect(rule?.thresholds).toEqual(DEFAULT_THRESHOLDS.PR_TOO_BIG.thresholds);
  });

  it("is a no-op on a rule that was never overridden", async () => {
    const ownerId = await newOwner();

    await expect(
      resetAnomalyRule({ db, ownerId, anomalyType: "SCOPE_CREEP" }),
    ).resolves.toBeUndefined();
    expect(await rowsFor(ownerId)).toHaveLength(0);
  });
});

describe("cross-account isolation", () => {
  it("leaves owner B's row byte-identical after owner A saves and resets", async () => {
    const [a, b] = [await newOwner(), await newOwner()];
    await saveAnomalyRule({ db, ownerId: b, input: prTooBig(250, "HIGH") });
    const [before] = await rowsFor(b);

    await saveAnomalyRule({ db, ownerId: a, input: prTooBig(999, "MEDIUM") });
    await resetAnomalyRule({ db, ownerId: a, anomalyType: "PR_TOO_BIG" });

    const [after] = await rowsFor(b);
    expect(after).toEqual(before);
    expect(await rowsFor(a)).toHaveLength(0);
  });

  it("scopes the read so one owner never sees the other's override", async () => {
    const [a, b] = [await newOwner(), await newOwner()];
    await saveAnomalyRule({ db, ownerId: b, input: prTooBig(250, "HIGH") });

    const rulesA = await readAnomalyRules({ db, ownerId: a });

    expect(rulesA.every((r) => !r.isOverridden)).toBe(true);
    expect(rulesA.find((r) => r.anomalyType === "PR_TOO_BIG")?.thresholds).toEqual({
      maxLines: 500,
    });
  });

  it("a reset does not reach across owners even for the same anomaly type", async () => {
    const [a, b] = [await newOwner(), await newOwner()];
    await saveAnomalyRule({ db, ownerId: a, input: prTooBig(250) });
    await saveAnomalyRule({ db, ownerId: b, input: prTooBig(300) });

    await resetAnomalyRule({ db, ownerId: a, anomalyType: "PR_TOO_BIG" });

    const survivors = await db
      .select()
      .from(anomalySettings)
      .where(
        and(
          eq(anomalySettings.ownerId, b),
          eq(anomalySettings.anomalyType, "PR_TOO_BIG"),
        ),
      );
    expect(survivors).toHaveLength(1);
    expect(survivors[0].thresholds).toEqual({ maxLines: 300 });
  });
});

describe("the override actually reaches the detector", () => {
  it("resolveEffectiveThresholds returns the saved body, not the default", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({ db, ownerId, input: prTooBig(250, "HIGH") });

    const effective = await resolveEffectiveThresholds(db, ownerId);

    expect(effective.PR_TOO_BIG).toEqual({ severity: "HIGH", thresholds: { maxLines: 250 } });
    // Untouched rules still resolve to what SprintFlow ships.
    expect(effective.SCOPE_CREEP).toEqual(DEFAULT_THRESHOLDS.SCOPE_CREEP);
  });

  it("keeps every story-point bucket on the way through the resolver", async () => {
    const ownerId = await newOwner();
    await saveAnomalyRule({
      db,
      ownerId,
      input: {
        anomalyType: "TICKET_STATUS_AGING",
        severity: "MEDIUM",
        thresholds: {
          inProgressHoursBySp: {
            "1": 12,
            "2": 24,
            "3": 48,
            "5": 72,
            "8": 120,
            "13": 120,
            "21": 64,
          },
          codeReviewHours: 24,
          testingHours: 48,
        },
      },
    });

    const effective = await resolveEffectiveThresholds(db, ownerId);
    const body = effective.TICKET_STATUS_AGING.thresholds as {
      inProgressHoursBySp: Record<string, unknown>;
    };

    expect(Object.keys(body.inProgressHoursBySp)).toHaveLength(7);
    expect(body.inProgressHoursBySp["1"]).toBe(12);
  });

  /**
   * A ROW WRITTEN BEFORE S-28, read after it.
   *
   * The insert bypasses `saveAnomalyRule` deliberately: the point is a body
   * already sitting in the column, which is exactly how the legacy value got
   * there — the write path can no longer produce it, because the schema
   * normalises on parse. What must not happen is `mergeRule` rejecting it: the
   * override is then discarded WHOLESALE, severity included, with only a
   * `console.error`, and the lead sees their whole rule silently reverted.
   */
  it("normalises a pre-S-28 8_WORKING_DAYS row to 64 and keeps its severity", async () => {
    const ownerId = await newOwner();
    await db.insert(anomalySettings).values({
      id: randomUUID(),
      ownerId,
      anomalyType: "TICKET_STATUS_AGING",
      severityOverride: "HIGH",
      thresholds: {
        inProgressHoursBySp: {
          "1": 12,
          "2": 24,
          "3": 48,
          "5": 72,
          "8": 120,
          "13": 120,
          "21": "8_WORKING_DAYS",
        },
        codeReviewHours: 24,
        testingHours: 48,
      },
    });

    const effective = await resolveEffectiveThresholds(db, ownerId);
    const body = effective.TICKET_STATUS_AGING.thresholds as {
      inProgressHoursBySp: Record<string, unknown>;
    };

    expect(body.inProgressHoursBySp["21"]).toBe(64);
    // The detector has no branch for the string; it must never see one.
    expect(body.inProgressHoursBySp["21"]).not.toBe("8_WORKING_DAYS");
    // The account's own numbers and severity survived — the override was not
    // discarded and replaced by the shipped defaults.
    expect(body.inProgressHoursBySp["1"]).toBe(12);
    expect(effective.TICKET_STATUS_AGING.severity).toBe("HIGH");
  });
});
