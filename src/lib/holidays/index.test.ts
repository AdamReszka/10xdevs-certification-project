import { describe, expect, it } from "vitest";

import { SUPPORTED_COUNTRIES, holidaysForYear } from "@/lib/holidays";

/**
 * S-17 Phase 3 — the engine, year by year.
 *
 * The anchors are checked against the published Polish calendar rather than
 * re-derived from the implementation, and they are the two the whole
 * Easter path hangs off: Easter Monday and Boże Ciało in 2026.
 */
describe("holidaysForYear", () => {
  it("returns Poland's fourteen for 2026, with both Easter anchors", () => {
    const days = holidaysForYear("PL", 2026);

    expect(days).toHaveLength(14);
    // Easter Sunday 2026 is 5 April, so Easter Monday is the 6th...
    expect(days).toContainEqual({
      day: "2026-04-06",
      label: "Poniedziałek Wielkanocny",
    });
    // ...and Boże Ciało, Easter + 60, is 4 June.
    expect(days).toContainEqual({ day: "2026-06-04", label: "Boże Ciało" });
  });

  it("returns thirteen for 2024 and fourteen for 2025 — the Wigilia boundary", () => {
    const y2024 = holidaysForYear("PL", 2024);
    const y2025 = holidaysForYear("PL", 2025);

    expect(y2024).toHaveLength(13);
    expect(y2025).toHaveLength(14);
    expect(y2024.map((d) => d.day)).not.toContain("2024-12-24");
    expect(y2025.map((d) => d.day)).toContain("2025-12-24");
  });

  it("dates every day inside the year it was asked about", () => {
    // A rule reaching into a neighbouring year would be an approval that
    // silently writes a day the lead never reviewed.
    for (const { day } of holidaysForYear("PL", 2026)) {
      expect(day.startsWith("2026-")).toBe(true);
    }
  });

  it("returns them sorted, oldest first", () => {
    const days = holidaysForYear("PL", 2026).map((d) => d.day);
    expect(days).toEqual([...days].sort());
  });

  it("returns no duplicate dates", () => {
    const days = holidaysForYear("PL", 2026).map((d) => d.day);
    expect(new Set(days).size).toBe(days.length);
  });

  it("returns [] for an unknown country rather than throwing", () => {
    // Reachable: a code stored on an account outliving its removal from
    // SUPPORTED_COUNTRIES. Degrade, do not crash the dashboard.
    expect(() => holidaysForYear("XX", 2026)).not.toThrow();
    expect(holidaysForYear("XX", 2026)).toEqual([]);
  });

  it("is not case-insensitive by accident", () => {
    // The stored value is what the picker submitted, and the picker submits
    // SUPPORTED_COUNTRIES' own codes. A lowercase match here would hide a
    // mismatch between what is stored and what is offered.
    expect(holidaysForYear("pl", 2026)).toEqual([]);
  });
});

describe("SUPPORTED_COUNTRIES", () => {
  it("offers only countries the engine actually has rules for", () => {
    for (const country of SUPPORTED_COUNTRIES) {
      expect(holidaysForYear(country.code, 2026).length).toBeGreaterThan(0);
      expect(country.name.trim().length).toBeGreaterThan(0);
    }
  });
});
