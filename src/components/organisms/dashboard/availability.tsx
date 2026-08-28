"use client";

import Link from "next/link";
import { useMemo } from "react";

import { formatDayHeader } from "@/components/organisms/dashboard/activity-matrix-view";
import {
  type AvailabilityGrid,
  type AvailabilityMember,
  buildAvailabilityGrid,
  nextWindowAfter,
} from "@/components/organisms/dashboard/availability-view";
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
}: {
  members: AvailabilityMember[];
  absences: SerializedAbsence[];
  sprintStart: string | null;
  sprintEnd: string | null;
  timeZone: string | null;
  capacity: SprintCapacity | null;
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
            <CapacitySummary capacity={capacity} />
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
function CapacitySummary({ capacity }: { capacity: SprintCapacity | null }) {
  if (!capacity) return null;

  const { adjustedMd, nominalMd, sprintWorkingDays, teamDaysOff } = capacity;

  return (
    <div className="flex flex-col gap-1 rounded-md border p-4">
      <p className="text-2xl font-semibold tabular-nums">
        {round1(adjustedMd)} MD
        {adjustedMd < nominalMd ? (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            of {round1(nominalMd)} MD, after absences
          </span>
        ) : null}
      </p>
      <p className="text-sm text-muted-foreground">
        Capacity for this sprint, over {sprintWorkingDays}{" "}
        {sprintWorkingDays === 1 ? "working day" : "working days"}.
      </p>
      {teamDaysOff > 0 ? (
        <p className="text-sm text-muted-foreground">
          − {teamDaysOff} team {teamDaysOff === 1 ? "day" : "days"} off already
          subtracted (public holidays, company days off).
        </p>
      ) : null}
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

/** One decimal, and no trailing `.0` — capacity is a planning number, not a measurement. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
