import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";

import CadenceForm from "@/components/organisms/setup/cadence-form";
import RosterEditor from "@/components/organisms/setup/roster-editor";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { sprint } from "@/db/schema";
import { requireRealWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";
import { listRosterForEditor } from "@/lib/roster";
import type { Weekday } from "@/lib/validations/roster";

/**
 * Setup step 3 — team roster + sprint cadence (S-04, FR-006/FR-007). The final
 * wizard step. Server component under the gated `(app)` group (inherits
 * `requireSession()` + `force-dynamic`): it SELECTs only NON-secret existing
 * state (saved roster rows + the active sprint's cadence columns) and hands it to
 * the two client organisms, which drive import → edit → save against the Server
 * Actions. Credentials are NEVER decrypted here — that lives in the service core.
 */
export default async function TeamSetupPage() {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  // Shared with Settings → Team so the two editor mounts cannot drift.
  const initialMembers = await listRosterForEditor(db, ownerId);

  // The owner's active sprint cadence, when one exists (between-sprints teams
  // have none — the cadence form falls back to editable defaults).
  const [activeSprint] = await db
    .select({
      lengthDays: sprint.lengthDays,
      startDay: sprint.startDay,
      workingDays: sprint.workingDays,
      cadenceOverridden: sprint.cadenceOverridden,
      name: sprint.name,
    })
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.state, "ACTIVE")))
    .limit(1);

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
        sprintName: activeSprint.name,
      }
    : null;

  return (
    <SetupWizardShell
      step={3}
      // The roster grid is eight columns wide and one of them holds a
      // 43-character Jira account id — it needs the app shell's measure.
      wide
      title="Team roster & sprint cadence"
      description="Review the team we imported from GitHub and Jira, then confirm your sprint cadence. You can edit everything — SprintFlow keeps your changes."
    >
      <div className="flex flex-col gap-8">
        <RosterEditor initialMembers={initialMembers} />
        <CadenceForm initialCadence={initialCadence} />
      </div>
    </SetupWizardShell>
  );
}
