CREATE TABLE "sprint_cadence_override" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"jira_sprint_id" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"length_days" integer,
	"start_day" text,
	"working_days" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_cadence_override_owner_sprint_uq" UNIQUE("owner_id","jira_sprint_id")
);
--> statement-breakpoint
ALTER TABLE "sprint_cadence_override" ADD CONSTRAINT "sprint_cadence_override_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_cadence_override_series_idx" ON "sprint_cadence_override" USING btree ("owner_id","jira_project_id","start_date");
--> statement-breakpoint
-- S-30 Phase 1 — backfill the durable record from the columns it supersedes.
--
-- AUTHORED IN `src/lib/cadence-override.ts` as `BACKFILL_CADENCE_OVERRIDES` and
-- copied here verbatim; `cadence-override.integration.test.ts` pins the two
-- copies together and re-executes the constant over its own seed. A test cannot
-- observe this statement otherwise — `db:migrate` runs before the suite, so by
-- the time a test seeds a row the migration has already run against an empty
-- table. `on conflict do nothing` is what makes that second execution safe, so
-- it is load-bearing rather than defensive.
--
-- MEASURED NO-OP in every known database at the time of writing: local holds six
-- `sprint` rows, all `cadence_overridden = f`; production holds zero. This is
-- correctness for an account nobody measured, not repair.
--
-- EACH FIELD IS WRITTEN ONLY WHEN IT DIFFERS FROM WHAT THE SOURCE DERIVES. A
-- source-equal field is written NULL, or the backfill would assert on day one a
-- choice nobody made: a lead who overrode only the length would get a record
-- claiming they also chose Mon-Fri, and would be pinned to it forever after.
insert into "sprint_cadence_override"
  ("id", "owner_id", "jira_project_id", "jira_sprint_id", "start_date",
   "length_days", "start_day", "working_days")
select
  gen_random_uuid()::text,
  s."owner_id",
  p."jira_project_id",
  s."jira_sprint_id",
  s."start_date",
  case when s."length_days" is not distinct from d."derived_length"
       then null else s."length_days" end,
  case when s."start_day" is not distinct from d."derived_start_day"
       then null else s."start_day" end,
  case when s."working_days" is not distinct from '["MON","TUE","WED","THU","FRI"]'::jsonb
       then null else s."working_days" end
from "sprint" s
join "jira_project" p on p."id" = s."jira_project_id"
cross join lateral (
  select
    case
      when s."end_date" is null then null
      else greatest(1, round(extract(epoch from (s."end_date" - s."start_date")) / 86400))::int
    end as "derived_length",
    upper(trim(to_char(
      (s."start_date" at time zone 'UTC') at time zone coalesce(p."time_zone", 'UTC'),
      'DY'
    ))) as "derived_start_day"
) d
where s."cadence_overridden" = true
  and s."start_date" is not null
on conflict ("owner_id", "jira_sprint_id") do nothing;
