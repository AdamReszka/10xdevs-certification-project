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
  computedMd,
  overrideMd,
  computedSp,
  correctedSp,
}: {
  /** What the model computed for this sprint — the input's placeholder. */
  computedMd: number;
  overrideMd: number | null;
  /** The measured delivered SP, or `null` when the sweep has recorded none yet. */
  computedSp: number | null;
  correctedSp: number | null;
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
          help="Leave empty to use the computed capacity."
          placeholder={formatNumber(computedMd)}
          current={overrideMd}
          step="0.5"
          parse={(raw) => {
            const value = Number(raw);
            return Number.isFinite(value) ? value : null;
          }}
          save={(value) => setCapacityOverrideAction({ md: value })}
          savedMessage="Capacity override saved."
          clearedMessage="Capacity override cleared."
        />

        <AdjustmentField
          id="delivered-correction"
          label="Delivered story points"
          help="Leave empty to use the measured figure."
          placeholder={computedSp === null ? "Not measured yet" : String(computedSp)}
          current={correctedSp}
          step="1"
          parse={(raw) => {
            const value = Number(raw);
            return Number.isInteger(value) ? value : null;
          }}
          save={(value) => setDeliveredCorrectionAction({ sp: value })}
          savedMessage="Delivered story points corrected."
          clearedMessage="Correction cleared."
        />
      </div>
    </div>
  );
}

/**
 * One number input plus its save / reset pair.
 *
 * AN EMPTY FIELD MEANS `null`, NOT ZERO — and that distinction is the whole
 * mechanism, because `null` is the only way back to the computed value. `0` is
 * a legitimate capacity (a sprint the whole team is off), so the two cannot be
 * collapsed. `parse` returning `null` for an unparseable entry is a separate
 * case, caught before the round trip.
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
    if (trimmed === "") {
      await submit(null, clearedMessage);
      return;
    }

    const parsed = parse(trimmed);
    if (parsed === null) {
      setError("Enter a number, or leave the field empty to use the computed value.");
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

/** `120` not `120.0`, `7.5` kept — the placeholder must read like the headline. */
function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10);
}
