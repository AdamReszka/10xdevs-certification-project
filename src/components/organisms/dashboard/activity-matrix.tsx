"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  cellIntensity,
  describeMetricValue,
  formatDayHeader,
  formatMetricValue,
  MATRIX_METRICS,
  metricMax,
  metricValue,
  type MatrixMetric,
} from "@/components/organisms/dashboard/activity-matrix-view";
import { UNKNOWN_MEMBER_ID, type ActivityGrid } from "@/lib/dashboard/activity-grid";

/**
 * Surface B — the Team Activity Matrix (S-10, FR-017).
 *
 * Developer × Day, one metric at a time via a segmented switcher, each cell
 * tinted by its value relative to the metric's max in the current grid.
 *
 * PRD guardrail: this is flow data, not performance-review material. There is
 * no ranking, no total column, and no per-developer score — the grid answers
 * "where did the work happen this sprint", not "who did most".
 *
 * Metric selection, scaling, and formatting live in `activity-matrix-view.ts`.
 */

export default function ActivityMatrix({ grid }: { grid: ActivityGrid }) {
  const [metric, setMetric] = useState<MatrixMetric>("commits");
  const max = useMemo(() => metricMax(grid, metric), [grid, metric]);

  const isEmpty = grid.days.length === 0 || grid.rows.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team activity</CardTitle>
        <CardDescription>
          Where the work landed across the sprint. Cell shading is relative to the
          busiest cell for the selected metric.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as MatrixMetric)}>
          <TabsList>
            {MATRIX_METRICS.map((m) => (
              <TabsTrigger key={m.key} value={m.key}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isEmpty ? (
          <p className="text-sm text-muted-foreground">
            No activity to show yet. Once a sync brings in commits, pull requests,
            or reviews for this sprint, they appear here.
          </p>
        ) : (
          // 10-inch tablet floor (NFR): scrolls inside its container, not the page.
          <div className="w-full overflow-x-auto">
            <table className="w-full border-separate border-spacing-0.5 text-sm">
              <caption className="sr-only">
                Team activity by developer and day, showing{" "}
                {MATRIX_METRICS.find((m) => m.key === metric)?.label.toLowerCase()}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-medium">
                    Developer
                  </th>
                  {grid.days.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      className="px-2 py-1 text-center font-medium tabular-nums whitespace-nowrap text-muted-foreground"
                    >
                      {formatDayHeader(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => {
                  const unmatched = row.memberId === UNKNOWN_MEMBER_ID;
                  return (
                    <tr key={row.memberId}>
                      <th
                        scope="row"
                        className={cn(
                          "sticky left-0 z-10 bg-card px-2 py-1 text-left font-normal whitespace-nowrap",
                          unmatched && "text-muted-foreground italic",
                        )}
                        title={
                          unmatched
                            ? "Activity whose GitHub author matches no roster member"
                            : (row.githubUsername ?? undefined)
                        }
                      >
                        {row.memberName}
                      </th>
                      {grid.days.map((day) => {
                        const value = metricValue(row.cells[day], metric);
                        const intensity = cellIntensity(value, max);
                        return (
                          <td
                            key={day}
                            className="rounded-sm px-2 py-1 text-center tabular-nums"
                            // Opacity ramp over the chart token keeps the tint
                            // legible in both themes without a second palette.
                            style={
                              intensity > 0
                                ? {
                                    backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.round(intensity * 70)}%, transparent)`,
                                  }
                                : undefined
                            }
                          >
                            <span aria-hidden>{formatMetricValue(value)}</span>
                            <span className="sr-only">
                              {describeMetricValue(value, metric)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          <span aria-hidden>—</span> means not measured, not zero: per-commit line
          stats are fetched under a per-repo cap and are never backfilled.
        </p>
      </CardContent>
    </Card>
  );
}
