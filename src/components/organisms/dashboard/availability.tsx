"use client";

import { InfoIcon } from "lucide-react";
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
} from "@/components/organisms/dashboard/availability-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { holidayCalendarNotice } from "@/lib/holidays/calendar-notice";
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
 * The holiday-calendar facts the notice needs, as plain data (S-17).
 *
 * ARRAYS RATHER THAN A `Set` across the boundary: the house convention is that
 * only plain JSON-ish values cross into a client component, the same rule that
 * turns `Date` into an ISO string two types above. The component rebuilds the
 * set once.
 */
export type HolidayCalendarFacts = {
  countryCode: string | null;
  /** Every year the active sprint touches (`holidayYears`). */
  years: number[];
  /** Which of them the lead has already decided about, under `countryCode`. */
  approvedYears: number[];
};

/**
 * Availability — the fifth tab on Dashboard "Today" (S-08, FR-010/FR-016).
 *
 * A tab rather than an always-on card, because FR-016 is explicit that the
 * Anomaly Inbox stays the headline and every other panel sits one click away.
 *
 * Two windows: the sprint in flight, and the next one, of the length the lead's
 * cadence says (S-18 — it used to be the current sprint's own accidental span).
 * The second answers "can I promise this?" at the moment the lead is asked —
 * which is usually mid-sprint, not at planning.
 *
 * All grid logic lives in `availability-view.ts`; this file renders.
 */
export default function Availability({
  members,
  absences,
  sprintStart,
  sprintEnd,
  nextWindowStart,
  nextWindowEnd,
  timeZone,
  capacity,
  jiraSprintId,
  adjustments,
  holidayCalendar,
  isDemo,
}: {
  members: AvailabilityMember[];
  absences: SerializedAbsence[];
  sprintStart: string | null;
  sprintEnd: string | null;
  /**
   * The forecast window's bounds, resolved SERVER-SIDE (S-18). It used to be
   * computed here from the sprint's own millisecond span; its length is now the
   * lead's durable cadence, which only a database read can resolve — so the
   * window crosses the boundary as two ISO strings, like every other date here.
   * `null` whenever the sprint has no dates, exactly when the grids are withheld.
   */
  nextWindowStart: string | null;
  nextWindowEnd: string | null;
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
  /** S-17: what the panel needs to say about the working-day calendar. */
  holidayCalendar: HolidayCalendarFacts;
  /** Silences the calendar notice outright — see the notice module's row 0. */
  isDemo: boolean;
}) {
  const windows = useMemo(() => {
    if (!sprintStart || !sprintEnd || !nextWindowStart || !nextWindowEnd)
      return null;
    const start = new Date(sprintStart);
    const end = new Date(sprintEnd);
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
        from: new Date(nextWindowStart),
        to: new Date(nextWindowEnd),
        timeZone,
      }),
    };
  }, [
    members,
    absences,
    sprintStart,
    sprintEnd,
    nextWindowStart,
    nextWindowEnd,
    timeZone,
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Who is away</CardTitle>
          <CardDescription>
            Recorded absences across this sprint and the next window of your
            team&apos;s cadence. An absence also silences that person&apos;s
            inactivity flag and lowers the sprint&apos;s capacity.
          </CardDescription>
        </div>
        {/*
          TWO LINKS SINCE S-19, because this card shows two things. The header
          used to carry one `Manage` button pointing at `/settings/absences`,
          which hosted BOTH editors — so one click reached both halves. S-19 gave
          team days off their own tab, and the card renders a "− N team days off
          already subtracted" line below, so the second link is what keeps every
          number on this card one click from the surface that edits it.
        */}
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/team/absences">Manage</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/team/days-off">Days off</Link>
          </Button>
        </div>
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
              holidayCalendar={holidayCalendar}
              isDemo={isDemo}
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
 *
 * AN UNREVIEWED CALENDAR NOW SPEAKS (S-17, FR-007). Until this slice, zero team
 * days off rendered as silence — the same silence as a calendar the lead had
 * checked and found genuinely holiday-free — while the capacity above and all
 * five elapsed-time anomaly rules were being computed as though nobody is ever
 * off. What separates the states is the APPROVAL RECORD rather than the row
 * count, and the whole precedence table (demo first, then a country we have no
 * rules for, then no country, then an unreviewed year) lives in
 * `lib/holidays/calendar-notice.ts` because this file has no test harness.
 */
function CapacitySummary({
  capacity,
  jiraSprintId,
  adjustments,
  holidayCalendar,
  isDemo,
}: {
  capacity: SprintCapacity | null;
  jiraSprintId: string | null;
  adjustments: SprintAdjustments | null;
  holidayCalendar: HolidayCalendarFacts;
  isDemo: boolean;
}) {
  if (!capacity) return null;

  const { adjustedMd, nominalMd, sprintWorkingDays, teamDaysOff, calendarIsEmpty } =
    capacity;
  const notice = holidayCalendarNotice({
    isDemo,
    countryCode: holidayCalendar.countryCode,
    years: holidayCalendar.years,
    approvedYears: new Set(holidayCalendar.approvedYears),
    calendarIsEmpty,
  });
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

      {/* Below the numbers rather than above them: the panel's headline is the
          capacity figure, and the notice explains what that figure assumed. The
          two are NOT written as an either/or — the component must not assume
          the mutual exclusion that happens to hold today. */}
      {notice ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>
            <span>{notice.body}</span>
            <Link href="/team/days-off" className="underline underline-offset-4">
              Record your team days off
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

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
