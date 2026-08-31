import { describe, expect, it, vi } from "vitest";

import {
  WORK_DAY_END_HOUR,
  WORK_DAY_START_HOUR,
  WORK_HOURS_PER_DAY,
  shiftWorkingHours,
  workingHoursAfter,
  workingHoursBefore,
  workingHoursBetween,
} from "@/lib/anomaly/rules/working-time";
import { hoursBetween } from "@/lib/anomaly/rules/helpers";

/**
 * The anchors below sit in the week of Mon 2026-08-03 — the same week
 * `helpers.test.ts` counts working days over, so the two calendars can be read
 * side by side. 08-03 Mon … 08-07 Fri, 08-08 Sat, 08-09 Sun, 08-10 Mon.
 */
const MON_FRI = ["MON", "TUE", "WED", "THU", "FRI"];

/** No team-wide days off. Named so the argument reads as a choice, not an
 *  omission — the seam is required everywhere (impl-review F6). */
const NO_DAYS_OFF: ReadonlySet<string> = new Set();

const at = (iso: string): Date => new Date(iso);

describe("the working window", () => {
  it("is 08:00–16:00, eight hours long", () => {
    expect(WORK_DAY_START_HOUR).toBe(8);
    expect(WORK_DAY_END_HOUR).toBe(16);
    expect(WORK_HOURS_PER_DAY).toBe(8);
  });
});

describe("workingHoursBetween", () => {
  it("measures a span that sits inside one working day", () => {
    expect(
      workingHoursBetween(
        at("2026-08-03T09:00:00.000Z"),
        at("2026-08-03T11:30:00.000Z"),
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toBe(2.5);
  });

  it("counts nothing for the night a span crosses", () => {
    // Mon 15:00 → Tue 09:00 is 18 wall-clock hours and 2 working ones.
    expect(
      workingHoursBetween(
        at("2026-08-03T15:00:00.000Z"),
        at("2026-08-04T09:00:00.000Z"),
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toBe(2);
  });

  it("counts nothing at all across a whole weekend", () => {
    // The defect this slice closes, in miniature: Friday close of business to
    // Monday open is 64 wall-clock hours and zero hours anyone could have acted in.
    const from = at("2026-08-07T16:00:00.000Z");
    const to = at("2026-08-10T08:00:00.000Z");
    expect(hoursBetween(from, to)).toBe(64);
    expect(workingHoursBetween(from, to, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(0);
  });

  it("ignores the parts of a span that fall outside the window", () => {
    // 06:00 → 18:00 is 12 wall-clock hours; only the shift counts.
    expect(
      workingHoursBetween(
        at("2026-08-03T06:00:00.000Z"),
        at("2026-08-03T18:00:00.000Z"),
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toBe(8);
    expect(
      workingHoursBetween(
        at("2026-08-03T16:00:00.000Z"),
        at("2026-08-03T18:00:00.000Z"),
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toBe(0);
  });

  it("removes exactly one working day for a team-wide day off", () => {
    const from = at("2026-08-03T08:00:00.000Z"); // Mon, start of shift
    const to = at("2026-08-05T08:00:00.000Z"); // Wed, start of shift
    expect(workingHoursBetween(from, to, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(16);
    expect(
      workingHoursBetween(from, to, MON_FRI, "UTC", new Set(["2026-08-04"])),
    ).toBe(8);
  });

  it("honours a working week that is not Mon–Fri", () => {
    const sunThu = ["SUN", "MON", "TUE", "WED", "THU"];
    // Friday is a working day for a Mon–Fri team and not for this one.
    const friFrom = at("2026-08-07T08:00:00.000Z");
    const friTo = at("2026-08-07T16:00:00.000Z");
    expect(workingHoursBetween(friFrom, friTo, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(
      8,
    );
    expect(workingHoursBetween(friFrom, friTo, sunThu, "UTC", NO_DAYS_OFF)).toBe(
      0,
    );
    // …and Sunday the other way round.
    const sunFrom = at("2026-08-09T08:00:00.000Z");
    const sunTo = at("2026-08-09T16:00:00.000Z");
    expect(workingHoursBetween(sunFrom, sunTo, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(
      0,
    );
    expect(workingHoursBetween(sunFrom, sunTo, sunThu, "UTC", NO_DAYS_OFF)).toBe(
      8,
    );
  });

  it("falls back to Mon–Fri when Jira told us nothing", () => {
    const satFrom = at("2026-08-08T08:00:00.000Z");
    const satTo = at("2026-08-08T16:00:00.000Z");
    expect(workingHoursBetween(satFrom, satTo, null, "UTC", NO_DAYS_OFF)).toBe(0);
    expect(workingHoursBetween(satFrom, satTo, [], "UTC", NO_DAYS_OFF)).toBe(0);
    const monFrom = at("2026-08-03T08:00:00.000Z");
    const monTo = at("2026-08-03T16:00:00.000Z");
    expect(workingHoursBetween(monFrom, monTo, null, "UTC", NO_DAYS_OFF)).toBe(8);
    expect(
      workingHoursBetween(monFrom, monTo, undefined, "UTC", NO_DAYS_OFF),
    ).toBe(8);
  });

  it("resolves the window in the TEAM's zone, not the server's", () => {
    // 06:00–08:00Z is before the shift in UTC and the first two hours of it in
    // Warsaw (UTC+2 in August). Same instants, different answer — which is the
    // whole reason the zone is a required argument.
    const from = at("2026-08-03T06:00:00.000Z");
    const to = at("2026-08-03T08:00:00.000Z");
    expect(workingHoursBetween(from, to, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(0);
    expect(
      workingHoursBetween(from, to, MON_FRI, "Europe/Warsaw", NO_DAYS_OFF),
    ).toBe(2);
  });

  it("degrades an absent or unrecognized zone to UTC", () => {
    const from = at("2026-08-03T06:00:00.000Z");
    const to = at("2026-08-03T10:00:00.000Z");
    const utc = workingHoursBetween(from, to, MON_FRI, "UTC", NO_DAYS_OFF);
    expect(utc).toBe(2);
    expect(workingHoursBetween(from, to, MON_FRI, null, NO_DAYS_OFF)).toBe(utc);
    expect(workingHoursBetween(from, to, MON_FRI, undefined, NO_DAYS_OFF)).toBe(
      utc,
    );
    expect(
      workingHoursBetween(from, to, MON_FRI, "Nowhere/Nothing", NO_DAYS_OFF),
    ).toBe(utc);
  });

  it("handles a zone whose offset is not a whole number of hours", () => {
    // Asia/Kathmandu is UTC+05:45, so the shift is 02:15Z–10:15Z. An hourly probe
    // for the boundary would miss it by 45 minutes.
    expect(
      workingHoursBetween(
        at("2026-08-03T02:15:00.000Z"),
        at("2026-08-03T06:15:00.000Z"),
        MON_FRI,
        "Asia/Kathmandu",
        NO_DAYS_OFF,
      ),
    ).toBe(4);
    // The quarter-hour before the shift starts counts for nothing.
    expect(
      workingHoursBetween(
        at("2026-08-03T02:00:00.000Z"),
        at("2026-08-03T02:15:00.000Z"),
        MON_FRI,
        "Asia/Kathmandu",
        NO_DAYS_OFF,
      ),
    ).toBe(0);
  });

  it("reads the WALL CLOCK across the spring-forward transition", () => {
    // Europe/Warsaw springs forward on Sun 2026-03-29: the local clock steps
    // 02:00 → 03:00 and the weekend is an hour short in real time. Fri 15:00 local
    // to Mon 15:00 local is 71 elapsed hours and 8 working ones — 1 on the Friday,
    // 7 on the Monday. The elapsed figure is the one that must NOT be the budget.
    const from = at("2026-03-27T14:00:00.000Z"); // Fri 15:00 CET
    const to = at("2026-03-30T13:00:00.000Z"); // Mon 15:00 CEST
    expect(hoursBetween(from, to)).toBe(71);
    expect(
      workingHoursBetween(from, to, MON_FRI, "Europe/Warsaw", NO_DAYS_OFF),
    ).toBe(8);
  });

  it("reads the WALL CLOCK across the fall-back transition", () => {
    // Europe/Warsaw falls back on Sun 2026-10-25: 03:00 → 02:00, so the same
    // Friday-to-Monday span is 73 elapsed hours. The working figure does not move.
    const from = at("2026-10-23T13:00:00.000Z"); // Fri 15:00 CEST
    const to = at("2026-10-26T14:00:00.000Z"); // Mon 15:00 CET
    expect(hoursBetween(from, to)).toBe(73);
    expect(
      workingHoursBetween(from, to, MON_FRI, "Europe/Warsaw", NO_DAYS_OFF),
    ).toBe(8);
  });

  it("is a full eight hours on a transition day itself", () => {
    // The Warsaw transitions happen at 02:00/03:00, outside the shift, so a
    // transition day's window is eight WALL-CLOCK hours either way — seven or nine
    // hours of real time would both be wrong. Both dates are Sundays.
    for (const dayKey of ["2026-03-29", "2026-10-25"]) {
      expect(
        workingHoursBetween(
          at(`${dayKey}T00:00:00.000Z`),
          at(`${dayKey}T23:59:59.999Z`),
          ["SUN"],
          "Europe/Warsaw",
          NO_DAYS_OFF,
        ),
      ).toBe(8);
    }
  });

  it("returns 0 for an empty or inverted span", () => {
    const noon = at("2026-08-03T12:00:00.000Z");
    expect(workingHoursBetween(noon, noon, MON_FRI, "UTC", NO_DAYS_OFF)).toBe(0);
    expect(
      workingHoursBetween(
        noon,
        at("2026-08-03T09:00:00.000Z"),
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toBe(0);
  });
});

describe("shiftWorkingHours", () => {
  it("walks backwards across a weekend", () => {
    // Mon 09:00 has one working hour behind it on the Monday; the other three come
    // off the Friday afternoon, not off the weekend.
    expect(
      workingHoursBefore(
        at("2026-08-10T09:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-07T13:00:00.000Z"));
  });

  it("walks forwards across a weekend", () => {
    expect(
      workingHoursAfter(
        at("2026-08-07T13:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-10T09:00:00.000Z"));
  });

  it("round-trips against workingHoursBetween in both directions", () => {
    const anchor = at("2026-08-10T09:00:00.000Z"); // Mon
    for (const hours of [1, 4, 8, 12, 20]) {
      const back = workingHoursBefore(anchor, hours, MON_FRI, "UTC", NO_DAYS_OFF);
      expect(
        workingHoursBetween(back, anchor, MON_FRI, "UTC", NO_DAYS_OFF),
      ).toBeCloseTo(hours, 9);
      expect(
        workingHoursAfter(back, hours, MON_FRI, "UTC", NO_DAYS_OFF),
      ).toEqual(anchor);

      const forward = workingHoursAfter(
        anchor,
        hours,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      );
      expect(
        workingHoursBetween(anchor, forward, MON_FRI, "UTC", NO_DAYS_OFF),
      ).toBeCloseTo(hours, 9);
    }
  });

  it("lands on the exact boundary when the budget fills a whole day", () => {
    // Eight hours before the start of Monday's shift is the start of Friday's,
    // not Thursday's close — a `<` where a `<=` belongs walks a day too far.
    expect(
      workingHoursBefore(
        at("2026-08-10T08:00:00.000Z"),
        8,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-07T08:00:00.000Z"));
  });

  it("steps over a team-wide day off", () => {
    // Tue is a company day off, so four hours before Wed 10:00 reaches back past
    // it into the Monday afternoon.
    expect(
      workingHoursBefore(
        at("2026-08-05T10:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        new Set(["2026-08-04"]),
      ),
    ).toEqual(at("2026-08-03T14:00:00.000Z"));
  });

  it("contributes nothing from the working day it starts before", () => {
    // Mon 06:00 is a working DAY but not a working HOUR. The day owes the walk
    // zero — dropping the `hi > lo` guard makes the day's contribution NEGATIVE
    // and lengthens the budget, which is not a rounding error but two extra
    // hours. Detect runs on a cron at whatever hour it fires, so `from` outside
    // the window on a working day is the ordinary production input, not an edge.
    expect(
      workingHoursBefore(
        at("2026-08-10T06:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-07T12:00:00.000Z"));
  });

  it("contributes nothing from the working day it starts after", () => {
    // The same guard in the forward direction: Mon 18:00 is past the shift, so
    // the four hours come off Tuesday morning and none off the Monday evening.
    expect(
      workingHoursAfter(
        at("2026-08-10T18:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-11T12:00:00.000Z"));
  });

  it("resolves the window in the team's zone", () => {
    expect(
      workingHoursBefore(
        at("2026-08-03T08:00:00.000Z"), // Mon 10:00 Warsaw
        2,
        MON_FRI,
        "Europe/Warsaw",
        NO_DAYS_OFF,
      ),
    ).toEqual(at("2026-08-03T06:00:00.000Z")); // Mon 08:00 Warsaw
  });

  it("returns the instant itself for a zero shift, even outside the window", () => {
    const saturdayNoon = at("2026-08-08T12:00:00.000Z");
    expect(
      shiftWorkingHours(saturdayNoon, 0, MON_FRI, "UTC", NO_DAYS_OFF),
    ).toEqual(saturdayNoon);
    expect(
      shiftWorkingHours(saturdayNoon, 0, MON_FRI, "UTC", NO_DAYS_OFF),
    ).not.toBe(saturdayNoon);
  });

  it("clamps instead of spinning when the calendar cannot supply the hours", () => {
    // Every day for two months marked off: the walk has nowhere to spend the
    // budget. The bound is one week per working day needed plus two weeks of
    // slack — 21 days for a half-day budget — and it clamps there rather than
    // spinning on a request path.
    const allOff = new Set<string>();
    let cursor = new Date("2026-06-01T12:00:00.000Z").getTime();
    const last = new Date("2026-08-11T12:00:00.000Z").getTime();
    while (cursor <= last) {
      allOff.add(new Date(cursor).toISOString().slice(0, 10));
      cursor += 86_400_000;
    }
    expect(
      workingHoursBefore(
        at("2026-08-10T09:00:00.000Z"),
        4,
        MON_FRI,
        "UTC",
        allOff,
      ),
    ).toEqual(at("2026-07-20T23:59:59.999Z"));
  });

  it("says so on the operator log when it clamps (impl-review F2)", () => {
    // The clamped instant is shaped exactly like a successful one, and both
    // callers use it to open a LOOKBACK window — so a silent clamp widens the
    // window and the rule emits nothing, which reads as a healthy sprint.
    // `lessons.md` obligation (a): the log must distinguish the cases.
    const allOff = new Set<string>();
    let cursor = new Date("2026-06-01T12:00:00.000Z").getTime();
    const last = new Date("2026-08-11T12:00:00.000Z").getTime();
    while (cursor <= last) {
      allOff.add(new Date(cursor).toISOString().slice(0, 10));
      cursor += 86_400_000;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      workingHoursBefore(at("2026-08-10T09:00:00.000Z"), 4, MON_FRI, "UTC", allOff);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("clamped");
      expect(String(spy.mock.calls[0]?.[0])).toContain("could not supply 4 working");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to Mon–Fri on a non-canonical workingDays array (impl-review F3)", () => {
    // `weekdayOf` only ever emits "MON".."SUN", so a lowercase or long-form
    // array used to match nothing — and matching nothing means every day is a
    // non-working day, so the clock returns 0 for every span forever. Silence,
    // not an error. Both writers are canonical today; S-17 will add a third.
    const monFriHours = workingHoursBetween(
      at("2026-08-10T00:00:00.000Z"),
      at("2026-08-15T00:00:00.000Z"),
      MON_FRI,
      "UTC",
      new Set(),
    );
    expect(monFriHours).toBe(40);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const bad of [
        ["mon", "tue", "wed", "thu", "fri"],
        ["Monday", "Tuesday"],
        ["", "???"],
      ]) {
        expect(
          workingHoursBetween(
            at("2026-08-10T00:00:00.000Z"),
            at("2026-08-15T00:00:00.000Z"),
            bad,
            "UTC",
            new Set(),
          ),
        ).toBe(40);
      }
      expect(spy).toHaveBeenCalledTimes(3);
      // Assert the message, not just the call: a bare call-count leaves every
      // string in it as a surviving mutant, and the message is the whole point
      // of the log — it has to name what was stored and what was expected.
      const msg = String(spy.mock.calls[0]?.[0]);
      expect(msg).toContain("no recognisable weekday code");
      expect(msg).toContain('["mon","tue","wed","thu","fri"]');
      expect(msg).toContain("MON");
      expect(msg).toContain("Falling back to Mon–Fri");
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the recognisable half of a partly-bad workingDays array", () => {
    // A partial match is honoured rather than thrown away: the array names
    // Monday and Tuesday plus noise, so the week is two working days, not five.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        workingHoursBetween(
          at("2026-08-10T00:00:00.000Z"),
          at("2026-08-15T00:00:00.000Z"),
          ["MON", "TUE", "someday"],
          "UTC",
          new Set(),
        ),
      ).toBe(16);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("stays silent on the log when the calendar CAN supply the hours", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      workingHoursBefore(at("2026-08-10T12:00:00.000Z"), 4, MON_FRI, "UTC", new Set());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
