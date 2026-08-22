"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { TRACK_CHART_CONFIG } from "@/components/organisms/dashboard/chart-theme";
import { TRACK_KEYS, type BurndownSeries, type TrackKey } from "@/lib/dashboard/burndown-series";

/**
 * Surface C — per-technology sub-burndowns (S-10, FR-017).
 *
 * A Recharts leaf: receives plain serialized data, does no DB access and holds
 * no `Date`. Only the primitives actually used are imported, to keep the route
 * chunk small.
 *
 * Tracks with no story points anywhere in the sprint are omitted rather than
 * drawn as a flat zero line — an empty MOBILE track on a web team is noise, not
 * information. `UNKNOWN` follows the same rule, so it shows up exactly when
 * some SP could not be attributed.
 */

export default function SubBurndownChart({ series }: { series: BurndownSeries }) {
  const presentTracks = useMemo<TrackKey[]>(
    () => TRACK_KEYS.filter((k) => series.byTrack[k]?.some((p) => p.remainingSp > 0)),
    [series],
  );

  const data = useMemo(
    () =>
      series.days.map((day, i) => {
        const point: Record<string, string | number> = { day };
        for (const key of presentTracks) {
          point[key] = series.byTrack[key][i]?.remainingSp ?? 0;
        }
        return point;
      }),
    [series, presentTracks],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Burndown by technology</CardTitle>
        <CardDescription>
          Remaining story points per track. The lines sum to the sprint total —
          unattributable points are carried in &ldquo;Unattributed&rdquo; rather
          than dropped.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 || presentTracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No estimated work in this sprint yet. Once tickets carry story points,
            each technology track gets its own line here.
          </p>
        ) : (
          <ChartContainer config={TRACK_CHART_CONFIG} className="min-h-[240px] w-full">
            <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
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
              <ChartLegend content={<ChartLegendContent />} />
              {presentTracks.map((key) => (
                <Line
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  dot={false}
                  // The unattributed remainder is drawn dashed as well as muted,
                  // so it stays distinguishable without relying on color alone.
                  strokeDasharray={key === "UNKNOWN" ? "4 4" : undefined}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
