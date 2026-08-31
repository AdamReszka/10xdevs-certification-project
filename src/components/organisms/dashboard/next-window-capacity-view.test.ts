import { describe, expect, it } from "vitest";

import { toNextWindowCapacityView } from "@/components/organisms/dashboard/next-window-capacity-view";
import type { SprintCapacity } from "@/lib/dashboard/capacity";

/**
 * S-18 — what the forecast window's capacity figure is allowed to claim.
 *
 * The reducer's arithmetic is `capacity.test.ts`'s subject and is not re-tested
 * here; what is decided in this module is the badge and the two sentences, which
 * a `.tsx` could not be tested for at all (no jsdom, no RTL).
 */

const CAPACITY: SprintCapacity = {
  adjustedMd: 96,
  nominalMd: 110,
  sprintWorkingDays: 10,
  teamDaysOff: 0,
  calendarIsEmpty: false,
};

const NOW = new Date("2026-08-31T10:00:00.000Z");
const ZONE = "Europe/Warsaw";

function view(over: Partial<Parameters<typeof toNextWindowCapacityView>[0]> = {}) {
  return toNextWindowCapacityView({
    capacity: CAPACITY,
    hasForwardAbsence: true,
    windowStart: new Date("2026-09-01T00:00:00.000Z"),
    now: NOW,
    timeZone: ZONE,
    ...over,
  });
}

describe("toNextWindowCapacityView", () => {
  it("reports the adjusted figure with the nominal beside it", () => {
    const v = view();

    expect(v.md).toBe(96);
    expect(v.beforeAbsencesMd).toBe(110);
    expect(v.workingDays).toBe(10);
  });

  it("drops the nominal when absences did not reduce the window", () => {
    // Otherwise the panel renders "110 MD of 110 MD, after absences", which
    // reads as an adjustment nobody made.
    expect(
      view({ capacity: { ...CAPACITY, adjustedMd: 110 } }).beforeAbsencesMd,
    ).toBeNull();
  });

  it("reports team days off as its own number, zero included", () => {
    expect(view().teamDaysOff).toBe(0);
    expect(view({ capacity: { ...CAPACITY, teamDaysOff: 2 } }).teamDaysOff).toBe(2);
  });

  it("always carries a caveat", () => {
    // The figure is systematically optimistic and there is no offsetting term,
    // so there is no state in which it may appear bare.
    for (const v of [
      view(),
      view({ hasForwardAbsence: false }),
      view({ windowStart: new Date("2026-08-01T00:00:00.000Z") }),
    ]) {
      expect(v.caveat.length).toBeGreaterThan(0);
    }
  });

  it("is projected only while the window is still ahead", () => {
    // PLAN-REVIEW F3. `getActiveSprintRow` falls back to the most-recently-
    // STARTED sprint when none is ACTIVE, so between sprints — or after a
    // stalled sync — the "next window" is a fortnight that has already
    // happened, and a `Projected` badge would assert the opposite of the truth.
    expect(view().isProjected).toBe(true);
    expect(
      view({ windowStart: new Date("2026-08-17T00:00:00.000Z") }).isProjected,
    ).toBe(false);
  });

  it("is NOT projected once `now` reaches the window's first day", () => {
    // Compared on day keys, not instants: the window starts at local midnight,
    // so an instant comparison would keep the badge up through its own first day.
    expect(
      view({ windowStart: new Date("2026-08-30T22:00:00.000Z") }).isProjected,
    ).toBe(false);
  });

  it("says something different once the window is no longer ahead", () => {
    const ahead = view().caveat;
    const spent = view({ windowStart: new Date("2026-08-01T00:00:00.000Z") }).caveat;

    expect(spent).not.toBe(ahead);
    expect(spent).toMatch(/already begun or ended/);
  });

  it("names both inflating terms while the window is ahead", () => {
    // One sentence, both errors: the window is a projection from the cadence
    // rather than a sprint Jira created, AND forward absences may be missing.
    const caveat = view().caveat;

    expect(caveat).toMatch(/cadence/);
    expect(caveat).toMatch(/absences/);
    expect(caveat).toMatch(/too high/);
  });

  it("adds the stronger notice only when nothing forward was ever recorded", () => {
    // PLAN-REVIEW F2. It fires on the LEAD'S HABIT, not on this fortnight's
    // weather: zero absences in a given fortnight is the ordinary state of a
    // 3–10-person team, so a notice keyed on that would be on almost always.
    expect(view({ hasForwardAbsence: true }).noForwardAbsencesNotice).toBeNull();
    expect(view({ hasForwardAbsence: false }).noForwardAbsencesNotice).toMatch(
      /ceiling rather than a plan/,
    );
  });

  it("keeps the two notices independent", () => {
    // A spent window on an account with no forward absence still says both
    // things: they answer different questions.
    const v = view({
      hasForwardAbsence: false,
      windowStart: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(v.isProjected).toBe(false);
    expect(v.noForwardAbsencesNotice).not.toBeNull();
  });

  it("resolves the boundary in the TEAM's zone", () => {
    // 2026-08-31T22:30Z is already 1 September in Warsaw but still 31 August in
    // UTC, so a window starting 1 September is spent for one team and ahead for
    // the other.
    const late = new Date("2026-08-31T22:30:00.000Z");
    const windowStart = new Date("2026-09-01T00:00:00.000Z");

    expect(view({ now: late, windowStart, timeZone: "Europe/Warsaw" }).isProjected).toBe(
      false,
    );
    expect(view({ now: late, windowStart, timeZone: "UTC" }).isProjected).toBe(true);
  });
});
