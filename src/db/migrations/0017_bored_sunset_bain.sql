CREATE TYPE "public"."workspace_mode" AS ENUM('REAL', 'DEMO');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_of" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "active_workspace" "workspace_mode" DEFAULT 'REAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_anchor_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_demo_of_user_id_fk" FOREIGN KEY ("demo_of") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_demo_of_uq" ON "user" USING btree ("demo_of") WHERE "user"."demo_of" is not null;