"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AnomalyRow from "@/components/organisms/anomaly/anomaly-row";
import type {
  InboxAnomaly,
  InboxRosterMember,
  InboxSyncState,
} from "@/components/organisms/anomaly/types";

/**
 * Anomaly Inbox (S-07) — the Dashboard "Today" headline surface. Renders the
 * server-provided `anomalies` in their default FR-015 order (severity → recency).
 * Client re-sort / filter, the freshness bar, and the empty-state taxonomy arrive
 * in Phase 4; this phase is render-only.
 */
export default function AnomalyInbox({
  anomalies,
}: {
  anomalies: InboxAnomaly[];
  roster: InboxRosterMember[];
  syncState: InboxSyncState;
  hasActiveSprint: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Anomaly Inbox</CardTitle>
        <CardDescription>
          {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"} detected
          for the current sprint.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {anomalies.map((a) => (
            <AnomalyRow key={a.id} anomaly={a} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
