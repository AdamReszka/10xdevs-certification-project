import { describe, expect, it } from "vitest";

import {
  computeDeliveredSp,
  firstDoneAtByTicket,
  type FirstDoneTransition,
} from "@/lib/dashboard/first-done";

/**
 * S-23 phase 3 §5 — FR-023's delivered-SP rule. The scalar this replaces was
 * `sum(sp) filter (current_category = 'DONE')`, a snapshot of *now* rewritten by
 * every sync cycle including post-close ones. What is asserted here is the
 * property that fixes it: a first-DONE instant never moves, so the sum is a
 * function of the sprint window and nothing else.
 */

const SPRINT_START = new Date("2026-08-17T00:00:00.000Z");
const SPRINT_END = new Date("2026-08-31T00:00:00.000Z");
const AFTER_CLOSE = new Date("2026-09-05T12:00:00.000Z");

function done(ticketId: string, iso: string): FirstDoneTransition {
  return { ticketId, toCategory: "DONE", changedAt: new Date(iso) };
}

describe("firstDoneAtByTicket", () => {
  it("keeps the EARLIEST DONE transition, whatever order they arrive in", () => {
    const map = firstDoneAtByTicket([
      done("t1", "2026-08-25T10:00:00.000Z"),
      done("t1", "2026-08-20T10:00:00.000Z"),
      done("t1", "2026-08-28T10:00:00.000Z"),
    ]);

    expect(map.get("t1")).toEqual(new Date("2026-08-20T10:00:00.000Z"));
  });

  it("ignores non-DONE transitions and unorderable ones", () => {
    const map = firstDoneAtByTicket([
      { ticketId: "t1", toCategory: "IN_PROGRESS", changedAt: new Date("2026-08-18T10:00:00.000Z") },
      { ticketId: "t2", toCategory: "DONE", changedAt: null },
      { ticketId: "t3", toCategory: null, changedAt: new Date("2026-08-18T10:00:00.000Z") },
    ]);

    expect(map.size).toBe(0);
  });
});

describe("computeDeliveredSp", () => {
  const base = { sprintStart: SPRINT_START, sprintEnd: SPRINT_END, now: AFTER_CLOSE };

  it("counts a reopened-and-reclosed ticket ONCE, at its first completion", () => {
    const transitions = [
      done("t1", "2026-08-20T10:00:00.000Z"),
      done("t1", "2026-08-29T10:00:00.000Z"), // reopened, then closed again
    ];

    expect(
      computeDeliveredSp({
        ...base,
        tickets: [{ ticketId: "t1", storyPoints: 5 }],
        firstDoneAt: firstDoneAtByTicket(transitions),
      }),
    ).toBe(5);
  });

  it("excludes a ticket first finished AFTER the sprint ended", () => {
    expect(
      computeDeliveredSp({
        ...base,
        tickets: [{ ticketId: "t1", storyPoints: 8 }],
        firstDoneAt: firstDoneAtByTicket([done("t1", "2026-09-02T10:00:00.000Z")]),
      }),
    ).toBe(0);
  });

  it("excludes a carried-in ticket already done before this sprint started", () => {
    // The sync re-stamps a carried-over ticket into the current sprint, so
    // without the lower bound its SP would be counted a second time.
    expect(
      computeDeliveredSp({
        ...base,
        tickets: [{ ticketId: "t1", storyPoints: 13 }],
        firstDoneAt: firstDoneAtByTicket([done("t1", "2026-08-10T10:00:00.000Z")]),
      }),
    ).toBe(0);
  });

  it("counts an unestimated ticket as 0, never as NaN", () => {
    const delivered = computeDeliveredSp({
      ...base,
      tickets: [
        { ticketId: "t1", storyPoints: null },
        { ticketId: "t2", storyPoints: 3 },
      ],
      firstDoneAt: firstDoneAtByTicket([
        done("t1", "2026-08-20T10:00:00.000Z"),
        done("t2", "2026-08-21T10:00:00.000Z"),
      ]),
    });

    expect(delivered).toBe(3);
    expect(Number.isNaN(delivered)).toBe(false);
  });

  it("is IDEMPOTENT across cycles that run after the sprint closed", () => {
    const args = {
      tickets: [
        { ticketId: "t1", storyPoints: 5 },
        { ticketId: "t2", storyPoints: 2 },
      ],
      firstDoneAt: firstDoneAtByTicket([
        done("t1", "2026-08-20T10:00:00.000Z"),
        done("t2", "2026-08-30T10:00:00.000Z"),
      ]),
      sprintStart: SPRINT_START,
      sprintEnd: SPRINT_END,
    };

    const onLastDay = computeDeliveredSp({ ...args, now: new Date("2026-08-31T00:00:00.000Z") });
    const aWeekLater = computeDeliveredSp({ ...args, now: AFTER_CLOSE });

    expect(onLastDay).toBe(7);
    expect(aWeekLater).toBe(7);
  });

  it("clamps the upper bound to `now` mid-sprint, so the future never counts", () => {
    expect(
      computeDeliveredSp({
        tickets: [{ ticketId: "t1", storyPoints: 5 }],
        firstDoneAt: firstDoneAtByTicket([done("t1", "2026-08-25T10:00:00.000Z")]),
        sprintStart: SPRINT_START,
        sprintEnd: SPRINT_END,
        now: new Date("2026-08-22T00:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("ignores tickets with no DONE transition at all", () => {
    expect(
      computeDeliveredSp({
        ...base,
        tickets: [{ ticketId: "t1", storyPoints: 21 }],
        firstDoneAt: firstDoneAtByTicket([]),
      }),
    ).toBe(0);
  });

  it("counts up to the end bound when the sprint has no recorded start", () => {
    // Degradation, deliberate: "delivered nothing" is a stronger and falser
    // claim than "could not exclude carry-ins".
    expect(
      computeDeliveredSp({
        tickets: [{ ticketId: "t1", storyPoints: 5 }],
        firstDoneAt: firstDoneAtByTicket([done("t1", "2026-08-10T10:00:00.000Z")]),
        sprintStart: null,
        sprintEnd: SPRINT_END,
        now: AFTER_CLOSE,
      }),
    ).toBe(5);
  });
});
