"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarOffIcon, OctagonXIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  createAbsenceAction,
  deleteAbsenceAction,
  updateAbsenceAction,
} from "@/app/(app)/settings/absences/actions";
import ConfirmDialog from "@/components/molecules/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { absenceSaveSchema, type AbsenceSaveValues } from "@/lib/validations/absence";

import {
  type AbsenceMember,
  type AbsenceRow,
  type StoredAbsence,
  dayKeyToPickerDate,
  defaultIsPlanned,
  describeAbsence,
  formatWindow,
  hasClientOverlap,
  pickerDateToDayKey,
  toAbsenceRows,
} from "./absence-calendar-view";

/**
 * The `/settings/absences` surface (S-08, FR-010) — record who is away.
 *
 * Rendering and wiring only: every judgement this component makes lives in the
 * pure `absence-calendar-view.ts` sibling, because there is no component-test
 * harness in this project. The same split as `roster-editor.tsx` /
 * `roster-merge.ts`.
 *
 * Add and edit share one `dialog` (a form needs a close button and a scrollable
 * body; `alert-dialog` is the destructive-confirm shell and has neither). Delete
 * routes through `ConfirmDialog`, which NAMES what it destroys.
 *
 * Every control carries an `aria-label` so the Playwright rule — `getByRole` /
 * `getByLabel` first, never CSS selectors — holds on this surface.
 *
 * After a successful action: `router.refresh()`. There is no `revalidatePath`
 * anywhere in `src/`, and the page is `force-dynamic`, so a refresh re-runs the
 * server component against the freshly written rows.
 */

const TYPES = [
  { value: "VACATION", label: "Vacation" },
  { value: "SICKNESS", label: "Sickness" },
  { value: "TRAINING", label: "Training" },
] as const;

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPES.map((t) => [t.value, t.label]),
);

export default function AbsenceEditor({
  absences,
  members,
  timeZone,
  sprintStartDay,
}: {
  absences: StoredAbsence[];
  members: (AbsenceMember & { isActive: boolean })[];
  timeZone: string | null;
  sprintStartDay: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  /** The row being edited, or null for "add". */
  const [editing, setEditing] = useState<AbsenceRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const rows = useMemo(
    () => toAbsenceRows({ absences, members, timeZone }),
    [absences, members, timeZone],
  );

  const form = useForm<AbsenceSaveValues>({
    resolver: zodResolver(absenceSaveSchema),
    defaultValues: emptyValues(members),
  });

  // `useWatch` (not `form.watch`) keeps React Compiler able to memoize this —
  // same reason as `roster-editor.tsx:178`.
  const watched = useWatch({ control: form.control });
  // Advisory only — the store enforces the same rule and is the authority.
  const overlapWarning =
    watched.teamMemberId && watched.startDate && watched.endDate
      ? hasClientOverlap(
          {
            id: editing?.id,
            teamMemberId: watched.teamMemberId,
            startDay: watched.startDate,
            endDay: watched.endDate,
          },
          rows,
        )
      : false;

  function openAdd() {
    setEditing(null);
    setFormError(null);
    form.reset(emptyValues(members));
    setIsOpen(true);
  }

  function openEdit(row: AbsenceRow) {
    setEditing(row);
    setFormError(null);
    form.reset({
      id: row.id,
      teamMemberId: row.teamMemberId,
      type: row.type,
      startDate: row.startDay,
      endDate: row.endDay,
      isPlanned: row.isPlanned,
    });
    setIsOpen(true);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = editing
      ? await updateAbsenceAction({ ...values, id: editing.id })
      : await createAbsenceAction({ ...values, id: undefined });

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    setIsOpen(false);
    toast.success(editing ? "Absence updated." : "Absence recorded.");
    router.refresh();
  });

  async function onDelete(row: AbsenceRow) {
    const result = await deleteAbsenceAction(row.id);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Absence removed.");
    router.refresh();
  }

  const selectedRange: DateRange | undefined = watched.startDate
    ? {
        from: dayKeyToPickerDate(watched.startDate),
        to: watched.endDate ? dayKeyToPickerDate(watched.endDate) : undefined,
      }
    : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base font-medium">Recorded absences</CardTitle>
        <Button type="button" onClick={openAdd} disabled={members.length === 0}>
          <PlusIcon />
          Record an absence
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {members.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
            <CalendarOffIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Add your team first — absences are recorded against a team member.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
            <CalendarOffIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nobody is away yet. Record vacation, sickness or training and SprintFlow
              will account for it.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="w-32">Kind</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="w-28">Length</TableHead>
                  <TableHead className="w-28">Planned</TableHead>
                  <TableHead className="w-24" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.memberName}</TableCell>
                    <TableCell>{TYPE_LABEL[row.type] ?? row.type}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatWindow(row)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* Calendar days. The WORKING-day cost lands in Phase 3's
                          counter, which capacity and SPRINT_AT_RISK both read. */}
                      {row.days.length} {row.days.length === 1 ? "day" : "days"}
                    </TableCell>
                    <TableCell>
                      {row.isPlanned ? (
                        <Badge variant="outline">Planned</Badge>
                      ) : (
                        <Badge variant="secondary">Unplanned</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit absence for ${row.memberName}`}
                          onClick={() => openEdit(row)}
                        >
                          <PencilIcon />
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove absence for ${row.memberName}`}
                            >
                              <Trash2Icon />
                            </Button>
                          }
                          title="Remove this absence?"
                          description={
                            <>
                              This removes <strong>{describeAbsence(row)}</strong>.
                              SprintFlow will stop accounting for those days — the
                              person becomes eligible for inactivity flags again and
                              the sprint&apos;s capacity goes back up.
                            </>
                          }
                          confirmLabel="Remove"
                          variant="destructive"
                          onConfirm={() => onDelete(row)}
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
            <DialogTitle>
              {editing ? "Edit absence" : "Record an absence"}
            </DialogTitle>
            <DialogDescription>
              Pick the person, the kind and the days they are away. The last day is
              included.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {formError ? (
              <Alert variant="destructive">
                <OctagonXIcon />
                <AlertTitle>Couldn&apos;t save the absence</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="absence-member">Person</Label>
              <Controller
                control={form.control}
                name="teamMemberId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="absence-member" aria-label="Person">
                      <SelectValue placeholder="Pick a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.isActive ? m.name : `${m.name} (deactivated)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="absence-type">Kind</Label>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="absence-type" aria-label="Kind of absence">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Days away</Label>
              <div className="rounded-md border" aria-label="Absence days">
                <Calendar
                  mode="range"
                  selected={selectedRange}
                  onSelect={(range) => {
                    const from = range?.from;
                    if (!from) {
                      form.setValue("startDate", "", { shouldValidate: false });
                      form.setValue("endDate", "", { shouldValidate: false });
                      return;
                    }
                    const startDay = pickerDateToDayKey(from);
                    // A single click selects one day; `to` fills in on the second.
                    const endDay = range?.to ? pickerDateToDayKey(range.to) : startDay;
                    form.setValue("startDate", startDay, { shouldValidate: true });
                    form.setValue("endDate", endDay, { shouldValidate: true });
                    // Only when adding: an owner editing an existing row has
                    // already made this call, and re-deriving would overwrite it.
                    if (!editing) {
                      form.setValue("isPlanned", defaultIsPlanned(startDay, sprintStartDay));
                    }
                  }}
                />
              </div>
              {form.formState.errors.endDate ? (
                <p className="text-sm text-destructive" role="alert">
                  {form.formState.errors.endDate.message}
                </p>
              ) : null}
              {overlapWarning ? (
                <p className="text-sm text-muted-foreground" role="status">
                  This person already has an absence covering some of those days —
                  saving will be refused. Edit the existing one instead.
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-2">
              <Controller
                control={form.control}
                name="isPlanned"
                render={({ field }) => (
                  <Checkbox
                    id="absence-planned"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    aria-label="Known before the sprint started"
                  />
                )}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="absence-planned">Known before the sprint started</Label>
                <p className="text-xs text-muted-foreground">
                  Leave this unchecked for a surprise — a sudden sickness, an
                  unexpected day off. Only unplanned absences raise the sprint&apos;s
                  risk, because only those were missing from the commitment.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Record absence"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** A blank form, pre-pointed at the first active member so the common path is one click shorter. */
function emptyValues(
  members: (AbsenceMember & { isActive: boolean })[],
): AbsenceSaveValues {
  return {
    teamMemberId: members.find((m) => m.isActive)?.id ?? members[0]?.id ?? "",
    type: "VACATION",
    startDate: "",
    endDate: "",
    isPlanned: true,
  };
}
