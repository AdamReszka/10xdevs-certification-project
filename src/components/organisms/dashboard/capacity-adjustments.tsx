"use client";

import { OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  setCapacityOverrideAction,
  setDeliveredCorrectionAction,
} from "@/app/(app)/dashboard/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The lead's two manual entries on the active sprint (S-23 Phase 5,
 * FR-022/FR-023): a capacity override in man-days, and a correction to the
 * delivered story points.
 *
 * ON THE AVAILABILITY TAB, beneath the capacity headline it replaces. The
 * override belongs where the number it overrides is shown — putting it in
 * `/settings` would ask the lead to hold two screens in their head to check
 * their own entry.
 *
 * IT IS A MARKED EXCEPTION, not a preference (FR-022). An overridden figure
 * feeds FR-024's normalisation, so a careless entry skews every later average;
 * the badge and the computed value beneath it — rendered by the headline in
 * `availability.tsx` — are what keep that visible rather than silent. The copy
 * here says so plainly for the same reason.
 *
 * Rendering and wiring only; the "which number is the headline" decision lives
 * in the pure `capacity-adjustments-view.ts` sibling, because this project has
 * no component-test harness.
 *
 * After a successful action: `router.refresh()`. There is no `revalidatePath`
 * anywhere in `src/`, and the page is `force-dynamic`.
 */
export default function CapacityAdjustments({
  jiraSprintId,
  computedMd,
  overrideMd,
  computedSp,
  correctedSp,
  canCorrectDelivered,
}: {
  /**
   * The sprint on screen. Carried into the payload rather than left to the action
   * to re-resolve, so a rollover while the tab sat open cannot move the entry to
   * a sprint the lead never looked at (impl-review F2).
   */
  jiraSprintId: string;
  /** What the model computed for this sprint — the input's placeholder. */
  computedMd: number;
  overrideMd: number | null;
  /** The measured delivered SP, or `null` when the sweep has recorded none yet. */
  computedSp: number | null;
  correctedSp: number | null;
  /**
   * Only a CLOSED sprint's delivered figure is worth correcting (FR-023,
   * impl-review F3). While the sprint runs, the sweep is still recomputing the
   * measurement every cycle, so a correction entered now would be a guess that
   * the disjoint writers then preserve — straight into FR-024's average.
   */
  canCorrectDelivered: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-dashed p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Adjust this sprint by hand</h3>
        <p className="text-sm text-muted-foreground">
          For what the model cannot express — a training week, an outage, half the
          team at a conference. An adjusted sprint is marked as adjusted, and the
          computed figure stays on screen beside it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdjustmentField
          id="capacity-override"
          label="Capacity override (MD)"
          help="Empty means the computed capacity is used."
          placeholder={formatNumber(computedMd)}
          current={overrideMd}
          // Two decimals, matching `capacityOverrideMdSchema` (impl-review F4).
          // The form has no `noValidate`, so native constraint validation runs
          // BEFORE `onSubmit`: a coarser step made 12.25 MD — what 0.75 FTE over
          // 11 working days computes to — a `stepMismatch` the browser refused
          // outright, for a value the server schema explicitly accepts.
          step="0.01"
          parse={(raw) => {
            const value = Number(raw);
            return Number.isFinite(value) ? value : null;
          }}
          save={(value) => setCapacityOverrideAction({ jiraSprintId, md: value })}
          savedMessage="Capacity override saved."
          clearedMessage="Capacity override cleared."
        />

        {canCorrectDelivered ? (
          <AdjustmentField
            id="delivered-correction"
            label="Delivered story points"
            help="Empty means the measured figure is used."
            placeholder={
              computedSp === null ? "Not measured yet" : String(computedSp)
            }
            current={correctedSp}
            step="1"
            parse={(raw) => {
              const value = Number(raw);
              return Number.isInteger(value) ? value : null;
            }}
            save={(value) =>
              setDeliveredCorrectionAction({ jiraSprintId, sp: value })
            }
            savedMessage="Delivered story points corrected."
            clearedMessage="Correction cleared."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Delivered story points</p>
            <p className="text-xs text-muted-foreground">
              Correctable once this sprint closes and its measurement is recorded
              — while it is still running, the figure is recomputed every sync.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One number input plus its save / reset pair.
 *
 * CLEARING IS ITS OWN ACTION, performed only by "Reset to computed". `null` is
 * still the only way back to the computed value, and `0` is still a legitimate
 * capacity (a sprint the whole team is off), so those two cannot be collapsed —
 * but an empty INPUT is not evidence the lead meant either one. The browser
 * blanks the field for any entry it cannot parse, so submitting empty as `null`
 * would make a mistyped character indistinguishable from a deliberate clear.
 */
function AdjustmentField({
  id,
  label,
  help,
  placeholder,
  current,
  step,
  parse,
  save,
  savedMessage,
  clearedMessage,
}: {
  id: string;
  label: string;
  help: string;
  placeholder: string;
  current: number | null;
  step: string;
  parse: (raw: string) => number | null;
  save: (value: number | null) => Promise<{ ok: boolean; message?: string }>;
  savedMessage: string;
  clearedMessage: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(next: number | null, message: string) {
    setError(null);
    setIsSaving(true);
    const result = await save(next);
    setIsSaving(false);

    if (!result.ok) {
      setError(result.message ?? "Something went wrong. Please try again.");
      return;
    }
    toast.success(message);
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = value.trim();
    // AN EMPTY FIELD IS NEVER A SAVE (impl-review F1). `input[type=number]`
    // sanitizes anything it cannot parse to `""` — a comma decimal separator, a
    // stray letter — so "empty means clear it" would turn a typo into a silent
    // delete reported as a success. Clearing has its own control, and that
    // control only exists when there is something to clear.
    if (trimmed === "") {
      setError(emptyFieldMessage(current));
      return;
    }

    const parsed = parse(trimmed);
    if (parsed === null) {
      setError(emptyFieldMessage(current));
      return;
    }
    await submit(parsed, savedMessage);
  }

  async function onReset() {
    setValue("");
    await submit(null, clearedMessage);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        disabled={isSaving}
      />
      <p className="text-xs text-muted-foreground">{help}</p>

      {error ? (
        <Alert variant="destructive">
          <OctagonXIcon />
          <AlertTitle>Couldn&apos;t save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        {current !== null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={isSaving}
          >
            Reset to computed
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * What to say when the field is blank on Save. Names the control that actually
 * clears, rather than telling the lead to do the thing that no longer works.
 */
function emptyFieldMessage(current: number | null): string {
  return current === null
    ? "Enter a number. An empty field already uses the computed value."
    : "Enter a number, or use \u201CReset to computed\u201D to clear it.";
}

/** `120` not `120.0`, `7.5` kept — the placeholder must read like the headline. */
function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10);
}
