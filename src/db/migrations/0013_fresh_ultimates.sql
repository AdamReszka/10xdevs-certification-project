CREATE TABLE "team_day_off" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"day" date NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_day_off_owner_day_uq" UNIQUE("owner_id","day")
);
--> statement-breakpoint
ALTER TABLE "team_day_off" ADD CONSTRAINT "team_day_off_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_day_off_ownerId_idx" ON "team_day_off" USING btree ("owner_id");