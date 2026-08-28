import { describe, expect, it } from "vitest";

import { DEFAULT_FTE, FTE_CHOICES, fteToColumn, isFteChoice, toFte } from "@/lib/fte";

/**
 * S-23 Phase 1 — the `numeric`↔number boundary.
 *
 * This module exists for one measured fact: the `pg` driver returns
 * `numeric(3,2)` as a STRING. `0.50::numeric(3,2)` arrives as `'0.50'`, and
 * `'0.50' === 0.5` is `false`. Drizzle types the column as `string`, so a
 * forgotten conversion is NOT a type error at the boundary — it surfaces as
 * arithmetic on a string, or as `roster-store.ts:isUnchanged` declaring every
 * row changed on every save and moving every `updated_at`.
 *
 * The round-trip test below is the one that would have caught that.
 */

describe("toFte — the read boundary", () => {
  it("parses the driver's numeric string back to a number", () => {
    expect(toFte("0.50")).toBe(0.5);
    expect(toFte("1.00")).toBe(1);
    expect(toFte("0.75")).toBe(0.75);
    expect(toFte("0.25")).toBe(0.25);
  });

  it("passes a number through untouched", () => {
    for (const choice of FTE_CHOICES) expect(toFte(choice)).toBe(choice);
  });

  it("degrades an absent value to the column default rather than NaN", () => {
    // A NaN here would poison a whole team's capacity sum with no indication of
    // which row caused it — the reducer adds these together.
    expect(toFte(null)).toBe(DEFAULT_FTE);
    expect(toFte(undefined)).toBe(DEFAULT_FTE);
  });

  it("degrades unparseable and non-finite input, never returning NaN", () => {
    for (const raw of ["", "  ", "abc", "1.0.0", Number.NaN, Number.POSITIVE_INFINITY]) {
      const value = toFte(raw as string | number);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBe(DEFAULT_FTE);
    }
  });

  it("degrades a negative value, which no availability can be", () => {
    expect(toFte(-1)).toBe(DEFAULT_FTE);
    expect(toFte("-0.50")).toBe(DEFAULT_FTE);
  });

  it("passes zero through instead of rewriting it to full time", () => {
    // Zero is a legitimate reading — "contributes nothing this sprint". Treating
    // it as absent and defaulting to 1 would OVERSTATE the team, which is the
    // failure direction that matters: an inflated capacity reads as healthy.
    expect(toFte(0)).toBe(0);
    expect(toFte("0.00")).toBe(0);
  });
});

describe("fteToColumn — the write boundary", () => {
  it("renders the numeric(3,2) literal at a fixed two decimals", () => {
    expect(fteToColumn(1)).toBe("1.00");
    expect(fteToColumn(0.5)).toBe("0.50");
    expect(fteToColumn(0.75)).toBe("0.75");
    expect(fteToColumn(0.25)).toBe("0.25");
  });

  it("falls back to the default rather than writing NaN into the column", () => {
    expect(fteToColumn(Number.NaN)).toBe("1.00");
    expect(fteToColumn(-2)).toBe("1.00");
  });

  it("round-trips every legal choice through both boundaries", () => {
    // The property that makes `isUnchanged` work: write then read must return
    // the value that went in, as a NUMBER, for every offered option.
    for (const choice of FTE_CHOICES) {
      expect(toFte(fteToColumn(choice))).toBe(choice);
    }
  });
});

describe("isFteChoice", () => {
  it("accepts exactly the four offered values", () => {
    for (const choice of FTE_CHOICES) expect(isFteChoice(choice)).toBe(true);
  });

  it("rejects anything the select could not have produced", () => {
    // The validation layer's predicate: a crafted payload must not be able to
    // store a fraction the capacity reducer would then silently believe.
    for (const value of [0, 0.6, 0.9, 1.5, 2, -1, Number.NaN]) {
      expect(isFteChoice(value)).toBe(false);
    }
  });
});
