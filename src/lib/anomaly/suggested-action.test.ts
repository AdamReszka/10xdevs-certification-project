import { describe, expect, it } from "vitest";

import { suggestedAction } from "@/lib/anomaly/suggested-action";

describe("suggestedAction templates", () => {
  it("grounds the PR-review action in the PR number and age", () => {
    expect(suggestedAction.prReviewStalled({ number: 42, hours: 30 })).toBe(
      "Ping a reviewer for PR #42 — 30 working hours with no review yet.",
    );
  });

  it("grounds the developer-inactive action in the member name", () => {
    expect(suggestedAction.developerInactive({ name: "Alex Dev", days: 2 })).toContain(
      "Alex Dev",
    );
  });

  it("resolves a category label when none is passed", () => {
    expect(
      suggestedAction.ticketStatusAging({ key: "SF-1", category: "CODE_REVIEW" }),
    ).toContain("Code Review");
  });
});
