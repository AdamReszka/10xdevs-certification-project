import { describe, expect, it } from "vitest";

import { countTicketsMovedToDone, type DoneTransition } from "@/lib/dashboard/activity-done";

/**
 * "Tickets moved to Done" (S-11). The two properties that matter are
 * DISTINCTNESS and the RANGE BOUNDARIES — get either wrong and the number in the
 * email quietly disagrees with what the lead saw in Jira.
 */

const FROM = new Date("2026-08-25T22:00:00.000Z"); // Warsaw local midnight
const TO = new Date("2026-08-26T21:59:59.999Z"); // …to the last ms of that day

function t(over: Partial<DoneTransition> = {}): DoneTransition {
  return {
    ticketId: "SF-1",
    toCategory: "DONE",
    changedAt: new Date("2026-08-26T09:00:00.000Z"),
    ...over,
  };
}

describe("countTicketsMovedToDone", () => {
  it("counts one ticket once even when it enters Done twice", () => {
    // A ticket bounced out of and back into Done on the same day is ONE ticket
    // finished, not two. Counting rows would overstate the day's output in
    // exactly the churny situations the lead is trying to read clearly.
    const count = countTicketsMovedToDone(
      [
        t({ ticketId: "SF-1", changedAt: new Date("2026-08-26T09:00:00.000Z") }),
        t({ ticketId: "SF-1", changedAt: new Date("2026-08-26T15:00:00.000Z") }),
      ],
      { from: FROM, to: TO },
    );

    expect(count).toBe(1);
  });

  it("counts distinct tickets", () => {
    expect(
      countTicketsMovedToDone([t({ ticketId: "SF-1" }), t({ ticketId: "SF-2" })], {
        from: FROM,
        to: TO,
      }),
    ).toBe(2);
  });

  it("ignores transitions into any other category", () => {
    expect(
      countTicketsMovedToDone(
        [
          t({ ticketId: "SF-1", toCategory: "TESTING" }),
          t({ ticketId: "SF-2", toCategory: "CODE_REVIEW" }),
          t({ ticketId: "SF-3", toCategory: "DONE" }),
        ],
        { from: FROM, to: TO },
      ),
    ).toBe(1);
  });

  it("ignores an unmapped (null) category", () => {
    // Every category column is nullable — a status the owner never mapped under
    // FR-005 lands NULL, and must not be guessed into DONE.
    expect(
      countTicketsMovedToDone([t({ toCategory: null })], { from: FROM, to: TO }),
    ).toBe(0);
  });

  it("includes BOTH boundary instants", () => {
    // `dayRangeInTimeZone` returns `to` as the last millisecond of the local day,
    // so an exclusive upper bound would silently drop a transition landing there.
    expect(
      countTicketsMovedToDone(
        [t({ ticketId: "first", changedAt: FROM }), t({ ticketId: "last", changedAt: TO })],
        { from: FROM, to: TO },
      ),
    ).toBe(2);
  });

  it("excludes the instants just outside the range", () => {
    expect(
      countTicketsMovedToDone(
        [
          t({ ticketId: "before", changedAt: new Date(FROM.getTime() - 1) }),
          t({ ticketId: "after", changedAt: new Date(TO.getTime() + 1) }),
        ],
        { from: FROM, to: TO },
      ),
    ).toBe(0);
  });

  it("drops an undated transition rather than assuming it is today", () => {
    expect(
      countTicketsMovedToDone([t({ changedAt: null })], { from: FROM, to: TO }),
    ).toBe(0);
  });

  it("returns 0 for no transitions", () => {
    expect(countTicketsMovedToDone([], { from: FROM, to: TO })).toBe(0);
  });
});
