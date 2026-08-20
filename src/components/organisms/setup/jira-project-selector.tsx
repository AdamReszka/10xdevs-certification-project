"use client";

import { OctagonXIcon } from "lucide-react";
import { useState } from "react";

import type { ClientProject } from "@/app/(app)/setup/jira/actions";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Jira project picker (S-03). Single-select radio list inside a scroll-area
 * (FR-004: exactly one project). Mirrors `repo-selector.tsx` but single-select.
 * `onContinue` fetches the project's statuses; failures surface as a persistent
 * inline Alert.
 */
export default function JiraProjectSelector({
  email,
  projects,
  onContinue,
  onBack,
}: {
  email: string;
  projects: ClientProject[];
  onContinue: (
    jiraProjectId: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (selected === null) {
      setError("Select a project to monitor.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const result = await onContinue(selected);
      if (!result.ok) setError(result.message);
      // On success the parent advances to the status-mapping stage.
    } catch {
      setError("Something went wrong reaching Jira. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a project to monitor</CardTitle>
        <CardDescription>
          Connected as <span className="font-medium text-foreground">{email}</span>.
          SprintFlow monitors a single Jira project.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Couldn&apos;t continue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects were returned for these credentials.
          </p>
        ) : (
          <ScrollArea className="h-72 rounded-md border">
            <ul className="flex flex-col divide-y">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="radio"
                    id={`project-${project.id}`}
                    name="jira-project"
                    className="size-4 accent-primary"
                    aria-label={`${project.key} — ${project.name}`}
                    checked={selected === project.id}
                    onChange={() => setSelected(project.id)}
                  />
                  <Label
                    htmlFor={`project-${project.id}`}
                    className="cursor-pointer font-normal"
                  >
                    <span className="font-medium">{project.key}</span> — {project.name}
                  </Label>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} disabled={isLoading}>
          Back
        </Button>
        <Button
          type="button"
          onClick={handleContinue}
          disabled={isLoading || selected === null}
        >
          {isLoading ? "Loading statuses…" : "Continue"}
        </Button>
      </CardFooter>
    </Card>
  );
}
