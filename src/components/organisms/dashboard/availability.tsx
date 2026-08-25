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
 * The capacity number, and the reason it may be understated.
 *
 * A null `sp_capacity` is NEVER shown as 0 SP: it means the owner has not
 * answered yet, and a silent zero would hand the lead a number they cannot tell
 * is wrong.
 */
function CapacitySummary({ capacity }: { capacity: SprintCapacity | null }) {
  if (!capacity) return null;

  const { adjustedSp, nominalSp, membersWithoutCapacity } = capacity;
  const noneSet = nominalSp === 0 && membersWithoutCapacity > 0;

  return (
    <div className="flex flex-col gap-1 rounded-md border p-4">
      {noneSet ? (
        <p className="text-sm text-muted-foreground">
          No story-point capacity set for anyone on the team yet — add it on the
          Team tab and this becomes a number.
        </p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {round1(adjustedSp)} SP
            {adjustedSp < nominalSp ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                of {round1(nominalSp)} SP, after absences
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">
            Capacity for this sprint.
            {membersWithoutCapacity > 0
              ? ` ${membersWithoutCapacity} member${membersWithoutCapacity === 1 ? "" : "s"} without capacity set ${membersWithoutCapacity === 1 ? "is" : "are"} not counted.`
              : null}
          </p>
        </>
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

/** One decimal, and no trailing `.0` — capacity is a planning number, not a measurement. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
