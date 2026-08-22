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
import { UNKNOWN_MEMBER_ID, type ActivityGrid } from "@/lib/dashboard/activity-grid";

/**
 * Surface E — Yesterday's Activity (S-10, FR-016).
 *
 * A plain server component: no interactivity, so no client boundary. Reads a
 * single zone-local day from the same M2 rollup the Sprint Detail matrix uses.
 *
 * Every roster member gets a row, including those with nothing to show. US-01's
 * "no zero rows for developers who were active" cuts both ways — a developer's
 * absence from yesterday is information the lead needs at the morning sync, and
 * omitting the row would hide it.
 */

export default function YesterdayActivity({
  grid,
  dayKey,
}: {
  grid: ActivityGrid;
  dayKey: string;
}) {
  const cellsFor = (row: ActivityGrid["rows"][number]) =>
    row.cells[dayKey] ?? {
      commits: 0,
      additions: null,
      deletions: null,
      prsOpened: 0,
      prsMerged: 0,
      reviews: 0,
    };

  const hasAnyActivity = grid.rows.some((r) => {
    const c = cellsFor(r);
    return c.commits > 0 || c.prsOpened > 0 || c.prsMerged > 0 || c.reviews > 0;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yesterday&apos;s activity</CardTitle>
        <CardDescription>
          Commits, pull requests, and reviews for {dayKey} in the team&apos;s time
          zone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grid.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No team members yet. Import a roster in setup and this table fills in.
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Developer</TableHead>
                  <TableHead className="text-right">Commits</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">PRs opened</TableHead>
                  <TableHead className="text-right">PRs merged</TableHead>
                  <TableHead className="text-right">Reviews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.rows.map((row) => {
                  const c = cellsFor(row);
                  const unmatched = row.memberId === UNKNOWN_MEMBER_ID;
                  const lines =
                    c.additions === null && c.deletions === null
                      ? null
                      : (c.additions ?? 0) + (c.deletions ?? 0);
                  return (
                    <TableRow key={row.memberId}>
                      <TableCell
                        className={cn(
                          "font-medium whitespace-nowrap",
                          unmatched && "font-normal text-muted-foreground italic",
                        )}
                      >
                        {row.memberName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.commits}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {/* Null is "not measured", never 0 — the per-commit stat
                            fetch is capped per repo and never backfilled. */}
                        {lines === null ? (
                          <span title="Not measured">—</span>
                        ) : (
                          lines
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.prsOpened}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.prsMerged}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.reviews}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {grid.rows.length > 0 && !hasAnyActivity ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing recorded for {dayKey}. A quiet day is itself worth noticing —
            check whether the team was blocked, in meetings, or away.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
