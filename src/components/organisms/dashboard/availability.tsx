"use client";

import Link from "next/link";
import { useMemo } from "react";

import { formatDayHeader } from "@/components/organisms/dashboard/activity-matrix-view";
import CapacityAdjustments from "@/components/organisms/dashboard/capacity-adjustments";
import {
  round1,
  toCapacityHeadline,
  toDeliveredView,
} from "@/components/organisms/dashboard/capacity-adjustments-view";
import {
  type AvailabilityGrid,
  type AvailabilityMember,
  buildAvailabilityGrid,
  nextWindowAfter,
} from "@/components/organisms/dashboard/availability-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SprintCapacity } from "@/lib/dashboard/capacity";
import { cn } from "@/lib/utils";

/**
 * Absences as they cross the server→client boundary. `Date` does not survive
 * serialization into a client component's props, so the page sends ISO strings
 * and this file rebuilds them once, on mount.
 */
export type SerializedAbsence = {
  teamMemberId: string;
  startDate: string;
  endDate: string;
};

/**
 * The sprint-measurement fields this tab reads (S-23 Phase 5, FR-022/FR-023).
 *
 * A hand-picked slice of `SprintMeasurement` rather than the record itself: the
 * full row carries `Date`s, which the house convention does not send across the
 * client boundary, and three of its columns are the sweep's business alone.
 */
export type SprintAdjustments = {
  capacityOverrideMd: number | null;
  deliveredSp: number | null;
  deliveredSpCorrected: number | null;
  /**
   * Whether the sweep has frozen this sprint's measurement. Gates the
   * delivered-SP correction (impl-review F3): a figure that is still moving is
   * not one worth correcting, and a correction entered mid-sprint would outlive
   * the sweep into FR-024's average with nothing recording that it was premature.
   */
  isFinalized: boolean;
};

/**
 * Availability — the fifth tab on Dashboard "Today" (S-08, FR-010/FR-016).
 *
 * A tab rather than an always-on card, because FR-016 is explicit that the
 * Anomaly Inbox stays the headline and every other panel sits one click away.
 *
 * Two windows: the sprint in flight, and the next one of the same length. The
 * second answers "can I promise this?" at the moment the lead is asked — which is
 * usually mid-sprint, not at planning. It shows WHO is away; it deliberately does
 * not compute that window's capacity number (its own slice).
 *
 * All grid logic lives in `availability-view.ts`; this file renders.
 */
export default function Availability({
  members,
  absences,
  sprintStart,
  sprintEnd,
  timeZone,
  capacity,
  jiraSprintId,
  adjustments,
}: {
  members: AvailabilityMember[];
  absences: SerializedAbsence[];
  sprintStart: string | null;
  sprintEnd: string | null;
  timeZone: string | null;
  capacity: SprintCapacity | null;
  /**
   * The displayed sprint's Jira id, or `null` when there is none to adjust. The
   * manual-entry form is withheld without it: an entry has to name the sprint it
   * belongs to rather than let the server guess at save time (impl-review F2).
   */
  jiraSprintId: string | null;
  /**
   * The lead's manual entries on this sprint's measurement record (S-23 Phase 5).
   * `null` when the sweep has not written a record yet — an ordinary state, not
   * an error, and one the override form itself can resolve by creating one.
   */
  adjustments: SprintAdjustments | null;
}) {
  const windows = useMemo(() => {
    if (!sprintStart || !sprintEnd) return null;
    const start = new Date(sprintStart);
    const end = new Date(sprintEnd);
    const next = nextWindowAfter(start, end, timeZone);
    const parsed = absences.map((a) => ({
      teamMemberId: a.teamMemberId,
      startDate: new Date(a.startDate),
      endDate: new Date(a.endDate),
    }));
    return {
      current: buildAvailabilityGrid({
        members,
        absences: parsed,
        from: start,
        to: end,
        timeZone,
      }),
      next: buildAvailabilityGrid({
        members,
        absences: parsed,
        from: next.from,
        to: next.to,
        timeZone,
      }),
    };
  }, [members, absences, sprintStart, sprintEnd, timeZone]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Who is away</CardTitle>
          <CardDescription>
            Recorded absences across this sprint and the next window of the same
            length. An absence also silences that person&apos;s inactivity flag and
            lowers the sprint&apos;s capacity.
          </CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/absences">Manage</Link>
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {!windows ? (
          <p className="text-sm text-muted-foreground">
            No active sprint with dates yet — connect Jira and finish setup to see
            who is away.
          </p>
        ) : (
          <>
            <CapacitySummary
              capacity={capacity}
              jiraSprintId={jiraSprintId}
              adjustments={adjustments}
            />
            <AvailabilitySection title="This sprint" grid={windows.current} />
            <AvailabilitySection title="Next window" grid={windows.next} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The capacity number in MAN-DAYS, and the working-day count it came from.
 *
 * The divisor is on screen (FR-022) because it was not: `sprintWorkingDays` has
 * been computed since S-08 and rendered nowhere, so a wrong working-day count —
 * the thing the whole figure scales with — was unfalsifiable by the lead.
 *
 * TEAM DAYS OFF ARE NAMED SEPARATELY (S-23, FR-007) rather than folded silently
 * into that count. `sprintWorkingDays` already has them subtracted, so without
 * the second line a recorded public holiday would present as a working-day total
 * that disagrees with the calendar — which reads as an arithmetic error rather
 * than as the holiday the lead entered ten seconds earlier.
 *
 * There is no "nobody answered yet" empty state any more. `fte` is NOT NULL, so
 * every active member contributes something; a member the migration guessed at
 * is surfaced by the `/settings/team` banner instead, where it can actually be
 * fixed.
 */
function CapacitySummary({
  capacity,
  jiraSprintId,
  adjustments,
}: {
  capacity: SprintCapacity | null;
  jiraSprintId: string | null;
  adjustments: SprintAdjustments | null;
}) {
  if (!capacity) return null;

  const { adjustedMd, nominalMd, sprintWorkingDays, teamDaysOff } = capacity;
  const headline = toCapacityHeadline({
    adjustedMd,
    nominalMd,
    overrideMd: adjustments?.capacityOverrideMd ?? null,
  });
  const delivered = toDeliveredView({
    deliveredSp: adjustments?.deliveredSp ?? null,
    correctedSp: adjustments?.deliveredSpCorrected ?? null,
  });

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
          {round1(headline.md)} MD
          {headline.beforeAbsencesMd !== null ? (
            <span className="text-sm font-normal text-muted-foreground">
              of {round1(headline.beforeAbsencesMd)} MD, after absences
            </span>
          ) : null}
          {/* FR-022 makes an override a MARKED exception: the figure feeds
              FR-024's normalisation, so it must never be mistaken for something
              the system measured. */}
          {headline.isOverridden ? <Badge variant="outline">Overridden</Badge> : null}
        </p>
        <p className="text-sm text-muted-foreground">
          Capacity for this sprint, over {sprintWorkingDays}{" "}
          {sprintWorkingDays === 1 ? "working day" : "working days"}.
        </p>
        {headline.isOverridden ? (
          <p className="text-sm text-muted-foreground">
            Computed from the roster: {round1(headline.computedMd)} MD.
          </p>
        ) : null}
        {teamDaysOff > 0 ? (
          <p className="text-sm text-muted-foreground">
            − {teamDaysOff} team {teamDaysOff === 1 ? "day" : "days"} off already
            subtracted (public holidays, company days off).
          </p>
        ) : null}
        {delivered.sp !== null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Delivered so far: {delivered.sp} SP
              {delivered.isCorrected && delivered.computedSp !== null
                ? ` (measured ${delivered.computedSp} SP)`
                : ""}
            </span>
            {delivered.isCorrected ? (
              <Badge variant="outline">Corrected</Badge>
            ) : null}
          </p>
        ) : null}
      </div>

      {jiraSprintId === null ? null : (
        <CapacityAdjustments
          jiraSprintId={jiraSprintId}
          computedMd={headline.computedMd}
          overrideMd={adjustments?.capacityOverrideMd ?? null}
          computedSp={delivered.computedSp}
          correctedSp={adjustments?.deliveredSpCorrected ?? null}
          canCorrectDelivered={adjustments?.isFinalized ?? false}
        />
      )}
    </div>
  );
}

function AvailabilitySection({
  title,
  grid,
}: {
  title: string;
  grid: AvailabilityGrid;
}) {
  const anyoneAway = grid.rows.some((r) => r.absentDays.size > 0);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {grid.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active team members.</p>
      ) : (
        <>
          {!anyoneAway ? (
            <p className="text-sm text-muted-foreground">
              Nobody is away in this window.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                {title}: team members by day, marking recorded absences
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-background pr-3 text-left font-medium">
                    Person
                  </th>
                  {grid.days.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      className="px-1 pb-1 text-center text-xs font-normal text-muted-foreground tabular-nums"
                    >
                      {formatDayHeader(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.memberId}>
                    <th
                      scope="row"
                      className="sticky left-0 bg-background py-1 pr-3 text-left font-normal"
                    >
                      {row.memberName}
                    </th>
                    {grid.days.map((day) => {
                      const away = row.absentDays.has(day);
                      return (
                        <td key={day} className="px-1 py-1">
                          <div
                            className={cn(
                              "mx-auto h-5 w-5 rounded-sm border",
                              away ? "bg-muted-foreground/70" : "bg-transparent",
                            )}
                            // The colour alone would carry the whole signal, which
                            // a screen reader cannot see.
                            aria-label={`${row.memberName} on ${day}: ${away ? "away" : "available"}`}
                            role="img"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
