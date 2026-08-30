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

/**
 * THE CLOCK (S-28). The review budget is 8 WORKING hours — one shift — measured
 * 08:00–16:00 UTC, Mon–Fri. `NOW` is **Monday** 2026-08-10T12:00Z, so Monday
 * contributes 4 working hours and each earlier weekday 8; the weekend
 * contributes nothing. Each seed names its weekday, because that and not the
 * calendar distance is what decides the outcome.
 */
describe("detectPrReviewStalled", () => {
  it("fires for an OPEN PR ready 16 working hours with no review", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [
        // Thu noon → Thu 4 + Fri 8 + Mon 4 = 16 working hours.
        makePr({ readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"), reviews: [] }),
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
    expect(out[0].magnitude).toBeCloseTo(1, 5); // 16 wh / (2*8) = 1
    expect(out[0].suggestedAction).toBe(
      "Ping a reviewer for PR #42 — 16 working hours with no review yet.",
    );
    expect(out[0].description).toContain("PR #42");
    expect(out[0].context).toMatchObject({
      pullRequestId: "pr-1",
      number: 42,
      ageHours: 16,
      thresholdHours: 8,
    });
  });

  it("does not fire when a review was submitted after ready", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [
        makePr({
          readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"), // Thu
          reviews: [makeReview({ submittedAt: new Date("2026-08-07T09:00:00.000Z") })],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when still within the window", () => {
    const snap = makeSnapshot({
      pullRequests: [
        // This morning → 3 working hours, inside the 8.
        makePr({ readyForReviewAt: new Date("2026-08-10T09:00:00.000Z"), reviews: [] }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for a draft PR (no readyForReviewAt) or a merged PR", () => {
    const draft = makePr({ readyForReviewAt: null });
    // The merged PR is seeded WELL past the budget on purpose: if it were fresh,
    // the age gate would suppress it and this test would pass without the state
    // guard ever running — it would stop being a test of `state !== "OPEN"`.
    const merged = makePr({
      githubPrId: 6002,
      state: "MERGED",
      readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"), // Thu → 16 wh
      reviews: [],
    });
    const snap = makeSnapshot({ pullRequests: [draft, merged] });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires exactly at the threshold boundary (>=)", () => {
    const snap = makeSnapshot({
      pullRequests: [
        // Fri noon → Fri 4 + Mon 4 = exactly 8 working hours.
        makePr({ readyForReviewAt: new Date("2026-08-07T12:00:00.000Z"), reviews: [] }),
      ],
    });
    const out = detectPrReviewStalled(snap, effective, NOW);
    expect(out).toHaveLength(1);
    // Asserted HERE rather than only on the 16-hour case, where `clamp01`
    // saturates at 1 and hides any arithmetic error in the denominator.
    expect(out[0].magnitude).toBeCloseTo(0.5, 5); // 8 wh / (2*8)
  });

  it("treats a review submitted at the very instant of ready as a review", () => {
    // `>=`, not `>`: a reviewer who got there the same second did review it.
    const ready = new Date("2026-08-06T12:00:00.000Z");
    const snap = makeSnapshot({
      pullRequests: [
        makePr({ readyForReviewAt: ready, reviews: [makeReview({ submittedAt: ready })] }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)).toHaveLength(0);
  });

  it("names an untitled PR rather than rendering an empty quote", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          title: null,
          readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"),
          reviews: [],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)[0].description).toContain(
      '"(untitled)"',
    );
  });

  it("still fires when the only review predates ready-for-review", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"), // Thu
          reviews: [makeReview({ submittedAt: new Date("2026-08-05T00:00:00.000Z") })],
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
          readyForReviewAt: new Date("2026-08-06T12:00:00.000Z"), // Thu
          reviews: [],
        }),
      ],
    });
    expect(detectPrReviewStalled(snap, effective, NOW)[0].relatedTeamMemberId).toBeNull();
  });
});

/**
 * A review clock stops when nobody is there to review (S-28).
 *
 * The frame left open whether a PR that has waited across a weekend is still
 * worth surfacing on Monday. It is — but at the close of Monday's shift rather
 * than at Saturday breakfast, and the age it reports is the time reviewers
 * actually had, not the time the planet turned.
 */
describe("detectPrReviewStalled across a weekend", () => {
  const readyFridayAtClose = makePr({
    readyForReviewAt: new Date("2026-08-07T16:00:00.000Z"),
    reviews: [],
  });

  it("stays silent all weekend", () => {
    const snap = makeSnapshot({ pullRequests: [readyFridayAtClose] });
    for (const now of [
      new Date("2026-08-08T16:00:00.000Z"), // Sat
      new Date("2026-08-09T16:00:00.000Z"), // Sun
    ]) {
      expect(detectPrReviewStalled(snap, effective, now)).toHaveLength(0);
    }
  });

  it("fires at the close of the first working day, reporting one shift", () => {
    const snap = makeSnapshot({ pullRequests: [readyFridayAtClose] });
    const out = detectPrReviewStalled(
      snap,
      effective,
      new Date("2026-08-10T16:00:00.000Z"),
    );
    expect(out).toHaveLength(1);
    // 8, not 72 — the weekend was never review time.
    expect(out[0].context).toMatchObject({ ageHours: 8 });
  });

  it("is pushed a further working day by a team-wide day off", () => {
    const snap = makeSnapshot({
      pullRequests: [readyFridayAtClose],
      nonWorkingDays: new Set(["2026-08-10"]),
    });
    expect(
      detectPrReviewStalled(snap, effective, new Date("2026-08-10T16:00:00.000Z")),
    ).toHaveLength(0);
    expect(
      detectPrReviewStalled(snap, effective, new Date("2026-08-11T16:00:00.000Z")),
    ).toHaveLength(1);
  });
});
