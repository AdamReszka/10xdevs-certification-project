import { describe, expect, it } from "vitest";

import {
  MAX_CAPACITY_MD,
  MAX_DELIVERED_SP,
  capacityOverrideSaveSchema,
  deliveredCorrectionSaveSchema,
} from "@/lib/validations/measurement";

/**
 * S-23 Phase 5 — the lead's two manual entries (FR-022/FR-023).
 *
 * The cases that matter are the ones where "reject it" and "accept it" are
 * genuinely close: `null` (clear the override) versus `0` (a real capacity of
 * nothing), and `0.29` — which the obvious two-decimal check would reject on a
 * float artefact alone.
 */

const SPRINT = "41";

const parseMd = (md: number | null) =>
  capacityOverrideSaveSchema.parse({ jiraSprintId: SPRINT, md });
const parseSp = (sp: number | null) =>
  deliveredCorrectionSaveSchema.parse({ jiraSprintId: SPRINT, sp });

describe("capacityOverrideSaveSchema", () => {
  it("accepts null — the only way back to the computed figure", () => {
    expect(capacityOverrideSaveSchema.parse({ jiraSprintId: SPRINT, md: null })).toEqual(
      { jiraSprintId: SPRINT, md: null },
    );
  });

  it("accepts 0, which is a real capacity and not a cleared field", () => {
    expect(capacityOverrideSaveSchema.parse({ jiraSprintId: SPRINT, md: 0 })).toEqual(
      { jiraSprintId: SPRINT, md: 0 },
    );
  });

  it("accepts two decimals, including values a float check would round wrong", () => {
    expect(parseMd(0.29)).toEqual({ jiraSprintId: SPRINT, md: 0.29 });
    expect(parseMd(117.5)).toEqual({ jiraSprintId: SPRINT, md: 117.5 });
  });

  it("rejects a third decimal", () => {
    expect(capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: 12.345 }).success).toBe(false);
  });

  it("rejects a negative capacity", () => {
    expect(capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: -1 }).success).toBe(false);
  });

  it("rejects a fat-fingered figure past the ceiling", () => {
    expect(capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: MAX_CAPACITY_MD }).success).toBe(
      true,
    );
    expect(
      capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: MAX_CAPACITY_MD + 1 }).success,
    ).toBe(false);
  });

  it("rejects NaN and Infinity rather than storing them", () => {
    expect(capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: Number.NaN }).success).toBe(false);
    expect(
      capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it("rejects a numeric string — the client parses before it submits", () => {
    expect(capacityOverrideSaveSchema.safeParse({ jiraSprintId: SPRINT, md: "90" }).success).toBe(false);
  });

  it("rejects an absent field, so 'clear it' has to be said explicitly", () => {
    expect(capacityOverrideSaveSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a payload naming no sprint — the target is never inferred", () => {
    expect(capacityOverrideSaveSchema.safeParse({ md: 12 }).success).toBe(false);
    expect(
      capacityOverrideSaveSchema.safeParse({ jiraSprintId: "", md: 12 }).success,
    ).toBe(false);
  });
});

describe("deliveredCorrectionSaveSchema", () => {
  it("accepts null and 0 as the distinct things they are", () => {
    expect(parseSp(null)).toEqual({ jiraSprintId: SPRINT, sp: null });
    expect(parseSp(0)).toEqual({ jiraSprintId: SPRINT, sp: 0 });
  });

  it("accepts a whole number of story points", () => {
    expect(parseSp(42)).toEqual({ jiraSprintId: SPRINT, sp: 42 });
  });

  it("rejects a fractional delivered sum", () => {
    expect(deliveredCorrectionSaveSchema.safeParse({ jiraSprintId: SPRINT, sp: 12.5 }).success).toBe(false);
  });

  it("rejects a negative figure", () => {
    expect(deliveredCorrectionSaveSchema.safeParse({ jiraSprintId: SPRINT, sp: -3 }).success).toBe(false);
  });

  it("rejects a figure past the ceiling", () => {
    expect(
      deliveredCorrectionSaveSchema.safeParse({ jiraSprintId: SPRINT, sp: MAX_DELIVERED_SP + 1 }).success,
    ).toBe(false);
  });
});
