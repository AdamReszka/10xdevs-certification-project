import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  clamp01,
  countTeamDaysOffInclusive,
  countWorkingDaysInclusive,
  daysBetween,
  hoursBetween,
  indexBy,
  round,
} from "@/lib/anomaly/rules/helpers";
import { makeMember } from "@/lib/anomaly/test-support";

describe("hoursBetween / daysBetween", () => {
  it("computes signed hour and day deltas", () => {
    const a = new Date("2026-08-10T00:00:00.000Z");
    const b = new Date("2026-08-11T12:00:00.000Z");
    expect(hoursBetween(a, b)).toBe(36);
    expect(daysBetween(a, b)).toBe(1.5);
    expect(hoursBetween(b, a)).toBe(-36);
  });
});

describe("clamp01", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });
});

describe("round", () => {
  it("rounds to the nearest integer", () => {
    expect(round(66.6)).toBe(67);
    expect(round(66.4)).toBe(66);
  });
});

/** No team-wide days off. Named so the argument reads as a choice, not an
 *  omission — the seam is required everywhere (impl-review F6). */
const NO_DAYS_OFF: ReadonlySet<string> = new Set();

describe("countWorkingDaysInclusive", () => {
  // Every assertion names its zone (S-08). The counter used to bucket in
  // SERVER-LOCAL time while every dashboard day axis bucketed in the team's Jira
  // zone; on a UTC server the two agree, on a developer's Warsaw laptop they do
  // not. "UTC" reproduces the old behaviour exactly.
  //
  // These cases were written against the exclusive-start `countWorkingDays`,
  // which S-28 left with no callers and impl-review F5 deleted. They are kept —
  // re-pointed at the surviving counter — because what they actually pin is the
  // SHARED walk in `countDays`: the zone bucketing, the Mon–Fri fallback, the
  // custom working-day set and the `safeZone` degradation all still run.
  it("counts Mon–Fri days across a closed range", () => {
    // 08-03..08-10 inclusive: Mon,Tue,Wed,Thu,Fri, (Sat,Sun skipped), Mon = 6.
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    expect(
      countWorkingDaysInclusive(from, to, ["MON", "TUE", "WED", "THU", "FRI"], "UTC", NO_DAYS_OFF),
    ).toBe(6);
  });

  it("returns 0 when `to` is before `from`", () => {
    const from = new Date("2026-08-11T12:00:00.000Z");
    const to = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDaysInclusive(from, to, ["MON"], "UTC", NO_DAYS_OFF)).toBe(0);
  });

  it("falls back to Mon–Fri when workingDays is empty or null", () => {
    const from = new Date("2026-08-03T12:00:00.000Z");
    const to = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDaysInclusive(from, to, [], "UTC", NO_DAYS_OFF)).toBe(6);
    expect(countWorkingDaysInclusive(from, to, null, "UTC", NO_DAYS_OFF)).toBe(6);
  });

  it("honors a custom working-day set", () => {
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    // Only Saturdays in the closed range: 08-08 → 1.
    expect(countWorkingDaysInclusive(from, to, ["SAT"], "UTC", NO_DAYS_OFF)).toBe(1);
  });

  it("buckets in the team's zone, not the server's", () => {
    // 2026-08-15T23:00Z is Saturday in UTC and Saturday 16:00 in Los Angeles;
    // 2026-08-17T00:00Z is MONDAY in UTC but still SUNDAY there. Two zones, two
    // answers, from one pair of instants.
    const from = new Date("2026-08-15T23:00:00.000Z");
    const to = new Date("2026-08-17T00:00:00.000Z");

    expect(countWorkingDaysInclusive(from, to, null, "UTC", NO_DAYS_OFF)).toBe(1);
    expect(
      countWorkingDaysInclusive(from, to, null, "America/Los_Angeles", NO_DAYS_OFF),
    ).toBe(0);
  });

  it("degrades an unknown or absent zone to UTC rather than throwing", () => {
    const from = new Date("2026-08-15T23:00:00.000Z");
    const to = new Date("2026-08-17T00:00:00.000Z");

    expect(countWorkingDaysInclusive(from, to, null, "Not/AZone", NO_DAYS_OFF)).toBe(1);
    expect(countWorkingDaysInclusive(from, to, null, null, NO_DAYS_OFF)).toBe(1);
  });

  it("excludes a day listed in nonWorkingDays", () => {
    // The seam S-08 declared and S-23 filled: `team-day-off-store.ts` supplies
    // this set at every production call site.
    const from = new Date("2026-08-17T09:00:00.000Z"); // Mon
    const to = new Date("2026-08-21T09:00:00.000Z"); // Fri

    expect(countWorkingDaysInclusive(from, to, null, "UTC", NO_DAYS_OFF)).toBe(5);
    expect(
      countWorkingDaysInclusive(from, to, null, "UTC", new Set(["2026-08-18"])),
    ).toBe(4);
  });
});

describe("countWorkingDaysInclusive boundaries", () => {
  /**
   * The closed range is the whole contract now (impl-review F5). Its exclusive
   * sibling existed for `TICKET_STATUS_AGING`, whose "the day the ticket moved
   * is not an elapsed day" needed a half-open range; S-28 moved that rule onto
   * the working-HOUR clock in `working-time.ts`, so the half-open counter had no
   * caller left. An absence from Monday to Friday costs 5 working days, not 4 —
   * left implicit, that off-by-one lands silently in the SPRINT_AT_RISK
   * magnitude and in the capacity divisor.
   */
  const monday = new Date("2026-08-17T09:00:00.000Z");
  const friday = new Date("2026-08-21T09:00:00.000Z");

  it("counts 5 across Mon–Fri (what a Mon–Fri absence costs)", () => {
    expect(countWorkingDaysInclusive(monday, friday, null, "UTC", NO_DAYS_OFF)).toBe(5);
  });

  it("counts a single working day", () => {
    expect(countWorkingDaysInclusive(monday, monday, null, "UTC", NO_DAYS_OFF)).toBe(1);
  });
});

describe("indexBy", () => {
  it("indexes members by a key and skips null keys", () => {
    const a = makeMember({ id: "a", githubUsername: "aa" });
    const b = makeMember({ id: "b", githubUsername: null });
    const map = indexBy([a, b], (m) => m.githubUsername);
    expect(map.get("aa")?.id).toBe("a");
    expect(map.size).toBe(1);
  });
});

/**
 * S-23 Phase 2 — how many WORKING days the team-wide calendar removed.
 *
 * The distinction that earns this its own function: a holiday landing on a
 * Saturday costs nothing, so counting set members inside the range would put a
 * "− 1 team day off" on screen next to a working-day total that never moved.
 *
 * Week of Mon 2026-08-17 throughout: Mon 17 … Fri 21, Sat 22, Sun 23.
 */
describe("countTeamDaysOffInclusive", () => {
  const MON = new Date("2026-08-17T09:00:00.000Z");
  const FRI = new Date("2026-08-21T09:00:00.000Z");
  const SUN = new Date("2026-08-23T09:00:00.000Z");

  it("counts a day off that falls on a working day", () => {
    expect(
      countTeamDaysOffInclusive(MON, FRI, null, "UTC", new Set(["2026-08-19"])),
    ).toBe(1);
  });

  it("counts several", () => {
    expect(
      countTeamDaysOffInclusive(
        MON,
        FRI,
        null,
        "UTC",
        new Set(["2026-08-18", "2026-08-19"]),
      ),
    ).toBe(2);
  });

  it("ignores one that lands on a non-working weekday", () => {
    expect(
      countTeamDaysOffInclusive(MON, SUN, null, "UTC", new Set(["2026-08-22"])),
    ).toBe(0);
  });

  it("follows the team's own working week rather than assuming Mon–Fri", () => {
    // Sat 22 is a working day for a Sat–Wed team, so the same date now counts.
    expect(
      countTeamDaysOffInclusive(
        MON,
        SUN,
        ["SAT", "SUN", "MON", "TUE", "WED"],
        "UTC",
        new Set(["2026-08-22"]),
      ),
    ).toBe(1);
  });

  it("ignores one outside the range", () => {
    expect(
      countTeamDaysOffInclusive(MON, FRI, null, "UTC", new Set(["2026-08-24"])),
    ).toBe(0);
  });

  it("is zero for an empty calendar", () => {
    expect(countTeamDaysOffInclusive(MON, FRI, null, "UTC", new Set())).toBe(0);
  });

  it("is zero for an inverted range", () => {
    expect(
      countTeamDaysOffInclusive(FRI, MON, null, "UTC", new Set(["2026-08-19"])),
    ).toBe(0);
  });

  it("counts a single-day closed range, matching its inclusive sibling", () => {
    expect(
      countTeamDaysOffInclusive(MON, MON, null, "UTC", new Set(["2026-08-17"])),
    ).toBe(1);
  });
});

describe("CATEGORY_LABEL", () => {
  it("maps every category enum value to a human label", () => {
    expect(CATEGORY_LABEL.TODO).toBe("To Do");
    expect(CATEGORY_LABEL.IN_PROGRESS).toBe("In Progress");
    expect(CATEGORY_LABEL.CODE_REVIEW).toBe("Code Review");
    expect(CATEGORY_LABEL.TESTING).toBe("Testing");
    expect(CATEGORY_LABEL.DONE).toBe("Done");
  });
});
