import { describe, expect, it } from "vitest";

import { detectPrTicketDesync } from "@/lib/anomaly/rules/pr-ticket-desync";
import {
  NOW,
  effective,
  makeMember,
  makePr,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectPrTicketDesync", () => {
  it("fires when a merged PR's ticket is not Done", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [
        makePr({ state: "MERGED", linkedTicketKey: "SF-1", mergedAt: NOW }),
      ],
      tickets: [makeTicket({ jiraKey: "SF-1", currentCategory: "CODE_REVIEW" })],
    });
    const out = detectPrTicketDesync(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "PR_TICKET_DESYNC",
      severity: "LOW",
      dedupKey: "PR_TICKET_DESYNC:pr:5001",
      magnitude: 1,
      relatedTeamMemberId: "member-1",
    });
    expect(out[0].description).toContain("SF-1");
    expect(out[0].description).toContain("Code Review");
    expect(out[0].suggestedAction).toContain("#42");
    expect(out[0].context).toMatchObject({
      number: 42,
      linkedTicketKey: "SF-1",
      ticketCategory: "CODE_REVIEW",
    });
  });

  it("does not fire when the linked ticket is Done", () => {
    const snap = makeSnapshot({
      pullRequests: [makePr({ state: "MERGED", linkedTicketKey: "SF-1" })],
      tickets: [makeTicket({ jiraKey: "SF-1", currentCategory: "DONE" })],
    });
    expect(detectPrTicketDesync(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when the ticket is not in the sprint snapshot", () => {
    const snap = makeSnapshot({
      pullRequests: [makePr({ state: "MERGED", linkedTicketKey: "SF-999" })],
      tickets: [makeTicket({ jiraKey: "SF-1", currentCategory: "CODE_REVIEW" })],
    });
    expect(detectPrTicketDesync(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for an open PR", () => {
    const snap = makeSnapshot({
      pullRequests: [makePr({ state: "OPEN", linkedTicketKey: "SF-1" })],
      tickets: [makeTicket({ jiraKey: "SF-1", currentCategory: "CODE_REVIEW" })],
    });
    expect(detectPrTicketDesync(snap, effective, NOW)).toHaveLength(0);
  });
});
