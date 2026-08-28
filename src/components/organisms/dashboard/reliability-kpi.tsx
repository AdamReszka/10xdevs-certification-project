"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
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
import {
  type ReliabilityView,
  toReliabilityView,
} from "@/components/organisms/dashboard/reliability-kpi-view";

/**
 * Surface F — the Reliability KPI (S-10, FR-016).
 *
 * Committed SP vs delivered SP for the CURRENT sprint only; the inter-sprint
 * trend is S-12 territory. All decisions live in `reliability-kpi-view.ts`;
 * this file renders what it returns.
 *
 * S-23 Phase 6 added the capacity line. A full team committing 100 SP and
 * delivering 100, and a half-staffed team committing 50 and delivering 50, both
 * render as 100% — capacity is what separates them. It sits BESIDE the ratio and
 * never inside it (FR-016).
 */

export default function ReliabilityKpi(props: Parameters<typeof toReliabilityView>[0]) {
  const view = toReliabilityView(props);

  if (view.bars === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reliability</CardTitle>
          <CardDescription>Committed vs delivered story points.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {view.emptyReason === "no-sprint"
              ? // No sync fixes this one, so it must not promise that one will.
                "No active sprint yet — connect Jira and finish setup to see this sprint's committed and delivered points."
              : "SprintFlow hasn't recorded this sprint's committed and delivered points yet. They are written on each Jira sync — this panel fills in after the next one."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { committedSp, deliveredSp } = view.bars;
  const data = [
    { label: "Committed", sp: committedSp },
    { label: "Delivered", sp: deliveredSp },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reliability</CardTitle>
        <CardDescription>
          {view.ratio === null
            ? "Committed vs delivered story points for the current sprint."
            : `${deliveredSp} of ${committedSp} committed story points delivered so far (${view.ratio}%).`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CapacityLine view={view} />
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

/**
 * The context that makes the percentage readable: what the team had, and — when
 * the lead corrected the delivered figure — what was actually measured.
 */
function CapacityLine({ view }: { view: ReliabilityView }) {
  if (view.capacity === null && !view.isCorrected) return null;

  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {view.capacity === null ? null : (
        <p className="flex items-center gap-2">
          <span className="tabular-nums">
            Capacity {view.capacity.md} of {view.capacity.fullMd} MD, over{" "}
            {view.capacity.workingDays}{" "}
            {view.capacity.workingDays === 1 ? "working day" : "working days"}.
          </span>
          {/* FR-022: an override is a MARKED exception wherever it is shown. */}
          {view.capacity.isOverridden ? <Badge variant="outline">Overridden</Badge> : null}
        </p>
      )}
      {view.isCorrected ? (
        <p className="flex items-center gap-2">
          <span>
            Delivered is the lead&apos;s correction
            {view.measuredSp !== null ? ` (measured ${view.measuredSp} SP)` : ""}.
          </span>
          <Badge variant="outline">Corrected</Badge>
        </p>
      ) : null}
    </div>
  );
}
