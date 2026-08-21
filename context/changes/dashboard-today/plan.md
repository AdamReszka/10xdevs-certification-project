# S-07 Dashboard "Today" — Anomaly Inbox north-star core — Implementation Plan

## Overview

Deliver the US-01 north-star: open Dashboard "Today" with the **Anomaly Inbox as the default (and only) headline view** — every detected anomaly showing the five FR-014 attributes plus its risk score, in the FR-015 default order (severity HIGH→MEDIUM→LOW, then recency), with client-side re-sort (severity / age / ticket / developer) and filter (anomaly type / team member). Around the inbox: a per-integration last-sync freshness timestamp (Jira separately from GitHub), an error banner naming the failed integration while still showing the last cached inbox, and three distinct empty states so the inbox is empty ONLY when zero anomalies are detected — never because a fetch failed silently. The slice is validated end-to-end by a real-credentials smoke-test run under `wrangler dev`.

The inbox reader (`listAnomaliesForSprint`) already exists and already encodes the default order. This slice builds the UI over it, plus three small owner-scoped readers, a typed anomaly-context union, and the smoke-test.

## Current State Analysis

From `context/changes/dashboard-today/research.md` (codebase baseline) and `frame.md` (scope):

- **Render-ready data**: `listAnomaliesForSprint(db, ownerId, sprintId): Promise<AnomalyView[]>` (`src/lib/anomaly/reader.ts:34-61`) returns all 5 FR-014 attributes + `riskScore` + `detectedAt` + `relatedTeamMemberId`, pre-ordered severity→recency (severity enum declared HIGH→MEDIUM→LOW at `src/db/schema.ts:44`). Its docstring states re-sort/filter is S-07's job, not the reader's.
- **Freshness/error data**: `syncState` (`src/db/schema.ts:349-383`) holds `lastSuccessfulSyncAt`, `status` (`OK`/`ERROR`/`RATE_LIMITED`), `lastError`, unique per `(ownerId, integration)` where `integration ∈ {GITHUB, JIRA}`. No dashboard reader exists — the only SELECT (`acquireLease`, `run-sync.ts:142-151`) does not read `status`/`lastError`.
- **Active-sprint logic is duplicated verbatim** in `run-sync.ts:408-422` and `load-snapshot.ts:34-49` ("prefer ACTIVE, else most-recent by `startDate`") — no shared reader. Name collision: `getActiveSprint` at `src/lib/jira.ts:507` is a Jira REST client, NOT a DB reader.
- **Roster**: `teamMember` (`src/db/schema.ts:294-316`) holds display fields; no dedicated list reader. The inbox reader returns only `relatedTeamMemberId` (id, nullable) — no name join.
- **UI**: `src/app/(app)/dashboard/page.tsx:1-22` is a stub; `src/components/organisms/{anomaly,dashboard}/` are empty `.gitkeep`s. The gated server-component pattern (`requireSession()` → `getCloudflareContext().env` → `getDb(env)` → owner-scoped SELECT → props to a `"use client"` organism) is established in `src/app/(app)/setup/team/page.tsx:21-64`. `force-dynamic` is declared once on `(app)/layout.tsx:9` and inherited. shadcn installed: `alert`, `button`, `card`, `checkbox`, `form`, `input`, `label`, `scroll-area`, `select`, `sonner`, `table`. No `badge`/`tabs`/`tooltip`/`skeleton`; no `nuqs`. Client-state convention is plain `"use client"` + `useState` (`organisms/setup/roster-editor.tsx`).
- **Smoke-test path**: `syncNow` server action (`src/lib/integrations/sync/actions.ts:27-63`) runs `syncOwner` + `detectAnomalies`, but has **zero callers**; `next dev` does not run the cron (only the Worker runtime / `wrangler dev` does, `src/worker.ts:41` + `scheduled.ts`). No demo/seed fallback exists. A sprint row exists only if setup found an active Jira sprint WITH start+end dates (`roster-store.ts:412-465`); otherwise the pipeline skips `no_sprint` and the inbox is legitimately empty.
- **Test stack** (package.json): vitest unit (`npm run test`), integration (`npm run test:integration`, `vitest.integration.config.ts`), playwright e2e (`npm run test:e2e`), stryker mutation. Type: `npm run typecheck`; lint: `npm run lint`; build: `npm run build`.

## Desired End State

A signed-in tech lead navigating to `/dashboard` sees the Anomaly Inbox populated with every ACTIVE anomaly for their current sprint, each row carrying severity, description, contextual data, one-line suggested action, source deep-link, and the risk score. They can re-sort and filter the inbox client-side. Above/around the inbox, they see when Jira and GitHub last synced successfully; if the most recent sync errored, a banner names the failed integration while the last cached anomalies remain visible. When there is no active sprint, or an active sprint with zero anomalies, or a sync error, each is a distinct, unambiguous state. The whole flow is demonstrated once with real GitHub + Jira credentials under `wrangler dev`.

Verify: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build` all pass; the smoke-test in Phase 5 renders ≥1 real anomaly.

### Key Discoveries:

- Inbox reader is render-ready and pre-ordered (`src/lib/anomaly/reader.ts:34-61`); sort/filter is client-only over the returned array.
- Active-sprint rule is identical in two places (`run-sync.ts:408-422`, `load-snapshot.ts:34-49`) — extract once, collapse both.
- `context` jsonb is typed `unknown` (`src/db/schema.ts:602`) and no ticket/PR identifier is projected — both must be resolved for FR-014 contextual-data render and ticket sort/filter.
- `force-dynamic` is inherited from `(app)/layout.tsx:9` — the page must NOT re-declare it.
- Request-path DB uses `getDb` (framework owns teardown); `getDbWithPool` is reserved for the sync/cron path (lessons.md: request-scoped `pg.Pool` teardown).

## What We're NOT Doing

- **Sprint Pulse (burndown), Yesterday's Activity, Reliability KPI panels** — deferred (scope decision this session; 2 of 3 overlap S-10's aggregation ownership per `frame.md`).
- **Tabs / progressive-disclosure shell (FR-016)** — deferred WITH the panels; with only the inbox, there is nothing to tab between.
- **A "Sync now" button** — the smoke-test runs the real cron under `wrangler dev` (user decision); no manual-sync affordance is added in this slice.
- **Demo/seed data (FR-008)** — separate slice; the smoke-test uses real credentials.
- **Per-anomaly severity re-tiering / threshold settings (FR-014 configurability, FR-009)** — separate settings surface.
- **Resolving/dismissing anomalies from the inbox** — read-only inbox in this slice.

## Implementation Approach

Build bottom-up so the UI phases sit on verified data foundations: (1) the three owner-scoped readers first (with `getActiveSprintRow` extracted and both existing call-sites collapsed onto it, so there is one source of truth before the dashboard depends on it); (2) the typed anomaly-context union + reader widening so the inbox can render contextual data and sort/filter by ticket safely; (3) the server-component wiring and inbox render; (4) client interactivity, freshness, and the empty-state taxonomy; (5) the real-data smoke-test. Every reader follows the injected-`db` + owner-scoped + `Pick<>`-view convention from `reader.ts`. All UI uses shadcn/ui.

## Critical Implementation Details

- **DB handle on the render path**: the dashboard page and its readers must use `getDb(env)` (request-scoped, framework-owned teardown), never `getDbWithPool` — the latter owns `.end()` and is for the sync/cron path only (`src/lib/db.ts:11-28`; lessons.md request-scoped `pg.Pool` rule).
- **Cross-account isolation is app-enforced (no RLS)**: every new reader query MUST carry `where(eq(<table>.ownerId, ownerId))`. This is the isolation guard (`project_supabase_isolation_model` memory).
- **Sprint reader name collision**: the DB reader is named `getActiveSprintRow` — a distinct symbol from the Jira REST client `getActiveSprint` at `src/lib/jira.ts:507`, not merely a same-named function on a different import path. Place it in a new `src/lib/sprint.ts` (or `src/lib/anomaly/`).
- **Empty vs error is load-bearing for US-01**: "no active sprint" (`getActiveSprintRow` → null), "active sprint, zero ACTIVE anomalies", and "last sync errored" (syncState.status ≠ OK) are three separate render branches. A sync error must still show the last cached inbox, never a blank/crash.
- **`relatedTeamMemberId` is nullable**: team-less anomalies (`SCOPE_CREEP`, `SPRINT_AT_RISK`) have no member — the member filter needs an explicit "unassigned / team-level" bucket.

---

## Phase 1: Shared owner-scoped readers

### Overview

Introduce the three DB readers the dashboard needs, and eliminate the active-sprint duplication by extracting a single resolver and collapsing both existing call-sites onto it.

### Changes Required:

#### 1. Shared active-sprint resolver

**File**: `src/lib/sprint.ts` (new)

**Intent**: Provide the single "prefer ACTIVE sprint, else most-recently-started" resolver as an owner-scoped DB reader, replacing the two inline duplicates. Returns the full sprint row (superset both call-sites need) or `null` when the owner has no sprint.

**Contract**: `getActiveSprintRow(db: Db, ownerId: string): Promise<SelectSprint | null>`. Rule verbatim: SELECT where `ownerId = ownerId AND state = 'ACTIVE'` limit 1; if none, SELECT where `ownerId = ownerId` order by `startDate desc` limit 1; else `null`. Follows the injected-`db` + owner-scoped convention from `src/lib/anomaly/reader.ts`. Named distinctly (`getActiveSprintRow`) from the Jira REST `getActiveSprint` (`src/lib/jira.ts:507`).

#### 2. Collapse both existing call-sites

**File**: `src/lib/integrations/sync/run-sync.ts` (lines ~408-422), `src/lib/anomaly/load-snapshot.ts` (lines ~34-49)

**Intent**: Replace the two inline sprint-resolution blocks with a call to `getActiveSprintRow`, preserving each site's existing behavior (run-sync's `no_sprint` SKIP when null at `run-sync.ts:427-432`; load-snapshot's `null` return at `load-snapshot.ts:51`).

**Contract**: Both sites consume the returned full row (run-sync uses `id`/`jiraSprintId`/`startDate`; load-snapshot uses the full row). No behavior change — the resolution rule is already identical; this is a de-duplication refactor. Existing sync + detect tests must stay green.

#### 3. Sync-state reader

**File**: `src/lib/sync-state.ts` (new, or colocate in `src/lib/integrations/sync/`)

**Intent**: Read per-integration freshness + error for the owner, for the timestamp and error banner. Returns both integration rows (GITHUB, JIRA), keyed for direct lookup by the UI.

**Contract**: `getSyncState(db: Db, ownerId: string)` → an object/array projecting `integration`, `lastSuccessfulSyncAt`, `status`, `lastError` for each of GITHUB and JIRA (absent row → integration never synced → represent as null/unknown). Owner-scoped SELECT on `syncState`.

#### 4. Roster reader

**File**: `src/lib/roster.ts` (new, or colocate)

**Intent**: List the owner's team members for the member-filter dropdown and to map `relatedTeamMemberId` → display name in inbox rows.

**Contract**: `listRoster(db: Db, ownerId: string)` → `{ id, name, githubUsername, jiraAccountId, ... }[]`, owner-scoped, filtered to `isActive = true` for the dropdown. Projection follows `setup/team/page.tsx:27-39`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- Integration tests (readers + collapsed sync/detect paths) pass: `npm run test:integration`

#### Manual Verification:

- `run-sync` still SKIPs `no_sprint` when the owner has no sprint; `load-snapshot` still returns null — verified by reading the collapsed code paths.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Typed anomaly-context union + reader widening

### Overview

Give the inbox a safe, typed way to read each anomaly's contextual data (FR-014) and a stable ticket/PR identity for the "sort/filter by ticket" requirement.

### Changes Required:

#### 1. Discriminated anomaly-context type

**File**: `src/lib/anomaly/types.ts` (extend) or a new `context` type module

**Intent**: Reverse-engineer the `context` jsonb shape written by each of the 8 detectors and express it as a discriminated union keyed by anomaly `type`, so the UI narrows `context` instead of touching `unknown`. Include the ticket/PR identity fields each detector already writes.

**Contract**: An exported `AnomalyContext` discriminated union (discriminant = the 8-value `anomalyType`), each variant typing the fields that detector writes into `context` (derive the shapes from `src/lib/anomaly/detect.ts` and the per-rule detectors). A helper to narrow an `AnomalyView` to its typed context, and a helper deriving a display ticket/PR identity + a stable sort key. Import existing enums from `@/db/schema` (do not redefine); reuse the union-derivation precedent at `types.ts:25-26`.

#### 2. Widen the inbox reader with `dedupKey`

**File**: `src/lib/anomaly/reader.ts`

**Intent**: Project `dedupKey` (e.g. `PR_REVIEW_STALLED:pr:<id>`) as a stable, always-present fallback identity/sort key alongside the typed context, so ticket/PR sort/filter never depends solely on nullable/loosely-typed `context`.

**Contract**: Add `dedupKey` to the `AnomalyView` `Pick<>` and to the `.select({...})` projection in `listAnomaliesForSprint` (`reader.ts:20-60`). Ordering unchanged. The existing reader integration test (guards enum order) must still pass; extend it to assert `dedupKey` presence.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- Reader integration test (order + `dedupKey`) passes: `npm run test:integration`

#### Manual Verification:

- Each of the 8 anomaly types narrows to a typed context with no `any`/`unknown` leakage — spot-checked against `detect.ts` write shapes.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Dashboard wiring + Anomaly Inbox render

### Overview

Replace the stub page with a real gated server component that fetches the data, and render the inbox rows (5 FR-014 attributes + risk score) as a client organism.

### Changes Required:

#### 1. Add shadcn primitives

**File**: `src/components/ui/*` (generated)

**Intent**: Add the primitives the inbox needs. `npx shadcn add badge` (severity/type tags); add `tooltip` and `skeleton` only if used (risk-score explainer, loading state). NOT `tabs` (panels deferred).

**Contract**: New files under `src/components/ui/`; `radix-ui ^1.4.3` peer already satisfied. No re-run of shadcn init.

#### 2. Dashboard server component

**File**: `src/app/(app)/dashboard/page.tsx`

**Intent**: Replace the stub. Resolve session + db, fetch the active sprint, then the inbox anomalies, sync-state, and roster; pass plain serializable props to the client inbox organism. Do not re-declare `force-dynamic` (inherited).

**Contract**: `requireSession()` → `getCloudflareContext().env` → `getDb(env)` → `ownerId`. `sprint = await getActiveSprintRow(db, ownerId)`; `anomalies = sprint ? await listAnomaliesForSprint(db, ownerId, sprint.id) : []`; `syncState = await getSyncState(db, ownerId)`; `roster = await listRoster(db, ownerId)`. Maps rows to serializable shapes and renders the inbox organism inside the existing content wrapper (`max-w-6xl … px-4 py-12 sm:px-6`). Uses `getDb`, never `getDbWithPool`.

#### 3. Anomaly Inbox organism (render only)

**File**: `src/components/organisms/anomaly/anomaly-inbox.tsx` (new, `"use client"`), plus a row/card component (e.g. `anomaly-row.tsx`)

**Intent**: Render the passed `AnomalyView[]` in the given order — each row showing severity (Badge), description, contextual data (from the typed context), one-line suggested action, source deep-link, and the risk score. Map `relatedTeamMemberId` → member name via the roster prop.

**Contract**: Client component receiving `{ anomalies, roster, syncState }` props. Renders with shadcn `table`/`card` + `badge`. Severity/type labels from the schema enums. Source deep-link opens `sourceUrl`. No server round-trip. (Sort/filter/state added in Phase 4.)

#### 4. Wire the nav link

**File**: `src/components/molecules/main-nav.tsx`

**Intent**: Point the currently-inert `#` "Dashboard" link at `/dashboard` (active-link styling optional now that a real route exists).

**Contract**: Update the href at `main-nav.tsx:5-10`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Navigating to `/dashboard` (authenticated) renders the inbox with all 5 FR-014 attributes + risk score per row against seeded/existing anomaly rows.
- Unauthenticated request to `/dashboard` redirects to `/login`.
- The "Dashboard" nav link routes to `/dashboard`.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 4.

---

## Phase 4: Interactivity + freshness + empty-state taxonomy

### Overview

Make the inbox interactive and complete the freshness/error/empty surfaces that satisfy the US-01 acceptance criteria.

### Changes Required:

#### 1. Client sort + filter

**File**: `src/components/organisms/anomaly/anomaly-inbox.tsx` (extend), optional `anomaly-inbox-controls.tsx`

**Intent**: Add client-side re-sort (severity / age via `detectedAt` / ticket via typed-context or `dedupKey` / developer via member name) and filter (anomaly type; team member including an explicit "unassigned / team-level" bucket for null `relatedTeamMemberId`). Default order is the server-provided severity→recency.

**Contract**: Plain `useState` over the passed array (no nuqs/searchParams — matches `roster-editor.tsx`). Sort/filter re-derive the displayed list; the passed array is the source of truth. shadcn `select` for the controls.

**Ticket-less anomalies**: `SCOPE_CREEP`, `SPRINT_AT_RISK`, and `DEVELOPER_INACTIVE` write no ticket/PR identity into `context` (their `dedupKey` is sprint-/member-scoped, e.g. `SCOPE_CREEP:sprint:<id>`). For the "by ticket" sort, these rows sort **last** (after all ticket/PR-identified rows, stable within themselves by the default severity→recency order). For the ticket filter, expose an explicit **"no ticket / sprint-level"** bucket that selects exactly these rows — mirroring the null-member "unassigned / team-level" bucket. The derived ticket/PR display identity is empty for them (no fabricated key).

#### 2. Freshness timestamp + error banner

**File**: `src/components/organisms/dashboard/sync-status-bar.tsx` (new) + inbox integration

**Intent**: Always show the last successful sync time per integration (Jira separately from GitHub). When an integration's most recent sync errored (`status ∈ {ERROR, RATE_LIMITED}`), show an `Alert variant="destructive"` naming the failed integration while the last cached inbox stays visible.

**Contract**: Consumes the `syncState` prop. Uses shadcn `alert`. Renders both integrations' timestamps; conditionally renders the banner. Never suppresses the inbox on error.

#### 3. Three empty states

**File**: `src/components/organisms/anomaly/anomaly-inbox.tsx` (extend) / a small empty-state component

**Intent**: Distinguish (a) no active sprint (`sprint` null → "connect/point at an active sprint" message), (b) active sprint but zero ACTIVE anomalies ("no anomalies detected" — the healthy state), (c) sync errored (banner + last cached inbox). Empty inbox appears ONLY in case (b), never on fetch failure.

**Contract**: Branch on `sprint == null`, `anomalies.length === 0`, and `syncState` error flags. Each branch is a distinct message/affordance.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- (If an inbox e2e is added) Playwright inbox sort/filter test passes: `npm run test:e2e`

#### Manual Verification:

- Re-sort by severity/age/ticket/developer reorders the inbox correctly; filter by type and by member (incl. "unassigned") narrows it.
- With a healthy last sync, both Jira and GitHub timestamps show; with a simulated integration error, the banner names the integration and the last cached inbox is still visible.
- The three empty states each render distinctly (no active sprint vs zero anomalies vs sync error).

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 5.

---

## Phase 5: Real-data smoke-test (US-01 validation)

### Overview

Prove the north-star end-to-end with real GitHub + Jira credentials, exercising the real sync→detect→render pipeline via the cron under `wrangler dev`.

### Changes Required:

#### 1. Smoke-test run + checklist

**File**: none (operational) — optionally a short note appended to the change folder

**Intent**: With local Supabase up and migrations applied, complete the setup wizard with real GitHub PAT + repos and real Jira token/project/status-mapping against a team whose Jira project has an **active sprint with start+end dates** (required for a sprint row). Run under `npm run preview` (`wrangler dev`) so the 15-min cron fires `syncOwner` + `detectAnomalies`. Confirm ≥1 detected anomaly renders in the inbox with all five attributes and the correct source deep-link.

**Contract**: Ordered steps: (1) local Supabase 54322 up + `npm run db:migrate`; (2) sign up → connect GitHub (≥1 monitored repo) → connect Jira (project + status mapping) → complete team/cadence so a sprint row is written; (3) `npm run preview` (`wrangler dev`), then fire the scheduled handler **on demand** rather than waiting the 15-min cycle — `curl "http://localhost:<port>/__scheduled"` (the `wrangler dev` scheduled-trigger endpoint; port is the one `npm run preview` prints) runs `syncOwner` + `detectAnomalies` immediately, no "Sync now" UI needed; (4) open `/dashboard`, verify inbox + freshness timestamps + (if applicable) error banner; (5) verify the three empty-state branches by construction (e.g. a project with no active sprint).

### Success Criteria:

#### Automated Verification:

- Full suite green before the run: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`

#### Manual Verification:

- Under `wrangler dev`, a real sync+detect populates ≥1 anomaly and it renders in the inbox with all 5 FR-014 attributes + risk score + working deep-link.
- Per-integration last-sync timestamps reflect the real syncs (Jira separate from GitHub).
- An induced integration error shows the banner + last cached inbox (US-01 AC: never blank on failure).
- "No active sprint" renders its distinct state (verified against a project without an active dated sprint).

**Implementation Note**: This phase is predominantly manual; it is the milestone gate for the **US-01 inbox core** — the Anomaly Inbox half of US-01. US-01's remaining acceptance criteria (Sprint Pulse burndown matches the Jira sprint; Yesterday's Activity counts match source data) and FR-016's tabbed/progressive-disclosure shell are **deferred to a follow-up slice** (per "What We're NOT Doing"; panels overlap S-10's aggregation ownership). Do not record S-07 as fully closing US-01 — only its inbox core.

---

## Testing Strategy

### Unit Tests:

- `AnomalyContext` narrowing per anomaly type; ticket/PR identity + sort-key helper.
- Client sort comparators (severity order, age, ticket, developer) and filter predicates (incl. null-member "unassigned" bucket) — pure functions extracted from the organism.

### Integration Tests:

- New readers (`getActiveSprintRow`, `getSyncState`, `listRoster`) owner-scoped correctness (cross-account isolation: another owner's rows never returned).
- `getActiveSprintRow` resolution: prefers ACTIVE, falls back to most-recent by `startDate`, returns null when none.
- Reader widening: `listAnomaliesForSprint` still severity→recency ordered and now projects `dedupKey`.
- Collapsed sync/detect paths still behave (existing suites stay green).

### Manual Testing Steps:

1. `/dashboard` renders the inbox with all 5 FR-014 attributes + risk score.
2. Re-sort and filter behave; "unassigned" member bucket works.
3. Freshness timestamps per integration; error banner + last cached inbox on induced error.
4. Three empty states render distinctly.
5. Phase 5 real-credentials smoke-test under `wrangler dev`.

## Performance Considerations

Inbox sort/filter is client-side over an already-fetched, sprint-scoped array (bounded by one sprint's active anomalies) — no per-interaction server round-trip. The page issues four owner-scoped reads on one request-scoped `getDb` handle; no N+1 (roster is a single list, member names mapped client-side).

## Migration Notes

No schema/data migration. `dedupKey` already exists on `anomaly` (`src/db/schema.ts`); Phase 2 only projects it. The Phase 1 refactor is behavior-preserving (identical resolution rule) — no data change.

## References

- Research: `context/changes/dashboard-today/research.md`
- Frame: `context/changes/dashboard-today/frame.md`
- Inbox reader: `src/lib/anomaly/reader.ts:34-61`
- Active-sprint duplication: `src/lib/integrations/sync/run-sync.ts:408-422`, `src/lib/anomaly/load-snapshot.ts:34-49`
- Sync-state schema: `src/db/schema.ts:349-383`; sprint: `:318-347`; teamMember: `:294-316`; anomaly + `context`: `:584-625`
- Gated server-component + DB template: `src/app/(app)/setup/team/page.tsx:21-64`; `force-dynamic`: `src/app/(app)/layout.tsx:9`
- Client-state convention: `src/components/organisms/setup/roster-editor.tsx`
- Smoke-test path: `src/lib/integrations/sync/actions.ts:27-63`, `src/worker.ts:41`, `src/lib/integrations/sync/scheduled.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared owner-scoped readers

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — c7c3e85
- [x] 1.2 Linting passes: `npm run lint` — c7c3e85
- [x] 1.3 Unit tests pass: `npm run test` — c7c3e85
- [x] 1.4 Integration tests (readers + collapsed sync/detect paths) pass: `npm run test:integration` — c7c3e85

#### Manual

- [ ] 1.5 `run-sync` still SKIPs `no_sprint` and `load-snapshot` still returns null after collapse

### Phase 2: Typed anomaly-context union + reader widening

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 778f4da
- [x] 2.2 Linting passes: `npm run lint` — 778f4da
- [x] 2.3 Unit tests pass: `npm run test` — 778f4da
- [x] 2.4 Reader integration test (order + `dedupKey`) passes: `npm run test:integration` — 778f4da

#### Manual

- [ ] 2.5 All 8 anomaly types narrow to typed context, no `unknown` leakage

### Phase 3: Dashboard wiring + Anomaly Inbox render

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Production build passes: `npm run build`

#### Manual

- [ ] 3.4 `/dashboard` renders inbox with 5 FR-014 attributes + risk score
- [ ] 3.5 Unauthenticated `/dashboard` redirects to `/login`
- [ ] 3.6 "Dashboard" nav link routes to `/dashboard`

### Phase 4: Interactivity + freshness + empty-state taxonomy

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Production build passes: `npm run build`
- [ ] 4.4 (If added) Playwright inbox sort/filter e2e passes: `npm run test:e2e`

#### Manual

- [ ] 4.5 Re-sort (severity/age/ticket/developer) + filter (type/member incl. unassigned) work
- [ ] 4.6 Per-integration freshness timestamps; error banner + last cached inbox on induced error
- [ ] 4.7 Three empty states render distinctly

### Phase 5: Real-data smoke-test (US-01 validation)

#### Automated

- [ ] 5.1 Full suite green: `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`

#### Manual

- [ ] 5.2 Real sync+detect under `wrangler dev` renders ≥1 anomaly with all 5 attributes + deep-link
- [ ] 5.3 Real per-integration timestamps (Jira separate from GitHub)
- [ ] 5.4 Induced integration error shows banner + last cached inbox (never blank)
- [ ] 5.5 "No active sprint" renders its distinct state
