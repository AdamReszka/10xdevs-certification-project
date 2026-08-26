import { describe, expect, it } from "vitest";

import { toInboxAnomalies } from "@/lib/anomaly/inbox-view";
import type { AnomalyView } from "@/lib/anomaly/reader";

/**
 * The anti-divergence guard (S-11 Phase 4).
 *
 * This mapping used to live inline in `dashboard/page.tsx`. It moved to a `.ts`
 * module so the Daily Recap email could call the SAME function — two copies
 * would drift invisibly, because both outputs look plausible and nothing fails
 * until a lead acts on an email that disagrees with the dashboard.
 */

function row(over: Partial<AnomalyView> = {}): AnomalyView {
  return {
    id: "a1",
    type: "PR_REVIEW_STALLED",
    severity: "HIGH",
    description: "PR #7 has waited 30h for a review",
    context: { number: 7, ageHours: 30, thresholdHours: 24 },
    suggestedAction: "Ping the reviewer on PR #7",
    sourceUrl: "https://github.test/acme/app/pull/7",
    riskScore: 42,
    detectedAt: new Date("2026-08-26T09:00:00.000Z"),
    relatedTeamMemberId: null,
    dedupKey: "PR_REVIEW_STALLED:7",
    ...over,
  } as AnomalyView;
}

describe("toInboxAnomalies", () => {
  it("carries the five FR-014 attributes through unchanged", () => {
    const [a] = toInboxAnomalies([row()], new Map());

    expect(a.severity).toBe("HIGH");
    expect(a.description).toBe("PR #7 has waited 30h for a review");
    expect(a.suggestedAction).toBe("Ping the reviewer on PR #7");
    expect(a.sourceUrl).toBe("https://github.test/acme/app/pull/7");
    expect(a.contextChips.length).toBeGreaterThan(0);
  });

  it("coalesces a null description and suggestedAction to empty strings", () => {
    // Both columns are NULLABLE while the client type declares them `string`.
    // An `undefined` reaching the renderer would print "undefined" into an email.
    const [a] = toInboxAnomalies(
      [row({ description: null, suggestedAction: null })],
      new Map(),
    );

    expect(a.description).toBe("");
    expect(a.suggestedAction).toBe("");
  });

  it("PRESERVES INPUT ORDER — it never re-sorts", () => {
    // `listAnomaliesForSprint` already returns FR-015's default order (HIGH →
    // MEDIUM → LOW via the Postgres enum's declaration order, then recency).
    // Sorting here — alphabetically, say — would put HIGH after LOW on the
    // dashboard AND in the email at once.
    const rows = [
      row({ id: "high", severity: "HIGH" }),
      row({ id: "medium", severity: "MEDIUM" }),
      row({ id: "low", severity: "LOW" }),
    ];

    expect(toInboxAnomalies(rows, new Map()).map((a) => a.id)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("resolves the member name, and null for an unknown id", () => {
    const names = new Map([["m1", "Mia Krystof"]]);

    const [known] = toInboxAnomalies([row({ relatedTeamMemberId: "m1" })], names);
    expect(known.memberName).toBe("Mia Krystof");

    const [gone] = toInboxAnomalies([row({ relatedTeamMemberId: "m-deleted" })], names);
    expect(gone.memberName).toBeNull();

    const [none] = toInboxAnomalies([row({ relatedTeamMemberId: null })], names);
    expect(none.memberName).toBeNull();
  });

  it("keeps a null sourceUrl null rather than inventing a link", () => {
    const [a] = toInboxAnomalies(
      [row({ type: "DEVELOPER_INACTIVE", sourceUrl: null, context: { noCommitDays: 3 } })],
      new Map(),
    );

    expect(a.sourceUrl).toBeNull();
    expect(a.identityKind).toBeNull();
  });

  it("serializes detectedAt to ISO, and null stays null", () => {
    expect(toInboxAnomalies([row()], new Map())[0].detectedAt).toBe(
      "2026-08-26T09:00:00.000Z",
    );
    expect(
      toInboxAnomalies([row({ detectedAt: null })], new Map())[0].detectedAt,
    ).toBeNull();
  });

  it("returns [] for an empty input", () => {
    expect(toInboxAnomalies([], new Map())).toEqual([]);
  });
});
