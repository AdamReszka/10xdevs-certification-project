import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  RECAP_HISTORY_EMPTY,
  describeRecapRow,
  type RecapHistoryRow,
} from "./recap-history-view";

/**
 * The recap archive (S-12, FR-019). Server component — no interactivity, so no
 * client boundary.
 *
 * Same shape of surface as `sync-history.tsx`: a chronological, newest-first,
 * owner-scoped log in a `Table` inside a `Card`. Rendering only — every
 * judgement about a row is `recap-history-view.ts`'s, because there is no
 * component-test harness here.
 *
 * EVERY ROW, not only the successful ones. A failed send is the most valuable
 * thing on this list; the settings page's last-send line only ever shows the
 * newest one.
 */
export default function RecapHistoryList({ rows }: { rows: RecapHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Past recaps</CardTitle>
        <CardDescription>
          Newest first. SprintFlow keeps the current sprint and the two before it;
          older recaps are purged automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{RECAP_HISTORY_EMPTY}</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>What happened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const view = describeRecapRow(row);
                  return (
                    <TableRow key={row.id} className="relative">
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {/* The WHOLE row is the link target. An `<a>` cannot
                            wrap a `<tr>` — that is not valid table markup — so
                            the anchor lives in the first cell and stretches its
                            own hit area over the positioned row instead. The
                            visible text and the keyboard focus stay on one
                            anchor, which a per-cell link would have split into
                            four. */}
                        <Link
                          href={view.href}
                          className="font-medium underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                          {row.recapDay}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={view.tone}>{view.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {view.when}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{view.detail}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
