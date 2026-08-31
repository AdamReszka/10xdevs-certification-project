import { describe, expect, it } from "vitest";

import {
  dayKeyToPickerDate,
  formatDayOff,
  pickerDateToDayKey,
  toTeamDayOffRows,
  weekdayOfDayKey,
} from "@/components/organisms/settings/team-days-off-view";

/**
 * S-23 Phase 2 — the pure half of the team-days-off surface (FR-007).
 *
 * There is no component-test harness in this project, so this file is the only
 * place the editor's judgements are checked. Two of them matter:
 *
 *  - `costsNothing` must agree with `countTeamDaysOffInclusive`, which counts a
 *    day off only when it lands on a working weekday. If the badge and the
 *    counter disagreed, a holiday on a Saturday would either read as a bug
 *    ("capacity did not move") or hide a real one.
 *  - the day-key ↔ picker-`Date` round trip must be zone-stable. The picker
 *    hands back LOCAL midnight; reading it in UTC moves a click made east of
 *    Greenwich onto the previous day, and a holiday off by one is worse than no
 *    holiday at all.
 */

const WEEK = ["MON", "TUE", "WED", "THU", "FRI"];

describe("weekdayOfDayKey", () => {
  it("reads the calendar weekday, not the viewer's", () => {
    expect(weekdayOfDayKey("2026-08-03")).toBe("MON");
    expect(weekdayOfDayKey("2026-08-08")).toBe("SAT");
    expect(weekdayOfDayKey("2026-08-09")).toBe("SUN");
  });
});

describe("formatDayOff", () => {
  it("names the weekday, so a Saturday holiday is obvious on sight", () => {
    expect(formatDayOff("2026-08-05")).toBe("Wed, 5 Aug 2026");
    expect(formatDayOff("2026-08-08")).toBe("Sat, 8 Aug 2026");
  });
});

describe("toTeamDayOffRows", () => {
  const daysOff = [
    { id: "b", day: "2026-08-15", label: "Assumption of Mary" },
    { id: "a", day: "2026-08-05", label: null },
  ];

  it("sorts chronologically regardless of input order", () => {
    const rows = toTeamDayOffRows({ daysOff, workingDays: WEEK });
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("flags a day that was not a working day anyway", () => {
    const rows = toTeamDayOffRows({ daysOff, workingDays: WEEK });
    // Wed 5 Aug is a working day; Sat 15 Aug is not.
    expect(rows[0].costsNothing).toBe(false);
    expect(rows[1].costsNothing).toBe(true);
  });

  it("follows the team's own working week, not Mon–Fri", () => {
    // A Sat–Wed week: now Saturday costs a man-day and Thursday does not.
    const rows = toTeamDayOffRows({
      daysOff,
      workingDays: ["SAT", "SUN", "MON", "TUE", "WED"],
    });
    expect(rows[1].costsNothing).toBe(false);
  });

  it("falls back to Mon–Fri when the sprint carries no cadence", () => {
    const rows = toTeamDayOffRows({ daysOff, workingDays: null });
    expect(rows[0].costsNothing).toBe(false);
    expect(rows[1].costsNothing).toBe(true);
  });

  it("treats an empty working-day list as absent, not as 'no days are worked'", () => {
    // `[]` is what an unconfigured cadence looks like. Reading it literally
    // would mark every recorded holiday as costing nothing.
    const rows = toTeamDayOffRows({ daysOff, workingDays: [] });
    expect(rows[0].costsNothing).toBe(false);
  });

  it("carries the label through untouched, null included", () => {
    const rows = toTeamDayOffRows({ daysOff, workingDays: WEEK });
    expect(rows[0].label).toBeNull();
    expect(rows[1].label).toBe("Assumption of Mary");
  });

  /**
   * S-17 — provenance. `team_day_off.source` is written by the generator and
   * read here; the three cases below are the whole contract, and the last two
   * are what keeps a marker off a row the lead typed themselves.
   */
  it("marks a generated row as derived", () => {
    const rows = toTeamDayOffRows({
      daysOff: [{ id: "a", day: "2026-08-15", label: "Wniebowzięcie", source: "derived" }],
      workingDays: WEEK,
    });
    expect(rows[0].isDerived).toBe(true);
  });

  it("does not mark a hand-entered row", () => {
    const rows = toTeamDayOffRows({
      daysOff: [{ id: "a", day: "2026-08-15", label: "Offsite", source: "manual" }],
      workingDays: WEEK,
    });
    expect(rows[0].isDerived).toBe(false);
  });

  it("reads an absent or unrecognised source as the lead's own", () => {
    // Every row written before the migration, and any value a later country
    // might introduce. Guessing "derived" here would take credit for work the
    // lead did by hand.
    const rows = toTeamDayOffRows({
      daysOff: [
        { id: "a", day: "2026-08-05", label: null },
        { id: "b", day: "2026-08-15", label: null, source: "something-else" },
      ],
      workingDays: WEEK,
    });
    expect(rows.map((r) => r.isDerived)).toEqual([false, false]);
  });
});

describe("day key ↔ picker date", () => {
  it("round-trips without drifting a day", () => {
    for (const dayKey of ["2026-01-01", "2026-08-05", "2026-12-31"]) {
      expect(pickerDateToDayKey(dayKeyToPickerDate(dayKey))).toBe(dayKey);
    }
  });

  it("anchors at local midday so a spring-forward date cannot roll over", () => {
    // Local midnight does not exist on some DST transition days; midday always
    // does, in every zone.
    expect(dayKeyToPickerDate("2026-03-29").getHours()).toBe(12);
  });

  it("zero-pads month and day", () => {
    expect(pickerDateToDayKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});
