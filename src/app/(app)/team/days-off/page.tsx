import { getCloudflareContext } from "@opennextjs/cloudflare";
import { InfoIcon } from "lucide-react";

import HolidayCalendarEditor from "@/components/organisms/settings/holiday-calendar-editor";
import TeamDaysOffEditor from "@/components/organisms/settings/team-days-off-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveCadenceFor } from "@/lib/cadence-override";
import { getDb } from "@/lib/db";
import { holidayCalendarNotice } from "@/lib/holidays/calendar-notice";
import {
  getHolidayCalendar,
  listApprovedYears,
} from "@/lib/holidays/calendar-store";
import { holidayProposal, holidayYears } from "@/lib/holidays/proposal";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";
import { listTeamDaysOff } from "@/lib/team-day-off-store";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * `/team/days-off` — the company calendar (S-23, FR-007/FR-022): days the WHOLE
 * team is off.
 *
 * WHY IT IS ITS OWN PAGE (S-19). It shared `/settings/absences` with the
 * individual absence editor, and the two carry different models with different
 * time horizons: an absence is per person and belongs to a sprint, a public
 * holiday is a property of the calendar and applies to every sprint that spans
 * it. One screen with two headings asked the owner to hold both at once.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` — do NOT re-declare either. One
 * `getDb` handle, owner-scoped reads only, plain data handed to the client
 * organism.
 */
export default async function TeamDaysOffPage() {
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const { ownerId, isDemo, now } = await resolveWorkspace();

  const [daysOff, sprint, countryCode, timeZone] = await Promise.all([
    // Unwindowed for the same reason absences are: a holiday entered for next
    // quarter that vanished from the list would read as a failed save.
    listTeamDaysOff({ db, ownerId }),
    // For `workingDays` — the editor shows what the sprint's working-day count
    // becomes once a day is removed from it — and, since S-17, for the window
    // the holiday proposal covers.
    getActiveSprintRow(db, ownerId),
    getHolidayCalendar({ db, ownerId }),
    getJiraTimeZone(db, ownerId),
  ]);

  // RESOLVED (S-30). This page's counter and the capacity engine must agree on
  // which days are working days, and the lead's pattern is no longer a column on
  // the sprint row.
  const cadence = sprint ? await resolveCadenceFor(db, ownerId, sprint) : null;

  // S-17. Every year the ACTIVE SPRINT touches, not just this one: a sprint
  // running into January would otherwise count 1 and 6 January as ordinary
  // working days for its whole length, and the notice would be silent about it
  // until the year had already turned.
  const years = holidayYears({
    sprintStart: sprint?.startDate ?? null,
    sprintEnd: sprint?.endDate ?? null,
    now,
    timeZone,
  });
  const approvedYears = countryCode
    ? await listApprovedYears({ db, ownerId, countryCode })
    : new Set<number>();
  // Submitted WHOLE on approval, a year with nothing left to propose included —
  // stamping it is what stops SprintFlow asking about it forever.
  const unapprovedYears = years.filter((y) => !approvedYears.has(y));
  const proposed = countryCode
    ? holidayProposal({
        countryCode,
        years,
        approvedYears,
        existingDays: new Set(daysOff.map((d) => d.day)),
      })
    : [];

  // `listTeamDaysOff` is unwindowed, so "no rows here" IS "no calendar at all" —
  // the same fact `capacity.calendarIsEmpty` reports on the dashboard.
  const notice = holidayCalendarNotice({
    isDemo,
    countryCode,
    years,
    approvedYears,
    calendarIsEmpty: daysOff.length === 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Team days off</h2>
        <p className="text-sm text-muted-foreground">
          Public holidays and company days off — days the WHOLE team is off. A day
          recorded here costs one man-day per person, stops tickets ageing across
          it, and applies to every sprint that spans it, so a national holiday is
          entered once rather than re-entered each sprint. For one person being
          away, use the <strong>Absences</strong> tab instead.
        </p>
      </div>

      {notice ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.body}</AlertDescription>
        </Alert>
      ) : null}

      {/* Above the manual list, because it is the path most leads should take:
          the list below stays for the company offsite that no national calendar
          knows about. */}
      {isDemo ? null : (
        <HolidayCalendarEditor
          countryCode={countryCode}
          years={unapprovedYears}
          proposed={proposed}
          workingDays={cadence?.workingDays ?? null}
        />
      )}

      <TeamDaysOffEditor
        daysOff={daysOff.map((d) => ({
          id: d.id,
          // Already `YYYY-MM-DD`: the column is `date`, so unlike an absence
          // there is no instant to serialize and no zone to resolve it in.
          day: d.day,
          label: d.label,
          // S-17: the marker the lead reads to tell their own entries apart
          // from the ones the holiday calendar generated.
          source: d.source,
        }))}
        workingDays={cadence?.workingDays ?? null}
      />
    </div>
  );
}
