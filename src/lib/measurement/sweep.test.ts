import { describe, expect, it } from "vitest";

import { shouldFinalize, shouldRecompute } from "@/lib/measurement/sweep";

/**
 * S-23 Phase 4 — the two decisions the measurement sweep makes before it writes
 * anything. Pure and clock-injected, so the "sprint ended three cycles ago" case
 * is a parameter rather than a wait.
 *
 * WHY `committed_frozen_at` GATES FINALIZATION (Phase 2/3 impl-review F1):
 * Phase 3 freezes `sprint.committed_sp` only on a FULL Jira pull, because the
 * sum runs over the whole ticket table while `added_after_sprint_start` is
 * rewritten only for the issues a cycle actually pulled. A sprint can therefore
 * sit legitimately unfrozen for a while. Stamping `finalized_at` on such a row
 * would freeze a commitment that was still moving, and the delivered figure
 * would then be normalised against a denominator nobody ever committed to.
 * FR-023's honest "no data" is the correct outcome there, not a record with a
 * plausible-looking number in it.
 */

const FROZEN = new Date("2026-08-20T09:00:00.000Z");
const NOW = new Date("2026-09-01T09:00:00.000Z");

function candidate(over: Partial<Parameters<typeof shouldFinalize>[0]> = {}) {
  return {
    state: "ACTIVE" as const,
    endDate: new Date("2026-08-31T08:00:00.000Z"),
    committedFrozenAt: FROZEN,
    ...over,
  };
}

describe("shouldFinalize", () => {
  it("finalizes a frozen sprint Jira reports as CLOSED", () => {
    expect(shouldFinalize(candidate({ state: "CLOSED" }), NOW)).toBe(true);
  });

  it("finalizes a frozen sprint whose end date has passed even while Jira still calls it ACTIVE", () => {
    // The rollover Jira has not caught up with yet. Waiting for the state flip
    // would leave the record open to being rewritten by post-close cycles.
    expect(shouldFinalize(candidate(), NOW)).toBe(true);
  });

  it("refuses to finalize a CLOSED sprint whose commitment was never frozen", () => {
    expect(
      shouldFinalize(candidate({ state: "CLOSED", committedFrozenAt: null }), NOW),
    ).toBe(false);
  });

  it("leaves a running sprint open", () => {
    const stillRunning = candidate({ endDate: new Date("2026-09-14T08:00:00.000Z") });
    expect(shouldFinalize(stillRunning, NOW)).toBe(false);
  });

  it("leaves an undated ACTIVE sprint open rather than guessing it is over", () => {
    expect(shouldFinalize(candidate({ endDate: null }), NOW)).toBe(false);
  });
});

describe("shouldRecompute", () => {
  it("computes when there is no record yet", () => {
    expect(shouldRecompute(null)).toBe(true);
  });

  it("keeps refreshing an open record", () => {
    expect(shouldRecompute({ finalizedAt: null })).toBe(true);
  });

  it("never touches a finalized record again", () => {
    expect(shouldRecompute({ finalizedAt: NOW })).toBe(false);
  });
});
