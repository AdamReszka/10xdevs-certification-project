"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  type ClientMember,
  type ClientPreviewMember,
  deleteMemberAction,
  getMemberHistoryAction,
  importRosterAction,
  mergeMembersAction,
  saveRosterAction,
  setMemberActiveAction,
} from "@/app/(app)/setup/team/actions";
import ConfirmDialog from "@/components/molecules/confirm-dialog";
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

import { decideMerge } from "./roster-merge";

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
 * Every destructive action confirms through `ConfirmDialog`, which NAMES what it
 * is about to destroy: the trash offers Deactivate by default and Delete
 * permanently only when the member has no absences, no attributed anomalies and
 * is not the last one; Merge names the row that disappears.
 */

const TRACKS = [
  { value: "FRONTEND", label: "Frontend" },
  { value: "BACKEND", label: "Backend" },
  { value: "MOBILE", label: "Mobile" },
  { value: "QA", label: "QA" },
] as const;

const NONE = "NONE";

/**
 * Blank string / null coalescing for the RHF text inputs (schema allows null).
 *
 * NOTE: this projects down to `rosterMemberSchema`, which has no `source`,
 * `proposed` or `upstreamMissing` — anything not listed here is DISCARDED. The
 * import flags therefore live in component state, keyed by identity, not in the
 * field array. See `importFlags`.
 */
function toFormMember(m: ClientMember | ClientPreviewMember) {
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

/**
 * Stable key for a preview row's import flag. A persisted row is keyed by `id`;
 * a proposal has none yet, so it is keyed by its lowercased identity key. NEVER
 * by array index — `append` / `remove` reshuffle those.
 */
function flagKey(m: { id?: string; githubUsername?: string | null; jiraAccountId?: string | null }) {
  if (m.id) return m.id;
  const key = m.githubUsername || m.jiraAccountId;
  return key ? key.toLowerCase() : null;
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
  /** Import annotations, held OUTSIDE the form: `toFormMember` cannot carry them
   *  (see its note) and array indices are not stable under append/remove. */
  const [importFlags, setImportFlags] = useState<Map<string, "proposed" | "missing">>(
    new Map(),
  );
  const [importSummary, setImportSummary] = useState<string | null>(null);
  /** The row the trash was pressed on, with the history the dialog must name. */
  const [removeTarget, setRemoveTarget] = useState<{
    index: number;
    memberId: string;
    name: string;
    absences: number;
    anomalies: number;
    isLastMember: boolean;
  } | null>(null);
  /** The pending merge, held so the dialog can name the row that disappears. */
  const [mergeTarget, setMergeTarget] = useState<{
    keepIdx: number;
    dropIdx: number;
    keepId: string;
    dropId: string;
    dropName: string;
    merged: ReturnType<typeof decideMerge>["merged"];
  } | null>(null);
  // Shown by default: the roster is small, and hiding them would make
  // reactivation undiscoverable.
  const [showInactive, setShowInactive] = useState(true);
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
    setImportSummary(null);
    setIsImporting(true);
    try {
      const result = await importRosterAction();
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      replace(result.members.map(toFormMember));
      setSelected(new Set());

      // Set alongside replace(), never through it.
      const flags = new Map<string, "proposed" | "missing">();
      for (const m of result.members) {
        const key = flagKey(m);
        if (!key) continue;
        if (m.proposed) flags.set(key, "proposed");
        else if (m.upstreamMissing) flags.set(key, "missing");
      }
      setImportFlags(flags);

      // Import no longer writes — say so, or the owner will navigate away
      // believing the proposal was persisted.
      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} new`);
      if (result.missing > 0) {
        parts.push(`${result.missing} no longer in GitHub/Jira`);
      }
      setImportSummary(
        parts.length > 0
          ? `${parts.join(", ")} — nothing is saved until you press Save.`
          : "Your roster already matches GitHub and Jira — nothing to add.",
      );

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

  /** The import annotation for a row, resolved by identity rather than index. */
  function rowFlag(index: number): "proposed" | "missing" | undefined {
    if (importFlags.size === 0) return undefined;
    const key = flagKey({
      id: watched?.[index]?.id,
      githubUsername: watched?.[index]?.githubUsername,
      jiraAccountId: watched?.[index]?.jiraAccountId,
    });
    return key ? importFlags.get(key) : undefined;
  }

  /** The one-click answer to "this person is gone upstream" — no confirmation
   *  needed, deactivation destroys nothing and is reversible. */
  async function deactivateRow(index: number) {
    setFormError(null);
    const memberId = form.getValues(`members.${index}.id`);
    if (!memberId) return;

    setPendingRowId(memberId);
    try {
      const result = await setMemberActiveAction(memberId, false);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      form.setValue(`members.${index}.isActive`, false);
      toast.success(`Deactivated ${form.getValues(`members.${index}.name`)}.`);
      router.refresh();
    } catch {
      setFormError("Something went wrong deactivating that member. Please try again.");
    } finally {
      setPendingRowId(null);
    }
  }

  /** One line naming what a permanent delete would destroy — and the reason a
   *  member with history can only be deactivated. */
  function stakesCopy(name: string, history: { absences: number; anomalies: number }) {
    const abs = `${history.absences} recorded ${history.absences === 1 ? "absence" : "absences"}`;
    const anom = `${history.anomalies} attributed ${history.anomalies === 1 ? "anomaly" : "anomalies"}`;
    return `${name} has ${abs} and ${anom}. They stay with a deactivated member and are destroyed by a permanent delete.`;
  }

  /**
   * The trash. An UNSAVED row is just dropped from the grid — there is nothing
   * server-side to lose. A persisted row opens the confirmation, which first
   * reads what a permanent delete would destroy so it can say it.
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
    setPendingRowId(memberId);
    try {
      const history = await getMemberHistoryAction(memberId);
      if (!history.ok) {
        setFormError(history.message);
        return;
      }
      setRemoveTarget({
        index,
        memberId,
        name: row.name || "This member",
        absences: history.absences,
        anomalies: history.anomalies,
        isLastMember: history.isLastMember,
      });
    } catch {
      setFormError("Something went wrong reading that member's history. Please try again.");
    } finally {
      setPendingRowId(null);
    }
  }

  /** Confirmed permanent delete. The service re-checks inside its transaction. */
  async function confirmDelete() {
    if (!removeTarget) return;
    const { memberId, index, name } = removeTarget;
    const result = await deleteMemberAction(memberId);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    remove(index);
    setSelected(new Set());
    toast.success(`Removed ${name} from the team.`);
    router.refresh();
  }

  /** Confirmed deactivation — the non-destructive way out of the same dialog. */
  async function confirmDeactivate() {
    if (!removeTarget) return;
    const { memberId, index, name } = removeTarget;
    const result = await setMemberActiveAction(memberId, false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    form.setValue(`members.${index}.isActive`, false);
    setSelected(new Set());
    toast.success(`Deactivated ${name}.`);
    router.refresh();
  }

  /** Bring a deactivated member back. Nothing at stake, so no confirmation. */
  async function reactivateRow(index: number) {
    setFormError(null);
    const memberId = form.getValues(`members.${index}.id`);
    if (!memberId) return;

    setPendingRowId(memberId);
    try {
      const result = await setMemberActiveAction(memberId, true);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      form.setValue(`members.${index}.isActive`, true);
      toast.success(`Reactivated ${form.getValues(`members.${index}.name`)}.`);
      router.refresh();
    } catch {
      setFormError("Something went wrong reactivating that member. Please try again.");
    } finally {
      setPendingRowId(null);
    }
  }

  /**
   * Merge exactly two selected rows into one (GitHub-only + Jira-only → one).
   *
   * The grid keeps the LOWER index so the remaining index stays stable, which
   * makes the kept row — not the first-selected one — the row whose id must
   * survive. `decideMerge` owns that whole decision; see its header for the two
   * defects it closes.
   */
  function mergeSelected() {
    setFormError(null);
    const ids = [...selected];
    if (ids.length !== 2) return;
    const values = form.getValues("members");
    const idxA = fields.findIndex((f) => f.id === ids[0]);
    const idxB = fields.findIndex((f) => f.id === ids[1]);
    if (idxA < 0 || idxB < 0) return;

    const [keepIdx, dropIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
    const decision = decideMerge(values[keepIdx], values[dropIdx]);

    // Only when BOTH rows are persisted does a DB row genuinely disappear, so
    // only then is this a confirmed server operation.
    if (decision.needsServerMerge && decision.keepId && decision.dropId) {
      setMergeTarget({
        keepIdx,
        dropIdx,
        keepId: decision.keepId,
        dropId: decision.dropId,
        dropName: values[dropIdx].name || "the other row",
        merged: decision.merged,
      });
      return;
    }

    applyMergeToGrid(keepIdx, dropIdx, decision.merged);
  }

  function applyMergeToGrid(
    keepIdx: number,
    dropIdx: number,
    merged: ReturnType<typeof decideMerge>["merged"],
  ) {
    update(keepIdx, merged);
    remove(dropIdx);
    setSelected(new Set());
  }

  /** Confirmed merge of two persisted rows — one of them is deleted for real. */
  async function confirmMerge() {
    if (!mergeTarget) return;
    const { keepId, dropId, merged, keepIdx, dropIdx } = mergeTarget;

    const result = await mergeMembersAction({ keepId, dropId, merged });
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    applyMergeToGrid(keepIdx, dropIdx, merged);
    toast.success(`Merged into ${merged.name}.`);
    router.refresh();
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
      // Adopt the ids the save just assigned. `useForm` seeds from props ONCE at
      // mount, so without this a row inserted by THIS save keeps `id: undefined`
      // until a full remount, and every id-keyed action misfires on it: the trash
      // takes its unsaved-row branch (`removeRow`) and drops it from the grid
      // while it survives in the DB, deactivate/reactivate return early, merge
      // degrades to grid-only, and the next save re-inserts it as a duplicate.
      // `ids` is positionally aligned with what we submitted.
      result.ids.forEach((id, index) => {
        if (!form.getValues(`members.${index}.id`)) {
          form.setValue(`members.${index}.id`, id);
        }
      });

      toast.success(
        `Saved ${members.length} team ${members.length === 1 ? "member" : "members"}.`,
      );
      // The saved roster feeds sibling surfaces (the dashboard's member filter,
      // the Sprint Detail sub-burndowns). Harmless in the wizard, load-bearing on
      // the Settings tab. Repo convention after a successful Server Action —
      // there is no `revalidatePath` anywhere in `src/`.
      router.refresh();
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

        {importSummary ? (
          <p className="text-sm text-muted-foreground" role="status">
            {importSummary}
          </p>
        ) : null}

        {fields.length === 0 && !isImporting ? null : (
          <p className="text-sm text-muted-foreground">
            <strong>Capacity</strong> is this person&apos;s realistic story points for a
            FULL sprint — part-time included, so a half-time developer&apos;s number is
            already halved. SprintFlow scales it down further for recorded absences;
            it never multiplies it by anything.
          </p>
        )}

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
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-10" aria-label="Remove" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => {
                  const isActive = watched?.[index]?.isActive !== false;
                  if (!isActive && !showInactive) return null;
                  return (
                  <TableRow
                    key={field.id}
                    className={isActive ? undefined : "opacity-60"}
                  >
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
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">
                          {originLabel(
                            watched?.[index]?.githubUsername,
                            watched?.[index]?.jiraAccountId,
                          )}
                        </span>
                        {rowFlag(index) === "proposed" ? (
                          <span className="text-xs font-medium text-foreground">
                            New — unsaved
                          </span>
                        ) : null}
                        {rowFlag(index) === "missing" ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              Not in GitHub/Jira any more
                            </span>
                            {watched?.[index]?.id ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() => void deactivateRow(index)}
                                disabled={pendingRowId === watched?.[index]?.id}
                              >
                                Deactivate
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {watched?.[index]?.isActive === false ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-xs text-muted-foreground">Inactive</span>
                          {watched?.[index]?.id ? (
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => void reactivateRow(index)}
                              disabled={pendingRowId === watched?.[index]?.id}
                            >
                              Reactivate
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Active</span>
                      )}
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
                  );
                })}
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
                isActive: true,
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
            onClick={mergeSelected}
            disabled={selected.size !== 2}
          >
            Merge selected
            {selected.size > 0 ? ` (${selected.size})` : null}
          </Button>

          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={showInactive}
              onCheckedChange={(next) => setShowInactive(next === true)}
              aria-label="Show inactive members"
            />
            Show inactive members
          </label>
        </div>
      </CardContent>

      {/* One dialog per destructive operation, rendered outside the table so a
          row unmounting (the merge/delete it just confirmed) cannot take its own
          dialog down mid-transition. */}
      <ConfirmDialog
        open={removeTarget != null}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? "member"}?`}
        description={
          removeTarget
            ? removeTarget.absences === 0 && removeTarget.anomalies === 0
              ? removeTarget.isLastMember
                ? `${removeTarget.name} is your only team member, so they cannot be deleted permanently — the roster cannot be emptied. Deactivating them keeps the record and can be undone at any time.`
                : `${removeTarget.name} has no recorded absences and no anomalies attributed to them, so there is nothing to lose either way. Deactivating keeps the record; deleting removes it for good.`
              : stakesCopy(removeTarget.name, removeTarget)
            : ""
        }
        confirmLabel="Deactivate"
        variant="default"
        onConfirm={confirmDeactivate}
        secondary={
          removeTarget &&
          removeTarget.absences === 0 &&
          removeTarget.anomalies === 0 &&
          !removeTarget.isLastMember
            ? {
                label: "Delete permanently",
                variant: "destructive",
                onConfirm: confirmDelete,
              }
            : undefined
        }
      />

      <ConfirmDialog
        open={mergeTarget != null}
        onOpenChange={(next) => !next && setMergeTarget(null)}
        title="Merge these two rows into one member?"
        description={
          mergeTarget
            ? `"${mergeTarget.dropName}" disappears and its identity key moves onto "${mergeTarget.merged.name}". This cannot be undone — to split them again you would add a row and move the key back.`
            : ""
        }
        confirmLabel="Merge"
        variant="default"
        onConfirm={confirmMerge}
      />

      <CardFooter className="justify-end">
        <Button type="button" onClick={onSave} disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save roster"}
        </Button>
      </CardFooter>
    </Card>
  );
}
