import { describe, expect, it } from "vitest";

import { buildAvailabilityGrid } from "@/components/organisms/dashboard/availability-view";
import { nextWindowAfter } from "@/lib/dashboard/next-window";

/**
 * S-18 — which window "next" means.
 *
 * Moved here from `availability-view.test.ts` with the function it covers: the
 * length now comes from the lead's RESOLVED cadence rather than from the current
 * sprint's own millisecond span, which made the derivation a server-side fact and
 * the module a `lib/dashboard/` one.
 *
 * EVERY CASE ASSERTS ON THE DAYS THE GRID ACTUALLY DRAWS, never on the
 * arithmetic the function performs. The pre-S-08-impl-review version restated
 * `end + 1ms` back to itself and therefore could not fail — which is exactly how
 * the two grids came to share a day. `buildAvailabilityGrid` is the same day axis
 * the panel renders, so a bound that is one instant off shows up as a column.
 */

const MEMBERS = [{ id: "m-1", name: "Mia Krystof", isActive: true }];

function daysOf(from: Date, to: Date, timeZone: string | null) {
  return buildAvailabilityGrid({ members: MEMBERS, absences: [], from, to, timeZone })
    .days;
}

describe("nextWindowAfter", () => {
  it("does not share a day with the sprint when the sprint ends mid-day", () => {
    // The load-bearing case: real Jira sprints end at an arbitrary instant.
    // `run-sync.integration.test.ts` stores 2026-08-31T08:00:00.000Z.
    const start = new Date("2026-08-17T08:00:00.000Z");
    const end = new Date("2026-08-28T08:00:00.000Z");
    const next = nextWindowAfter({ sprintEnd: end, lengthDays: 14, timeZone: "UTC" });

    const current = daysOf(start, end, "UTC");
    const upcoming = daysOf(next.from, next.to, "UTC");

    expect(current.at(-1)).toBe("2026-08-28");
    expect(upcoming[0]).toBe("2026-08-29");
    expect(current.filter((d) => upcoming.includes(d))).toEqual([]);
  });

  it("does not share a day when the sprint ends at the last instant of a day", () => {
    const start = new Date("2026-08-03T00:00:00.000Z"); // Mon
    const end = new Date("2026-08-14T23:59:59.999Z"); // Fri
    const next = nextWindowAfter({ sprintEnd: end, lengthDays: 12, timeZone: "UTC" });

    const current = daysOf(start, end, "UTC");
    const upcoming = daysOf(next.from, next.to, "UTC");

    expect(current.at(-1)).toBe("2026-08-14");
    expect(upcoming[0]).toBe("2026-08-15");
    expect(current.filter((d) => upcoming.includes(d))).toEqual([]);
  });

  it("resolves the boundary in the team's zone, not in UTC", () => {
    // An end at 2026-08-29T04:00Z is the 29th in Warsaw (+2) and still the 28th
    // in Los Angeles, so the next window starts on a different day in each.
    const end = new Date("2026-08-29T04:00:00.000Z");
    const warsaw = nextWindowAfter({ sprintEnd: end, lengthDays: 14, timeZone: "Europe/Warsaw" });
    const la = nextWindowAfter({
      sprintEnd: end,
      lengthDays: 14,
      timeZone: "America/Los_Angeles",
    });

    expect(daysOf(warsaw.from, warsaw.to, "Europe/Warsaw")[0]).toBe("2026-08-30");
    expect(daysOf(la.from, la.to, "America/Los_Angeles")[0]).toBe("2026-08-29");
  });

  it("draws exactly the resolved cadence length in days", () => {
    const end = new Date("2026-08-28T08:00:00.000Z");
    const next = nextWindowAfter({ sprintEnd: end, lengthDays: 14, timeZone: "UTC" });

    const days = daysOf(next.from, next.to, "UTC");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-08-29");
    expect(days.at(-1)).toBe("2026-09-11");
  });

  it("follows the LEAD's length, not the sprint's own span", () => {
    // A 14-day sprint on a team that has set a 21-day cadence: the window is 21
    // days. Under the old ms-span rule it was 12 (the sprint's span in whole
    // days), which is what made a lead-set cadence unexpressible here.
    const end = new Date("2026-08-28T08:00:00.000Z");
    const next = nextWindowAfter({ sprintEnd: end, lengthDays: 21, timeZone: "UTC" });

    expect(daysOf(next.from, next.to, "UTC")).toHaveLength(21);
  });

  it("draws one FEWER day than the ms-span rule did, on tier-3 fallback", () => {
    // The migration note, asserted. A real Jira sprint ends at the same time of
    // day it starts, so its span is exactly `lengthDays` in milliseconds and
    // `enumerateDayKeys` over `[from, from + span]` drew `lengthDays + 1` keys.
    // Every account meets this, not only one that set a cadence — the extra day
    // would have inflated the forecast capacity by one working day per FTE.
    // `deriveCadence` yields 14 for exactly this pair, so this is tier 3.
    const start = new Date("2026-08-17T08:00:00.000Z");
    const end = new Date("2026-08-31T08:00:00.000Z");
    const lengthDays = 14;

    const next = nextWindowAfter({ sprintEnd: end, lengthDays, timeZone: "UTC" });
    const oldSpan = end.getTime() - start.getTime();
    const oldFrom = next.from;
    const oldDays = daysOf(oldFrom, new Date(oldFrom.getTime() + oldSpan), "UTC");

    expect(daysOf(next.from, next.to, "UTC")).toHaveLength(lengthDays);
    expect(oldDays).toHaveLength(lengthDays + 1);
  });

  it("keeps its day count across a DST transition", () => {
    // Europe/Warsaw falls back on 2026-10-25, so the window gains an hour. Day-key
    // arithmetic is immune; `from + 13 × 86_400_000` would have landed 23:00 on
    // the previous day and dropped a column.
    const end = new Date("2026-10-18T08:00:00.000Z");
    const next = nextWindowAfter({
      sprintEnd: end,
      lengthDays: 14,
      timeZone: "Europe/Warsaw",
    });

    const days = daysOf(next.from, next.to, "Europe/Warsaw");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-10-19");
    expect(days.at(-1)).toBe("2026-11-01");
  });
});
