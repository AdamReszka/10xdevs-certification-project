import { describe, expect, it } from "vitest";

import {
  describeLastSend,
  fromTimeValue,
  sendTimeHint,
  toTimeValue,
  type LastRecapRow,
} from "./recap-settings-view";

/**
 * `/settings/recap`'s display logic (S-11 Phase 6). Unit-testable only because it
 * lives outside the `.tsx` — there is no component-test harness here.
 */

function row(over: Partial<LastRecapRow> = {}): LastRecapRow {
  return {
    recapDay: "2026-08-26",
    sendStatus: "SENT",
    sentAt: "2026-08-26T13:00:12.000Z",
    attemptCount: 1,
    ...over,
  };
}

describe("describeLastSend", () => {
  it("says nothing has been sent yet, and why the first one might not have", () => {
    const out = describeLastSend(null);
    expect(out).toContain("No recap has been sent yet");
    // The no-sprint skip is the most likely reason a new account sees nothing,
    // and the page is the only place that ever explains it.
    expect(out).toContain("active sprint");
  });

  it("names the day on a successful send", () => {
    expect(describeLastSend(row())).toBe("Last recap sent for 2026-08-26.");
  });

  it("distinguishes a retryable failure from an exhausted one", () => {
    const retryable = describeLastSend(row({ sendStatus: "FAILED", attemptCount: 1 }));
    expect(retryable).toContain("attempt 1");
    expect(retryable).toContain("try again");

    const exhausted = describeLastSend(row({ sendStatus: "FAILED", attemptCount: 3 }));
    expect(exhausted).toContain("3 attempts");
    expect(exhausted).toContain("tomorrow");
    expect(exhausted).not.toContain("try again");
  });

  it("covers the in-flight PENDING row", () => {
    // Reachable in normal operation — the row is claimed for the few seconds a
    // send takes, and stays PENDING if the Worker died mid-flight.
    expect(describeLastSend(row({ sendStatus: "PENDING", sentAt: null }))).toContain(
      "being sent right now",
    );
  });
});

describe("sendTimeHint", () => {
  it("states the 15-minute bound, always", () => {
    // The cron cannot honour a minute exactly. A picker that silently rounded
    // would be a defect; saying so makes it a documented bound.
    for (const zone of ["Europe/Warsaw", null]) {
      const hint = sendTimeHint(zone);
      expect(hint).toContain("EARLIEST");
      expect(hint).toContain("every 15 minutes");
    }
  });

  it("names the team's zone when there is one", () => {
    expect(sendTimeHint("Europe/Warsaw")).toContain("Europe/Warsaw");
  });

  it("says UTC-until-next-sync when there is not", () => {
    const hint = sendTimeHint(null);
    expect(hint).toContain("UTC");
    expect(hint).toContain("Jira sync");
  });
});

describe("toTimeValue / fromTimeValue", () => {
  it("pads to HH:MM", () => {
    expect(toTimeValue(15, 0)).toBe("15:00");
    expect(toTimeValue(8, 5)).toBe("08:05");
    expect(toTimeValue(0, 0)).toBe("00:00");
  });

  it("round-trips", () => {
    expect(fromTimeValue(toTimeValue(23, 59))).toEqual({ hour: 23, minute: 59 });
  });

  it("accepts the seconds some browsers emit", () => {
    expect(fromTimeValue("15:30:00")).toEqual({ hour: 15, minute: 30 });
  });

  it("returns null for a cleared field rather than NaN", () => {
    // `"".split(":").map(Number)` yields NaN, which zod would receive as a
    // "number" and the form would submit.
    expect(fromTimeValue("")).toBeNull();
    expect(fromTimeValue("   ")).toBeNull();
  });

  it("rejects out-of-range and malformed values", () => {
    expect(fromTimeValue("24:00")).toBeNull();
    expect(fromTimeValue("12:60")).toBeNull();
    expect(fromTimeValue("noon")).toBeNull();
    expect(fromTimeValue("12")).toBeNull();
  });
});
