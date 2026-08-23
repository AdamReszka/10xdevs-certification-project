CREATE TABLE "sync_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"integration" "integration" NOT NULL,
	"status" "sync_status" NOT NULL,
	"outcome" text,
	"finished_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_attempt" ADD CONSTRAINT "sync_attempt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_attempt_owner_integration_idx" ON "sync_attempt" USING btree ("owner_id","integration","finished_at");