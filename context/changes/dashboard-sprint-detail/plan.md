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

Two data-side prerequisites land first, because without them two UI columns would be empty or wrong: per-commit `additions`/`deletions` (never written by the sync today) and the owner's Jira IANA time zone (fetched today, never persisted).

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

**What's missing:** all three reducers, the Sprint Detail route, the tabs primitive, the chart primitive, the two data-side writes above.

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
- **No "no active sprint" gate on Sprint Detail** — it renders against whatever `getActiveSprintRow` returns, matching Today and the detection pipeline (research Q4). A CLOSED sprint gets a label, not a different data path.
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

**Contract**: Add `const DEFAULT_MAX_COMMIT_STATS_PER_SYNC = 30;` beside `DEFAULT_MAX_PRS_PER_SYNC` (`:90`), with a comment recording the one-way cursor consequence. After `listCommits` and **before** the transaction: select the already-persisted SHAs for this repo from `githubCommit`, drop them from the candidate set, sort the remainder by `authoredAt` descending, take the first 30, and `getCommitDetail` each. Add `additions`/`deletions` to the commit insert `.values(...)` (`:291-299`); keep `.onConflictDoNothing`. Commits beyond the cap are still inserted — with NULL churn.

### Success Criteria

#### Automated Verification

- Migration generates and applies cleanly: `npm run db:generate && npm run db:migrate`
- Unit tests pass: `npm run test` — covers `getCommitDetail` success / 401 / non-OK / unparseable-body paths in `src/lib/github.test.ts`
- Integration tests pass: `npm run test:integration` — `run-sync.integration.test.ts` asserts (a) `jira_project.time_zone` is written from the `/myself` fixture, (b) new commits land with `additions`/`deletions`, (c) an already-persisted SHA triggers no detail fetch, (d) commit 31+ in one cycle is inserted with NULL churn
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- A real sync cycle against the dev Jira project populates `jira_project.time_zone` with a plausible IANA string
- Worker logs show no token value and no raw error text (PRD guardrail)

---

## Phase 2: The three reducers (M1 / M2 / M3)

### Overview

Three owner-scoped readers in a new `src/lib/dashboard/` folder, each paired with a pure fold module that carries the actual time math and is unit-testable without a database.

### Changes Required

#### 1. Day bucketing

**File**: `src/lib/dashboard/day-bucket.ts` (+ `.test.ts`)

**Intent**: Convert an instant to a calendar-day key in the team's zone, so a 22:30 Warsaw commit counts as that day rather than the next UTC one.

**Contract**: `dayKeyInTimeZone(date: Date, timeZone?: string): string` → `YYYY-MM-DD`, and `enumerateDayKeys(start: Date, end: Date, timeZone?: string): string[]` → the inclusive ordered day axis. Use `Intl.DateTimeFormat` with `en-CA` (which formats as `YYYY-MM-DD` directly) and mirror the invalid/absent-zone → UTC fallback of `weekdayInTimeZone` (`cadence.ts:50-58`) — fall back, never throw.

#### 2. M3 — time in status (aging report)

**File**: `src/lib/dashboard/time-in-status.ts` (+ `.test.ts`)

**Intent**: Fold one ticket's ordered transitions into cumulative time per category.

**Contract**: `foldTimeInStatus(transitions, { currentCategory, lastStatusChangeAt, now }) → { byCategory: Record<StatusCategory, number>, sinceLastMoveMs: number }`, all values in ms. Each `(changedAt[i], changedAt[i+1])` interval accrues to `toCategory[i]`; the final open interval runs from the last `changedAt` (or `lastStatusChangeAt` when history is empty) to `now` and accrues to `currentCategory`. Every one of the five categories is present in the output, zero-valued when never entered. Pure — `now` is a parameter.

**File**: `src/lib/dashboard/aging.ts`

**Intent**: Load the sprint's tickets plus their transitions and fold each one.

**Contract**: `getTicketAging(db, ownerId, sprintId, now) → Promise<TicketAging[]>`, exporting `TicketAging` beside it: `{ ticketId, jiraKey, summary, storyPoints, currentCategory, assigneeJiraAccountId, sinceLastMoveMs, byCategory }`. Two queries, both explicitly owner-scoped: tickets for the sprint, then their transitions joined via `jiraTicket` (also filtered on `jiraStatusHistory.ownerId` for the isolation guarantee) ordered by `(ticketId, changedAt)`. **Tickets whose `currentCategory` is `DONE` are excluded** — a finished ticket has stopped moving, so it would otherwise dominate a "time since last movement" sort with a meaningless age. Sorting is the client's job.

#### 3. M1 — SP over time (burndown + sub-burndowns)

**File**: `src/lib/dashboard/burndown-series.ts` (+ `.test.ts`)

**Intent**: Derive a daily remaining-SP series, overall and per technology track, from DONE transitions.

**Contract**: `buildBurndownSeries({ tickets, transitions, sprintStart, sprintEnd, timeZone, now }) → BurndownSeries` where `BurndownSeries = { days: string[]; committedSp: number; total: BurndownPoint[]; byTrack: Record<TrackKey, BurndownPoint[]> }` and `TrackKey = "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | "UNKNOWN"`. A ticket's SP is burned on the day of its **first** transition into `toCategory = DONE` (a later re-open then re-close must not double-burn). Days run from `sprintStart` to `min(sprintEnd, now)` via `enumerateDayKeys`. Per research Q1, SP whose assignee is unmapped or whose `technologyTrack` is null goes to `UNKNOWN`, so `Σ byTrack === total` at every point — the lossy join is visible rather than silently dropped. Tickets with null `storyPoints` contribute 0.

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

- Unit tests pass: `npm run test` — day bucketing across a DST boundary and an invalid zone; `foldTimeInStatus` with empty history, a single transition, and a re-open; burndown non-double-burn on re-open and `Σ byTrack === total`; grid null-churn vs summed-churn and the `UNKNOWN` row
- Integration tests pass: `npm run test:integration` — all three readers, each with a cross-account isolation assertion
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Against seeded data, the burndown's day-0 remaining SP equals the sprint's `committedSp`
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

**File**: `src/components/molecules/main-nav.tsx`

**Intent**: Make the new route reachable.

**Contract**: Add `{ label: "Sprint Detail", href: "/dashboard/sprint-detail" }` to `NAV_ITEMS`. Update the file's comment, which currently claims only Dashboard is live.

#### 2. Surface A — aging report

**File**: `src/components/organisms/dashboard/aging-report.tsx` (`"use client"`) + `aging-report-controls.ts` (+ `.test.ts`)

**Intent**: Sortable table of stalled tickets with cumulative time per category inline.

**Contract**: Columns: ticket key (deep-linked), summary, SP, current status, **time since last move** (the default sort, descending), then five numeric columns — To Do / In Progress / Code Review / Testing / Done — each formatted `2d 4h`. Every column sortable; sort state and duration formatting live in the pure `aging-report-controls.ts`, not in the component. The table sits in an `overflow-x-auto` container for the 10-inch tablet floor (NFR).

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

**Contract**: Renders `BurndownSeries.total` as a Recharts `AreaChart` leaf against an ideal straight line from `committedSp` to 0, beside a per-category ticket-count summary derived from the same reducer output. Scope-change context is out of scope here — `SCOPE_CREEP` is already an inbox anomaly.

#### 3. Surface E — Yesterday's Activity

**File**: `src/components/organisms/dashboard/yesterday-activity.tsx` (server component)

**Intent**: Per-developer commits / PRs opened / PRs merged / reviews for the previous calendar day.

**Contract**: No interactivity, so no client boundary: a plain table over a **single-day** `getActivityRollup` range. "Yesterday" is resolved in the team's zone via `dayKeyInTimeZone`, not UTC. Members with no activity render as zero rows rather than being omitted (US-01: "no zero rows for developers who were active" cuts both ways — absence must be visible).

#### 4. Surface F — Reliability KPI

**File**: `src/components/organisms/dashboard/reliability-kpi.tsx` (`"use client"`)

**Intent**: Committed SP vs delivered SP for the current sprint.

**Contract**: A two-bar Recharts `BarChart` leaf reading `sprint.committedSp`/`completedSp` directly — no reducer. When either is null, render an explanatory empty state instead of a zero bar. Single sprint only; the historical trend is S-12.

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

## Testing Strategy

### Unit Tests

- `dayKeyInTimeZone` across a DST transition, an invalid zone (falls back to UTC, never throws), and an absent zone
- `foldTimeInStatus`: empty history, single transition, re-open sequence, open final interval; all five categories always present
- `buildBurndownSeries`: no double-burn on re-open, `Σ byTrack === total` at every point, null-SP tickets contribute 0, day axis clamped to `min(sprintEnd, now)`
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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data prerequisites — commit churn + Jira time zone

#### Automated

- [ ] 1.1 Migration generates and applies cleanly
- [ ] 1.2 Unit tests pass (getCommitDetail paths)
- [ ] 1.3 Integration tests pass (time zone write, churn write, dedup skip, over-cap NULL)
- [ ] 1.4 Type checking passes
- [ ] 1.5 Linting passes

#### Manual

- [ ] 1.6 Real sync populates `jira_project.time_zone`
- [ ] 1.7 No token or raw error text in Worker logs

### Phase 2: The three reducers (M1 / M2 / M3)

#### Automated

- [ ] 2.1 Unit tests pass (day bucketing, time-in-status, burndown, activity grid)
- [ ] 2.2 Integration tests pass (three readers + cross-account isolation)
- [ ] 2.3 Type checking passes
- [ ] 2.4 Linting passes

#### Manual

- [ ] 2.5 Burndown day-0 remaining SP equals `committedSp`
- [ ] 2.6 Sub-burndown series sum to the total series

### Phase 3: shadcn primitives + chart foundation

#### Automated

- [ ] 3.1 Production build passes
- [ ] 3.2 Workers build passes
- [ ] 3.3 Type checking passes
- [ ] 3.4 Linting passes

#### Manual

- [ ] 3.5 Chart renders legibly in light and dark theme
- [ ] 3.6 No Node-API warning attributable to recharts in `build:cf`

### Phase 4: Sprint Detail route (surfaces A, B, C)

#### Automated

- [ ] 4.1 Unit tests pass (aging controls, matrix view)
- [ ] 4.2 Type checking passes
- [ ] 4.3 Linting passes
- [ ] 4.4 Production build passes

#### Manual

- [ ] 4.5 All three surfaces render on seeded data
- [ ] 4.6 Aging report default sort and per-column sorting work
- [ ] 4.7 Matrix switcher works; null churn shows `—`
- [ ] 4.8 Sub-burndown legible in both themes; `UNKNOWN` distinguishable
- [ ] 4.9 Usable at 10-inch tablet width; no page-body horizontal scroll
- [ ] 4.10 Freshness + error banner present, no raw error text

### Phase 5: Today retrofit (surfaces D, E, F)

#### Automated

- [ ] 5.1 Unit tests pass (inbox-controls unchanged and green)
- [ ] 5.2 Integration tests pass
- [ ] 5.3 Type checking passes
- [ ] 5.4 Linting passes
- [ ] 5.5 Production build and Workers build pass

#### Manual

- [ ] 5.6 Today opens on the Inbox; sorting/filtering unregressed
- [ ] 5.7 All four tabs render; freshness bar persists across tabs
- [ ] 5.8 Yesterday's Activity matches the fixture for the correct zone-local day
- [ ] 5.9 Reliability KPI empty state on null `committedSp`
- [ ] 5.10 Today page render latency acceptable on the `max:1` pool

### Phase 6: E2E coverage + slice closeout

#### Automated

- [ ] 6.1 E2E suite passes
- [ ] 6.2 Full unit suite passes
- [ ] 6.3 Full integration suite passes
- [ ] 6.4 Type checking passes
- [ ] 6.5 Linting passes

#### Manual

- [ ] 6.6 Seed reset then re-run produces a coherent story across both dashboards
- [ ] 6.7 `/10x-impl-review` run with findings triaged
- [ ] 6.8 Roadmap updated, including the corrected S-07 row
