import { describe, expect, it } from "vitest";

import {
  anomalyContextOf,
  anomalyIdentity,
  type PrReviewStalledContext,
  type SprintAtRiskContext,
  type TicketStatusAgingContext,
} from "@/lib/anomaly/context";

/**
 * S-07 Phase 2 — typed anomaly-context narrowing + display-identity helper. Guards
 * that each anomaly type narrows to its detector's write shape and that the
 * ticket/PR identity + sort key are derived (never fabricated for sprint-/member-
 * scoped rows).
 */

describe("anomalyContextOf", () => {
  it("narrows a PR context to its typed shape", () => {
    const row = {
      type: "PR_REVIEW_STALLED" as const,
      context: { pullRequestId: "p1", number: 42, ageHours: 30, thresholdHours: 24 },
    };
    const c: PrReviewStalledContext = anomalyContextOf(row);
    expect(c.number).toBe(42);
    expect(c.thresholdHours).toBe(24);
  });

  it("narrows a ticket context to its typed shape", () => {
    const row = {
      type: "TICKET_STATUS_AGING" as const,
      context: {
        ticketId: "t1",
        jiraKey: "SF-7",
        category: "CODE_REVIEW",
        storyPoints: 3,
        sinceIso: "2026-08-20T00:00:00.000Z",
      },
    };
    const c: TicketStatusAgingContext = anomalyContextOf(row);
    expect(c.jiraKey).toBe("SF-7");
    expect(c.category).toBe("CODE_REVIEW");
  });

  it("narrows SPRINT_AT_RISK to its inner discriminated union", () => {
    const parallel = {
      type: "SPRINT_AT_RISK" as const,
      context: {
        condition: "max_parallel",
        category: "TESTING",
        count: 4,
        limit: 2,
        teamMemberId: "m1",
      },
    };
    const c: SprintAtRiskContext = anomalyContextOf(parallel);
    if (c.condition === "max_parallel") {
      expect(c.count).toBe(4);
    } else {
      throw new Error("expected max_parallel variant");
    }
  });
});

describe("anomalyIdentity", () => {
  it("derives a #number PR identity for PR-scoped anomalies", () => {
    for (const type of ["PR_REVIEW_STALLED", "PR_TOO_BIG", "PR_TICKET_DESYNC"] as const) {
      const id = anomalyIdentity({ type, context: { number: 17 } });
      expect(id.kind).toBe("pr");
      expect(id.label).toBe("#17");
      expect(id.sortKey).toBe("pr:#17");
    }
  });

  it("derives a Jira-key ticket identity for ticket-scoped anomalies", () => {
    for (const type of ["TICKET_STATUS_AGING", "TICKET_NO_COMMIT_LINK"] as const) {
      const id = anomalyIdentity({ type, context: { jiraKey: "SF-99" } });
      expect(id.kind).toBe("ticket");
      expect(id.label).toBe("SF-99");
      expect(id.sortKey).toBe("ticket:SF-99");
    }
  });

  it("returns a null identity (no fabricated key) for sprint-/member-scoped anomalies", () => {
    for (const type of ["SCOPE_CREEP", "SPRINT_AT_RISK", "DEVELOPER_INACTIVE"] as const) {
      const id = anomalyIdentity({ type, context: {} });
      expect(id.kind).toBeNull();
      expect(id.label).toBeNull();
      expect(id.sortKey).toBe("");
    }
  });
});
