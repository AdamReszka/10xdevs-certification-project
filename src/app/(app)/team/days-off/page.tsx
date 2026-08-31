import { getCloudflareContext } from "@opennextjs/cloudflare";

import TeamDaysOffEditor from "@/components/organisms/settings/team-days-off-editor";
import { resolveCadenceFor } from "@/lib/cadence-override";
import { getDb } from "@/lib/db";
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
  const { ownerId } = await resolveWorkspace();

  const [daysOff, sprint] = await Promise.all([
    // Unwindowed for the same reason absences are: a holiday entered for next
    // quarter that vanished from the list would read as a failed save.
    listTeamDaysOff({ db, ownerId }),
    // Only for `workingDays` — the editor shows what the sprint's working-day
    // count becomes once a day is removed from it.
    getActiveSprintRow(db, ownerId),
  ]);

  // RESOLVED (S-30). This page's counter and the capacity engine must agree on
  // which days are working days, and the lead's pattern is no longer a column on
  // the sprint row.
  const cadence = sprint ? await resolveCadenceFor(db, ownerId, sprint) : null;

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

      <TeamDaysOffEditor
        daysOff={daysOff.map((d) => ({
          id: d.id,
          // Already `YYYY-MM-DD`: the column is `date`, so unlike an absence
          // there is no instant to serialize and no zone to resolve it in.
          day: d.day,
          label: d.label,
        }))}
        workingDays={cadence?.workingDays ?? null}
      />
    </div>
  );
}
