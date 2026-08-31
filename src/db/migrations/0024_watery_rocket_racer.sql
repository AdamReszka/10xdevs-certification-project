-- S-32 — the cadence a lead chose has exactly one home in the database.
--
-- Drops the two columns S-30 superseded and deliberately left behind:
-- `sprint.working_days` (a second copy of `DEFAULT_CADENCE.workingDays`, since
-- Jira exposes no working-days field) and `sprint.cadence_overridden` (one
-- boolean where provenance is per field). The lead's chosen pattern lives in
-- `sprint_cadence_override`, which carries no foreign key into the sync graph
-- and therefore survives a disconnect. `sprint.length_days` / `start_day` are
-- NOT dropped — they remain the derived cache the resolver reads as tier 3.
--
-- `src/lib/cadence-override-readers.test.ts`, the source scan that guarded these
-- columns against a new reader, was deleted in the same PR. It is replaced by
-- this schema constraint rather than renewed, because a regex over source has
-- blind spots the database does not: its flag pattern was camelCase, so it could
-- not see the snake-case SQL of the `0023` backfill, and its receiver pattern
-- matched a READ off a sprint-named receiver, so it could not see
-- `saveCadence`'s `update(sprint).set({ workingDays })` — a write by object key.
--
-- `0023_flowery_flatman.sql` still reads both columns and stays correct: the
-- chain runs it before this file, against a database that still has them.
--
-- APPLYING THIS SPENDS S-30's ESCAPE HATCH. The columns were kept so a revert of
-- S-30 would be a code revert; once this runs, reverting to any pre-S-32 commit
-- fails HARD rather than silently — `reconcile-sprint.ts` at that commit emits an
-- INSERT naming both columns, so every reconcile errors 42703 (column does not
-- exist). Recovery is a hand-written re-add migration, not `git revert`.

ALTER TABLE "sprint" DROP COLUMN "working_days";--> statement-breakpoint
ALTER TABLE "sprint" DROP COLUMN "cadence_overridden";
