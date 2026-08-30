import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import { mergeRule } from "@/lib/anomaly/thresholds";
import { detectTicketStatusAging } from "@/lib/anomaly/rules/ticket-status-aging";
import {
  NOW,
  effective,
  makeMember,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

const member = makeMember();

/**
 * THE CLOCK THESE SEEDS ARE READ AGAINST (S-28). Every budget below is in
 * WORKING hours: 08:00–16:00 UTC, Mon–Fri, no team-wide days off unless a test
 * passes its own. `NOW` is **Monday** 2026-08-10T12:00Z, so the current Monday
 * contributes 4 working hours (08:00 → 12:00) and each earlier weekday
 * contributes 8. The weekdays each seed lands on are named in its comment
 * because that, not the calendar distance, is what decides the outcome:
 *
 *   Mon 08-10 09:00 →  3    Fri 08-07 12:00 →  8    Fri 08-07 08:00 → 12
 *   Thu 08-06 12:00 → 16    Wed 08-05 12:00 → 24    Wed 07-29 12:00 → 64
 *
 * Defaults after the recalibration: 1/2 SP = 8, 3 SP = 16, 5 SP = 24,
 * 8/13 SP = 40, 21 SP = 64, Code Review = 8, Testing = 16.
 */
describe("detectTicketStatusAging", () => {
  it("fires for a 3-SP In-Progress ticket past its 16-working-hour budget", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          // Wed → 24 working hours by Monday noon.
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"),
        }),
      ],
    });
    const out = detectTicketStatusAging(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "TICKET_STATUS_AGING",
      severity: "MEDIUM",
      dedupKey: "TICKET_STATUS_AGING:ticket:SF-1",
      relatedTeamMemberId: "member-1",
      sourceUrl: "https://example.atlassian.net/browse/SF-1",
    });
    expect(out[0].description).toContain("In Progress");
    expect(out[0].context).toMatchObject({
      jiraKey: "SF-1",
      category: "IN_PROGRESS",
      storyPoints: 3,
    });
    expect(out[0].magnitude).toBeCloseTo(24 / 32, 5); // 24 wh / (2*16)
  });

  it("does not fire when within the budget", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          // This morning → 3 working hours, well inside the 16.
          lastStatusChangeAt: new Date("2026-08-10T09:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(0);
  });

  it("gives a 21-SP ticket a 64-working-hour budget", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 21,
          currentCategory: "IN_PROGRESS",
          // Wed 07-29 → exactly 64 working hours, eight working days.
          lastStatusChangeAt: new Date("2026-07-29T12:00:00.000Z"),
        }),
      ],
    });
    const out = detectTicketStatusAging(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].magnitude).toBeCloseTo(64 / 128, 5);
  });

  it("skips In-Progress tickets with unknown story points", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: null,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-01T12:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires for a Code Review ticket past its 8-working-hour budget", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "CODE_REVIEW",
          storyPoints: null,
          // Fri morning → 12 working hours (Fri 8 + Mon 4).
          lastStatusChangeAt: new Date("2026-08-07T08:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(1);
  });

  it("fires exactly at the budget boundary (>=)", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          // Thu noon → exactly 16 working hours.
          lastStatusChangeAt: new Date("2026-08-06T12:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(1);
  });

  it("uses the nearest lower SP bucket for an off-scale estimate", () => {
    // SP 4 is not a defined bucket → falls to bucket 3 (16 working hours).
    const past = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 4,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"), // 24 > 16
        }),
      ],
    });
    expect(detectTicketStatusAging(past, effective, NOW)).toHaveLength(1);

    const within = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 4,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"), // 8 < 16
        }),
      ],
    });
    expect(detectTicketStatusAging(within, effective, NOW)).toHaveLength(0);
  });

  it("fires for a Testing ticket past 16 working hours and not before", () => {
    const past = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "TESTING",
          storyPoints: null,
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"), // 24 > 16
        }),
      ],
    });
    expect(detectTicketStatusAging(past, effective, NOW)).toHaveLength(1);

    const within = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "TESTING",
          storyPoints: null,
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"), // 8 < 16
        }),
      ],
    });
    expect(detectTicketStatusAging(within, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for Done or To Do tickets", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({ id: "d", jiraKey: "SF-8", currentCategory: "DONE" }),
        makeTicket({ id: "t", jiraKey: "SF-9", currentCategory: "TODO" }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(0);
  });

  it("puts the status-change date in the description", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)[0].description).toContain(
      "2026-08-05",
    );
  });
});

/**
 * THE DEFECT S-28 CLOSES, stated as a test.
 *
 * The owner's own report: a 3 SP ticket moved to In Progress on Friday at 16:00
 * had a 48 h budget and fired on Sunday at 16:00 — into the Monday morning-sync
 * inbox FR-016 calls the product's headline surface — having consumed nothing
 * but a weekend. The Sunday case below is exactly that seed; before this slice
 * it produced an anomaly, and it must now produce none.
 */
describe("detectTicketStatusAging across a weekend", () => {
  /** 3 SP, moved at the close of Friday's shift. Budget: 16 working hours. */
  const movedFridayAtClose = makeTicket({
    storyPoints: 3,
    currentCategory: "IN_PROGRESS",
    lastStatusChangeAt: new Date("2026-08-07T16:00:00.000Z"),
  });

  it("stays silent all weekend — no working hour has passed", () => {
    const snap = makeSnapshot({ tickets: [movedFridayAtClose] });
    for (const now of [
      new Date("2026-08-08T16:00:00.000Z"), // Sat
      new Date("2026-08-09T16:00:00.000Z"), // Sun — the reported false positive
    ]) {
      expect(detectTicketStatusAging(snap, effective, now)).toHaveLength(0);
    }
  });

  it("fires once two whole working days have actually been spent", () => {
    const snap = makeSnapshot({ tickets: [movedFridayAtClose] });
    // Mon 8 + Tue 8 = 16, the boundary. Monday close is 8 and still short.
    expect(
      detectTicketStatusAging(snap, effective, new Date("2026-08-10T16:00:00.000Z")),
    ).toHaveLength(0);
    expect(
      detectTicketStatusAging(snap, effective, new Date("2026-08-11T16:00:00.000Z")),
    ).toHaveLength(1);
  });

  it("is pushed a further working day by a team-wide day off", () => {
    // Monday is a company day off (S-23, FR-007). It buys nobody time to move
    // the ticket, so it must not spend the budget either. `manual-test-backlog`
    // 11.5 recorded the opposite as deliberate for an hour-budgeted bucket;
    // this slice reverses that.
    const snap = makeSnapshot({
      tickets: [movedFridayAtClose],
      nonWorkingDays: new Set(["2026-08-10"]),
    });
    expect(
      detectTicketStatusAging(snap, effective, new Date("2026-08-11T16:00:00.000Z")),
    ).toHaveLength(0);
    expect(
      detectTicketStatusAging(snap, effective, new Date("2026-08-12T16:00:00.000Z")),
    ).toHaveLength(1);
  });
});

/**
 * S-23 Phase 2 — a ticket does not age on a day the whole team is off
 * (FR-007/FR-022), now true of EVERY bucket rather than only the 21-SP one.
 *
 * The clock is the fixture's: NOW is Mon 2026-08-10T12:00Z, week Mon–Fri, UTC.
 * From Wed 2026-07-29 at noon the elapsed working hours are Wed 4, Thu 30 (8),
 * Fri 31 (8), Mon 03 (8), Tue 04 (8), Wed 05 (8), Thu 06 (8), Fri 07 (8) and
 * Mon 10 (4) = exactly 64, the 21-SP trigger boundary. Removing Wed 2026-08-05
 * leaves 56, one working day short.
 */
describe("detectTicketStatusAging with team-wide days off", () => {
  const ticket = makeTicket({
    storyPoints: 21,
    currentCategory: "IN_PROGRESS",
    lastStatusChangeAt: new Date("2026-07-29T12:00:00.000Z"),
  });

  it("fires at exactly 64 working hours when no day off intervenes", () => {
    expect(
      detectTicketStatusAging(makeSnapshot({ tickets: [ticket] }), effective, NOW),
    ).toHaveLength(1);
  });

  it("does not fire when a team day off falls inside the window", () => {
    const snap = makeSnapshot({
      tickets: [ticket],
      nonWorkingDays: new Set(["2026-08-05"]),
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(0);
  });

  it("is unaffected by a day off outside the elapsed window", () => {
    const snap = makeSnapshot({
      tickets: [ticket],
      // Before the ticket moved, so not one of the days it has been sitting.
      nonWorkingDays: new Set(["2026-07-28"]),
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(1);
  });
});

/**
 * COMPATIBILITY WITH A PRE-S-28 STORED OVERRIDE, end to end.
 *
 * `thresholds.test.ts` pins that the literal still parses and normalises to 64.
 * This pins the consequence the lead would actually feel: the rule keeps the
 * severity that account chose, and the detector — which has no branch left for
 * the string — measures against a 64-working-hour budget.
 */
describe("detectTicketStatusAging on a legacy 8_WORKING_DAYS override", () => {
  const legacy = mergeRule(
    "TICKET_STATUS_AGING",
    DEFAULT_THRESHOLDS.TICKET_STATUS_AGING,
    {
      severityOverride: "HIGH",
      thresholds: {
        inProgressHoursBySp: {
          "1": 8,
          "2": 8,
          "3": 16,
          "5": 24,
          "8": 40,
          "13": 40,
          "21": "8_WORKING_DAYS",
        },
        codeReviewHours: 8,
        testingHours: 16,
      },
    },
  );
  const legacyEffective = {
    ...effective,
    TICKET_STATUS_AGING: legacy,
  } as typeof effective;

  it("keeps the account's severity rather than reverting to the defaults", () => {
    expect(legacy.severity).toBe("HIGH");
  });

  it("measures the 21-SP bucket against 64 working hours", () => {
    const at64 = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 21,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-07-29T12:00:00.000Z"), // exactly 64
        }),
      ],
    });
    const out = detectTicketStatusAging(at64, legacyEffective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("HIGH");

    const shortOfIt = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 21,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-07-30T12:00:00.000Z"), // 56
        }),
      ],
    });
    expect(detectTicketStatusAging(shortOfIt, legacyEffective, NOW)).toHaveLength(0);
  });
});
