import { describe, expect, it } from "vitest";

import { POLAND_HOLIDAYS } from "@/lib/holidays/poland";

/**
 * S-17 Phase 3 — the rule table itself, asserted as data.
 *
 * These are structural checks the year-by-year suite in `index.test.ts` would
 * not localise: a duplicated rule shows up there only as a wrong count, with no
 * hint of which one.
 */
describe("POLAND_HOLIDAYS", () => {
  it("holds fourteen rules — ten fixed and four Easter-relative", () => {
    expect(POLAND_HOLIDAYS).toHaveLength(14);
    expect(POLAND_HOLIDAYS.filter((r) => r.kind === "fixed")).toHaveLength(10);
    expect(POLAND_HOLIDAYS.filter((r) => r.kind === "easter")).toHaveLength(4);
  });

  it("names every rule, in Polish, with no duplicates", () => {
    const labels = POLAND_HOLIDAYS.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("repeats no fixed date and no Easter offset", () => {
    const fixed = POLAND_HOLIDAYS.filter((r) => r.kind === "fixed").map(
      (r) => `${r.month}-${r.day}`,
    );
    const easter = POLAND_HOLIDAYS.filter((r) => r.kind === "easter").map(
      (r) => r.offsetDays,
    );
    expect(new Set(fixed).size).toBe(fixed.length);
    expect(new Set(easter).size).toBe(easter.length);
  });

  it("dates Wigilia from 2025 and leaves every other rule unbounded", () => {
    // The only rule with a start year: 24 December became a statutory
    // non-working day in Poland only from 2025.
    const bounded = POLAND_HOLIDAYS.filter((r) => r.fromYear !== undefined);
    expect(bounded).toHaveLength(1);
    expect(bounded[0].fromYear).toBe(2025);
    expect(bounded[0].kind === "fixed" && bounded[0].month).toBe(12);
    expect(bounded[0].kind === "fixed" && bounded[0].day).toBe(24);
  });
});
