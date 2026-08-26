---
project: SprintFlow
version: 1
status: draft
created: 2026-05-26
updated: 2026-08-26
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
| F-02 | data-schema-baseline      | (foundation) Drizzle schema + Supabase migration for all product entities                    | —                  | FR-002–FR-007, FR-009–FR-013, FR-018–FR-020     | done     |
| F-03 | ui-component-foundation   | (foundation) shadcn/ui installed; base layout + auth page shells                             | —                  | FR-001, FR-016, FR-017, NFR                     | done     |
| S-01 | account-auth-flow         | sign up, sign in, sign out, and reset password by email+password                             | F-01, F-02, F-03   | FR-001, US-01                                   | done     |
| S-02 | setup-github-integration  | connect GitHub PAT + choose repos to monitor (token validated before storing)                | S-01, F-02         | FR-002, FR-004                                  | done     |
| S-03 | setup-jira-integration    | connect Jira token + choose project + map workflow statuses onto 5 categories                | S-01, F-02         | FR-003, FR-004, FR-005                          | done     |
| S-04 | setup-team-roster-cadence | review/edit auto-imported team roster; sprint cadence auto-pulled from Jira + overridable    | S-02, S-03         | FR-006, FR-007                                  | done     |
| S-05 | data-sync-engine          | GitHub + Jira data synced on 15-min cycle; last-sync timestamp per integration stored        | S-04, F-02         | FR-011, FR-012                                  | done     |
| S-06 | anomaly-detection-engine  | system detects all 8 anomaly types with default thresholds; each anomaly has 5 attributes; inbox ordered by severity | S-05 | FR-009, FR-013, FR-014, FR-015          | done     |
| S-07 | dashboard-today           | open Dashboard "Today" — Anomaly Inbox (render + sort/filter); freshness timestamp + error banner; real-data smoke-test. Burndown, Yesterday's Activity **and the Reliability KPI + tab shell** all shipped in S-10, not here | S-06, F-03 | FR-015, FR-016, US-01 | done     |
| S-08 | absence-calendar          | record team member absences; DEVELOPER_INACTIVE suppressed + SPRINT_AT_RISK adjusted during window; sprint capacity + availability tab | S-04, S-06 | FR-010                        | done     |
| S-09 | demo-mode                 | load realistic mixed-state demo dataset; explore both dashboards without real integrations; reset demo data | S-07, S-10   | FR-008, US-02                             | proposed |
| S-10 | dashboard-sprint-detail   | open Dashboard "Sprint Detail" — aging report, activity matrix, per-tech sub-burndowns; **plus** the Today tab shell with Sprint Pulse, Yesterday's Activity and the Reliability KPI, and the three sync writes they need (commit churn, Jira time zone, sprint SP scalars) | S-05, S-07 | FR-016, FR-017 | done     |
| S-11 | daily-recap-email         | receive daily-recap email at configured time with anomalies + one-line suggested actions     | S-06, S-07         | FR-018                                          | done     |
| S-12 | recap-history             | browse past daily recaps (current + 2 previous sprints); older recaps auto-purged            | S-11               | FR-019                                          | proposed |
| S-13 | refinement-helper-ai      | submit user story; receive 5–8 story-specific DOR questions + compliance score; session saved | S-01, F-02        | FR-020                                          | proposed |
| S-14 | anomaly-settings-page     | configure per-anomaly-type severity tiers and thresholds from a settings page                | S-06, S-07         | FR-009, FR-014                                  | proposed |
| S-15 | team-management-surface   | manage the team roster after setup from a **Settings → Team** tab: edit, deactivate/reactivate, merge, delete with confirmation; the save is a differential upsert and re-import proposes a diff instead of appending (PR #49) | S-04, S-10 | FR-006 | done     |
| S-16 | sprint-reconciliation     | the sync reconciles the active sprint against Jira on every cycle, instead of freezing the one captured at setup | S-05 | FR-007 | done |
| S-17 | working-days-calendar     | public holidays + per-sprint company days off stop counting as working days everywhere         | S-08               | FR-009, FR-010                                  | proposed |
| S-18 | next-sprint-capacity      | the availability tab forecasts the NEXT window's capacity, not just who is away                | S-08               | FR-010                                          | proposed |
| S-19 | team-navigation-section   | roster, absences and cadence move out of Settings into a first-class Team section              | S-08, S-15         | FR-006, FR-010                                  | proposed |
| S-20 | absence-sprint-scoping    | the three consumers of a recorded absence agree on which sprint it belongs to                  | S-08, S-16         | FR-010                                          | proposed |
| S-21 | db-pool-teardown          | the request path stops leaking a Hyperdrive connection per invocation                          | F-02               | — (NFR: graceful degradation)                   | proposed |
| S-22 | onboarding-routing        | a newly signed-up user lands in the setup wizard instead of an empty dashboard                 | S-01, S-04         | PRD Access Control ("lands in the setup wizard") | proposed |

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
  - Encrypted storage design for GitHub PAT + Jira API token at rest — RESOLVED (F-02): app-layer AES-256-GCM via `src/lib/crypto.ts` (`encryptToken`/`decryptToken`, AAD-bound versioned envelope); credential columns store the envelope + non-secret `tokenLast4`. Call sites land in S-02 / S-03.
- **Risk:** ~~The existing `drizzle.config.ts` targets Supabase via TCP — Workers require HTTP mode~~ **RESOLVED (F-02): the driver is already `drizzle-orm/node-postgres` (`pg`) over Cloudflare Hyperdrive in `src/lib/db.ts`, which makes TCP Workers-safe — there is no HTTP-mode migration to do and `@neondatabase/serverless` is not installed.** The only live caveat is keeping the `HYPERDRIVE` binding id valid; note that `drizzle-kit migrate` connects directly to Supabase (not via Hyperdrive), and the IPv6-only direct host requires the Supavisor pooler from IPv4 networks (see `.env.example`).
- **Status:** done

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
- **Risk:** ~~Integration wired but no component rendered yet — add one shadcn/ui component (e.g. Button) to a page and verify no style regression before marking F-03 done.~~ — **resolved**: shadcn `Button` (and the full form kit) render styled on `/` and the auth shells; `npm run build` + `npm run lint` green with no style regression.
- **Status:** done

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
- **Status:** done

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
- **Status:** done

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
- **Status:** done

---

### S-04: Setup wizard — team roster + sprint cadence

- **Outcome:** user can review and edit the auto-imported team roster (names, GitHub usernames, Jira account IDs, roles, SP capacity, technology tracks); sprint cadence (length, start day, working days) is auto-pulled from the Jira project's active sprint and is overridable; setup wizard step 3 of 3 complete (the wizard reconciled to 3 steps — GitHub/Jira/Team — during implementation, F4).
- **Change ID:** setup-team-roster-cadence
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02 (GitHub repos configured — collaborators importable), S-03 (Jira project configured — members importable)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:**
  - ~~GitHub Collaborators API and Jira project members API may return users not present on both systems; roster deduplication strategy (match by email or by manual mapping) needs a decision~~ — **RESOLVED (S-04):** manual GitHub↔Jira mapping only (email is unreliable/withheld on both sides); import merges by stable key (`githubUsername` / `jiraAccountId`), the user maps two rows into one via the editor's Merge control.
- **Risk:** Auto-import quality depends on both S-02 and S-03 having valid, validated tokens; test with a real GitHub repo + real Jira project in a dev environment before marking this slice done. (Automated coverage green: 89 unit + 22 integration; the live-credential walkthrough remains as pending manual verification on PR #42.)
- **Status:** done

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
- **Status:** done

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
- **Status:** done

---

### S-07: Dashboard "Today" — Anomaly Inbox (north-star core)

- **Outcome:** user can open Dashboard "Today" and see the Anomaly Inbox as the default view (all detected anomalies, each with 5 attributes, sorted by severity → recency); user can re-sort (severity, age, ticket, team member) and filter (anomaly type, team member) the inbox; last-sync timestamp per integration is always visible; error banner shown when the most recent sync returned an error (last successfully cached state shown, not a blank screen).
- **Change ID:** dashboard-today
- **PRD refs:** FR-015, FR-016, US-01 (all acceptance criteria)
- **Prerequisites:** S-06 (anomaly data), F-03 (UI component foundation)
- **Parallel with:** S-13
- **Blockers:** —
- **Scope note (frame.md 2026-08-21):** S-07 was narrowed to the *hypothesis-proving core*. The inbox + freshness + error banner are render-ready over `listAnomaliesForSprint` (S-06) and `sync_state` (S-05); the slice also adds a shared `getActiveSprint(ownerId)` resolver (extract the logic duplicated in `run-sync.ts` / `load-snapshot.ts`) and a roster reader for the member filter. The **Sprint Pulse burndown** and **Yesterday's Activity** panels are *deferred to S-10* — both are new read-side aggregators that overlap S-10's Activity Matrix and sub-burndowns, and neither validates the US-01 hypothesis (which the inbox proves on its own). Reliability KPI was expected to ride along as "near-free from existing `committedSp`/`completedSp` columns" — it did **not** ship in S-07, and the assumption behind that estimate was wrong: nothing in the codebase wrote either column outside the demo seed. S-10 added the sync write and the panel (see its scope note).
- **Delivered-scope correction (S-10 frame, 2026-08-22):** this row previously claimed S-07 shipped a Reliability KPI tab and a tab shell. Neither existed — Today was a single column with no tabs primitive in the repo. Both ship in S-10.
- **Unknowns:** —
- **Risk:** This slice delivers the north star — the end-to-end experience for US-01. Validate against every US-01 acceptance criterion (inbox empty only when zero anomalies; all 5 attributes visible; sync timestamp visible; error banner works) before calling it done; **smoke-test with at least one real GitHub repo + real Jira project** (part of the north-star proof, per frame).
- **Status:** done

---

### S-08: Absence calendar

- **Outcome:** user can record per-sprint team member absences (vacation, sickness, training) on a simple calendar; recorded absences: (1) suppress `DEVELOPER_INACTIVE` anomalies for the absent developer during the window, (2) raise the `SPRINT_AT_RISK` score for unplanned mid-sprint absences, (3) feed into sprint capacity calculation.
- **Change ID:** absence-calendar
- **PRD refs:** FR-010
- **Prerequisites:** S-04 (team roster — team members must exist to associate absences with), S-06 (anomaly detection engine — absence suppression logic added here as a wiring step)
- **Parallel with:** S-09, S-10, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Absence records feed three downstream calculations (capacity, SPRINT_AT_RISK weighting, DEVELOPER_INACTIVE suppression); test all three effects independently — a silent failure in any one leaves the anomaly inbox giving misleading signals. **Addressed:** each effect has its own unit + integration coverage (suppression lifecycle, an unplanned-absence `SPRINT_AT_RISK` that resolves on delete, and a capacity reducer whose null-capacity case is pinned).
- **Status:** done

- **Delivered beyond the outcome line (PR #50):** `/settings/absences` as a third
  Settings tab; a fifth Dashboard "Today" tab showing who is away this sprint and
  in the next window of the same length; `countWorkingDays` rewritten to bucket in
  the team's Jira zone with two explicitly named boundary semantics (the old one
  was server-local and half-open, which was wrong for both new callers); and
  `team_member.sp_capacity` given its first reader.
- **Deliberately deferred here, tracked as S-17 / S-18 / S-19 below.**

---

### S-09: Demo mode

- **Outcome:** user can load a single realistic mixed-state demo dataset (healthy-flow and crisis signals combined) and explore Dashboard "Today" with at least 4 anomaly types from the 8 rules plus Dashboard "Sprint Detail" — all without connecting real Jira or GitHub credentials; "Reset demo data" returns the user to the uninitialized state.
- **Change ID:** demo-mode
- **PRD refs:** FR-008, US-02
- **Prerequisites:** S-07 **and S-10** (both dashboards must be functional before demo data can populate them — Sprint Detail landed in S-10, so the prerequisite is now met)
- **Parallel with:** S-08, S-10, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:**
  - PRD Open Question #1: Demo data ↔ real integrations interaction — when a user has loaded demo data AND has real Jira + GitHub credentials connected, what does the dashboard show? Mutual exclusion, toggle, or real-data precedence? — Owner: user. Block: **planning only** — the dashboards are no longer the blocker, this UX decision is; S-09 cannot be *planned* until it is resolved.
- **Risk:** Demo dataset quality directly determines the product's first impression; the fixture must produce at least 4 distinct anomaly types (medium or high severity) plus healthy-flow signals, and must render realistic Sprint Pulse + Activity numbers.
- **Head start (S-10):** `scripts/seed-dashboard.mjs` now seeds the full upstream set both dashboards read — tickets with SP and assignees, status transitions (incl. a re-open and an unmapped status), commits with and without churn, PRs, and reviews — and stays idempotent. It is a script, not the in-app FR-008 flow, but it is the fixture S-09 can build on.
- **Status:** proposed — unblocked on dashboards; still gated on Open Question #1

---

### S-10: Dashboard "Sprint Detail"

- **Outcome:** user can open Dashboard "Sprint Detail" and see: (1) a workflow aging report — tickets sorted by time-since-last-movement with cumulative time-in-each-status shown inline; (2) Team Activity Matrix — Developer × Day with commit, line, PR, and review counts; (3) per-technology sub-burndowns (SP burndown filtered by frontend / backend / mobile / QA track).
- **Change ID:** dashboard-sprint-detail
- **PRD refs:** FR-016 (the Today panels S-07 deferred), FR-017
- **Prerequisites:** S-05 (synced Jira + GitHub data for aging and activity calculations), S-07 (navigation from Dashboard Today; consistent UI shell)
- **Parallel with:** S-08, S-09, S-11, S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Scope note (frame.md 2026-08-21):** S-10 also absorbs the two data panels deferred from S-07 — the **Sprint Pulse burndown** and **Yesterday's Activity** (per-dev commit/PR/review activity). Both are new read-side aggregators in the same family as S-10's Activity Matrix and sub-burndowns, so they are built here rather than duplicated in the north-star slice.
- **Delivered scope (2026-08-22):**
  - Five read surfaces on **three shared owner-scoped reducers** (`src/lib/dashboard/`) rather than five bespoke queries: M1 SP-over-time (sub-burndowns, Sprint Pulse, the FR-016 status distribution), M2 activity rollup (Activity Matrix, Yesterday's Activity), M3 time-in-status (aging report).
  - New route `/dashboard/sprint-detail` + nav link; Today retrofitted behind a four-tab shell with the Anomaly Inbox still the default tab.
  - **Reliability KPI shipped here, not in S-07** (see that row's correction).
  - Three data-side prerequisites the surfaces would otherwise have rendered empty: per-commit `additions`/`deletions` (new `getCommitDetail`, capped per repo and forward-only), `jira_project.time_zone` (migration `0005`, written every Jira cycle), and `sprint.committed_sp`/`completed_sp` (nothing in the repo wrote these outside the demo seed — the sync now derives both from the ticket table).
  - Side effect: `scope-creep` and `sprint-at-risk` had been reading `committedSp ?? 0` since S-06; both now compute against real values.
- **Scope extension (2026-08-22, owner request — recorded, not back-justified):** S-10 also ships a `/settings` shell with a **Connections** tab. Thematically this is FR-002/FR-003/FR-011, *not* this slice's FR-016/FR-017; it landed here because the owner hit the gap while testing S-10 and asked for it on the same branch. What it closes: the setup wizard connects GitHub and Jira and renders a connected-state card for each, but **nothing has linked back to those pages since S-02/S-03 shipped** — a failing integration surfaced only as a dashboard banner with no route to any detail. Delivered: both integrations' state + sync health in one place, a live "Test connection" against the stored credential, "Sync now" (wiring the already-built `syncNow()` action, which had no caller anywhere in the app), editing monitored repos / the Jira project without re-entering the token, and a retention-bounded `sync_attempt` history. `sync_state.last_error` stays off the client (S-07 impl-review F2) — the surface classifies `status` and offers live re-validation instead. The shell is tabbed so **S-14 becomes a second tab rather than a second route**.
- **Risk (both halves resolved during planning):** the aging report needs cumulative time-in-each-status per ticket — **no backfill was needed**, `run-sync.ts` already wrote every transition idempotently. The burndown is derived from `jiraStatusHistory` transitions × SP as expected; the second half of the risk was understated — the `sprint` row did not hold usable `committedSp`/`completedSp` snapshots at all, which is why S-10 added the write.
- **Status:** done

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
- **Status:** done

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
- **Head start (S-10, 2026-08-22):** the `/settings` route, its tabbed shell, and the nav entry already exist — S-10 built them for its Connections tab. **S-14 is now a second tab, not a new route.** Scope shrinks to the thresholds/severity form plus its persistence.
- **Risk:** Threshold overrides must be per-account (not global defaults) — confirm the settings schema in F-02 scopes threshold values to the user's account; a missing account-scope constraint would cause one user's threshold changes to affect all users.
- **Status:** proposed

---

### S-15: Team management surface (post-setup)

- **Outcome:** the owner can review, edit, merge and remove team members after
  first run, from a **Settings tab** — without re-entering the setup wizard.
  Re-import reconciles against the existing roster instead of only appending.
- **Change ID:** team-management-surface
- **PRD refs:** FR-006
- **Prerequisites:** S-04 (the roster editor + import/save services exist), S-10
  (the `/settings` tabbed shell exists — this becomes a second tab beside
  Connections, exactly as S-14 will)
- **Parallel with:** S-08, S-09, S-11, S-13, S-14
- **Blockers:** —
- **Why this is a gap, not a nice-to-have (found 2026-08-22 during S-10 manual
  testing):** FR-006 does not describe a one-time import. It says the user "can
  edit each member's profile … **and can change the technology track over time**
  as developers grow into different tracks". S-04 closed FR-006 with the wizard
  step alone, so the *lifecycle* half of the requirement has no surface. This is
  the same shape as the Connections gap S-10 had to close: the wizard builds the
  thing, then nothing links back to it.
- **Three concrete defects observed:**
  1. **`importRoster` is additive, not reconciling.** It inserts discovered
     members (`roster-store.ts`, inside its own transaction) and merges nothing
     away. Re-running the step on an account that already had 5 rows produced 7.
     Only `saveRoster` replaces (delete-then-insert), and only when the user
     saves the edited grid — so a re-import silently grows the roster until
     someone notices.
  2. **No route back to the editor.** `/setup/team` is the only surface;
     `main-nav.tsx` does not reach it and neither does Settings.
  3. **The wizard measure made the editor unusable** — fixed ahead of this slice
     in S-10 (`SetupWizardShell` gained an opt-in `wide`), but it is the reason
     the Remove and Merge controls were reported missing when they existed.
  4. **Removing a member has no confirmation** (owner request, 2026-08-22). The
     row's trash icon calls `remove(index)` on the field array immediately — one
     stray click drops a person from the grid with no undo, and the damage lands
     on Save because `saveRoster` replaces the whole owner-scoped set
     (delete-then-insert). Blast radius is worse than it looks:
     `absence.teamMemberId → teamMember.id` is **`onDelete: cascade`**, so a
     deleted member takes every recorded absence with them — hand-entered FR-010
     data that the PRD feeds into three calculations (capacity, `SPRINT_AT_RISK`
     weighting, `DEVELOPER_INACTIVE` suppression). `anomaly.relatedTeamMemberId`
     is `set null`, so anomalies survive but silently lose their attribution.
     Nothing is at risk *today* only because S-08 has not shipped; the FK is
     already in place, so this gets more dangerous, not less.
     Asked for: a small confirm dialog on the row action. Worth considering
     alongside it — a save-time summary naming every member about to be removed,
     since `saveRoster` applies all removals in one shot and the grid shows no
     diff between the loaded roster and what is about to replace it.
  5. **The merge helper's comment does not match its code.**
     `roster-editor.tsx:161-162` claims "Primary is the row with a name that
     isn't just a bare login (prefer the Jira displayName); fall back to A", but
     the implementation is a plain `a.name || b.name`. Both rows always carry a
     name, so the *first row the user selected* always wins and the stated
     preference never runs. Either implement the preference or delete the claim —
     a comment that lies is worse than none. Practical effect today: merging a
     GitHub row selected first yields the bare login as the member's name.
- **Risk:** the merge control is the only way to fuse a GitHub-only row with its
  Jira-only counterpart (S-04 resolved dedup as manual mapping — email is
  unreliable on both sides). Any redesign must keep it, and must keep working
  for the common real case of one human appearing as two imported rows.
- **Delivered (PR #49):** the research found a **sixth** defect the roadmap had
  not recorded, and it turned out to be the load-bearing one: `saveRoster` was a
  delete-then-insert of the owner's whole set, so **every** roster save — not
  just a stray trash click — destroyed recorded absences via
  `absence.team_member_id`'s `ON DELETE CASCADE`, detached anomaly attribution
  via `anomaly.related_team_member_id`'s `ON DELETE SET NULL`, and reset
  `is_active`. Defect 4 above framed this as "the damage lands on Save" after a
  removal; in fact no removal was needed. It is documented in
  `context/archive/2026-08-23-team-management-surface/research.md` and in
  `context/foundation/lessons.md` § "Delete-then-insert is only safe for tables
  with no hand-entered children". Fixing it first is what made the rest of the
  slice safe: with the bulk save no longer deleting, a stray trash click became
  structurally incapable of dropping anyone. Defect 1's additive re-import was
  confirmed as the demo seed's synthetic keys (`alice-kim` / `acc-alice-kim`)
  matching nothing a real import returns — recorded with counts in the plan's
  Phase 3 overview. Defect 5's lying comment is implemented rather than deleted,
  alongside a second, worse defect in the same function: the merge picked the
  surviving *id* by A/B while picking the surviving *row* by index, which from
  the upsert save onward duplicated the person instead of fusing them.

---

### S-16: Sprint reconciliation on every sync

- **Outcome:** when the team starts a new sprint in Jira, SprintFlow follows it
  automatically. Today it does not: the sprint captured at setup is synced
  forever until someone manually re-runs a wizard step.
- **Change ID:** sprint-reconciliation
- **PRD refs:** FR-007
- **Prerequisites:** S-05
- **Status:** done

- **Why this exists (S-10 impl-review F7, 2026-08-23):** FR-007 says the system
  "pulls sprint cadence from the monitored Jira project's active-sprint
  configuration **on each sync**". As built, that happens *once*. The only writer
  of the `sprint` row is `roster-store.ts:435` (`importCadence`, the
  `/setup/team` step); `run-sync.ts` contains no `insert(sprint)` at all — it
  *reads* via `getActiveSprintRow` and never reconciles against Jira. This is the
  S-04/S-05 seam, not S-10, but it is the difference between the product working
  in week 1 and working in week 3.
- **Observed cost:** this is exactly what made the real account report a healthy
  green sync while showing an empty dashboard — the stored sprint was the demo
  seed's `jira_sprint_id=1001`, which does not exist in that Jira, so
  `searchSprintIssues` correctly returned nothing and the cycle reported OK.
  Root-cause write-up: `context/archive/2026-08-21-dashboard-sprint-detail/plan.md:1020-1052`.
- **Related, already fixed:** the sibling defect — `getActiveSprintRow`'s ACTIVE
  branch selecting nondeterministically between two ACTIVE rows — was closed in
  S-10 (`src/lib/sprint.ts`, ordered by `startDate desc`). Reconciliation should
  still avoid *creating* a second ACTIVE row rather than relying on that ordering.
- **Worse than "week 1 vs week 3" (research, 2026-08-26):** an owner who onboards
  *between* sprints gets no `sprint` row at all, and never gets one. S-04 recorded
  "cadence re-pulls on the next sync (FR-007)" as the accepted degradation for
  that path (`archive/2026-08-20-setup-team-roster-cadence/plan.md:63`, `:277`,
  carried into `changes/onboarding-routing/change.md:60-67`) — and that re-pull
  does not exist. `syncJira` returns `SKIPPED/no_sprint` forever while stamping a
  fresh **OK**, so the account is permanently dead and permanently green. S-16 is
  therefore a first-run correctness fix, not only a rollover fix.
- **Scope, decided by the owner 2026-08-26 after research:** the reconcile itself;
  at most one ACTIVE row per owner (which also closes the two unfixed twins of the
  S-10 F7 nondeterminism); never blanking the row on failure or on a legitimate
  no-active-sprint; the between-sprints onboarding case; a 401 branch on
  `listBoards`/`getActiveSprint` so failure classification does not regress; the
  integration-test mock; closing old-sprint anomalies; and the wizard-side sprint
  delete on a project change that the settings path already has. Deferred with
  reasons: absence re-stamping, retention purge, post-setup cadence UI,
  `timestamptz`. Full record: `context/changes/sprint-reconciliation/change.md`
  § *Scope decision — approved*; blast-radius map: `.../research.md`.

---

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                                  | Ready for `/10x-plan` | Notes |
|------------|---------------------------|------------------------------------------------------------------------|------------------------|-------|
| F-01       | auth-provider-scaffold    | Set up auth provider scaffold (session middleware + gated routes)      | done                   | ✅ Implemented & reviewed — PR #27; archived 2026-08-26 |
| F-02       | data-schema-baseline      | Land Drizzle schema + Supabase migration for all product entities      | done                   | ✅ Implemented (branch F-02); archived 2026-08-26 |
| F-03       | ui-component-foundation   | Install shadcn/ui + base layout shell for Tailwind CSS 4               | done                   | ✅ Implemented (branch F-03, PR #30); archived 2026-08-26 |
| S-01       | account-auth-flow         | Auth pages: sign-up, sign-in, sign-out, password reset                 | done                   | ✅ Implemented & reviewed — PR #34; archived 2026-08-26 |
| S-02       | setup-github-integration  | Setup wizard: GitHub PAT connection + repo selection                   | done                   | ✅ Implemented, reviewed & archived (2026-08-19) |
| S-03       | setup-jira-integration    | Setup wizard: Jira token + project selection + status mapping          | done                   | ✅ Implemented, reviewed & archived — PR #41 (2026-08-20) |
| S-04       | setup-team-roster-cadence | Setup wizard: team roster auto-import + sprint cadence                 | done                   | ✅ Implemented, reviewed & archived — PR #42 (2026-08-20) |
| S-05       | data-sync-engine          | 15-min GitHub + Jira sync engine with Cloudflare Cron Trigger          | done                   | ✅ Implemented, reviewed & archived — PR #43 (2026-08-20) |
| S-06       | anomaly-detection-engine  | 8-rule anomaly detection engine with default thresholds                | done                   | ✅ Implemented, reviewed & archived — PR #44 (2026-08-21) |
| S-07       | dashboard-today           | Dashboard "Today" — Anomaly Inbox (north-star core)                    | done                   | ✅ Implemented, reviewed & archived — PR #45 (2026-08-21); US-01 inbox-core (Sprint Pulse + Yesterday's Activity deferred to S-10) |
| S-08       | absence-calendar          | Absence calendar + DEVELOPER_INACTIVE suppression wiring               | done                   | ✅ Implemented, reviewed & archived — PR #47 (2026-08-25) |
| S-09       | demo-mode                 | Demo mode: load/reset mixed-state fixture dataset                      | no                     | Prereqs S-07, S-10 done; blocked on the demo↔real interaction decision (roadmap Open Question #1 = PRD Open Question #2). S-16 removed the wizard-side entry point to the `jira_sprint_id=1001` incident, but the full delineation is still this slice's call |
| S-10       | dashboard-sprint-detail   | Dashboard "Sprint Detail" — aging report + activity matrix (+ S-07's deferred burndown + Yesterday's Activity) | done                   | ✅ Implemented & reviewed — PR #46 (2026-08-23); archived 2026-08-26 |
| S-11       | daily-recap-email         | Daily Recap email via Resend + Cron Trigger                            | done                   | ✅ Implemented, reviewed & archived — PR #53 (2026-08-26). ⚠️ No email sends until the Resend account + `sprintflow.pl` domain verification are provisioned — 5 manual rows blocked on it (`manual-test-backlog.md` §9) |
| S-12       | recap-history             | Recap history view with sprint-bounded auto-purge                      | yes                    | **Unblocked** — S-11 shipped and `daily_recap` now stores a versioned `payload` + `rendered_message` per send. Also the home for the deferred Resend bounce/complaint webhook |
| S-13       | refinement-helper-ai      | Refinement Helper: story-grounded DOR questions via Anthropic SDK      | yes                    | Prereqs S-01, F-02 done; the only AI surface. `@anthropic-ai/sdk` not yet installed |
| S-14       | anomaly-settings-page     | Anomaly threshold + severity settings page                             | yes                    | Prereqs S-06, S-07 done; parallel with S-11–S-13 |
| S-15       | team-management-surface   | Settings → Team: edit, deactivate, merge, delete; differential-upsert save | done                   | ✅ Implemented & reviewed — PR #49 (2026-08-25); archived 2026-08-26 |
| S-16       | sprint-reconciliation     | The sync reconciles the active sprint against Jira on every cycle       | done                   | ✅ Implemented, reviewed & archived — PR #52 (2026-08-26) |
| S-17       | working-days-calendar     | Public holidays + company days off stop counting as working days        | yes                    | Prereq S-08 done. Post-MVP — no unshipped FR depends on it |
| S-18       | next-sprint-capacity      | Availability tab forecasts the NEXT window's capacity                   | yes                    | Prereq S-08 done. Post-MVP |
| S-19       | team-navigation-section   | Roster, absences and cadence move into a first-class Team section       | yes                    | Prereqs S-08, S-15 done. Post-MVP; also the home for the post-setup cadence UI S-16 left out |
| S-20       | absence-sprint-scoping    | The three consumers of an absence agree which sprint it belongs to      | yes                    | Prereqs S-08, S-16 done. Decision slice, not a filter fix |
| S-21       | db-pool-teardown          | Request-path DB pool teardown (fix the per-invocation connection leak)  | yes                    | Prereq F-02 done. `lessons.md` #3, open since S-02's impl-review F3; S-05 fixed only the cron path |
| S-22       | onboarding-routing        | First-run routing into the setup wizard                                 | yes                    | Prereqs S-01, S-04 done. Half already shipped via S-10's Settings tab; `isOnboardingComplete` is built and has zero production callers |

## Open Roadmap Questions

1. **Demo data ↔ real integrations interaction** — When a user has loaded demo data AND has real Jira + GitHub credentials connected, what does the dashboard show? Mutual exclusion, side-by-side toggle, or real-data precedence? Owner: user. Block: S-09 (yes — this decision determines demo-mode data routing architecture; S-09 cannot be planned until resolved).
2. **5-category status mapping rigidity** — Should MVP keep the 5 standard categories (To Do / In Progress / Code Review / Testing / Done) or add a 6th "Blocked" bucket? A 6th bucket would suppress `TICKET_STATUS_AGING` for explicitly blocked tickets. Owner: user. Block: S-03 (no — MVP ships with 5 categories; 6th bucket is phase 2 per PRD; implementation can proceed; revisit after first real-team trial).
3. **GitHub cache TTL default** — FR-011 commits to 15-minute default; confirm against actual rate-limit budget during S-05 implementation (classic PAT = 5,000 req/h; multi-user deployments may require a higher TTL). Owner: implementation planning (S-05). Block: no.

### S-17: Working-days calendar

- **Outcome:** public holidays and per-sprint company days off stop counting as
  working days — in the `TICKET_STATUS_AGING` budget, in the `SPRINT_AT_RISK`
  absence magnitude, and in the capacity divisor alike.
- **Change ID:** working-days-calendar
- **PRD refs:** FR-009, FR-010
- **Prerequisites:** S-08
- **Status:** proposed

- **Why this exists (S-08, 2026-08-25):** S-08 built the seam and left it empty.
  `countWorkingDays` / `countWorkingDaysInclusive` take an optional
  `nonWorkingDays: Set<DayKey>`; every S-08 caller passes nothing, so a Polish
  team's 15 August currently counts as a full working day in the capacity number
  and in every aging budget.
- **Why it was not done in S-08:** it needs data the app does not store. Deriving
  holidays requires a COUNTRY, and the only geographic signal on the account is
  `jira_project.time_zone` — which is a zone, not a jurisdiction, and gets a team
  in Vienna and a team in Warsaw wrong in opposite ways. So the slice is: a
  country (or holiday-set) field, a source for the dates, per-sprint custom days
  off, a settings surface, and tests — none of which is a line of code in S-08.

---

### S-18: Next-sprint capacity forecast

- **Outcome:** the availability tab answers "can I promise this?" with a NUMBER
  for the next window, not only with who is away.
- **Change ID:** next-sprint-capacity
- **PRD refs:** FR-010
- **Prerequisites:** S-08
- **Status:** proposed

- **Why this exists (S-08, 2026-08-25):** the S-08 tab shows the next window's
  absences but deliberately computes no capacity for it. Capacity needs a sprint's
  working-day total, and the next sprint does not exist in the database yet — its
  dates are inferred from the current sprint's length, which is good enough to
  draw a grid and not good enough to promise story points against. Doing it
  properly likely depends on S-16 (sprint reconciliation) so the next sprint is a
  real row rather than an extrapolation.

---

### S-19: Team navigation section

- **Outcome:** roster, absences and cadence live under a first-class **Team**
  section instead of being three tabs inside Settings.
- **Change ID:** team-navigation-section
- **PRD refs:** FR-006, FR-010
- **Prerequisites:** S-08, S-15
- **Status:** proposed

- **Why this exists (S-08, 2026-08-25):** Settings now carries Connections, Team
  and Absences, and S-14 adds Anomaly rules. Two of those four are "how SprintFlow
  reaches your data" and two are "who your team is" — one nav that means two
  different things.
- **Why it was not done in S-08:** it MOVES `/settings/team`, which would
  invalidate S-15 manual rows 5.3 / 5.4 — the ones that verify the Settings nav
  reaches the roster at all. Those were only ticked on 2026-08-25; re-opening them
  to satisfy a navigation preference is the wrong trade under a deadline.

---

### S-20: Absence sprint scoping

- **Outcome:** a recorded absence means the same thing to all three of its
  consumers. Today `SPRINT_AT_RISK` filters absences by `sprint_id` while sprint
  capacity and `DEVELOPER_INACTIVE` filter the same rows by date overlap, so one
  absence can simultaneously reduce a sprint's capacity, suppress an inactivity
  anomaly in it, and be invisible to its risk score.
- **Change ID:** absence-sprint-scoping
- **PRD refs:** FR-010
- **Prerequisites:** S-08, S-16
- **Status:** proposed

- **Why this exists (S-16 research, 2026-08-26):** `absence.sprint_id` is stamped
  once at record time (`src/lib/absence-store.ts:157`) and `updateAbsence`
  deliberately never re-stamps it (`:169-173`). Three consumers then disagree:
  `src/lib/anomaly/rules/sprint-at-risk.ts:141` skips any absence whose
  `sprint_id` differs from the snapshot's sprint, while
  `src/lib/dashboard/capacity.ts:170-176` and
  `src/lib/anomaly/rules/developer-inactive.ts:47-51` never look at `sprint_id`
  at all and match on date overlap alone. An absence recorded in sprint N whose
  range extends into N+1 therefore lowers N+1's capacity and suppresses
  `DEVELOPER_INACTIVE` there, but cannot raise `SPRINT_AT_RISK` there.
- **This is not simply a bug to fix.** The `sprint-at-risk` behaviour is the
  *recorded intent* of S-08's D2 definition of planned-ness — an absence carried
  into a later sprint is "planned there" and should stop raising risk
  (`context/archive/2026-08-25-absence-calendar/plan.md:154-163`). The defect is
  that the other two consumers were never brought in line with that rule, and
  that nothing states which reading is canonical. The slice is the *decision*
  plus its consistent application, not a one-line filter change.
- **Related, deliberately excluded from S-16:** impl-review F10's narrower
  complaint (an absence recorded with no active sprint stores NULL and can never
  raise risk — `sprint-at-risk.ts:135-140`) is largely dissolved by S-16's
  between-sprints fix, which makes a sprint row exist from the first cycle after
  a sprint goes active. What survives F10 is the disagreement above.
- **Also in range — CLOSED 2026-08-26 by S-16 Phase 4.**
  `src/app/(app)/settings/absences/page.tsx:24` used to tell the reader that
  retention already bounds the list to current + 2 previous sprints. It does not:
  the only retention in the codebase is `SYNC_ATTEMPT_RETENTION` for the
  operational log. The comment now names the bound as *planned* (PRD FR-019,
  owned by S-12) and records that S-16 turned "one sprint row per owner" into a
  growing series, which makes the unbounded list a real if small growth path.
  No behaviour changed; the list stays unwindowed for the reasons it already gave.

---

### S-21: Request-path DB pool teardown

- **Outcome:** (foundation) a request, Server Action or gated render stops
  pinning a Hyperdrive-backed Postgres connection for the isolate's lifetime.
  Today every `getDb(env)` call builds `new Pool({ max: 1 })` and nothing ever
  closes it, so under sustained traffic the account runs out of connections.
- **Change ID:** db-pool-teardown
- **PRD refs:** — (serves the graceful-degradation guardrail rather than an FR)
- **Prerequisites:** F-02
- **Status:** proposed

- **Why this exists:** spun out of S-02's impl-review as finding F3 and recorded
  as `lessons.md` #3, then never given a slice. It is still live: `src/lib/db.ts`
  says so in its own doc comment — *"The pre-existing request-path leak (lesson
  #3) is out of scope for S-05 and stays a separate ticket"*. S-05 solved it only
  for the **cron/sync** path, by adding `getDbWithPool` so that path can call
  `ctx.waitUntil(pool.end())` itself. Every request-path caller still uses the
  leaking `getDb`.
- **The naive fix is wrong, which is why this needs a plan and not a one-liner.**
  `ctx.waitUntil(pool.end())` inside `getDb` fires immediately and closes the
  pool before the caller's queries run. The correct shape is one pool per
  request, cached on request context, torn down by the request's after-hook —
  without exposing the pool to call sites, because `createAuth` holds its handle
  for the instance's lifetime.
- **Not urgent at MVP traffic, and that is the trap:** a connection leak is
  invisible until it is not, and the symptom (a dashboard that suddenly cannot
  reach the database) reads as an outage rather than as a resource bug.

---

### S-22: First-run routing into the setup wizard

- **Outcome:** a user who signs up lands in `/setup` and is carried through the
  wizard; a user whose onboarding is already complete lands on `/dashboard`.
  Today both go to `/dashboard`, and `/setup` is reachable only by typing the URL.
- **Change ID:** onboarding-routing
- **PRD refs:** Access Control — *"Sign-up: on success, the user lands in the setup wizard."*
- **Prerequisites:** S-01, S-04
- **Status:** proposed

- **Half of the original change is already delivered.** The folder's second scope
  item — a persistent entry point for returning users to manage integrations —
  shipped with S-10 as the **Settings** nav tab. What remains is the first-run
  routing.
- **The predicate is BUILT AND UNUSED.** `isOnboardingComplete`
  (`src/lib/onboarding.ts:28`) exists, is owner-scoped, and has its own
  integration test — and has **zero production callers**. Nothing imports it
  outside `onboarding.integration.test.ts`. This slice is mostly wiring an
  existing, tested predicate to the two places that need it (post-sign-up
  redirect, and a "finish setup" affordance for a returning half-onboarded user),
  not building new logic.
- **Do NOT add "Setup" as a standalone nav item** — that contradicts the
  onboarding-flow intent recorded in the original change folder. Post-sign-up
  routing plus a prompt on the dashboard until onboarding completes.
- **Watch the cost:** `scheduled.ts:43` already records that
  `isOnboardingComplete` is 6 sequential queries, too expensive to run per owner
  in a loop. On a single request path that is fine; do not let it drift into one.

---

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
- **Unique index on `team_member` identity keys** — Why parked: `(owner_id, lower(github_username))` and `(owner_id, jira_account_id)` have no DB-level uniqueness; it is enforced only by `rosterSaveSchema.superRefine`, which sees one submission at a time. A duplicate silently corrupts anomaly attribution (`indexBy` keeps whichever row it reads last — see `validations/roster.ts:54`). The known route in was closed by S-15 follow-up `646facf` (`saveRoster` now hands persisted ids back, so a freshly-inserted row stops being re-inserted), and the local DB has zero duplicates, so this is defence in depth, not a live hole. Real cost is not the migration: it fails on any pre-existing duplicate, so it needs a detect-and-merge script (which row survives, what happens to its absences and anomalies) plus `23505` translation into a readable error — half a day to a day. Revisit in a hardening pass, or if a second duplicate route is ever found. Raised 2026-08-25.
- **Observability (structured logging, Sentry, metrics)** — Why parked: no MVP NFR requires it; deferred given `speed` main goal; add before any public launch.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) auth library installed and configured; email+password session issuing + verification; `middleware.ts` protecting gated routes (redirect to `/login`); no user-facing pages — UI lives in S-01.** — Archived 2026-08-26 → `context/archive/2026-05-30-auth-provider-scaffold/`. Lesson: —.
- **F-02: (foundation) Drizzle schema for all product entities landed with a Supabase migration applied; DB connection helper uses `node-postgres` (`pg`) over Cloudflare Hyperdrive (Workers-safe TCP — no HTTP-mode driver); `src/db/schema.ts` no longer a placeholder.** — Archived 2026-08-26 → `context/archive/2026-05-31-data-schema-baseline/`. Lesson: a nullable column in a UNIQUE dedup key defeats deduplication.
- **F-03: (foundation) shadcn/ui installed and configured for Tailwind CSS 4; base layout component (nav, main, page shell); auth page shells (`/signup`, `/login`, `/reset`) with placeholder content ready for S-01 to populate.** — Archived 2026-08-26 → `context/archive/2026-06-01-ui-component-foundation/`. Lesson: pin turbopack.root to neutralize workspace-root OOM crashes.
- **S-01: user can sign up, sign in, sign out, and reset their password by email+password; authenticated session persists across gated routes; unauthenticated requests redirect to `/login`.** — Archived 2026-08-26 → `context/archive/2026-06-14-account-auth-flow/`. Lesson: —.
- **S-02: user can connect a GitHub Personal Access Token, select which repositories to monitor, and have the token validated against the GitHub API before it is stored encrypted; setup wizard step 1 of 4 complete.** — Archived 2026-08-19 → `context/archive/2026-06-14-setup-github-integration/`. Lesson: —.
- **S-03: user can connect a Jira API token + workspace URL, select a single Jira project to monitor, have the credentials validated against Jira before storing encrypted, and map the project's workflow statuses onto the 5 standard categories (To Do / In Progress / Code Review / Testing / Done); setup wizard step 2 of 4 complete.** — Archived 2026-08-20 → `context/archive/2026-08-19-setup-jira-integration/`. Lesson: —.
- **S-04: user can review and edit the auto-imported team roster (names, GitHub usernames, Jira account IDs, roles, SP capacity, technology tracks); sprint cadence (length, start day, working days) is auto-pulled from the Jira project's active sprint and is overridable; setup wizard step 3 of 3 complete (the wizard reconciled to 3 steps — GitHub/Jira/Team — during implementation, F4).** — Archived 2026-08-20 → `context/archive/2026-08-20-setup-team-roster-cadence/`. Lesson: —.
- **S-05: system pulls GitHub commit, PR, and review data (15-min cycle by default) and Jira active-sprint tickets + status-change history (incremental delta since last successful sync) for the configured team and repositories; sync results stored in DB; last-sync timestamp per integration stored and readable by the dashboard.** — Archived 2026-08-20 → `context/archive/2026-08-20-data-sync-engine/`. Lesson: —.
- **S-06: system detects all 8 anomaly types (`PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC`) by correlating synced Jira + GitHub data against configurable thresholds (FR-009 defaults); each anomaly carries severity, description, contextual data, one-line suggested action, and source deep-link; inbox ordered by raw severity (high → medium → low, then recency); severity-weighted sprint-risk score computed and stored per anomaly.** — Archived 2026-08-21 → `context/archive/2026-08-20-anomaly-detection-engine/`. Lesson: —.
- **S-07: user can open Dashboard "Today" and see the Anomaly Inbox as the default view — every detected anomaly with all 5 attributes + risk score, in FR-015 default order (severity → recency), with client re-sort (severity/age/ticket/developer) and filter (type/member incl. team-level bucket); per-integration last-sync timestamp always visible; error banner on sync failure with the last cached inbox still shown; three distinct empty states. US-01 inbox-core (Sprint Pulse + Yesterday's Activity panels deferred to S-10).** — Archived 2026-08-21 → `context/archive/2026-08-21-dashboard-today/`. Lesson: —.
- **S-08: user can record per-sprint team member absences (vacation, sickness, training) on a simple calendar; recorded absences: (1) suppress `DEVELOPER_INACTIVE` anomalies for the absent developer during the window, (2) raise the `SPRINT_AT_RISK` score for unplanned mid-sprint absences, (3) feed into sprint capacity calculation.** — Archived 2026-08-25 → `context/archive/2026-08-25-absence-calendar/`. Lesson: two caught in impl-review — `timestamp at time zone` INTERPRETS a naive column rather than converting it (so it cannot verify zone-aware writes), and a test that restates the implementation's arithmetic back to itself cannot fail. See `context/archive/2026-08-25-absence-calendar/reviews/impl-review.md`.
- **S-16: when the team starts a new sprint in Jira, SprintFlow follows it automatically. Today it does not: the sprint captured at setup is synced forever until someone manually re-runs a wizard step.** — Archived 2026-08-26 → `context/archive/2026-08-26-sprint-reconciliation/`. Lesson: a narrowing predicate turns "wrong value" into "empty result", which reads as success.
- **S-11: system sends a daily-recap email at the user-configured time (default 15:00 local) containing the day's detected anomalies, an activity summary, sprint progress, and a one-line suggested action per anomaly; each sent email is stored for S-12's recap history view.** — Archived 2026-08-26 → `context/archive/2026-08-26-daily-recap-email/`. Lesson: test the no-configuration path through the real resolver — fully-injected tests bypass the code that runs first in production.
- **S-10: user can open Dashboard "Sprint Detail" and see: (1) a workflow aging report — tickets sorted by time-since-last-movement with cumulative time-in-each-status shown inline; (2) Team Activity Matrix — Developer × Day with commit, line, PR, and review counts; (3) per-technology sub-burndowns (SP burndown filtered by frontend / backend / mobile / QA track).** — Archived 2026-08-26 → `context/archive/2026-08-21-dashboard-sprint-detail/`. Lesson: null is not zero — an unmeasured value rendered as 0 reads as a real measurement.
- **S-15: the owner can review, edit, merge and remove team members after first run, from a **Settings tab** — without re-entering the setup wizard. Re-import reconciles against the existing roster instead of only appending.** — Archived 2026-08-26 → `context/archive/2026-08-23-team-management-surface/`. Lesson: delete-then-insert is only safe for tables with no hand-entered children. NOTE: no impl-review on disk; PR #49 was reviewed on GitHub.
