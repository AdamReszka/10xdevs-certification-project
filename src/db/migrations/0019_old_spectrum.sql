-- S-12 (FR-019): make the recap archive outlive its sprint.
--
-- `daily_recap.sprint_id` was NOT NULL + ON DELETE CASCADE, so a Jira PROJECT
-- SWITCH — which deletes the owner's `sprint` rows — cascaded away both today's
-- claim row (producing a SECOND email for the same local day) and every stored
-- recap for that sprint. S-11 accepted that at plan-review F5 and assigned the
-- fix here by name.
--
-- UNLIKE 0009, THIS MIGRATION MUST NOT DELETE ANYTHING. 0009 could `DELETE FROM
-- "daily_recap"` because the table had never been written by any code; it now
-- holds real sends, and they are the history this slice exists to show. The FK
-- cannot be altered in place, so it is dropped and recreated — inside the
-- migration's transaction the column is briefly unconstrained, which is safe
-- because no other statement here writes to it.
--
-- The index goes because it has no remaining consumer: the retention purge is
-- keyed to `recap_day` (deleting via `sprint_id` would tie retention to rows
-- that cascade away — the exact failure being repaired), and the history listing
-- rides `daily_recap_owner_day_uq(owner_id, recap_day)`, which already serves
-- both the owner equality and the day ordering.
ALTER TABLE "daily_recap" DROP CONSTRAINT "daily_recap_sprint_id_sprint_id_fk";
--> statement-breakpoint
DROP INDEX "daily_recap_owner_sprint_idx";--> statement-breakpoint
ALTER TABLE "daily_recap" ALTER COLUMN "sprint_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD CONSTRAINT "daily_recap_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE set null ON UPDATE no action;
