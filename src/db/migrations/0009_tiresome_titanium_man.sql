CREATE TABLE "recap_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"send_hour" integer DEFAULT 15 NOT NULL,
	"send_minute" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recap_settings_owner_uq" UNIQUE("owner_id")
);
--> statement-breakpoint
DROP INDEX "daily_recap_date_idx";--> statement-breakpoint
-- Clear before the NOT NULL adds (the 0008_flawless_veda.sql:2-7 convention).
-- `daily_recap` was provisioned in 0001 and has NEVER been written by any code
-- path — verified as zero INSERTs across `src/`, `scripts/` and `e2e/` — so
-- there is nothing to backfill and no product data at risk here. The statement
-- exists only so a developer's hand-inserted experiment row cannot abort
-- `ADD COLUMN "recap_day" text NOT NULL` on their machine while CI, which starts
-- from an empty database, passes.
DELETE FROM "daily_recap";--> statement-breakpoint
ALTER TABLE "daily_recap" ALTER COLUMN "send_status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "daily_recap" ALTER COLUMN "send_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD COLUMN "recap_day" text NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD COLUMN "rendered_message" jsonb;--> statement-breakpoint
ALTER TABLE "recap_settings" ADD CONSTRAINT "recap_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_recap" DROP COLUMN "recap_date";--> statement-breakpoint
ALTER TABLE "daily_recap" ADD CONSTRAINT "daily_recap_owner_day_uq" UNIQUE("owner_id","recap_day");