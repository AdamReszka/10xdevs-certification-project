# S-10 Dashboard "Sprint Detail" Implementation Plan

## Overview

Deliver the five read surfaces that close FR-017 (and the FR-016 remainder S-07 deferred), built on **three shared owner-scoped reducers** rather than five bespoke queries:

| # | Surface | Route | Reducer |
|---|---------|-------|---------|
| A | Workflow aging report | Sprint Detail | M3 time-in-status |
| B | Team Activity Matrix (Dev × Day) | Sprint Detail | M2 activity rollup |
| C | Per-technology sub-burndowns | Sprint Detail | M1 SP-over-time |
| D | Sprint Pulse burndown | Today (tab) | M1 SP-over-time |
| E | Yesterday's Activity | Today (tab) | M2 activity rollup |
| F | Reliability KPI (committed vs delivered SP) | Today (tab) | none — `sprint` scalars |

Three data-side prerequisites land first, because without them UI columns would be empty or wrong: per-commit `additions`/`deletions` (never written by the sync today), the owner's Jira IANA time zone (fetched today, never persisted), and `sprint.committedSp`/`completedSp` (columns exist, nothing writes them — surface F would be a permanent empty state).

## Current State Analysis

**What exists (verified, not assumed):**

- Read-side convention is uniform: `(db, ownerId, …rest) → Promise<serializable>` in `src/lib/*`, `now: Date` injected rather than read inside (`src/lib/sprint.ts:19`, `src/lib/roster.ts:28`, `src/lib/anomaly/reader.ts:37`, `src/lib/sync-state.ts:30`).
- Owner-scoping is **explicit per table**, never inherited through a join (`src/lib/anomaly/load-snapshot.ts:42-59` filters five tables independently). There is no RLS — isolation is app-enforced (memory: `project_supabase_isolation_model`).
- `jiraStatusHistory` (`src/db/schema.ts:551-580`) already stores full `fromCategory`/`toCategory`/`changedAt` transitions, deduped on NOT-NULL `jiraChangelogId`, indexed `(ticketId, changedAt)`. **The roadmap's flagged backfill risk does not exist.** No reader has ever read this table (`src/lib/anomaly/types.ts:19-22` earmarks it for S-10).
- `githubCommit.additions`/`deletions` columns exist (`src/db/schema.ts:437-438`) but the sync writes only `sha`/`author`/`authoredAt`/`message` (`run-sync.ts:291-299`); the omission is deliberate and documented (`src/lib/github.ts:347-351`).
- `validateCredentials()` (`src/lib/jira.ts:198`) already returns the owner's IANA `timeZone` from `/myself`, and `weekdayInTimeZone()` (`src/lib/integrations/cadence.ts:50`) already does DST-correct conversion with a UTC fallback. But **no column stores the zone** — `grep time_zone src/db/schema.ts` returns nothing; S-04 uses the value transiently (`roster-store.ts:419`).
- `SyncStatusBar` (`src/components/organisms/dashboard/sync-status-bar.tsx:43-81`) is a standalone server component rendering per-integration freshness + a friendly-copy error banner. Raw `lastError` is deliberately never forwarded (S-07 impl-review F2).
- **No tabs primitive exists** — no `src/components/ui/tabs.tsx`, and Today is a single column (`dashboard/page.tsx:87-101`). **No Reliability KPI exists** either. The roadmap's claim that S-07 shipped both is wrong.
- `radix-ui@1.4.3` is installed, so `shadcn add tabs`/`chart` add no new Radix dependency. Chart OKLCH tokens `--chart-1..5` are already defined for both themes (`globals.css:25-29,67-71,101-105`).

- **`sprint.committedSp`/`completedSp` are never written.** The columns exist (`schema.ts:334-335`) and three consumers read them (`scope-creep.ts:13`, `sprint-at-risk.ts:83`, both with `?? 0`), but the only writer in the repo is the seed script (`scripts/seed-dashboard.mjs:78`). `roster-store.ts:435-465` omits both from the sprint insert *and* the conflict-update; `run-sync.ts` never updates the sprint row at all. Surface F and the burndown's ideal line would read NULL for every real owner — and every plan check would still pass green against the seed.

**What's missing:** all three reducers, the Sprint Detail route, the tabs primitive, the chart primitive, the three data-side writes above.

## Desired End State

A tech lead with a synced team can:

1. Open `/dashboard` and find the Anomaly Inbox as the landing tab, with **Sprint Pulse**, **Yesterday's Activity**, and **Reliability KPI** each one click away.
2. Click through to `/dashboard/sprint-detail` and see the **aging report** (tickets ordered by time-since-last-movement, with cumulative time in each of the five categories as inline numeric columns), the **Team Activity Matrix** (Dev × Day, one metric at a time via a switcher), and **per-technology sub-burndowns** whose series sum to the total burndown because unattributed SP lands in an explicit `UNKNOWN` track.
3. See the same freshness timestamps and error banner on both dashboards.

**Verification:** `npm run test`, `npm run test:integration`, `npm run test:e2e`, `npm run typecheck`, `npm run lint` all green; manual walkthrough on seeded data confirms both routes render and the Inbox is unregressed.

### Key Discoveries

- **Backfill risk retired** — `run-sync.ts:493-513` already writes every status transition incrementally and idempotently.
- **Time-zone path is 80% built** — only persistence is missing (`jira.ts:239` fetches it, `cadence.ts:50` consumes it).
- **Both cross-system joins are value joins, not FKs** — `jiraTicket.assigneeJiraAccountId → teamMember.jiraAccountId → teamMember.technologyTrack` and `github*.authorGithubUsername → teamMember.githubUsername` are nullable at every hop with no unique constraint. Lossiness must be surfaced, not hidden.
- **`jiraStatusHistory` has no `ownerId` index** (`schema.ts:575-578` indexes `(ticketId, changedAt)`) — reach it through the owner-scoped `jiraTicket` join, and *also* filter it by `ownerId` for the isolation guarantee.
- **Pool discipline** (lessons.md #3) — one request-scoped `getDb` handle, `max:1`, shared across all reducers in a single `Promise.all`. Never `getDbWithPool` (sync/cron only), never a second pool.

## What We're NOT Doing

- **No per-status heatmap** — FR-017 defers it to phase 2; the aging report uses numeric columns.
- **No backfill of historical commit churn** — `additions`/`deletions` are forward-only (research Q3). Pre-existing commits keep NULL and the matrix renders them as "—".
- **No `timestamptz` migration** of `sprint.startDate`/`endDate` — the zone is captured on `jira_project` instead; the existing bare `timestamp` columns are untouched.
- **No between-sprints gate on Sprint Detail** — a CLOSED sprint gets a label, not a different data path; the route renders against whatever `getActiveSprintRow` *row* returns, matching Today and the detection pipeline (research Q4). This is **not** the same as the `null` case: that reader returns `SelectSprint | null` (`sprint.ts:22,36`), and an owner with no sprint row at all still needs the empty state Today already renders — see Phase 4 §1.
- **No inter-sprint history** on the Reliability KPI — current sprint only; the trend view is S-12 territory.
- **No active-link styling in the nav** — `main-nav.tsx` stays a static server component; `usePathname` is out of scope.
- **No second connection pool** and no caching layer.

## Implementation Approach

Data first, then reducers, then primitives, then the safe new route, then the retrofit of the live one. The ordering is deliberate: the Today retrofit touches the north-star surface S-07 shipped, so it happens **last**, on reducers already proven by integration tests and by rendering on a route where a regression harms nothing.

Every surface follows the established boundary: server component fetches and serializes → one `"use client"` organism owns interactivity → pure non-React `.ts` (+ `.test.ts`) owns the sort/aggregate logic (the `anomaly-inbox.tsx` + `inbox-controls.ts` template). Recharts lives only in `"use client"` leaves.

## Critical Implementation Details

**Ordering inside the sync (F1 rule).** `run-sync.ts` completes *all* network reads before opening `db.transaction` (`:270,279-283`). Both new fetches — per-commit detail and `/myself` — must respect this: they run before the transaction, never inside it.

**Cursor semantics make the commit cap one-way.** The GitHub cursor advances to `now` on a successful cycle (documented as impl-review F1 at `run-sync.ts:82-89`), and commits are immutable (`onConflictDoNothing`). A commit skipped by the stats cap is therefore **never revisited** — it is persisted with NULL churn permanently. This is the accepted consequence of the forward-only decision, not a bug to fix later; the matrix must render NULL churn as "—" rather than 0, because 0 would be a lie.

**Passing server-rendered panels into a client tab shell.** Radix `Tabs` is client-only, but the panels are server components that read the DB. Pass them as *element props* (`<DashboardTodayTabs inbox={<AnomalyInbox …/>} pulse={<SprintPulse …/>} …/>`) rather than importing them inside the client component — otherwise the whole panel tree gets pulled across the client boundary and the reads break.

## Phase 1: Data prerequisites — commit churn + Jira time zone

### Overview

Close the two data gaps that would otherwise leave the Activity Matrix with an empty column and a wrong day axis. One schema migration, two sync write paths.

### Changes Required

#### 1. Persist the owner's Jira time zone

**File**: `src/db/schema.ts`

**Intent**: Give the owner's IANA time zone a home so day-bucketing can be done in the team's calendar rather than UTC.

**Contract**: Add `timeZone: text("time_zone")` (nullable) to the `jiraProject` table. `jiraProject.ownerId` is already `.unique()`, so this is exactly one zone per owner. Nullable is load-bearing — existing rows and owners whose Jira omits `timeZone` fall back to UTC.

**File**: `src/db/migrations/` (generated)

**Intent**: Apply the column.

**Contract**: `npm run db:generate` then `npm run db:migrate`. Per `drizzle.config.ts`, `.env.local` redirects this to the local Supabase at `:54322` — confirm the target before running.

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Write the zone on every Jira sync cycle so it self-heals if the owner changes their Jira profile.

**Contract**: In the Jira path, after credentials load and before the transaction, call `validateCredentials(baseUrl, jiraCreds, args.jiraOpts)` (already exported from `src/lib/jira.ts:198`) and persist `identity.timeZone ?? null` onto `jiraProject` inside the existing transaction. Costs +1 subrequest per cycle. Its `JiraAuthError` / `JiraUnavailableError` throws are already handled by the surrounding catch — do not add a second handler.

#### 2. Per-commit churn

**File**: `src/lib/github.ts`

**Intent**: Fetch the per-commit line stats the list endpoint omits.

**Contract**: Add `getCommitDetail(token, repoFullName, sha, opts) → Promise<GithubCommitDetail>` returning `{ additions: number | null; deletions: number | null }` from `GET /repos/{owner}/{repo}/commits/{sha}` → `stats.additions`/`stats.deletions`. Clone `getPullRequestDetail` (`:590-625`) exactly, including its 401 → `GithubAuthError` and non-OK → `GithubUnavailableError` mapping. This is a single-resource GET, so lessons.md #4 (pagination cap + origin check) does not apply. Extend `GithubCommitData` (`:352-357`) with `additions`/`deletions` (both `number | null`) and replace the "intentionally absent" comment with the new forward-only semantics.

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Enrich only the commits that are actually new, newest-first, under a hard per-cycle cap.

**Contract**: Add `const DEFAULT_MAX_COMMIT_STATS_PER_REPO = 30;` beside `DEFAULT_MAX_PRS_PER_SYNC` (`:91`), with a comment recording the one-way cursor consequence **and the cap's unit**. The name says `PER_REPO` deliberately (F5): the enrichment sits inside the `for (const repo of repos)` loop, so the real per-cycle ceiling is `30 × N` — the same looseness `DEFAULT_MAX_PRS_PER_SYNC` already has, where "per-cycle" in its comment (`:81-90`) actually means per-repo (applied at `:229`, consumed at `:273`). Record the arithmetic: each repo already costs ~2 list calls + 30 PRs × (detail + reviews) ≈ 62 subrequests, and this adds up to 30 more, so 5 repos moves a cycle from ~310 to ~460. Confirm that clears the Workers subrequest limit on the deployment plan in use before shipping; if it doesn't, the fix is a shared budget decremented across repos, not a smaller per-repo cap. After `listCommits` and **before** the transaction: select the already-persisted SHAs for this repo from `githubCommit`, drop them from the candidate set, sort the remainder by `authoredAt` descending, take the first 30, and `getCommitDetail` each. Add `additions`/`deletions` to the commit insert `.values(...)` (`:291-299`); keep `.onConflictDoNothing`. Commits beyond the cap are still inserted — with NULL churn. "Commit 31+" in the tests and criteria below means the 31st *new* commit **in one repo**, not across the cycle.

#### 3. Sprint commitment scalars (`committedSp` / `completedSp`)

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Give the Reliability KPI and the burndown baseline real values. Both columns exist (`schema.ts:334-335`) but **nothing writes them** — `roster-store.ts:435-465` omits them from the sprint insert *and* its conflict-update, and the sync never touches the sprint row. Only `scripts/seed-dashboard.mjs:78` sets them, so every real owner reads NULL.

**Contract**: After the per-issue upsert loop and **inside** the same Jira transaction (`:447`), aggregate over `jiraTicket` for `(ownerId, sprintId = chosenSprint.id)` and `UPDATE sprint SET committed_sp, completed_sp`:

- `committedSp` = `SUM(story_points)` where `added_after_sprint_start IS NOT TRUE` (NULL counts as committed — it means "we couldn't tell", and `sprintStart` is only absent on rows that predate cadence import).
- `completedSp` = `SUM(story_points)` where `current_category = 'DONE'`.

Aggregate from the **table**, never from the in-memory `issues` array: `searchSprintIssues` is an incremental delta pull (`updatedSince`, `:422-437`), so `issues` holds only the tickets that changed this cycle. `SUM` over an empty set yields NULL — coalesce to 0 so a sprint with no estimated tickets reads 0 rather than "unknown".

`committedSp` is **recomputed every cycle**, so it tracks mid-sprint estimate edits rather than freezing at sprint start. That is the accepted tradeoff: freezing would need a first-sync-wins guard and a story for what happens when the first sync lands mid-sprint. Record it in a comment beside the update.

Side effect worth knowing: `scope-creep.ts:13` and `sprint-at-risk.ts:83` both read `snapshot.sprint.committedSp ?? 0` and have therefore been dividing by zero-substitutes since S-06. This write makes those rules correct too — expect their anomaly output to change on real data.

### Success Criteria

#### Automated Verification

- Migration generates and applies cleanly: `npm run db:generate && npm run db:migrate`
- Unit tests pass: `npm run test` — covers `getCommitDetail` success / 401 / non-OK / unparseable-body paths in `src/lib/github.test.ts`
- Integration tests pass: `npm run test:integration` — `run-sync.integration.test.ts` asserts (a) `jira_project.time_zone` is written from the `/myself` fixture, (b) new commits land with `additions`/`deletions`, (c) an already-persisted SHA triggers no detail fetch, (d) commit 31+ in one cycle is inserted with NULL churn, (e) `sprint.committed_sp`/`completed_sp` are written from the ticket table — including a delta-pull cycle whose `issues` array is empty, which must still recompute both scalars
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- A real sync cycle against the dev Jira project populates `jira_project.time_zone` with a plausible IANA string
- The same cycle populates `sprint.committed_sp`/`completed_sp` with values that match a manual count of the sprint's tickets in Jira
- Worker logs show no token value and no raw error text (PRD guardrail)

---

## Phase 2: The three reducers (M1 / M2 / M3)

### Overview

Three owner-scoped readers in a new `src/lib/dashboard/` folder, each paired with a pure fold module that carries the actual time math and is unit-testable without a database.

### Changes Required

#### 1. Day bucketing

**File**: `src/lib/dashboard/day-bucket.ts` (+ `.test.ts`)

**Intent**: Convert an instant to a calendar-day key in the team's zone, so a 22:30 Warsaw commit counts as that day rather than the next UTC one.

**Contract**: `dayKeyInTimeZone(date: Date, timeZone?: string): string` → `YYYY-MM-DD`, and `enumerateDayKeys(start: Date, end: Date, timeZone?: string): string[]` → the inclusive ordered day axis. Use `Intl.DateTimeFormat` with `en-CA` (which formats as `YYYY-MM-DD` directly) and the invalid/absent-zone → UTC fallback — fall back, never throw.

Rather than mirroring that fallback (F8), **extract it once**: `cadence.ts:50` declares `weekdayInTimeZone` without `export`, and its try/catch-retry-in-UTC is the same three lines `day-bucket.ts` needs. Export a `safeZone(timeZone?: string): string` (or an equivalent formatter wrapper) from `cadence.ts` — or lift it to a shared module if that reads better — and have both consume it, carrying the DST rationale from `cadence.ts:6-11` with it. Two independent copies drift; `cadence.test.ts` must stay green through the refactor.

#### 2. M3 — time in status (aging report)

**File**: `src/lib/dashboard/time-in-status.ts` (+ `.test.ts`)

**Intent**: Fold one ticket's ordered transitions into cumulative time per category.

**Contract**: `foldTimeInStatus(transitions, { currentCategory, lastStatusChangeAt, now }) → { byCategory: Record<CategoryKey, number>, sinceLastMoveMs: number }`, all values in ms, `CategoryKey = StatusCategory | "UNKNOWN"`. Each `(changedAt[i], changedAt[i+1])` interval accrues to `toCategory[i]`; the final open interval runs from the last `changedAt` (or `lastStatusChangeAt` when history is empty) to `now` and accrues to `currentCategory`. Every one of the five categories is present in the output, zero-valued when never entered. Pure — `now` is a parameter.

**Null handling (F4), load-bearing.** `jiraStatusHistory.toCategory`/`fromCategory`/`changedAt` and `jiraTicket.currentCategory` are all nullable (`schema.ts:534,564-566`), and `run-sync.ts:504-506` writes `categoryOf.get(...) ?? null` — so *any* Jira status the owner never mapped in FR-005 lands as NULL, as does every history row written before a mapping edit. Two rules, applied here and mirrored in §3:

- A transition with a null `changedAt` is **dropped** before the fold (it can't be ordered, so it can't bound an interval).
- A null category accrues to the `UNKNOWN` bucket — never to a `null` key. Same reasoning as M1's `UNKNOWN` track and M2's `UNKNOWN` row: the FR-005 mapping gap is made visible, not silently absorbed into a real category.

Both rules get their own unit test.

**File**: `src/lib/dashboard/aging.ts`

**Intent**: Load the sprint's tickets plus their transitions and fold each one.

**Contract**: `getTicketAging(db, ownerId, sprintId, now) → Promise<TicketAging[]>`, exporting `TicketAging` beside it: `{ ticketId, jiraKey, summary, storyPoints, currentCategory, assigneeJiraAccountId, sinceLastMoveMs, byCategory }`. Two queries, both explicitly owner-scoped: tickets for the sprint, then their transitions joined via `jiraTicket` (also filtered on `jiraStatusHistory.ownerId` for the isolation guarantee) ordered by `(ticketId, changedAt)`. **Tickets whose `currentCategory` is `DONE` are excluded** — a finished ticket has stopped moving, so it would otherwise dominate a "time since last movement" sort with a meaningless age. Sorting is the client's job.

#### 3. M1 — SP over time (burndown + sub-burndowns)

**File**: `src/lib/dashboard/burndown-series.ts` (+ `.test.ts`)

**Intent**: Derive a daily remaining-SP series, overall and per technology track, from DONE transitions.

**Contract**: `buildBurndownSeries({ tickets, transitions, sprintStart, sprintEnd, timeZone, now }) → BurndownSeries` where `BurndownSeries = { days: string[]; committedSp: number | null; total: BurndownPoint[]; byTrack: Record<TrackKey, BurndownPoint[]>; byCategory: Record<CategoryKey, number> }`, `TrackKey = "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | "UNKNOWN"`, and `CategoryKey = StatusCategory | "UNKNOWN"`. `byCategory` is the **ticket count** per current category at `now` — FR-016's "per-status ticket distribution" for Sprint Pulse (F3), folded from the same `tickets` array the series already consumes, so it costs no extra query. All five categories are always present, zero-valued when empty; tickets whose `currentCategory` is NULL count under `UNKNOWN` (§2's null-category rule). A ticket's SP is burned on the day of its **first** transition into `toCategory = DONE` (a later re-open then re-close must not double-burn). Per §2's null rules, transitions with a null `changedAt` are dropped, and a null `toCategory` is **not** DONE — so a ticket completed through an unmapped status never burns. That under-reporting is deliberate but must not be invisible: surface it by counting those tickets under `byCategory.UNKNOWN`, which is what makes the FR-005 mapping gap legible on Sprint Pulse. Days run from `sprintStart` to `min(sprintEnd, now)` via `enumerateDayKeys`. The series baseline is **Σ SP over all sprint tickets**, which is deliberately *not* the same as `committedSp` (Phase 1 §3 excludes `addedAfterSprintStart` tickets from that scalar). They diverge exactly when scope crept — which is the point, and is why `committedSp` is carried on the output as a separate field for the ideal line rather than used as the series' day-0 value. Per research Q1, SP whose assignee is unmapped or whose `technologyTrack` is null goes to `UNKNOWN`, so `Σ byTrack === total` at every point — the lossy join is visible rather than silently dropped. Tickets with null `storyPoints` contribute 0.

**File**: `src/lib/dashboard/burndown.ts`

**Intent**: Feed the fold from the DB.

**Contract**: `getBurndownSeries(db, ownerId, sprintId, now) → Promise<BurndownSeries>`. Reads the sprint row (for `startDate`/`endDate`/`committedSp`), its tickets, their DONE transitions, the roster (for the `jiraAccountId → technologyTrack` map), and `jiraProject.timeZone` — every table owner-scoped. Resolve the track map from the **full** roster including deactivated members (S-07 impl-review F1: a deactivated member must still resolve).

#### 4. M2 — per-dev-per-day GitHub rollup

**File**: `src/lib/dashboard/activity-grid.ts` (+ `.test.ts`)

**Intent**: Bucket raw GitHub events into a Dev × Day grid in the team's zone.

**Contract**: `buildActivityGrid({ commits, pullRequests, reviews, members, from, to, timeZone }) → ActivityGrid` where `ActivityGrid = { days: string[]; rows: ActivityRow[] }` and `ActivityRow = { memberId, memberName, githubUsername, cells: Record<string, ActivityCell> }`, `ActivityCell = { commits: number; additions: number | null; deletions: number | null; prsOpened: number; prsMerged: number; reviews: number }`. Churn is `null` when **every** contributing commit had NULL churn (forward-only consequence — the UI must show "—", not 0) and the sum of the non-null ones otherwise. Events whose author login matches no roster member are aggregated into one trailing `UNKNOWN` row, mirroring M1's bucket rather than dropping them.

**File**: `src/lib/dashboard/activity.ts`

**Intent**: One reader serving both the sprint-range matrix and the single-day Yesterday panel.

**Contract**: `getActivityRollup(db, ownerId, { from, to }, now) → Promise<ActivityGrid>`. Commits by `authoredAt`, PRs by `openedAt`/`mergedAt`, reviews by `submittedAt`, each owner-scoped and range-bounded; roster and `jiraProject.timeZone` resolved alongside. Note for the implementer: `githubPullRequest` has no `openedAt`/`mergedAt` index (`schema.ts:485-486` index `state` and `linkedTicketKey`), so the PR leg scans the owner's PRs — acceptable at the 3–10-person target scale, and the range bound keeps it small.

#### 5. Reader integration tests

**File**: `src/lib/dashboard/readers.integration.test.ts`

**Intent**: Prove the three readers against real Postgres, including the isolation guarantee.

**Contract**: Mirror `src/lib/dashboard-readers.integration.test.ts:20-41` — module-level `Pool({ max: 1 })`, `seedOwner()` helper, `afterEach` cascade-delete by `user.id`. Each reader gets a happy path **and** a two-owner test asserting owner B's rows never appear in owner A's result.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test` — day bucketing across a DST boundary and an invalid zone; `foldTimeInStatus` with empty history, a single transition, a re-open, a null `changedAt`, and a null category; burndown non-double-burn on re-open, `Σ byTrack === total`, and `Σ byCategory === ticket count`; grid null-churn vs summed-churn and the `UNKNOWN` row
- Integration tests pass: `npm run test:integration` — all three readers, each with a cross-account isolation assertion
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Against seeded data, the burndown's day-0 remaining SP equals Σ SP over the sprint's tickets, and equals `committedSp` exactly when no ticket carries `addedAfterSprintStart`
- Sub-burndown series visibly sum to the total series (spot-check one day)

---

## Phase 3: shadcn primitives + chart foundation

### Overview

Add the two missing primitives and prove Recharts survives the Workers build before any surface depends on it.

### Changes Required

#### 1. Primitives

**File**: `src/components/ui/tabs.tsx`, `src/components/ui/chart.tsx`

**Intent**: Install the shadcn primitives the surfaces need.

**Contract**: `npx shadcn add tabs chart`. **Never re-run `shadcn init`** (memory: `project_shadcn_setup`) — `components.json` is already wired. `chart` pulls `recharts@3.8.0`; `radix-ui` is already present so `tabs` adds no new dependency. Review the generated files rather than assuming they are correct.

#### 2. Chart theming convention

**File**: `src/components/organisms/dashboard/chart-theme.ts`

**Intent**: One place mapping series keys to the existing OKLCH tokens, so five surfaces don't each invent a palette.

**Contract**: Export a `ChartConfig` for the five track keys using `color: "var(--chart-N)"` (tokens already defined for both themes at `globals.css:67-71,101-105`), with `UNKNOWN` visually muted to read as "unattributed" rather than as a peer track.

### Success Criteria

#### Automated Verification

- Production build passes: `npm run build`
- Workers build passes: `npm run build:cf`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- A throwaway chart renders in both light and dark theme with legible series colors
- `build:cf` output shows no Node-API warning attributable to recharts

---

## Phase 4: Sprint Detail route (surfaces A, B, C)

### Overview

The new dashboard. Built first because a regression here costs nothing — Today is untouched until Phase 5.

### Changes Required

#### 1. Route

**File**: `src/app/(app)/dashboard/sprint-detail/page.tsx`

**Intent**: Boot the three reducers on one pool and serialize for the client organisms.

**Contract**: Clone the boot sequence of `dashboard/page.tsx:26-36` — `requireSession()` → `getCloudflareContext().env` → `getDb(env)` → resolve the sprint once → fan out `getTicketAging` / `getActivityRollup` / `getBurndownSeries` / `getSyncState` / `listRoster` in **one** `Promise.all` on the shared handle. Do **not** re-declare `force-dynamic` or `requireSession` (inherited from `(app)/layout.tsx:9,22`). Serialize every `Date` to an ISO string before it crosses the client boundary. Render `<SyncStatusBar>` and the `max-w-6xl` header shell. Per research Q4, when `sprint.state !== "ACTIVE"` render a muted "sprint closed" badge beside the heading — a label only, no data-path change.

**Matrix range (F7).** `getActivityRollup` takes an explicit `{ from, to }` — pass `sprintStart → min(sprintEnd, now)`, the same window `enumerateDayKeys` gives M1, so the matrix columns and the sub-burndown x-axis are one calendar rather than two that nearly agree.

**Null-sprint guard (F2).** `getActiveSprintRow` returns `SelectSprint | null`, and `middleware.ts` gates only on the session cookie — there is no setup gate, so a freshly signed-up owner can reach this route from the nav link with no sprint row at all. Mirror `dashboard/page.tsx:31-33`: resolve the sprint *before* the fan-out and, when it is null, run only the sprint-independent reads (`getSyncState`, `listRoster`) and render the same "no active sprint" empty state Today uses. The three sprint-scoped reducers all take a non-optional `sprintId` — never call them with a null sprint.

**File**: `src/components/molecules/main-nav.tsx`

**Intent**: Make the new route reachable.

**Contract**: Add `{ label: "Sprint Detail", href: "/dashboard/sprint-detail" }` to `NAV_ITEMS`. Update the file's comment, which currently claims only Dashboard is live.

#### 2. Surface A — aging report

**File**: `src/components/organisms/dashboard/aging-report.tsx` (`"use client"`) + `aging-report-controls.ts` (+ `.test.ts`)

**Intent**: Sortable table of stalled tickets with cumulative time per category inline.

**Contract**: Columns: ticket key (deep-linked), summary, SP, current status, **time since last move** (the default sort, descending), then five numeric columns — To Do / In Progress / Code Review / Testing / Done — each formatted `2d 4h`. Per F4 the fold also carries an `UNKNOWN` bucket: render it as a **sixth column only when some ticket in the result has a non-zero value there**, so the common well-mapped case keeps the five columns FR-017 describes and a mapping gap still surfaces instead of vanishing. Every column sortable; sort state and duration formatting live in the pure `aging-report-controls.ts`, not in the component. The table sits in an `overflow-x-auto` container for the 10-inch tablet floor (NFR).

#### 3. Surface B — Team Activity Matrix

**File**: `src/components/organisms/dashboard/activity-matrix.tsx` (`"use client"`) + `activity-matrix-view.ts` (+ `.test.ts`)

**Intent**: Dev × Day grid, one metric at a time.

**Contract**: A segmented switcher (Commits | Lines | PRs | Reviews) above the grid; each cell shows one number with a background-intensity ramp relative to that metric's max in the current grid. **Null churn renders `—`, never `0`.** Metric selection, max-scaling, and cell formatting live in `activity-matrix-view.ts`. Rows are labeled from the **full** roster (F1) with the `UNKNOWN` row last; horizontally scrollable container.

#### 4. Surface C — per-technology sub-burndowns

**File**: `src/components/organisms/dashboard/sub-burndown-chart.tsx` (`"use client"`)

**Intent**: Remaining SP per track over the sprint.

**Contract**: A Recharts `LineChart` leaf — one line per `TrackKey` present in the data — inside `ChartContainer` with the Phase-3 `ChartConfig`, plus `ChartTooltip`/`ChartLegend`. Import only the primitives used (`LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`) to keep the route chunk small. Receives plain serialized data; no DB access, no `Date` objects.

#### 5. Tabs shell

**File**: `src/components/organisms/dashboard/sprint-detail-tabs.tsx` (`"use client"`)

**Intent**: Host the three surfaces without pulling their data reads across the client boundary.

**Contract**: Accepts `aging`, `matrix`, `burndown` as **element props** and renders them into `TabsContent`. Default tab: aging report.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test` — `aging-report-controls` sorting across all seven columns; `activity-matrix-view` metric switching, intensity scaling, and null-churn formatting
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification

- `/dashboard/sprint-detail` renders all three surfaces on seeded data
- An owner with no sprint row (fresh sign-up, no setup) gets the empty state rather than an error page
- Aging report defaults to time-since-last-move descending; every column sorts both ways
- Matrix switcher changes the rendered metric; a commit without churn shows `—`
- Sub-burndown lines render in both themes; `UNKNOWN` is visually distinguishable from real tracks
- Page is usable at 10-inch tablet width — wide tables scroll inside their container, the page body does not
- Error banner and freshness timestamps appear, with no raw error text (F2)

---

## Phase 5: Today retrofit (surfaces D, E, F)

### Overview

Put the Anomaly Inbox behind a tab shell and add the three panels FR-016 specifies, reusing M1 and M2 unchanged. The riskiest phase — it modifies the shipped north-star surface.

### Changes Required

#### 1. Tab shell

**File**: `src/components/organisms/dashboard/today-tabs.tsx` (`"use client"`)

**Intent**: Four tabs with the Inbox unambiguously first.

**Contract**: Accepts `inbox`, `pulse`, `yesterday`, `reliability` as element props. Default tab is `inbox` (FR-016: the inbox is the headline, everything else is "one click away").

#### 2. Surface D — Sprint Pulse

**File**: `src/components/organisms/dashboard/sprint-pulse.tsx` (`"use client"`)

**Intent**: The total sprint burndown plus the current status distribution.

**Contract**: Renders `BurndownSeries.total` as a Recharts `AreaChart` leaf against an ideal straight line from `committedSp` to 0, beside a per-category ticket-count summary read from `BurndownSeries.byCategory` (F3 — the field exists for exactly this). When `committedSp` is null the ideal line is omitted, not drawn at 0. Scope-change context is out of scope here — `SCOPE_CREEP` is already an inbox anomaly.

#### 3. Surface E — Yesterday's Activity

**File**: `src/components/organisms/dashboard/yesterday-activity.tsx` (server component)

**Intent**: Per-developer commits / PRs opened / PRs merged / reviews for the previous calendar day.

**Contract**: No interactivity, so no client boundary: a plain table over a **single-day** `getActivityRollup` range. "Yesterday" is resolved in the team's zone via `dayKeyInTimeZone`, not UTC. Members with no activity render as zero rows rather than being omitted (US-01: "no zero rows for developers who were active" cuts both ways — absence must be visible).

#### 4. Surface F — Reliability KPI

**File**: `src/components/organisms/dashboard/reliability-kpi.tsx` (`"use client"`)

**Intent**: Committed SP vs delivered SP for the current sprint.

**Contract**: A two-bar Recharts `BarChart` leaf reading `sprint.committedSp`/`completedSp` directly — no reducer. Phase 1 §3 is what makes these non-NULL; without it this surface is a permanent empty state. When either is still null (an owner whose sprint predates the Phase-1 write and hasn't re-synced), render an explanatory empty state instead of a zero bar. Single sprint only; the historical trend is S-12.

#### 5. Page wiring

**File**: `src/app/(app)/dashboard/page.tsx`

**Intent**: Add the three reads and wrap the existing content in the tab shell.

**Contract**: Extend the existing `Promise.all` (`:32-36`) with `getBurndownSeries` and a single-day `getActivityRollup` on the **same** `db` handle — do not add a second `Promise.all` or a second pool (lessons.md #3). The `<AnomalyInbox>` element and every prop it receives stay **byte-identical**; it simply becomes the `inbox` element prop of `<DashboardTodayTabs>`. `SyncStatusBar` stays outside the tabs so freshness and errors are visible on every tab.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test` — existing `inbox-controls.test.ts` unchanged and green
- Integration tests pass: `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`; Workers build passes: `npm run build:cf`

#### Manual Verification

- `/dashboard` opens on the Anomaly Inbox with sorting and filtering behaving exactly as before the retrofit
- All four tabs render; freshness bar and error banner remain visible across tab switches
- Yesterday's Activity counts match the seeded fixture for the correct calendar day in the team's zone
- Reliability KPI shows its empty state when `committedSp` is null
- Today page render latency is acceptable on the `max:1` pool with the widened fan-out (the measurement Performance Considerations defers to this phase)

---

## Phase 6: E2E coverage + slice closeout

### Overview

Prove the two routes work in a browser, then record the slice.

### Changes Required

#### 1. Seed extension

**File**: `scripts/seed-dashboard.mjs`

**Intent**: The current seed covers anomalies only; the new surfaces need their upstream rows.

**Contract**: Extend the idempotent seed with `jira_ticket` rows carrying story points and assignees, `jira_status_history` transitions spread across the sprint (including at least one DONE transition per track and one re-open), `github_commit` rows both with and without churn, `github_pull_request`, and `github_review`. Set `jira_project.time_zone`. Keep the existing clear-then-insert idempotency so re-running still resets.

#### 2. E2E specs

**File**: `e2e/dashboard-sprint-detail.spec.ts`

**Intent**: Cover the retrofit of the live route and the click-through to the new one.

**Contract**: Drive this through the **`/10x-e2e` skill** (CLAUDE.md names it the single source of truth), not by hand. Risks to cover: (a) Today still opens on the Inbox after the retrofit, (b) each Today tab reveals its panel, (c) navigation to Sprint Detail renders all three surfaces, (d) the matrix metric switcher changes the rendered values. Locators via `getByRole`/`getByLabel`/`getByText`; never `waitForTimeout`; unique ids per run.

#### 3. Closeout

**File**: `context/foundation/roadmap.md`

**Intent**: Record what actually shipped, and repair the S-07 row that overstated it.

**Contract**: Mark S-10 `done` with its delivered scope. Correct the S-07 row, which currently claims a Reliability KPI tab that S-07 never built (memory: `project_s07_delivered_scope_gap`) — it ships here. Unblock S-09 (demo mode), whose prerequisite was S-07 plus these dashboards.

### Success Criteria

#### Automated Verification

- E2E suite passes: `npm run test:e2e`
- Full unit suite passes: `npm run test`
- Full integration suite passes: `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Seed reset then re-run produces a coherent sprint story across both dashboards
- `/10x-impl-review` run on the branch with findings triaged
- Roadmap reflects delivered scope, including the corrected S-07 row

---

## Phase 7: Connections — data, history, and actions

### Overview

**Scope addition (2026-08-22, user request.)** S-10 is FR-016/FR-017 — dashboards.
A connections surface is FR-002/FR-003/FR-011 territory and does not thematically
belong to this slice; it is being built here because the owner hit the gap while
testing S-10 and asked for it on this branch. The roadmap records it as an S-10
scope extension rather than pretending it was always in scope — the same
delivered-scope honesty this slice had to apply to the S-07 row.

**The gap.** The setup wizard connects GitHub and Jira and already renders a
connected-state card with Disconnect for each (`setup/github/page.tsx:47-53`,
`setup/jira/page.tsx`). But nothing links there after first run — `main-nav.tsx`
carries Dashboard / Sprint Detail / Refinement only — and no surface shows both
integrations' sync health side by side. `syncNow()` exists and is fully wired
(`integrations/sync/actions.ts:27`, its own comment anticipates "a future 'sync
now' button") but has **no caller anywhere in the app**. So the owner can see a
red banner saying GitHub failed and has no route to any further detail.

This phase builds the server side; Phase 8 builds the surface.

### Changes Required

#### 1. Failure-reason classification (no raw error text)

**File**: `src/lib/integrations/failure-reason.ts` (+ `.test.ts`)

**Intent**: Turn a stored sync status into something a lead can act on, without
widening the client payload.

**Contract**: `classifyFailure(status, integration) → { headline, whatToDo }`,
pure. `ERROR` → the token was rejected, reconnect it; `RATE_LIMITED` → the API is
throttling, SprintFlow retries automatically. **`sync_state.last_error` is still
never forwarded to the client** (S-07 impl-review F2 stands): `classifyError`
(`run-sync.ts:231`) has a fallback branch writing an arbitrary `err.message`,
which can be a Postgres error or any non-typed throw — an unbounded string that
has never been audited for secrets. Classification reads `status` only.

#### 2. Live connection test

**File**: `src/app/(app)/settings/connections/actions.ts`

**Intent**: Answer the question the owner actually has — *is my token still
valid right now?* — which a stale error log cannot.

**Contract**: `testGithubConnection()` and `testJiraConnection()`, both
`requireSession()` → load the stored credential via the existing
`loadGithubToken` / `loadJiraCredentials` (`integrations/credentials.ts`) → call
`validatePat` / `validateCredentials` → return
`{ ok: true; login|accountId } | { ok: false; reason: "auth" | "unavailable" }`.
The decrypted token is used for the outbound call and **never returned, logged,
or placed in the result** — same discipline as the setup actions. A
`MissingCredentialError` returns a `not_connected` result rather than throwing.

#### 3. Edit the monitored selection without reconnecting

**File**: `src/app/(app)/settings/connections/actions.ts`

**Intent**: Change which repos / which Jira project are monitored without making
the owner paste their token again.

**Contract**: `updateMonitoredRepos(selectedRepoIds)` and
`updateJiraProject(jiraProjectId, mappings)`. Both exist because
`storeGithubIntegration` / `storeJiraIntegration` take a **raw token** and
re-encrypt it (`github/actions.ts:119`, `jira/actions.ts:199`) — they cannot be
reused for an edit. These load the stored credential instead, re-list the
available repos/projects to validate the selection against reality, and replace
the `monitored_repo` / `jira_project` + `status_mapping` rows in one transaction.
Owner-scoped on every write.

**Blast radius to respect**: changing the Jira project cascades — `sprint`,
`jira_ticket`, and `jira_status_history` all hang off `jiraProject.id`. The
action must state what will be discarded and the UI must confirm before calling
it (Phase 8).

#### 4. Sync attempt history

**File**: `src/db/schema.ts`, `src/db/migrations/` (generated)

**Intent**: `sync_state` holds exactly one row per `(owner, integration)`,
overwritten every cycle — so "why did it fail an hour ago" is unanswerable today.

**Contract**: New `sync_attempt` table: `id`, `ownerId` (cascade), `integration`,
`startedAt`, `finishedAt`, `status` (reuse the `syncStatus` enum), `outcome`
(text — the `IntegrationOutcome` skip reason where applicable), indexed
`(ownerId, integration, finishedAt desc)`. **No error text column** — same
reasoning as §1; the row carries a classifiable status, not a message.

**Retention is load-bearing.** The PRD's retention non-goal bounds product data
to current + 2 sprints and says nothing about an operational log, so this table
sets its own bound: keep the newest `SYNC_ATTEMPT_RETENTION = 50` rows per
`(owner, integration)`, pruned in the same statement that appends. Unbounded, a
15-minute cron writes ~3.5k rows per owner per month forever.

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Record every terminal outcome.

**Contract**: Append inside `finalizeSyncState` (`:203`) — the single choke point
both integrations already funnel through, so no call site changes. This is the
repo's highest-risk file: the insert must not be able to fail the sync it is
recording, so it goes **after** the `syncState` update in the same function and
its failure must not propagate (a lost log line is strictly better than a lost
sync). Integration test asserts an attempt row per cycle and that the prune keeps
the cap.

#### 5. Connections reader

**File**: `src/lib/settings/connections.ts` (+ integration test)

**Intent**: One owner-scoped read feeding the whole surface.

**Contract**: `getConnectionsOverview(db, ownerId) → ConnectionsOverview` with,
per integration: connected (bool), the non-secret identity already shown in the
wizard (GitHub login + `tokenLast4` + monitored repo list; Jira workspace + email
+ project key + mapping count), `status`, `lastSuccessfulSyncAt`, `lastAttemptAt`,
and the recent `sync_attempt` rows. Every table filtered on `ownerId` explicitly —
no RLS behind this. **Never selects `encryptedToken` or `lastError`.**

### Success Criteria

#### Automated Verification

- Migration generates and applies cleanly: `npm run db:generate && npm run db:migrate`
- Unit tests pass: `npm run test` — `classifyFailure` covers every status, and
  asserts no branch can emit a stored error string
- Integration tests pass: `npm run test:integration` — attempt row written per
  cycle; prune holds the retention cap; `getConnectionsOverview` shape + a
  two-owner cross-account isolation assertion; `updateMonitoredRepos` /
  `updateJiraProject` replace rather than duplicate rows
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- A forced sync writes exactly one attempt row per integration
- No token, no raw error text in the payload of any new action (inspect the
  network tab, not just the DB)

---

## Phase 8: `/settings` shell + Connections tab

### Overview

The surface. Built as a **tabbed settings shell** rather than a standalone
`/connections` route because S-14 (anomaly thresholds) is already on the roadmap
as "a dedicated settings page" — building the shell now makes S-14 a second tab
instead of a second route plus a migration.

### Changes Required

#### 1. Route + shell + nav

**File**: `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`,
`src/app/(app)/settings/connections/page.tsx`

**Contract**: `/settings` redirects to `/settings/connections` (mirroring
`setup/page.tsx:7`, which redirects to its first step). The layout renders the
`max-w-6xl` header shell plus tab-style navigation; with one tab today it must
still read as a shell S-14 can extend. Inherits `requireSession()` +
`force-dynamic` from `(app)/layout.tsx` — do **not** re-declare either. One
`getDb` handle, `getConnectionsOverview` in a single read.

**File**: `src/components/molecules/main-nav.tsx`

**Contract**: Add `{ label: "Settings", href: "/settings" }`. This is the fix for
the reported gap — the wizard's connected-state pages have been unreachable since
S-02/S-03 shipped.

#### 2. Integration cards

**File**: `src/components/organisms/settings/integration-card.tsx` (`"use client"`)

**Contract**: One card per integration showing: connected identity, monitored
selection, last successful sync, current status badge, and — when failing — the
Phase 7 §1 classified reason with its suggested action. Actions: **Test
connection** (§2, inline verdict), **Reconnect** / **Disconnect** (reuse the
existing wizard forms and `disconnectGithub` / `disconnectJira`), and **Edit
selection** (§3). The Jira project change is behind a confirmation naming what
gets discarded, per §3's blast radius.

Not-connected is a first-class state, not an error: it renders a link into the
wizard, because that is exactly the state a fresh owner is in.

#### 3. Sync now

**File**: `src/components/organisms/settings/sync-now-button.tsx` (`"use client"`)

**Contract**: Calls the existing `syncNow()` (`integrations/sync/actions.ts:27`)
— no new server code. Disabled while in flight, renders the returned
per-integration outcome (including `SKIPPED` with its reason, which is a normal
result the lead should be able to read, not a failure), then refreshes the
overview. The action already bypasses the freshness due-check.

#### 4. Attempt history

**File**: `src/components/organisms/settings/sync-history.tsx`

**Contract**: A plain server-rendered table of the recent attempts per
integration — timestamp, outcome, classified reason. No interactivity, so no
client boundary. This is the "why did it fail earlier" answer.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`; Workers build passes: `npm run build:cf`
- E2E passes: `npm run test:e2e` — a connected owner reaches `/settings` from the
  nav and sees both integrations with their status

#### Manual Verification

- `/settings` reachable from the nav on every page
- A genuinely broken GitHub token shows the classified reason, and **Test
  connection** reports the live failure
- **Sync now** runs and the timestamps advance
- Changing monitored repos persists without re-entering the token
- Changing the Jira project warns about discarded sprint data before proceeding
- Not-connected state links into the wizard
- Usable at 10-inch tablet width; legible in dark mode

---

## Phase 9: Split the wizard from single-integration connect

### Overview

**Reported after Phase 8 shipped.** Entering GitHub from Settings drops the owner
into the *wizard*: a "Step 1 of 3" progress bar, and on success a "Continue to
Jira" CTA pulling them through a flow they never asked for. They came to
reconnect one integration and should land back in Settings.

Two defects, one root cause — Phase 8 reused the wizard **routes** when it should
have reused the wizard **forms**:

1. **Wizard chrome leaks into a single-integration task.** `reconnectHref` points
   at `/setup/github`, which renders `SetupWizardShell step={1}` and, on success,
   `GithubConnectionStatus` with its "Continue to Jira" link.
2. **"Reconnect" cannot reconnect.** `/setup/github` renders the connect *form*
   only when no credential exists (`setup/github/page.tsx:47-53`); with one
   stored it renders the status card. So the button labelled Reconnect shows a
   read-only card — there is no way to replace a token short of disconnecting
   first.

The wizard itself is correct and stays **untouched** — this phase adds a second
entry point, it does not modify the first.

### Changes Required

#### 1. Make the post-success destination injectable

**File**: `src/components/organisms/setup/github-connect-form.tsx`,
`src/components/organisms/setup/jira-connect-form.tsx`

**Intent**: Same form, two callers, different "what happens next".

**Contract**: Add an optional `redirectTo?: string`. When set, the success path
does `router.push(redirectTo)` instead of `router.refresh()`; when absent the
behavior is **byte-identical to today**, so the wizard is unaffected. A string,
not a callback — these are client components rendered from server components,
and a function prop cannot cross that boundary.

The toast stays in both paths: it is the only success signal the owner gets once
the page navigates away.

#### 2. Settings-scoped connect routes

**File**: `src/app/(app)/settings/connections/github/page.tsx`,
`src/app/(app)/settings/connections/jira/page.tsx`

**Intent**: One integration, one step, no stepper, back to Settings.

**Contract**: Server components rendering the connect form with
`redirectTo="/settings/connections"`. **No `SetupWizardShell`** — no step count,
no progress bar, no cross-integration CTA. They nest under
`settings/layout.tsx`, so the Settings heading and tab bar stay visible and the
owner never loses the sense of where they are.

**These always render the FORM, never the status card** — that is the fix for
defect 2. Status belongs on the Settings card; this route is the single action
of (re)connecting. When a credential already exists the page says so, so
"replace the token" is a deliberate act rather than a surprise.

#### 3. Point Settings at the new routes

**File**: `src/components/organisms/settings/integration-card.tsx` (call site in
`settings/connections/page.tsx`)

**Contract**: `reconnectHref` becomes `/settings/connections/{github,jira}` for
both the connected ("Reconnect") and not-connected ("Connect X") states. Nothing
in Settings links into `/setup/*` any more.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build and Workers build pass
- E2E passes: entering GitHub connect from Settings shows **no** "Step 1 of 3"
  and no "Continue to Jira"; the wizard's own route still shows both

#### Manual Verification

- Settings → Connect/Reconnect GitHub: single form, no stepper, no progress bar
- After a successful connect, the browser lands back on `/settings/connections`
  with the card showing the new state
- Same for Jira, including the multi-stage project + mapping flow
- The wizard at `/setup/github` is unchanged: stepper present, "Continue to Jira"
  present
- Reconnecting over an existing credential replaces it without a prior disconnect

---

## Phase 10: An undecryptable credential must not crash the sync

### Overview

**Found while manually testing Phase 9.** "Sync now" returned a 500:

```
TokenCryptoError: Malformed token envelope.
  at decryptToken (src/lib/crypto.ts:112)
  at loadJiraCredentials (src/lib/integrations/credentials.ts:100)
  at syncJira (src/lib/integrations/sync/run-sync.ts:497)
```

The immediate trigger was the demo seed, which writes the literal string
`seed-placeholder-not-a-real-token` into `encrypted_token` — not a valid
envelope, so `decryptToken` rejects it. But the seed only *exposed* the defect;
it is not the defect.

**`TokenCryptoError` is caught in exactly one place in the whole repo**
(`setup/team/actions.ts:239`). The sync path rethrows it:

```ts
} catch (err) {
  if (err instanceof MissingCredentialError) return { status: "SKIPPED", … };
  throw err;                     // ← escapes syncOwner entirely
}
```

Three consequences, all of them product bugs:

1. **Unhandled crash** — the throw escapes `syncOwner` → `syncNow` → a 500 in a
   Server Action. The PRD guardrail is explicit: never an unhandled crash.
2. **Per-integration independence breaks.** `syncGithub` runs first and commits
   its work; `syncJira` then throws and the whole action fails, so the owner
   sees a 500 and no GitHub result. The entire point of separate `sync_state`
   rows is that one integration's failure cannot take the other down.
3. **It is reachable in production**, not just from the seed: rotating
   `TOKEN_ENCRYPTION_KEY`, restoring a DB snapshot across environments, or a
   tampered row all produce exactly this. The AEAD envelope is *designed* to
   detect those — and detection currently takes the app down.

### Changes Required

#### 1. Contain it in the sync, per integration

**File**: `src/lib/integrations/sync/run-sync.ts`

**Contract**: In both credential-load catches, treat `TokenCryptoError` as a
**terminal ERROR for that integration only** — stamp `sync_state` and return
`{ status: "ERROR" }` rather than rethrowing. The other integration still runs
and still reports.

The credential load happens *before* `acquireLease`, so the `sync_state` row may
not exist yet. Extract the row-ensuring upsert `acquireLease` already performs
into `ensureSyncStateRow` and call it first — otherwise the stamp is a silent
no-op and the owner sees no status change at all.

Also add `TokenCryptoError` to `classifyError` so it maps to ERROR ("reconnect")
rather than falling through to the generic "Unknown sync error" branch if it
ever surfaces from elsewhere in the try block.

`MissingCredentialError` keeps returning `SKIPPED / not_connected` — nothing was
attempted. An unreadable credential is the opposite: something IS configured and
it is broken, which the owner must act on.

#### 2. Report it from "Test connection"

**File**: `src/lib/settings/connection-service.ts`

**Contract**: `testGithubConnection` / `testJiraConnection` currently catch only
`MissingCredentialError`, so a `TokenCryptoError` throws out of the action —
the diagnostic tool crashes on precisely the case it exists to diagnose. Add a
`credential_unreadable` reason to `ConnectionTestResult` and surface it with
copy that names the fix (reconnect), since no retry will help.

#### 3. Stop the seed writing an invalid envelope

**File**: `scripts/seed-dashboard.mjs`

**Contract**: Encrypt the placeholder through `encryptToken()` (as the
integration tests do) instead of storing raw text. The token value stays fake,
so a real API call still fails — which is the intended demo state — but it now
fails as a clean `ERROR` status instead of a crash, and the demo exercises the
same code path a real owner does.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration` — a corrupted
  `encrypted_token` yields `ERROR` for that integration while the OTHER
  integration still completes; `testConnection` returns `credential_unreadable`
  rather than throwing
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build and Workers build pass

#### Manual Verification

- "Sync now" against the seeded account returns a result instead of a 500
- The failing integration's card shows a reason; the healthy one is unaffected
- Re-running the seed produces a decryptable (but still fake) credential

---

## Testing Strategy

### Unit Tests

- `dayKeyInTimeZone` across a DST transition, an invalid zone (falls back to UTC, never throws), and an absent zone
- `foldTimeInStatus`: empty history, single transition, re-open sequence, open final interval; all five categories always present; a null-`changedAt` transition is dropped; a null-category transition accrues to `UNKNOWN`, never to a `null` key
- `buildBurndownSeries`: no double-burn on re-open, `Σ byTrack === total` at every point, `Σ byCategory === ticket count` with null categories under `UNKNOWN`, null-SP tickets contribute 0, day axis clamped to `min(sprintEnd, now)`
- `buildActivityGrid`: null churn stays null when all contributors are null, unmapped authors land in `UNKNOWN`, empty days render as zero cells
- `aging-report-controls`: sorting across all seven columns, both directions
- `activity-matrix-view`: metric switching, intensity scaling, `—` for null churn

### Integration Tests

- Each reader against real Postgres with a two-owner seed asserting cross-account isolation (the PRD guardrail; there is no RLS behind it)
- `run-sync`: time-zone write, commit-churn write, dedup-aware skip, over-cap NULL churn

### Manual Testing Steps

1. Seed a demo owner, open `/dashboard`, confirm the Inbox is the landing tab and behaves as before.
2. Visit each of the other three tabs; confirm data renders and the freshness bar stays visible.
3. Click through to `/dashboard/sprint-detail`; confirm all three surfaces render.
4. Sort the aging report by each column; switch the matrix metric; hover a sub-burndown series.
5. Narrow the viewport to 10-inch tablet width; confirm wide tables scroll inside their container and the page body does not scroll horizontally.
6. Toggle dark mode; confirm chart series stay legible.
7. Break a token to force a sync error; confirm the banner appears on both routes with friendly copy and no raw error text.

## Performance Considerations

The request-scoped pool is `max:1`, so every reducer query serializes (research Q5). Phase 5's Today page runs the heaviest fan-out: the existing three reads plus M1 plus a single-day M2. At the target scale (≤10 developers, one sprint of tickets, commits, and PRs) this is expected to be acceptable — **measure it during Phase 5 manual verification**. If it is not, pre-aggregate M2 into fewer round-trips; do **not** open a second pool (lessons.md #3).

The PR leg of M2 has no supporting index on `openedAt`/`mergedAt`; the range bound is what keeps it cheap. If the matrix becomes slow on a large owner, an index on `(ownerId, openedAt)` is the fix — noted, not done here.

## Migration Notes

One additive, nullable column (`jira_project.time_zone`). No data migration, no backfill, no destructive change; rollback is dropping the column. Commit churn is forward-only by decision — historical commits keep NULL permanently and the UI renders that honestly.

## References

- Frame brief: `context/changes/dashboard-sprint-detail/frame.md`
- Research: `context/changes/dashboard-sprint-detail/research.md` (Q1–Q4 resolved; Q5 addressed under Performance Considerations)
- Reader convention: `src/lib/sprint.ts:19`, `src/lib/anomaly/load-snapshot.ts:42-59`
- Page boot to clone: `src/app/(app)/dashboard/page.tsx:26-36,87-101`
- Client-boundary template: `src/components/organisms/anomaly/anomaly-inbox.tsx:1,64-77` + `inbox-controls.ts`
- Integration-test convention: `src/lib/dashboard-readers.integration.test.ts:20-41`
- Sync detail pattern to clone: `src/lib/github.ts:590-625`
- S-07 carry-overs: `context/archive/2026-08-21-dashboard-today/reviews/impl-review.md` (F1, F2, F4)
- Lessons: `context/foundation/lessons.md` #1, #3, #4

## Manual verification runbook

> Written 2026-08-22 so the remaining manual pass can be done cold, without
> reconstructing any of it from a chat log. `## Progress` stays canonical for
> what is done; this section is *how* to do what is left.

### Prerequisites

1. Local Supabase up (`npx supabase status`), migrations applied through `0006`.
2. `npm run dev`.
3. **Stop `npm run dev` before `npm run test:e2e`.** `playwright.config.ts` has
   `reuseExistingServer: !CI`, so Playwright adopts a dev server started without
   `GITHUB_API_BASE_URL` / `JIRA_API_BASE_URL` and the `setup-*` specs then hit
   the real APIs with a fixture token and fail. This bit twice; it is a
   documented tradeoff, not a bug.

### Which account for which check

Two accounts exist and they are **not interchangeable** — most of the remaining
rows fail for the wrong reason if run on the wrong one.

| Account | Credentials | Data | Use it for |
|---|---|---|---|
| `adam.reszka85@gmail.com` | **fake** (seed, `last4=0000`) | rich: 11 tickets, 16 transitions, 14 commits (2 with NULL churn), 5 PRs, 4 reviews, `Sprint 24` committed 40 / completed 18, tz `Europe/Warsaw`; GitHub `sync_state` deliberately ERROR | every dashboard-surface row: 2.5, 2.6, 3.5, 4.5–4.10, 5.6–5.10, 6.6, 8.12 |
| `demo@sprintflow.test` | **real** — GitHub `AdamLisek/tenexdevs1`, Jira `foxmind.atlassian.net` project `FM` | as of 20:11 both integrations OK but **0 tickets, 0 commits** synced | the real-sync rows: 1.7, 1.8, 7.6, 7.7 |
| a fresh sign-up | none | none | 4.11 (no-sprint empty state), 5.9 (Reliability KPI null state) |

Re-seed the first account with
`EMAIL=adam.reszka85@gmail.com npm run db:seed:demo` (idempotent — it clears and
re-inserts). **Never seed the second one**; it holds real credentials.

### Open question to resolve first

`demo@sprintflow.test` reports **GitHub OK and Jira OK, yet synced 0 tickets and
0 commits.**

**0 commits is explained** — the owner confirms `AdamLisek/tenexdevs1` has about
one commit and no recent activity, so an empty 30-day first-sync window is the
honest result.

**0 tickets is not.** The owner also confirms tasks are sitting in To Do on the
board, and a ticket with no activity is still a ticket — nothing in the sync
filters on activity. The account has a `Sprint 24` row in state `ACTIVE`, so
`getActiveSprintRow` had something to hand `searchSprintIssues`. The question to
settle is therefore narrow: **are those To Do tasks actually assigned to that
sprint, or only sitting in the backlog?**

- Backlog only → 0 tickets is correct, and 1.8's `committed_sp = 0` is a true
  reading. Move a task into the sprint and re-sync to make the row meaningful.
- In the sprint → something upstream matches nothing. Likely suspects, in order:
  `sprint.jiraSprintId` not matching the board's real sprint id (it is imported
  once at setup), or the JQL in `searchSprintIssues` disagreeing with how that
  project scopes a sprint.

Settle this before row 1.8 — that row asks `committed_sp` to match a manual Jira
count, and 0/0 is *consistent with itself* while proving nothing either way.

### Notes that change what "pass" looks like

- **A successful reconnect does not clear a stale `sync_state`.** After
  reconnecting, the card keeps showing the previous failure until a sync runs.
  Known defect, listed under Follow-ups below — do not log it twice.
- **NULL churn must render `—`, never `0`.** The seeded account has exactly two
  such commits; that is the case row 4.7 is checking.
- **A day with zero commits renders blank, not `—`.** The two are different
  states and the distinction is deliberate.
- Rows 1.7 and 7.7 are the security spot-checks: watch the **network tab**, not
  just the DB, for a token or a raw error string in any response.

## Follow-ups not yet planned

Recorded here so they survive a context reset. None block the PR.

1. **Stale sync status after a successful reconnect.** `storeGithubIntegration` /
   `storeJiraIntegration` replace the credential but leave `sync_state.status`
   and `last_error` describing the *old* one. The owner reconnects, is told it
   worked, lands on a card that still says "Failing". Fix: clear both for that
   integration on a successful store. Observed live on 2026-08-22.
2. **`lessons.md` candidate.** `TokenCryptoError` was handled at 1 of 4 call
   sites, and the unhandled ones turned a recoverable credential problem into a
   500 that also took down the other integration. Rule worth registering: a typed
   error thrown by a shared helper must be handled at **every** call site, or the
   helper should not throw it. Run `/10x-lesson` to add it.
3. **Workers subrequest budget.** The per-commit stat cap is per *repo*, so a
   cycle costs ~30 × N extra subrequests (~460 at 5 repos, up from ~310). Verify
   against the limit on the deployment plan before the first deploy; the fix, if
   needed, is a shared budget decremented across repos, not a smaller cap.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data prerequisites — commit churn + Jira time zone

#### Automated

- [x] 1.1 Migration generates and applies cleanly — b420ea5
- [x] 1.2 Unit tests pass (getCommitDetail paths) — b420ea5
- [x] 1.3 Integration tests pass (time zone write, churn write, dedup skip, over-cap NULL, sprint SP scalars incl. empty-delta cycle) — b420ea5
- [x] 1.4 Type checking passes — b420ea5
- [x] 1.5 Linting passes — b420ea5

#### Manual

- [x] 1.6 Real sync populates `jira_project.time_zone` — verified in-session (real Jira sync on demo@sprintflow.test wrote tz=Europe/Warsaw)
- [ ] 1.7 No token or raw error text in Worker logs
- [ ] 1.8 Real sync populates `sprint.committed_sp`/`completed_sp` matching a manual Jira count

### Phase 2: The three reducers (M1 / M2 / M3)

#### Automated

- [x] 2.1 Unit tests pass (day bucketing, time-in-status, burndown, activity grid) — 9e73c40
- [x] 2.2 Integration tests pass (three readers + cross-account isolation) — 9e73c40
- [x] 2.3 Type checking passes — 9e73c40
- [x] 2.4 Linting passes — 9e73c40

#### Manual

- [ ] 2.5 Burndown day-0 remaining SP equals Σ sprint-ticket SP (and `committedSp` absent scope creep)
- [ ] 2.6 Sub-burndown series sum to the total series

### Phase 3: shadcn primitives + chart foundation

#### Automated

- [x] 3.1 Production build passes — 88b0d30
- [x] 3.2 Workers build passes — 88b0d30
- [x] 3.3 Type checking passes — 88b0d30
- [x] 3.4 Linting passes — 88b0d30

#### Manual

- [ ] 3.5 Chart renders legibly in light and dark theme
- [x] 3.6 No Node-API warning attributable to recharts in `build:cf` — verified in-session (clean build:cf output)

### Phase 4: Sprint Detail route (surfaces A, B, C)

#### Automated

- [x] 4.1 Unit tests pass (aging controls, matrix view) — 7d79be6
- [x] 4.2 Type checking passes — 7d79be6
- [x] 4.3 Linting passes — 7d79be6
- [x] 4.4 Production build passes — 7d79be6

#### Manual

- [ ] 4.5 All three surfaces render on seeded data
- [ ] 4.6 Aging report default sort and per-column sorting work
- [ ] 4.7 Matrix switcher works; null churn shows `—`
- [ ] 4.8 Sub-burndown legible in both themes; `UNKNOWN` distinguishable
- [ ] 4.9 Usable at 10-inch tablet width; no page-body horizontal scroll
- [ ] 4.10 Freshness + error banner present, no raw error text
- [ ] 4.11 No-sprint owner gets the empty state, not an error page

### Phase 5: Today retrofit (surfaces D, E, F)

#### Automated

- [x] 5.1 Unit tests pass (inbox-controls unchanged and green) — 2ebc983
- [x] 5.2 Integration tests pass — 2ebc983
- [x] 5.3 Type checking passes — 2ebc983
- [x] 5.4 Linting passes — 2ebc983
- [x] 5.5 Production build and Workers build pass — 2ebc983

#### Manual

- [ ] 5.6 Today opens on the Inbox; sorting/filtering unregressed
- [ ] 5.7 All four tabs render; freshness bar persists across tabs
- [ ] 5.8 Yesterday's Activity matches the fixture for the correct zone-local day
- [ ] 5.9 Reliability KPI empty state on null `committedSp`
- [ ] 5.10 Today page render latency acceptable on the `max:1` pool

### Phase 6: E2E coverage + slice closeout

#### Automated

- [x] 6.1 E2E suite passes — 4366af9
- [x] 6.2 Full unit suite passes — 4366af9
- [x] 6.3 Full integration suite passes — 4366af9
- [x] 6.4 Type checking passes — 4366af9
- [x] 6.5 Linting passes — 4366af9

### Phase 7: Connections — data, history, and actions

#### Automated

- [x] 7.1 Migration generates and applies cleanly (`sync_attempt`) — f74f336
- [x] 7.2 Unit tests pass (classifyFailure; no branch emits stored error text) — f74f336
- [x] 7.3 Integration tests pass (attempt write + prune cap, overview shape + isolation, selection edits replace not duplicate) — f74f336
- [x] 7.4 Type checking passes — f74f336
- [x] 7.5 Linting passes — f74f336

#### Manual

- [ ] 7.6 A forced sync writes exactly one attempt row per integration
- [ ] 7.7 No token and no raw error text in any new action's network payload

### Phase 8: `/settings` shell + Connections tab

#### Automated

- [x] 8.1 Unit tests pass — 2522397
- [x] 8.2 Type checking passes — 2522397
- [x] 8.3 Linting passes — 2522397
- [x] 8.4 Production build and Workers build pass — 2522397
- [x] 8.5 E2E passes (nav → /settings shows both integrations) — 2522397

#### Manual

- [x] 8.6 `/settings` reachable from the nav on every page — verified manually 2026-08-22
- [x] 8.7 Broken token shows the classified reason; Test connection reports the live failure — verified manually 2026-08-22
- [x] 8.8 Sync now runs and timestamps advance — verified manually 2026-08-22
- [x] 8.9 Monitored repos change without re-entering the token — verified manually 2026-08-22
- [x] 8.10 Jira project change warns about discarded sprint data first — verified manually 2026-08-22
- [x] 8.11 Not-connected state links into the wizard — verified manually 2026-08-22
- [ ] 8.12 Usable at 10-inch tablet width; legible in dark mode

### Phase 9: Split the wizard from single-integration connect

#### Automated

- [x] 9.1 Unit tests pass — f3c4977
- [x] 9.2 Type checking passes — f3c4977
- [x] 9.3 Linting passes — f3c4977
- [x] 9.4 Production build and Workers build pass — f3c4977
- [x] 9.5 E2E passes (Settings connect has no stepper; wizard still does) — f3c4977

#### Manual

- [x] 9.6 Settings → Connect/Reconnect GitHub is a single form, no stepper — verified manually 2026-08-22
- [x] 9.7 Successful connect lands back on `/settings/connections` — verified manually 2026-08-22
- [x] 9.8 Same for Jira, including the project + mapping stages — verified manually 2026-08-22
- [x] 9.9 The wizard at `/setup/*` is unchanged (stepper + Continue CTA present) — verified manually 2026-08-22
- [x] 9.10 Reconnect replaces an existing credential without disconnecting first — verified manually 2026-08-22

### Phase 10: An undecryptable credential must not crash the sync

#### Automated

- [x] 10.1 Unit tests pass — d970e93
- [x] 10.2 Integration tests pass (one integration ERRORs, the other still completes; testConnection reports `credential_unreadable`) — d970e93
- [x] 10.3 Type checking passes — d970e93
- [x] 10.4 Linting passes — d970e93
- [x] 10.5 Production build and Workers build pass — d970e93

#### Manual

- [x] 10.6 "Sync now" returns a result instead of a 500 on the seeded account — verified manually 2026-08-22
- [x] 10.7 The failing integration shows a reason; the healthy one is unaffected — verified manually 2026-08-22
- [x] 10.8 Re-running the seed produces a decryptable (still fake) credential — verified in-session (seed re-run wrote v1: envelopes)

#### Manual

- [ ] 6.6 Seed reset then re-run produces a coherent story across both dashboards
- [ ] 6.7 `/10x-impl-review` run with findings triaged
- [x] 6.8 Roadmap updated, including the corrected S-07 row — verified in-session (roadmap corrected in 4366af9)
