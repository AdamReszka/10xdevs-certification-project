import { describe, expect, it } from "vitest";

import { buildAvailabilityGrid } from "@/components/organisms/dashboard/availability-view";

/**
 * S-08 Phase 5 — the availability tab's grid logic: which cells are marked
 * absent.
 *
 * WHICH WINDOW "NEXT" MEANS MOVED OUT (S-18). It is no longer derived from the
 * current sprint's own span but from the lead's resolved cadence, which only the
 * server can read — so it lives in `lib/dashboard/next-window.ts` and is covered
 * by `next-window.test.ts`.
 */

const SPRINT_START = new Date("2026-08-03T00:00:00.000Z"); // Mon
const SPRINT_END = new Date("2026-08-14T23:59:59.999Z"); // Fri, a 12-day span

const MEMBERS = [
  { id: "m-1", name: "Mia Krystof", isActive: true },
  { id: "m-2", name: "Sam Lee", isActive: true },
];

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
