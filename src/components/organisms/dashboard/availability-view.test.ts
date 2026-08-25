import { describe, expect, it } from "vitest";

import {
  buildAvailabilityGrid,
  nextWindowAfter,
} from "@/components/organisms/dashboard/availability-view";

/**
 * S-08 Phase 5 — the availability tab's grid logic.
 *
 * Two things get decided here and nowhere else: which window "next" means, and
 * which cells are marked absent. The second sprint window is derived from the
 * CURRENT sprint's own length rather than from `sprint.length_days` /
 * `start_day`, because those cadence columns are written by the importer and read
 * by nothing — they carry no test coverage and no guarantee of agreeing with the
 * dates the sprint actually ran on.
 */

const SPRINT_START = new Date("2026-08-03T00:00:00.000Z"); // Mon
const SPRINT_END = new Date("2026-08-14T23:59:59.999Z"); // Fri, a 12-day span

const MEMBERS = [
  { id: "m-1", name: "Mia Krystof", isActive: true },
  { id: "m-2", name: "Sam Lee", isActive: true },
];

describe("nextWindowAfter", () => {
  /**
   * These assert on the DAYS the two grids actually draw, not on the arithmetic
   * the function performs. The earlier version restated `end + 1ms` back to
   * itself and therefore could not fail — which is exactly how the overlap below
   * shipped (impl-review F1/F3).
   */
  function daysOf(from: Date, to: Date, timeZone: string | null) {
    return buildAvailabilityGrid({ members: MEMBERS, absences: [], from, to, timeZone })
      .days;
  }

  it("does not share a day with the sprint when the sprint ends mid-day", () => {
    // The load-bearing case: real Jira sprints end at an arbitrary instant.
    // `run-sync.integration.test.ts` stores 2026-08-31T08:00:00.000Z.
    const start = new Date("2026-08-17T08:00:00.000Z");
    const end = new Date("2026-08-28T08:00:00.000Z");
    const next = nextWindowAfter(start, end, "UTC");

    const current = daysOf(start, end, "UTC");
    const upcoming = daysOf(next.from, next.to, "UTC");

    expect(current.at(-1)).toBe("2026-08-28");
    expect(upcoming[0]).toBe("2026-08-29");
    expect(current.filter((d) => upcoming.includes(d))).toEqual([]);
  });

  it("does not share a day when the sprint ends at the last instant of a day", () => {
    const next = nextWindowAfter(SPRINT_START, SPRINT_END, "UTC");

    const current = daysOf(SPRINT_START, SPRINT_END, "UTC");
    const upcoming = daysOf(next.from, next.to, "UTC");

    expect(current.at(-1)).toBe("2026-08-14");
    expect(upcoming[0]).toBe("2026-08-15");
    expect(current.filter((d) => upcoming.includes(d))).toEqual([]);
  });

  it("resolves the boundary in the team's zone, not in UTC", () => {
    // 2026-08-28T08:00Z is still 2026-08-28 in Warsaw (+2) but 2026-08-28 01:00
    // in Los Angeles — and an end at 2026-08-29T04:00Z is the 29th in Warsaw and
    // still the 28th in LA, so the next window starts on a different day in each.
    const start = new Date("2026-08-17T08:00:00.000Z");
    const end = new Date("2026-08-29T04:00:00.000Z");

    expect(
      daysOf(
        nextWindowAfter(start, end, "Europe/Warsaw").from,
        nextWindowAfter(start, end, "Europe/Warsaw").to,
        "Europe/Warsaw",
      )[0],
    ).toBe("2026-08-30");
    expect(
      daysOf(
        nextWindowAfter(start, end, "America/Los_Angeles").from,
        nextWindowAfter(start, end, "America/Los_Angeles").to,
        "America/Los_Angeles",
      )[0],
    ).toBe("2026-08-29");
  });

  it("keeps the next window the same length as the sprint", () => {
    const start = new Date("2026-08-17T08:00:00.000Z");
    const end = new Date("2026-08-28T08:00:00.000Z");
    const next = nextWindowAfter(start, end, "UTC");

    expect(daysOf(next.from, next.to, "UTC")).toHaveLength(
      daysOf(start, end, "UTC").length,
    );
  });
});

describe("buildAvailabilityGrid", () => {
  it("puts every day of the window on the axis, in order", () => {
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    expect(grid.days).toHaveLength(12);
    expect(grid.days[0]).toBe("2026-08-03");
    expect(grid.days.at(-1)).toBe("2026-08-14");
  });

  it("marks exactly the days an absence covers, both ends included", () => {
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-08-05T00:00:00.000Z"),
          endDate: new Date("2026-08-07T23:59:59.999Z"),
        },
      ],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    const mia = grid.rows.find((r) => r.memberId === "m-1")!;
    expect([...mia.absentDays].sort()).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    expect(grid.rows.find((r) => r.memberId === "m-2")!.absentDays.size).toBe(0);
  });

  it("clips an absence that starts before the window opens", () => {
    // Only the part inside the window may be marked — otherwise the grid would
    // claim days it does not draw.
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-07-28T00:00:00.000Z"),
          endDate: new Date("2026-08-04T23:59:59.999Z"),
        },
      ],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    expect([...grid.rows.find((r) => r.memberId === "m-1")!.absentDays].sort()).toEqual([
      "2026-08-03",
      "2026-08-04",
    ]);
  });

  it("ignores an absence that shares no day with the window", () => {
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: new Date("2026-09-04T23:59:59.999Z"),
        },
      ],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    expect(grid.rows.every((r) => r.absentDays.size === 0)).toBe(true);
  });

  it("keeps a row for every active member, even one who is never away", () => {
    // An empty row is the signal "this person is around" — dropping it would
    // make the grid unreadable as a team view.
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    expect(grid.rows.map((r) => r.memberName)).toEqual(["Mia Krystof", "Sam Lee"]);
  });

  it("leaves deactivated members out of the grid", () => {
    const grid = buildAvailabilityGrid({
      members: [...MEMBERS, { id: "m-3", name: "Gone Away", isActive: false }],
      absences: [],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "UTC",
    });

    expect(grid.rows.map((r) => r.memberId)).toEqual(["m-1", "m-2"]);
  });

  it("buckets days in the team's zone", () => {
    // 2026-08-03T00:00Z is Sunday 2 Aug in Los Angeles, so the axis there opens
    // a day earlier than it does in UTC.
    const grid = buildAvailabilityGrid({
      members: MEMBERS,
      absences: [],
      from: SPRINT_START,
      to: SPRINT_END,
      timeZone: "America/Los_Angeles",
    });

    expect(grid.days[0]).toBe("2026-08-02");
  });
});
