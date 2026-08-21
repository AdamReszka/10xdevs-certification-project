---
date: 2026-08-21T18:28:39+0200
researcher: Adam Reszka
git_commit: a783098adcb44a67938ae4312b5df3ba839d95c1
branch: feat/s07-dashboard-today
repository: 10xdevs-certification-project
topic: "S-07 Dashboard Today — inbox-centric north-star core (render, sort/filter, freshness, error banner, active-sprint resolver, roster, smoke-test)"
tags: [research, codebase, dashboard-today, anomaly-inbox, sync-state, active-sprint, roster, ui-foundation, smoke-test]
status: complete
last_updated: 2026-08-21
last_updated_by: Adam Reszka
---

# Research: S-07 Dashboard "Today" — inbox-centric north-star core

**Date**: 2026-08-21T18:28:39+0200
**Researcher**: Adam Reszka
**Git Commit**: a783098adcb44a67938ae4312b5df3ba839d95c1
**Branch**: feat/s07-dashboard-today
**Repository**: 10xdevs-certification-project

## Research Question

Scope confirmed with the user as **inbox-centric core only** (the three data panels — Sprint Pulse burndown, Yesterday's Activity, Reliability KPI — are OUT of this research/slice, per `frame.md` and the scope decision). What exactly is render-ready vs. must-be-built to deliver the S-07 north-star (US-01): the Anomaly Inbox as the default Dashboard "Today" view (5 FR-014 attributes per anomaly, default order severity→recency, client re-sort by severity/age/ticket/developer, filter by anomaly-type/team-member) + per-integration last-sync freshness timestamp + error banner (last cached state, never blank) + the real-data smoke-test that validates the milestone. PRD refs FR-015, FR-016, US-01.

## Summary

The north-star core splits cleanly into **render-ready** and **must-build**:

- **Render-ready (data exists):** the Anomaly Inbox reader `listAnomaliesForSprint(db, ownerId, sprintId)` already returns `AnomalyView[]` pre-ordered severity→recency with all 5 FR-014 attributes; the `syncState` table already holds per-integration freshness (`lastSuccessfulSyncAt`) + error (`status`, `lastError`); the gated server-component + `getDb` + `force-dynamic` route pattern is established.
- **Must-build (new code, all small except the UI):**
  1. **The inbox UI itself** — `dashboard/page.tsx` is a stub; `organisms/anomaly/` and `organisms/dashboard/` are empty `.gitkeep`s. This IS the slice.
  2. **A shared active-sprint resolver** — logic is duplicated verbatim in `run-sync.ts:408-422` and `load-snapshot.ts:34-49` ("prefer ACTIVE, else most-recent by startDate"); no shared reader. Extract `getActiveSprint(db, ownerId)`.
  3. **A sync-state reader** — no dashboard reader exists; the only SELECT (`acquireLease`) doesn't read `status`/`lastError`. New owner-scoped reader returning both GITHUB + JIRA rows.
  4. **A roster reader** — the inbox reader returns `relatedTeamMemberId` only (no name); the member filter needs a `teamMember`-by-owner lookup for display names.
  5. **Client sort/filter organism** — greenfield (no nuqs, no existing sort/filter component); plain `"use client"` + `useState` over the server-passed array.
  6. **shadcn primitives** — add `tabs`, `badge` (+ likely `tooltip`/`separator`/`skeleton`); the rest (`table`, `card`, `alert`, `select`, `button`, `scroll-area`) are installed.

**Two data-shape gaps** the plan must resolve: (a) `context` jsonb is typed `unknown` — define a per-type discriminated context type to read contextual data safely; (b) **no ticket/PR identifier is projected** by the reader (identity lives inside `context`/`sourceUrl`/`dedupKey`) — so "sort/filter by ticket" needs either parsing `context`/`sourceUrl` or widening the reader's SELECT to include `dedupKey`.

**Two smoke-test blockers** that gate US-01 validation: (a) **no `syncNow` trigger in the UI** — the server action exists but has zero callers, and `next dev` does not run the cron; (b) **no demo/seed fallback** (FR-008 unbuilt) — real GitHub + Jira credentials against a real **active, dated** Jira sprint are the only way to produce data today, and a missing active-dated sprint makes the whole pipeline skip `no_sprint` → a legitimately empty inbox.

## Detailed Findings

### 1. Anomaly Inbox data path (render-ready)

`listAnomaliesForSprint(db, ownerId, sprintId): Promise<AnomalyView[]>` — `src/lib/anomaly/reader.ts:34-61`.

- Query selects 10 columns from `anomaly`, filtered `ownerId = ownerId AND sprintId = sprintId AND status = "ACTIVE"` (`reader.ts:54-58`) — RESOLVED anomalies excluded.
- Ordering `.orderBy(asc(anomaly.severity), desc(anomaly.detectedAt))` (`reader.ts:60`). Because the `severity` pgEnum is declared `["HIGH","MEDIUM","LOW"]` (`schema.ts:44`), `asc(severity)` = HIGH→MEDIUM→LOW (enum sort = declaration order), then newest-first. This is the **FR-015 default order**; a reader integration test guards the enum-order assumption (`reader.ts:6-16`).
- The reader's docstring explicitly states it is the surface S-07 renders and that **re-sort/filter is S-07's concern, not the reader's** (`reader.ts:8-11`).

**`AnomalyView` = `Pick<SelectAnomaly, ...>`** (`reader.ts:20-32`; `SelectAnomaly = typeof anomaly.$inferSelect`, `schema.ts:982`). Exact fields (types inferred from `anomaly` table `schema.ts:587-613`):

| Field | TS type | Nullable | FR-014 attr | Sort/filter use |
|---|---|---|---|---|
| `id` | `string` | no | — | key |
| `type` | 8-value union (anomaly type) | no | anomaly type | **filter** |
| `severity` | `"HIGH" \| "MEDIUM" \| "LOW"` | no | **severity** | **sort/filter** |
| `description` | `string \| null` | yes | **description** | — |
| `context` | `unknown` (jsonb, no `$type`) | yes | **contextual data** | ticket/PR identity buried here |
| `suggestedAction` | `string \| null` | yes | **suggested action** | — |
| `sourceUrl` | `string \| null` | yes | **source deep-link** | ticket/PR identity |
| `riskScore` | `number \| null` | yes | riskScore (display) | — |
| `detectedAt` | `Date \| null` | yes | detectedAt | **sort by age** |
| `relatedTeamMemberId` | `string \| null` | yes | developer id | **filter by member** (id only) |

All 5 FR-014 attributes present. `context` is untyped `unknown` — UI must narrow it manually.

**`anomaly` table** — `src/db/schema.ts:584-625`: `sprintId` NOT NULL FK → `sprint.id` (`schema.ts:591-593`); dedup `unique("anomaly_owner_sprint_dedup_uq")` on `(ownerId, sprintId, dedupKey)` (`schema.ts:616-620`); indexes on `(ownerId,sprintId)`, `type`, `severity`. `relatedTeamMemberId` FK → `teamMember` **ON DELETE SET NULL** (`schema.ts:606-610`).

**Write path** — `src/lib/anomaly/detect.ts`: every anomaly (including ticket-less PR anomalies) is keyed to the active-sprint id `sprintId = snapshot.sprint.id` (`detect.ts:52`, comment `detect.ts:20-24`); `riskScore = riskScore(severity, magnitude)` (`detect.ts:82`); reconcile keys on `(owner_id, sprint_id, dedup_key)`; skipped entirely if no active sprint (`detect.ts:49`).

**Enums/types to import (do not redefine)** from `@/db/schema`: `anomalyType` (8 values, `schema.ts:32-41`), `severity` (`schema.ts:44`), `anomalyStatus` (`schema.ts:89`), `SelectAnomaly` (`schema.ts:982`), `SelectTeamMember` (`schema.ts:846`); from `@/lib/anomaly/reader`: **`AnomalyView`** (`reader.ts:20`). Union-derivation precedent: `src/lib/anomaly/types.ts:25-26` uses `(typeof anomalyType.enumValues)[number]`.

**Team-member info is NOT joined** — reader returns only `relatedTeamMemberId` (`reader.ts:40-51`). Member filter needs a separate roster lookup (see §3).

### 2. Freshness timestamp + error banner (data-ready; reader must-build)

`syncState` table (`sync_state`) — `src/db/schema.ts:349-383`:
- `ownerId` NOT NULL → user (cascade); `integration` enum NOT NULL; `lastSuccessfulSyncAt` (nullable); `lastAttemptAt` (nullable); `status` enum (nullable); `lastError` text (nullable); `jiraHistoryCursor`; `claimedUntil` (lease guard); `freshnessWindowMinutes` int NOT NULL default 15.
- Unique `sync_state_owner_integration_uq` on `(ownerId, integration)` (`schema.ts:377-382`) — one row per integration per owner.

Enums: `integration = ["GITHUB","JIRA"]` (`schema.ts:62`); `syncStatus = ["OK","ERROR","RATE_LIMITED"]` (`schema.ts:65-69`). `status` is null before any attempt. `finalizeSyncState` clears `lastError` to null and stamps `lastSuccessfulSyncAt` only on OK (`run-sync.ts:193-205`); `classifyError` distinguishes hard auth `ERROR` from `RATE_LIMITED` blip (`run-sync.ts:210-221`).

**No dashboard reader exists.** The only SELECT on `syncState` is `acquireLease` (`run-sync.ts:142-151`), which reads `claimedUntil`/`lastSuccessfulSyncAt`/`freshnessWindowMinutes`/`jiraHistoryCursor` under `FOR UPDATE` — NOT `status`/`lastError`, not reusable. S-07 must add an owner-scoped reader returning both rows (GITHUB + JIRA), projecting `integration`, `lastSuccessfulSyncAt`, `status`, `lastError` (FR requires "Jira separately from GitHub"). Pattern: `.select({...}).from(syncState).where(eq(syncState.ownerId, ownerId))` → map by `integration`.

### 3. Active-sprint resolver + roster reader (small must-build)

**`sprint` table** — `src/db/schema.ts:318-347`: `state` enum `sprint_state = ["ACTIVE","CLOSED","FUTURE"]` (`schema.ts:82-86`), `startDate`/`endDate`, `committedSp`/`completedSp`, cadence columns. Unique `(ownerId, jiraSprintId)`.

**Duplicated resolution — rule is IDENTICAL in both sites:**
- `run-sync.ts:408-422` (`syncJira`): SELECT sprint where `ownerId AND state='ACTIVE'` limit 1; fallback `ownerId` order by `startDate desc` limit 1. Projects `{id, jiraSprintId, startDate}`.
- `load-snapshot.ts:34-49` (`loadSprintSnapshot`): same rule; SELECTs full row; returns `null` if none (`load-snapshot.ts:51`).

Rule verbatim: **"prefer the ACTIVE sprint; else the most-recently-started (`ORDER BY start_date DESC LIMIT 1`)."** They differ only in projection + variable naming. → Extract **`getActiveSprint(db, ownerId)`** returning the **full sprint row** (superset) or `null`; both existing sites can collapse onto it.

**Name collision warning:** `getActiveSprint` at `src/lib/jira.ts:507` is a **Jira REST client** (`baseUrl, creds, boardId`), used in `roster-store.ts:411` — NOT a DB reader. New DB reader must use a distinct name/location (e.g. `src/lib/sprint.ts` or keep in `src/lib/anomaly/`).

**`no_sprint` SKIP** — `run-sync.ts:427-432`: when the resolver returns nothing, Jira is stamped OK but returns `{status:"SKIPPED", reason:"no_sprint"}` (member of `IntegrationOutcome`, `run-sync.ts:94`); `load-snapshot.ts:51` returns `null`. A third partial variant (ACTIVE-only, no fallback) exists at `setup/team/page.tsx:54-64` for cadence display — not a full resolver.

**`teamMember` table** — `src/db/schema.ts:294-316`: `ownerId` NOT NULL (indexed `team_member_ownerId_idx`), `name` NOT NULL, `githubUsername`/`jiraAccountId`/`role`/`spCapacity` (nullable), `technologyTrack` enum `["FRONTEND","BACKEND","MOBILE","QA"]`, `source` enum `["GITHUB","JIRA","MANUAL","BOTH"]`, `isActive` NOT NULL default true.

**No dedicated roster reader.** Closest template: `setup/team/page.tsx:27-39` — owner-scoped SELECT of display columns (`id, name, githubUsername, jiraAccountId, role, spCapacity, technologyTrack, source`) `where(eq(teamMember.ownerId, ownerId))`. For the member filter, add an owner-scoped reader following that projection; consider filtering `isActive = true` (existing readers do not).

**DB-reader conventions (template `reader.ts`):** (1) `db` handle is **injected**, never acquired inside — `type Db = ReturnType<typeof getDb>`, first param; callers resolve `env` via `getCloudflareContext()` and build `db = getDb(env)`. (2) `ownerId` scoping mandatory on every query (`where(eq(table.ownerId, ownerId))`) — the app-enforced cross-account isolation guard (no RLS). (3) Return an exported `Pick<>` view derived from `Select*`; project exactly those columns. (4) Feature readers live in `src/lib/<feature>/`.

### 4. UI foundation & dashboard route (must-build UI over a ready pattern)

**Route + auth (defense-in-depth):**
- `middleware.ts` (repo root) — optimistic cookie check only, NOT the security boundary (CVE-2025-29927); named `middleware.ts` deliberately (OpenNext limitation).
- `src/app/(app)/layout.tsx:17-38` — the real boundary: `await requireSession()` (`layout.tsx:22`), wraps children in `AppShell`. **`export const dynamic = "force-dynamic"` declared once here (`layout.tsx:9`)** and inherited — the dashboard page does NOT re-declare it.
- `requireSession()` — `src/lib/auth.ts:109-123`, DB-backed, redirects to `/login`; backed by `getOptionalSession()` wrapped in React `cache()` so layout guard + page share one `getSession` per request; fail-closed.

**Gated server-component + DB pattern (copy from `setup/team/page.tsx:21-26`):**
```ts
export default async function DashboardPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();   // "@opennextjs/cloudflare"
  const db = getDb(env);                     // "@/lib/db"
  const ownerId = session.user.id;
  const sprint = await getActiveSprint(db, ownerId);       // NEW reader
  const anomalies = sprint ? await listAnomaliesForSprint(db, ownerId, sprint.id) : [];
  const syncStatus = await getSyncState(db, ownerId);      // NEW reader
  const roster = await listRoster(db, ownerId);            // NEW reader
  // pass plain serializable props to a "use client" inbox organism
}
```
`getDb(env)` — `src/lib/db.ts:26-28` — request-scoped Drizzle over `pg.Pool` (Hyperdrive `env.HYPERDRIVE`, falls back to `process.env.DATABASE_URL`). Use `getDb` on the request path; `getDbWithPool` (`db.ts:11-19`) is for the sync/cron path that owns teardown. Page-content wrapper convention: `mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-12 sm:px-6` (`dashboard/page.tsx:12`).

**shadcn/ui inventory** (`components.json`: new-york, zinc, rsc, lucide). Installed under `src/components/ui/` (11): `alert`, `button`, `card`, `checkbox`, `form`, `input`, `label`, `scroll-area`, `select`, `sonner`, `table`. **Must add:** `tabs` (FR-016 progressive disclosure), `badge` (severity/type tags), likely `tooltip`/`separator`/`skeleton`. `radix-ui ^1.4.3` already present (Tabs peer satisfied). No `Tabs`/`Badge`/`nuqs` anywhere in `src/` yet.

**Atomic-design state:** `organisms/dashboard/` and `organisms/anomaly/` are empty (`.gitkeep`). `atoms/` = `brand.tsx`; `molecules/` = `main-nav.tsx` + `sign-out-button.tsx`; `templates/` = `app-shell.tsx` + `setup-wizard-shell.tsx`. Inbox/anomaly-row components go in the two empty organism dirs; consider `templates/dashboard-shell.tsx` mirroring `setup-wizard-shell.tsx`. **`molecules/main-nav.tsx:5-10`**: the "Dashboard" link is an inert `#` anchor with active-link styling deferred "until real routes exist" — S-07 wires it to `/dashboard`.

**Client interactivity convention** (from `organisms/setup/roster-editor.tsx`): `"use client"` + plain `useState` (no nuqs/searchParams anywhere); server reads DB → passes serializable props → client holds sort/filter state and re-orders the array. Toasts via `sonner`; errors via `Alert variant="destructive"`. Tabs must live in a client organism receiving server-fetched data as props.

### 5. Real-data smoke-test path (blockers to plan around)

**Sync entry points** — shared orchestrator `syncOwner` (`run-sync.ts:552-557`):
- **On-demand `syncNow`** server action (`src/lib/integrations/sync/actions.ts:27-63`): `requireSession()` → `getDbWithPool(env)` → `syncOwner({bypassDueCheck:true})` → `detectAnomalies` before pool teardown. `bypassDueCheck` skips the 15-min gate.
- **Cron** — `src/worker.ts:41` → `runScheduledSync` (`scheduled.ts:60-105`), wired via `wrangler.jsonc` `crons: ["*/15 * * * *"]`; enumerates owners with BOTH a `jira_project` AND `github_credential` (`scheduled.ts:42-48`), runs `syncOwner` + `detectAnomalies` per owner.

**Sync → detect** — `detectAnomalies` (`detect.ts:44-133`) runs AFTER `syncOwner` in both paths; loads snapshot, runs all 8 detectors, reconciles into `anomaly` (insert/update/resolve). Tickets are scoped to the chosen sprint id (`load-snapshot.ts:61`); PRs/reviews/commits are owner-scoped (`load-snapshot.ts:62-73`) — so PR-only anomalies (`PR_TOO_BIG`, `PR_REVIEW_STALLED`) can fire even with few tickets, provided a sprint row exists.

**A sprint row exists only if setup found an active Jira sprint WITH start+end dates** — created solely in `importCadence` (`roster-store.ts:431-465`), guarded by `hasDates` (`roster-store.ts:412-413`). No dated active sprint → both `no_sprint` skips fire → empty inbox. This is the most likely reason a real smoke test yields nothing.

**Connect flow is fully built:** GitHub PAT + repo selection (FR-002/004, `setup/github/*`, requires ≥1 `monitored_repo` or GitHub SKIPs `not_connected` at `run-sync.ts:245-247`); Jira token/URL/project/status-mapping (FR-003/004/005, `setup/jira/*`, mapping populates `status_mapping` consumed at `run-sync.ts:453-457`); roster + cadence/sprint (FR-006/007, `setup/team/*`, creates the sprint row).

**Blockers:**
1. **Dashboard inbox UI is unbuilt** — the S-07 slice itself.
2. **No `syncNow` trigger** — the action has zero callers (grep-confirmed); wizard finish (`cadence-form.tsx:142`) just `router.push("/dashboard")`. Need a "sync now" button/route/action wiring, or rely on cron.
3. **No cron under `next dev`** — the `scheduled` handler only fires in the Worker runtime (`wrangler dev` / `npm run preview`), not `next dev`.
4. **No demo/seed fallback** — FR-008 unbuilt (grep for demo/seed hits only doc-comments); real credentials + real active-dated sprint are mandatory.
5. **Silent-empty risk** — a missing active-dated sprint legitimately empties the inbox (`run-sync.ts:427`, `detect.ts:49`); S-07 UI should distinguish "no anomalies detected" from "no active sprint" from "sync failed".

**Local dev DB:** `getDbWithPool` uses `env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL` (`db.ts:11-19`); under `next dev` (with `initOpenNextCloudflareForDev()`) the HYPERDRIVE local string comes from `.env.local` (`...LOCAL_CONNECTION_STRING_HYPERDRIVE`) pointing at local Supabase 127.0.0.1:54322. `wrangler.jsonc` `localConnectionString` is a deploy-check placeholder. Migrations: `npm run db:migrate` (drizzle-kit); `drizzle.config.ts:13` force-loads `.env.local` (override) → defaults to local DB 54322.

## Code References

- `src/lib/anomaly/reader.ts:34-61` — `listAnomaliesForSprint` (render-ready inbox reader, FR-015 default order); `reader.ts:20-32` — `AnomalyView` view type.
- `src/db/schema.ts:584-625` — `anomaly` table; `:32-41` anomalyType enum; `:44` severity enum; `:89` anomalyStatus enum; `:982` `SelectAnomaly`.
- `src/lib/anomaly/detect.ts:44-133` — detection/reconcile; `:52` sprintId keying; `:82` riskScore.
- `src/lib/anomaly/types.ts:25-26` — enum-union derivation precedent.
- `src/db/schema.ts:349-383` — `syncState` table; `:62` integration enum; `:65-69` syncStatus enum.
- `src/lib/integrations/sync/run-sync.ts:408-422` — active-sprint resolution (site 1); `:427-432` `no_sprint` SKIP; `:142-151` `acquireLease` SELECT; `:193-205` `finalizeSyncState`; `:210-221` `classifyError`; `:245-247` GitHub `not_connected`; `:453-457` status_mapping usage; `:552-557` `syncOwner`.
- `src/lib/anomaly/load-snapshot.ts:34-51` — active-sprint resolution (site 2) + snapshot loading; `:61-73` ticket vs owner scoping.
- `src/db/schema.ts:318-347` — `sprint` table; `:82-86` sprintState enum.
- `src/db/schema.ts:294-316` — `teamMember` table; `:47-52` technologyTrack; `:105-110` member_source.
- `src/lib/jira.ts:507` — Jira-REST `getActiveSprint` (name-collision warning).
- `src/app/(app)/setup/team/page.tsx:21-64` — gated server-component + DB + roster/sprint direct-query template.
- `src/app/(app)/dashboard/page.tsx:1-22` — stub to replace; `:12` content-wrapper class.
- `src/app/(app)/layout.tsx:9,17-38` — `force-dynamic` + `requireSession` boundary.
- `src/lib/auth.ts:89-123` — `getOptionalSession` (cache) + `requireSession`.
- `src/lib/db.ts:11-28` — `getDbWithPool` (cron/teardown) vs `getDb` (request path).
- `components.json` — shadcn config; `src/components/ui/*` — 11 installed primitives.
- `src/components/molecules/main-nav.tsx:5-10` — inert `#` Dashboard link to wire to `/dashboard`.
- `src/components/organisms/setup/roster-editor.tsx` — `"use client"` + `useState` interactivity template.
- `src/lib/integrations/sync/actions.ts:27-63` — `syncNow` (no callers); `src/worker.ts:41` + `scheduled.ts:42-105` — cron path; `roster-store.ts:412-465` — sprint-row creation (`importCadence`).

## Architecture Insights

- **Reader convention is uniform**: inject `db`, scope by `ownerId`, project a `Pick<>` view. The three new readers (`getActiveSprint`, `getSyncState`, `listRoster`) should all follow `reader.ts`. Cross-account isolation is app-enforced (no RLS) — every reader MUST carry the `ownerId` predicate (matches `project_supabase_isolation_model` memory).
- **`force-dynamic` + session cache** is a layout-level concern; pages inherit it and just `requireSession()` again (shared cache call). Aligns with `project_local_dev_db_and_cf_context` memory.
- **Request-path DB uses `getDb`, not `getDbWithPool`** — the pool-teardown lesson (`lessons.md`: request-scoped `pg.Pool` must be closed at request end, not per invocation) means the dashboard render path must use the request-scoped `getDb`, leaving teardown to the framework; `getDbWithPool` is reserved for the sync/cron path that explicitly owns `.end()`.
- **The inbox is deliberately a thin render** over a reader that already encodes the FR-015 default order; S-07's only inbox logic is client re-sort/filter over the returned array — no server re-query per sort.
- **Sprint identity is the pipeline's linchpin**: no active-dated sprint → no sprint row → `no_sprint` skips at both sync and detect → empty inbox. The UI must treat "no active sprint" as a first-class empty state distinct from "no anomalies" and "sync error".

## Historical Context (from prior changes)

- `context/changes/dashboard-today/frame.md` — the framing step that scoped S-07 to the inbox-centric core and split out the three panels (2 of 3 overlap S-10's aggregation ownership). This research confirms the frame's Hypothesis Investigation at file:line: inbox + freshness/banner are render-ready; active-sprint resolver is small/duplicated; panels are separable. Scope decision (this session): **core only, panels out**.
- `context/changes/dashboard-today/change.md` — S-07 identity; note its "data surfaces already built" line overstates readiness for the panels (correct for the inbox core).
- Prereqs (done): S-06 anomaly engine (the `reader.ts`/`detect.ts` this slice renders), S-05 sync + `sync_state`, S-04 roster, F-03 UI foundation (`app-shell`, auth, shadcn baseline).
- `context/foundation/lessons.md` — relevant priors: request-scoped `pg.Pool` teardown (use `getDb` on render path); NOT-NULL dedup-key rule (already satisfied — `anomaly.dedupKey` is NOT NULL, `schema.ts` unique `(ownerId,sprintId,dedupKey)`).

## Related Research

- None prior for this change (`context/changes/dashboard-today/research.md` is this document). `frame.md` is the only sibling artifact.

## Open Questions

1. **Ticket/PR sort/filter source** — the reader projects no ticket/PR identifier; identity lives in `context` (untyped) / `sourceUrl` / `dedupKey`. Plan must choose: (a) widen `listAnomaliesForSprint` SELECT to include `dedupKey` (shape e.g. `PR_REVIEW_STALLED:pr:<id>`), or (b) define + parse a per-type discriminated `context` type. The latter is also needed to render "contextual data" (FR-014) safely — likely do both.
2. **Smoke-test trigger** — S-07 needs a "sync now" action wired to a button (recommended, also a real product affordance FR-011 implies) OR the smoke-test runs under `wrangler dev`/`npm run preview` so cron fires. Which does the plan adopt? (Recommend a real "Sync now" button on the dashboard — it doubles as the manual-refresh UX and unblocks the smoke-test without deploy.)
3. **Empty-state taxonomy** — confirm the UI distinguishes at least: no active sprint (`getActiveSprint` null), active sprint but zero ACTIVE anomalies, and last sync errored (banner + last cached state). US-01 AC requires "empty only when zero anomalies, never because a fetch failed silently."
4. **Member filter for null `relatedTeamMemberId`** — team-less anomalies (`SCOPE_CREEP`, `SPRINT_AT_RISK`) have null member; the filter needs an "unassigned/team-level" bucket.
