import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import RecapMessageFrame from "@/components/organisms/settings/recap-message-frame";
import {
  describeRecapRow,
  readRecapHeaderFacts,
} from "@/components/organisms/settings/recap-history-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { getRecap } from "@/lib/recap/history";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * One stored recap (S-12, FR-019), shown as it was sent.
 *
 * Gated server component under `(app)/settings`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` and its container from
 * `settings/layout.tsx`.
 *
 * `getRecap` returns null for another owner's recap AND for one that does not
 * exist, and this page turns both into the SAME 404 — telling them apart would
 * confirm the row exists to someone who cannot read it
 * (`refinement/runs/[runId]/page.tsx:16-19`).
 *
 * The header facts that come out of `payload` are read only when this build
 * wrote its shape; `readRecapHeaderFacts` owns that check. The message below
 * them is the frozen bytes either way — bytes are not a shape.
 */
export default async function RecapDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const { ownerId } = await resolveWorkspace();

  const recap = await getRecap(db, ownerId, id);
  if (!recap) notFound();

  const row = {
    id: recap.id,
    recapDay: recap.recapDay,
    sendStatus: recap.sendStatus,
    sentAt: recap.sentAt?.toISOString() ?? null,
    attemptCount: recap.attemptCount,
    lastAttemptAt: recap.lastAttemptAt?.toISOString() ?? null,
    hasRenderedMessage: recap.hasRenderedMessage,
  };
  const view = describeRecapRow(row);
  const facts = readRecapHeaderFacts(row, recap.payload);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/settings/recap/history"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Recap history
        </Link>
        <h2 className="text-lg font-medium">Recap for {recap.recapDay}</h2>
        <p className="text-sm text-muted-foreground">{view.detail}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this recap was about</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Sprint: </span>
            {facts.sprintName ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Anomalies in the email: </span>
            {facts.anomalyCount ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Assembled: </span>
            {facts.generatedAt ?? "—"}
          </p>
          {facts.payloadReadable ? null : (
            // Not an error. The version marker exists so an older or newer
            // payload can still be listed and read; what it cannot do is have
            // its fields pulled out by a build that does not know its shape.
            <p className="text-muted-foreground">
              This recap&apos;s stored summary was written by a different version of
              SprintFlow, so the details above are taken from the send itself. The
              message below is unaffected — it is the email that was sent.
            </p>
          )}
        </CardContent>
      </Card>

      <RecapMessageFrame message={recap.renderedMessage} statusDetail={view.detail} />
    </div>
  );
}
