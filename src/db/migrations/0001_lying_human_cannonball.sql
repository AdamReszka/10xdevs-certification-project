CREATE TYPE "public"."absence_type" AS ENUM('VACATION', 'SICKNESS', 'TRAINING');--> statement-breakpoint
CREATE TYPE "public"."anomaly_status" AS ENUM('ACTIVE', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."anomaly_type" AS ENUM('PR_REVIEW_STALLED', 'TICKET_STATUS_AGING', 'DEVELOPER_INACTIVE', 'TICKET_NO_COMMIT_LINK', 'SPRINT_AT_RISK', 'PR_TOO_BIG', 'SCOPE_CREEP', 'PR_TICKET_DESYNC');--> statement-breakpoint
CREATE TYPE "public"."integration" AS ENUM('GITHUB', 'JIRA');--> statement-breakpoint
CREATE TYPE "public"."member_source" AS ENUM('GITHUB', 'JIRA', 'MANUAL', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."pr_state" AS ENUM('OPEN', 'CLOSED', 'MERGED');--> statement-breakpoint
CREATE TYPE "public"."recap_send_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."refinement_source_type" AS ENUM('PASTED_TEXT', 'JIRA_TICKET');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."sprint_state" AS ENUM('ACTIVE', 'CLOSED', 'FUTURE');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('TODO', 'IN_PROGRESS', 'CODE_REVIEW', 'TESTING', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('OK', 'ERROR', 'RATE_LIMITED');--> statement-breakpoint
CREATE TYPE "public"."technology_track" AS ENUM('FRONTEND', 'BACKEND', 'MOBILE', 'QA');--> statement-breakpoint
CREATE TABLE "absence" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"team_member_id" text NOT NULL,
	"sprint_id" text,
	"type" "absence_type" NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"is_planned" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomaly" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sprint_id" text NOT NULL,
	"type" "anomaly_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"description" text,
	"context" jsonb,
	"suggested_action" text,
	"source_url" text,
	"risk_score" integer,
	"related_team_member_id" text,
	"detected_at" timestamp,
	"status" "anomaly_status",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomaly_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"anomaly_type" "anomaly_type" NOT NULL,
	"severity_override" "severity",
	"thresholds" jsonb,
	"is_default" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anomaly_settings_owner_type_uq" UNIQUE("owner_id","anomaly_type")
);
--> statement-breakpoint
CREATE TABLE "daily_recap" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sprint_id" text NOT NULL,
	"recap_date" timestamp,
	"sent_at" timestamp,
	"send_status" "recap_send_status",
	"payload" jsonb,
	"anomaly_ids" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_commit" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"sha" text NOT NULL,
	"author_github_username" text,
	"authored_at" timestamp,
	"additions" integer,
	"deletions" integer,
	"branch" text,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_commit_repo_sha_uq" UNIQUE("repo_id","sha")
);
--> statement-breakpoint
CREATE TABLE "github_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_last4" text,
	"github_login" text,
	"scopes" text,
	"validated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_credential_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "github_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"github_pr_id" bigint NOT NULL,
	"number" integer,
	"title" text,
	"author_github_username" text,
	"state" "pr_state",
	"additions" integer,
	"deletions" integer,
	"changed_files" integer,
	"opened_at" timestamp,
	"merged_at" timestamp,
	"closed_at" timestamp,
	"ready_for_review_at" timestamp,
	"linked_ticket_key" text,
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pr_repo_prid_uq" UNIQUE("repo_id","github_pr_id")
);
--> statement-breakpoint
CREATE TABLE "github_review" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"reviewer_github_username" text,
	"state" "review_state",
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_last4" text,
	"workspace_url" text NOT NULL,
	"jira_email" text NOT NULL,
	"validated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jira_credential_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "jira_project" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"project_key" text NOT NULL,
	"project_name" text,
	"board_id" text,
	CONSTRAINT "jira_project_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "jira_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"from_status_id" text,
	"to_status_id" text,
	"from_category" "status_category",
	"to_category" "status_category",
	"changed_at" timestamp,
	"jira_changelog_id" text,
	CONSTRAINT "jira_status_history_ticket_changelog_uq" UNIQUE("ticket_id","jira_changelog_id")
);
--> statement-breakpoint
CREATE TABLE "jira_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"sprint_id" text,
	"jira_key" text NOT NULL,
	"summary" text,
	"story_points" integer,
	"current_status_id" text,
	"current_category" "status_category",
	"assignee_jira_account_id" text,
	"last_status_change_at" timestamp,
	"added_after_sprint_start" boolean,
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jira_ticket_owner_key_uq" UNIQUE("owner_id","jira_key")
);
--> statement-breakpoint
CREATE TABLE "monitored_repo" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "monitored_repo_owner_repo_uq" UNIQUE("owner_id","github_repo_id")
);
--> statement-breakpoint
CREATE TABLE "refinement_session" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_type" "refinement_source_type" NOT NULL,
	"jira_ticket_key" text,
	"story_text" text,
	"questions" jsonb,
	"dor_score" integer,
	"missing_checklist" jsonb,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"jira_sprint_id" text NOT NULL,
	"name" text,
	"state" "sprint_state",
	"start_date" timestamp,
	"end_date" timestamp,
	"committed_sp" integer,
	"completed_sp" integer,
	"length_days" integer,
	"start_day" text,
	"working_days" jsonb,
	"cadence_overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_owner_sprint_uq" UNIQUE("owner_id","jira_sprint_id")
);
--> statement-breakpoint
CREATE TABLE "status_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"jira_status_id" text NOT NULL,
	"jira_status_name" text NOT NULL,
	"category" "status_category" NOT NULL,
	CONSTRAINT "status_mapping_project_status_uq" UNIQUE("jira_project_id","jira_status_id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"integration" "integration" NOT NULL,
	"last_successful_sync_at" timestamp,
	"last_attempt_at" timestamp,
	"status" "sync_status",
	"last_error" text,
	"jira_history_cursor" text,
	"freshness_window_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_owner_integration_uq" UNIQUE("owner_id","integration")
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"github_username" text,
	"jira_account_id" text,
	"role" text,
	"sp_capacity" integer,
	"technology_track" "technology_track",
	"source" "member_source" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_team_member_id_team_member_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_related_team_member_id_team_member_id_fk" FOREIGN KEY ("related_team_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_settings" ADD CONSTRAINT "anomaly_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD CONSTRAINT "daily_recap_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_recap" ADD CONSTRAINT "daily_recap_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit" ADD CONSTRAINT "github_commit_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit" ADD CONSTRAINT "github_commit_repo_id_monitored_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."monitored_repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_credential" ADD CONSTRAINT "github_credential_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_repo_id_monitored_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."monitored_repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_review" ADD CONSTRAINT "github_review_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_review" ADD CONSTRAINT "github_review_pull_request_id_github_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_credential" ADD CONSTRAINT "jira_credential_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_project" ADD CONSTRAINT "jira_project_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_project" ADD CONSTRAINT "jira_project_credential_id_jira_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."jira_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_status_history" ADD CONSTRAINT "jira_status_history_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_status_history" ADD CONSTRAINT "jira_status_history_ticket_id_jira_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."jira_ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_ticket" ADD CONSTRAINT "jira_ticket_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_ticket" ADD CONSTRAINT "jira_ticket_jira_project_id_jira_project_id_fk" FOREIGN KEY ("jira_project_id") REFERENCES "public"."jira_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_ticket" ADD CONSTRAINT "jira_ticket_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_repo" ADD CONSTRAINT "monitored_repo_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_repo" ADD CONSTRAINT "monitored_repo_credential_id_github_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."github_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinement_session" ADD CONSTRAINT "refinement_session_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_jira_project_id_jira_project_id_fk" FOREIGN KEY ("jira_project_id") REFERENCES "public"."jira_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_mapping" ADD CONSTRAINT "status_mapping_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_mapping" ADD CONSTRAINT "status_mapping_jira_project_id_jira_project_id_fk" FOREIGN KEY ("jira_project_id") REFERENCES "public"."jira_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_member_window_idx" ON "absence" USING btree ("team_member_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "anomaly_owner_sprint_idx" ON "anomaly" USING btree ("owner_id","sprint_id");--> statement-breakpoint
CREATE INDEX "anomaly_type_idx" ON "anomaly" USING btree ("type");--> statement-breakpoint
CREATE INDEX "anomaly_severity_idx" ON "anomaly" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "daily_recap_owner_sprint_idx" ON "daily_recap" USING btree ("owner_id","sprint_id");--> statement-breakpoint
CREATE INDEX "daily_recap_date_idx" ON "daily_recap" USING btree ("recap_date");--> statement-breakpoint
CREATE INDEX "github_commit_owner_authored_idx" ON "github_commit" USING btree ("owner_id","authored_at");--> statement-breakpoint
CREATE INDEX "github_commit_author_idx" ON "github_commit" USING btree ("author_github_username");--> statement-breakpoint
CREATE INDEX "github_pr_owner_state_idx" ON "github_pull_request" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "github_pr_linked_ticket_idx" ON "github_pull_request" USING btree ("linked_ticket_key");--> statement-breakpoint
CREATE INDEX "github_review_pr_idx" ON "github_review" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "github_review_owner_submitted_idx" ON "github_review" USING btree ("owner_id","submitted_at");--> statement-breakpoint
CREATE INDEX "jira_status_history_ticket_changed_idx" ON "jira_status_history" USING btree ("ticket_id","changed_at");--> statement-breakpoint
CREATE INDEX "jira_ticket_sprint_idx" ON "jira_ticket" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "jira_ticket_category_idx" ON "jira_ticket" USING btree ("current_category");--> statement-breakpoint
CREATE INDEX "refinement_session_owner_created_idx" ON "refinement_session" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "team_member_ownerId_idx" ON "team_member" USING btree ("owner_id");