ALTER TABLE "anomaly" ADD COLUMN "dedup_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_owner_sprint_dedup_uq" UNIQUE("owner_id","sprint_id","dedup_key");