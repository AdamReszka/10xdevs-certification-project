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

/**
 * THE WINDOW THESE SEEDS ARE READ AGAINST (S-28). `noCommitDays` defaults to 2,
 * and two WORKING days are 16 working hours: 08:00–16:00 UTC, Mon–Fri, no
 * team-wide days off unless a test passes its own. `NOW` is **Monday**
 * 2026-08-10T12:00Z, so walking 16 working hours back spends 4 on Monday morning
 * (08:00 → 12:00), skips the weekend entirely, spends 8 on Friday 08-07 and lands
 * mid-morning on **Thursday 2026-08-06T12:00Z**.
 *
 *   window = Thu 2026-08-06T12:00Z → Mon 2026-08-10T12:00Z
 *
 * The weekday each seed lands on is named in its comment because that, not the
 * calendar distance, is what decides the outcome.
 */
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
      // `/team/absences`, not null and not a link to this person's commits: the
      // lead's real first question is "are they away?", and that is the screen
      // where they can answer it. This line used to pin the null, so the suite
      // was holding in place a state nobody had chosen.
      sourceUrl: "/team/absences",
    });
    expect(out[0].description).toContain("Alex Dev");
    // The unit is stated, because the window no longer counts calendar days.
    expect(out[0].description).toContain("2 working days");
    expect(out[0].suggestedAction).toContain("Alex Dev");
    expect(out[0].context).toMatchObject({
      teamMemberId: "member-1",
      githubUsername: "alexdev",
      noCommitDays: 2,
    });
  });

  it("does not fire when a commit sits exactly on the window boundary", () => {
    // Thursday noon IS `windowStart`, and the scan is `>=` → inside → active.
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-06T12:00:00.000Z") })],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires when the last commit predates the window's Thursday opening", () => {
    // Thursday 08:00 — four working hours before `windowStart`, so the member has
    // been silent for the whole of the window the rule asks about.
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-06T08:00:00.000Z") })],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(1);
  });

  it("does not fire for a Friday commit, three calendar days before Monday noon", () => {
    // THE DEFECT S-28 CLOSED. On the wall clock the window opened Saturday noon
    // and this commit sat outside it, so the Monday morning-sync inbox accused a
    // developer who had committed on their last working day. Two working days
    // back from Monday noon is Thursday noon; Friday morning is inside it.
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-07T09:00:00.000Z") })],
    });
    expect(detectDeveloperInactive(snap, effective, NOW)).toHaveLength(0);
  });

  it("stretches the window back over a team-wide day off", () => {
    // Friday 08-07 is a company day off, so its 8 hours cannot be spent: the walk
    // takes 4 on Monday, 8 on Thursday and the last 4 on Wednesday, opening the
    // window at Wed 12:00. This Thursday-morning commit is inside it — the same
    // commit fires without the day off (the test above), which is what makes this
    // an assertion about the calendar and not about the timestamp.
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [makeTicket({ currentCategory: "IN_PROGRESS" })],
      commits: [makeCommit({ authoredAt: new Date("2026-08-06T08:00:00.000Z") })],
      nonWorkingDays: new Set(["2026-08-07"]),
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
 * own evaluation window — the only window in which the missing commits would have
 * happened. It is a SEPARATE mechanism from the clock (S-28): an individual's
 * absence does not shorten or pause the window, it removes this member from the
 * question for as long as it overlaps it.
 *
 * Every expectation below is hand-derived from the fixture clock: NOW is Monday
 * 2026-08-10T12:00Z and `noCommitDays` defaults to 2 WORKING days = 16 working
 * hours, so the window is Thu 2026-08-06T12:00Z → Mon 2026-08-10T12:00Z.
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
    // 2026-08-04 → 2026-08-06 (inclusive) ends at 23:59:59.999Z on Thursday,
    // which is inside the window that opens at 12:00Z that day.
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-04T00:00:00.000Z"),
          endDate: new Date("2026-08-06T23:59:59.999Z"),
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
    // Ends Wednesday 2026-08-05T23:59:59.999Z — the day before the window's
    // Thursday, sharing no instant with it. The developer was back at work for
    // the whole window and still did not commit.
    const out = detectDeveloperInactive(
      inactiveSnapshot([
        makeAbsence({
          startDate: new Date("2026-08-03T00:00:00.000Z"),
          endDate: new Date("2026-08-05T23:59:59.999Z"),
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
