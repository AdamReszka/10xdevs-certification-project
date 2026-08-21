import { describe, expect, it } from "vitest";

import { detectScopeCreep } from "@/lib/anomaly/rules/scope-creep";
import {
  NOW,
  effective,
  makeSnapshot,
  makeSprint,
  makeTicket,
} from "@/lib/anomaly/test-support";

describe("detectScopeCreep", () => {
  it("fires when post-start additions exceed the percentage of committed scope", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ committedSp: 40 }),
      tickets: [
        makeTicket({ id: "t1", jiraKey: "SF-1", addedAfterSprintStart: true, storyPoints: 5 }),
        makeTicket({ id: "t2", jiraKey: "SF-2", addedAfterSprintStart: true, storyPoints: 5 }),
      ], // 10/40 = 25% > 20%
    });
    const out = detectScopeCreep(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "SCOPE_CREEP",
      severity: "MEDIUM",
      dedupKey: "SCOPE_CREEP:sprint:sprint-1",
      relatedTeamMemberId: null,
    });
    expect(out[0].description).toContain("10 SP");
    expect(out[0].suggestedAction).toContain("25%");
    expect(out[0].context).toMatchObject({
      addedSp: 10,
      committedSp: 40,
      actualPercent: 25,
      thresholdPercent: 20,
    });
    expect(out[0].magnitude).toBeCloseTo(25 / 40, 5); // actual / (2*threshold)
  });

  it("does not fire below the threshold", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ committedSp: 40 }),
      tickets: [
        makeTicket({ addedAfterSprintStart: true, storyPoints: 5 }), // 12.5% < 20%
      ],
    });
    expect(detectScopeCreep(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when committed SP is unknown (no denominator)", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ committedSp: null }),
      tickets: [makeTicket({ addedAfterSprintStart: true, storyPoints: 50 })],
    });
    expect(detectScopeCreep(snap, effective, NOW)).toHaveLength(0);
  });
});
