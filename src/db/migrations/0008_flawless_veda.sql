ALTER TABLE "absence" ALTER COLUMN "is_planned" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "absence" ALTER COLUMN "is_planned" SET NOT NULL;