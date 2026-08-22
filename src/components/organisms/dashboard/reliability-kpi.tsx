"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

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
import { RELIABILITY_CHART_CONFIG } from "@/components/organisms/dashboard/chart-theme";

/**
 * Surface F — the Reliability KPI (S-10, FR-016).
 *
 * Committed SP vs delivered SP for the CURRENT sprint only; the inter-sprint
 * trend is S-12 territory. Reads the `sprint` scalars directly — no reducer.
 *
 * Phase 1 §3 is what makes these non-NULL: before it, nothing in the repo wrote
 * `committed_sp`/`completed_sp` outside the demo seed, so this panel would have
 * been a permanent empty state for every real owner (plan review F1). An owner
 * whose sprint predates that write and hasn't re-synced still sees the empty
 * state rather than a misleading zero bar.
 */

export default function ReliabilityKpi({
  committedSp,
  completedSp,
}: {
  committedSp: number | null;
  completedSp: number | null;
}) {
  if (committedSp === null || completedSp === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reliability</CardTitle>
          <CardDescription>Committed vs delivered story points.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            SprintFlow hasn&apos;t recorded this sprint&apos;s committed and
            delivered points yet. They are written on each Jira sync — this panel
            fills in after the next one.
          </p>
        </CardContent>
      </Card>
    );
  }

  const data = [
    { label: "Committed", sp: committedSp },
    { label: "Delivered", sp: completedSp },
  ];
  const ratio = committedSp > 0 ? Math.round((completedSp / committedSp) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reliability</CardTitle>
        <CardDescription>
          {ratio === null
            ? "Committed vs delivered story points for the current sprint."
            : `${completedSp} of ${committedSp} committed story points delivered so far (${ratio}%).`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={RELIABILITY_CHART_CONFIG} className="min-h-[200px] w-full">
          <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12, top: 16 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={32}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="sp" fill="var(--color-sp)" radius={4} maxBarSize={96}>
              <LabelList dataKey="sp" position="top" className="fill-foreground" />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
