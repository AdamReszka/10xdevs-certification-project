import { getCloudflareContext } from "@opennextjs/cloudflare";

import AbsenceEditor from "@/components/organisms/settings/absence-editor";
import { listAbsences } from "@/lib/absence-store";
import { dayKeyInTimeZone } from "@/lib/dashboard/day-bucket";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getDb } from "@/lib/db";
import { listRoster } from "@/lib/roster";
import { getActiveSprintRow } from "@/lib/sprint";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * `/team/absences` — where the owner records who is away: individual absences
 * (S-08, FR-010). It lived at `/settings/absences` until S-19 moved it into the
 * Team section; the old path still redirects here.
 *
 * Team-wide days off (S-23, FR-007) shared this page until S-19 gave them
 * `/team/days-off` — a different model with a different time horizon, so a
 * different tab.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` — do NOT re-declare either. One
 * `getDb` handle, owner-scoped reads only, plain data handed to the client
 * organism.
 *
 * NO WINDOW ON THE LIST, deliberately. The obvious reading of "the current
 * sprint's absences" would hide two things the owner needs: a vacation booked
 * for next month (entered, then apparently vanished) and a past absence they
 * want to correct. At the PRD's 3–10-person scale the whole set is a handful of
 * rows, and retention is *planned* to bound it to current + 2 previous sprints
 * (PRD FR-019; the purge itself is S-12 and does not exist yet — the only
 * retention in the codebase today is `SYNC_ATTEMPT_RETENTION` for the
 * operational log). S-16 turned "one sprint row per owner" into a growing
 * series, so the unbounded list is a real, if small, growth path rather than a
 * bounded one. The reasoning above still holds; the bound does not yet.
 */
export default async function TeamAbsencesPage() {
    const { env } = getCloudflareContext();
  const db = getDb(env);
  const { ownerId } = await resolveWorkspace();

  const [members, absences, timeZone, sprint] = await Promise.all([
    listRoster(db, ownerId),
    listAbsences({ db, ownerId }),
    getJiraTimeZone(db, ownerId),
    // Kept after the S-19 split: the absence editor needs `sprintStartDay` for
    // the "planned" checkbox default below.
    getActiveSprintRow(db, ownerId),
  ]);

  // The D2 default for the "planned" checkbox is judged against the sprint's
  // FIRST DAY in the team's zone, not its stored instant.
  const sprintStartDay =
    sprint?.startDate != null ? dayKeyInTimeZone(sprint.startDate, timeZone) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Absences</h2>
        <p className="text-sm text-muted-foreground">
          Vacation, sickness and training, per person. A recorded absence stops
          SprintFlow from flagging that developer as inactive, lowers the sprint&apos;s
          capacity, and — when it was not known before the sprint started — raises the
          sprint&apos;s risk. For a day the WHOLE team is off, use the{" "}
          <strong>Team days off</strong> tab instead.
        </p>
      </div>

      <AbsenceEditor
        // Dates cross as ISO strings, per the convention stated at
        // `organisms/anomaly/types.ts` ("no Date/unknown across the RSC
        // boundary"). React's Flight serializer would in fact carry a `Date`,
        // but this surface was the only one in `src/` disagreeing with the rest.
        absences={absences.map((a) => ({
          id: a.id,
          teamMemberId: a.teamMemberId,
          type: a.type,
          isPlanned: a.isPlanned,
          startDate: a.startDate.toISOString(),
          endDate: a.endDate.toISOString(),
        }))}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          isActive: m.isActive,
        }))}
        timeZone={timeZone}
        sprintStartDay={sprintStartDay}
      />
    </div>
  );
}
