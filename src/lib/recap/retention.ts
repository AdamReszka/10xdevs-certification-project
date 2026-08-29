import { and, eq, lt } from "drizzle-orm";

import { dailyRecap } from "@/db/schema";
import { dayKeyInTimeZone, type DayKey } from "@/lib/dashboard/day-bucket";
import type { getDb } from "@/lib/db";
import {
  listRecordedSprintsForOwner,
  type SprintMeasurement,
} from "@/lib/measurement/reader";

/**
 * The recap archive's retention rule (S-12, FR-019) — "the current sprint plus
 * the two previous ones", and nothing older.
 *
 * THE PREDICATE IS `recap_day`; THE CUTOFF COMES FROM A SPRINT BOUNDARY. Those
 * are not in tension. Deleting via `daily_recap.sprint_id` would tie retention
 * to rows that cascade away on a Jira project switch — the exact failure this
 * slice's FK reshape repairs (`schema.ts:996-1021`) — while
 * `sprint_measurement` is deliberately FK-free (`schema.ts:471-479`) so it
 * outlives both a project switch and the retention bound. So the sprint series
 * supplies the boundary day and `recap_day` does the deleting.
 *
 * EVERY UNCERTAIN CASE FAILS TOWARD KEEPING DATA. Fewer than three recorded
 * sprints, or a third row with no start date, resolves to NO cutoff and NO
 * delete — never to a cutoff of zero, never to "older than today". Three
 * fail-safe cases follow from that and are all deliberate: a young team, an
 * owner who just switched Jira projects (`listRecordedSprintsForOwner` is scoped
 * to the CURRENTLY monitored project, so the new one has too few records), and
 * an owner the cron no longer enumerates (`scheduled.ts:58-66`) — the last keeps
 * their recaps forever, which is bounded because they have also stopped
 * accumulating new ones.
 *
 * This is the first irreversible deletion in the repo. It is owner-scoped, it is
 * strict at the boundary, and the caller logs what it removed.
 */

type Db = ReturnType<typeof getDb>;

/**
 * The current sprint plus the two previous ones — FR-019's wording, as a number.
 *
 * The series is read newest-first, so the RETAINED_SPRINTS-th entry is the
 * oldest sprint that survives, and its start day is the cutoff.
 */
export const RETAINED_SPRINTS = 3;

/** What {@link purgeOldRecaps} did, so the cron can log a number rather than a
 * boolean. A null `cutoff` means the rule declined to delete anything. */
export type PurgeRecapsResult = {
  cutoff: DayKey | null;
  deleted: number;
};

/**
 * The retention boundary as a `DayKey`, or null when there is not enough history
 * to draw one. PURE — it takes the already-read series so the arithmetic is
 * unit-testable without a database.
 *
 * `sprints` must be newest-first, which is what `listRecordedSprints` guarantees
 * (`measurement/reader.ts:123-132`, `start_date DESC NULLS LAST`).
 *
 * The conversion to the team's zone is not cosmetic: `recap_day` is a local
 * `DayKey` (`schema.ts:1023-1031`), so comparing it against a UTC-derived day
 * would delete or spare a whole day's recap at every boundary for a team east of
 * UTC.
 */
export function resolveRetentionCutoff(
  sprints: readonly Pick<SprintMeasurement, "startDate">[],
  timeZone?: string | null,
): DayKey | null {
  if (sprints.length < RETAINED_SPRINTS) return null;

  const oldestRetained = sprints[RETAINED_SPRINTS - 1];
  if (!oldestRetained?.startDate) return null;

  return dayKeyInTimeZone(oldestRetained.startDate, timeZone);
}

/**
 * Delete the owner's recaps older than the retention boundary.
 *
 * The `lt` is STRICT and load-bearing: the boundary day belongs to the oldest
 * retained sprint and must survive.
 *
 * An empty or short series is the ordinary state of a young team, not an error —
 * it returns `{ cutoff: null, deleted: 0 }` and touches nothing.
 */
export async function purgeOldRecaps({
  db,
  ownerId,
  timeZone,
}: {
  db: Db;
  ownerId: string;
  timeZone?: string | null;
}): Promise<PurgeRecapsResult> {
  // Exactly RETAINED_SPRINTS rows: the cutoff is the last of them and nothing
  // older is ever consulted.
  const sprints = await listRecordedSprintsForOwner(db, ownerId, RETAINED_SPRINTS);
  const cutoff = resolveRetentionCutoff(sprints, timeZone);
  if (cutoff === null) return { cutoff: null, deleted: 0 };

  // `owner_id` is the isolation — there is no RLS behind this table
  // (`recap-settings.ts:9-22`). `returning` gives a portable count without
  // depending on the driver's `rowCount` shape.
  const deleted = await db
    .delete(dailyRecap)
    .where(and(eq(dailyRecap.ownerId, ownerId), lt(dailyRecap.recapDay, cutoff)))
    .returning({ id: dailyRecap.id });

  return { cutoff, deleted: deleted.length };
}
