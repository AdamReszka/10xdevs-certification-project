import { describe, expect, it } from "vitest";

import { detectPrReviewStalled } from "@/lib/anomaly/rules/pr-review-stalled";
import {
  NOW,
  effective,
  makeMember,
  makePr,
  makeReview,
  makeSnapshot,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectPrReviewStalled", () => {
  it("fires for an OPEN PR ready 48h with no review", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [
        makePr({ readyForReviewAt: new Date("2026-08-08T12:00:00.000Z"), reviews: [] }),
      ],
    });
    const out = detectPrReviewStalled(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "PR_REVIEW_STALLED",
      severity: "MEDIUM",
      dedupKey: "PR_REVIEW_STALLED:pr:5001",
      relatedTeamMemberId: "member-1",
      sourceUrl: "https://github.com/acme/repo/pull/42",
    });
    expect(out[0].magnitude).toBeCloseTo(1, 5); // 48h / (2*24) = 1
    expect(out[0].suggestedAction).toBe(
      "Ping a reviewer for PR #42 — 48h with no review yet.",
    );
    expect(out[0].description).toContain("PR #42");
    expect(out[0].context).toMatchObject({
      pullRequestId: "pr-1",
      number: 42,
      ageHours: 48,
      thresholdHours: 24,
    });
  });

  it("does not fire when a review was submitted after ready", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [
        makePr({
          readyForReviewAt: new Date("2026-08-08T12:00:00.000Z"),
          reviews: [makeReview({ submittedAt: new Date("2026-08-09T09:00:00.000Z") })],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when still within the window", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({ readyForReviewAt: new Date("2026-08-10T00:00:00.000Z"), reviews: [] }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for a draft PR (no readyForReviewAt) or a merged PR", () => {
    const draft = makePr({ readyForReviewAt: null });
    const merged = makePr({ githubPrId: 6002, state: "MERGED" });
    const snap = makeSnapshot({ pullRequests: [draft, merged] });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires exactly at the threshold boundary (>=)", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({ readyForReviewAt: new Date("2026-08-09T12:00:00.000Z"), reviews: [] }), // exactly 24h
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(1);
  });

  it("still fires when the only review predates ready-for-review", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          readyForReviewAt: new Date("2026-08-08T12:00:00.000Z"),
          reviews: [makeReview({ submittedAt: new Date("2026-08-07T00:00:00.000Z") })],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(1);
  });

  it("leaves relatedTeamMemberId null when the author is off-roster", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          authorGithubUsername: "stranger",
          readyForReviewAt: new Date("2026-08-08T12:00:00.000Z"),
          reviews: [],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)[0].relatedTeamMemberId).toBeNull();
  });
});
