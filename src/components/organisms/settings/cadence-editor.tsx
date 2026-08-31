"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, InfoIcon, OctagonXIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  restoreCadenceAction,
  saveCadenceAction,
} from "@/app/(app)/setup/team/actions";
import SprintIdentityBar from "@/components/molecules/sprint-identity-bar";
import ConfirmDialog from "@/components/molecules/confirm-dialog";
import CadenceFields from "@/components/organisms/setup/cadence-fields";
import {
  anyHandSet,
  cadenceEditorState,
  restoreOutcome,
  saveButtonLabel,
  type RestoreOutcome,
} from "@/components/organisms/settings/cadence-editor-view";
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
import { Form } from "@/components/ui/form";
import type { CadenceProvenance } from "@/lib/cadence-override";
import type { SprintIdentityView } from "@/lib/sprint-identity";
import {
  cadenceSchema,
  type CadenceValues,
  type Weekday,
} from "@/lib/validations/roster";

/**
 * `/team/cadence` — the post-setup counterpart to the wizard's `CadenceForm`
 * (S-29, FR-007).
 *
 * WHY IT IS A SECOND COMPONENT rather than a flag on the first. Same three
 * fields, different job: this one saves and STAYS. It finishes no wizard, calls
 * no `exitDemoAction`, and never `router.push`es — the lead came here to change
 * one number and expects to still be looking at it afterwards. Sharing the
 * fields (`CadenceFields`) is what keeps the two from drifting; sharing the
 * whole component would have meant a `mode` prop threaded through a redirect, a
 * board chooser and an auto-pull effect that only one caller wants.
 *
 * FR-007 promised the lead could override the cadence, and until this screen
 * existed that promise was met only inside the setup wizard — which an onboarded
 * lead has no route back to. Every banner and every outcome message it renders
 * comes from `cadence-editor-view.ts`, because there is no component-test
 * harness here and copy assembled in a `.tsx` is copy nothing can assert.
 */
export type InitialCadence = {
  lengthDays: number;
  startDay: Weekday;
  workingDays: Weekday[];
  /** `sprint.state` of the row this screen writes to. */
  sprintState: string | null;
  /** Already formatted server-side — this component does no `Intl` work. */
  sprintIdentity: SprintIdentityView;
};

const DEFAULTS: CadenceValues = {
  lengthDays: 14,
  startDay: "MON",
  workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
};

export default function CadenceEditor({
  initialCadence,
  provenance: initialProvenance,
}: {
  /** `null` when the account has no `sprint` row at all — the `no_sprint` state. */
  initialCadence: InitialCadence | null;
  /**
   * PER FIELD since S-30, and a SIBLING of `initialCadence` rather than a member
   * of it: the override record outlives every `sprint` row, so the `no_sprint`
   * state has provenance to report precisely when there is no cadence to show.
   */
  provenance: CadenceProvenance;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CadenceProvenance | null>(null);
  const [restored, setRestored] = useState<RestoreOutcome | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // Seeded from the server render, then replaced by whatever a save or a restore
  // returns.
  const [provenance, setProvenance] = useState<CadenceProvenance>(
    initialProvenance,
  );
  const [sprintIdentity, setSprintIdentity] = useState<SprintIdentityView>(
    initialCadence?.sprintIdentity ?? { kind: "none" },
  );

  const state = cadenceEditorState({
    hasSprintRow: initialCadence != null,
    sprintState: initialCadence?.sprintState ?? null,
    provenance,
  });

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

  const onSave = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(null);
    setRestored(null);
    try {
      const result = await saveCadenceAction(values);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      // SET, NOT MERGED (S-30). This used to be a sticky OR — `result.overridden
      // || overridden` — because the old dirty-check compared the submission
      // against the STORED row, so an unchanged save scored `false` even on an
      // overridden account and would have un-overridden it. Compared against the
      // SOURCE for each field, an unchanged save on an overridden account now
      // scores `true` on its own, and every save writes all three fields
      // authoritatively. Keeping the OR would make handing a field back
      // impossible: a lead saving Mon–Fri over their own Mon–Thu writes a
      // source-equal NULL, and a sticky merge would go on claiming it was
      // hand-set — the silent revert this slice exists to end.
      setProvenance(result.provenance);
      setSaved(result.provenance);
    } catch {
      setFormError("Something went wrong saving your cadence. Please try again.");
    }
  });

  async function onRestore() {
    setFormError(null);
    setSaved(null);
    setRestored(null);
    setIsRestoring(true);
    try {
      const result = await restoreCadenceAction();
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      // `jiraSprintId`, not `noActiveSprint`: a multi-board project with no
      // board chosen comes back `noActiveSprint: false` carrying DEFAULT_CADENCE
      // and having written nothing, and this screen must not report that as a
      // pull. A null sprint id is the one signal that means "no row was touched"
      // across every degraded branch.
      const pulled = result.jiraSprintId != null;
      setRestored(restoreOutcome({ pulled }));
      // NOTHING was written when Jira had no sprint to derive from, so the form
      // keeps what it has and the override still stands. Resetting the fields to
      // the returned defaults here would show the lead a cadence the database
      // does not hold (plan-review F5).
      if (pulled) {
        // The restore returns the RESOLVED cadence, so the working days it
        // preserved come back marked as still hand-set. Writing `false` across
        // the board here would contradict the dialog's own promise one line of
        // state later.
        setProvenance(result.cadence.provenance);
        setSprintIdentity(result.sprintIdentity);
        form.reset({
          lengthDays: result.cadence.lengthDays,
          startDay: result.cadence.startDay as Weekday,
          workingDays: result.cadence.workingDays as Weekday[],
        });
      }
    } catch {
      setFormError("Something went wrong reaching Jira. Please try again.");
    } finally {
      setIsRestoring(false);
      setRestoreOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Sprint cadence</CardTitle>
          <SprintIdentityBar view={sprintIdentity} />
        </div>
        <CardDescription>
          How long a sprint runs, which day it starts, and which days your team
          works. Change any of it here — you do not need to go back through
          setup.
        </CardDescription>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={onSave} className="flex flex-col gap-6">
          <CardContent className="flex flex-col gap-5">
            <Alert variant={state.kind === "no_sprint" ? "destructive" : "default"}>
              {state.kind === "no_sprint" ? <OctagonXIcon /> : <InfoIcon />}
              <AlertTitle>{state.title}</AlertTitle>
              <AlertDescription>{state.body}</AlertDescription>
            </Alert>

            {formError ? (
              <Alert variant="destructive">
                <OctagonXIcon />
                <AlertTitle>Couldn&apos;t save your cadence</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            {saved ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Cadence saved</AlertTitle>
                <AlertDescription>
                  {/* THREE sentences since S-30, because there are now three
                      outcomes. The middle one is the state this slice exists to
                      create, and the single boolean this used to read could not
                      describe it. */}
                  {!anyHandSet(saved)
                    ? "Nothing changed, so this account keeps following Jira."
                    : saved.workingDays && !saved.lengthDays && !saved.startDay
                      ? "SprintFlow will keep your working days, and the sprint length and start day still come from Jira."
                      : "SprintFlow will keep these values and stop taking the sprint length and start day from Jira."}
                </AlertDescription>
              </Alert>
            ) : null}

            {restored ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>{restored.title}</AlertTitle>
                <AlertDescription>{restored.body}</AlertDescription>
              </Alert>
            ) : null}

            <CadenceFields control={form.control} provenance />
          </CardContent>

          <CardFooter className="flex flex-wrap justify-end gap-2">
            <ConfirmDialog
              open={restoreOpen}
              onOpenChange={setRestoreOpen}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  // Nothing to restore onto, and nothing to restore FROM.
                  disabled={initialCadence == null || isRestoring}
                >
                  <RotateCcwIcon />
                  {isRestoring ? "Restoring…" : "Restore Jira’s values"}
                </Button>
              }
              title="Restore Jira’s values?"
              description="Sprint length and start day go back to what your active sprint says, and SprintFlow keeps them up to date on every sync from now on. Anything you set by hand is replaced. Working days are not pulled from Jira and stay as they are."
              confirmLabel="Restore from Jira"
              onConfirm={onRestore}
            />
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || isRestoring}
            >
              {saveButtonLabel(form.formState.isSubmitting)}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
