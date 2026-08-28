CREATE TABLE "sprint_measurement" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"jira_sprint_id" text NOT NULL,
	"sprint_name" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"working_days" integer,
	"capacity_full_md" numeric(8, 2),
	"capacity_adjusted_md" numeric(8, 2),
	"capacity_override_md" numeric(8, 2),
	"committed_sp" integer,
	"delivered_sp" integer,
	"delivered_sp_corrected" integer,
	"committed_frozen_at" timestamp,
	"state" "sprint_state",
	"finalized_at" timestamp,
	"measured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_measurement_owner_sprint_uq" UNIQUE("owner_id","jira_sprint_id")
);
--> statement-breakpoint
ALTER TABLE "sprint_measurement" ADD CONSTRAINT "sprint_measurement_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_measurement_series_idx" ON "sprint_measurement" USING btree ("owner_id","jira_project_id","start_date");