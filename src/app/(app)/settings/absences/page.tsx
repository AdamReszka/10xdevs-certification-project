import { getCloudflareContext } from "@opennextjs/cloudflare";

import AbsenceEditor from "@/components/organisms/settings/absence-editor";
import { listAbsences } from "@/lib/absence-store";
import { requireSession } from "@/lib/auth";
import { dayKeyInTimeZone } from "@/lib/dashboard/day-bucket";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getDb } from "@/lib/db";
import { listRoster } from "@/lib/roster";
import { getActiveSprintRow } from "@/lib/sprint";

/**
 * Absence settings (S-08, FR-010) — where the owner records who is away.
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
 * rows, and retention already bounds it to current + 2 previous sprints.
 */
export default async function AbsenceSettingsPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  const [members, absences, timeZone, sprint] = await Promise.all([
    listRoster(db, ownerId),
    listAbsences({ db, ownerId }),
    getJiraTimeZone(db, ownerId),
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
          sprint&apos;s risk.
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
