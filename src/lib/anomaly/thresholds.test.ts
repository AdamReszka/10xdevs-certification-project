import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalyType } from "@/db/schema";
import { mergeRule, resolveEffectiveThresholds } from "@/lib/anomaly/thresholds";

/**
 * S-14 Phase 1 — the resolver's first test file. It had none: every rule unit
 * test injects `DEFAULT_THRESHOLDS` cast to `EffectiveThresholds` through
 * `test-support.ts`, so the override path — and, more importantly, the
 * ZERO-ROW path every account is actually in today — had never been executed
 * through the real resolver (`lessons.md`, "test the no-configuration path
 * through the real resolver, not through an injected dependency").
 */

type Row = {
  anomalyType: (typeof anomalyType.enumValues)[number];
  severityOverride: "HIGH" | "MEDIUM" | "LOW" | null;
  thresholds: unknown;
};

/**
 * The narrowest stub the resolver's single query needs. Deliberately NOT a
 * mocked `resolveEffectiveThresholds`: the point of this file is to run the real
 * one.
 */
function fakeDb(rows: Row[]) {
  const wheres: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async (predicate: unknown) => {
          wheres.push(predicate);
          return rows;
        },
      }),
    }),
  } as unknown as Parameters<typeof resolveEffectiveThresholds>[0];

  return { wheres, db };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEffectiveThresholds — the zero-row path", () => {
  it("returns the shipped defaults for all eight rules when the owner has no settings row", async () => {
    const { db } = fakeDb([]);

    const effective = await resolveEffectiveThresholds(db, "owner-1");

    expect(Object.keys(effective).sort()).toEqual([...anomalyType.enumValues].sort());
    for (const type of anomalyType.enumValues) {
      expect(effective[type].severity).toBe(DEFAULT_THRESHOLDS[type].severity);
      expect(effective[type].thresholds).toEqual(DEFAULT_THRESHOLDS[type].thresholds);
    }
  });

  it("does not hand back the DEFAULT_THRESHOLDS objects themselves", async () => {
    // A shared reference would let one detector's mutation leak into every later
    // detection run in the same isolate.
    const { db } = fakeDb([]);

    const effective = await resolveEffectiveThresholds(db, "owner-1");

    expect(effective.PR_TOO_BIG.thresholds).not.toBe(
      DEFAULT_THRESHOLDS.PR_TOO_BIG.thresholds,
    );
  });
});

describe("resolveEffectiveThresholds — with stored overrides", () => {
  it("layers one rule's override and leaves the other seven on their defaults", async () => {
    const { db } = fakeDb([
      { anomalyType: "PR_TOO_BIG", severityOverride: "HIGH", thresholds: { maxLines: 250 } },
    ]);

    const effective = await resolveEffectiveThresholds(db, "owner-1");

    expect(effective.PR_TOO_BIG).toEqual({ severity: "HIGH", thresholds: { maxLines: 250 } });
    expect(effective.PR_REVIEW_STALLED).toEqual(DEFAULT_THRESHOLDS.PR_REVIEW_STALLED);
    expect(effective.SCOPE_CREEP).toEqual(DEFAULT_THRESHOLDS.SCOPE_CREEP);
  });

  it("keeps all seven story-point buckets when TICKET_STATUS_AGING is overridden", async () => {
    const { db } = fakeDb([
      {
        anomalyType: "TICKET_STATUS_AGING",
        severityOverride: null,
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
          codeReviewHours: 8,
          testingHours: 48,
        },
      },
    ]);

    const effective = await resolveEffectiveThresholds(db, "owner-1");
    const body = effective.TICKET_STATUS_AGING.thresholds as {
      inProgressHoursBySp: Record<string, unknown>;
      codeReviewHours: number;
    };

    expect(Object.keys(body.inProgressHoursBySp)).toHaveLength(7);
    expect(body.inProgressHoursBySp["1"]).toBe(12);
    // THE COMPATIBILITY PATH (S-28). The row was written before working-hour
    // aging; the literal must still parse — a rejection would make `mergeRule`
    // discard this owner's whole rule, severity included — and must arrive at
    // the detector as the number 64, never as the string.
    expect(body.inProgressHoursBySp["21"]).toBe(64);
    expect(body.codeReviewHours).toBe(8);
    // Severity was not overridden, so the default tier survives.
    expect(effective.TICKET_STATUS_AGING.severity).toBe(
      DEFAULT_THRESHOLDS.TICKET_STATUS_AGING.severity,
    );
  });
});

describe("mergeRule — the read guard on the jsonb boundary", () => {
  it("falls back to the defaults, severity included, when the stored body is malformed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const merged = mergeRule("PR_TOO_BIG", DEFAULT_THRESHOLDS.PR_TOO_BIG, {
      severityOverride: "HIGH",
      thresholds: { maxLines: 0 },
    });

    // Not a partial merge: a half-applied body is the "empty result reads as
    // success" shape the whole guard exists to prevent.
    expect(merged).toEqual(DEFAULT_THRESHOLDS.PR_TOO_BIG);
    expect(merged.severity).toBe("LOW");
    // lessons.md obligation (a): a rule reverting to its defaults is never
    // reported as an ordinary run.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("PR_TOO_BIG");
  });

  it("rejects a story-point map missing a bucket wholesale rather than merging it in part", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const merged = mergeRule("TICKET_STATUS_AGING", DEFAULT_THRESHOLDS.TICKET_STATUS_AGING, {
      severityOverride: null,
      thresholds: {
        // The 21-SP bucket is gone — the exact shape a future added-bucket
        // default would produce, and the one that silently drops In-Progress
        // aging to the nearest lower budget.
        inProgressHoursBySp: { "1": 24, "2": 24, "3": 48, "5": 72, "8": 120, "13": 120 },
        codeReviewHours: 24,
        testingHours: 48,
      },
    });

    expect(merged.thresholds).toEqual(DEFAULT_THRESHOLDS.TICKET_STATUS_AGING.thresholds);
  });

  it("leaves the other seven rules untouched when one stored body is bad", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb([
      { anomalyType: "SCOPE_CREEP", severityOverride: "HIGH", thresholds: { percent: 400 } },
      { anomalyType: "PR_TOO_BIG", severityOverride: null, thresholds: { maxLines: 250 } },
    ]);

    const effective = await resolveEffectiveThresholds(db, "owner-1");

    expect(effective.SCOPE_CREEP).toEqual(DEFAULT_THRESHOLDS.SCOPE_CREEP);
    expect(effective.PR_TOO_BIG.thresholds).toEqual({ maxLines: 250 });
  });

  it("keeps a severity-only override whose body column is NULL", () => {
    // A NULL body is an ABSENT override, not a malformed one — the column is
    // nullable and the pre-S-14 merge spread `{}` for it.
    const merged = mergeRule("PR_TOO_BIG", DEFAULT_THRESHOLDS.PR_TOO_BIG, {
      severityOverride: "HIGH",
      thresholds: null,
    });

    expect(merged).toEqual({ severity: "HIGH", thresholds: { maxLines: 500 } });
  });

  it("returns a copy of the defaults when there is no override at all", () => {
    const merged = mergeRule("SPRINT_AT_RISK", DEFAULT_THRESHOLDS.SPRINT_AT_RISK, undefined);

    expect(merged).toEqual(DEFAULT_THRESHOLDS.SPRINT_AT_RISK);
    expect(merged.thresholds).not.toBe(DEFAULT_THRESHOLDS.SPRINT_AT_RISK.thresholds);
  });
});
