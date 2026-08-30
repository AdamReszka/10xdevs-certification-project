"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import JiraProjectSelector from "@/components/organisms/setup/jira-project-selector";
import JiraStatusMapper from "@/components/organisms/setup/jira-status-mapper";
import {
  loadAvailableProjects,
  loadProjectStatuses,
  updateJiraProject,
  type ClientProject,
  type ClientStatus,
} from "@/app/(app)/settings/connections/actions";
import {
  DISCONNECT_IMPACT,
  joinClauses,
} from "@/lib/integrations/disconnect-impact";

/**
 * Change the monitored Jira project without re-entering the API token
 * (S-10 Phase 8). Reuses the wizard's project selector and status mapper.
 *
 * DESTRUCTIVE, so it opens with a confirmation rather than the picker — and the
 * owner has to know what goes before the picker appears, not after they have
 * chosen. A confirmation that undersells what it deletes is the defect.
 *
 * CORRECTED IN S-24. This docstring used to say `daily_recap` cascades off
 * `sprint` and omitted both `absence` and `anomaly`. `daily_recap.sprint_id` is
 * ON DELETE **SET NULL** (`schema.ts:1037-1039`) — the recaps SURVIVE, unlinked
 * — while `absence` cascades and is the lead's hand-entered FR-010 data that no
 * sync rebuilds. Its author reasoned explicitly about cascades and still got it
 * wrong in both directions, which is why the copy below is no longer written by
 * hand: it is built from `DISCONNECT_IMPACT.projectSwitch`, a declaration a
 * hermetic test holds equal to the schema's foreign-key graph.
 *
 * NOTE the entry is rooted at `sprint`, NOT at `jira_credential`. A project
 * switch UPDATES the `jira_project` row in place and REPLACES the status
 * mappings from the form (`connection-service.ts`), so neither is destroyed and
 * the token and workspace are untouched — a subtraction from the Jira disconnect
 * entry would have wrongly listed both.
 */

/** The blast radius of a PROJECT SWITCH, not of a disconnect — see the note in
 *  the docstring above. */
const PROJECT_SWITCH = DISCONNECT_IMPACT.projectSwitch;

type Stage =
  | { kind: "closed" }
  | { kind: "warning" }
  | { kind: "project"; email: string; projects: ClientProject[] }
  | { kind: "mapping"; projectId: string; projectKey: string; statuses: ClientStatus[] }
  // Only reached when the project actually changed and its sprints were
  // discarded. The account now has NO sprint, and nothing re-imports one on its
  // own (roadmap S-16), so closing straight back to the card would leave the
  // owner with blank dashboards and no explanation.
  | { kind: "discarded"; summary: string };

export default function JiraProjectEditor({ currentProjectKey }: { currentProjectKey: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setBusy(true);
    setError(null);
    try {
      const result = await loadAvailableProjects();
      if (result.ok) {
        setStage({ kind: "project", email: result.email, projects: result.projects });
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === "closed") {
    return (
      <Button variant="outline" onClick={() => setStage({ kind: "warning" })}>
        Change monitored project
      </Button>
    );
  }

  if (stage.kind === "warning") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>This discards synced sprint data</AlertTitle>
          <AlertDescription>
            Pointing the account at
            {currentProjectKey ? ` a project other than ${currentProjectKey}` : " a different project"}{" "}
            deletes {joinClauses(PROJECT_SWITCH.destroys)}. It keeps{" "}
            {joinClauses(PROJECT_SWITCH.keeps)}. Re-syncing rebuilds only what
            the new project&apos;s Jira history contains.
          </AlertDescription>
        </Alert>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button variant="destructive" onClick={openPicker} disabled={busy}>
            {busy ? "Loading projects…" : "I understand — choose a project"}
          </Button>
          <Button variant="ghost" onClick={() => setStage({ kind: "closed" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "discarded") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>{stage.summary}</AlertTitle>
          <AlertDescription>
            As warned, this discarded {joinClauses(PROJECT_SWITCH.destroys)}.
            Your past daily recaps were kept, but are no longer linked to a
            sprint. Nothing has imported a sprint for the new project yet, so
            both dashboards will stay empty until you re-run the cadence import.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          {/* THE ONE LINK FROM SETTINGS INTO THE WIZARD, and it is accepted
              rather than fixed (`onboarding-routing` plan review F3). It lands
              an English Settings page on the wizard's Polish "Krok 4 z 4"
              stepper — a real seam, named here so the next reader does not
              re-open it. Two reasons it stays: cadence import genuinely lives
              on `/setup/team` and has no Settings-local surface, and this
              button fires only after a Jira PROJECT SWITCH — a
              re-configuration, not the token rotation the "never ejected from
              Settings" rule protects. That rule is about the GATE anyway:
              nothing redirects the lead here, they click. A Settings-local
              cadence surface is a separate slice. */}
          <Button asChild>
            <Link href="/setup/team">Import sprint cadence</Link>
          </Button>
          <Button variant="ghost" onClick={() => setStage({ kind: "closed" })}>
            Later
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "project") {
    return (
      <div className="rounded-lg border p-4">
        <JiraProjectSelector
          email={stage.email}
          projects={stage.projects}
          onContinue={async (jiraProjectId) => {
            const picked = stage.projects.find((p) => p.id === jiraProjectId);
            const result = await loadProjectStatuses(picked?.key ?? jiraProjectId);
            if (!result.ok) return { ok: false, message: result.message };
            setStage({
              kind: "mapping",
              projectId: jiraProjectId,
              projectKey: picked?.key ?? jiraProjectId,
              statuses: result.statuses,
            });
            return { ok: true };
          }}
          onBack={() => setStage({ kind: "closed" })}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <JiraStatusMapper
        projectKey={stage.projectKey}
        statuses={stage.statuses}
        onSave={async (mappings) => {
          const result = await updateJiraProject(
            stage.projectId,
            mappings.map((m) => ({
              jiraStatusId: m.jiraStatusId,
              jiraStatusName: m.jiraStatusName,
              category: m.category,
            })),
          );
          if (!result.ok) return { ok: false, message: result.message };
          router.refresh();
          setStage(
            result.sprintsDiscarded
              ? { kind: "discarded", summary: result.summary }
              : { kind: "closed" },
          );
          return { ok: true };
        }}
        onBack={() => setStage({ kind: "closed" })}
      />
    </div>
  );
}
