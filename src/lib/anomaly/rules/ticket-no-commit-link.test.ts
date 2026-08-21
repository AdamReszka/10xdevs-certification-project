import { describe, expect, it } from "vitest";

import { detectTicketNoCommitLink } from "@/lib/anomaly/rules/ticket-no-commit-link";
import {
  NOW,
  effective,
  makeCommit,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

describe("detectTicketNoCommitLink", () => {
  it("fires for an In-Progress ticket 3d old with no commit referencing it", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          jiraKey: "SF-7",
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"),
        }),
      ],
      commits: [makeCommit({ message: "SF-99 unrelated work" })],
    });
    const out = detectTicketNoCommitLink(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "TICKET_NO_COMMIT_LINK",
      severity: "MEDIUM",
      dedupKey: "TICKET_NO_COMMIT_LINK:ticket:SF-7",
      relatedTeamMemberId: null,
    });
    expect(out[0].description).toContain("SF-7");
    expect(out[0].suggestedAction).toContain("SF-7");
    expect(out[0].context).toMatchObject({
      jiraKey: "SF-7",
      daysInProgress: 3,
      noCommitDays: 2,
    });
    expect(out[0].magnitude).toBeCloseTo(3 / 4, 5); // 3d / (2*2)
  });

  it("does not fire when a recent commit references the ticket key", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          jiraKey: "SF-7",
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"),
        }),
      ],
      commits: [
        makeCommit({
          message: "sf-7 wire it up",
          authoredAt: new Date("2026-08-10T09:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for a ticket In Progress less than the window", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-09T12:00:00.000Z"), // 1d
        }),
      ],
      commits: [],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });
});
