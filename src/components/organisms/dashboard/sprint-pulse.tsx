"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { PULSE_CHART_CONFIG } from "@/components/organisms/dashboard/chart-theme";
import { CATEGORY_COLUMNS } from "@/components/organisms/dashboard/aging-report-controls";
import type { BurndownSeries } from "@/lib/dashboard/burndown-series";

/**
 * Surface D — Sprint Pulse (S-10, FR-016).
 *
 * The total sprint burndown against an ideal line, beside the per-status ticket
 * distribution. Both come from the SAME `BurndownSeries` the sub-burndowns use —
 * `byCategory` exists on that contract for exactly this panel (plan review F3),
 * so the distribution costs no extra query.
 *
 * Scope-change context is deliberately absent: SCOPE_CREEP is already an inbox
 * anomaly, and restating it here would duplicate the headline surface.
 */

export default function SprintPulse({ series }: { series: BurndownSeries }) {
  const { committedSp } = series;

  const data = useMemo(() => {
    const lastIndex = series.total.length - 1;
    return series.total.map((point, i) => ({
      day: point.day,
      remainingSp: point.remainingSp,
      // The ideal line runs straight from committedSp to 0 across the sprint.
      // Omitted entirely when committedSp is null — drawing it at 0 would claim
      // the team committed to nothing (F3).
      ...(committedSp === null
        ? {}
        : { idealSp: lastIndex === 0 ? 0 : committedSp * (1 - i / lastIndex) }),
    }));
  }, [series.total, committedSp]);

  const totalTickets = CATEGORY_COLUMNS.reduce(
    (acc, c) => acc + (series.byCategory[c.key] ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sprint pulse</CardTitle>
        <CardDescription>
          {committedSp === null
            ? "Remaining story points across the sprint. The ideal line appears once a sync records the sprint's committed points."
            : `Remaining story points against an ideal burn from ${committedSp} committed SP.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No burndown yet — this chart needs a sprint with start and end dates.
          </p>
        ) : (
          <ChartContainer config={PULSE_CHART_CONFIG} className="min-h-[220px] w-full">
            <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={32}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="remainingSp"
                type="monotone"
                stroke="var(--color-remainingSp)"
                fill="var(--color-remainingSp)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              {committedSp === null ? null : (
                <Line
                  dataKey="idealSp"
                  type="linear"
                  stroke="var(--color-idealSp)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              )}
            </AreaChart>
          </ChartContainer>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium">Tickets by status</h3>
          {totalTickets === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tickets in this sprint yet.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {CATEGORY_COLUMNS.filter(
                // The unmapped bucket appears only when it is non-empty, matching
                // the aging report's rule — a well-mapped project sees five.
                (c) => c.key !== "UNKNOWN" || (series.byCategory.UNKNOWN ?? 0) > 0,
              ).map((c) => (
                <div key={c.key} className="rounded-md border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{c.label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {series.byCategory[c.key] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
