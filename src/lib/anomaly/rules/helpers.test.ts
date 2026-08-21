import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  clamp01,
  countWorkingDays,
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
  it("counts Mon–Fri days strictly after `from` up to `to`", () => {
    // 08-04..08-10: Tue,Wed,Thu,Fri, (Sat,Sun skipped), Mon = 5 working days.
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    expect(countWorkingDays(from, to, ["MON", "TUE", "WED", "THU", "FRI"])).toBe(5);
  });

  it("returns 0 when `to` is not after `from`", () => {
    const d = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDays(d, d, ["MON"])).toBe(0);
  });

  it("falls back to Mon–Fri when workingDays is empty or null", () => {
    const from = new Date("2026-08-03T12:00:00.000Z");
    const to = new Date("2026-08-10T12:00:00.000Z");
    expect(countWorkingDays(from, to, [])).toBe(5);
    expect(countWorkingDays(from, to, null)).toBe(5);
  });

  it("honors a custom working-day set", () => {
    const from = new Date("2026-08-03T12:00:00.000Z"); // Mon
    const to = new Date("2026-08-10T12:00:00.000Z"); // Mon
    // Only Saturdays: 08-08 → 1.
    expect(countWorkingDays(from, to, ["SAT"])).toBe(1);
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
