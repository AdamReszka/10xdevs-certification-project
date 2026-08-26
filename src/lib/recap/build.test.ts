import { describe, expect, it } from "vitest";

import { foldTeamActivity } from "@/lib/recap/build";

/**
 * The Dev × Day grid → one team row (S-11, impl-review F3).
 *
 * Tested at THIS end of the pipe on purpose. `render.test.ts` covers how null
 * churn is *rendered*, which proves nothing about the fold: if this function
 * collapsed a null into 0, the renderer would faithfully print `+0` and the
 * whole suite would stay green. The email would then claim the team wrote zero
 * lines on a day the churn was simply never measured — the exact misreading
 * `activity-grid.ts:18-24` exists to prevent.
 */

type Cell = {
  commits: number;
  additions: number | null;
  deletions: number | null;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
};

function cell(over: Partial<Cell> = {}): Cell {
  return {
    commits: 0,
    additions: 0,
    deletions: 0,
    prsOpened: 0,
    prsMerged: 0,
    reviews: 0,
    ...over,
  };
}

function grid(days: string[], rows: Array<Record<string, Cell>>) {
  return { days, rows: rows.map((cells) => ({ cells })) };
}

describe("foldTeamActivity — null churn is not zero", () => {
  it("keeps the sum null when EVERY contributing cell is null", () => {
    // An over-cap commit keeps NULL churn permanently. Reporting 0 would claim
    // we measured an empty commit.
    const out = foldTeamActivity(
      grid(["d1"], [{ d1: cell({ commits: 3, additions: null, deletions: null }) }]),
    );

    expect(out.additions).toBeNull();
    expect(out.deletions).toBeNull();
    // The countable fields are unaffected by the null churn.
    expect(out.commits).toBe(3);
  });

  it("does NOT null the sum when only some cells are null", () => {
    // One unmeasured commit must not erase the churn we do know about.
    const out = foldTeamActivity(
      grid(
        ["d1", "d2"],
        [{ d1: cell({ additions: 100, deletions: 20 }), d2: cell({ additions: null, deletions: null }) }],
      ),
    );

    expect(out.additions).toBe(100);
    expect(out.deletions).toBe(20);
  });

  it("preserves a REAL zero as 0", () => {
    // A measured commit that changed nothing is 0, and must not degrade to null.
    const out = foldTeamActivity(grid(["d1"], [{ d1: cell({ commits: 1 }) }]));

    expect(out.additions).toBe(0);
    expect(out.deletions).toBe(0);
  });

  it("treats additions and deletions independently", () => {
    const out = foldTeamActivity(
      grid(["d1"], [{ d1: cell({ additions: 42, deletions: null }) }]),
    );

    expect(out.additions).toBe(42);
    expect(out.deletions).toBeNull();
  });
});

describe("foldTeamActivity — summation", () => {
  it("sums across BOTH rows and days", () => {
    const out = foldTeamActivity(
      grid(
        ["d1", "d2"],
        [
          {
            d1: cell({ commits: 2, additions: 10, deletions: 1, prsOpened: 1, reviews: 1 }),
            d2: cell({ commits: 3, additions: 20, deletions: 2, prsMerged: 1 }),
          },
          {
            d1: cell({ commits: 1, additions: 5, deletions: 3, reviews: 2 }),
            d2: cell({ commits: 4, additions: 1, deletions: 4, prsOpened: 2, prsMerged: 1 }),
          },
        ],
      ),
    );

    expect(out).toEqual({
      commits: 10,
      additions: 36,
      deletions: 10,
      prsOpened: 3,
      prsMerged: 2,
      reviews: 3,
    });
  });

  it("skips a day the row has no cell for", () => {
    // The grid guarantees every day is present on every row; a mismatch is a
    // bug elsewhere and must not throw here or count as zero commits twice.
    const out = foldTeamActivity(grid(["d1", "missing"], [{ d1: cell({ commits: 7 }) }]));

    expect(out.commits).toBe(7);
  });

  it("ignores a cell for a day outside the axis", () => {
    // Only days ON the axis are folded — the axis is what defines the window.
    const out = foldTeamActivity(
      grid(["d1"], [{ d1: cell({ commits: 1 }), offAxis: cell({ commits: 99 }) }]),
    );

    expect(out.commits).toBe(1);
  });

  it("returns all-zero, null-churn totals for an empty grid", () => {
    // Distinguishable from "a day with measured zero activity": the churn is
    // null because nothing contributed a measurement at all.
    expect(foldTeamActivity(grid([], []))).toEqual({
      commits: 0,
      additions: null,
      deletions: null,
      prsOpened: 0,
      prsMerged: 0,
      reviews: 0,
    });
  });

  it("carries no per-developer breakdown out of the fold", () => {
    // The PRD Guardrail forbids per-developer performance framing, and this
    // ships in an email where such a table would read as exactly that. The
    // shape is team-only so a later renderer cannot re-introduce one.
    const out = foldTeamActivity(grid(["d1"], [{ d1: cell({ commits: 1 }) }, { d1: cell({ commits: 2 }) }]));

    expect(Object.keys(out).sort()).toEqual([
      "additions",
      "commits",
      "deletions",
      "prsMerged",
      "prsOpened",
      "reviews",
    ]);
  });
});
