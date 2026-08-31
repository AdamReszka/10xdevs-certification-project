import { getCloudflareContext } from "@opennextjs/cloudflare";

import CadenceEditor from "@/components/organisms/settings/cadence-editor";
import { resolveCadenceFor } from "@/lib/cadence-override";
import { getDb } from "@/lib/db";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getActiveSprintRow } from "@/lib/sprint";
import { toSprintIdentity } from "@/lib/sprint-identity";
import type { Weekday } from "@/lib/validations/roster";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * `/team/cadence` — sprint length, start day and working days, outside the
 * setup wizard (S-29, FR-007).
 *
 * WHY IT IS ITS OWN PAGE, AND WHY IT IS HERE. FR-007 promises the lead can
 * override the auto-pulled cadence, and that promise was met only inside
 * `/setup/team` — the wizard's last step, which `CadenceForm` was mounted by
 * exactly once repo-wide and which an onboarded lead has no route back to. It
 * sits under `/team` rather than `/settings` because `/team/days-off` already
 * consumes `sprint.working_days` to compute its own copy: the cadence and the
 * company calendar are one model, and this is where that model lives.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` — do NOT re-declare either. One
 * `getDb` handle, owner-scoped reads only, plain data handed to the client
 * organism, and the sprint identity formatted HERE so no `Date` and no `Intl`
 * call crosses into the client.
 *
 * Reads through `getActiveSprintRow`, the same resolver the anomaly engine
 * detects against and the same one `saveCadence` now writes through — which is
 * the whole point: the row the lead is looking at and the row the save writes
 * are one row.
 */
export default async function TeamCadencePage() {
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const { ownerId, now } = await resolveWorkspace();

  const [activeSprint, timeZone] = await Promise.all([
    getActiveSprintRow(db, ownerId),
    getJiraTimeZone(db, ownerId),
  ]);

  // RESOLVED, not coalesced off the row (S-30). The form must prefill what the
  // engine actually uses, and the lead's chosen working-day pattern no longer
  // lives on `sprint` — it lives in `sprint_cadence_override`, which is what
  // survives a disconnect and a project switch.
  const resolved = activeSprint
    ? await resolveCadenceFor(db, ownerId, activeSprint)
    : null;

  const initialCadence =
    activeSprint && resolved
    ? {
        lengthDays: resolved.lengthDays,
        startDay: resolved.startDay as Weekday,
        workingDays: [...resolved.workingDays] as Weekday[],
        cadenceOverridden: activeSprint.cadenceOverridden,
        sprintState: activeSprint.state,
        sprintIdentity: toSprintIdentity({
          name: activeSprint.name,
          jiraSprintId: activeSprint.jiraSprintId,
          startDate: activeSprint.startDate,
          endDate: activeSprint.endDate,
          timeZone,
          now,
        }),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Sprint cadence</h2>
        <p className="text-sm text-muted-foreground">
          The rhythm every other number is measured against: how long a sprint
          runs, which day it starts, and which days your team works. Working days
          set your capacity in man-days and decide how quickly a ticket or a pull
          request is considered to be ageing. For single days the whole team is
          off, use the <strong>Team days off</strong> tab instead.
        </p>
      </div>

      <CadenceEditor initialCadence={initialCadence} />
    </div>
  );
}
