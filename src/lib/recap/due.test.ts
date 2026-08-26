import { describe, expect, it } from "vitest";

import { localTimeOfDay } from "@/lib/dashboard/day-bucket";
import { isRecapDue } from "@/lib/recap/due";

/**
 * The send-time predicate (S-11 Phase 5).
 *
 * DST is the reason `localTimeOfDay` exists at all: the obvious implementation —
 * local midnight + `hour × 3_600_000` — lands on 14:00 or 16:00 local on a
 * transition day, so an owner's 15:00 recap would arrive an hour off twice a
 * year. These tests pin the wall clock, not the arithmetic.
 */

describe("localTimeOfDay — DST", () => {
  it("reads the wall clock across Warsaw's SPRING-FORWARD (2026-03-29)", () => {
    // 00:59 UTC = 01:59 local (CET, +1). The very next local hour is 03:00 —
    // 02:00 does not exist that day.
    expect(localTimeOfDay(new Date("2026-03-29T00:59:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 1,
      minute: 59,
    });
    expect(localTimeOfDay(new Date("2026-03-29T01:00:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 3,
      minute: 0,
    });
    // 15:00 local on the short day is 13:00Z, not 14:00Z. Midnight + 15h would
    // have produced 16:00 local here.
    expect(localTimeOfDay(new Date("2026-03-29T13:00:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 15,
      minute: 0,
    });
  });

  it("reads the wall clock across Warsaw's FALL-BACK (2026-10-25)", () => {
    // 02:30 local happens twice; both instants must report 02:30, not 01:30/03:30.
    expect(localTimeOfDay(new Date("2026-10-25T00:30:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 2,
      minute: 30,
    });
    expect(localTimeOfDay(new Date("2026-10-25T01:30:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 2,
      minute: 30,
    });
    // 15:00 local on the long day is 14:00Z.
    expect(localTimeOfDay(new Date("2026-10-25T14:00:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 15,
      minute: 0,
    });
  });

  it("handles a HALF-HOUR zone", () => {
    // Kolkata is +05:30 — an hourly probe would be 30 minutes out.
    expect(localTimeOfDay(new Date("2026-08-26T09:30:00.000Z"), "Asia/Kolkata")).toEqual({
      hour: 15,
      minute: 0,
    });
  });

  it("uses h23, so local midnight is hour 0 and never 24", () => {
    // `24 >= 15` would fire a 15:00 recap at midnight.
    expect(localTimeOfDay(new Date("2026-08-25T22:00:00.000Z"), "Europe/Warsaw")).toEqual({
      hour: 0,
      minute: 0,
    });
  });

  it("falls back to UTC for a null or unrecognized zone", () => {
    expect(localTimeOfDay(new Date("2026-08-26T15:00:00.000Z"), null)).toEqual({
      hour: 15,
      minute: 0,
    });
    expect(localTimeOfDay(new Date("2026-08-26T15:00:00.000Z"), "Not/AZone")).toEqual({
      hour: 15,
      minute: 0,
    });
  });
});

describe("isRecapDue", () => {
  const base = { timeZone: "Europe/Warsaw", sendHour: 15, sendMinute: 0, enabled: true };

  it("is not due one minute before the configured time", () => {
    // 12:59Z = 14:59 Warsaw.
    const out = isRecapDue({ ...base, now: new Date("2026-08-26T12:59:00.000Z") });
    expect(out).toEqual({ due: false, dayKey: "2026-08-26", reason: "before_send_time" });
  });

  it("is due EXACTLY at the configured minute", () => {
    const out = isRecapDue({ ...base, now: new Date("2026-08-26T13:00:00.000Z") });
    expect(out).toEqual({ due: true, dayKey: "2026-08-26", reason: "due" });
  });

  it("stays due for the rest of the local day", () => {
    // "At or after", not "crosses": a missed tick or a Worker restart must still
    // produce that day's recap. The DB claim is what stops a second email.
    expect(isRecapDue({ ...base, now: new Date("2026-08-26T19:00:00.000Z") }).due).toBe(true);
    // 21:59Z = 23:59 Warsaw — still the same local day.
    const late = isRecapDue({ ...base, now: new Date("2026-08-26T21:59:00.000Z") });
    expect(late.due).toBe(true);
    expect(late.dayKey).toBe("2026-08-26");
  });

  it("rolls to the next dayKey after local midnight", () => {
    // 22:00Z on the 26th is already the 27th in Warsaw — a new day, a new claim.
    const out = isRecapDue({ ...base, now: new Date("2026-08-26T22:00:00.000Z") });
    expect(out.dayKey).toBe("2026-08-27");
    expect(out.due).toBe(false);
  });

  it("compares hour AND minute together, not independently", () => {
    // 16:05 local vs a 15:30 setting: `05 < 30`, but the time has passed.
    const out = isRecapDue({
      ...base,
      sendMinute: 30,
      now: new Date("2026-08-26T14:05:00.000Z"),
    });
    expect(out.due).toBe(true);
  });

  it("is not due when disabled, whatever the clock says", () => {
    const out = isRecapDue({
      ...base,
      enabled: false,
      now: new Date("2026-08-26T19:00:00.000Z"),
    });
    expect(out).toEqual({ due: false, dayKey: "2026-08-26", reason: "disabled" });
  });

  it("falls back to UTC when the team has no stored zone", () => {
    // The between-sprints gap S-11 Phase 1 closed. Until a Jira cycle writes a
    // zone, "15:00 local" honestly means 15:00 UTC — and the settings page says so.
    const before = isRecapDue({ ...base, timeZone: null, now: new Date("2026-08-26T14:59:00.000Z") });
    const after = isRecapDue({ ...base, timeZone: null, now: new Date("2026-08-26T15:00:00.000Z") });
    expect(before.due).toBe(false);
    expect(after.due).toBe(true);
  });

  it("is due immediately at 00:00 when the owner sets midnight", () => {
    const out = isRecapDue({
      ...base,
      sendHour: 0,
      now: new Date("2026-08-25T22:00:00.000Z"),
    });
    expect(out.due).toBe(true);
    expect(out.dayKey).toBe("2026-08-26");
  });
});
