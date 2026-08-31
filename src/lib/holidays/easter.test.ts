import { describe, expect, it } from "vitest";

import { addDays, easterSunday } from "@/lib/holidays/easter";

/**
 * S-17 Phase 3 — the arithmetic four of Poland's fourteen holidays hang off.
 *
 * The dates below are the published Gregorian Easters; they are the reference,
 * not a re-derivation of the implementation. Both March and April Easters are
 * represented, along with leap years and a century boundary, because those are
 * the inputs the algorithm's correction terms exist for.
 */
describe("easterSunday", () => {
  const KNOWN: [number, string][] = [
    [2020, "2020-04-12"], // leap year
    [2021, "2021-04-04"],
    [2023, "2023-04-09"],
    [2024, "2024-03-31"], // March, leap year
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"], // March
    [2000, "2000-04-23"], // century boundary
  ];

  for (const [year, day] of KNOWN) {
    it(`is ${day} in ${year}`, () => {
      expect(easterSunday(year)).toBe(day);
    });
  }

  it("always returns a zero-padded YYYY-MM-DD", () => {
    // 2027 falls in March, so the month is the single digit the pad exists for.
    expect(easterSunday(2027)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDays", () => {
  it("carries across a month boundary", () => {
    // Easter Monday 2026 — the plan's anchor.
    expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
    // Boże Ciało 2026 — Easter + 60, across April, May and into June.
    expect(addDays("2026-04-05", 60)).toBe("2026-06-04");
  });

  it("carries across a year boundary in both directions", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("counts 29 February in a leap year", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
  });

  it("skips it in a common year", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
