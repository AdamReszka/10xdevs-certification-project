ALTER TABLE "team_member" ADD COLUMN "fte" numeric(3, 2) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "fte_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "team_member" DROP COLUMN "sp_capacity";