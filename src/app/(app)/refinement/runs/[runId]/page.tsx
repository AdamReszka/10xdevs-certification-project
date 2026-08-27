import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import RunPanel from "@/components/organisms/refinement/run-panel";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRun } from "@/lib/refinement/store";

/**
 * One saved refinement run (S-13 phase 6).
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx`.
 *
 * `getRun` returns null for another owner's run, and this page turns that into
 * the SAME 404 a non-existent id gets — telling the two apart would confirm the
 * run exists to someone who cannot read it.
 */
export default async function RefinementRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const run = await getRun(db, session.user.id, runId);
  if (!run) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/refinement"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Refinement
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Refinement run</h1>
      </div>

      <RunPanel
        verdicts={run.verdicts.map((verdict) => ({
          id: verdict.id,
          ticketKey: verdict.ticketKey,
          ticketSummary: verdict.ticketSummary,
          taskKind: verdict.taskKind,
          verdict: verdict.verdict,
          gaps: verdict.gaps,
          droppedClasses: verdict.droppedClasses,
          sourceUrl: verdict.sourceUrl,
        }))}
        source={run.source}
        model={run.model}
        createdAt={run.createdAt.toISOString()}
      />
    </div>
  );
}
