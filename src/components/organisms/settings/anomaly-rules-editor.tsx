"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import {
  resetAnomalyRuleAction,
  saveAnomalyRuleAction,
} from "@/app/(app)/settings/anomalies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnomalyRuleState } from "@/lib/anomaly-settings";
import { RULE_SAVE_SCHEMAS, SP_BUCKET_KEYS } from "@/lib/validations/anomaly-settings";

import {
  RULE_DESCRIPTORS,
  SAVE_HINT,
  SEVERITY_HINT,
  WORKING_TIME_HINT,
  defaultFormValues,
  equalsDefaults,
  readField,
  toFormValues,
  toPayload,
  type NumberFieldDescriptor,
  type RuleDescriptor,
  type RuleFormValues,
} from "./anomaly-rules-view";

/**
 * `/settings/anomalies` — the eight per-rule cards (S-14, FR-009 + FR-014).
 *
 * Rendering and hooks only: every judgement, label and copy sentence lives in the
 * pure `anomaly-rules-view.ts` sibling, because there is no component-test
 * harness in this project. Same split as `recap-settings-form.tsx` /
 * `recap-settings-view.ts`.
 *
 * TWO COMPONENTS, NOT ONE, and that is load-bearing. Each card saves
 * independently — one row per rule, one re-detect per user action — so each needs
 * its own `useForm` and `useTransition`. Calling either hook inside the parent's
 * `.map()` is a rules-of-hooks violation that fails `npm run lint`, so the card
 * is its own component. The repo's other multi-row forms
 * (`roster-editor.tsx:189-200`) are ONE `useForm` + `useFieldArray`, which the
 * per-rule-save decision rules out here.
 *
 * After a successful save: `router.refresh()`. There is no `revalidatePath`
 * anywhere in this repo.
 */
export default function AnomalyRulesEditor({ rules }: { rules: AnomalyRuleState[] }) {
  const byType = new Map(rules.map((r) => [r.anomalyType, r]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{WORKING_TIME_HINT}</p>
      <p className="text-sm text-muted-foreground">{SAVE_HINT}</p>

      {RULE_DESCRIPTORS.map((descriptor) => {
        const state = byType.get(descriptor.anomalyType);
        if (!state) return null;
        return (
          <AnomalyRuleCard
            key={descriptor.anomalyType}
            descriptor={descriptor}
            state={state}
          />
        );
      })}
    </div>
  );
}

function AnomalyRuleCard({
  descriptor,
  state,
}: {
  descriptor: RuleDescriptor;
  state: AnomalyRuleState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<RuleFormValues>({
    // Each card resolves against ITS OWN union member, not the whole union — see
    // `RULE_SAVE_SCHEMAS`. The cast bridges the member's precise body type and
    // the form's open `Record<string, unknown>`; `toPayload` is what guarantees
    // the submitted body is complete, and the server re-validates regardless.
    resolver: zodResolver(
      RULE_SAVE_SCHEMAS[descriptor.anomalyType],
    ) as unknown as Resolver<RuleFormValues>,
    defaultValues: toFormValues(state),
  });

  // `useWatch`, not `form.watch`, so the React Compiler can still memoize —
  // same reason as `absence-editor.tsx:144-146`.
  const watched = useWatch({ control: form.control });
  // The badge follows the LIVE values, not the saved ones, so a card the lead has
  // edited back to the shipped numbers stops claiming to be modified before they
  // press Save — the same predicate the store uses to decide whether to keep a row.
  const isModified = watched
    ? !equalsDefaults(descriptor.anomalyType, {
        severity: (watched.severity ?? state.severity) as RuleFormValues["severity"],
        thresholds: (watched.thresholds ?? state.thresholds) as Record<string, unknown>,
      })
    : state.isOverridden;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveAnomalyRuleAction(toPayload(values));
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${descriptor.label} saved.`);
      router.refresh();
    });
  });

  function onReset() {
    startTransition(async () => {
      const result = await resetAnomalyRuleAction({
        anomalyType: descriptor.anomalyType,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      form.reset(defaultFormValues(descriptor.anomalyType));
      toast.success(`${descriptor.label} reset to defaults.`);
      router.refresh();
    });
  }

  const fieldId = (path: string) => `${descriptor.anomalyType}-${path.replace(/\./g, "-")}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {descriptor.label}
              {state.isOverridden ? <Badge variant="secondary">Modified</Badge> : null}
            </CardTitle>
            <CardDescription>{descriptor.detects}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={fieldId("severity")}>Severity</Label>
              <Controller
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={pending}
                  >
                    <SelectTrigger id={fieldId("severity")} aria-label="Severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="LOW">Low</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {descriptor.fields.map((field) => (
              <NumberField
                key={field.path}
                descriptor={field}
                id={fieldId(field.path)}
                registration={form.register(`thresholds.${field.path}` as const, {
                  valueAsNumber: true,
                })}
                error={fieldErrorMessage(form.formState.errors, `thresholds.${field.path}`)}
                disabled={pending}
              />
            ))}
          </div>

          {descriptor.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This rule has no numbers to tune — it fires whenever a merged pull
              request&apos;s ticket has not reached Done. Only its severity is
              yours to set.
            </p>
          ) : null}

          {descriptor.hasStoryPointBudgets ? (
            <StoryPointBudgets
              form={form}
              anomalyType={descriptor.anomalyType}
              disabled={pending}
            />
          ) : null}

          <p className="text-sm text-muted-foreground">{SEVERITY_HINT}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onReset}
              // Disabled when there is nothing to reset — the rule has no stored
              // row, so the action would be a silent no-op.
              disabled={pending || !state.isOverridden}
            >
              Reset to defaults
            </Button>
            {isModified !== state.isOverridden ? (
              <span className="text-sm text-muted-foreground" role="status">
                Unsaved changes.
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The seven story-point In-Progress budgets.
 *
 * ALL SEVEN ARE PLAIN NUMBERS since S-28. The 21-SP row used to be a
 * two-position select because its stored value was the `"8_WORKING_DAYS"`
 * sentinel and "10 working days" could not be expressed as a count of
 * wall-clock hours. Now that every budget is denominated in WORKING hours the
 * sentinel is just 64, so the reason for the special control is gone and the
 * lead can type any number of working days they like.
 */
function StoryPointBudgets({
  form,
  anomalyType,
  disabled,
}: {
  form: ReturnType<typeof useForm<RuleFormValues>>;
  anomalyType: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">In Progress budget by story points</p>
        <p className="text-sm text-muted-foreground">
          How many working hours a ticket of each size may sit In Progress before
          it counts as ageing — eight to the working day. A ticket with no
          estimate is skipped entirely.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {SP_BUCKET_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Label htmlFor={`${anomalyType}-sp-${key}`}>{key} SP</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${anomalyType}-sp-${key}`}
                type="number"
                min={1}
                max={2000}
                step={1}
                disabled={disabled}
                {...form.register(`thresholds.inProgressHoursBySp.${key}` as const, {
                  valueAsNumber: true,
                })}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                working hours
              </span>
            </div>
          </div>
        ))}
      </div>

      {fieldErrorMessage(form.formState.errors, "thresholds.inProgressHoursBySp") ? (
        <p className="text-sm text-destructive" role="alert">
          {fieldErrorMessage(form.formState.errors, "thresholds.inProgressHoursBySp")}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  descriptor,
  id,
  registration,
  error,
  disabled,
}: {
  descriptor: NumberFieldDescriptor;
  id: string;
  registration: ReturnType<ReturnType<typeof useForm<RuleFormValues>>["register"]>;
  error: string | undefined;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{descriptor.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={descriptor.min}
          max={descriptor.max}
          step={1}
          disabled={disabled}
          {...registration}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {descriptor.unit}
        </span>
      </div>
      {descriptor.help ? (
        <p className="text-sm text-muted-foreground">{descriptor.help}</p>
      ) : null}
      {/* The organisms wire errors by hand (`absence-editor.tsx:410-413`);
          `ui/form.tsx` exists but nothing in this project imports it. */}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pull one dotted path's message out of react-hook-form's nested error tree. */
function fieldErrorMessage(errors: unknown, path: string): string | undefined {
  const node = readField(errors as Record<string, unknown>, path);
  if (node && typeof node === "object" && "message" in node) {
    const message = (node as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}
