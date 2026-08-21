"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import AnomalyRow from "@/components/organisms/anomaly/anomaly-row";
import SyncStatusBar from "@/components/organisms/dashboard/sync-status-bar";
import {
  distinctTypes,
  filterAnomalies,
  sortAnomalies,
  type MemberFilter,
  type SortKey,
  type TypeFilter,
} from "@/components/organisms/anomaly/inbox-controls";
import {
  TYPE_LABEL,
  type InboxAnomaly,
  type InboxRosterMember,
  type InboxSyncState,
} from "@/components/organisms/anomaly/types";

const SORT_LABEL: Record<SortKey, string> = {
  severity: "Severity (default)",
  age: "Age (newest first)",
  ticket: "Ticket / PR",
  developer: "Developer",
};

/**
 * Anomaly Inbox (S-07) — the Dashboard "Today" headline surface. Renders the
 * server-provided `anomalies` in their default FR-015 order (severity → recency),
 * with client-side re-sort (severity / age / ticket / developer) and filter (type;
 * team member incl. an "Unassigned / team-level" bucket). Above it, the per-
 * integration freshness bar + error banner. Three distinct empty states: no active
 * sprint, active sprint with zero anomalies (healthy), and filtered-to-empty — the
 * inbox is empty ONLY because zero were detected, never because a fetch failed.
 */
export default function AnomalyInbox({
  anomalies,
  roster,
  syncState,
  hasActiveSprint,
}: {
  anomalies: InboxAnomaly[];
  roster: InboxRosterMember[];
  syncState: InboxSyncState;
  hasActiveSprint: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("ALL");

  const typeOptions = useMemo(() => distinctTypes(anomalies), [anomalies]);
  const hasTeamLevel = useMemo(
    () => anomalies.some((a) => a.memberId == null),
    [anomalies],
  );

  const displayed = useMemo(
    () => sortAnomalies(filterAnomalies(anomalies, typeFilter, memberFilter), sortKey),
    [anomalies, typeFilter, memberFilter, sortKey],
  );

  // Empty-state taxonomy — distinct, never conflated with a fetch failure.
  let body: React.ReactNode;
  if (!hasActiveSprint) {
    body = (
      <EmptyState
        title="No active sprint"
        detail="SprintFlow found no active sprint for your Jira project. Point SprintFlow at a project with a running sprint (start + end dates) in setup, and the inbox will populate on the next sync."
      />
    );
  } else if (anomalies.length === 0) {
    body = (
      <EmptyState
        title="No anomalies detected"
        detail="Your sprint is running clean — no workflow anomalies right now. This is the healthy state; new anomalies appear here as soon as a sync detects them."
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <ControlSelect
            id="sort"
            label="Sort by"
            value={sortKey}
            onValueChange={(v) => setSortKey(v as SortKey)}
            options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
              value: k,
              label: SORT_LABEL[k],
            }))}
          />
          <ControlSelect
            id="type"
            label="Type"
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as TypeFilter)}
            options={[
              { value: "ALL", label: "All types" },
              ...typeOptions.map((t) => ({ value: t, label: TYPE_LABEL[t] })),
            ]}
          />
          <ControlSelect
            id="member"
            label="Team member"
            value={memberFilter}
            onValueChange={(v) => setMemberFilter(v as MemberFilter)}
            options={[
              { value: "ALL", label: "All members" },
              ...(hasTeamLevel
                ? [{ value: "UNASSIGNED", label: "Unassigned / team-level" }]
                : []),
              ...roster.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </div>

        {displayed.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No anomalies match the current filters.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {displayed.map((a) => (
              <AnomalyRow key={a.id} anomaly={a} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SyncStatusBar syncState={syncState} />
      <Card>
        <CardHeader>
          <CardTitle>Anomaly Inbox</CardTitle>
          <CardDescription>
            {hasActiveSprint
              ? `${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} detected for the current sprint.`
              : "The 3–5 things to act on today will appear here once a sprint is active."}
          </CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}

function ControlSelect({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
