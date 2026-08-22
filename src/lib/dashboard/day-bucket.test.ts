import { describe, expect, it } from "vitest";

import {
  dayKeyInTimeZone,
  dayRangeInTimeZone,
  enumerateDayKeys,
} from "@/lib/dashboard/day-bucket";

/**
 * Unit suite for S-10 day bucketing. The load-bearing cases are the ones where
 * UTC and the team's zone disagree — a late-evening commit, a DST boundary — and
 * the degradation path where the zone is absent or unrecognized.
 */

describe("dayKeyInTimeZone", () => {
  it("formats YYYY-MM-DD in the given zone", () => {
    expect(dayKeyInTimeZone(new Date("2026-08-19T12:00:00Z"), "Europe/Warsaw")).toBe(
      "2026-08-19",
    );
  });

  it("keeps a late-evening local commit on its own local day", () => {
    // 22:30 Warsaw on the 19th is 20:30 UTC — same day here.
    expect(dayKeyInTimeZone(new Date("2026-08-19T20:30:00Z"), "Europe/Warsaw")).toBe(
      "2026-08-19",
    );
    // 00:30 Warsaw on the 20th is 22:30 UTC on the 19th — the case UTC gets wrong.
    expect(dayKeyInTimeZone(new Date("2026-08-19T22:30:00Z"), "Europe/Warsaw")).toBe(
      "2026-08-20",
    );
    expect(dayKeyInTimeZone(new Date("2026-08-19T22:30:00Z"), "UTC")).toBe("2026-08-19");
  });

  it("rolls back a day for a western zone", () => {
    // 2026-08-17T00:00Z is Sunday 17:00 in Los Angeles.
    expect(dayKeyInTimeZone(new Date("2026-08-17T00:00:00Z"), "America/Los_Angeles")).toBe(
      "2026-08-16",
    );
  });

  it("falls back to UTC for an unrecognized zone rather than throwing", () => {
    expect(dayKeyInTimeZone(new Date("2026-08-19T22:30:00Z"), "Mars/Olympus_Mons")).toBe(
      "2026-08-19",
    );
  });

  it("falls back to UTC for an absent or empty zone", () => {
    const at = new Date("2026-08-19T22:30:00Z");
    expect(dayKeyInTimeZone(at)).toBe("2026-08-19");
    expect(dayKeyInTimeZone(at, null)).toBe("2026-08-19");
    expect(dayKeyInTimeZone(at, "")).toBe("2026-08-19");
  });
});

describe("dayRangeInTimeZone", () => {
  it("brackets the local day exactly for a whole-hour zone", () => {
    // Warsaw is UTC+2 in August.
    const { from, to } = dayRangeInTimeZone("2026-08-18", "Europe/Warsaw");
    expect(from.toISOString()).toBe("2026-08-17T22:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-18T21:59:59.999Z");
  });

  it("brackets the local day exactly for a half-hour zone", () => {
    // Kolkata is UTC+5:30 — the case an hourly probe would miss by 30 minutes.
    const { from, to } = dayRangeInTimeZone("2026-08-18", "Asia/Kolkata");
    expect(from.toISOString()).toBe("2026-08-17T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-08-18T18:29:59.999Z");
  });

  it("brackets the local day exactly for a western zone", () => {
    const { from, to } = dayRangeInTimeZone("2026-08-18", "America/Los_Angeles");
    expect(from.toISOString()).toBe("2026-08-18T07:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-19T06:59:59.999Z");
  });

  it("spans 25 hours on a fall-back DST day", () => {
    const { from, to } = dayRangeInTimeZone("2026-10-25", "Europe/Warsaw");
    expect(to.getTime() - from.getTime() + 1).toBe(25 * 60 * 60 * 1000);
  });

  it("spans 23 hours on a spring-forward DST day", () => {
    const { from, to } = dayRangeInTimeZone("2026-03-29", "Europe/Warsaw");
    expect(to.getTime() - from.getTime() + 1).toBe(23 * 60 * 60 * 1000);
  });

  it("falls back to the UTC day for an absent or unrecognized zone", () => {
    for (const zone of [undefined, null, "Nowhere/Nothing"]) {
      const { from, to } = dayRangeInTimeZone("2026-08-18", zone);
      expect(from.toISOString()).toBe("2026-08-18T00:00:00.000Z");
      expect(to.toISOString()).toBe("2026-08-18T23:59:59.999Z");
    }
  });

  it("round-trips: every bound maps back to the day it bounds", () => {
    for (const zone of ["Europe/Warsaw", "Asia/Kolkata", "America/Los_Angeles", "UTC"]) {
      const { from, to } = dayRangeInTimeZone("2026-08-18", zone);
      expect(dayKeyInTimeZone(from, zone)).toBe("2026-08-18");
      expect(dayKeyInTimeZone(to, zone)).toBe("2026-08-18");
      expect(dayKeyInTimeZone(new Date(from.getTime() - 1), zone)).toBe("2026-08-17");
      expect(dayKeyInTimeZone(new Date(to.getTime() + 1), zone)).toBe("2026-08-19");
    }
  });

  it("yields a single-column axis when fed to enumerateDayKeys", () => {
    const { from, to } = dayRangeInTimeZone("2026-08-18", "Europe/Warsaw");
    expect(enumerateDayKeys(from, to, "Europe/Warsaw")).toEqual(["2026-08-18"]);
  });
});

describe("enumerateDayKeys", () => {
  it("returns an inclusive ordered axis", () => {
    expect(
      enumerateDayKeys(
        new Date("2026-08-17T08:00:00Z"),
        new Date("2026-08-20T08:00:00Z"),
        "Europe/Warsaw",
      ),
    ).toEqual(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]);
  });

  it("returns a single day when start and end share a local day", () => {
    expect(
      enumerateDayKeys(
        new Date("2026-08-17T06:00:00Z"),
        new Date("2026-08-17T20:00:00Z"),
        "Europe/Warsaw",
      ),
    ).toEqual(["2026-08-17"]);
  });

  it("returns [] when end precedes start", () => {
    expect(
      enumerateDayKeys(new Date("2026-08-20T00:00:00Z"), new Date("2026-08-17T00:00:00Z")),
    ).toEqual([]);
  });

  it("emits each local day exactly once across a fall-back DST boundary", () => {
    // Europe/Warsaw leaves DST on 2026-10-25 (a 25-hour local day).
    const keys = enumerateDayKeys(
      new Date("2026-10-23T12:00:00Z"),
      new Date("2026-10-27T12:00:00Z"),
      "Europe/Warsaw",
    );
    expect(keys).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("emits each local day exactly once across a spring-forward DST boundary", () => {
    // Europe/Warsaw enters DST on 2026-03-29 (a 23-hour local day).
    const keys = enumerateDayKeys(
      new Date("2026-03-27T12:00:00Z"),
      new Date("2026-03-31T12:00:00Z"),
      "Europe/Warsaw",
    );
    expect(keys).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
  });

  it("falls back to UTC for an unrecognized zone", () => {
    expect(
      enumerateDayKeys(
        new Date("2026-08-19T22:30:00Z"),
        new Date("2026-08-20T22:30:00Z"),
        "Nowhere/Nothing",
      ),
    ).toEqual(["2026-08-19", "2026-08-20"]);
  });
});
