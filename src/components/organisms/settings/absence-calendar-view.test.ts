import { describe, expect, it } from "vitest";

import {
  coveredDays,
  dayKeyToPickerDate,
  defaultIsPlanned,
  describeAbsence,
  hasClientOverlap,
  pickerDateToDayKey,
  toAbsenceRows,
} from "@/components/organisms/settings/absence-calendar-view";

/**
 * S-08 Phase 2 — the absence editor's decision logic.
 *
 * There is no component-test harness (no jsdom, no RTL), so every judgement the
 * editor makes lives here, in a pure sibling, where it can be unit-tested:
 * which days a window covers, which rows the grid renders, the advisory overlap
 * warning shown before the server refuses the save, the D2-derived default for
 * the "planned" checkbox, and the sentence the delete confirmation uses to name
 * what it is about to destroy.
 */

const WARSAW = "Europe/Warsaw";

const MEMBERS = [
  { id: "m-1", name: "Mia Krystof" },
  { id: "m-2", name: "Sam Lee" },
];

/** A stored row as the server component hands it to the client. */
function stored(over: Partial<Parameters<typeof toAbsenceRows>[0]["absences"][number]> = {}) {
  return {
    id: "a-1",
    teamMemberId: "m-1",
    type: "VACATION" as const,
    isPlanned: true,
    startDate: new Date("2026-05-04T22:00:00.000Z"),
    endDate: new Date("2026-05-09T21:59:59.999Z"),
    ...over,
  };
}

describe("coveredDays", () => {
  it("lists every day of the window, both ends included", () => {
    expect(coveredDays("2026-05-05", "2026-05-09", WARSAW)).toEqual([
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ]);
  });

  it("returns the single day of a one-day absence", () => {
    expect(coveredDays("2026-05-05", "2026-05-05", WARSAW)).toEqual(["2026-05-05"]);
  });

  it("keeps the day count right across a DST spring-forward", () => {
    // 2026-03-29 is the CET→CEST transition in Warsaw. A fixed 24h step would
    // either skip or repeat a local day; the count must stay 3.
    expect(coveredDays("2026-03-28", "2026-03-30", WARSAW)).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
  });
});

describe("toAbsenceRows", () => {
  it("joins each absence to its member and reads back the local day keys", () => {
    const rows = toAbsenceRows({
      absences: [stored()],
      members: MEMBERS,
      timeZone: WARSAW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "a-1",
      memberName: "Mia Krystof",
      // The stored end instant is 21:59:59.999Z — the 9th locally, not the 10th.
      startDay: "2026-05-05",
      endDay: "2026-05-09",
    });
    expect(rows[0].days).toHaveLength(5);
  });

  it("orders by start day, then by member name", () => {
    const rows = toAbsenceRows({
      absences: [
        stored({ id: "later", startDate: new Date("2026-05-17T22:00:00.000Z"), endDate: new Date("2026-05-18T21:59:59.999Z") }),
        stored({ id: "sam", teamMemberId: "m-2" }),
        stored({ id: "mia" }),
      ],
      members: MEMBERS,
      timeZone: WARSAW,
    });

    expect(rows.map((r) => r.id)).toEqual(["mia", "sam", "later"]);
  });

  it("still renders an absence whose member is missing from the roster", () => {
    // Dropping it would hide hand-entered data the owner can no longer delete.
    const rows = toAbsenceRows({
      absences: [stored({ teamMemberId: "gone" })],
      members: MEMBERS,
      timeZone: WARSAW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].memberName).toBe("Unknown member");
  });
});

describe("hasClientOverlap", () => {
  const rows = toAbsenceRows({
    absences: [stored()],
    members: MEMBERS,
    timeZone: WARSAW,
  });

  it("warns when the candidate shares a day with the same member's window", () => {
    expect(
      hasClientOverlap(
        { teamMemberId: "m-1", startDay: "2026-05-09", endDay: "2026-05-12" },
        rows,
      ),
    ).toBe(true);
  });

  it("stays quiet for an adjacent window that shares no day", () => {
    expect(
      hasClientOverlap(
        { teamMemberId: "m-1", startDay: "2026-05-10", endDay: "2026-05-12" },
        rows,
      ),
    ).toBe(false);
  });

  it("stays quiet for a different member on the same days", () => {
    expect(
      hasClientOverlap(
        { teamMemberId: "m-2", startDay: "2026-05-05", endDay: "2026-05-09" },
        rows,
      ),
    ).toBe(false);
  });

  it("does not flag the row being edited against itself", () => {
    expect(
      hasClientOverlap(
        { id: "a-1", teamMemberId: "m-1", startDay: "2026-05-05", endDay: "2026-05-09" },
        rows,
      ),
    ).toBe(false);
  });
});

describe("defaultIsPlanned", () => {
  it("pre-checks an absence that starts before the sprint did (D2)", () => {
    expect(defaultIsPlanned("2026-05-01", "2026-05-04")).toBe(true);
  });

  it("leaves an absence starting after the sprint began unchecked", () => {
    // The sprint was committed without knowing about it — that is what makes it
    // unplanned, and what SPRINT_AT_RISK keys off.
    expect(defaultIsPlanned("2026-05-06", "2026-05-04")).toBe(false);
  });

  it("treats an absence starting on the sprint's first day as unplanned", () => {
    expect(defaultIsPlanned("2026-05-04", "2026-05-04")).toBe(false);
  });

  it("defaults to planned when there is no sprint to be surprised by", () => {
    expect(defaultIsPlanned("2026-05-06", null)).toBe(true);
  });
});

describe("describeAbsence", () => {
  const [row] = toAbsenceRows({
    absences: [stored()],
    members: MEMBERS,
    timeZone: WARSAW,
  });

  it("names the person, the kind and the days, so the delete dialog can quote it", () => {
    expect(describeAbsence(row)).toBe("Mia Krystof — vacation, 5 May 2026 – 9 May 2026");
  });

  it("collapses a single-day absence to one date", () => {
    const [oneDay] = toAbsenceRows({
      absences: [stored({ endDate: new Date("2026-05-05T21:59:59.999Z") })],
      members: MEMBERS,
      timeZone: WARSAW,
    });

    expect(describeAbsence(oneDay)).toBe("Mia Krystof — vacation, 5 May 2026");
  });
});

describe("picker date ↔ day key", () => {
  /**
   * `react-day-picker` hands back a BROWSER-LOCAL `Date` for the cell the user
   * clicked. Reading it through the TEAM's zone would be wrong twice over: a lead
   * in Warsaw picking 5 May for a team zoned to Los Angeles must still record
   * 5 May, and the round-trip has to be stable in either direction. So this pair
   * — and only this pair — reads and writes the local calendar fields directly.
   */
  it("reads the local calendar day the user actually clicked", () => {
    // Built from local parts, read back as local parts: true in any TZ the
    // suite happens to run in.
    expect(pickerDateToDayKey(new Date(2026, 4, 5))).toBe("2026-05-05");
  });

  it("zero-pads single-digit months and days", () => {
    expect(pickerDateToDayKey(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("round-trips a day key through the picker and back", () => {
    expect(pickerDateToDayKey(dayKeyToPickerDate("2026-05-05"))).toBe("2026-05-05");
  });

  it("lands mid-day so a DST shift cannot roll the date over", () => {
    // Local midnight does not exist on some spring-forward days; midday always does.
    expect(dayKeyToPickerDate("2026-03-29").getHours()).toBe(12);
  });
});
