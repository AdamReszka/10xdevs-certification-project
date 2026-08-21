import { describe, expect, it } from "vitest";

import { detectDeveloperInactive } from "@/lib/anomaly/rules/developer-inactive";
import {
  NOW,
  effective,
  makeCommit,
  makeMember,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectDeveloperInactive", () => {
  it("fires for a member with active work but no recent commits", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [], // nothing in the window
    });
    const out = detectDeveloperInactive(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "DEVELOPER_INACTIVE",
      severity: "MEDIUM",
      dedupKey: "DEVELOPER_INACTIVE:member:member-1",
      relatedTeamMemberId: "member-1",
      magnitude: 1,
      sourceUrl: null,
    });
    expect(out[0].description).toContain("Alex Dev");
    expect(out[0].suggestedAction).toContain("Alex Dev");
    expect(out[0].context).toMatchObject({
      teamMemberId: "member-1",
      githubUsername: "alexdev",
      noCommitDays: 2,
    });
  });

  it("does not fire when a commit sits exactly on the window boundary", () => {
    // authoredAt === windowStart (NOW − 2d) is inside the window (>=) → active.
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-08T12:00:00.000Z") })],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when the member committed within the window", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-10T09:00:00.000Z") })],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire when the member has no In-Progress work", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "TODO" })],
      commits: [],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(0);
  });
});
