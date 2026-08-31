"use client";

import { CheckCircle2Icon, GlobeIcon, OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  approveHolidayYearAction,
  saveHolidayCountryAction,
} from "@/app/(app)/team/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_COUNTRIES } from "@/lib/holidays";
import type { ProposedHoliday } from "@/lib/holidays/proposal";

import {
  COUNTRY_PICKER_HINT,
  approveButtonLabel,
  emptyApprovalHint,
  proposalHeadline,
  toHolidayProposalRows,
} from "./holiday-calendar-view";

/**
 * The country picker and the year's review list on `/team/days-off` (S-17,
 * FR-007).
 *
 * WHAT IT IS FOR. The five elapsed-time anomaly rules and the man-day divisor
 * have consumed a team-wide day-off calendar since S-23, and no real account has
 * ever held a single row — because filling it meant typing fourteen dates by
 * hand, once a year, unprompted. This surface derives them from one fact the
 * lead already knows: where their team is.
 *
 * A PROPOSAL, NEVER A WRITE. Nothing lands until the lead approves, and what
 * they uncheck is simply not sent — never sent as a deletion. Once a year is
 * approved it is closed: its days are not offered again, so a holiday the lead
 * removes afterwards stays removed. That guarantee lives in the approval record,
 * not here.
 *
 * Rendering and wiring only: every judgement lives in the pure
 * `holiday-calendar-view.ts` sibling, because this project has no
 * component-test harness. Same split as `team-days-off-editor.tsx`.
 *
 * After a successful action: `router.refresh()`. There is no `revalidatePath`
 * anywhere in `src/`, and the page is `force-dynamic`.
 */
export default function HolidayCalendarEditor({
  countryCode,
  years,
  proposed,
  workingDays,
}: {
  /** The account's country, or `null` when the lead has not picked one. */
  countryCode: string | null;
  /**
   * The years still awaiting a decision. Submitted WHOLE on approval, including
   * a year with nothing left to propose: stamping it is what stops SprintFlow
   * asking about it forever.
   */
  years: number[];
  proposed: ProposedHoliday[];
  /** The active sprint's working weekdays, so a Saturday holiday can say so. */
  workingDays: string[] | null;
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Every day is checked by default: the proposal is the national calendar, and
  // the exceptions are the team's, not ours to guess.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(
    () => toHolidayProposalRows({ proposed, workingDays }),
    [proposed, workingDays],
  );

  const kept = rows.filter((r) => !excluded.has(r.day));
  const emptyHint = emptyApprovalHint(kept.length);

  function toggle(day: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function onPickCountry(code: string) {
    setFormError(null);
    setIsSaving(true);
    try {
      const result = await saveHolidayCountryAction({ countryCode: code });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      // A new country re-opens every year, so the list below is rebuilt by the
      // server rather than patched here.
      setExcluded(new Set());
      toast.success("Country saved");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function onApprove() {
    if (!countryCode) return;
    setFormError(null);
    setIsSaving(true);
    try {
      const result = await approveHolidayYearAction({
        countryCode,
        years,
        days: kept.map((r) => r.day),
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast.success(
        kept.length === 0
          ? "Marked as reviewed — no days recorded"
          : `${kept.length} ${kept.length === 1 ? "day" : "days"} recorded`,
      );
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1.5">
        <CardTitle className="flex items-center gap-2">
          <GlobeIcon className="size-4" aria-hidden />
          Public holiday calendar
        </CardTitle>
        <p className="text-sm text-muted-foreground">{COUNTRY_PICKER_HINT}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {formError ? (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Couldn&apos;t save</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="holiday-country">Country</Label>
          <Select
            value={countryCode ?? undefined}
            onValueChange={onPickCountry}
            disabled={isSaving}
          >
            <SelectTrigger id="holiday-country" className="w-full sm:w-72">
              <SelectValue placeholder="Pick your team's country" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {countryCode === null ? null : years.length === 0 ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Reviewed</AlertTitle>
            <AlertDescription>
              You have already reviewed the public holidays for the years your
              sprint runs across. SprintFlow will ask again when it reaches a year
              you have not seen.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{proposalHeadline(rows)}</p>

            {rows.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {rows.map((row) => {
                  const id = `holiday-${row.day}`;
                  return (
                    <li key={row.day} className="flex items-center gap-3 py-1">
                      <Checkbox
                        id={id}
                        checked={!excluded.has(row.day)}
                        onCheckedChange={() => toggle(row.day)}
                        disabled={isSaving}
                      />
                      <Label
                        htmlFor={id}
                        className="flex flex-wrap items-center gap-2 font-normal"
                      >
                        <span className="tabular-nums">{row.formatted}</span>
                        <span className="text-muted-foreground">{row.label}</span>
                        {/* Said BEFORE approval, not after: two of Poland's
                            fourteen always fall on a Sunday, and capacity not
                            moving for them is correct rather than broken. */}
                        {row.costsNothing ? (
                          <Badge variant="outline">Not a working day anyway</Badge>
                        ) : null}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {emptyHint ? (
              <p className="text-sm text-muted-foreground">{emptyHint}</p>
            ) : null}

            <div className="flex justify-end">
              <Button type="button" onClick={onApprove} disabled={isSaving}>
                {approveButtonLabel(isSaving)}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
