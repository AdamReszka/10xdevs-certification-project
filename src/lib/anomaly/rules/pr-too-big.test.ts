import { describe, expect, it } from "vitest";

import { detectPrTooBig } from "@/lib/anomaly/rules/pr-too-big";
import {
  NOW,
  effective,
  makeMember,
  makePr,
  makeSnapshot,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectPrTooBig", () => {
  it("fires for an OPEN PR over the line limit", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      pullRequests: [makePr({ additions: 400, deletions: 200 })], // 600 > 500
    });
    const out = detectPrTooBig(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "PR_TOO_BIG",
      severity: "LOW",
      dedupKey: "PR_TOO_BIG:pr:5001",
      relatedTeamMemberId: "member-1",
      sourceUrl: "https://github.com/acme/repo/pull/42",
    });
    expect(out[0].magnitude).toBeCloseTo(0.2, 5); // (600-500)/500
    expect(out[0].description).toContain("600 lines");
    expect(out[0].suggestedAction).toContain("#42");
    expect(out[0].context).toMatchObject({
      number: 42,
      lines: 600,
      maxLines: 500,
    });
  });

  it("does not fire for a PR within the limit", () => {
    const snap = makeSnapshot({
      pullRequests: [makePr({ additions: 100, deletions: 20 })],
    });
    expect(detectPrTooBig(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for a PR merged before the sprint started", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          additions: 900,
          deletions: 100,
          state: "MERGED",
          mergedAt: new Date("2026-07-20T00:00:00.000Z"), // before sprint start
        }),
      ],
    });
    expect(detectPrTooBig(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires for a PR merged on/after sprint start", () => {
    const snap = makeSnapshot({
      pullRequests: [
        makePr({
          additions: 700,
          deletions: 100, // 800 > 500
          state: "MERGED",
          mergedAt: new Date("2026-08-05T00:00:00.000Z"), // after sprint start
        }),
      ],
    });
    const out = detectPrTooBig(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].magnitude).toBeCloseTo((800 - 500) / 500, 5);
  });

  it("does not fire exactly at the line limit", () => {
    const snap = makeSnapshot({
      pullRequests: [makePr({ additions: 300, deletions: 200 })], // exactly 500
    });
    expect(detectPrTooBig(snap, effective, NOW)).toHaveLength(0);
  });
});
