ALTER TABLE "absence" ALTER COLUMN "is_planned" SET DEFAULT true;--> statement-breakpoint
-- Backfill before the constraint (impl-review F5). `is_planned` was created
-- nullable in 0001 and SET DEFAULT does not rewrite existing NULLs, so without
-- this the next statement aborts with `contains null values` on any environment
-- that already holds a row. Every pre-S-08 absence predates the "unplanned"
-- concept entirely, so `true` (planned) is the only honest backfill.
UPDATE "absence" SET "is_planned" = true WHERE "is_planned" IS NULL;--> statement-breakpoint
ALTER TABLE "absence" ALTER COLUMN "is_planned" SET NOT NULL;