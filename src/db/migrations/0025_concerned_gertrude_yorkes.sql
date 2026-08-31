CREATE TABLE "holiday_calendar" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"country_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_calendar_owner_uq" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "holiday_year_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"country_code" text NOT NULL,
	"year" integer NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_year_approval_owner_country_year_uq" UNIQUE("owner_id","country_code","year")
);
--> statement-breakpoint
ALTER TABLE "team_day_off" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_year_approval" ADD CONSTRAINT "holiday_year_approval_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holiday_year_approval_ownerId_idx" ON "holiday_year_approval" USING btree ("owner_id");