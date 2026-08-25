import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  clamp01,
  countWorkingDays,
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

describe("countWorkingDays", () => {
  // Every assertion now names its zone (S-08). The counter used to bucket in
  // SERVER-LOCAL time while every dashboard day axis bucketed in the team's Jira
  // zone; on a UTC server the two agree, on a developer's Warsaw laptop they do
  // not. The zone below is explicit so the expectations mean the same thing
  // wherever the suite runs. "UTC" reproduces the old behaviour exactly.
  it("counts Mon–Fri days strictly after `from` up to `to`", () => {
    // 08-04..08-10: Tue,Wed,Thu,Fri, (Sat,Sun skipped), Mon = 5 working days.
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    expect(countWorkingDays(from, to, ["MON", "TUE", "WED", "THU", "FRI"], "UTC")).toBe(5);
  });

  it("returns 0 when `to` is not after `from`", () => {
    const d = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDays(d, d, ["MON"], "UTC")).toBe(0);
  });

  it("falls back to Mon–Fri when workingDays is empty or null", () => {
    const from = new Date("2026-08-03T12:00:00.000Z");
    const to = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDays(from, to, [], "UTC")).toBe(5);
    expect(countWorkingDays(from, to, null, "UTC")).toBe(5);
  });

  it("honors a custom working-day set", () => {
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    // Only Saturdays: 08-08 → 1.
    expect(countWorkingDays(from, to, ["SAT"], "UTC")).toBe(1);
  });

  it("buckets in the team's zone, not the server's", () => {
    // 2026-08-15T23:00Z is Saturday in UTC and Saturday 16:00 in Los Angeles;
    // 2026-08-17T00:00Z is MONDAY in UTC but still SUNDAY there. So the
    // half-open window covers Sun+Mon in UTC (1 working day) and Sun only in
    // LA (0). Two zones, two answers, from one pair of instants.
    const from = new Date("2026-08-15T23:00:00.000Z");
    const to = new Date("2026-08-17T00:00:00.000Z");

    expect(countWorkingDays(from, to, null, "UTC")).toBe(1);
    expect(countWorkingDays(from, to, null, "America/Los_Angeles")).toBe(0);
  });

  it("degrades an unknown or absent zone to UTC rather than throwing", () => {
    const from = new Date("2026-08-15T23:00:00.000Z");
    const to = new Date("2026-08-17T00:00:00.000Z");

    expect(countWorkingDays(from, to, null, "Not/AZone")).toBe(1);
    expect(countWorkingDays(from, to, null, null)).toBe(1);
  });

  it("excludes a day listed in nonWorkingDays", () => {
    // The seam a future public-holidays / company-days-off slice fills. S-08
    // always passes it empty.
    const from = new Date("2026-08-17T09:00:00.000Z"); // Mon
    const to = new Date("2026-08-21T09:00:00.000Z"); // Fri

    expect(countWorkingDaysInclusive(from, to, null, "UTC")).toBe(5);
    expect(
      countWorkingDaysInclusive(from, to, null, "UTC", new Set(["2026-08-18"])),
    ).toBe(4);
  });
});

describe("countWorkingDays boundaries", () => {
  /**
   * The two named intents on ONE input, so the difference can never drift.
   *
   * `TICKET_STATUS_AGING` measures elapsed time SINCE a movement, so the day the
   * ticket moved is not an elapsed day — exclusive-start is right there, and its
   * answer must stay 4 byte for byte. An absence from Monday to Friday costs 5
   * working days, not 4 — a closed range. Left implicit, the off-by-one lands
   * silently in the SPRINT_AT_RISK magnitude and in the capacity divisor.
   */
  const monday = new Date("2026-08-17T09:00:00.000Z");
  const friday = new Date("2026-08-21T09:00:00.000Z");

  it("counts 4 with an exclusive start (what TICKET_STATUS_AGING needs)", () => {
    expect(countWorkingDays(monday, friday, null, "UTC")).toBe(4);
  });

  it("counts 5 inclusively (what a Mon–Fri absence costs)", () => {
    expect(countWorkingDaysInclusive(monday, friday, null, "UTC")).toBe(5);
  });

  it("counts a single working day inclusively, and none exclusively", () => {
    expect(countWorkingDaysInclusive(monday, monday, null, "UTC")).toBe(1);
    expect(countWorkingDays(monday, monday, null, "UTC")).toBe(0);
  });

  it("counts 0 inclusively for a weekend-only window", () => {
    const sat = new Date("2026-08-22T09:00:00.000Z");
    const sun = new Date("2026-08-23T09:00:00.000Z");
    expect(countWorkingDaysInclusive(sat, sun, null, "UTC")).toBe(0);
  });

  it("returns 0 inclusively when `to` precedes `from`", () => {
    expect(countWorkingDaysInclusive(friday, monday, null, "UTC")).toBe(0);
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

describe("CATEGORY_LABEL", () => {
  it("maps every category enum value to a human label", () => {
    expect(CATEGORY_LABEL.TODO).toBe("To Do");
    expect(CATEGORY_LABEL.IN_PROGRESS).toBe("In Progress");
    expect(CATEGORY_LABEL.CODE_REVIEW).toBe("Code Review");
    expect(CATEGORY_LABEL.TESTING).toBe("Testing");
    expect(CATEGORY_LABEL.DONE).toBe("Done");
  });
});
