import { describe, expect, it } from "vitest";

import { detectTicketNoCommitLink } from "@/lib/anomaly/rules/ticket-no-commit-link";
import {
  NOW,
  effective,
  makeCommit,
  makeSnapshot,
  makeTicket,
} from "@/lib/anomaly/test-support";

/**
 * THE CLOCK THESE SEEDS ARE READ AGAINST (S-28). Both of this rule's questions
 * are asked in WORKING hours: 08:00–16:00 UTC, Mon–Fri, no team-wide days off
 * unless a test passes its own. `noCommitDays` defaults to 2, so the budget is 16
 * working hours and `windowStart` is the instant 16 working hours back.
 *
 * `NOW` is **Monday** 2026-08-10T12:00Z, so the current Monday contributes 4
 * working hours (08:00 → 12:00) and each earlier weekday contributes 8:
 *
 *   Wed 08-05 12:00 → 24 working hours (3 working days), window opens Thu 12:00
 *   Fri 08-07 12:00 →  8 working hours (1 working day)  — too fresh
 *   Mon 08-10 09:00 →  3 working hours                  — too fresh
 *
 * The weekday each seed lands on is named in its comment because that, not the
 * calendar distance, is what decides the outcome.
 */
describe("detectTicketNoCommitLink", () => {
  it("fires for an In-Progress ticket 3 working days old with no commit referencing it", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          jiraKey: "SF-7",
          currentCategory: "IN_PROGRESS",
          // Wednesday noon → 24 working hours by Monday noon.
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"),
        }),
      ],
      commits: [makeCommit({ message: "SF-99 unrelated work" })],
    });
    const out = detectTicketNoCommitLink(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "TICKET_NO_COMMIT_LINK",
      severity: "MEDIUM",
      dedupKey: "TICKET_NO_COMMIT_LINK:ticket:SF-7",
      relatedTeamMemberId: null,
    });
    expect(out[0].description).toContain("SF-7");
    // The age is reported in the unit it was measured in.
    expect(out[0].description).toContain("3 working days");
    expect(out[0].suggestedAction).toContain("SF-7");
    expect(out[0].context).toMatchObject({
      jiraKey: "SF-7",
      daysInProgress: 3,
      noCommitDays: 2,
    });
    expect(out[0].magnitude).toBeCloseTo(3 / 4, 5); // 3 working days / (2*2)
  });

  it("does not fire when a recent commit references the ticket key", () => {
    // Seeded past the freshness gate on purpose (Wednesday, 24 working hours), so
    // the empty result is the SUPPRESSION branch and not an early exit.
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          jiraKey: "SF-7",
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"),
        }),
      ],
      commits: [
        makeCommit({
          message: "sf-7 wire it up",
          authoredAt: new Date("2026-08-10T09:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires when the only referencing commit predates the window", () => {
    // Thursday 08:00 is four working hours before `windowStart` (Thursday noon):
    // the ticket has a code trace, but none inside the window the rule asks about.
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          jiraKey: "SF-7",
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-05T12:00:00.000Z"),
        }),
      ],
      commits: [
        makeCommit({
          message: "SF-7 first pass",
          authoredAt: new Date("2026-08-06T08:00:00.000Z"),
        }),
      ],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(1);
  });

  it("does not fire for a Friday ticket with no commits at all — the weekend is not work", () => {
    // THE DEFECT S-28 CLOSED, and the freshness branch on its own: three calendar
    // days but only 8 working hours, so the ticket is too fresh to expect commits
    // and the commit scan is never reached.
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-07T12:00:00.000Z"), // Friday noon
        }),
      ],
      commits: [],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });

  it("does not fire for a ticket In Progress less than the window", () => {
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "IN_PROGRESS",
          // This morning → 3 working hours, well inside the 16.
          lastStatusChangeAt: new Date("2026-08-10T09:00:00.000Z"),
        }),
      ],
      commits: [],
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });

  it("fires on the gate exactly — 16 working hours is not too fresh", () => {
    // Thursday noon → 4 (Thu) + 8 (Fri) + 4 (Mon) = exactly the 16-working-hour
    // window, and the gate is `<`, so the ticket is old enough.
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-06T12:00:00.000Z"),
        }),
      ],
      commits: [],
    });
    const out = detectTicketNoCommitLink(snap, effective, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].context).toMatchObject({ daysInProgress: 2 });
  });

  it("holds a ticket below the gate when a company day off eats the working day", () => {
    // Thursday noon is 16 working hours back only while Friday is worked. With
    // Friday off it is 8, so the same seed that fires above stays silent here.
    const snap = makeSnapshot({
      tickets: [
        makeTicket({
          currentCategory: "IN_PROGRESS",
          lastStatusChangeAt: new Date("2026-08-06T12:00:00.000Z"),
        }),
      ],
      commits: [],
      nonWorkingDays: new Set(["2026-08-07"]),
    });
    expect(detectTicketNoCommitLink(snap, effective, NOW)).toHaveLength(0);
  });
});
