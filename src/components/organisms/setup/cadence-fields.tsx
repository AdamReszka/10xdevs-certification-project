"use client";

import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";

import { CADENCE_PROVENANCE } from "@/components/organisms/settings/cadence-editor-view";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
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
import type { CadenceValues, Weekday } from "@/lib/validations/roster";

/**
 * The three cadence controls, shared by the setup wizard's last step
 * (`CadenceForm`) and the post-setup editor (`CadenceEditor`) — S-29 Phase 4.
 *
 * Split out because the two screens do different JOBS with the same fields: one
 * finishes a wizard and redirects, the other saves and stays. Left inline in
 * both, the fields would drift into two spellings of one cadence — and the
 * cadence is the thing five anomaly rules and the capacity figure read.
 *
 * PRESENTATIONAL ONLY: no actions, no router, no submit button, no card. Each
 * owner keeps its own header and footer. It must stay that way — the moment this
 * component knows how to save, the two screens are one screen with a flag.
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

export default function CadenceFields({
  control,
  provenance = false,
}: {
  control: Control<CadenceValues>;
  /**
   * Show where each value came from, per field.
   *
   * Off in the wizard, where the card's own description already frames the whole
   * step and a third line under every input would crowd it. On in the editor,
   * which a lead opens months later with no memory of what set these — and where
   * the honest answer differs per field: two are derived from Jira, the third
   * has no Jira source at all (`CADENCE_PROVENANCE`).
   */
  provenance?: boolean;
}) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          control={control}
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
              {provenance ? (
                <FormDescription>
                  {CADENCE_PROVENANCE.lengthDays}
                </FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
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
              {provenance ? (
                <FormDescription>{CADENCE_PROVENANCE.startDay}</FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <Controller
        control={control}
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
            {provenance ? (
              <FormDescription>
                {CADENCE_PROVENANCE.workingDays}
              </FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
