---
date: 2026-08-21T23:55:41+0200
researcher: Adam Reszka
git_commit: ed804887364a39eb5b5b42038ef974e18596dcce
branch: main
repository: AdamReszka/10xdevs-certification-project
topic: "S-10 Dashboard Sprint Detail — implementation-grade codebase research"
tags: [research, codebase, dashboard-sprint-detail, s-10, readers, burndown, activity-matrix, aging-report, recharts, sync]
status: complete
last_updated: 2026-08-22
last_updated_by: Adam Reszka
last_updated_note: "Resolved open questions Q1–Q4 with user decisions; flagged Jira-timezone sync prerequisite (Q2)"
---

# Research: S-10 Dashboard "Sprint Detail"

**Date**: 2026-08-21T23:55:41+0200
**Researcher**: Adam Reszka
**Git Commit**: `ed80488` (permalink base: `https://github.com/AdamReszka/10xdevs-certification-project/blob/ed80488/`)
**Branch**: main
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

Map the codebase at implementation grade to feed `/10x-plan` for S-10 "Dashboard Sprint Detail" — the 5 read surfaces (Workflow aging report, Team Activity Matrix, per-technology sub-burndowns, plus S-07's deferred Sprint Pulse burndown and Yesterday's Activity), which collapse to 3 shared reducers (M1 SP-over-time, M2 per-dev-per-day GitHub rollup, M3 time-in-status). Confirm the frame's claims and resolve the two decisions taken at research start: **charts via shadcn `chart`/Recharts**, and **add per-commit stat fetching to the sync**.

## Summary

The one-slice framing holds. The 5 surfaces reduce to **3 new owner-scoped readers** that fit the existing `(db, ownerId, …) → serializable` convention exactly. Findings by decision and by risk:

- **Charts (decided: shadcn `chart` + Recharts).** `npx shadcn add chart` pulls `recharts@3.8.0` (React 19 compatible). Recharts is client-only → each chart is a `"use client"` leaf that receives plain serialized data from the server page; server components never import Recharts. OKLCH chart tokens `--chart-1..5` **already exist** in `globals.css` (both themes, class-based dark) — theming is free. `radix-ui` is already installed, so `shadcn add tabs`/`chart` add no new Radix dep.
- **Per-commit line metric (decided: extend sync).** **No schema migration needed** — `githubCommit.additions`/`deletions` columns already exist (`schema.ts:437-438`); the sync just never writes them. Add a `getCommitDetail` GET modeled on the existing `getPullRequestDetail`, +1 subrequest per commit. Budget ceiling is **10,000/invocation** (paid Standard plan), not 1,000. Mitigate first-sync bursts with dedup-aware skip (commit already dedups on `UNIQUE(repoId, sha)`) + a per-cycle cap mirroring `DEFAULT_MAX_PRS_PER_SYNC`.
- **Backfill risk: RETIRED.** `jiraStatusHistory` already stores full from/to category transitions with `changedAt`, indexed on `(ticketId, changedAt)`, deduped on NOT-NULL `jiraChangelogId`. M3 aging + M1 burndown derive cleanly from it. No backfill.
- **Tabs / KPI: net-new (frame confirmed).** S-07 shipped the Anomaly Inbox core only — **no tabs primitive, no Reliability KPI** (grep: zero `reliability`/`committedSp`/`completedSp` refs in `src/components`/`src/app`). Recommendation: build Sprint Detail as a **new route** `(app)/dashboard/sprint-detail/page.tsx`, add a nav item, and use shadcn `tabs` *inside* the page to host sub-surfaces.
- **New soft gap (not in frame): sub-burndown grouping key.** SP has no technology column; SP-per-track is only derivable via an **assignee approximation** through three nullable, un-enforced value joins (`jiraTicket.assigneeJiraAccountId → teamMember.jiraAccountId → teamMember.technologyTrack`). The plan must decide the "unattributed SP" fallback bucket.

## Detailed Findings

### 1. Read-side reader convention (the shape M1/M2/M3 must match)

Every reader under `src/lib/` is identical in shape:

- Module-local `type Db = ReturnType<typeof getDb>` (`sprint.ts:17`, `roster.ts:16`, `anomaly/reader.ts:18`, `anomaly/load-snapshot.ts:23`, `sync-state.ts:13`).
- Signature `(db, ownerId, ...rest)` — db first, ownerId second:
  - `getActiveSprintRow(db, ownerId): Promise<SelectSprint | null>` — `sprint.ts:19-22`
  - `listRoster(db, ownerId): Promise<RosterMember[]>` — `roster.ts:28-31`
  - `listAnomaliesForSprint(db, ownerId, sprintId)` — `anomaly/reader.ts:37-41`
  - `loadSprintSnapshot(db, ownerId, now)` — `anomaly/load-snapshot.ts:29-33`
  - `getSyncState(db, ownerId)` — `sync-state.ts:30-33`
- **Owner-scoping = explicit `eq(<table>.ownerId, ownerId)` on EVERY table touched** — never inherited through a join. `load-snapshot.ts:42-59` filters 5 tables each independently. Every product table carries its own `ownerId text NOT NULL → user.id` FK (`schema.ts:186-192`). For M3's `jiraStatusHistory ⋈ jiraTicket`, scope **both** by ownerId (or scope via the owner-scoped `jiraTicket` join — see index note in §2).
- Readers export their result type beside the function (`RosterMember` `roster.ts:18-26`; `AnomalyView` `reader.ts:20-35`). New reducers do the same.
- `now: Date` is passed in, not read inside (mirrors `loadSprintSnapshot(...now)` `load-snapshot.ts:33`; detectors take `now` too, `ticket-status-aging.ts:43`) — keeps reducers deterministic/testable.

**ownerId flow** (the page call-site to clone — `dashboard/page.tsx`): `requireSession()` (`:26`) → `getCloudflareContext().env` → `getDb(env)` (`:27-28`) → `ownerId = session.user.id` (`:29`) → resolve sprint once (`getActiveSprintRow`, `:31`) → fan out readers on **one shared `db`** via `Promise.all` (`:32-36`) → map DB rows to plain serializable props (ISO strings, `Map` for name lookup) before passing to the client organism (`:43-81`).

**Pool discipline** (lessons.md #3): use the request-scoped `getDb` handle, **never `getDbWithPool`** (that owns teardown; sync/cron only — `db.ts:11-19`, page comment `page.tsx:20-23`). All reducers share the one handle in a single `Promise.all`. The pool is `max:1` so queries serialize — do **not** open a second pool per reducer (multiplies the known, out-of-scope leak). No DB transaction needed; these are independent read-only selects.

### 2. Schema + data readiness (per reducer)

Enums: `technologyTrack = FRONTEND|BACKEND|MOBILE|QA` (`schema.ts:47-52`); `statusCategory = TODO|IN_PROGRESS|CODE_REVIEW|TESTING|DONE` (`schema.ts:23-29`).

**M3 — time-in-status / aging report — FULLY READY.**
- `jiraStatusHistory` (`schema.ts:551-580`): `ticketId → jiraTicket.id`, `fromCategory`, `toCategory` (both nullable `statusCategory`), `changedAt`, `jiraChangelogId` **NOT NULL** (`:568`), `UNIQUE(ticketId, jiraChangelogId)` (`:571-574`), `index(ticketId, changedAt)` (`:575-578`).
- This reader **introduces the first `jiraStatusHistory` read in the codebase** — `load-snapshot.ts` deliberately omits it (`types.ts:19-22`: "deliberately absent … it is S-10's aging-report input"). Today the aging detector uses only `ticket.lastStatusChangeAt` (the current open interval, `ticket-status-aging.ts:54,64`), which has no per-status cumulative totals.
- **Algorithm**: per ticket, order history by `changedAt`; each `(changedAt[i], changedAt[i+1])` interval accrues to `toCategory[i]`; the final open interval runs from the last `changedAt` (or `lastStatusChangeAt`) to `now`, accruing to `currentCategory`. Output = per-category cumulative ms + total-time-since-last-move (FR-017).
- **Index note**: `jiraStatusHistory` has **no ownerId index** — scan via the `ticketId` join from owner-scoped `jiraTicket` (which has `index(sprintId)` `:546`) rather than filtering history by ownerId directly.

**M1 — SP-over-time (burndown + sub-burndowns) — READY, with a grouping-key gap.**
- `sprint` holds only scalar snapshots `committedSp`/`completedSp` (`:334-335`) — **no daily series**. A daily burndown MUST be derived from `jiraStatusHistory.changedAt` (time axis) × transition into `toCategory = DONE` × `jiraTicket.storyPoints` (`:531`), bounded by `sprint.startDate`/`endDate` (`:331-333`), baseline `committedSp`.
- **Sub-burndown grouping key = SOFT GAP.** No technology column on `jiraTicket`. SP-per-track only via `jiraTicket.assigneeJiraAccountId (:534)` → `teamMember.jiraAccountId (:303)` → `teamMember.technologyTrack (:306)` — a **value join, not a declared FK**, nullable at all three hops, and `teamMember.jiraAccountId` has no unique constraint (join not guaranteed 1:1). Same key `ticket-status-aging.ts:46,82-83` already uses. **Plan must decide the unattributed-SP fallback bucket.**

**M2 — per-dev-per-day GitHub rollup (Activity Matrix + Yesterday's Activity) — READY after the sync extension.**
- ONE reader with a date range serves both (matrix = sprint range; yesterday = 1-day range).
- Sources: `githubCommit` (`authorGithubUsername :435`, `authoredAt :436`, `additions :437`, `deletions :438`; `index(ownerId, authoredAt) :445`, `index(authorGithubUsername) :449`), `githubPullRequest` (`authorGithubUsername :466`, `openedAt :471`, `mergedAt :472`, `additions/deletions :468-469`), `githubReview` (`reviewerGithubUsername :500`, `submittedAt :502`; `index(ownerId, submittedAt) :507`).
- **Attribution join = value join on GitHub login**, both sides nullable: `github*.authorGithubUsername → teamMember.githubUsername (:302)`. No FK, no unique constraint → unmapped authors are unattributable. Commit author has a supporting index (`:449`); **PR rollup has no `openedAt`/`mergedAt` or author index** (`:485` is on `state`, `:486` on `linkedTicketKey`) → per-day PR aggregation scans the owner's PRs.
- **`additions`/`deletions` on commits are NULL today** — columns exist (`:437-438`) but sync never writes them → closed by the sync extension (§4).

### 3. UI / route / charting

- **Page/layout reuse**: `(app)/layout.tsx:9` declares `force-dynamic` + `requireSession()` + `<AppShell>` ONCE — the new route inherits both, must **not** re-declare. Clone the `dashboard/page.tsx:26-36` boot+`Promise.all` and the `:87-101` `max-w-6xl` header shell.
- **Freshness + error banner is a standalone server component** — `SyncStatusBar` (`src/components/organisms/dashboard/sync-status-bar.tsx:43-81`): per-integration timestamps (`:53-62`, deterministic UTC via `formatSyncedAt`), destructive `<Alert>` per errored integration (`:64-79`) with **friendly copy only** (`STATUS_MESSAGE :28-31`; raw `lastError` never forwarded — page drops it at `page.tsx:67-68`). Import it directly at the top of Sprint Detail.
- **Client/server boundary template**: server fetches + serializes → ONE `"use client"` organism owns all `useState`/`useMemo` interactivity (`anomaly-inbox.tsx:1,64-77`) → **pure sort/aggregate logic in a colocated non-React `.ts` + `.test.ts`** (`inbox-controls.ts` + `inbox-controls.test.ts`). S-10's matrix sort / burndown hover follow this; the Recharts wrapper is the `"use client"` leaf.
- **Tabs gap CONFIRMED**: no `src/components/ui/tabs.tsx`, zero tab usage (grep hits only `<table>`). `radix-ui@1.4.3` installed → `shadcn add tabs` adds no new Radix dep.
- **Route recommendation**: new sibling route **`src/app/(app)/dashboard/sprint-detail/page.tsx`** (PRD treats Today/Sprint Detail as two dashboards, FR-016 vs FR-017; US-02 "clicks through"). Add nav item to `main-nav.tsx:7-10` (currently a flat static `NAV_ITEMS`, no `usePathname`/active styling). Use shadcn `tabs` *inside* the page to host the sub-surfaces.
- **shadcn `chart`**: `registry:ui`, 1 file (`src/components/ui/chart.tsx`), deps `recharts@3.8.0` + `lucide-react`. Exports `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartLegend`/`ChartLegendContent`/`ChartConfig`. `ChartConfig` maps series key → `{label, color}` exposed to Recharts as `var(--color-<key>)`.
- **Recharts on Workers**: client-only (`ResponsiveContainer` measures the DOM) → server page passes plain data to a `"use client"` chart leaf; the SSR pass renders the shell (measures 0 until mount — acceptable). No Node APIs (browser-safe). Concern = **bundle size** (recharts + d3): keep each chart a distinct `"use client"` leaf for per-route chunking; import specific primitives (`LineChart`, `AreaChart`, `Bar`). No special OpenNext config beyond existing `build:cf`.
- **Theming already wired**: `--color-chart-1..5` in `@theme inline` (`globals.css:25-29`); `--chart-1..5` OKLCH for light (`:67-71`) + `.dark` (`:101-105`); class-based dark (`@custom-variant dark`, `:4`, next-themes). Set `color: "var(--chart-1)"` in `chartConfig`. `components.json` new-york/rsc:true/css→globals.css → `shadcn add chart` drops in cleanly. Never re-run `init` (memory `project_shadcn_setup`); `add` only.

### 4. Per-commit stat sync extension (decided in-scope)

- **Current fetch**: `listCommits` (`github.ts:417-483`) = `GET /repos/{o}/{r}/commits?per_page=100&since={ISO}` (`:429`), cursor `since = lease.lastSuccessfulSyncAt` (or `now-30d` first sync, `run-sync.ts:264-266`); parses only `sha/authoredAt/message/authorGithubUsername` (`:463-471`). Stats deliberately dropped (`github.ts:347-351`: list endpoint carries no per-commit `stats`; per-commit GET "multiplies subrequests").
- **API needed**: `GET /repos/{o}/{r}/commits/{sha}` returns `stats.additions`/`stats.deletions`. **Exact analog of `getPullRequestDetail`** (`github.ts:590-625`, which already exists because the PR list omits size). **+1 subrequest per commit.**
- **Budget**: ceiling is **10,000 subrequests/invocation** (paid Standard — `infrastructure.md:57,75,107`), not the 1,000 free-tier figure. Extra cost = **N** commits in the window. Small per 15-min incremental cycle; **risk on first-sync 30-day lookback / bursts** (commits currently have no per-cycle cap; PRs cap at `DEFAULT_MAX_PRS_PER_SYNC = 30`, `run-sync.ts:90`).
- **Mitigations**: (1) dedup-aware — commit already dedups on `UNIQUE(repoId, sha)` + `.onConflictDoNothing` (`run-sync.ts:302`); fetch stats **only for commits not already persisted**. (2) Per-cycle cap `DEFAULT_MAX_COMMIT_STATS_PER_SYNC` mirroring the PR cap, newest-first. (3) Enrich **outside** `db.transaction` (F1 rule, all network reads before txn — `run-sync.ts:270,279-283`).
- **Touch-points**: extend `GithubCommitData` (`github.ts:352-357`) with `additions/deletions`; add `getCommitDetail` (single-resource GET, so the pagination-cap/origin-check lesson does NOT apply — same as `getPullRequestDetail`); enrich after `listCommits` (`run-sync.ts:271`); add the two fields to the commit insert `.values(...)` (`run-sync.ts:291-299`); keep `.onConflictDoNothing`. **No migration.**

## Code References

- `src/lib/sprint.ts:19-38` — `getActiveSprintRow` (active-sprint resolver; may return CLOSED/most-recently-started — see F4)
- `src/lib/roster.ts:18-46` — `listRoster` / `RosterMember` (carries `technologyTrack`, `githubUsername`, `jiraAccountId`, `isActive`)
- `src/lib/sync-state.ts:30-69` — `getSyncState` / `SyncStateByIntegration`
- `src/lib/anomaly/load-snapshot.ts:29-80` — snapshot loader; `:42-59` the 5-table `Promise.all` that omits `jiraStatusHistory`
- `src/lib/anomaly/types.ts:19-22` — note earmarking `jiraStatusHistory` as S-10's input
- `src/lib/db.ts:11-28` — `getDb` vs `getDbWithPool`
- `src/db/schema.ts:551-580` (jiraStatusHistory), `:516-549` (jiraTicket), `:424-451` (githubCommit — `:437-438` additions/deletions), `:453-488` (githubPullRequest), `:490-512` (githubReview), `:294-316` (teamMember), `:318-347` (sprint)
- `src/lib/github.ts:417-483` (listCommits), `:347-357` (dropped-stats comment + `GithubCommitData`), `:590-625` (`getPullRequestDetail` — the pattern to clone)
- `src/lib/integrations/sync/run-sync.ts:264-302` (commit fetch cursor + insert), `:78-90` (lookback + PR cap), `:493-513` (status-history writes)
- `src/app/(app)/dashboard/page.tsx:26-36,87-101` — boot + fan-out + shell (clone target)
- `src/app/(app)/layout.tsx:9,22` — `force-dynamic` + `requireSession` + `AppShell` (inherited)
- `src/components/organisms/dashboard/sync-status-bar.tsx:28-81` — reusable freshness/error server component
- `src/components/organisms/anomaly/anomaly-inbox.tsx:1,64-77` + `inbox-controls.ts` (+`.test.ts`) — client-boundary + pure-logic template
- `src/components/molecules/main-nav.tsx:7-10` — nav to extend; `src/components/templates/app-shell.tsx:22-40` — shell
- `src/app/globals.css:4,25-29,67-71,101-105` — chart OKLCH tokens + class-based dark
- `components.json` — new-york/rsc/css-vars (shadcn add ready)
- `src/lib/dashboard-readers.integration.test.ts:20-41` — real-Postgres reader test convention (seed-per-owner + cross-account-isolation assertions) to mirror for M1/M2/M3

## Architecture Insights

- **Reducers, not queries.** The 5 surfaces genuinely collapse to 3 owner-scoped readers; two are shared across surface-pairs (M1→sub-burndowns+Sprint Pulse; M2→Activity Matrix+Yesterday's Activity). Splitting by dashboard would build each reducer twice — the cohesion argument for one slice holds.
- **Serialize at the RSC boundary, isolate interactivity + pure logic.** Every interactive surface = server fetch/serialize → one `"use client"` organism → pure `.ts` (+`.test.ts`). Recharts is a `"use client"` leaf only.
- **App-enforced isolation, per-table ownerId, request-scoped `max:1` pool.** New readers must scope every table by ownerId and share the one `getDb` handle.
- **Value joins for cross-system correlation are inherently lossy** (SP→track, github-author→member): nullable, un-enforced, best-effort. Plan for the unattributed bucket rather than assuming a clean join.

## Historical Context (from prior changes)

- `context/archive/2026-08-21-dashboard-today/plan.md:37-40,296` — S-07 explicitly deferred Sprint Pulse burndown, Yesterday's Activity, Reliability KPI, and the tabbed FR-016 shell; "Do not record S-07 as fully closing US-01 — only its inbox core." These are S-10's to deliver.
- `context/archive/2026-08-21-dashboard-today/reviews/impl-review.md` — **F1 (fixed)**: `listRoster` returns ALL members + `isActive` so deactivated members still resolve a display name; S-10 must resolve names from the full set, build filter dropdowns from the `isActive` subset. **F2 (fixed)**: raw `lastError` removed from client payload; S-10 must not reintroduce raw sync-error text into any client payload. **F4 (skipped)**: `getActiveSprintRow` may return a CLOSED sprint for a between-sprints owner — check `sprint.state === "ACTIVE"` explicitly if Sprint Detail needs the distinction.
- `context/changes/dashboard-sprint-detail/frame.md` — one-slice framing (3 reducers M1/M2/M3), backfill risk retired, three scope corrections (tabs net-new, commit-line-count gap, `loadSprintSnapshot` must gain `jiraStatusHistory`). This research confirms all three and adds the sub-burndown grouping-key gap.
- `context/foundation/lessons.md` — #1 NOT-NULL dedup key (satisfied by `jiraChangelogId`); #3 request-scoped pool teardown (use `getDb`, never a second pool); #4 pagination cap/origin-check (does NOT apply to the single-SHA `getCommitDetail`).

## Related Research

- `context/archive/2026-08-21-dashboard-today/research.md` — S-07 read-side foundation this slice extends.

## Open Questions

_Q1–Q4 resolved 2026-08-22 (user decisions). Q5 deferred to plan as a note._

1. **Unattributed SP fallback for sub-burndowns** — **RESOLVED: "UNKNOWN" bucket.** M1's sub-burndown emits an explicit `UNKNOWN` track series for SP whose assignee is unmapped or whose `technologyTrack` is null, so Σ(sub-burndowns) = total burndown and the lossy value-join is visible rather than silently dropped. `getBurndownSeries` returns tracks keyed `FRONTEND|BACKEND|MOBILE|QA|UNKNOWN`.
2. **Day-boundary timezone for M2** — **RESOLVED: Jira sprint timezone** (not UTC). ⚠️ **Hidden prerequisite — the plan must size this.** The sync does NOT capture a timezone today, and `sprint.startDate`/`endDate` are stored as bare `timestamp` (`schema.ts:331-333`) — the Jira offset is likely dropped on write. So this decision adds a **second sync/data task** alongside the per-commit extension (Q3). Concrete path for the plan to choose from: (a) fetch the Jira account/instance timezone (e.g. Jira `/myself` → `timeZone`, an IANA string like `Europe/Warsaw`) once per sync and persist it (new nullable column on `sprint` or `jiraProject`); OR (b) preserve the UTC offset already embedded in the Jira sprint start/end ISO strings by storing them as `timestamptz` / capturing the offset. Then M2 buckets `authoredAt`/`openedAt`/`submittedAt` by calendar day in that zone. **Fallback if the source proves unavailable in-scope: UTC**, noted so S-10 is not blocked. Owner: plan.
3. **`getCommitDetail` per-cycle cap + backfill** — **RESOLVED: cap 30, forward-only.** `DEFAULT_MAX_COMMIT_STATS_PER_SYNC = 30` (mirrors `DEFAULT_MAX_PRS_PER_SYNC`), newest-first, dedup-aware skip of SHAs already persisted. Already-stored commits keep `additions/deletions = NULL` (no one-off backfill). Consequence for M2: the Activity Matrix's per-commit line metric is populated **going forward only** — pre-existing commits show null churn until re-touched; UI must render null churn gracefully.
4. **Between-sprints Sprint Detail** — **RESOLVED: render on the last sprint (F4 behavior).** Sprint Detail renders aging/burndown against whatever `getActiveSprintRow` returns (possibly a CLOSED/most-recently-started sprint), consistent with Dashboard Today and the detection pipeline — no separate "no active sprint" gate. Note for the plan: a burndown drawn on a CLOSED sprint can read oddly; consider a subtle "sprint closed" label without changing the data path.
5. **Per-tech sub-burndown vs Activity Matrix on a `max:1` pool** — **DEFERRED to plan (note, not a fork).** The combined reducer query count serializes over the single request-scoped `max:1` pool. Plan should confirm acceptable render latency for a realistic sprint (≤10 devs, one sprint of tickets/commits/PRs) and, only if needed, pre-aggregate M2/M3 rather than opening a second pool. Owner: plan.
