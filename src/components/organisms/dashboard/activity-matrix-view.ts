import type { ActivityCell, ActivityGrid } from "@/lib/dashboard/activity-grid";

/**
 * Pure metric-selection, scaling, and formatting for the Team Activity Matrix
 * (S-10, FR-017). Extracted from the organism so the null-churn rule and the
 * intensity ramp are unit-testable without React.
 */

export type MatrixMetric = "commits" | "lines" | "prs" | "reviews";

export const MATRIX_METRICS: { key: MatrixMetric; label: string }[] = [
  { key: "commits", label: "Commits" },
  { key: "lines", label: "Lines" },
  { key: "prs", label: "PRs" },
  { key: "reviews", label: "Reviews" },
];

/**
 * The metric's value for one cell, or `null` for "not measured".
 *
 * Only `lines` can be null, and only because per-commit churn is capped and
 * one-way (Phase 1): an over-cap commit is persisted with NULL churn forever.
 * Returning 0 there would claim we measured an empty commit — the whole reason
 * this returns `number | null` rather than `number`.
 *
 * A day with NO commits is a different case and returns 0, not null: there was
 * nothing to measure and we know the answer is zero. Reporting "not measured"
 * across every quiet day would drown the handful of genuinely unmeasured cells
 * the cap produces, which is the only signal the null is there to carry.
 */
export function metricValue(cell: ActivityCell, metric: MatrixMetric): number | null {
  switch (metric) {
    case "commits":
      return cell.commits;
    case "lines":
      if (cell.commits === 0) return 0;
      if (cell.additions === null && cell.deletions === null) return null;
      return (cell.additions ?? 0) + (cell.deletions ?? 0);
    case "prs":
      return cell.prsOpened + cell.prsMerged;
    case "reviews":
      return cell.reviews;
  }
}

/**
 * The largest value of `metric` anywhere in the grid — the denominator of the
 * intensity ramp. Nulls are skipped (unmeasured, not zero). Returns 0 for an
 * empty or wholly-unmeasured grid, which callers must treat as "no ramp".
 */
export function metricMax(grid: ActivityGrid, metric: MatrixMetric): number {
  let max = 0;
  for (const row of grid.rows) {
    for (const day of grid.days) {
      const value = metricValue(row.cells[day], metric);
      if (value !== null && value > max) max = value;
    }
  }
  return max;
}

/**
 * Background intensity in `[0, 1]` for one value, relative to the grid max.
 *
 * Zero maps to 0 (no tint) rather than to the bottom of the ramp, so an
 * inactive cell reads as blank rather than as faintly active. Null maps to 0
 * for the same reason — an unmeasured cell must not look like a busy one.
 */
export function cellIntensity(value: number | null, max: number): number {
  if (value === null || value <= 0 || max <= 0) return 0;
  return Math.min(1, value / max);
}

/**
 * Cell text. `—` for unmeasured, an empty string for a true zero (so the grid
 * reads as a heat map rather than a wall of noughts), the number otherwise.
 */
export function formatMetricValue(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "";
  return String(value);
}

/** Screen-reader text: distinguishes unmeasured from zero, which color cannot. */
export function describeMetricValue(value: number | null, metric: MatrixMetric): string {
  const label = MATRIX_METRICS.find((m) => m.key === metric)?.label.toLowerCase() ?? metric;
  if (value === null) return `${label}: not measured`;
  return `${label}: ${value}`;
}

/** `2026-08-19` → `08-19`; the year is constant across a sprint's columns. */
export function formatDayHeader(dayKey: string): string {
  return dayKey.slice(5);
}
