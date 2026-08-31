import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { holidayCalendar, holidayYearApproval } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Owner-scoped reads and writes for the account's country and its per-year
 * holiday approvals (S-17, FR-007).
 *
 * The request-context-free service core: `{ db, ownerId }` explicit, no session,
 * no Cloudflare context — the same shape as `team-day-off-store.ts` and
 * `absence-store.ts`.
 *
 * EVERY READ AND EVERY WRITE CARRIES `AND owner_id = ?`, so a foreign id touches
 * nothing. Defence in depth on the PRD's cross-account guarantee, not a
 * substitute for the caller resolving the owner.
 *
 * THE WRITES TAKE A `Writer`, so the approval can stamp the year inside the SAME
 * transaction that inserts the day-off rows. A half-applied approval — days
 * written, year unstamped, or the reverse — would leave a year that looks
 * decided with only some of its days present, and the next render would re-offer
 * exactly the days the lead had already approved.
 */

type Db = ReturnType<typeof getDb>;

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run a statement — the pool or an open transaction. */
type Writer = Db | Tx;

/**
 * The account's country, or `null` when the lead has not picked one.
 *
 * `null` IS THE ANSWER, not a failure: no row means "no jurisdiction chosen
 * yet", which is the state the dashboard offers to fix. There is deliberately no
 * fallback country — see the table's header.
 */
export async function getHolidayCalendar({
  db,
  ownerId,
}: {
  db: Writer;
  ownerId: string;
}): Promise<string | null> {
  const [row] = await db
    .select({ countryCode: holidayCalendar.countryCode })
    .from(holidayCalendar)
    .where(eq(holidayCalendar.ownerId, ownerId));

  return row?.countryCode ?? null;
}

/**
 * Set (or change) the account's country.
 *
 * UPSERT on the owner-unique key rather than a read-then-write, which would
 * race two saves into a constraint violation the lead would see as an error on
 * a form that worked.
 *
 * CHANGING THE COUNTRY DESTROYS NOTHING. Approvals are keyed by country, so a
 * switch re-opens every year under the new rules; day-off rows derived under the
 * old country stay exactly where they are, because they are days the team was
 * off and removing them would be the lead's-choice-replaced failure this slice
 * exists to prevent.
 */
export async function setHolidayCountry({
  db,
  ownerId,
  countryCode,
}: {
  db: Writer;
  ownerId: string;
  countryCode: string;
}): Promise<void> {
  await db
    .insert(holidayCalendar)
    .values({ id: randomUUID(), ownerId, countryCode })
    .onConflictDoUpdate({
      target: holidayCalendar.ownerId,
      set: { countryCode, updatedAt: new Date() },
    });
}

/**
 * The years this owner has already decided about UNDER THIS COUNTRY.
 *
 * A `Set` because every caller asks one question — "is this year approved?" —
 * once per year in the window under consideration.
 *
 * Filtered by country in the SQL, not by the caller: an approval made under a
 * different country must not close a year under the current one, and leaving
 * that to a caller's discipline is how it would eventually be forgotten.
 */
export async function listApprovedYears({
  db,
  ownerId,
  countryCode,
}: {
  db: Writer;
  ownerId: string;
  countryCode: string;
}): Promise<Set<number>> {
  const rows = await db
    .select({ year: holidayYearApproval.year })
    .from(holidayYearApproval)
    .where(
      and(
        eq(holidayYearApproval.ownerId, ownerId),
        eq(holidayYearApproval.countryCode, countryCode),
      ),
    );

  return new Set(rows.map((r) => r.year));
}

/**
 * Stamp a year as decided about.
 *
 * IDEMPOTENT. `ON CONFLICT DO NOTHING` against the
 * `(owner_id, country_code, year)` key makes a second approval of the same year
 * a no-op and keeps the FIRST `approved_at` — the date the decision was actually
 * made — rather than sliding it forward on every re-submit.
 *
 * Takes a `Writer` so the caller can run it inside the transaction that writes
 * the days themselves.
 */
export async function approveHolidayYear({
  db,
  ownerId,
  countryCode,
  year,
}: {
  db: Writer;
  ownerId: string;
  countryCode: string;
  year: number;
}): Promise<void> {
  await db
    .insert(holidayYearApproval)
    .values({ id: randomUUID(), ownerId, countryCode, year })
    .onConflictDoNothing({
      target: [
        holidayYearApproval.ownerId,
        holidayYearApproval.countryCode,
        holidayYearApproval.year,
      ],
    });
}
