import { describe, expect, it } from "vitest";

import {
  buildBurndownSeries,
  TRACK_KEYS,
  type BurndownTicket,
  type BurndownTransition,
} from "@/lib/dashboard/burndown-series";
import { CATEGORY_KEYS } from "@/lib/dashboard/time-in-status";

/**
 * Unit suite for M1. The invariants that must hold at every point:
 * `Σ byTrack === total` (nothing silently dropped by the lossy track join) and
 * `Σ byCategory === ticket count`. Plus the two shapes that would otherwise
 * corrupt the series: a re-open (double-burn) and a null category (F4).
 */

const ZONE = "Europe/Warsaw";
const START = new Date("2026-08-17T08:00:00Z");
const END = new Date("2026-08-21T08:00:00Z");
const NOW = new Date("2026-08-21T12:00:00Z");

function ticket(
  ticketId: string,
  storyPoints: number | null,
  track: BurndownTicket["track"],
  currentCategory: BurndownTicket["currentCategory"] = "IN_PROGRESS",
): BurndownTicket {
  return { ticketId, storyPoints, currentCategory, track };
}

function done(ticketId: string, iso: string): BurndownTransition {
  return { ticketId, toCategory: "DONE", changedAt: new Date(iso) };
}

function build(
  tickets: BurndownTicket[],
  transitions: BurndownTransition[],
  overrides: Partial<Parameters<typeof buildBurndownSeries>[0]> = {},
) {
  return buildBurndownSeries({
    tickets,
    transitions,
    sprintStart: START,
    sprintEnd: END,
    committedSp: 10,
    timeZone: ZONE,
    now: NOW,
    ...overrides,
  });
}

describe("buildBurndownSeries — axis", () => {
  it("runs the day axis from sprint start to sprint end", () => {
    const s = build([], []);
    expect(s.days).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("clamps the axis to now when the sprint has not ended", () => {
    const s = build([], [], {
      sprintEnd: new Date("2026-08-31T08:00:00Z"),
      now: new Date("2026-08-19T10:00:00Z"),
    });
    expect(s.days).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"]);
  });

  it("returns an empty series when the sprint has no start date", () => {
    const s = build([ticket("T-1", 5, "BACKEND")], [], { sprintStart: null });
    expect(s.days).toEqual([]);
    expect(s.total).toEqual([]);
    // The distribution is still computed — it does not depend on the axis.
    expect(s.byCategory.IN_PROGRESS).toBe(1);
  });

  it("carries committedSp through untouched, including null", () => {
    expect(build([], []).committedSp).toBe(10);
    expect(build([], [], { committedSp: null }).committedSp).toBeNull();
  });
});

describe("buildBurndownSeries — baseline and burn", () => {
  it("opens at Σ SP over all sprint tickets, not at committedSp", () => {
    // committedSp is 10, but the sprint actually holds 13 SP (scope crept).
    const s = build(
      [ticket("T-1", 5, "BACKEND"), ticket("T-2", 8, "FRONTEND")],
      [],
    );
    expect(s.total[0].remainingSp).toBe(13);
    expect(s.committedSp).toBe(10);
  });

  it("burns a ticket's SP on the local day of its DONE transition", () => {
    const s = build(
      [ticket("T-1", 5, "BACKEND", "DONE"), ticket("T-2", 3, "BACKEND")],
      [done("T-1", "2026-08-19T10:00:00Z")],
    );
    expect(s.total.map((p) => p.remainingSp)).toEqual([8, 8, 3, 3, 3]);
  });

  it("burns on the team's local day, not the UTC one", () => {
    // 22:30 UTC on the 18th is 00:30 Warsaw on the 19th.
    const s = build(
      [ticket("T-1", 5, "BACKEND", "DONE")],
      [done("T-1", "2026-08-18T22:30:00Z")],
    );
    expect(s.total.map((p) => p.remainingSp)).toEqual([5, 5, 0, 0, 0]);
  });

  it("does not double-burn a ticket that was re-opened and re-closed", () => {
    const s = build(
      [ticket("T-1", 5, "BACKEND", "DONE")],
      [
        done("T-1", "2026-08-18T10:00:00Z"),
        // Re-opened, then closed again two days later.
        { ticketId: "T-1", toCategory: "IN_PROGRESS", changedAt: new Date("2026-08-19T10:00:00Z") },
        done("T-1", "2026-08-20T10:00:00Z"),
      ],
    );
    // Burns once, on the FIRST completion.
    expect(s.total.map((p) => p.remainingSp)).toEqual([5, 0, 0, 0, 0]);
  });

  it("folds a pre-axis completion into day 0 rather than opening too high", () => {
    const s = build(
      [ticket("T-1", 5, "BACKEND", "DONE"), ticket("T-2", 3, "BACKEND")],
      [done("T-1", "2026-08-10T10:00:00Z")],
    );
    expect(s.total[0].remainingSp).toBe(3);
  });

  it("treats a null-SP ticket as contributing 0", () => {
    const s = build([ticket("T-1", null, "BACKEND"), ticket("T-2", 5, "BACKEND")], []);
    expect(s.total[0].remainingSp).toBe(5);
  });

  it("ignores a DONE transition for a ticket outside the sprint", () => {
    const s = build([ticket("T-1", 5, "BACKEND")], [done("T-999", "2026-08-19T10:00:00Z")]);
    expect(s.total.every((p) => p.remainingSp === 5)).toBe(true);
  });

  it("drops a DONE transition with a null changedAt", () => {
    const s = build(
      [ticket("T-1", 5, "BACKEND", "DONE")],
      [{ ticketId: "T-1", toCategory: "DONE", changedAt: null }],
    );
    expect(s.total.every((p) => p.remainingSp === 5)).toBe(true);
  });

  it("never burns through an unmapped (null) status", () => {
    // The ticket really is finished, but its final status was never mapped, so
    // the transition is not DONE — the SP stays on the chart, and the gap shows
    // up in byCategory.UNKNOWN instead.
    const s = build(
      [ticket("T-1", 5, "BACKEND", null)],
      [{ ticketId: "T-1", toCategory: null, changedAt: new Date("2026-08-19T10:00:00Z") }],
    );
    expect(s.total.every((p) => p.remainingSp === 5)).toBe(true);
    expect(s.byCategory.UNKNOWN).toBe(1);
  });
});

describe("buildBurndownSeries — Σ byTrack === total", () => {
  it("holds at every point across mixed tracks", () => {
    const s = build(
      [
        ticket("T-1", 5, "BACKEND", "DONE"),
        ticket("T-2", 3, "FRONTEND", "DONE"),
        ticket("T-3", 8, "QA"),
        ticket("T-4", 2, "MOBILE"),
      ],
      [done("T-1", "2026-08-18T10:00:00Z"), done("T-2", "2026-08-20T10:00:00Z")],
    );

    s.days.forEach((day, i) => {
      const summed = TRACK_KEYS.reduce((acc, k) => acc + s.byTrack[k][i].remainingSp, 0);
      expect(summed).toBe(s.total[i].remainingSp);
      expect(s.byTrack.BACKEND[i].day).toBe(day);
    });
    expect(s.total.map((p) => p.remainingSp)).toEqual([18, 13, 13, 10, 10]);
  });

  it("routes unattributable SP to UNKNOWN rather than dropping it", () => {
    const s = build([ticket("T-1", 5, "BACKEND"), ticket("T-2", 8, null)], []);

    expect(s.byTrack.UNKNOWN[0].remainingSp).toBe(8);
    expect(s.total[0].remainingSp).toBe(13);
    s.days.forEach((_, i) => {
      const summed = TRACK_KEYS.reduce((acc, k) => acc + s.byTrack[k][i].remainingSp, 0);
      expect(summed).toBe(s.total[i].remainingSp);
    });
  });

  it("always exposes every track key, even when unused", () => {
    const s = build([ticket("T-1", 5, "BACKEND")], []);
    for (const k of TRACK_KEYS) {
      expect(s.byTrack[k]).toHaveLength(s.days.length);
    }
  });
});

describe("buildBurndownSeries — byCategory", () => {
  it("counts tickets per current category and sums to the ticket count", () => {
    const tickets = [
      ticket("T-1", 5, "BACKEND", "TODO"),
      ticket("T-2", 3, "FRONTEND", "IN_PROGRESS"),
      ticket("T-3", 8, "QA", "IN_PROGRESS"),
      ticket("T-4", 2, "MOBILE", "DONE"),
      ticket("T-5", 1, null, null),
    ];
    const s = build(tickets, []);

    expect(s.byCategory.TODO).toBe(1);
    expect(s.byCategory.IN_PROGRESS).toBe(2);
    expect(s.byCategory.DONE).toBe(1);
    expect(s.byCategory.UNKNOWN).toBe(1);
    expect(s.byCategory.CODE_REVIEW).toBe(0);

    const summed = CATEGORY_KEYS.reduce((acc, k) => acc + s.byCategory[k], 0);
    expect(summed).toBe(tickets.length);
  });

  it("always exposes every category key", () => {
    const s = build([], []);
    expect(Object.keys(s.byCategory).sort()).toEqual([...CATEGORY_KEYS].sort());
  });
});
