"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLUMNS,
  CATEGORY_LABEL,
  DEFAULT_SORT,
  formatDuration,
  hasUnknownTime,
  nextSortState,
  sortAgingRows,
  type AgingRow,
  type AgingSortKey,
} from "@/components/organisms/dashboard/aging-report-controls";
import type { CategoryKey } from "@/lib/dashboard/time-in-status";

/**
 * Surface A — the Workflow Health aging report (S-10, FR-017).
 *
 * Tickets ordered by time-since-last-movement with cumulative time in each
 * category inline. FR-017 explicitly defers the per-status heatmap to phase 2;
 * these are numeric columns.
 *
 * All sort state and duration formatting live in `aging-report-controls.ts` —
 * this component only renders.
 */

type SortState = { key: AgingSortKey; direction: "asc" | "desc" };

/**
 * A sortable column header. Declared at module scope, not inside the organism:
 * a component created during render is a new type on every pass and would reset
 * its subtree's state.
 *
 * `aria-sort` belongs on the `th`, not on the button inside it — the button's
 * implicit role does not support the attribute.
 */
function SortableHead({
  sortKey,
  sort,
  onSort,
  children,
  numeric = false,
}: {
  sortKey: AgingSortKey;
  sort: SortState;
  onSort: (key: AgingSortKey) => void;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={cn("whitespace-nowrap", numeric && "text-right")}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring",
          active ? "text-foreground" : "text-muted-foreground",
          numeric && "flex-row-reverse",
        )}
      >
        {children}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

export default function AgingReport({ rows }: { rows: AgingRow[] }) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const onSort = (key: AgingSortKey) => setSort((s) => nextSortState(s, key));

  // The UNKNOWN column appears only when a mapping gap actually exists (F4), so
  // a well-mapped project sees exactly the five columns FR-017 describes.
  const columns = useMemo(
    () => (hasUnknownTime(rows) ? CATEGORY_COLUMNS : CATEGORY_COLUMNS.filter((c) => c.key !== "UNKNOWN")),
    [rows],
  );
  const sorted = useMemo(() => sortAgingRows(rows, sort.key, sort.direction), [rows, sort]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow health</CardTitle>
        <CardDescription>
          {rows.length === 0
            ? "No open tickets in this sprint — nothing is aging."
            : `${rows.length} open ticket${rows.length === 1 ? "" : "s"}, sorted by time since last movement. Completed tickets are excluded.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tickets appear here once the sprint has open work. A ticket leaves this
            table when it reaches Done.
          </p>
        ) : (
          // 10-inch tablet floor (NFR): the wide table scrolls inside its own
          // container so the page body never scrolls horizontally.
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead sortKey="jiraKey" sort={sort} onSort={onSort}>Ticket</SortableHead>
                  <SortableHead sortKey="summary" sort={sort} onSort={onSort}>Summary</SortableHead>
                  <SortableHead sortKey="storyPoints" sort={sort} onSort={onSort} numeric>
                    SP
                  </SortableHead>
                  <SortableHead sortKey="currentCategory" sort={sort} onSort={onSort}>Status</SortableHead>
                  <SortableHead sortKey="sinceLastMove" sort={sort} onSort={onSort} numeric>
                    Since last move
                  </SortableHead>
                  {columns.map((c) => (
                    <SortableHead key={c.key} sortKey={`category:${c.key}`} sort={sort} onSort={onSort} numeric>
                      {c.label}
                    </SortableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.ticketId}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {r.sourceUrl ? (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {r.jiraKey}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : (
                        r.jiraKey
                      )}
                    </TableCell>
                    <TableCell className="max-w-[28ch] truncate" title={r.summary ?? undefined}>
                      {r.summary ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.storyPoints ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={r.currentCategory === null ? "outline" : "secondary"}>
                        {CATEGORY_LABEL[(r.currentCategory ?? "UNKNOWN") as CategoryKey]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                      {formatDuration(r.sinceLastMoveMs)}
                    </TableCell>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className="text-right tabular-nums whitespace-nowrap text-muted-foreground"
                      >
                        {formatDuration(r.byCategory[c.key] ?? 0)}
                      </TableCell>
                    ))}
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
