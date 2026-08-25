import { describe, expect, it } from "vitest";

import { detectDeveloperInactive } from "@/lib/anomaly/rules/developer-inactive";
import {
  NOW,
  effective,
  makeAbsence,
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

/**
 * FR-010: a recorded absence SUPPRESSES this anomaly for that member. An absent
 * developer with no commits is explained, not anomalous — and an inbox that keeps
 * flagging someone the owner has already told it is on holiday teaches the lead
 * to ignore the inbox.
 *
 * Suppression is unconditional on absence TYPE, and is judged against the rule's
 * own evaluation window `[now − noCommitDays, now]` — the only window in which
 * the missing commits would have happened.
 *
 * Every expectation below is hand-derived from the fixture clock: NOW is
 * 2026-08-10T12:00Z and `noCommitDays` defaults to 2, so the window is
 * 2026-08-08T12:00Z → 2026-08-10T12:00Z.
 */
describe("detectDeveloperInactive — absence suppression (FR-010)", () => {
  function inactiveSnapshot(absences: ReturnType<typeof makeAbsence>[]) {
    return makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [],
      absences,
    });
  }

  it("suppresses the anomaly for a member away across the window", () => {
    const out = detectDeveloperInactive(
      inactiveSnapshot([makeAbsence()]),
      effective,
      NOW,
    );

    expect(out).toEqual([]);
  });

  it("suppresses regardless of the absence type", () => {
    // FR-010 makes no distinction: sickness explains missing commits exactly as
    // vacation does.
    for (const type of ["VACATION", "SICKNESS", "TRAINING"] as const) {
      const out = detectDeveloperInactive(
        inactiveSnapshot([makeAbsence({ type })]),
        effective,
        NOW,
      );
      expect(out).toEqual([]);
    }
  });

  it("suppresses when the absence covers only the window's FIRST day", () => {
    // 2026-08-06 → 2026-08-08 (inclusive) ends at 23:59:59.999Z on the 8th,
    // which is inside the window that opens at 12:00Z that day.
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-06T00:00:00.000Z"),
          endDate: new Date("2026-08-08T23:59:59.999Z"),
        }),
      ]),
      effective,
      NOW,
    );

    expect(out).toEqual([]);
  });

  it("suppresses when the absence covers only the window's LAST day", () => {
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-10T00:00:00.000Z"),
          endDate: new Date("2026-08-12T23:59:59.999Z"),
        }),
      ]),
      effective,
      NOW,
    );

    expect(out).toEqual([]);
  });

  it("still fires for an absence that ends the day BEFORE the window opens", () => {
    // Ends 2026-08-07T23:59:59.999Z — adjacent to the window, sharing no instant.
    // The developer was back at work for the whole window and still did not commit.
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-05T00:00:00.000Z"),
          endDate: new Date("2026-08-07T23:59:59.999Z"),
        }),
      ]),
      effective,
      NOW,
    );

    expect(out).toHaveLength(1);
  });

  it("still fires for an absence that starts AFTER the window closes", () => {
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-11T00:00:00.000Z"),
          endDate: new Date("2026-08-14T23:59:59.999Z"),
        }),
      ]),
      effective,
      NOW,
    );

    expect(out).toHaveLength(1);
  });

  it("does not let one member's absence suppress another member's anomaly", () => {
    const out = detectDeveloperInactive(
      inactiveSnapshot([makeAbsence({ teamMemberId: "someone-else" })]),
      effective,
      NOW,
    );

    expect(out).toHaveLength(1);
    expect(out[0].relatedTeamMemberId).toBe("member-1");
  });
});
