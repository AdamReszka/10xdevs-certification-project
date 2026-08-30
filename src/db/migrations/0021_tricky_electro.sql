-- S-26: disconnecting an integration stops destroying the lead's own data.
--
-- Two referential actions move from CASCADE to SET NULL, for the same reason
-- 0019 moved `daily_recap.sprint_id`: the rows being destroyed are not the
-- disconnected integration's to destroy.
--
--   * `absence.sprint_id` — hand-entered FR-010 data. `absence-store.ts` stamps
--     every new absence with the active sprint, so a Jira disconnect (which
--     cascades jira_credential → jira_project → sprint) was wiping effectively
--     every absence the lead had ever typed. S-20 established the column has no
--     reader — SPRINT_AT_RISK matches absences by date — so a NULL stamp is
--     inert. The column is already nullable; only the constraint changes.
--
--   * `monitored_repo.credential_id` — the repo row, and the commits, PRs and
--     reviews hanging off its internal id, survive a GitHub disconnect and are
--     re-linked on reconnect through `monitored_repo_owner_repo_uq`
--     (owner_id, github_repo_id), a GitHub-side key that outlives the
--     credential. This half also needs DROP NOT NULL.
--
-- LIKE 0019 AND UNLIKE 0009, THIS MIGRATION MUST NOT DELETE ANYTHING. The FKs
-- cannot be altered in place, so each is dropped and recreated under the same
-- auto-generated name; inside the migration's transaction the columns are
-- briefly unconstrained, which is safe because nothing here writes to them.
ALTER TABLE "absence" DROP CONSTRAINT "absence_sprint_id_sprint_id_fk";
--> statement-breakpoint
ALTER TABLE "monitored_repo" DROP CONSTRAINT "monitored_repo_credential_id_github_credential_id_fk";
--> statement-breakpoint
ALTER TABLE "monitored_repo" ALTER COLUMN "credential_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_repo" ADD CONSTRAINT "monitored_repo_credential_id_github_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."github_credential"("id") ON DELETE set null ON UPDATE no action;