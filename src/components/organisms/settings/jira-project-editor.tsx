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
  PROJECT_SWITCH_TRIGGER_LABEL,
  projectSwitchClearLabel,
  projectSwitchDiscardedDescription,
  projectSwitchKeepLabel,
  projectSwitchWarning,
} from "@/components/organisms/settings/jira-project-editor-copy";
import type { DisconnectMode } from "@/lib/validations/disconnect";

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
 *
 * S-26 PHASE 4: the third path into the same loss stops behaving differently
 * from the other two. `absence` no longer cascades off `sprint`, so this flow
 * offers the same keep-or-clear choice the disconnect dialog does — chosen at
 * the warning step and carried through the picker and the mapper to the save.
 * The words moved to the pure sibling `jira-project-editor-copy.ts`, where they
 * can be asserted; this file keeps only the flow.
 */

type Stage =
  | { kind: "closed" }
  | { kind: "warning" }
  // `mode` is chosen at the WARNING step and carried, unchanged, all the way to
  // the save — the lead answers "what happens to my absences?" before they see
  // the picker, exactly as the dialog asks it before the disconnect runs. It
  // rides in the stage rather than in a separate `useState` so it cannot
  // outlive the flow that set it: cancelling back to `closed` discards it.
  | { kind: "project"; mode: DisconnectMode; email: string; projects: ClientProject[] }
  | {
      kind: "mapping";
      mode: DisconnectMode;
      projectId: string;
      projectKey: string;
      statuses: ClientStatus[];
    }
  // Only reached when the project actually changed and its sprints were
  // discarded. The account now has NO sprint, and nothing re-imports one on its
  // own (roadmap S-16), so closing straight back to the card would leave the
  // owner with blank dashboards and no explanation.
  | { kind: "discarded"; mode: DisconnectMode; summary: string };

export default function JiraProjectEditor({ currentProjectKey }: { currentProjectKey: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker(mode: DisconnectMode) {
    setBusy(true);
    setError(null);
    try {
      const result = await loadAvailableProjects();
      if (result.ok) {
        setStage({ kind: "project", mode, email: result.email, projects: result.projects });
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
        {PROJECT_SWITCH_TRIGGER_LABEL}
      </Button>
    );
  }

  if (stage.kind === "warning") {
    return (
      <div className="flex w-full flex-col gap-3 rounded-lg border p-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>This discards synced sprint data</AlertTitle>
          <AlertDescription>{projectSwitchWarning(currentProjectKey)}</AlertDescription>
        </Alert>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {/* TWO OUTCOMES, the same pair the disconnect dialog offers (S-26).
            The default is the non-destructive one and is NOT the destructive
            variant — until S-26 the single control here was red, which taught
            the lead that red is simply how this flow ends. The absences are
            the whole difference between them: the sprints go either way. */}
        <div className="flex gap-2">
          <Button onClick={() => openPicker("keep")} disabled={busy}>
            {busy ? "Loading projects…" : projectSwitchKeepLabel()}
          </Button>
          <Button
            variant="destructive"
            onClick={() => openPicker("clear")}
            disabled={busy}
          >
            {busy ? "Loading projects…" : projectSwitchClearLabel()}
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
      <div className="flex w-full flex-col gap-3 rounded-lg border p-4">
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>{stage.summary}</AlertTitle>
          <AlertDescription>
            {projectSwitchDiscardedDescription(stage.mode)}
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          {/* THE SEAM IS CLOSED (S-29). This used to point at `/setup/team` —
              an English Settings page landing the lead on the wizard's Polish
              "Krok 4 z 4" stepper — and the comment here said the only reason
              was that cadence had no Settings-local surface. It has one now:
              `/team/cadence`, the fourth Team tab, which reads and writes the
              same sprint row this switch just re-pointed. Nothing about the
              `onboarding-routing` F3 reasoning is reversed; its precondition
              simply stopped being true. */}
          <Button asChild>
            <Link href="/team/cadence">Review sprint cadence</Link>
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
      <div className="w-full rounded-lg border p-4">
        <JiraProjectSelector
          email={stage.email}
          projects={stage.projects}
          onContinue={async (jiraProjectId) => {
            const picked = stage.projects.find((p) => p.id === jiraProjectId);
            const result = await loadProjectStatuses(picked?.key ?? jiraProjectId);
            if (!result.ok) return { ok: false, message: result.message };
            setStage({
              kind: "mapping",
              mode: stage.mode,
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
    <div className="w-full rounded-lg border p-4">
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
            stage.mode,
          );
          if (!result.ok) return { ok: false, message: result.message };
          router.refresh();
          setStage(
            result.sprintsDiscarded
              ? { kind: "discarded", mode: stage.mode, summary: result.summary }
              : { kind: "closed" },
          );
          return { ok: true };
        }}
        onBack={() => setStage({ kind: "closed" })}
      />
    </div>
  );
}
