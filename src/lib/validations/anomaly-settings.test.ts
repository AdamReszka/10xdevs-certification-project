import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalyType } from "@/db/schema";
import {
  THRESHOLD_BODY_SCHEMAS,
  anomalyRuleSaveSchema,
} from "@/lib/validations/anomaly-settings";

/**
 * S-14 Phase 1 — the guard on the `jsonb` boundary.
 *
 * Each rejection below names a real detection failure, not a style preference:
 * a missing or non-numeric field propagates `NaN` into the `integer`
 * `risk_score` column and aborts the whole detection transaction; an emptied or
 * partial story-point map makes `inProgressBudget` return `null`, which skips
 * every In-Progress ticket and renders as a healthy sprint.
 */

/** The shipped body for a rule — the payload the form submits before any edit. */
function defaultBody(type: (typeof anomalyType.enumValues)[number]) {
  return structuredClone(DEFAULT_THRESHOLDS[type].thresholds);
}

describe("THRESHOLD_BODY_SCHEMAS — every shipped default is valid", () => {
  it.each(anomalyType.enumValues)("accepts the shipped body for %s", (type) => {
    const parsed = THRESHOLD_BODY_SCHEMAS[type].safeParse(defaultBody(type));
    expect(parsed.success).toBe(true);
  });

  it("covers all eight anomaly types", () => {
    expect(Object.keys(THRESHOLD_BODY_SCHEMAS).sort()).toEqual(
      [...anomalyType.enumValues].sort(),
    );
  });
});

describe("numeric fields reject the values that break detection", () => {
  const cases: [string, unknown][] = [
    ["zero", 0],
    ["a negative", -1],
    ["a non-integer", 12.5],
    ["a string number", "24"],
    ["NaN", Number.NaN],
    ["null", null],
    ["undefined (a missing field)", undefined],
  ];

  it.each(cases)("PR_REVIEW_STALLED.hours rejects %s", (_label, value) => {
    const parsed = THRESHOLD_BODY_SCHEMAS.PR_REVIEW_STALLED.safeParse({ hours: value });
    expect(parsed.success).toBe(false);
  });

  it.each(cases)("PR_TOO_BIG.maxLines rejects %s", (_label, value) => {
    const parsed = THRESHOLD_BODY_SCHEMAS.PR_TOO_BIG.safeParse({ maxLines: value });
    expect(parsed.success).toBe(false);
  });

  it.each(cases)("DEVELOPER_INACTIVE.noCommitDays rejects %s", (_label, value) => {
    const parsed = THRESHOLD_BODY_SCHEMAS.DEVELOPER_INACTIVE.safeParse({
      noCommitDays: value,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown extra field rather than storing it", () => {
    const parsed = THRESHOLD_BODY_SCHEMAS.PR_TOO_BIG.safeParse({ maxLines: 500, hours: 24 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a value above the upper bound", () => {
    // A typo that silences a rule forever is as bad as one that storms.
    expect(THRESHOLD_BODY_SCHEMAS.PR_TOO_BIG.safeParse({ maxLines: 100001 }).success).toBe(
      false,
    );
  });

  it("reports a user-facing sentence, not a zod code", () => {
    const parsed = THRESHOLD_BODY_SCHEMAS.PR_TOO_BIG.safeParse({ maxLines: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toBe("The PR size limit must be at least 1.");
    }
  });
});

describe("SCOPE_CREEP.percent is bounded 1..100", () => {
  it.each([1, 20, 100])("accepts %s", (percent) => {
    expect(THRESHOLD_BODY_SCHEMAS.SCOPE_CREEP.safeParse({ percent }).success).toBe(true);
  });

  it.each([0, 101, -5])("rejects %s", (percent) => {
    expect(THRESHOLD_BODY_SCHEMAS.SCOPE_CREEP.safeParse({ percent }).success).toBe(false);
  });
});

describe("TICKET_STATUS_AGING.inProgressHoursBySp must carry exactly seven buckets", () => {
  const full = {
    "1": 24,
    "2": 24,
    "3": 48,
    "5": 72,
    "8": 120,
    "13": 120,
    "21": "8_WORKING_DAYS" as const,
  };

  function body(map: Record<string, unknown>) {
    return { inProgressHoursBySp: map, codeReviewHours: 24, testingHours: 48 };
  }

  it("accepts the full seven-key map", () => {
    expect(THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(body(full)).success).toBe(
      true,
    );
  });

  it("rejects a map missing a bucket", () => {
    const missing: Record<string, unknown> = { ...full };
    delete missing["21"];
    expect(THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(body(missing)).success).toBe(
      false,
    );
  });

  it("rejects a map with an extra bucket", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(body({ ...full, "34": 200 }))
        .success,
    ).toBe(false);
  });

  it("rejects an empty map — the shape that silences In-Progress aging entirely", () => {
    expect(THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(body({})).success).toBe(
      false,
    );
  });

  it("accepts the working-day sentinel on any bucket, because the detector branches on the value", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(
        body({ ...full, "13": "8_WORKING_DAYS" }),
      ).success,
    ).toBe(true);
  });

  it("rejects an unrecognised sentinel", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(
        body({ ...full, "21": "10_WORKING_DAYS" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a zero bucket value", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.TICKET_STATUS_AGING.safeParse(body({ ...full, "1": 0 })).success,
    ).toBe(false);
  });
});

describe("SPRINT_AT_RISK.maxParallelByCategory must carry exactly three categories", () => {
  const full = { IN_PROGRESS: 2, CODE_REVIEW: 2, TESTING: 3 };

  function body(map: Record<string, unknown>) {
    return { maxParallelByCategory: map, toDoBeforeSprintEndLeadTimeHours: 48 };
  }

  it("accepts the full map", () => {
    expect(THRESHOLD_BODY_SCHEMAS.SPRINT_AT_RISK.safeParse(body(full)).success).toBe(true);
  });

  it("rejects a map missing a category", () => {
    const missing: Record<string, unknown> = { ...full };
    delete missing.TESTING;
    expect(THRESHOLD_BODY_SCHEMAS.SPRINT_AT_RISK.safeParse(body(missing)).success).toBe(
      false,
    );
  });

  it("rejects a map with an unknown category", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.SPRINT_AT_RISK.safeParse(body({ ...full, BLOCKED: 1 })).success,
    ).toBe(false);
  });

  it("rejects a zero limit", () => {
    expect(
      THRESHOLD_BODY_SCHEMAS.SPRINT_AT_RISK.safeParse(body({ ...full, IN_PROGRESS: 0 }))
        .success,
    ).toBe(false);
  });
});

describe("PR_TICKET_DESYNC has no tunable numbers", () => {
  it("accepts the empty body", () => {
    expect(THRESHOLD_BODY_SCHEMAS.PR_TICKET_DESYNC.safeParse({}).success).toBe(true);
  });

  it("rejects a body carrying a field", () => {
    expect(THRESHOLD_BODY_SCHEMAS.PR_TICKET_DESYNC.safeParse({ hours: 24 }).success).toBe(
      false,
    );
  });
});

describe("anomalyRuleSaveSchema — the wire payload", () => {
  it.each(anomalyType.enumValues)("accepts a shipped-defaults payload for %s", (type) => {
    const parsed = anomalyRuleSaveSchema.safeParse({
      anomalyType: type,
      severity: DEFAULT_THRESHOLDS[type].severity,
      thresholds: defaultBody(type),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown anomaly type", () => {
    expect(
      anomalyRuleSaveSchema.safeParse({
        anomalyType: "TICKET_BLOCKED",
        severity: "HIGH",
        thresholds: {},
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown severity tier", () => {
    expect(
      anomalyRuleSaveSchema.safeParse({
        anomalyType: "PR_TOO_BIG",
        severity: "CRITICAL",
        thresholds: { maxLines: 500 },
      }).success,
    ).toBe(false);
  });

  it("rejects a body belonging to a different rule", () => {
    // The discriminated union is what stops a `PR_TOO_BIG` body landing under
    // `SCOPE_CREEP`, where the detector would read `percent` as undefined.
    expect(
      anomalyRuleSaveSchema.safeParse({
        anomalyType: "SCOPE_CREEP",
        severity: "MEDIUM",
        thresholds: { maxLines: 500 },
      }).success,
    ).toBe(false);
  });
});
