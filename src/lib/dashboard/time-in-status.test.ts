import { describe, expect, it } from "vitest";

import {
  CATEGORY_KEYS,
  foldTimeInStatus,
  type StatusTransition,
} from "@/lib/dashboard/time-in-status";

/**
 * Unit suite for M3. The cases that matter are the ones the reader can't fix:
 * an empty history, a re-open sequence, and the two null shapes (F4) that the
 * nullable schema makes reachable for any owner with an unmapped Jira status.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-20T12:00:00Z");

function at(iso: string): Date {
  return new Date(iso);
}

describe("foldTimeInStatus", () => {
  it("always returns every category key, zeroed when unused", () => {
    const result = foldTimeInStatus([], {
      currentCategory: "TODO",
      lastStatusChangeAt: NOW,
      now: NOW,
    });

    expect(Object.keys(result.byCategory).sort()).toEqual([...CATEGORY_KEYS].sort());
    expect(result.byCategory.CODE_REVIEW).toBe(0);
    expect(result.byCategory.DONE).toBe(0);
  });

  it("accrues the whole open interval to the current category when history is empty", () => {
    const result = foldTimeInStatus([], {
      currentCategory: "IN_PROGRESS",
      lastStatusChangeAt: at("2026-08-20T08:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.IN_PROGRESS).toBe(4 * HOUR);
    expect(result.sinceLastMoveMs).toBe(4 * HOUR);
  });

  it("reports zero age when history is empty and lastStatusChangeAt is null", () => {
    const result = foldTimeInStatus([], {
      currentCategory: "TODO",
      lastStatusChangeAt: null,
      now: NOW,
    });

    expect(result.sinceLastMoveMs).toBe(0);
    expect(result.byCategory.TODO).toBe(0);
  });

  it("accrues a single transition's open interval to the current category", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T09:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "IN_PROGRESS",
      lastStatusChangeAt: at("2026-08-20T09:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.IN_PROGRESS).toBe(3 * HOUR);
    expect(result.sinceLastMoveMs).toBe(3 * HOUR);
  });

  it("splits closed intervals by the category entered at each step", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "TODO", changedAt: at("2026-08-20T06:00:00Z") },
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T08:00:00Z") },
      { toCategory: "CODE_REVIEW", changedAt: at("2026-08-20T11:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "CODE_REVIEW",
      lastStatusChangeAt: at("2026-08-20T11:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.TODO).toBe(2 * HOUR);
    expect(result.byCategory.IN_PROGRESS).toBe(3 * HOUR);
    expect(result.byCategory.CODE_REVIEW).toBe(1 * HOUR); // the open interval
    expect(result.sinceLastMoveMs).toBe(1 * HOUR);
  });

  it("sums both visits when a ticket is re-opened into a category it already left", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T04:00:00Z") },
      { toCategory: "CODE_REVIEW", changedAt: at("2026-08-20T06:00:00Z") },
      // Reviewer bounces it back.
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T07:00:00Z") },
      { toCategory: "CODE_REVIEW", changedAt: at("2026-08-20T10:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "CODE_REVIEW",
      lastStatusChangeAt: at("2026-08-20T10:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.IN_PROGRESS).toBe(2 * HOUR + 3 * HOUR);
    expect(result.byCategory.CODE_REVIEW).toBe(1 * HOUR + 2 * HOUR);
    expect(result.sinceLastMoveMs).toBe(2 * HOUR);
  });

  it("orders transitions defensively rather than trusting the caller", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "CODE_REVIEW", changedAt: at("2026-08-20T11:00:00Z") },
      { toCategory: "TODO", changedAt: at("2026-08-20T06:00:00Z") },
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T08:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "CODE_REVIEW",
      lastStatusChangeAt: at("2026-08-20T11:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.TODO).toBe(2 * HOUR);
    expect(result.byCategory.IN_PROGRESS).toBe(3 * HOUR);
  });

  // --- F4: the two null shapes the nullable schema makes reachable -----------

  it("drops a transition with a null changedAt", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "TODO", changedAt: at("2026-08-20T06:00:00Z") },
      // Unorderable — must not bound an interval.
      { toCategory: "TESTING", changedAt: null },
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T08:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "IN_PROGRESS",
      lastStatusChangeAt: at("2026-08-20T08:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.TODO).toBe(2 * HOUR);
    expect(result.byCategory.TESTING).toBe(0);
    expect(result.byCategory.IN_PROGRESS).toBe(4 * HOUR);
  });

  it("accrues a null-category transition to UNKNOWN, never to a null key", () => {
    const transitions: StatusTransition[] = [
      // An FR-005-unmapped Jira status.
      { toCategory: null, changedAt: at("2026-08-20T06:00:00Z") },
      { toCategory: "IN_PROGRESS", changedAt: at("2026-08-20T09:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "IN_PROGRESS",
      lastStatusChangeAt: at("2026-08-20T09:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.UNKNOWN).toBe(3 * HOUR);
    expect(Object.keys(result.byCategory)).not.toContain("null");
    expect(result.byCategory.IN_PROGRESS).toBe(3 * HOUR);
  });

  it("accrues the open interval to UNKNOWN when currentCategory is null", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "TODO", changedAt: at("2026-08-20T09:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: null,
      lastStatusChangeAt: at("2026-08-20T09:00:00Z"),
      now: NOW,
    });

    expect(result.byCategory.UNKNOWN).toBe(3 * HOUR);
    expect(result.byCategory.TODO).toBe(0);
  });

  it("never returns a negative bucket when a transition post-dates now", () => {
    const transitions: StatusTransition[] = [
      { toCategory: "TODO", changedAt: at("2026-08-21T00:00:00Z") },
    ];

    const result = foldTimeInStatus(transitions, {
      currentCategory: "TODO",
      lastStatusChangeAt: at("2026-08-21T00:00:00Z"),
      now: NOW,
    });

    expect(result.sinceLastMoveMs).toBe(0);
    expect(result.byCategory.TODO).toBe(0);
  });
});
