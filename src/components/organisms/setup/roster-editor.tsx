"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  type ClientMember,
  deleteMemberAction,
  getMemberHistoryAction,
  importRosterAction,
  mergeMembersAction,
  saveRosterAction,
  setMemberActiveAction,
} from "@/app/(app)/setup/team/actions";
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
import { Input } from "@/components/ui/input";
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
import { rosterSaveSchema, type RosterSaveValues } from "@/lib/validations/roster";

/**
 * Roster editor (S-04, FR-006). A `useFieldArray` table of the auto-imported team
 * (GitHub collaborators + Jira project members) that the lead can edit, extend,
 * and manually map. Every field is editable; rows can be added/removed; two rows
 * (a GitHub-only + a Jira-only) can be MERGED into one member.
 *
 * Auto-import runs once on first visit (empty roster); return visits show the
 * saved roster with a Re-import button. A GitHub scope/auth failure surfaces the
 * PAT-scope degradation banner — the step continues with Jira-seeded + manual
 * members (graceful degradation), never a hard stop.
 *
 * REMOVAL IS SERVER-SIDE for persisted rows (S-15). The bulk save is a
 * differential upsert that never deletes, so dropping a row from this grid no
 * longer removes anybody — the trash and Merge call the lifecycle actions and
 * only then update the grid. An UNSAVED row (no `id`) has nothing server-side to
 * lose and stays a pure client-side `remove`.
 *
 * The `window.confirm` prompts here are INTERIM: Phase 4 swaps them for
 * `ConfirmDialog` carrying the same copy, with no change to these call sites.
 */

const TRACKS = [
  { value: "FRONTEND", label: "Frontend" },
  { value: "BACKEND", label: "Backend" },
  { value: "MOBILE", label: "Mobile" },
  { value: "QA", label: "QA" },
] as const;

const NONE = "NONE";

/** Blank string / null coalescing for the RHF text inputs (schema allows null). */
function toFormMember(m: ClientMember) {
  return {
    id: m.id,
    name: m.name,
    githubUsername: m.githubUsername ?? "",
    jiraAccountId: m.jiraAccountId ?? "",
    role: m.role ?? "",
    spCapacity: m.spCapacity,
    technologyTrack: m.technologyTrack,
    // Carried so a save round-trips it instead of falling back to the stored
    // value — the Status column that reads/writes it lands in Phase 4.
    isActive: m.isActive,
  };
}

/** The per-row origin label, derived from the currently-entered identity keys. */
function originLabel(githubUsername?: string | null, jiraAccountId?: string | null) {
  const hasG = !!githubUsername;
  const hasJ = !!jiraAccountId;
  if (hasG && hasJ) return "Mapped";
  if (hasG) return "GitHub";
  if (hasJ) return "Jira";
  return "Manual";
}

export default function RosterEditor({
  initialMembers,
}: {
  initialMembers: ClientMember[];
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The row whose lifecycle action is in flight — disables its controls. */
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const router = useRouter();

  const form = useForm<RosterSaveValues>({
    resolver: zodResolver(rosterSaveSchema),
    defaultValues: { members: initialMembers.map(toFormMember) },
  });
  const { fields, append, remove, update, replace } = useFieldArray({
    control: form.control,
    name: "members",
  });

  // Watch identity keys so the origin label re-renders as the user edits/maps.
  // `useWatch` (not `form.watch`) keeps React Compiler able to memoize the row.
  const watched = useWatch({ control: form.control, name: "members" });

  async function runImport() {
    setFormError(null);
    setDegradedReason(null);
    setIsImporting(true);
    try {
      const result = await importRosterAction();
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      replace(result.members.map(toFormMember));
      setSelected(new Set());
      if (result.githubDegraded && result.reason) {
        setDegradedReason(result.reason);
      }
    } catch {
      setFormError("Something went wrong importing the team. Please try again.");
    } finally {
      setIsImporting(false);
    }
  }

  // Auto-import once on first visit (no saved roster yet).
  const didAutoImport = useRef(false);
  useEffect(() => {
    if (!didAutoImport.current && initialMembers.length === 0) {
      didAutoImport.current = true;
      void runImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** One line naming what a permanent delete would destroy — the copy Phase 4's
   *  dialog will carry, and the reason a member with history can only be
   *  deactivated. */
  function stakesCopy(name: string, history: { absences: number; anomalies: number }) {
    const abs = `${history.absences} recorded ${history.absences === 1 ? "absence" : "absences"}`;
    const anom = `${history.anomalies} attributed ${history.anomalies === 1 ? "anomaly" : "anomalies"}`;
    return `${name} has ${abs} and ${anom}. They stay with a deactivated member and are destroyed by a permanent delete.`;
  }

  /**
   * The trash. A persisted row goes through the lifecycle actions — permanent
   * delete when the member is clean and not the last one, deactivation
   * otherwise. An unsaved row is just dropped from the grid.
   */
  async function removeRow(index: number) {
    setFormError(null);
    const row = form.getValues(`members.${index}`);

    if (!row.id) {
      remove(index);
      setSelected(new Set());
      return;
    }

    const memberId = row.id;
    const name = row.name || "This member";
    setPendingRowId(memberId);
    try {
      const history = await getMemberHistoryAction(memberId);
      if (!history.ok) {
        setFormError(history.message);
        return;
      }

      const isClean = history.absences === 0 && history.anomalies === 0;
      const canDelete = isClean && !history.isLastMember;

      if (canDelete) {
        if (!window.confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
        const result = await deleteMemberAction(memberId);
        if (!result.ok) {
          setFormError(result.message);
          return;
        }
        toast.success(`Removed ${name} from the team.`);
      } else {
        const why = history.isLastMember && isClean
          ? `${name} is your only team member, so they cannot be deleted.`
          : stakesCopy(name, history);
        if (!window.confirm(`${why}\n\nDeactivate ${name} instead?`)) return;
        const result = await setMemberActiveAction(memberId, false);
        if (!result.ok) {
          setFormError(result.message);
          return;
        }
        toast.success(`Deactivated ${name}.`);
      }

      // Only now does the grid change — a failed action leaves the row in place.
      remove(index);
      setSelected(new Set());
      router.refresh();
    } catch {
      setFormError("Something went wrong removing that member. Please try again.");
    } finally {
      setPendingRowId(null);
    }
  }

  /** Merge exactly two selected rows into one (GitHub-only + Jira-only → one). */
  async function mergeSelected() {
    setFormError(null);
    const ids = [...selected];
    if (ids.length !== 2) return;
    const values = form.getValues("members");
    const idxA = fields.findIndex((f) => f.id === ids[0]);
    const idxB = fields.findIndex((f) => f.id === ids[1]);
    if (idxA < 0 || idxB < 0) return;

    // The grid keeps the LOWER index so the remaining index stays stable, which
    // makes the kept row — not "A" — the one whose id must survive. Picking the
    // id by A/B while picking the row by index is what made a merge of two
    // persisted rows write one id and orphan the other, duplicating the person.
    const [keepIdx, dropIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
    const keepRow = values[keepIdx];
    const dropRow = values[dropIdx];

    // Identity keys union across both; the kept row wins every scalar. Name
    // selection (preferring a Jira displayName over a bare login) is Phase 4.
    const mergedFields = {
      name: keepRow.name || dropRow.name,
      githubUsername: keepRow.githubUsername || dropRow.githubUsername || "",
      jiraAccountId: keepRow.jiraAccountId || dropRow.jiraAccountId || "",
      role: keepRow.role || dropRow.role || "",
      spCapacity: keepRow.spCapacity ?? dropRow.spCapacity ?? null,
      technologyTrack: keepRow.technologyTrack ?? dropRow.technologyTrack ?? null,
      isActive: keepRow.isActive ?? dropRow.isActive,
    };

    // Both persisted ⇒ one of the two DB rows genuinely disappears, so this is a
    // confirmed server operation. Otherwise the surviving row carries whichever
    // id exists (if any) and the next Save upserts it — nothing to delete.
    if (keepRow.id && dropRow.id) {
      const dropName = dropRow.name || "the other row";
      if (
        !window.confirm(
          `Merge these two rows into one member? "${dropName}" disappears and its identity key moves onto "${mergedFields.name}".`,
        )
      ) {
        return;
      }

      setPendingRowId(keepRow.id);
      try {
        const result = await mergeMembersAction({
          keepId: keepRow.id,
          dropId: dropRow.id,
          merged: { ...mergedFields, id: keepRow.id },
        });
        if (!result.ok) {
          setFormError(result.message);
          return;
        }
        toast.success(`Merged into ${mergedFields.name}.`);
      } catch {
        setFormError("Something went wrong merging those members. Please try again.");
        return;
      } finally {
        setPendingRowId(null);
      }
      router.refresh();
    }

    update(keepIdx, { ...mergedFields, id: keepRow.id ?? dropRow.id });
    remove(dropIdx);
    setSelected(new Set());
  }

  const onSave = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      // Coalesce blank strings back to null so `source` derivation is correct.
      const members = values.members.map((m) => ({
        ...m,
        githubUsername: m.githubUsername ? m.githubUsername : null,
        jiraAccountId: m.jiraAccountId ? m.jiraAccountId : null,
        role: m.role ? m.role : null,
      }));
      const result = await saveRosterAction({ members });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast.success(
        `Saved ${members.length} team ${members.length === 1 ? "member" : "members"}.`,
      );
    } catch {
      setFormError("Something went wrong saving the roster. Please try again.");
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Team roster</CardTitle>
            <CardDescription>
              Imported from your monitored repos and Jira project. Edit names,
              roles, capacity and technology track — and map a GitHub person to
              their Jira account by selecting both rows and choosing Merge.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runImport}
            disabled={isImporting}
            className="shrink-0"
          >
            <RefreshCwIcon className={isImporting ? "animate-spin" : undefined} />
            {isImporting ? "Importing…" : "Re-import"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {degradedReason ? (
          <Alert>
            <OctagonXIcon />
            <AlertTitle>GitHub collaborators unavailable</AlertTitle>
            <AlertDescription>{degradedReason}</AlertDescription>
          </Alert>
        ) : null}

        {formError ? (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Couldn&apos;t save the roster</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        {fields.length === 0 && !isImporting ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
            <UsersIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No team members yet. Import from GitHub &amp; Jira, or add one manually.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" aria-label="Select for merge" />
                  <TableHead>Name</TableHead>
                  <TableHead>GitHub</TableHead>
                  <TableHead>Jira account ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-20">Capacity</TableHead>
                  <TableHead className="w-32">Track</TableHead>
                  <TableHead className="w-24">Origin</TableHead>
                  <TableHead className="w-10" aria-label="Remove" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => (
                  <TableRow key={field.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(field.id)}
                        onCheckedChange={() => toggleSelected(field.id)}
                        aria-label={`Select ${watched?.[index]?.name ?? "member"} for merge`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="Name"
                        {...form.register(`members.${index}.name`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="GitHub username"
                        placeholder="—"
                        {...form.register(`members.${index}.githubUsername`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="Jira account ID"
                        placeholder="—"
                        {...form.register(`members.${index}.jiraAccountId`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="Role"
                        placeholder="—"
                        {...form.register(`members.${index}.role`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="Story-point capacity"
                        type="number"
                        min={0}
                        placeholder="—"
                        {...form.register(`members.${index}.spCapacity`, {
                          setValueAs: (v) =>
                            v === "" || v == null ? null : Number(v),
                        })}
                      />
                    </TableCell>
                    <TableCell>
                      <Controller
                        control={form.control}
                        name={`members.${index}.technologyTrack`}
                        render={({ field: f }) => (
                          <Select
                            value={f.value ?? NONE}
                            onValueChange={(v) =>
                              f.onChange(v === NONE ? null : v)
                            }
                          >
                            <SelectTrigger aria-label="Technology track">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Unassigned</SelectItem>
                              {TRACKS.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {originLabel(
                          watched?.[index]?.githubUsername,
                          watched?.[index]?.jiraAccountId,
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void removeRow(index)}
                        disabled={
                          pendingRowId != null &&
                          pendingRowId === watched?.[index]?.id
                        }
                        aria-label={`Remove ${watched?.[index]?.name ?? "member"}`}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                name: "",
                githubUsername: "",
                jiraAccountId: "",
                role: "",
                spCapacity: null,
                technologyTrack: null,
              })
            }
          >
            <PlusIcon />
            Add member
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void mergeSelected()}
            disabled={selected.size !== 2}
          >
            Merge selected
            {selected.size > 0 ? ` (${selected.size})` : null}
          </Button>
        </div>
      </CardContent>

      <CardFooter className="justify-end">
        <Button type="button" onClick={onSave} disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save roster"}
        </Button>
      </CardFooter>
    </Card>
  );
}
