CREATE TYPE "public"."refinement_source" AS ENUM('BACKLOG', 'KEYS', 'PASTED_TEXT');--> statement-breakpoint
CREATE TABLE "refinement_run" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source" "refinement_source" NOT NULL,
	"model" text NOT NULL,
	"ticket_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refinement_ticket_verdict" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"ticket_key" text NOT NULL,
	"ticket_summary" text NOT NULL,
	"task_kind" text NOT NULL,
	"verdict" text NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text
);
--> statement-breakpoint
ALTER TABLE "refinement_run" ADD CONSTRAINT "refinement_run_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinement_ticket_verdict" ADD CONSTRAINT "refinement_ticket_verdict_run_id_refinement_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."refinement_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinement_ticket_verdict" ADD CONSTRAINT "refinement_ticket_verdict_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refinement_run_owner_created_idx" ON "refinement_run" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "refinement_verdict_owner_ticket_idx" ON "refinement_ticket_verdict" USING btree ("owner_id","ticket_key");--> statement-breakpoint
CREATE INDEX "refinement_verdict_run_idx" ON "refinement_ticket_verdict" USING btree ("run_id");