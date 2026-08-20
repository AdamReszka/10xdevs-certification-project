"use client";

import { OctagonXIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  ClientStatus,
  StatusMappingInput,
} from "@/app/(app)/setup/jira/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StatusCategory } from "@/lib/jira";

/**
 * Status mapper (S-03, FR-005) — the net-new surface. Maps every distinct project
 * status onto one of the 5 fixed categories via a Select per status, pre-filled
 * with the editable auto-suggestion. Save is disabled until every status has a
 * category (completeness rule); since each Select seeds from the suggestion, the
 * gate holds by default and only trips if a status is somehow unset.
 */

const CATEGORIES: { value: StatusCategory; label: string }[] = [
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "CODE_REVIEW", label: "Code Review" },
  { value: "TESTING", label: "Testing" },
  { value: "DONE", label: "Done" },
];

export default function JiraStatusMapper({
  projectKey,
  statuses,
  recoveryNote,
  onSave,
  onBack,
}: {
  projectKey: string;
  statuses: ClientStatus[];
  /** Set when re-entering after a save-time `incomplete_mapping` (F4). */
  recoveryNote?: string | null;
  onSave: (
    mappings: StatusMappingInput[],
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onBack: () => void;
}) {
  // Seed each status with its suggested category (editable). Keyed by status id.
  const [choices, setChoices] = useState<Record<string, StatusCategory>>(() =>
    Object.fromEntries(statuses.map((s) => [s.id, s.suggestedCategory])),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = useMemo(
    () => statuses.filter((s) => !choices[s.id]).length,
    [statuses, choices],
  );

  async function handleSave() {
    if (remaining > 0) {
      setError("Map every status to a category before saving.");
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      const mappings: StatusMappingInput[] = statuses.map((s) => ({
        jiraStatusId: s.id,
        jiraStatusName: s.name,
        category: choices[s.id],
      }));
      const result = await onSave(mappings);
      if (!result.ok) setError(result.message);
      // On success the parent triggers a server refresh that swaps this view out.
    } catch {
      setError("Something went wrong while saving. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map workflow statuses</CardTitle>
        <CardDescription>
          Match each status in{" "}
          <span className="font-medium text-foreground">{projectKey}</span> to one
          of SprintFlow&apos;s five categories. We&apos;ve suggested a mapping — adjust
          any that look wrong.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recoveryNote ? (
          <Alert>
            <OctagonXIcon />
            <AlertTitle>Statuses changed</AlertTitle>
            <AlertDescription>{recoveryNote}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Couldn&apos;t save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {statuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No statuses were returned for this project.
          </p>
        ) : (
          <ScrollArea className="h-80 rounded-md border">
            <ul className="flex flex-col divide-y">
              {statuses.map((status) => (
                <li
                  key={status.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <Label
                    htmlFor={`status-${status.id}`}
                    className="font-normal text-foreground"
                  >
                    {status.name}
                  </Label>
                  <Select
                    value={choices[status.id]}
                    onValueChange={(value) =>
                      setChoices((prev) => ({
                        ...prev,
                        [status.id]: value as StatusCategory,
                      }))
                    }
                  >
                    <SelectTrigger id={`status-${status.id}`} className="w-40">
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} disabled={isSaving}>
          Back
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || remaining > 0 || statuses.length === 0}
        >
          {isSaving
            ? "Saving…"
            : remaining > 0
              ? `${remaining} status${remaining === 1 ? "" : "es"} left to map`
              : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
