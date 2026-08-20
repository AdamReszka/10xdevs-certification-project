"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon, OctagonXIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { importCadenceAction, saveCadenceAction } from "@/app/(app)/setup/team/actions";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JiraBoard } from "@/lib/jira";
import { cadenceSchema, type CadenceValues, type Weekday } from "@/lib/validations/roster";

/**
 * Cadence form (S-04, FR-007). Pre-filled from the monitored Jira project's
 * active sprint (auto-pulled on first visit), each field overridable. A board
 * chooser appears only when the project has multiple scrum boards; a
 * no-active-sprint banner + editable defaults appears when the team is between
 * sprints. Save flips `cadence_overridden` and FINISHES the wizard → /dashboard.
 */

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

const DEFAULTS: CadenceValues = {
  lengthDays: 14,
  startDay: "MON",
  workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
};

type InitialCadence = {
  lengthDays: number;
  startDay: Weekday;
  workingDays: Weekday[];
  cadenceOverridden: boolean;
  sprintName: string | null;
};

export default function CadenceForm({
  initialCadence,
}: {
  initialCadence: InitialCadence | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [noActiveSprint, setNoActiveSprint] = useState(false);
  const [sprintName, setSprintName] = useState<string | null>(
    initialCadence?.sprintName ?? null,
  );
  const [boardCandidates, setBoardCandidates] = useState<JiraBoard[]>([]);

  const form = useForm<CadenceValues>({
    resolver: zodResolver(cadenceSchema),
    defaultValues: initialCadence
      ? {
          lengthDays: initialCadence.lengthDays,
          startDay: initialCadence.startDay,
          workingDays: initialCadence.workingDays,
        }
      : DEFAULTS,
  });

  async function pull(chosenBoardId?: number) {
    setFormError(null);
    setIsPulling(true);
    try {
      const result = await importCadenceAction(chosenBoardId);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setNoActiveSprint(result.noActiveSprint);
      setSprintName(result.sprintName);
      setBoardCandidates(result.boardCandidates);
      form.reset({
        lengthDays: result.cadence.lengthDays,
        startDay: result.cadence.startDay as Weekday,
        workingDays: result.cadence.workingDays as Weekday[],
        boardId: result.boardId ?? undefined,
      });
    } catch {
      setFormError("Something went wrong reaching Jira. Please try again.");
    } finally {
      setIsPulling(false);
    }
  }

  // Auto-pull once on first visit (no saved cadence yet).
  const didAutoPull = useRef(false);
  useEffect(() => {
    if (!didAutoPull.current && !initialCadence) {
      didAutoPull.current = true;
      void pull();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFinish = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      // A no-op server-side when there's no active sprint; still finishes.
      const result = await saveCadenceAction(values);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      router.push("/dashboard");
    } catch {
      setFormError("Something went wrong saving your cadence. Please try again.");
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Sprint cadence</CardTitle>
            <CardDescription>
              {sprintName
                ? `Pulled from your active sprint “${sprintName}”. Override anything that doesn’t match your real cadence.`
                : "Confirm your sprint cadence. SprintFlow keeps your overrides across future syncs."}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => pull()}
            disabled={isPulling}
            className="shrink-0"
          >
            <RefreshCwIcon className={isPulling ? "animate-spin" : undefined} />
            {isPulling ? "Pulling…" : "Pull from Jira"}
          </Button>
        </div>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={onFinish} className="flex flex-col gap-6">
          <CardContent className="flex flex-col gap-5">
            {formError ? (
              <Alert variant="destructive">
                <OctagonXIcon />
                <AlertTitle>Couldn&apos;t save your cadence</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            {noActiveSprint ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>No active sprint</AlertTitle>
                <AlertDescription>
                  Your Jira board has no active sprint right now, so we&apos;ve
                  filled in sensible defaults. SprintFlow will re-derive the real
                  cadence automatically when your next sprint starts.
                </AlertDescription>
              </Alert>
            ) : null}

            {boardCandidates.length > 1 ? (
              <FormField
                control={form.control}
                name="boardId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scrum board</FormLabel>
                    <Select
                      value={field.value != null ? String(field.value) : undefined}
                      onValueChange={(v) => {
                        const id = Number(v);
                        field.onChange(id);
                        void pull(id);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose which board drives the sprint" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {boardCandidates.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="lengthDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sprint length (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="startDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sprint start day</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {WEEKDAYS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Controller
              control={form.control}
              name="workingDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Working days</FormLabel>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((d) => {
                      const checked = field.value?.includes(d.value) ?? false;
                      return (
                        <Label
                          key={d.value}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 font-normal"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              const set = new Set(field.value ?? []);
                              if (c) set.add(d.value);
                              else set.delete(d.value);
                              // Preserve Mon→Sun order.
                              field.onChange(
                                WEEKDAYS.filter((w) => set.has(w.value)).map(
                                  (w) => w.value,
                                ),
                              );
                            }}
                            aria-label={d.label}
                          />
                          {d.label}
                        </Label>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting || isPulling}>
              {form.formState.isSubmitting ? "Finishing…" : "Save & finish setup"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
