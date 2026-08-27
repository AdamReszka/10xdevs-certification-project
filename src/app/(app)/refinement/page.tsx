import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import RefinementForm from "@/components/organisms/refinement/refinement-form";
import { resolveApiKey } from "@/lib/anthropic";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MAX_TICKETS_PER_RUN } from "@/lib/refinement/analyze";
import { loadBacklog } from "@/lib/refinement/backlog";
import { listRuns } from "@/lib/refinement/store";

/**
 * Refinement Helper (S-13, FR-020/FR-021) — pick tickets, run, read verdicts.
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` — do NOT re-declare either.
 *
 * The backlog read happens HERE rather than behind a button so the list is on
 * screen at first paint, and it is a `BacklogResult` rather than a throw so a
 * Jira failure degrades to a banner with the other two input routes still
 * working. `resolveApiKey` is checked through the REAL resolver (`lessons.md`
 * #7) so a missing key is stated before the lead picks anything, not discovered
 * after.
 */
export default async function RefinementPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const ownerId = session.user.id;

  const [backlog, runs] = await Promise.all([
    loadBacklog({ db, ownerId, env }),
    listRuns(db, ownerId, 10),
  ]);

  const aiConfigured =
    resolveApiKey(env as { ANTHROPIC_API_KEY?: string }) !== undefined;

  return (
    // The `max-w-6xl` container is the page's own job: `AppShell` leaves
    // `<main>` unconstrained, and every gated route under `(app)` carries this
    // exact class list (`dashboard/page.tsx`, `settings/layout.tsx`). Without
    // it the surface runs edge to edge and reads as unstyled.
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Refinement</h1>
        <p className="text-muted-foreground">
          Pick tickets and each one comes back with a readiness verdict — DOR met,
          the specific gaps that block it, or that it should not enter the sprint
          at all. Every gap names something from that ticket&apos;s own content.
        </p>
      </div>

      <RefinementForm
        backlog={backlog}
        maxTickets={MAX_TICKETS_PER_RUN}
        aiConfigured={aiConfigured}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No refinement has been run on this account yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/refinement/runs/${run.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">
                    {run.ticketCount} {run.ticketCount === 1 ? "ticket" : "tickets"}
                  </span>
                  <span className="text-muted-foreground">{run.model}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
