import { getCloudflareContext } from "@opennextjs/cloudflare";

import CadenceForm from "@/components/organisms/setup/cadence-form";
import RosterEditor from "@/components/organisms/setup/roster-editor";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import { getDb } from "@/lib/db";
import { listRosterForEditor } from "@/lib/roster";
import { getActiveSprintRow } from "@/lib/sprint";
import { toSprintIdentity } from "@/lib/sprint-identity";
import type { Weekday } from "@/lib/validations/roster";

/**
 * Setup step 4 — team roster + sprint cadence (S-04, FR-006/FR-007). The final
 * wizard step. Server component under the gated `(app)` group (inherits
 * `requireSession()` + `force-dynamic`): it SELECTs only NON-secret existing
 * state (saved roster rows + the active sprint's cadence columns) and hands it to
 * the two client organisms, which drive import → edit → save against the Server
 * Actions. Credentials are NEVER decrypted here — that lives in the service core.
 */
export default async function TeamSetupPage() {
  const { ownerId } = await requireRealWorkspace();
  // The wizard itself stays real (`requireRealWorkspace` above); this reads only
  // WHICH workspace is active, so the last step can leave demo behind when it
  // finishes. `resolveWorkspace` is `cache()`d and the `(app)` layout has
  // already called it this render, so it costs no extra query and no extra pool.
  const { isDemo, now } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  // Shared with Settings → Team so the two editor mounts cannot drift.
  const initialMembers = await listRosterForEditor(db, ownerId);

  // ONE RESOLVER, NOT TWO (S-25, plan review F6). This page used to hand-roll
  // `WHERE state = 'ACTIVE' … LIMIT 1` while Today asked `getActiveSprintRow`,
  // whose second tier falls back to the most-recently-started sprint. On a
  // between-sprints account that was Today naming a sprint while the wizard said
  // there was none — two surfaces contradicting each other about identity,
  // inside a slice whose premise is that identity is a fact the lead can check.
  // The hand-rolled query also had no `ORDER BY`, so with two ACTIVE rows (which
  // `importCadence` can create) Postgres could return either.
  //
  // The cadence VALUES read off the row are the same columns as before — the
  // shared resolver returns a superset, not a different sprint, whenever an
  // ACTIVE one exists.
  const [activeSprint, timeZone] = await Promise.all([
    getActiveSprintRow(db, ownerId),
    getJiraTimeZone(db, ownerId),
  ]);

  const initialCadence = activeSprint
    ? {
        lengthDays: activeSprint.lengthDays ?? 14,
        startDay: (activeSprint.startDay as Weekday | null) ?? "MON",
        workingDays: (activeSprint.workingDays as Weekday[] | null) ?? [
          "MON",
          "TUE",
          "WED",
          "THU",
          "FRI",
        ],
        cadenceOverridden: activeSprint.cadenceOverridden,
        // Built on the SERVER so the identity is on screen at first paint, not
        // only after a re-pull — and so no `Date` and no `Intl` call crosses
        // into the client component.
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
    <SetupWizardShell
      step={4}
      // The roster grid is eight columns wide and one of them holds a
      // 43-character Jira account id — it needs the app shell's measure.
      wide
      title="Zespół i rytm sprintu"
      description="Sprawdź skład zespołu zaciągnięty z GitHuba i Jiry, a potem potwierdź rytm sprintu. Wszystko możesz edytować — SprintFlow zapamięta Twoje zmiany."
    >
      <div className="flex flex-col gap-8">
        <RosterEditor initialMembers={initialMembers} />
        <CadenceForm initialCadence={initialCadence} inDemo={isDemo} />
      </div>
    </SetupWizardShell>
  );
}
