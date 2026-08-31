import { describe, expect, it } from "vitest";

import { holidayProposal, holidayYears } from "@/lib/holidays/proposal";

/**
 * S-17 Phase 4 — what is offered, and what is deliberately not.
 *
 * The load-bearing case is the approved year: it is the single rule that keeps
 * a holiday the lead deleted from coming back on the next render, which is the
 * S-30 class of defect this slice exists to avoid rebuilding.
 */

const NONE = new Set<string>();
const NO_YEARS = new Set<number>();

describe("holidayProposal", () => {
  it("offers the whole year when nothing is approved and nothing is recorded", () => {
    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026],
      approvedYears: NO_YEARS,
      existingDays: NONE,
    });

    expect(proposed).toHaveLength(14);
    expect(proposed.every((p) => p.year === 2026)).toBe(true);
  });

  it("offers NOTHING for an approved year", () => {
    // Not "the days that are missing" — nothing at all. This is what keeps a
    // derived day the lead deleted deleted.
    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026],
      approvedYears: new Set([2026]),
      existingDays: NONE,
    });

    expect(proposed).toEqual([]);
  });

  it("omits a day already on the account", () => {
    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026],
      approvedYears: NO_YEARS,
      existingDays: new Set(["2026-01-01"]),
    });

    expect(proposed).toHaveLength(13);
    expect(proposed.map((p) => p.day)).not.toContain("2026-01-01");
  });

  it("proposes both years when the sprint crosses a boundary, each tagged", () => {
    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026, 2027],
      approvedYears: NO_YEARS,
      existingDays: NONE,
    });

    expect(proposed).toHaveLength(28);
    expect(new Set(proposed.map((p) => p.year))).toEqual(new Set([2026, 2027]));
    // Every day belongs to the year it is tagged with, so an approval can stamp
    // the two independently.
    expect(proposed.every((p) => p.day.startsWith(String(p.year)))).toBe(true);
  });

  it("skips only the approved half of a two-year window", () => {
    const proposed = holidayProposal({
      countryCode: "PL",
      years: [2026, 2027],
      approvedYears: new Set([2026]),
      existingDays: NONE,
    });

    expect(proposed).toHaveLength(14);
    expect(proposed.every((p) => p.year === 2027)).toBe(true);
  });

  it("returns [] for a country with no rules rather than throwing", () => {
    expect(() =>
      holidayProposal({
        countryCode: "XX",
        years: [2026],
        approvedYears: NO_YEARS,
        existingDays: NONE,
      }),
    ).not.toThrow();
  });

  it("returns them sorted by date across both years", () => {
    const days = holidayProposal({
      countryCode: "PL",
      years: [2026, 2027],
      approvedYears: NO_YEARS,
      existingDays: NONE,
    }).map((p) => p.day);

    expect(days).toEqual([...days].sort());
  });
});

describe("holidayYears", () => {
  const NOW = new Date("2026-08-31T10:00:00.000Z");

  it("is one year for a sprint inside one year", () => {
    expect(
      holidayYears({
        sprintStart: new Date("2026-08-17T08:00:00.000Z"),
        sprintEnd: new Date("2026-08-31T08:00:00.000Z"),
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026]);
  });

  it("is both years for a sprint that crosses 31 December", () => {
    // The mid-December failure: the sprint's January days would otherwise be
    // counted as ordinary working days for the whole sprint.
    expect(
      holidayYears({
        sprintStart: new Date("2026-12-21T08:00:00.000Z"),
        sprintEnd: new Date("2027-01-04T08:00:00.000Z"),
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026, 2027]);
  });

  it("reads the boundary in the TEAM's zone, not UTC", () => {
    // 23:30 UTC on 31 December is already 1 January in Warsaw, so this sprint
    // ends in 2027 for the team that runs it.
    expect(
      holidayYears({
        sprintStart: new Date("2026-12-21T08:00:00.000Z"),
        sprintEnd: new Date("2026-12-31T23:30:00.000Z"),
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026, 2027]);
  });

  it("falls back to the year `now` falls in when there is no sprint", () => {
    expect(
      holidayYears({
        sprintStart: null,
        sprintEnd: null,
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026]);
  });

  it("still asks about today's year when the sprint window is stale", () => {
    // IMPL-REVIEW F1. `getActiveSprintRow` returns the most-recently-started
    // sprint when none is ACTIVE, so this window belongs to a sprint that ended
    // a fortnight ago. Taking it alone left 2026 — already approved — as the
    // only year asked about, and both surfaces went silent while 1 and 6
    // January 2027 counted as ordinary working days.
    expect(
      holidayYears({
        sprintStart: new Date("2026-12-07T08:00:00.000Z"),
        sprintEnd: new Date("2026-12-20T08:00:00.000Z"),
        now: new Date("2027-01-05T09:00:00.000Z"),
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026, 2027]);
  });

  it("adds no year when the sprint already spans today", () => {
    // The union is monotonic: it widens the window in the stale case and in no
    // other, so the ordinary mid-sprint account is unaffected.
    expect(
      holidayYears({
        sprintStart: new Date("2026-08-24T08:00:00.000Z"),
        sprintEnd: new Date("2026-09-04T08:00:00.000Z"),
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026]);
  });

  it("falls back when a sprint row carries only one of the two dates", () => {
    expect(
      holidayYears({
        sprintStart: new Date("2026-12-21T08:00:00.000Z"),
        sprintEnd: null,
        now: NOW,
        timeZone: "Europe/Warsaw",
      }),
    ).toEqual([2026]);
  });
});
