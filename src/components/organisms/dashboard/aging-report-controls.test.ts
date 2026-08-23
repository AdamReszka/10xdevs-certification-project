import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  formatDuration,
  hasUnknownTime,
  nextSortState,
  sortAgingRows,
  type AgingRow,
  type AgingSortKey,
} from "@/components/organisms/dashboard/aging-report-controls";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/dashboard/time-in-status";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buckets(partial: Partial<Record<CategoryKey, number>>): Record<CategoryKey, number> {
  return {
    ...(Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) as Record<CategoryKey, number>),
    ...partial,
  };
}

function row(over: Partial<AgingRow> & { jiraKey: string }): AgingRow {
  return {
    ticketId: `id-${over.jiraKey}`,
    summary: `Summary ${over.jiraKey}`,
    storyPoints: 3,
    currentCategory: "IN_PROGRESS",
    assigneeName: "Ada",
    sourceUrl: null,
    sinceLastMoveMs: HOUR,
    byCategory: buckets({}),
    ...over,
  };
}

const ROWS: AgingRow[] = [
  row({ jiraKey: "SF-2", sinceLastMoveMs: 3 * DAY, storyPoints: 8, byCategory: buckets({ TODO: 2 * HOUR }) }),
  row({ jiraKey: "SF-1", sinceLastMoveMs: 1 * DAY, storyPoints: 1, byCategory: buckets({ TODO: 9 * HOUR }) }),
  row({ jiraKey: "SF-3", sinceLastMoveMs: 5 * DAY, storyPoints: 3, byCategory: buckets({ TODO: 5 * HOUR }) }),
];

describe("sortAgingRows", () => {
  it("defaults to the most-stalled ticket first", () => {
    const sorted = sortAgingRows(ROWS, DEFAULT_SORT.key, DEFAULT_SORT.direction);
    expect(sorted.map((r) => r.jiraKey)).toEqual(["SF-3", "SF-2", "SF-1"]);
  });

  it("does not mutate the input array", () => {
    const before = ROWS.map((r) => r.jiraKey);
    sortAgingRows(ROWS, "sinceLastMove", "asc");
    expect(ROWS.map((r) => r.jiraKey)).toEqual(before);
  });

  it("sorts every column in both directions", () => {
    const cases: { key: AgingSortKey; asc: string[] }[] = [
      { key: "sinceLastMove", asc: ["SF-1", "SF-2", "SF-3"] },
      { key: "jiraKey", asc: ["SF-1", "SF-2", "SF-3"] },
      { key: "summary", asc: ["SF-1", "SF-2", "SF-3"] },
      { key: "storyPoints", asc: ["SF-1", "SF-3", "SF-2"] },
      { key: "category:TODO", asc: ["SF-2", "SF-3", "SF-1"] },
    ];

    for (const { key, asc } of cases) {
      expect(sortAgingRows(ROWS, key, "asc").map((r) => r.jiraKey), key).toEqual(asc);
      expect(sortAgingRows(ROWS, key, "desc").map((r) => r.jiraKey), key).toEqual(
        [...asc].reverse(),
      );
    }
  });

  it("sorts by current status", () => {
    const rows = [
      row({ jiraKey: "A", currentCategory: "TESTING" }),
      row({ jiraKey: "B", currentCategory: "CODE_REVIEW" }),
    ];
    expect(sortAgingRows(rows, "currentCategory", "asc").map((r) => r.jiraKey)).toEqual([
      "B",
      "A",
    ]);
  });

  it("sorts every category column independently", () => {
    const rows = [
      row({ jiraKey: "A", byCategory: buckets({ CODE_REVIEW: 1 * HOUR, TESTING: 9 * HOUR }) }),
      row({ jiraKey: "B", byCategory: buckets({ CODE_REVIEW: 5 * HOUR, TESTING: 2 * HOUR }) }),
    ];
    expect(sortAgingRows(rows, "category:CODE_REVIEW", "desc").map((r) => r.jiraKey)).toEqual(
      ["B", "A"],
    );
    expect(sortAgingRows(rows, "category:TESTING", "desc").map((r) => r.jiraKey)).toEqual([
      "A",
      "B",
    ]);
  });

  it("keeps nulls last in BOTH directions", () => {
    const rows = [
      row({ jiraKey: "A", storyPoints: 5 }),
      row({ jiraKey: "B", storyPoints: null }),
      row({ jiraKey: "C", storyPoints: 1 }),
    ];
    expect(sortAgingRows(rows, "storyPoints", "asc").map((r) => r.jiraKey)).toEqual([
      "C",
      "A",
      "B",
    ]);
    expect(sortAgingRows(rows, "storyPoints", "desc").map((r) => r.jiraKey)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("is stable for equal values", () => {
    const rows = [
      row({ jiraKey: "first", sinceLastMoveMs: HOUR }),
      row({ jiraKey: "second", sinceLastMoveMs: HOUR }),
      row({ jiraKey: "third", sinceLastMoveMs: HOUR }),
    ];
    expect(sortAgingRows(rows, "sinceLastMove", "desc").map((r) => r.jiraKey)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("nextSortState", () => {
  it("flips direction when the active column is clicked again", () => {
    expect(nextSortState({ key: "sinceLastMove", direction: "desc" }, "sinceLastMove")).toEqual({
      key: "sinceLastMove",
      direction: "asc",
    });
    expect(nextSortState({ key: "sinceLastMove", direction: "asc" }, "sinceLastMove")).toEqual({
      key: "sinceLastMove",
      direction: "desc",
    });
  });

  it("starts numeric columns descending and text columns ascending", () => {
    expect(nextSortState(DEFAULT_SORT, "storyPoints").direction).toBe("desc");
    expect(nextSortState(DEFAULT_SORT, "category:TESTING").direction).toBe("desc");
    expect(nextSortState(DEFAULT_SORT, "jiraKey").direction).toBe("asc");
    expect(nextSortState(DEFAULT_SORT, "summary").direction).toBe("asc");
  });
});

describe("hasUnknownTime", () => {
  it("is false for a well-mapped project so the report keeps FR-017's five columns", () => {
    expect(hasUnknownTime(ROWS)).toBe(false);
  });

  it("is true as soon as one ticket accrued time in an unmapped status", () => {
    expect(hasUnknownTime([...ROWS, row({ jiraKey: "SF-9", byCategory: buckets({ UNKNOWN: 1 }) })])).toBe(
      true,
    );
  });
});

describe("formatDuration", () => {
  it("shows minutes below an hour", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("shows whole hours below a day", () => {
    expect(formatDuration(4 * HOUR)).toBe("4h");
    expect(formatDuration(23 * HOUR + 59 * 60_000)).toBe("23h");
  });

  it("shows days and remainder hours", () => {
    expect(formatDuration(2 * DAY + 4 * HOUR)).toBe("2d 4h");
    expect(formatDuration(3 * DAY)).toBe("3d");
  });

  it("renders a dash rather than 0 for zero or invalid input", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});
