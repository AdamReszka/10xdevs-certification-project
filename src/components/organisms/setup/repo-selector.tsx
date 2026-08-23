"use client";

import { OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import type { ClientRepo } from "@/app/(app)/setup/github/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { reposBeingDropped } from "@/components/organisms/setup/repo-selection";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Repository picker (S-02). Checkbox list inside a scroll-area; an inline,
 * NON-blocking warning when the PAT looks fine-grained or lacks the `repo` scope
 * (the user can still proceed with public repos). Save failures surface as a
 * persistent inline Alert. Client-only — talks to the store action via `onSave`.
 */
export default function RepoSelector({
  login,
  repos,
  likelyFineGrained,
  hasRepoScope,
  monitoredRepoIds = [],
  onSave,
  onBack,
}: {
  login: string;
  repos: ClientRepo[];
  likelyFineGrained: boolean;
  hasRepoScope: boolean;
  /**
   * What the owner already monitors. Empty during first-time setup; supplied by
   * the Settings editor, where a save REPLACES the selection — opening unchecked
   * there made "add a repo" delete the ones already being kept.
   */
  monitoredRepoIds?: string[];
  onSave: (
    selectedRepoIds: string[],
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onBack: () => void;
}) {
  // Lazy init: this component mounts once its data has loaded, so the current
  // selection is known on first render and never needs syncing afterwards.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(monitoredRepoIds),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showScopeWarning = likelyFineGrained || !hasRepoScope;
  const dropped = reposBeingDropped({
    repos,
    monitoredIds: monitoredRepoIds,
    selectedIds: selected,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) {
      setError("Select at least one repository to monitor.");
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      const result = await onSave([...selected]);
      if (!result.ok) {
        setError(result.message);
      }
      // On success the parent triggers a server refresh that swaps this view
      // out for the connected-status card, so no success state is needed here.
    } catch {
      setError("Something went wrong while saving. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose repositories to monitor</CardTitle>
        <CardDescription>
          Connected as <span className="font-medium text-foreground">{login}</span>.
          Pick the repositories for this team.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showScopeWarning ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Limited access detected</AlertTitle>
            <AlertDescription>
              {likelyFineGrained
                ? "This looks like a fine-grained token. SprintFlow is built for classic tokens; some repositories or activity may not be visible."
                : "This token is missing the `repo` scope, so private repositories may not appear. You can still monitor public repositories."}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Couldn&apos;t save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {dropped.length > 0 ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>
              Saving now discards synced history for{" "}
              {dropped.length === 1 ? "1 repository" : `${dropped.length} repositories`}
            </AlertTitle>
            <AlertDescription>
              {dropped.join(", ")} {dropped.length === 1 ? "is" : "are"} monitored
              today but unchecked here. Saving deletes their commits, pull requests
              and reviews. Re-selecting later does not bring that history back — a
              later sync only fetches activity newer than the last successful one.
            </AlertDescription>
          </Alert>
        ) : null}

        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories were returned for this token.
          </p>
        ) : (
          <ScrollArea className="h-72 rounded-md border">
            <ul className="flex flex-col divide-y">
              {repos.map((repo) => (
                <li key={repo.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    id={`repo-${repo.id}`}
                    aria-label={repo.fullName}
                    checked={selected.has(repo.id)}
                    onCheckedChange={() => toggle(repo.id)}
                  />
                  <Label
                    htmlFor={`repo-${repo.id}`}
                    className="cursor-pointer font-normal"
                  >
                    {repo.fullName}
                  </Label>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isSaving}
        >
          Back
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving
            ? "Saving…"
            : `Save${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </Button>
      </CardFooter>
    </Card>
  );
}
