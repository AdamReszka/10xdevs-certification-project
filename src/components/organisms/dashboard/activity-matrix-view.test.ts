import { describe, expect, it } from "vitest";

import {
  cellIntensity,
  describeMetricValue,
  formatDayHeader,
  formatMetricValue,
  metricMax,
  metricValue,
} from "@/components/organisms/dashboard/activity-matrix-view";
import type { ActivityCell, ActivityGrid } from "@/lib/dashboard/activity-grid";

function cell(over: Partial<ActivityCell> = {}): ActivityCell {
  return {
    commits: 0,
    additions: null,
    deletions: null,
    prsOpened: 0,
    prsMerged: 0,
    reviews: 0,
    ...over,
  };
}

const GRID: ActivityGrid = {
  days: ["2026-08-18", "2026-08-19"],
  rows: [
    {
      memberId: "m-1",
      memberName: "Ada",
      githubUsername: "ada",
      cells: {
        "2026-08-18": cell({ commits: 3, additions: 100, deletions: 20 }),
        "2026-08-19": cell({ commits: 1, additions: 10, deletions: 5, reviews: 2 }),
      },
    },
    {
      memberId: "m-2",
      memberName: "Bo",
      githubUsername: "bo",
      cells: {
        // An over-cap commit: churn was never measured.
        "2026-08-18": cell({ commits: 2, prsOpened: 1, prsMerged: 1 }),
        "2026-08-19": cell(),
      },
    },
  ],
};

describe("metricValue", () => {
  it("reads commits, PRs, and reviews directly", () => {
    const c = cell({ commits: 4, prsOpened: 2, prsMerged: 1, reviews: 3 });
    expect(metricValue(c, "commits")).toBe(4);
    expect(metricValue(c, "prs")).toBe(3);
    expect(metricValue(c, "reviews")).toBe(3);
  });

  it("sums additions and deletions for lines", () => {
    expect(metricValue(cell({ commits: 1, additions: 100, deletions: 20 }), "lines")).toBe(120);
  });

  it("returns null for lines when the cell's commits all had unmeasured churn", () => {
    expect(metricValue(cell({ commits: 2 }), "lines")).toBeNull();
  });

  it("returns 0, not null, for a day with no commits at all", () => {
    // Nothing to measure, and we know the answer — reporting "not measured"
    // across every quiet day would bury the genuinely unmeasured cells.
    expect(metricValue(cell({ commits: 0 }), "lines")).toBe(0);
  });

  it("treats a half-measured cell as measured", () => {
    expect(metricValue(cell({ commits: 1, additions: 7, deletions: null }), "lines")).toBe(7);
  });

  it("returns 0, not null, for a commit that genuinely changed nothing", () => {
    expect(metricValue(cell({ commits: 1, additions: 0, deletions: 0 }), "lines")).toBe(0);
  });
});

describe("metricMax", () => {
  it("finds the largest value across the whole grid", () => {
    expect(metricMax(GRID, "commits")).toBe(3);
    expect(metricMax(GRID, "lines")).toBe(120);
    expect(metricMax(GRID, "prs")).toBe(2);
    expect(metricMax(GRID, "reviews")).toBe(2);
  });

  it("skips unmeasured cells rather than counting them as 0", () => {
    const grid: ActivityGrid = {
      days: ["2026-08-18"],
      rows: [
        {
          memberId: "m-1",
          memberName: "Ada",
          githubUsername: "ada",
          cells: { "2026-08-18": cell({ commits: 5 }) },
        },
      ],
    };
    expect(metricMax(grid, "lines")).toBe(0);
  });

  it("returns 0 for an empty grid", () => {
    expect(metricMax({ days: [], rows: [] }, "commits")).toBe(0);
  });
});

describe("cellIntensity", () => {
  it("scales linearly against the grid max", () => {
    expect(cellIntensity(120, 120)).toBe(1);
    expect(cellIntensity(60, 120)).toBe(0.5);
  });

  it("leaves zero, null, and a zero max untinted", () => {
    expect(cellIntensity(0, 120)).toBe(0);
    expect(cellIntensity(null, 120)).toBe(0);
    expect(cellIntensity(5, 0)).toBe(0);
  });

  it("clamps a value above the max", () => {
    expect(cellIntensity(200, 120)).toBe(1);
  });
});

describe("formatMetricValue", () => {
  it("renders an em dash for unmeasured, never 0", () => {
    expect(formatMetricValue(null)).toBe("—");
  });

  it("renders a true zero as blank so the grid reads as a heat map", () => {
    expect(formatMetricValue(0)).toBe("");
  });

  it("renders the number otherwise", () => {
    expect(formatMetricValue(42)).toBe("42");
  });
});

describe("describeMetricValue", () => {
  it("distinguishes unmeasured from zero for screen readers", () => {
    expect(describeMetricValue(null, "lines")).toBe("lines: not measured");
    expect(describeMetricValue(0, "lines")).toBe("lines: 0");
    expect(describeMetricValue(12, "commits")).toBe("commits: 12");
  });
});

describe("formatDayHeader", () => {
  it("drops the year, which is constant across a sprint", () => {
    expect(formatDayHeader("2026-08-19")).toBe("08-19");
  });
});
