import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import RecapHistoryList from "@/components/organisms/settings/recap-history-list";
import { getDb } from "@/lib/db";
import { listRecaps } from "@/lib/recap/history";
import { resolveWorkspace } from "@/lib/workspace";

/**
 * The recap archive (S-12, FR-019) — every past daily recap, newest first.
 *
 * Gated server component under `(app)/settings`: inherits `requireSession()` +
 * `force-dynamic` from `(app)/layout.tsx` and its page container from
 * `settings/layout.tsx` — do NOT re-declare any of the three.
 *
 * It sits UNDER `/settings/recap` rather than beside it so
 * `settings-tabs.tsx:26`'s prefix match keeps the Daily recap tab highlighted
 * with no new tab entry: this is the same concept, one level down.
 *
 * No pagination. FR-019 bounds retention to the current sprint plus the two
 * before it, so the list is bounded by construction — `DEFAULT_RECAP_LIST_LIMIT`
 * is a guard against a row set that outgrew that bound, not a page size.
 */
export default async function RecapHistoryPage() {
  const { env } = getCloudflareContext();
  const db = getDb(env);
  const { ownerId } = await resolveWorkspace();

  const rows = await listRecaps(db, ownerId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/settings/recap"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Daily recap
        </Link>
        <h2 className="text-lg font-medium">Recap history</h2>
        <p className="text-sm text-muted-foreground">
          Every recap SprintFlow has produced for you — the ones that went out and
          the ones that did not. Open any of them to read the email exactly as it
          was sent.
        </p>
      </div>

      <RecapHistoryList
        rows={rows.map((row) => ({
          id: row.id,
          recapDay: row.recapDay,
          sendStatus: row.sendStatus,
          // Dates cross the RSC boundary as ISO strings, per the convention
          // stated at `settings/recap/page.tsx:57-61`.
          sentAt: row.sentAt?.toISOString() ?? null,
          attemptCount: row.attemptCount,
          lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
          hasRenderedMessage: row.hasRenderedMessage,
        }))}
      />
    </div>
  );
}
