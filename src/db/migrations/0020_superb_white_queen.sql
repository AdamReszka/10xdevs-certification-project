-- S-12 Phase 4: record WHY the daily recap was switched off.
--
-- Closes S-11 plan-review F6. When Resend reports a permanent bounce or a spam
-- complaint for an owner's address, the send is turned off for them — and an
-- unexplained "off" is worse than none: it is indistinguishable from a decision
-- the owner made months ago, so the first thing they do is switch it back on
-- into the same bounce loop.
--
-- BOTH COLUMNS ARE NULLABLE AND THERE IS NO BACKFILL, deliberately. A NULL
-- reason alongside `enabled = false` means the OWNER turned it off themselves,
-- which is the ordinary case and the correct reading of every row that exists
-- today. Backfilling anything here would invent a bounce that never happened.
--
-- Its own migration, separate from 0019, because this phase is severable by
-- design (FR-019 is already met without it) — cutting it must leave no unused
-- columns behind.
ALTER TABLE "recap_settings" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "recap_settings" ADD COLUMN "disabled_at" timestamp;
