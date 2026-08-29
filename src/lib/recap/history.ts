import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { dailyRecap } from "@/db/schema";
import type { RecapPayload, RenderedEmail } from "@/lib/recap/types";

/**
 * Owner-scoped reads for the recap archive (S-12, FR-019) — the `listRecaps` /
 * `getRecap` pair `/settings/recap/history` and its drill-in render from.
 *
 * Two rules hold across both functions, copied from `refinement/store.ts:15-29`
 * because this is the same list→detail shape:
 *
 * 1. **Every query carries `owner_id`.** There is no RLS behind this table
 *    (`recap-settings.ts:9-22`); the predicate IS the isolation. The cross-owner
 *    specs exist to make a forgotten predicate fail loudly rather than quietly
 *    leak.
 * 2. **Another owner's row is indistinguishable from a missing one.** Both are
 *    `null`, so the page can only ever produce the same 404 — distinguishing
 *    them would confirm the row exists to someone who cannot read it
 *    (`refinement/runs/[runId]/page.tsx:16-19`).
 *
 * Dates stay `Date` here. Serializing them to ISO strings is the page's job, at
 * the RSC boundary — the rule `settings/recap/page.tsx:57-61` already states.
 */

/** Structural, so this module is callable from a page, a script or a test
 * without any of them agreeing on a schema-wide type. */
type Db = NodePgDatabase<Record<string, never>>;

/**
 * The retention bound is the current sprint plus the two previous ones
 * (FR-019), i.e. roughly 30–60 daily rows, so the list is bounded by
 * construction and needs no pager. The limit is a guard against a row set that
 * outgrew its bound (an owner the cron's purge never reaches — see
 * `recap/retention.ts`), not a page size.
 */
export const DEFAULT_RECAP_LIST_LIMIT = 100;

/** One row of the history list. Deliberately excludes `payload` and
 * `rendered_message` — kilobytes of JSONB per row that the list never renders. */
export type RecapListRow = {
  id: string;
  recapDay: string;
  sendStatus: "PENDING" | "SENT" | "FAILED";
  sentAt: Date | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  /**
   * Whether `rendered_message` is present, derived in SQL so the list can mark a
   * contentless row without pulling the bytes it is asking about.
   *
   * It is genuinely absent for two states, both from `recap/send.ts`: between
   * the claim and the render-persist (`:143-155`), and forever on a row that
   * failed at the recipient check (`:223-231`). A list that assumed content
   * would render those as broken rather than as what they are.
   */
  hasRenderedMessage: boolean;
};

/** The full row the detail page renders, including the frozen bytes. */
export type RecapDetail = RecapListRow & {
  payload: RecapPayload | null;
  renderedMessage: RenderedEmail | null;
  anomalyIds: string[] | null;
  createdAt: Date;
};

/**
 * The owner's recaps, newest local day first — **every row, not only the
 * successful ones**. A failed send is the most valuable thing on this list, and
 * the settings page's last-send line only ever shows the newest.
 */
export async function listRecaps(
  db: Db,
  ownerId: string,
  limit: number = DEFAULT_RECAP_LIST_LIMIT,
): Promise<RecapListRow[]> {
  return db
    .select({
      id: dailyRecap.id,
      recapDay: dailyRecap.recapDay,
      sendStatus: dailyRecap.sendStatus,
      sentAt: dailyRecap.sentAt,
      attemptCount: dailyRecap.attemptCount,
      lastAttemptAt: dailyRecap.lastAttemptAt,
      hasRenderedMessage: sql<boolean>`${isNotNull(dailyRecap.renderedMessage)}`,
    })
    .from(dailyRecap)
    .where(eq(dailyRecap.ownerId, ownerId))
    // `recap_day` is `YYYY-MM-DD`, so the lexicographic sort IS the
    // chronological one — the reasoning already recorded at
    // `recap-settings.ts:145-146`. No cast, and it rides
    // `daily_recap_owner_day_uq(owner_id, recap_day)`.
    .orderBy(desc(dailyRecap.recapDay))
    .limit(limit);
}

/**
 * One recap with its payload and its frozen bytes, or `null`.
 *
 * `null` covers BOTH "no such recap" and "not this owner's recap", on purpose
 * and identically — see rule 2 in the module comment. Callers turn it into a
 * 404 without branching on which it was.
 *
 * A row whose `payload` and `rendered_message` are NULL is a normal result, not
 * an error: see {@link RecapListRow.hasRenderedMessage}.
 */
export async function getRecap(
  db: Db,
  ownerId: string,
  id: string,
): Promise<RecapDetail | null> {
  const [row] = await db
    .select({
      id: dailyRecap.id,
      recapDay: dailyRecap.recapDay,
      sendStatus: dailyRecap.sendStatus,
      sentAt: dailyRecap.sentAt,
      attemptCount: dailyRecap.attemptCount,
      lastAttemptAt: dailyRecap.lastAttemptAt,
      hasRenderedMessage: sql<boolean>`${isNotNull(dailyRecap.renderedMessage)}`,
      payload: dailyRecap.payload,
      renderedMessage: dailyRecap.renderedMessage,
      anomalyIds: dailyRecap.anomalyIds,
      createdAt: dailyRecap.createdAt,
    })
    .from(dailyRecap)
    .where(and(eq(dailyRecap.id, id), eq(dailyRecap.ownerId, ownerId)))
    .limit(1);

  return row ?? null;
}
