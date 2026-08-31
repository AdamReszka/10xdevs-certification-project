"use client";

import { CalendarOffIcon, OctagonXIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createTeamDayOffAction,
  deleteTeamDayOffAction,
} from "@/app/(app)/team/actions";
import ConfirmDialog from "@/components/molecules/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  dayKeyToPickerDate,
  pickerDateToDayKey,
  toTeamDayOffRows,
} from "./team-days-off-view";

/**
 * Team-wide days off on `/team/days-off` (S-23, FR-007/FR-022) — public
 * holidays and company days off, recorded once as dates on the account.
 *
 * IT SHARED `/settings/absences` UNTIL S-19. The argument for one page was that
 * a team day off is "who is not working" asked of everybody, and that the two
 * calendars side by side made the distinction legible. In use the side-by-side
 * did the opposite: an absence belongs to a person and a sprint, a holiday is a
 * property of the calendar that applies to every sprint spanning it, and one
 * screen with two headings asked the owner to hold both models at once. Each
 * now has its own tab, and each subtitle names the other.
 *
 * ADD AND REMOVE, NO EDIT. A holiday moved to a different date is a different
 * holiday, and delete-then-add says that more honestly than an update would. It
 * also keeps the store's write path to a single idempotent insert, which is what
 * lets S-17 later generate these rows onto a set the owner may already have
 * entered by hand.
 *
 * Rendering and wiring only: every judgement lives in the pure
 * `team-days-off-view.ts` sibling, because this project has no component-test
 * harness. Same split as `absence-editor.tsx` / `absence-calendar-view.ts`.
 *
 * After a successful action: `router.refresh()`. There is no `revalidatePath`
 * anywhere in `src/`, and the page is `force-dynamic`.
 */

/** A stored day off as it crosses the server→client boundary. `day` is already
 *  a `YYYY-MM-DD` string — the column is `date`, so nothing to serialize. */
export type SerializedTeamDayOff = {
  id: string;
  day: string;
  label: string | null;
  /** `'manual'` or `'derived'` (S-17). See `team_day_off.source`. */
  source: string;
};

export default function TeamDaysOffEditor({
  daysOff,
  workingDays,
}: {
  daysOff: SerializedTeamDayOff[];
  /** The active sprint's working weekdays, so a Saturday holiday can say so. */
  workingDays: string[] | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [day, setDay] = useState<string>("");
  const [label, setLabel] = useState<string>("");

  const rows = useMemo(
    () => toTeamDayOffRows({ daysOff, workingDays }),
    [daysOff, workingDays],
  );

  function openAdd() {
    setFormError(null);
    setDay("");
    setLabel("");
    setIsOpen(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!day) {
      setFormError("Pick a date first.");
      return;
    }

    setIsSaving(true);
    const result = await createTeamDayOffAction({ day, label });
    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    setIsOpen(false);
    toast.success("Day off recorded.");
    router.refresh();
  }

  async function onDelete(id: string) {
    const result = await deleteTeamDayOffAction(id);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Day off removed.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base font-medium">Team days off</CardTitle>
        <Button type="button" onClick={openAdd}>
          <PlusIcon />
          Add a day off
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
            <CalendarOffIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No team days off recorded. Add your public holidays and company days
              off once — each one applies to every sprint that spans it.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>What it is</TableHead>
                  <TableHead className="w-24" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium tabular-nums">
                      {row.formatted}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-2">
                        {row.label ?? "—"}
                        {/* Not an error: the day is recorded, it simply was not a
                            working day to begin with, so capacity does not move. */}
                        {row.costsNothing ? (
                          <Badge variant="outline">Not a working day anyway</Badge>
                        ) : null}
                        {/* Quiet, and only on the generated rows: the list of an
                            account that has never approved a year must look
                            exactly as it did before S-17. */}
                        {row.isDerived ? (
                          <Badge variant="secondary">From the holiday calendar</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ConfirmDialog
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove team day off on ${row.formatted}`}
                            >
                              <Trash2Icon />
                            </Button>
                          }
                          title="Remove this day off?"
                          description={
                            <>
                              This removes{" "}
                              <strong>
                                {row.formatted}
                                {row.label ? ` — ${row.label}` : ""}
                              </strong>{" "}
                              from every sprint that spans it. The day becomes a
                              working day again: the sprint&apos;s capacity goes back
                              up and tickets start ageing across it.
                            </>
                          }
                          confirmLabel="Remove"
                          variant="destructive"
                          onConfirm={() => onDelete(row.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a team day off</DialogTitle>
            <DialogDescription>
              A day the whole team is off. Recorded once as a date, it applies to
              every sprint that spans it — and costs one man-day per person.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {formError ? (
              <Alert variant="destructive">
                <OctagonXIcon />
                <AlertTitle>Couldn&apos;t save the day off</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label>Date</Label>
              <div className="rounded-md border" aria-label="Day off date">
                <Calendar
                  mode="single"
                  selected={day ? dayKeyToPickerDate(day) : undefined}
                  onSelect={(picked) =>
                    setDay(picked ? pickerDateToDayKey(picked) : "")
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="day-off-label">What it is (optional)</Label>
              <Input
                id="day-off-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder="Assumption of Mary, company offsite…"
                aria-label="What it is"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : "Add day off"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
