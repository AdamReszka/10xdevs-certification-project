import { describe, expect, it } from "vitest";

import { computeSprintCapacity } from "@/lib/dashboard/capacity";

/**
 * S-23 Phase 1 — the sprint's capacity in MAN-DAYS, and `team_member.fte`'s only
 * reader.
 *
 * Every expectation is hand-derived from FR-022's definition: a member
 * contributes `fte × available working days`, where availability is the sprint's
 * working days minus the ones their recorded absences cover. The sprint below
 * runs Mon 2026-08-03 → Fri 2026-08-14 with a Mon–Fri week: 10 working days, so
 * a full-timer is worth 10 MD and a half-timer 5 MD.
 *
 * WHAT CHANGED FROM S-08, and why the numbers here are not a re-unit of the old
 * ones: the previous reducer computed `spCapacity × (available ÷ total)`, a
 * ratio that CANCELS the day dimension — the working-day count divided out and
 * the result carried whatever unit the roster column happened to hold. Here the
 * count is a multiplier, so `sprintWorkingDays` is load-bearing in every case
 * below rather than an invisible intermediate.
 *
 * The old suite's load-bearing case was the NULL one. It is gone with the column:
 * `fte` is NOT NULL, so "not answered yet" is not a state this reducer can meet.
 * The equivalent risk moved to the `/settings/team` banner, which surfaces a
 * value the MIGRATION guessed rather than one the reducer had to skip.
 */

const SPRINT_START = new Date("2026-08-03T00:00:00.000Z"); // Mon
const SPRINT_END = new Date("2026-08-14T23:59:59.999Z"); // Fri, 10 working days

function compute(
  members: { id: string; fte: number; isActive?: boolean }[],
  absences: { teamMemberId: string; startDate: Date; endDate: Date }[] = [],
  nonWorkingDays: ReadonlySet<string> = new Set(),
) {
  return computeSprintCapacity({
    members: members.map((m) => ({ isActive: true, ...m })),
    absences,
    sprintStart: SPRINT_START,
    sprintEnd: SPRINT_END,
    workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    timeZone: "UTC",
    nonWorkingDays,
  });
}

/** Mon 2026-08-10 → Fri 2026-08-14 inclusive: 5 of the sprint's 10 working days. */
const HALF_THE_SPRINT = {
  teamMemberId: "m-1",
  startDate: new Date("2026-08-10T00:00:00.000Z"),
  endDate: new Date("2026-08-14T23:59:59.999Z"),
};

describe("computeSprintCapacity", () => {
  it("is fte × working days per member when nobody is away", () => {
    const result = compute([
      { id: "m-1", fte: 1 },
      { id: "m-2", fte: 1 },
    ]);

    expect(result).toMatchObject({
      adjustedMd: 20,
      nominalMd: 20,
      sprintWorkingDays: 10,
    });
  });

  it("scales a part-timer by their fraction, not by a hand-entered total", () => {
    // The whole point of the unit change: 0.5 and 0.25 are facts about the
    // people, and the man-days follow from the sprint's length rather than from
    // a number somebody guessed at once and never revisited.
    const result = compute([
      { id: "m-1", fte: 1 },
      { id: "m-2", fte: 0.5 },
      { id: "m-3", fte: 0.25 },
    ]);

    expect(result.adjustedMd).toBeCloseTo(17.5);
    expect(result.nominalMd).toBeCloseTo(17.5);
  });

  it("halves a member's contribution when they are away half the sprint", () => {
    const result = compute(
      [
        { id: "m-1", fte: 1 },
        { id: "m-2", fte: 1 },
      ],
      [HALF_THE_SPRINT],
    );

    // m-1: 1 × 5 = 5. m-2 untouched: 10. Nominal stays the un-reduced 20.
    expect(result.adjustedMd).toBeCloseTo(15);
    expect(result.nominalMd).toBe(20);
  });

  it("costs a part-timer only their fraction of each absent day", () => {
    // A half-timer away for 5 of 10 working days loses 2.5 MD, not 5.
    const result = compute([{ id: "m-1", fte: 0.5 }], [HALF_THE_SPRINT]);

    expect(result.adjustedMd).toBeCloseTo(2.5);
    expect(result.nominalMd).toBeCloseTo(5);
  });

  it("contributes nothing for a member away the whole sprint", () => {
    const result = compute(
      [{ id: "m-1", fte: 1 }],
      [{ teamMemberId: "m-1", startDate: SPRINT_START, endDate: SPRINT_END }],
    );

    expect(result.adjustedMd).toBe(0);
    expect(result.nominalMd).toBe(10);
  });

  it("clips an absence that spills past the sprint's edges", () => {
    // A six-week holiday costs this sprint 10 working days, not 30.
    const result = compute(
      [{ id: "m-1", fte: 1 }],
      [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-07-20T00:00:00.000Z"),
          endDate: new Date("2026-08-28T23:59:59.999Z"),
        },
      ],
    );

    expect(result.adjustedMd).toBe(0);
    expect(result.nominalMd).toBe(10);
  });

  it("ignores deactivated members entirely", () => {
    const result = compute([
      { id: "m-1", fte: 1 },
      { id: "m-2", fte: 1, isActive: false },
      { id: "m-3", fte: 0.5, isActive: false },
    ]);

    expect(result).toMatchObject({ adjustedMd: 10, nominalMd: 10 });
  });

  it("is zero — not NaN — when the sprint has no working days", () => {
    const result = computeSprintCapacity({
      members: [{ id: "m-1", fte: 1, isActive: true }],
      absences: [],
      // Sat → Sun with a Mon–Fri week.
      sprintStart: new Date("2026-08-15T00:00:00.000Z"),
      sprintEnd: new Date("2026-08-16T23:59:59.999Z"),
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      timeZone: "UTC",
      nonWorkingDays: new Set(),
    });

    expect(result.sprintWorkingDays).toBe(0);
    expect(result.adjustedMd).toBe(0);
    expect(Number.isNaN(result.adjustedMd)).toBe(false);
    // No working days means no man-days — the ceiling is 0 too, unlike the S-08
    // version where the nominal total came from the roster and stood alone.
    expect(result.nominalMd).toBe(0);
  });

  it("counts only working days, so a weekend absence costs nothing", () => {
    const result = compute(
      [{ id: "m-1", fte: 1 }],
      [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-08-08T00:00:00.000Z"), // Sat
          endDate: new Date("2026-08-09T23:59:59.999Z"), // Sun
        },
      ],
    );

    expect(result.adjustedMd).toBe(10);
  });

  it("scales with the sprint's length, which the old ratio cancelled out", () => {
    // Same roster, half the sprint → half the capacity. Under
    // `sp × (available ÷ total)` this number was identical for both lengths,
    // which is exactly how a wrong working-day count stayed invisible.
    const oneWeek = computeSprintCapacity({
      members: [{ id: "m-1", fte: 1, isActive: true }],
      absences: [],
      sprintStart: SPRINT_START,
      sprintEnd: new Date("2026-08-07T23:59:59.999Z"), // Fri of week one
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      timeZone: "UTC",
      nonWorkingDays: new Set(),
    });

    expect(oneWeek.sprintWorkingDays).toBe(5);
    expect(oneWeek.adjustedMd).toBe(5);
    expect(compute([{ id: "m-1", fte: 1 }]).adjustedMd).toBe(10);
  });
});

/**
 * S-23 Phase 2 — team-wide days off (FR-007/FR-022).
 *
 * The sprint is unchanged: Mon 2026-08-03 → Fri 2026-08-14, 10 working days. Wed
 * 2026-08-05 is the holiday used throughout, so every expectation below is one
 * working day lighter than its sibling above and can be checked by hand.
 *
 * The DOUBLE-SUBTRACTION case is the one that pays for this suite. A holiday
 * falling inside somebody's vacation must cost the team exactly one man-day for
 * that person, not two: once because the sprint never had the day, and again
 * because they were away for it. That is only true if the same set reaches BOTH
 * `countWorkingDaysInclusive` calls in the reducer — which is why half-wiring
 * the seam is the failure this test exists to catch.
 */
const HOLIDAY_WED = new Set(["2026-08-05"]);

describe("computeSprintCapacity with team-wide days off", () => {
  it("costs one man-day per full-time member", () => {
    const result = compute(
      [
        { id: "m-1", fte: 1 },
        { id: "m-2", fte: 1 },
      ],
      [],
      HOLIDAY_WED,
    );

    expect(result.sprintWorkingDays).toBe(9);
    expect(result.teamDaysOff).toBe(1);
    // 2 people × 9 days, not 2 × 10.
    expect(result.adjustedMd).toBe(18);
    expect(result.nominalMd).toBe(18);
  });

  it("costs a half-timer half a man-day", () => {
    const result = compute([{ id: "m-1", fte: 0.5 }], [], HOLIDAY_WED);

    expect(result.adjustedMd).toBe(4.5);
  });

  it("is not subtracted twice when it falls inside an absence", () => {
    // Mon 03 → Fri 07 inclusive: 5 calendar working days, 4 once the Wednesday
    // holiday is removed. The sprint is 9 working days, so the member is left
    // with 5.
    const result = compute(
      [{ id: "m-1", fte: 1 }],
      [
        {
          teamMemberId: "m-1",
          startDate: new Date("2026-08-03T00:00:00.000Z"),
          endDate: new Date("2026-08-07T23:59:59.999Z"),
        },
      ],
      HOLIDAY_WED,
    );

    expect(result.sprintWorkingDays).toBe(9);
    // 9 − 4 = 5. The holiday-blind reading would be 9 − 5 = 4, charging the team
    // for a day it had already lost.
    expect(result.adjustedMd).toBe(5);
    expect(result.nominalMd).toBe(9);
  });

  it("ignores a day off that falls on a non-working weekday", () => {
    // Sat 2026-08-08 was never a working day, so removing it changes nothing —
    // and must not show up as a reduction on screen either.
    const result = compute([{ id: "m-1", fte: 1 }], [], new Set(["2026-08-08"]));

    expect(result.sprintWorkingDays).toBe(10);
    expect(result.teamDaysOff).toBe(0);
    expect(result.adjustedMd).toBe(10);
  });

  it("ignores a day off outside the sprint window", () => {
    const result = compute([{ id: "m-1", fte: 1 }], [], new Set(["2026-07-29"]));

    expect(result.sprintWorkingDays).toBe(10);
    expect(result.teamDaysOff).toBe(0);
    expect(result.adjustedMd).toBe(10);
  });

  it("reports zero days off when the calendar is empty", () => {
    expect(compute([{ id: "m-1", fte: 1 }]).teamDaysOff).toBe(0);
  });
});
