import { describe, expect, it } from "vitest";

import { DEFAULT_WORKING_DAYS, deriveCadence } from "@/lib/integrations/cadence";

/**
 * Unit suite for `deriveCadence` (`src/lib/integrations/cadence.ts`) — pure, no
 * DB, no network. The load-bearing case is the UTC→timezone weekday conversion
 * (F3): a sprint starting at midnight UTC lands on a DIFFERENT weekday in a
 * negative-offset zone, so skipping the conversion yields an off-by-one start-day.
 *
 * 2026-08-17T00:00:00Z is a Monday in UTC and Sunday 17:00 in America/Los_Angeles
 * (PDT, UTC-7) — the boundary case the conversion must get right.
 */

const MON_MIDNIGHT_UTC = "2026-08-17T00:00:00.000Z";

describe("deriveCadence — length", () => {
  it("rounds a whole-day span to lengthDays", () => {
    const { lengthDays } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
    });
    expect(lengthDays).toBe(14);
  });

  it("rounds a fractional-day span to the nearest day", () => {
    // 13 days 20 hours → rounds up to 14.
    const { lengthDays } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-30T20:00:00.000Z",
    });
    expect(lengthDays).toBe(14);
  });

  it("floors lengthDays at 1 for a zero/negative span", () => {
    const { lengthDays } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: MON_MIDNIGHT_UTC,
    });
    expect(lengthDays).toBe(1);
  });

  it("accepts Date objects as well as ISO strings", () => {
    const { lengthDays } = deriveCadence({
      startDate: new Date(MON_MIDNIGHT_UTC),
      endDate: new Date("2026-08-24T00:00:00.000Z"),
    });
    expect(lengthDays).toBe(7);
  });
});

describe("deriveCadence — startDay timezone conversion (F3)", () => {
  it("reads the weekday in UTC when no timezone is given", () => {
    const { startDay } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
    });
    expect(startDay).toBe("MON");
  });

  it("shifts to the previous weekday in a negative-offset zone (off-by-one boundary)", () => {
    const { startDay } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
    expect(startDay).toBe("SUN");
  });

  it("keeps the same weekday in a positive-offset zone at midday UTC", () => {
    const { startDay } = deriveCadence({
      startDate: "2026-08-17T12:00:00.000Z",
      endDate: "2026-08-31T12:00:00.000Z",
      timeZone: "Europe/Warsaw",
    });
    expect(startDay).toBe("MON");
  });

  it("falls back to UTC for an unrecognized timezone", () => {
    const { startDay } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
      timeZone: "Not/ARealZone",
    });
    expect(startDay).toBe("MON");
  });
});

describe("deriveCadence — workingDays", () => {
  it("defaults to Mon–Fri", () => {
    const { workingDays } = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
    });
    expect(workingDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(workingDays).toEqual(DEFAULT_WORKING_DAYS);
  });

  it("returns a fresh array (not the shared default reference)", () => {
    const a = deriveCadence({
      startDate: MON_MIDNIGHT_UTC,
      endDate: "2026-08-31T00:00:00.000Z",
    });
    expect(a.workingDays).not.toBe(DEFAULT_WORKING_DAYS);
  });
});
