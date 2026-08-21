import { describe, expect, it } from "vitest";

import { detectTicketStatusAging } from "@/lib/anomaly/rules/ticket-status-aging";
import {
  NOW,
  effective,
  makeMember,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectTicketStatusAging", () => {
  it("fires for a 3-SP In-Progress ticket past its 48h budget", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"), // 72h
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
    expect(out[0].magnitude).toBeCloseTo(72 / 96, 5); // 72h / (2*48)
  });

  it("does not fire when within the budget", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 3,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-09T18:00:00.000Z"), // 18h < 48h
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(0);
  });

  it("resolves the 8_WORKING_DAYS sentinel for a 21-SP ticket", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 21,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-07-25T12:00:00.000Z"), // >8 working days
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(1);
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

  it("fires for a Code Review ticket past 24h", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "CODE_REVIEW",
          storyPoints: null,
          lastStatusChangeAt: new Date("2026-08-08T12:00:00.000Z"), // 48h
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
          lastStatusChangeAt: new Date("2026-08-08T12:00:00.000Z"), // exactly 48h
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)).toHaveLength(1);
  });

  it("uses the nearest lower SP bucket for an off-scale estimate", () => {
    // SP 4 is not a defined bucket → falls to bucket 3 (48h budget).
    const past = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 4,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-08T00:00:00.000Z"), // 60h > 48h
        }),
      ],
    });
    expect(detectTicketStatusAging(past, effective, NOW)).toHaveLength(1);

    const within = makeSnapshot({
      tickets: [
        makeTicket({
          storyPoints: 4,
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-09T00:00:00.000Z"), // 36h < 48h
        }),
      ],
    });
    expect(detectTicketStatusAging(within, effective, NOW)).toHaveLength(0);
  });

  it("fires for a Testing ticket past 48h and not before", () => {
    const past = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "TESTING",
          storyPoints: null,
          lastStatusChangeAt: new Date("2026-08-08T00:00:00.000Z"), // 60h > 48h
        }),
      ],
    });
    expect(detectTicketStatusAging(past, effective, NOW)).toHaveLength(1);

    const within = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "TESTING",
          storyPoints: null,
          lastStatusChangeAt: new Date("2026-08-09T00:00:00.000Z"), // 36h < 48h
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
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketStatusAging(snap, effective, NOW)[0].description).toContain(
      "2026-08-07",
    );
  });
});
