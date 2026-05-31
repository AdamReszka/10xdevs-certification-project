---
project: SprintFlow
version: 1
status: draft
created: 2026-05-26
updated: 2026-05-26
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: SprintFlow

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

SprintFlow gives tech leads of small Scrum teams (3–10 people) an anomaly inbox that surfaces the 3–5 workflow problems most threatening sprint delivery — and tells them exactly what to do about each one. Workflow state lives in Jira; developer activity lives in GitHub; the lead currently fuses the two manually at the morning sync. SprintFlow correlates the two sources automatically, ranks each discovered anomaly by its impact on sprint-delivery risk, and attaches a one-line suggested action — so a 5-minute morning check replaces mental gymnastics across two tools. The load-bearing technical insight is the *correlation*: siloed tools can't see it, and less experienced leads don't yet have the intuition to perform it unaided.

## North star

**S-07: Dashboard "Today" shows real anomalies from a connected team** — when S-07 is delivered and live for one real tech lead with their actual GitHub repositories and Jira project connected, the core product hypothesis ("correlating Jira workflow state with GitHub developer activity produces actionable anomalies the lead would not find unaided") is proven end-to-end.

> The north star is the first end-to-end slice — the smallest user-visible sequence whose delivery proves the product works — placed as early as its Prerequisites allow, because every other slice only matters if this one lands.

## At a glance

| ID   | Change ID                 | Outcome (user can … / foundation)                                                            | Prerequisites      | PRD refs                                        | Status   |
|------|---------------------------|----------------------------------------------------------------------------------------------|--------------------|-------------------------------------------------|----------|
| F-01 | auth-provider-scaffold    | (foundation) auth scaffold landed; session middleware; gated routes redirect to /login       | —                  | FR-001, Access Control                          | done     |
| F-02 | data-schema-baseline      | (foundation) Drizzle schema + Supabase migration for all product entities                    | —                  | FR-002–FR-007, FR-009–FR-013, FR-018–FR-020     | ready    |
| F-03 | ui-component-foundation   | (foundation) shadcn/ui installed; base layout + auth page shells                             | —                  | FR-001, FR-016, FR-017, NFR                     | ready    |
| S-01 | account-auth-flow         | sign up, sign in, sign out, and reset password by email+password                             | F-01, F-02, F-03   | FR-001, US-01                                   | proposed |
| S-02 | setup-github-integration  | connect GitHub PAT + choose repos to monitor (token validated before storing)                | S-01, F-02         | FR-002, FR-004                                  | proposed |
| S-03 | setup-jira-integration    | connect Jira token + choose project + map workflow statuses onto 5 categories                | S-01, F-02         | FR-003, FR-004, FR-005                          | proposed |
| S-04 | setup-team-roster-cadence | review/edit auto-imported team roster; sprint cadence auto-pulled from Jira + overridable    | S-02, S-03         | FR-006, FR-007                                  | proposed |
| S-05 | data-sync-engine          | GitHub + Jira data synced on 15-min cycle; last-sync timestamp per integration stored        | S-04, F-02         | FR-011, FR-012                                  | proposed |
| S-06 | anomaly-detection-engine  | system detects all 8 anomaly types with default thresholds; each anomaly has 5 attributes; inbox ordered by severity | S-05 | FR-009, FR-013, FR-014, FR-015          | proposed |
| S-07 | dashboard-today           | open Dashboard "Today" — Anomaly Inbox default, Sprint Pulse / Activity / KPI tabs one click away; freshness timestamp + error banner | S-06, F-03 | FR-015, FR-016, US-01 | proposed |
| S-08 | absence-calendar          | record team member absences; DEVELOPER_INACTIVE suppressed + SPRINT_AT_RISK adjusted during window | S-04, S-06 | FR-010                                    | proposed |
| S-09 | demo-mode                 | load realistic mixed-state demo dataset; explore both dashboards without real integrations; reset demo data | S-07   | FR-008, US-02                                   | blocked  |
| S-10 | dashboard-sprint-detail   | open Dashboard "Sprint Detail" — aging report, activity matrix, per-tech sub-burndowns       | S-05, S-07         | FR-017                                          | proposed |
| S-11 | daily-recap-email         | receive daily-recap email at configured time with anomalies + one-line suggested actions     | S-06, S-07         | FR-018                                          | proposed |
| S-12 | recap-history             | browse past daily recaps (current + 2 previous sprints); older recaps auto-purged            | S-11               | FR-019                                          | proposed |
| S-13 | refinement-helper-ai      | submit user story; receive 5–8 story-specific DOR questions + compliance score; session saved | S-01, F-02        | FR-020                                          | proposed |
| S-14 | anomaly-settings-page     | configure per-anomaly-type severity tiers and thresholds from a settings page                | S-06, S-07         | FR-009, FR-014                                  | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                                                                             | Note                                                                                         |
|--------|---------------------------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| A      | Core anomaly pipeline     | `F-01` / `F-02` / `F-03` → `S-01` → `S-02` / `S-03` → `S-04` → `S-05` → `S-06` → `S-07`        | The north star path; `speed` main goal means every tie-break favours this stream's advancement. |
| B      | Post-north-star features  | `S-07` → `S-08` / `S-09` / `S-10` / `S-14`                                                       | All four start once S-07 lands; S-09 additionally requires Open Question #1 resolution.      |
| C      | Email recap               | `S-11` → `S-12`                                                                                   | Joins Stream A at S-06/S-07 (anomaly data + dashboard validation required).                  |
| D      | AI refinement             | `S-13`                                                                                            | Joins Stream A at S-01 + F-02; runs in parallel with the sync pipeline — no Jira/GitHub client dependency. |

## Baseline

What's already in place in the codebase as of 2026-05-26 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Next.js 16.2.6 App Router + TypeScript + Tailwind CSS 4; `src/app/page.tsx`; shadcn/ui wired (`components.json` present, `globals.css` with OKLCH theme tokens, `src/lib/utils.ts` with `cn`); atomic design folder tree scaffolded (`ui/`, `atoms/`, `molecules/`, `organisms/{anomaly,dashboard,auth,setup}/`, `templates/`, `providers/`); no shadcn components added yet → F-03
- **Backend / API:** absent — no `src/app/api/` directory; only `src/lib/db.ts` (DB connection helper)
- **Data:** partial — `drizzle-orm` + `drizzle-kit` + `pg` installed; `drizzle.config.ts` present; `src/db/schema.ts` is a placeholder comment; one Supabase migration file; no seeded data
- **Auth:** absent — no next-auth / better-auth / `middleware.ts`
- **Deploy / infra:** present — `wrangler.toml` configured; `@opennextjs/cloudflare` ^1.19.11 installed; no `.github/workflows` CI yet
- **Observability:** absent — no logging library, error tracker, or metrics integration

## Foundations

### F-01: Auth provider scaffold

- **Outcome:** (foundation) auth library installed and configured; email+password session issuing + verification; `middleware.ts` protecting gated routes (redirect to `/login`); no user-facing pages — UI lives in S-01.
- **Change ID:** auth-provider-scaffold
- **PRD refs:** FR-001, Access Control section
- **Unlocks:** S-01 (account auth flow)
- **Prerequisites:** —
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:**
  - Auth library choice (NextAuth vs Better Auth) — Owner: user. Block: no (either works; decide at `/10x-plan` time — Better Auth tends to be simpler on Cloudflare Workers).
- **Risk:** Auth library crypto APIs may not be fully covered by Workers `nodejs_compat` flag (flagged in `context/foundation/infrastructure.md`); prototype session create → validate → invalidate cycle in a Workers dev environment before building all gated routes to avoid discovering the incompatibility after all downstream slices are built.
- **Status:** done

---

### F-02: Data schema baseline

- **Outcome:** (foundation) Drizzle schema for all product entities landed with a Supabase migration applied; DB connection helper uses `node-postgres` (`pg`) over Cloudflare Hyperdrive (Workers-safe TCP — no HTTP-mode driver); `src/db/schema.ts` no longer a placeholder.
- **Change ID:** data-schema-baseline
- **PRD refs:** FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-009, FR-010, FR-011, FR-012, FR-013, FR-018, FR-019, FR-020
- **Unlocks:** S-01 (user table), S-02 (GitHub credential + repo config tables), S-03 (Jira credential + project + status-mapping tables), S-04 (team member + sprint cadence tables), S-05 (sync state + GitHub/Jira data tables), S-06 (anomaly records table), S-08 (absence records table), S-11 (daily recap records table), S-13 (refinement session table)
- **Prerequisites:** —
- **Parallel with:** F-01, F-03
- **Blockers:** —
- **Unknowns:**
  - Encrypted storage design for GitHub PAT + Jira API token at rest — Owner: TBD. Block: no (AES-256 column encryption or application-layer encryption are standard patterns; decide at `/10x-plan` time; must be resolved before S-02 / S-03 are implemented).
- **Risk:** ~~The existing `drizzle.config.ts` targets Supabase via TCP — Workers require HTTP mode~~ **RESOLVED (F-02): the driver is already `drizzle-orm/node-postgres` (`pg`) over Cloudflare Hyperdrive in `src/lib/db.ts`, which makes TCP Workers-safe — there is no HTTP-mode migration to do and `@neondatabase/serverless` is not installed.** The only live caveat is keeping the `HYPERDRIVE` binding id valid; note that `drizzle-kit migrate` connects directly to Supabase (not via Hyperdrive), and the IPv6-only direct host requires the Supavisor pooler from IPv4 networks (see `.env.example`).
- **Status:** ready

---

### F-03: UI component foundation

- **Outcome:** (foundation) shadcn/ui installed and configured for Tailwind CSS 4; base layout component (nav, main, page shell); auth page shells (`/signup`, `/login`, `/reset`) with placeholder content ready for S-01 to populate.
- **Change ID:** ui-component-foundation
- **PRD refs:** FR-001, FR-016, FR-017, NFR browser/device support
- **Unlocks:** S-01 (auth page UI), S-04 (setup wizard pages), S-07 (Dashboard Today), S-09 (demo mode), S-10 (Dashboard Sprint Detail), S-13 (Refinement Helper UI), S-14 (settings page)
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:**
  - ~~shadcn/ui + Tailwind CSS 4 compatibility~~ — **resolved**: `components.json` written, `shadcn/tailwind.css` imported, OKLCH theme tokens in `globals.css`, `src/lib/utils.ts` present, atomic design folder tree scaffolded (`ui/`, `atoms/`, `molecules/`, `organisms/{anomaly,dashboard,auth,setup}/`, `templates/`, `providers/`), `npm run build` passes. No Tailwind shim required; `shadcn/tailwind.css` from the `shadcn` package (v4.8.3 devDep) handles the v4 integration natively.
- **Risk:** Integration wired but no component rendered yet — add one shadcn/ui component (e.g. Button) to a page and verify no style regression before marking F-03 done.
- **Status:** ready

---

## Slices

### S-01: Account auth flow

- **Outcome:** user can sign up, sign in, sign out, and reset their password by email+password; authenticated session persists across gated routes; unauthenticated requests redirect to `/login`.
- **Change ID:** account-auth-flow
- **PRD refs:** FR-001, US-01 (step: "tech lead who has signed up")
- **Prerequisites:** F-01 (auth provider configured), F-02 (user table), F-03 (auth page shells)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First slice to exercise the full F-01 + F-02 + F-03 stack together; if Workers crypto or the shadcn/ui integration surfaced issues in the foundations, they will show here first — treat this slice as a system-wide integration test for the foundation set.
- **Status:** proposed

---

### S-02: Setup wizard — GitHub integration

- **Outcome:** user can connect a GitHub Personal Access Token, select which repositories to monitor, and have the token validated against the GitHub API before it is stored encrypted; setup wizard step 1 of 4 complete.
- **Change ID:** setup-github-integration
- **PRD refs:** FR-002, FR-004
- **Prerequisites:** S-01 (authenticated user), F-02 (GitHub credential + repo config tables)
- **Parallel with:** S-03, S-13
- **Blockers:** —
- **Unknowns:**
  - GitHub PAT scope requirements (which scopes are needed to read commits, PRs, and reviews across the selected repos) — Owner: TBD. Block: no (verify during implementation against GitHub REST API docs).
- **Risk:** Credential encryption must satisfy the PRD security guardrail ("never logged, never in client payloads"); audit the API route and the DB write path before merging to confirm no token appears in logs or response bodies.
- **Status:** proposed

---

### S-03: Setup wizard — Jira integration

- **Outcome:** user can connect a Jira API token + workspace URL, select a single Jira project to monitor, have the credentials validated against Jira before storing encrypted, and map the project's workflow statuses onto the 5 standard categories (To Do / In Progress / Code Review / Testing / Done); setup wizard step 2 of 4 complete.
- **Change ID:** setup-jira-integration
- **PRD refs:** FR-003, FR-004, FR-005
- **Prerequisites:** S-01 (authenticated user), F-02 (Jira credential + project + status-mapping tables)
- **Parallel with:** S-02, S-13
- **Blockers:** —
- **Unknowns:**
  - Jira REST API v3 endpoint for listing projects + workflow statuses for a given workspace — Owner: TBD. Block: no (standard API; verify pagination handling during implementation).
  - PRD Open Question #2: should MVP keep 5 status categories or add a 6th "Blocked" bucket? — Owner: user. Block: no (MVP ships with 5 categories; "Blocked" is phase 2; does not block FR-005 implementation).
- **Risk:** Users with non-standard or overlapping Jira workflow statuses will struggle with the 5-category mapping; a hint in the UI ("map 'Waiting for QA' to Testing") reduces first-time friction.
- **Status:** proposed

---

### S-04: Setup wizard — team roster + sprint cadence

- **Outcome:** user can review and edit the auto-imported team roster (names, GitHub usernames, Jira account IDs, roles, SP capacity, technology tracks); sprint cadence (length, start day, working days) is auto-pulled from the Jira project's active sprint and is overridable; setup wizard step 3 + 4 of 4 complete.
- **Change ID:** setup-team-roster-cadence
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02 (GitHub repos configured — collaborators importable), S-03 (Jira project configured — members importable)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:**
  - GitHub Collaborators API and Jira project members API may return users not present on both systems; roster deduplication strategy (match by email or by manual mapping) needs a decision — Owner: TBD. Block: no (manual-matching fallback is sufficient for MVP).
- **Risk:** Auto-import quality depends on both S-02 and S-03 having valid, validated tokens; test with a real GitHub repo + real Jira project in a dev environment before marking this slice done.
- **Status:** proposed

---

### S-05: Data sync engine

- **Outcome:** system pulls GitHub commit, PR, and review data (15-min cycle by default) and Jira active-sprint tickets + status-change history (incremental delta since last successful sync) for the configured team and repositories; sync results stored in DB; last-sync timestamp per integration stored and readable by the dashboard.
- **Change ID:** data-sync-engine
- **PRD refs:** FR-011, FR-012
- **Prerequisites:** S-04 (team + repos + Jira project configured), F-02 (sync state + data tables)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:**
  - Background sync mechanism: Cloudflare Cron Trigger (native Workers, already in `wrangler.toml`) vs. embedded node-cron — Owner: TBD. Block: no (Cron Trigger is the native Workers approach; confirm at `/10x-plan` time).
  - PRD Open Question #3: GitHub cache TTL default (15-min at 5,000 req/h PAT; multi-user may require a higher TTL) — Owner: implementation planning. Block: no (implement with 15-min default; tune after first real-team trial).
- **Risk:** Workers subrequest limit (10,000/invocation) — a sprint with 20+ PRs across 3 repos with paginated API calls can approach the ceiling; design the sync to batch GitHub calls and use Jira incremental delta-pull from day one to stay under budget (documented risk in `infrastructure.md`).
- **Status:** proposed

---

### S-06: Anomaly detection engine

- **Outcome:** system detects all 8 anomaly types (`PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC`) by correlating synced Jira + GitHub data against configurable thresholds (default values as specified in FR-009 ship with the system); each detected anomaly carries severity, human-readable description, contextual data, one-line suggested action, and source deep-link; inbox ordered by raw severity (high → medium → low, then recency); severity-weighted sprint-risk score computed and stored per anomaly.
- **Change ID:** anomaly-detection-engine
- **PRD refs:** FR-009, FR-013, FR-014, FR-015, US-01 (acceptance criteria: "every visible anomaly has all 5 attributes")
- **Prerequisites:** S-05 (synced Jira + GitHub data available)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:**
  - Absence records from S-08 are not yet available at this point — `DEVELOPER_INACTIVE` suppression for absent devs and `SPRINT_AT_RISK` absence-weight are wired in S-08; this slice ships with absence = empty (no suppressions). Owner: TBD. Block: no (graceful default; S-08 adds the suppression logic on top).
- **Risk:** Each of the 8 rules is independently testable — plan positive and negative test cases per rule before shipping this slice; a detection rule that never fires (or fires on healthy data) breaks the product's core promise and will not be caught by a build pipeline.
- **Status:** proposed

---

### S-07: Dashboard "Today" — Anomaly Inbox + panels

- **Outcome:** user can open Dashboard "Today" and see the Anomaly Inbox as the default view (all detected anomalies, each with 5 attributes, sorted by severity); Sprint Pulse / Yesterday's Activity / Reliability KPI tabs sit one click away; last-sync timestamp per integration is always visible; error banner shown when the most recent sync returned an error (last successfully cached state shown, not a blank screen); user can re-sort or filter the inbox by severity, age, ticket, team member, and anomaly type.
- **Change ID:** dashboard-today
- **PRD refs:** FR-015, FR-016, US-01 (all acceptance criteria)
- **Prerequisites:** S-06 (anomaly data), F-03 (UI component foundation)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This slice delivers the north star — the complete end-to-end experience for US-01. Validate against every US-01 acceptance criterion (inbox empty only when zero anomalies; all 5 attributes visible; sync timestamp visible; error banner works) before calling it done; smoke-test with at least one real GitHub repo + real Jira project.
- **Status:** proposed

---

### S-08: Absence calendar

- **Outcome:** user can record per-sprint team member absences (vacation, sickness, training) on a simple calendar; recorded absences: (1) suppress `DEVELOPER_INACTIVE` anomalies for the absent developer during the window, (2) raise the `SPRINT_AT_RISK` score for unplanned mid-sprint absences, (3) feed into sprint capacity calculation.
- **Change ID:** absence-calendar
- **PRD refs:** FR-010
- **Prerequisites:** S-04 (team roster — team members must exist to associate absences with), S-06 (anomaly detection engine — absence suppression logic added here as a wiring step)
- **Parallel with:** S-09, S-10, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Absence records feed three downstream calculations (capacity, SPRINT_AT_RISK weighting, DEVELOPER_INACTIVE suppression); test all three effects independently — a silent failure in any one leaves the anomaly inbox giving misleading signals.
- **Status:** proposed

---

### S-09: Demo mode

- **Outcome:** user can load a single realistic mixed-state demo dataset (healthy-flow and crisis signals combined) and explore Dashboard "Today" with at least 4 anomaly types from the 8 rules plus Dashboard "Sprint Detail" — all without connecting real Jira or GitHub credentials; "Reset demo data" returns the user to the uninitialized state.
- **Change ID:** demo-mode
- **PRD refs:** FR-008, US-02
- **Prerequisites:** S-07 (both dashboards must be functional before demo data can populate them)
- **Parallel with:** S-08, S-10, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:**
  - PRD Open Question #1: Demo data ↔ real integrations interaction — when a user has loaded demo data AND has real Jira + GitHub credentials connected, what does the dashboard show? Mutual exclusion, toggle, or real-data precedence? — Owner: user. Block: yes — this UX decision determines the demo-mode data routing architecture; S-09 cannot be planned until resolved.
- **Risk:** Demo dataset quality directly determines the product's first impression; the fixture must produce at least 4 distinct anomaly types (medium or high severity) plus healthy-flow signals, and must render realistic Sprint Pulse + Activity numbers.
- **Status:** blocked

---

### S-10: Dashboard "Sprint Detail"

- **Outcome:** user can open Dashboard "Sprint Detail" and see: (1) a workflow aging report — tickets sorted by time-since-last-movement with cumulative time-in-each-status shown inline; (2) Team Activity Matrix — Developer × Day with commit, line, PR, and review counts; (3) per-technology sub-burndowns (SP burndown filtered by frontend / backend / mobile / QA track).
- **Change ID:** dashboard-sprint-detail
- **PRD refs:** FR-017
- **Prerequisites:** S-05 (synced Jira + GitHub data for aging and activity calculations), S-07 (navigation from Dashboard Today; consistent UI shell)
- **Parallel with:** S-08, S-09, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The aging report requires cumulative time-in-each-status per ticket — verify that S-05's schema captures the full status-change history per ticket (not just the current status) before implementing S-10's queries, otherwise a backfill migration is needed.
- **Status:** proposed

---

### S-11: Daily Recap email

- **Outcome:** system sends a daily-recap email at the user-configured time (default 15:00 local) containing the day's detected anomalies, an activity summary, sprint progress, and a one-line suggested action per anomaly; each sent email is stored for S-12's recap history view.
- **Change ID:** daily-recap-email
- **PRD refs:** FR-018
- **Prerequisites:** S-06 (anomaly data to populate the email), S-07 (validates that email content matches what the dashboard shows)
- **Parallel with:** S-08, S-09, S-10, S-13, S-14
- **Blockers:** —
- **Unknowns:**
  - Resend account + API key must be provisioned — Owner: user. Block: no (straightforward Resend setup; sandbox available for development testing).
  - Email send scheduling: Cloudflare Cron Trigger or Resend's scheduled-send feature — Owner: TBD. Block: no (Cron Trigger is already in the infrastructure; confirm at `/10x-plan` time).
- **Risk:** The one-line suggested action in the email must be the same action from the anomaly object — not a re-generated one — otherwise the email and dashboard diverge, violating the PRD contract ("both surfaces present the same anomaly objects with the same five attributes").
- **Status:** proposed

---

### S-12: Recap history

- **Outcome:** user can view a list of past daily recaps and drill into any recap; recaps older than the current sprint + 2 previous sprints are automatically purged.
- **Change ID:** recap-history
- **PRD refs:** FR-019
- **Prerequisites:** S-11 (daily recaps must be stored to be browsable)
- **Parallel with:** S-08, S-09, S-10, S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Auto-purge logic must be keyed to sprint boundaries, not calendar days — confirm sprint end-date metadata is stored per sync in F-02's schema so the purge query can correctly identify "current + 2 previous sprints".
- **Status:** proposed

---

### S-13: Refinement Helper (AI)

- **Outcome:** user can submit a user-story description (pasted text or selected Jira ticket); system generates 5–8 DOR-checking questions explicitly grounded in the story's specific actors, capabilities, and gaps (not generic template questions); system produces a DOR Compliance Score plus a fill-in checklist of missing elements; session saved for later review.
- **Change ID:** refinement-helper-ai
- **PRD refs:** FR-020
- **Prerequisites:** S-01 (authenticated user — session ownership), F-02 (refinement session storage table)
- **Parallel with:** S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-11, S-12, S-14
- **Blockers:** —
- **Unknowns:**
  - `@anthropic-ai/sdk` to be installed; model `claude-haiku-4-5` as specified in CLAUDE.md — Owner: user. Block: no (straightforward SDK install; Anthropic API key set as a Workers Secret).
  - Prompt design: grounding DOR questions in the specific story's content (not a template) is the key FR-020 constraint — Owner: TBD. Block: no (prompt engineering is part of this slice's implementation scope).
- **Risk:** This slice depends only on S-01 + F-02 and is nearly independent of the sync pipeline — useful for maintaining development momentum while the sync engine and detection engine are being built and tested.
- **Status:** proposed

---

### S-14: Anomaly threshold settings page

- **Outcome:** user can navigate to a dedicated settings page (accessible after first run) and configure per-anomaly-type severity tiers (re-tier High/Medium/Low per anomaly rule) and detection thresholds (override the defaults from FR-009); changes take effect on the next detection cycle.
- **Change ID:** anomaly-settings-page
- **PRD refs:** FR-009, FR-014
- **Prerequisites:** S-06 (default thresholds must exist before they can be overridden), S-07 (settings page reachable from dashboard navigation)
- **Parallel with:** S-08, S-09, S-10, S-11, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Threshold overrides must be per-account (not global defaults) — confirm the settings schema in F-02 scopes threshold values to the user's account; a missing account-scope constraint would cause one user's threshold changes to affect all users.
- **Status:** proposed

---

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                                  | Ready for `/10x-plan` | Notes |
|------------|---------------------------|------------------------------------------------------------------------|------------------------|-------|
| F-01       | auth-provider-scaffold    | Set up auth provider scaffold (session middleware + gated routes)      | done                   | ✅ Implemented & reviewed — PR #27 |
| F-02       | data-schema-baseline      | Land Drizzle schema + Supabase migration for all product entities      | yes                    | Run `/10x-plan data-schema-baseline` |
| F-03       | ui-component-foundation   | Install shadcn/ui + base layout shell for Tailwind CSS 4               | yes                    | Run `/10x-plan ui-component-foundation` |
| S-01       | account-auth-flow         | Auth pages: sign-up, sign-in, sign-out, password reset                 | no                     | Awaits F-01, F-02, F-03 |
| S-02       | setup-github-integration  | Setup wizard: GitHub PAT connection + repo selection                   | no                     | Awaits S-01; parallel with S-03 |
| S-03       | setup-jira-integration    | Setup wizard: Jira token + project selection + status mapping          | no                     | Awaits S-01; parallel with S-02 |
| S-04       | setup-team-roster-cadence | Setup wizard: team roster auto-import + sprint cadence                 | no                     | Awaits S-02, S-03 |
| S-05       | data-sync-engine          | 15-min GitHub + Jira sync engine with Cloudflare Cron Trigger          | no                     | Awaits S-04 |
| S-06       | anomaly-detection-engine  | 8-rule anomaly detection engine with default thresholds                | no                     | Awaits S-05 |
| S-07       | dashboard-today           | Dashboard "Today" — Anomaly Inbox + panels (north star milestone)      | no                     | Awaits S-06; validates the core product hypothesis |
| S-08       | absence-calendar          | Absence calendar + DEVELOPER_INACTIVE suppression wiring               | no                     | Awaits S-04, S-06; parallel with S-10–S-14 |
| S-09       | demo-mode                 | Demo mode: load/reset mixed-state fixture dataset                      | no                     | Blocked — resolve Open Question #1 (demo↔real interaction) first |
| S-10       | dashboard-sprint-detail   | Dashboard "Sprint Detail" — aging report + activity matrix             | no                     | Awaits S-05, S-07; parallel with S-08, S-11–S-14 |
| S-11       | daily-recap-email         | Daily Recap email via Resend + Cron Trigger                            | no                     | Awaits S-06, S-07; parallel with S-08, S-10, S-13, S-14 |
| S-12       | recap-history             | Recap history view with sprint-bounded auto-purge                      | no                     | Awaits S-11 |
| S-13       | refinement-helper-ai      | Refinement Helper: story-grounded DOR questions via Anthropic SDK      | no                     | Awaits S-01, F-02; runs in parallel with most of Stream A |
| S-14       | anomaly-settings-page     | Anomaly threshold + severity settings page                             | no                     | Awaits S-06, S-07; parallel with S-08–S-13 |

## Open Roadmap Questions

1. **Demo data ↔ real integrations interaction** — When a user has loaded demo data AND has real Jira + GitHub credentials connected, what does the dashboard show? Mutual exclusion, side-by-side toggle, or real-data precedence? Owner: user. Block: S-09 (yes — this decision determines demo-mode data routing architecture; S-09 cannot be planned until resolved).
2. **5-category status mapping rigidity** — Should MVP keep the 5 standard categories (To Do / In Progress / Code Review / Testing / Done) or add a 6th "Blocked" bucket? A 6th bucket would suppress `TICKET_STATUS_AGING` for explicitly blocked tickets. Owner: user. Block: S-03 (no — MVP ships with 5 categories; 6th bucket is phase 2 per PRD; implementation can proceed; revisit after first real-team trial).
3. **GitHub cache TTL default** — FR-011 commits to 15-minute default; confirm against actual rate-limit budget during S-05 implementation (classic PAT = 5,000 req/h; multi-user deployments may require a higher TTL). Owner: implementation planning (S-05). Block: no.

## Parked

- **Linear / ClickUp / Asana / Jira Server / GitLab / Bitbucket / GitHub Enterprise support** — Why parked: PRD §Non-Goals (only Jira Cloud + github.com for MVP).
- **Multi-team rollups within one account** — Why parked: PRD §Non-Goals (one account = one team + one Jira project).
- **Slack / Discord / Teams notifications** — Why parked: PRD §Non-Goals (daily recap is email-only in MVP).
- **Mobile-native app (sub-tablet form factors)** — Why parked: PRD §Non-Goals (web only; 10-inch tablet floor).
- **SSO / audit logs / enterprise compliance (GDPR tier, SOC2)** — Why parked: PRD §Non-Goals (single-tenant; individual leads, not enterprise compliance surface).
- **ML/AI sprint outcome prediction** — Why parked: PRD §Non-Goals (anomaly detection is threshold-based only).
- **Inter-sprint trend dashboards / multi-quarter history** — Why parked: PRD §Non-Goals (retention = current + 2 previous sprints).
- **Custom anomaly rules or custom dashboards** — Why parked: left open in shape-notes (not locked as in-scope for MVP).
- **Per-status workflow heatmap in Sprint Detail** — Why parked: PRD §FR-017 Socratic note defers heatmap to phase 2 due to design-quality risk; sorted aging report ships instead.
- **CI/CD pipeline (.github/workflows)** — Why parked: baseline reports absent; deferred given `speed` main goal; add in a hardening pass after S-07 lands.
- **Observability (structured logging, Sentry, metrics)** — Why parked: no MVP NFR requires it; deferred given `speed` main goal; add before any public launch.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
