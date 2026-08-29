import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { anomalyType } from "@/db/schema";
import {
  RULE_SAVE_SCHEMAS,
  SP_BUCKET_KEYS,
} from "@/lib/validations/anomaly-settings";

import {
  RULE_DESCRIPTORS,
  SP21_CHOICES,
  defaultFormValues,
  equalsDefaults,
  readField,
  toFormValues,
  toPayload,
} from "./anomaly-rules-view";

/**
 * S-14 Phase 3 — the card's judgement, tested without a DOM. There is no
 * jsdom/RTL harness in this project, so everything the `.tsx` decides lives here
 * (CLAUDE.md's stated convention).
 */

describe("RULE_DESCRIPTORS", () => {
  it("covers all eight anomaly types, in enum order", () => {
    expect(RULE_DESCRIPTORS.map((d) => d.anomalyType)).toEqual([
      ...anomalyType.enumValues,
    ]);
  });

  it("declares only fields that really exist in DEFAULT_THRESHOLDS", () => {
    // The assertion that catches a field renamed on ONE side only — the exact
    // shape that makes a detector read `undefined` and propagate NaN.
    for (const descriptor of RULE_DESCRIPTORS) {
      const body = DEFAULT_THRESHOLDS[descriptor.anomalyType].thresholds;
      for (const field of descriptor.fields) {
        expect(
          readField(body, field.path),
          `${descriptor.anomalyType}.${field.path}`,
        ).toBeDefined();
      }
    }
  });

  it("declares every tunable number each rule has", () => {
    // The mirror of the test above: a default the form never renders is a value
    // the lead cannot change and would not know exists.
    for (const descriptor of RULE_DESCRIPTORS) {
      const body = DEFAULT_THRESHOLDS[descriptor.anomalyType].thresholds as Record<
        string,
        unknown
      >;
      const declared = new Set(descriptor.fields.map((f) => f.path.split(".")[0]));
      for (const key of Object.keys(body)) {
        // The SP map is rendered by its own grid, not as an ordinary field.
        if (key === "inProgressHoursBySp") {
          expect(descriptor.hasStoryPointBudgets).toBe(true);
          continue;
        }
        expect(declared.has(key), `${descriptor.anomalyType}.${key}`).toBe(true);
      }
    }
  });

  it("gives PR_TICKET_DESYNC no numeric fields", () => {
    const desync = RULE_DESCRIPTORS.find((d) => d.anomalyType === "PR_TICKET_DESYNC");
    expect(desync?.fields).toEqual([]);
    expect(desync?.hasStoryPointBudgets).toBeUndefined();
  });

  it("bounds every field the same way the zod schema does", () => {
    // A descriptor whose `min` is 0 would render an input the schema then
    // refuses — a rejection the lead cannot see coming.
    for (const descriptor of RULE_DESCRIPTORS) {
      for (const field of descriptor.fields) {
        expect(field.min).toBeGreaterThanOrEqual(1);
        expect(field.max).toBeGreaterThan(field.min);
      }
    }
  });
});

describe("toPayload — always the COMPLETE body", () => {
  it.each(anomalyType.enumValues)("round-trips the shipped defaults for %s", (type) => {
    const payload = toPayload(defaultFormValues(type));

    expect(payload.thresholds).toEqual(DEFAULT_THRESHOLDS[type].thresholds);
    expect(RULE_SAVE_SCHEMAS[type].safeParse(payload).success).toBe(true);
  });

  it("keeps all seven story-point buckets when only one changed", () => {
    // THE failure this whole slice exists to prevent: the merge is one level
    // deep, so a partial map REPLACES the default map and deletes the rest.
    const values = defaultFormValues("TICKET_STATUS_AGING");
    (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["3"] = 96;

    const payload = toPayload(values);
    const map = payload.thresholds.inProgressHoursBySp as Record<string, unknown>;

    expect(Object.keys(map).sort()).toEqual([...SP_BUCKET_KEYS].sort());
    expect(map["3"]).toBe(96);
    expect(map["21"]).toBe("8_WORKING_DAYS");
  });

  it("rebuilds a bucket the form somehow dropped from the defaults", () => {
    const values = defaultFormValues("TICKET_STATUS_AGING");
    delete (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["8"];

    const payload = toPayload(values);
    const map = payload.thresholds.inProgressHoursBySp as Record<string, unknown>;

    expect(Object.keys(map)).toHaveLength(7);
    expect(map["8"]).toBe(120);
  });

  it("drops a bucket the form somehow invented", () => {
    const values = defaultFormValues("TICKET_STATUS_AGING");
    (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["34"] = 200;

    const payload = toPayload(values);
    const map = payload.thresholds.inProgressHoursBySp as Record<string, unknown>;

    // Rebuilt over the DEFAULTS' key set, so an extra key cannot reach the
    // column, where `.strict()` would then refuse to re-read it.
    expect(map["34"]).toBeUndefined();
    expect(Object.keys(map)).toHaveLength(7);
  });

  it("reads an array-shaped nested map by key, so a react-hook-form edit is never lost", () => {
    // `register("thresholds.inProgressHoursBySp.5")` is a lodash-style path, so
    // RHF's store may hold the map as a sparse array. Indexing by the string key
    // is valid for both shapes; treating an array as "not a map" would silently
    // re-submit the defaults over the lead's edits.
    const values = defaultFormValues("TICKET_STATUS_AGING");
    const sparse: unknown[] = [];
    sparse[1] = 12;
    sparse[3] = 48;
    sparse[21] = "8_WORKING_DAYS";
    values.thresholds.inProgressHoursBySp = sparse;

    const map = toPayload(values).thresholds.inProgressHoursBySp as Record<string, unknown>;

    expect(Object.keys(map).sort()).toEqual([...SP_BUCKET_KEYS].sort());
    expect(map["1"]).toBe(12);
    // A hole falls back to the shipped value rather than going missing.
    expect(map["2"]).toBe(24);
  });

  it("keeps all three parallel categories when only one changed", () => {
    const values = defaultFormValues("SPRINT_AT_RISK");
    (values.thresholds.maxParallelByCategory as Record<string, unknown>).TESTING = 5;

    const payload = toPayload(values);
    const map = payload.thresholds.maxParallelByCategory as Record<string, unknown>;

    expect(Object.keys(map).sort()).toEqual(["CODE_REVIEW", "IN_PROGRESS", "TESTING"]);
    expect(map.TESTING).toBe(5);
    expect(map.IN_PROGRESS).toBe(2);
  });

  it("carries the edited severity through", () => {
    const values = { ...defaultFormValues("PR_TOO_BIG"), severity: "HIGH" as const };
    expect(toPayload(values).severity).toBe("HIGH");
  });

  it("produces a payload the wire schema accepts after an edit", () => {
    const values = defaultFormValues("PR_TOO_BIG");
    values.thresholds.maxLines = 250;

    const parsed = RULE_SAVE_SCHEMAS.PR_TOO_BIG.safeParse(toPayload(values));
    expect(parsed.success).toBe(true);
  });
});

describe("the 21-SP two-position control", () => {
  it("offers exactly the two values the detector can mean", () => {
    expect(SP21_CHOICES.map((c) => c.value)).toEqual(["120", "8_WORKING_DAYS"]);
  });

  it("maps both positions through toPayload into a body the schema accepts", () => {
    for (const raw of [120, "8_WORKING_DAYS"] as const) {
      const values = defaultFormValues("TICKET_STATUS_AGING");
      (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["21"] = raw;

      const payload = toPayload(values);
      const map = payload.thresholds.inProgressHoursBySp as Record<string, unknown>;

      expect(map["21"]).toBe(raw);
      expect(RULE_SAVE_SCHEMAS.TICKET_STATUS_AGING.safeParse(payload).success).toBe(true);
    }
  });
});

describe("toFormValues", () => {
  it("copies the body rather than aliasing the server state", () => {
    const state = {
      anomalyType: "TICKET_STATUS_AGING" as const,
      severity: "MEDIUM" as const,
      thresholds: DEFAULT_THRESHOLDS.TICKET_STATUS_AGING.thresholds,
    };

    const values = toFormValues(state);
    (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["1"] = 999;

    // Editing a card must not mutate the shipped defaults for every other card
    // rendered in the same isolate.
    expect(
      (DEFAULT_THRESHOLDS.TICKET_STATUS_AGING.thresholds
        .inProgressHoursBySp as Record<string, unknown>)["1"],
    ).toBe(24);
  });
});

describe("equalsDefaults — the one predicate behind the badge and the row", () => {
  it.each(anomalyType.enumValues)("is true for the shipped configuration of %s", (type) => {
    expect(equalsDefaults(type, defaultFormValues(type))).toBe(true);
  });

  it("is false when a number differs", () => {
    const values = defaultFormValues("PR_TOO_BIG");
    values.thresholds.maxLines = 250;
    expect(equalsDefaults("PR_TOO_BIG", values)).toBe(false);
  });

  it("is false when only the severity differs", () => {
    const values = { ...defaultFormValues("PR_TOO_BIG"), severity: "HIGH" as const };
    expect(equalsDefaults("PR_TOO_BIG", values)).toBe(false);
  });

  it("is false when a nested bucket differs", () => {
    const values = defaultFormValues("TICKET_STATUS_AGING");
    (values.thresholds.inProgressHoursBySp as Record<string, unknown>)["13"] = 96;
    expect(equalsDefaults("TICKET_STATUS_AGING", values)).toBe(false);
  });

  it("ignores key ORDER — JSON.stringify would not", () => {
    // The form rebuilds the body key by key, so the serialised order differs
    // from the stored one while the configuration is identical.
    const reordered = {
      severity: DEFAULT_THRESHOLDS.SPRINT_AT_RISK.severity,
      thresholds: {
        toDoBeforeSprintEndLeadTimeHours: 48,
        maxParallelByCategory: { TESTING: 3, IN_PROGRESS: 2, CODE_REVIEW: 2 },
      },
    };

    expect(equalsDefaults("SPRINT_AT_RISK", reordered)).toBe(true);
    expect(JSON.stringify(reordered.thresholds)).not.toBe(
      JSON.stringify(DEFAULT_THRESHOLDS.SPRINT_AT_RISK.thresholds),
    );
  });

  it("is false when a nested key is missing entirely", () => {
    const values = defaultFormValues("SPRINT_AT_RISK");
    delete (values.thresholds.maxParallelByCategory as Record<string, unknown>).TESTING;
    expect(equalsDefaults("SPRINT_AT_RISK", values)).toBe(false);
  });

  it("does not treat a stringified number as equal to the number", () => {
    const values = defaultFormValues("PR_TOO_BIG");
    values.thresholds.maxLines = "500";
    expect(equalsDefaults("PR_TOO_BIG", values)).toBe(false);
  });
});

describe("readField", () => {
  it("resolves a dotted path", () => {
    expect(
      readField(DEFAULT_THRESHOLDS.SPRINT_AT_RISK.thresholds, "maxParallelByCategory.TESTING"),
    ).toBe(3);
  });

  it("returns undefined for a path that does not exist", () => {
    expect(readField(DEFAULT_THRESHOLDS.PR_TOO_BIG.thresholds, "nope.deeper")).toBeUndefined();
  });
});
