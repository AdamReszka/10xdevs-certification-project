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

/**
 * Change the monitored Jira project without re-entering the API token
 * (S-10 Phase 8). Reuses the wizard's project selector and status mapper.
 *
 * DESTRUCTIVE, so it opens with a confirmation rather than the picker. `sprint`
 * hangs off `jira_project`, and `jira_ticket` + `jira_status_history` hang off
 * `sprint`, all cascading — switching projects discards the account's synced
 * sprint history, and the owner has to know that before the picker appears, not
 * after they have chosen.
 */

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
            Pointing the account at a different project deletes the sprints,
            tickets, and status history synced from
            {currentProjectKey ? ` ${currentProjectKey}` : " the current project"}.
            Anomalies detected from that data go with it. Re-syncing rebuilds
            only what the new project&apos;s Jira history contains.
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
            The previous project&apos;s sprints, tickets and status history were
            discarded, as warned. Nothing has imported a sprint for the new
            project yet, so both dashboards will stay empty until you re-run the
            cadence import.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
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
