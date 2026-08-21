import { describe, expect, it } from "vitest";

import {
  distinctTypes,
  filterAnomalies,
  sortAnomalies,
} from "@/components/organisms/anomaly/inbox-controls";
import type { InboxAnomaly } from "@/components/organisms/anomaly/types";

/**
 * S-07 Phase 4 — pure inbox sort/filter logic. Guards the four sort comparators,
 * the type/member filter predicates (incl. the UNASSIGNED team-level bucket), and
 * non-mutation of the source array.
 */

function a(over: Partial<InboxAnomaly>): InboxAnomaly {
  return {
    id: over.id ?? "id",
    type: "PR_TOO_BIG",
    severity: "MEDIUM",
    description: "d",
    suggestedAction: "s",
    sourceUrl: null,
    riskScore: 50,
    detectedAt: "2026-08-10T10:00:00.000Z",
    memberId: null,
    memberName: null,
    identityKind: null,
    identityLabel: null,
    identitySortKey: "",
    contextChips: [],
    dedupKey: "k",
    ...over,
  };
}

describe("filterAnomalies", () => {
  const list = [
    a({ id: "1", type: "PR_TOO_BIG", memberId: "m1" }),
    a({ id: "2", type: "SCOPE_CREEP", memberId: null }),
    a({ id: "3", type: "PR_TOO_BIG", memberId: "m2" }),
  ];

  it("filters by type", () => {
    expect(filterAnomalies(list, "SCOPE_CREEP", "ALL").map((x) => x.id)).toEqual(["2"]);
  });

  it("filters by member id", () => {
    expect(filterAnomalies(list, "ALL", "m2").map((x) => x.id)).toEqual(["3"]);
  });

  it("UNASSIGNED selects only null-member (team-level) rows", () => {
    expect(filterAnomalies(list, "ALL", "UNASSIGNED").map((x) => x.id)).toEqual(["2"]);
  });

  it("ALL/ALL is a no-op", () => {
    expect(filterAnomalies(list, "ALL", "ALL")).toHaveLength(3);
  });
});

describe("sortAnomalies", () => {
  it("severity: HIGH → MEDIUM → LOW", () => {
    const list = [
      a({ id: "med", severity: "MEDIUM" }),
      a({ id: "low", severity: "LOW" }),
      a({ id: "high", severity: "HIGH" }),
    ];
    expect(sortAnomalies(list, "severity").map((x) => x.id)).toEqual([
      "high",
      "med",
      "low",
    ]);
  });

  it("age: newest first, null detectedAt last", () => {
    const list = [
      a({ id: "old", detectedAt: "2026-08-01T00:00:00.000Z" }),
      a({ id: "null", detectedAt: null }),
      a({ id: "new", detectedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect(sortAnomalies(list, "age").map((x) => x.id)).toEqual(["new", "old", "null"]);
  });

  it("ticket: identity rows first (lexical), identity-less last", () => {
    const list = [
      a({ id: "none", identitySortKey: "" }),
      a({ id: "pr9", identitySortKey: "pr:#9" }),
      a({ id: "pr1", identitySortKey: "pr:#1" }),
    ];
    expect(sortAnomalies(list, "ticket").map((x) => x.id)).toEqual(["pr1", "pr9", "none"]);
  });

  it("developer: alphabetical by name, team-level (null) last", () => {
    const list = [
      a({ id: "bob", memberName: "Bob" }),
      a({ id: "team", memberName: null }),
      a({ id: "ann", memberName: "Ann" }),
    ];
    expect(sortAnomalies(list, "developer").map((x) => x.id)).toEqual([
      "ann",
      "bob",
      "team",
    ]);
  });

  it("does not mutate the source array", () => {
    const list = [
      a({ id: "med", severity: "MEDIUM" }),
      a({ id: "high", severity: "HIGH" }),
    ];
    sortAnomalies(list, "severity");
    expect(list.map((x) => x.id)).toEqual(["med", "high"]);
  });
});

describe("distinctTypes", () => {
  it("returns each type once, in first-seen order", () => {
    const list = [
      a({ type: "PR_TOO_BIG" }),
      a({ type: "SCOPE_CREEP" }),
      a({ type: "PR_TOO_BIG" }),
    ];
    expect(distinctTypes(list)).toEqual(["PR_TOO_BIG", "SCOPE_CREEP"]);
  });
});
