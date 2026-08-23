import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SyncAttemptView } from "@/lib/settings/connections";

/**
 * Recent sync attempts per integration (S-10 Phase 8). Server component — no
 * interactivity, so no client boundary.
 *
 * This is the "why did it fail an hour ago" answer that `sync_state` cannot
 * give: that table holds one row per integration, overwritten every cycle.
 *
 * Rows carry a status and an optional skip reason, never an error message —
 * the table has no such column, by design.
 */

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "default"> = {
  OK: "secondary",
  ERROR: "destructive",
  RATE_LIMITED: "default",
};

function formatAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export default function SyncHistory({
  github,
  jira,
}: {
  github: SyncAttemptView[];
  jira: SyncAttemptView[];
}) {
  const rows = [
    ...github.map((a) => ({ ...a, integration: "GitHub" })),
    ...jira.map((a) => ({ ...a, integration: "Jira" })),
  ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sync attempts</CardTitle>
        <CardDescription>
          The last cycles for both integrations, newest first. Older entries are
          pruned automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sync has run yet for this account. Use &ldquo;Sync now&rdquo; above,
            or wait for the next scheduled cycle.
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.integration}-${r.finishedAt}-${i}`}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatAt(r.finishedAt)}
                    </TableCell>
                    <TableCell>{r.integration}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>
                        {r.status === "RATE_LIMITED" ? "Rate-limited" : r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.outcome ? r.outcome.replace(/_/g, " ") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
