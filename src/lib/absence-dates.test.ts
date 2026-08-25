import { describe, expect, it } from "vitest";

import { absenceDayKeys, absenceInstants, overlaps } from "@/lib/absence-dates";

/**
 * S-08 Phase 1 — whole-day semantics for an absence window.
 *
 * The columns are `timestamp` but an absence is a DATE RANGE, so the mapping has
 * to be pinned once: `start_date` is the first instant of the first absent day,
 * `end_date` the LAST instant of the last absent day (inclusive — a user picking
 * 5–9 May is away through the whole of the 9th). The load-bearing cases are the
 * ones where the team's zone and UTC disagree; in Warsaw a local day starts the
 * previous evening in UTC, so a naive `new Date("2026-05-05")` would put the
 * first two hours of the absence on the wrong day.
 */

const WARSAW = "Europe/Warsaw";

describe("absenceInstants", () => {
  it("spans the first instant of the first day to the last instant of the last", () => {
    const { startDate, endDate } = absenceInstants("2026-05-05", "2026-05-09", WARSAW);

    // Warsaw is UTC+2 in May (CEST): local midnight is 22:00Z the day before.
    expect(startDate.toISOString()).toBe("2026-05-04T22:00:00.000Z");
    // …and the last instant of the 9th locally is 21:59:59.999Z on the 9th.
    expect(endDate.toISOString()).toBe("2026-05-09T21:59:59.999Z");
  });

  it("covers the whole of a single-day absence", () => {
    const { startDate, endDate } = absenceInstants("2026-05-05", "2026-05-05", WARSAW);

    expect(startDate.toISOString()).toBe("2026-05-04T22:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-05-05T21:59:59.999Z");
  });

  it("falls back to UTC when the zone is absent or unrecognized", () => {
    const { startDate, endDate } = absenceInstants("2026-05-05", "2026-05-05", null);

    expect(startDate.toISOString()).toBe("2026-05-05T00:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-05-05T23:59:59.999Z");
  });
});

describe("absenceDayKeys", () => {
  it("round-trips the day keys it was built from", () => {
    const stored = absenceInstants("2026-05-05", "2026-05-09", WARSAW);

    expect(absenceDayKeys(stored, WARSAW)).toEqual({
      startDay: "2026-05-05",
      endDay: "2026-05-09",
    });
  });

  it("reads the stored end instant as the last absent day, not the next one", () => {
    // The regression this pins: `end_date` sits at 21:59:59.999Z, which is
    // already the 9th in UTC but would be the 10th under a +2h naive shift.
    const stored = {
      startDate: new Date("2026-05-04T22:00:00.000Z"),
      endDate: new Date("2026-05-09T21:59:59.999Z"),
    };

    expect(absenceDayKeys(stored, WARSAW).endDay).toBe("2026-05-09");
  });
});

describe("overlaps", () => {
  const window = absenceInstants("2026-05-05", "2026-05-09", WARSAW);

  it("is true when the absence sits wholly inside the range", () => {
    expect(
      overlaps(window, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-31T00:00:00Z")),
    ).toBe(true);
  });

  it("is true when only the absence's last instant is inside the range", () => {
    const from = window.endDate;
    expect(overlaps(window, from, new Date("2026-05-31T00:00:00Z"))).toBe(true);
  });

  it("is true when only the absence's first instant is inside the range", () => {
    const to = window.startDate;
    expect(overlaps(window, new Date("2026-04-01T00:00:00Z"), to)).toBe(true);
  });

  it("is false for a range that ends one millisecond before the absence starts", () => {
    const to = new Date(window.startDate.getTime() - 1);
    expect(overlaps(window, new Date("2026-04-01T00:00:00Z"), to)).toBe(false);
  });

  it("is false for a range that starts one millisecond after the absence ends", () => {
    const from = new Date(window.endDate.getTime() + 1);
    expect(overlaps(window, from, new Date("2026-05-31T00:00:00Z"))).toBe(false);
  });
});
