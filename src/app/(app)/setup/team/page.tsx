import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";

import CadenceForm from "@/components/organisms/setup/cadence-form";
import RosterEditor from "@/components/organisms/setup/roster-editor";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { sprint } from "@/db/schema";
import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";
import { listRosterForEditor } from "@/lib/roster";
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
  // CLOSED IN DEMO (S-27). The wizard configures the REAL account, so no screen
  // rendered while the lead is viewing demo may host a connect form. The five
  // `/setup` and `/settings/connections` actions behind these pages refuse
  // server-side; this redirect is what stops the form from being offered.
  // `/setup` itself is deliberately NOT guarded — its demo door is how a visitor
  // re-enters, and the banner sends the un-onboarded lead there — which is why
  // this is a per-page guard and not a `setup/layout.tsx`.
  //
  // `isDemo` is therefore always false below; it is still threaded to the child
  // rather than hard-coded, so the child keeps one contract with its
  // demo-aware siblings and the guard stays the single place demo is decided.
  const { isDemo } = await resolveWorkspace();
  if (isDemo) redirect("/setup");
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
