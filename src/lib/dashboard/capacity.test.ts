import { describe, expect, it } from "vitest";

import { computeSprintCapacity } from "@/lib/dashboard/capacity";

/**
 * S-08 Phase 5 — the sprint's capacity number, and `sp_capacity`'s first reader.
 *
 * Every expectation is hand-derived from FR-010's definition: a member
 * contributes `spCapacity × (available working days ÷ sprint working days)`,
 * where availability is reduced by their recorded absences. The sprint below runs
 * Mon 2026-08-03 → Fri 2026-08-14 with a Mon–Fri week: 10 working days.
 *
 * The load-bearing case is the NULL one. `sp_capacity` is nullable and a null
 * must never silently read as zero — that would quietly understate the team's
 * capacity and give the lead a number they cannot tell is wrong.
 */

const SPRINT_START = new Date("2026-08-03T00:00:00.000Z"); // Mon
const SPRINT_END = new Date("2026-08-14T23:59:59.999Z"); // Fri, 10 working days

function compute(
  members: { id: string; spCapacity: number | null; isActive?: boolean }[],
  absences: { teamMemberId: string; startDate: Date; endDate: Date }[] = [],
) {
  return computeSprintCapacity({
    members: members.map((m) => ({ isActive: true, ...m })),
    absences,
    sprintStart: SPRINT_START,
    sprintEnd: SPRINT_END,
    workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    timeZone: "UTC",
  });
}

/** Mon 2026-08-10 → Fri 2026-08-14 inclusive: 5 of the sprint's 10 working days. */
const HALF_THE_SPRINT = {
  teamMemberId: "m-1",
  startDate: new Date("2026-08-10T00:00:00.000Z"),
  endDate: new Date("2026-08-14T23:59:59.999Z"),
};

describe("computeSprintCapacity", () => {
  it("sums every active member's capacity when nobody is away", () => {
    const result = compute([
      { id: "m-1", spCapacity: 8 },
      { id: "m-2", spCapacity: 5 },
    ]);

    expect(result).toMatchObject({
      adjustedSp: 13,
      nominalSp: 13,
      membersWithoutCapacity: 0,
      sprintWorkingDays: 10,
    });
  });

  it("halves a member's contribution when they are away half the sprint", () => {
    const result = compute(
      [
        { id: "m-1", spCapacity: 8 },
        { id: "m-2", spCapacity: 5 },
      ],
      [HALF_THE_SPRINT],
    );

    // m-1: 8 × 5/10 = 4. m-2 untouched: 5. Nominal stays the un-reduced 13.
    expect(result.adjustedSp).toBeCloseTo(9);
    expect(result.nominalSp).toBe(13);
  });

  it("contributes nothing for a member away the whole sprint", () => {
    const result = compute(
      [{ id: "m-1", spCapacity: 8 }],
      [
        {
          teamMemberId: "m-1",
          startDate: SPRINT_START,
          endDate: SPRINT_END,
        },
      ],
    );

    expect(result.adjustedSp).toBe(0);
    expect(result.nominalSp).toBe(8);
  });

  it("clips an absence that spills past the sprint's edges", () => {
    // A three-week holiday costs this sprint 10 working days, not 15.
    const result = compute(
      [{ id: "m-1", spCapacity: 8 }],
      [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-07-20T00:00:00.000Z"),
          endDate: new Date("2026-08-28T23:59:59.999Z"),
        },
      ],
    );

    expect(result.adjustedSp).toBe(0);
  });

  it("excludes a member with no capacity set and counts them separately", () => {
    // A null is "not answered yet", never zero: reading it as 0 would understate
    // the team and the lead could not tell the number was wrong.
    const result = compute([
      { id: "m-1", spCapacity: 8 },
      { id: "m-2", spCapacity: null },
    ]);

    expect(result).toMatchObject({
      adjustedSp: 8,
      nominalSp: 8,
      membersWithoutCapacity: 1,
    });
  });

  it("ignores deactivated members entirely", () => {
    const result = compute([
      { id: "m-1", spCapacity: 8 },
      { id: "m-2", spCapacity: 5, isActive: false },
      { id: "m-3", spCapacity: null, isActive: false },
    ]);

    expect(result).toMatchObject({
      adjustedSp: 8,
      nominalSp: 8,
      // A deactivated member is not a gap in the roster's data.
      membersWithoutCapacity: 0,
    });
  });

  it("does not divide by zero when the sprint has no working days", () => {
    const result = computeSprintCapacity({
      members: [{ id: "m-1", spCapacity: 8, isActive: true }],
      absences: [],
      // Sat → Sun with a Mon–Fri week.
      sprintStart: new Date("2026-08-15T00:00:00.000Z"),
      sprintEnd: new Date("2026-08-16T23:59:59.999Z"),
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      timeZone: "UTC",
    });

    expect(result.sprintWorkingDays).toBe(0);
    expect(result.adjustedSp).toBe(0);
    expect(Number.isNaN(result.adjustedSp)).toBe(false);
    // The un-reduced ceiling still reads truthfully.
    expect(result.nominalSp).toBe(8);
  });

  it("counts only working days, so a weekend absence costs nothing", () => {
    const result = compute(
      [{ id: "m-1", spCapacity: 8 }],
      [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-08-08T00:00:00.000Z"), // Sat
          endDate: new Date("2026-08-09T23:59:59.999Z"), // Sun
        },
      ],
    );

    expect(result.adjustedSp).toBe(8);
  });
});
