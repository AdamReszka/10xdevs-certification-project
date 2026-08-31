"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon, OctagonXIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { exitDemoAction } from "@/app/(app)/settings/demo/actions";
import {
  importCadenceAction,
  saveCadenceAction,
} from "@/app/(app)/setup/team/actions";
import SprintIdentityBar from "@/components/molecules/sprint-identity-bar";
import CadenceFields from "@/components/organisms/setup/cadence-fields";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JiraBoard } from "@/lib/jira";
import type { SprintIdentityView } from "@/lib/sprint-identity";
import {
  cadenceSchema,
  type CadenceValues,
  type Weekday,
} from "@/lib/validations/roster";

/**
 * Cadence form (S-04, FR-007). Pre-filled from the monitored Jira project's
 * active sprint (auto-pulled on first visit), each field overridable. A board
 * chooser appears only when the project has multiple scrum boards; a
 * no-active-sprint banner + editable defaults appears when the team is between
 * sprints. Save FINISHES the wizard → /dashboard.
 *
 * Since S-29 the three controls come from `CadenceFields`, shared with
 * `/team/cadence` so the wizard and the post-setup editor cannot drift into two
 * spellings of one cadence. Everything wizard-specific stays here: the board
 * chooser, the auto-pull effect, `exitDemoAction`, and the redirect.
 *
 * The save no longer flips `cadence_overridden` unconditionally — confirming the
 * derived values unchanged leaves the account on FR-007's auto-pull, and only a
 * real edit records an override (S-29 Phase 1).
 */

const DEFAULTS: CadenceValues = {
  lengthDays: 14,
  startDay: "MON",
  workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
};

type InitialCadence = {
  lengthDays: number;
  startDay: Weekday;
  workingDays: Weekday[];
  /** Already formatted server-side — this component does no `Intl` work. */
  sprintIdentity: SprintIdentityView;
};

export default function CadenceForm({
  initialCadence,
  inDemo = false,
}: {
  initialCadence: InitialCadence | null;
  /**
   * Whether the lead reached this step while the account is still in demo —
   * they can, via the demo banner's "Dokończ konfigurację" link
   * (`onboarding-routing` Phase 4). Passed in rather than resolved here so the
   * ordinary real-account finish pays no extra action round-trip.
   */
  inDemo?: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [noActiveSprint, setNoActiveSprint] = useState(false);
  // Seeded from the server render so the sprint is named at first paint, and
  // replaced by whatever a "Pull from Jira" comes back with.
  const [sprintIdentity, setSprintIdentity] = useState<SprintIdentityView>(
    initialCadence?.sprintIdentity ?? { kind: "none" },
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
      setSprintIdentity(result.sprintIdentity);
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
      // Finishing the wizard from inside demo must land on the REAL dashboard
      // just configured — otherwise the gate short-circuits on `isDemo` and
      // returns the lead to fictional data with no sign the setup worked. The
      // demo world is KEPT (exitDemoAction only flips `active_workspace`), so
      // it can be re-entered from Settings.
      if (inDemo) {
        // Not fire-and-forget: `exitDemoAction` reports a DB failure by RETURNING
        // `{ok:false}` rather than throwing, so the catch below would never see
        // it and the push would land the lead back under the demo banner — the
        // one outcome this call exists to prevent (impl-review F5).
        const exited = await exitDemoAction();
        if (!exited.ok) {
          setFormError(exited.message);
          return;
        }
      }
      router.push("/dashboard");
    } catch {
      setFormError(
        "Something went wrong saving your cadence. Please try again.",
      );
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            {/* The identity is its OWN element beside the title, not a clause in
                the middle of the description below (S-25). The same component
                the two dashboards use, so the lead meets one shape rather than
                three that nearly agree — which is what this screen, Today and
                Sprint Detail used to be. */}
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>Sprint cadence</CardTitle>
              <SprintIdentityBar view={sprintIdentity} />
            </div>
            <CardDescription>
              {/* It used to say all three values were "pulled from your active
                  sprint". That was false for working days — Jira has no such
                  field (`cadence.ts`) — so the provenance now lives per field on
                  `/team/cadence`, and this line only frames the step. */}
              {sprintIdentity.kind === "identified"
                ? "Sprint length and start day come from your active sprint; working days are our Mon–Fri default. Change anything that doesn’t match your real cadence."
                : "Confirm your sprint cadence. You can change it later under Team → Sprint cadence."}
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
                  filled in sensible defaults. SprintFlow will re-derive the
                  real cadence automatically when your next sprint starts.
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
                      value={
                        field.value != null ? String(field.value) : undefined
                      }
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

            <CadenceFields control={form.control} />
          </CardContent>

          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || isPulling}
            >
              {form.formState.isSubmitting
                ? "Finishing…"
                : "Save & finish setup"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
