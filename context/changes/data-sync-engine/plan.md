# S-05 Data Sync Engine Implementation Plan

## Overview

Build a multi-user, DB-stateful sync engine that runs both on a global 15-minute
Cron Trigger **and** on demand (first sync after setup / "sync now"), fans out per
owner within the Workers subrequest/CPU budget as a **capped global loop**,
establishes the PR↔ticket correlation at ingestion, and is safe against overlapping
invocations via a per-owner **claim/lease** — with freshness reported from the actual
DB completion time. Serves FR-011 (GitHub commit/PR/review pull, 15-min freshness)
and FR-012 (Jira active-sprint tickets + incremental status-history delta). Unlocks
S-06 (anomaly detection consumes correlated rows) and S-07 (Dashboard "Today" reads
per-integration last-sync state).

## Current State Analysis

- **Clients are setup/validation only.** `src/lib/github.ts` has `validatePat`,
  `listRepos`, `listCollaborators`; `src/lib/jira.ts` has `validateCredentials`,
  `listProjects`, `listProjectStatuses`, `listBoards`, `getActiveSprint`,
  `listAssignableUsers`. **Zero** commit/PR/review or ticket/changelog fetch exists.
- **The fetch pattern is fully fixed by precedent** (`research.md` §(c)): private
  `githubGet`/`jiraGet` helper (transport failure → `*UnavailableError`, no `cause`
  token-leak), two typed errors per client (401 → Auth; 403/429/5xx/network →
  Unavailable), injectable `baseUrl`+`fetchImpl` seam, and a **capped +
  cross-origin-checked** pagination loop (lesson #4, `MAX_*_PAGES = 20`).
- **`getDb(env)` builds `new Pool({ max: 1 })` per call and never exposes or closes
  the pool** (`src/lib/db.ts:4-12`). Grep-confirmed **zero** `pool.end(` and zero
  `waitUntil` across `src/`. Lesson #3 (request-scoped pool teardown) is known-but-
  unfixed debt on the request path; the cron path has **no request after-hook at all**.
- **Write convention is fixed**: all network I/O completes **before** `db.transaction`
  opens; the transaction body is pure DB writes with `onConflictDoUpdate`
  (`jira-store.ts`, `github-store.ts`, `roster-store.ts`).
- **Store modules are pure and injectable** — `{ db, ownerId, env, … }` with no
  `getCloudflareContext`/`requireSession`/`next/headers` — so they are callable from
  both a `scheduled()` handler and an on-demand Server Action.
- **Idempotency is designed-in**: every synced table has a unique dedup key + NOT NULL
  dedup columns (lesson #1) + `onConflictDoUpdate`. Overlapping fires converge to the
  same rows — the cost of overlap is **wasted subrequests / rate-limit burn, not
  corruption**.
- **`syncState`** (`schema.ts:349-378`): `unique(ownerId, integration)`, columns
  `lastSuccessfulSyncAt`, `lastAttemptAt`, `status`, `lastError`, `jiraHistoryCursor`,
  `freshnessWindowMinutes` (default 15). **No lock/lease column.** `sync_status` enum =
  `OK | ERROR | RATE_LIMITED` (no `RUNNING`).
- **Target write columns already exist and are typed**: `githubCommit`,
  `githubPullRequest` (incl. `linkedTicketKey` + `github_pr_linked_ticket_idx`,
  currently unpopulated), `githubReview`, `jiraTicket`, `jiraStatusHistory`
  (`schema.ts:419-575`).
- **No cron is wired**: `wrangler.jsonc` has no `triggers.crons`; `.open-next/worker.js`
  has no `scheduled()` export.

## Desired End State

- On a `*/15 * * * *` Cron Trigger, one `scheduled()` invocation iterates all owners
  with completed setup, and for each owner fetches GitHub (commits/PRs/PR-detail/reviews)
  and Jira (active-sprint tickets + changelog delta) within a hard per-cycle scan cap,
  upserts idempotently, populates `linkedTicketKey` at ingestion, and stamps
  `syncState.lastSuccessfulSyncAt` per integration from the actual completion time.
- A `syncNow` Server Action runs the same store-layer sync for the current session's
  owner (used as the first sync right after setup, so S-07 has data immediately).
- Overlapping fires skip owners whose `claimedUntil` lease is still fresh.
- The scheduled/on-demand DB pool is explicitly closed via `ctx.waitUntil(pool.end())`
  after all upserts resolve.
- Verify: after connecting real credentials and completing setup, `syncNow` populates
  `githubCommit`/`githubPullRequest`/`githubReview`/`jiraTicket`/`jiraStatusHistory`
  for the owner; `syncState` shows `OK` + a fresh `lastSuccessfulSyncAt` per integration;
  at least one `githubPullRequest.linkedTicketKey` is set where a PR references a
  monitored-project Jira key.

### Key Discoveries:

- Jira `GET /rest/api/3/search` (PageBean `startAt`/`isLast`) is **deprecated and being
  removed**; the non-deprecated path is enhanced search `GET /rest/api/3/search/jql`
  with **token pagination** (`nextPageToken`) + `fields` + `expand=changelog` (context7,
  Jira Cloud REST v3). This differs from the existing `startAt` loop in `jira.ts:243-322`.
- OpenNext adds a cron handler by shipping a **custom worker entry** that wraps the
  generated handler and adds `async scheduled(controller, env, ctx)` to the
  `export default` object (context7, `/opennextjs/opennextjs-cloudflare` worker.ts
  template); `wrangler.jsonc` `main` points at it and gains `triggers.crons`.
- `getDb()` returns `drizzle(pool)` and **hides the pool** (`db.ts:11`) — teardown needs
  a variant that returns the `pool` handle so `ctx.waitUntil(pool.end())` can close it.
- The GitHub `pulls` **list** endpoint omits `additions/deletions/changed_files`; those
  (needed for `PR_TOO_BIG`) require a per-PR `GET /repos/{repo}/pulls/{n}`, and reviews
  are per-PR too — so **PR count is the dominant subrequest multiplier** and drives the
  per-cycle cap.
- The Jira story-point field is a site-specific `customfield_*` id — it must be
  discovered/resolved, not hard-coded.

## What We're NOT Doing

- **No Cloudflare Queues, no self-`fetch` fan-out.** MVP uses a single capped global
  loop; true per-owner fan-out (Queues/self-fetch) is deferred until owner count
  outgrows one invocation's budget.
- **No retrofit of lesson #3 on the request path.** S-05 fixes pool teardown only on the
  new scheduled/on-demand path; the pre-existing request-path leak stays a separate
  ticket.
- **No `RUNNING` value added to `sync_status`.** The overlap guard is a `claimedUntil`
  lease column, not a status-enum change.
- **No anomaly detection.** S-05 only produces correlated rows; detection is S-06.
- **No dashboard UI.** S-07 reads `syncState`; S-05 only writes it.
- **No absence integration, no threshold config, no per-technology grouping** — later
  slices.
- **No historical backfill beyond the active sprint** — sync is scoped to the active
  sprint + delta since last cursor.
- **No sub-cron-interval freshness.** `freshnessWindowMinutes` is honored *upward* (owners
  can sync less often than 15 min) via the due-check; a window below the global `*/15` cron
  interval is floored at ~15 min. True sub-15-min freshness (shorter cron / fan-out) is out
  of scope (F5).

## Implementation Approach

Bottom-up, following the established two-layer split. First the schema delta (lease
column) so the guard exists. Then the two clients' net-new fetch methods, each mirroring
the fixed per-client pattern (typed errors, injectable seam, capped+origin-checked
pagination) — Jira's loop adapted to token pagination. Then a pure store layer
(`src/lib/integrations/sync/…`) that, per owner and per unit (repo / Jira delta), fetches
fully, opens a short upsert transaction, and stamps per-integration `syncState`; the
PR↔ticket link parser is a pure helper invoked at ingestion. Finally the wiring: a custom
OpenNext worker entry exposing `scheduled()` that runs the capped global loop with pool
teardown, `wrangler.jsonc` crons, and a `syncNow` Server Action reusing the same store
layer.

## Critical Implementation Details

- **Pool lifecycle in the scheduled context.** `scheduled(controller, env, ctx)` receives
  `env`/`ctx` as direct arguments (no request). The sync must obtain the `pool` handle
  (new `getDb` variant returning `{ db, pool }`) and, after all upserts resolve, call
  `ctx.waitUntil(pool.end())`. A `fetch` must never be nested inside `db.transaction` —
  it would pin the single Hyperdrive-backed connection for the network duration.
- **Fetch-before-transaction, per unit.** Because sync is larger than onboarding, each
  unit (one repo, or the Jira delta batch) fetches fully, then opens its own short
  transaction of pure upserts. Partial success is expected and acceptable: if repo A
  succeeds and repo B fails, A's rows persist and B's per-integration status reflects the
  failure. GitHub and Jira stamp `syncState` **independently** (they are separate
  integration rows), so a Jira outage must not blank GitHub freshness or vice-versa.
- **Lease semantics (per `(owner, integration)`).** The lease lives on the existing
  `syncState` row, which is already keyed `unique(ownerId, integration)` — so there are two
  independent leases per owner (GITHUB, JIRA), matching how status/cursor/freshness are
  already stored per integration. At the start of syncing one integration for one owner, a
  short transaction stamps `lastAttemptAt` and sets `claimedUntil = now + LEASE_TTL` on that
  row. The next fire skips a `(owner, integration)` whose `claimedUntil` is still in the
  future — GitHub and Jira are guarded independently. `LEASE_TTL` must exceed the worst-case
  per-integration run so a slow run isn't double-entered, but be short enough that a crashed
  run recovers on a later fire (stale-lease recovery is automatic once `claimedUntil` passes).
- **Freshness = DB completion time.** `lastSuccessfulSyncAt` is `new Date()` stamped at
  the end of a successful per-integration upsert, never the scheduled trigger time (Cron
  timing is not SLA'd).
- **Subrequest budget.** Per cycle, cap the GitHub scan to the N most-recent events and
  cap per-PR detail/review GETs; the cursor (`since` / `jiraHistoryCursor`) lets a
  backlog drain across multiple cycles rather than blowing one invocation's budget.

## Phase 1: Schema — claim/lease overlap guard

### Overview

Add the per-owner lease column to `syncState` and generate the migration, so the sync
layer has a cheap overlap guard that covers the long fetch phase (not just the write
window).

### Changes Required:

#### 1. `syncState` lease column

**File**: `src/db/schema.ts`

**Intent**: Add a nullable `claimedUntil` timestamp to `syncState` so a sync run can lease
an owner+integration and later fires can skip a fresh lease. No new enum value.

**Contract**: New column `claimedUntil: timestamp("claimed_until")` (nullable) on the
`syncState` table (`schema.ts:349-378`). No change to the existing
`unique(ownerId, integration)` constraint. Lease is scoped per `(ownerId, integration)`
row, consistent with how freshness/cursor are already stored.

#### 2. Migration

**File**: `src/db/migrations/*` (Drizzle-generated)

**Intent**: Generate and commit the migration adding `claimed_until`.

**Contract**: `npm run` Drizzle generate command (mirror the project's existing migration
workflow) produces an additive `ALTER TABLE sync_state ADD COLUMN claimed_until …`. No
backfill needed (nullable).

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly and matches schema (drizzle generate produces no further diff)
- Migration applies cleanly to local Supabase
- Type checking passes: `npm run build` (or project typecheck)
- Linting passes: `npm run lint`

#### Manual Verification:

- `claimed_until` column present on `sync_state` in local DB; existing rows have NULL

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: GitHub client fetch methods

### Overview

Add commit/PR/PR-detail/review fetch to `github.ts`, each mirroring the fixed client
pattern (typed errors, injectable `baseUrl`+`fetchImpl` seam, capped + cross-origin-
checked pagination via `Link: rel="next"`).

### Changes Required:

#### 1. Commit / PR / review fetch methods

**File**: `src/lib/github.ts`

**Intent**: Add the read methods the sync consumes, reusing `githubGet` and the existing
capped/origin-checked pagination helper so token-leak and pagination-cap guarantees carry
over by construction.

**Contract**: New methods —
- `listCommits(repo, since)` → `GET /repos/{repo}/commits?since=` → sha, author, authoredAt, branch. **Do NOT fetch per-commit line counts**: the commits *list* endpoint omits `stats.additions/deletions` (they require a per-commit `GET /repos/{repo}/commits/{sha}`, which would multiply subrequests beyond even PRs). `githubCommit.additions/deletions` are nullable (`schema.ts:432-433`) and no anomaly rule uses per-commit size (`PR_TOO_BIG` measures per-PR), so leave them NULL in MVP.
- `listPullRequests(repo, since)` → `GET /repos/{repo}/pulls?state=all&sort=updated&direction=desc`, paginated until `updated_at < since`.
- `getPullRequestDetail(repo, prNumber)` → `GET /repos/{repo}/pulls/{n}` → `additions`/`deletions`/`changed_files` (list endpoint omits these).
- `listReviews(repo, prNumber)` → `GET /repos/{repo}/pulls/{n}/reviews` → state (`APPROVED|CHANGES_REQUESTED|COMMENTED`), submittedAt.

All use `githubGet`, the injectable seam, and `MAX_*_PAGES` cap. Verify exact field names
against live GitHub docs during implementation. Errors: 401 → `GithubAuthError`,
403/429/5xx/network → `GithubUnavailableError` (post-validation treats 401 as an
availability blip, per existing convention).

### Success Criteria:

#### Automated Verification:

- Unit tests for each new method (mocked `fetchImpl`) cover: happy path, pagination cap, cross-origin next-link rejection, 401→Auth, 5xx→Unavailable
- Type checking passes
- Linting passes

#### Manual Verification:

- Against a real repo, each method returns expected shape; pagination stops at the cap; no token appears in any error `cause`/log

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Jira client fetch methods (enhanced search + changelog delta)

### Overview

Add active-sprint ticket + status-history fetch to `jira.ts` using the **non-deprecated**
`/rest/api/3/search/jql` enhanced-search endpoint with **token pagination**, plus story-
point custom-field resolution.

### Changes Required:

#### 1. Sprint-issue + changelog fetch

**File**: `src/lib/jira.ts`

**Intent**: Fetch active-sprint issues with their status-change history for the monitored
project, incrementally, driving the delta off `syncState.jiraHistoryCursor`.

**Contract**: New method(s) —
- `searchSprintIssues({ projectKey, sprintId, cursor, storyPointFieldId })` → `GET /rest/api/3/search/jql?jql=…&fields=…&expand=changelog&nextPageToken=…`.
- Pagination adapted to **token** (`nextPageToken`) rather than the existing `startAt`/`isLast` PageBean loop; keep the origin-check (reject a next-page URL whose origin ≠ effective base) and a page cap.
- Map to write columns: `jiraTicket` (`storyPoints` from the resolved custom field, `currentCategory` via existing status→category mapping, `addedAfterSprintStart`, `lastStatusChangeAt`), `jiraStatusHistory` (`jiraChangelogId` NOT NULL — the delta dedup key).
- Errors: 401 → `JiraAuthError`, 403/429/5xx/network → `JiraUnavailableError`; effective `baseUrl` computed once (F2 rule, `jira.ts:8-16`).

#### 2. Story-point custom-field resolution

**File**: `src/lib/jira.ts`

**Intent**: Resolve the site-specific `customfield_*` id for story points rather than
hard-coding it.

**Contract**: A discovery method (e.g. `GET /rest/api/3/field`, filter by well-known
story-point field name/schema) returning the field id; the sync passes it into
`searchSprintIssues`. Where the field id belongs (fetched per-sync vs stored on
`jiraProject`) is decided in implementation — default: resolve at sync start, no schema
change.

### Success Criteria:

#### Automated Verification:

- Unit tests (mocked `fetchImpl`): token pagination across ≥2 pages, cap enforced, cross-origin next-page rejection, changelog `expand` parsed into `jiraStatusHistory`, 401→Auth, 5xx→Unavailable
- Unit test: story-point field resolution picks the correct `customfield_*`
- Type checking passes
- Linting passes

#### Manual Verification:

- Against a real Jira project, active-sprint issues + changelog return correctly; second call with a cursor pulls only the delta

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Sync store layer (ingestion, upsert, lease, freshness)

### Overview

Pure, injectable `{ db, ownerId, env }` sync modules that orchestrate per-owner sync:
acquire the lease, fetch per unit (repo / Jira delta), parse PR↔ticket links at ingestion,
upsert in short per-unit transactions, and stamp per-integration `syncState` from actual
completion time. No request globals — callable from both `scheduled()` and a Server Action.

### Changes Required:

#### 1. PR↔ticket link parser

**File**: `src/lib/integrations/sync/link-ticket.ts` (new)

**Intent**: Pure helper that extracts a monitored-project Jira key from a PR's
branch/title/body so `linkedTicketKey` is set at ingestion (S-06 needs correlated rows,
no detection-time join).

**Contract**: `linkTicketKey(pr, projectKey): string | null` matching `[A-Z][A-Z0-9]+-\d+`
scoped to the monitored `jiraProject.projectKey`; returns the first match or null. Pure,
no I/O — unit-testable in isolation (mirrors `suggestCategory`).

#### 2. Owner sync orchestration + lease

**File**: `src/lib/integrations/sync/run-sync.ts` (new)

**Intent**: Orchestrate one owner's sync: acquire lease, load credentials, iterate
monitored repos and the Jira delta, upsert per unit, release/refresh `syncState`.

**Contract**: Exports e.g. `syncOwner({ db, ownerId, env }): Promise<SyncResult>`.
- **Lease (per integration)**: each integration unit begins with a short txn stamping `lastAttemptAt` + `claimedUntil = now + LEASE_TTL` on *its own* `syncState` row (GITHUB / JIRA); the Phase 5 loop skips a `(owner, integration)` whose lease is still fresh. GitHub and Jira lease and skip independently — a slow Jira sync doesn't block GitHub.
- **GitHub unit** (per repo): `listCommits`/`listPullRequests` (since cursor) → per-PR `getPullRequestDetail` + `listReviews` under the per-cycle PR cap → parse `linkedTicketKey` → **one short `db.transaction`** upserting `githubCommit`/`githubPullRequest`/`githubReview` with `onConflictDoUpdate`.
- **Jira unit**: resolve story-point field → `searchSprintIssues` (delta via `jiraHistoryCursor`) → short txn upserting `jiraTicket`/`jiraStatusHistory` → advance `jiraHistoryCursor`.
- **Per-integration status**: on success stamp `status=OK` + `lastSuccessfulSyncAt=new Date()`; on `*AuthError`/`*UnavailableError` stamp `ERROR`/`RATE_LIMITED` + `lastError`, **without** touching the other integration's row.
- Owner isolation: all queries scoped by `ownerId` (mirror `onboarding.ts:28-78`).
- No `fetch` inside any transaction; all fetch precedes each txn.

#### 3. Pool handle for teardown

**File**: `src/lib/db.ts`

**Intent**: Provide a `getDb` variant that exposes the `pool` so the scheduled/on-demand
caller can close it after use.

**Contract**: Add e.g. `getDbWithPool(env): { db, pool }` (keep existing `getDb` for the
request path). Sync callers use the pool handle for `ctx.waitUntil(pool.end())`.

### Success Criteria:

#### Automated Verification:

- Unit test: `linkTicketKey` — matches project-scoped key in branch/title/body, ignores foreign project keys, returns null when absent
- Unit tests: `syncOwner` with mocked clients — GitHub-only success, Jira-only success, GitHub-fails-Jira-succeeds (independent per-integration status), cursor advance, PR cap respected
- Unit test: a fresh lease causes a second concurrent `syncOwner` entry to no-op/skip
- Type checking passes
- Linting passes

#### Manual Verification:

- Running `syncOwner` for a real owner populates all five synced tables; `linkedTicketKey` set where a PR references a monitored-project key; `syncState` rows show OK + fresh timestamps per integration

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Cron + on-demand wiring

### Overview

Expose the store layer through two entry points: a `scheduled()` cron handler (capped
global loop over all owners with pool teardown) and a `syncNow` Server Action (single
owner, first sync after setup). Wire `wrangler.jsonc` crons and the custom OpenNext worker
entry.

### Changes Required:

#### 1. Custom OpenNext worker entry with `scheduled()`

**File**: `src/worker.ts` (new custom entry) + `wrangler.jsonc`

**Intent**: Add a cron handler alongside OpenNext's generated `fetch` handler per the
documented custom-entry pattern, and register the 15-min trigger.

**Contract**: Custom worker entry that re-exports the generated OpenNext `fetch` handler
(and its required DO exports) and adds `async scheduled(controller, env, ctx)`. Point
`wrangler.jsonc` `main` at the custom entry; add `"triggers": { "crons": ["*/15 * * * *"] }`.
Verify the exact wrapping/import against `@opennextjs/cloudflare` worker.ts template during
implementation (build must still produce a working `fetch` path). Confirm cron works under
`initOpenNextCloudflareForDev()` locally or document the deployed-only verification path.

#### 2. Capped global loop

**File**: `src/lib/integrations/sync/scheduled.ts` (new) — called by `scheduled()`

**Intent**: Iterate owners with completed setup and sync each within one invocation's
budget, guarded by the lease, then tear the pool down.

**Contract**: `runScheduledSync(env, ctx)`:
- `getDbWithPool(env)`; enumerate onboarded owners with a **single set-based query**, not the per-owner `isOnboardingComplete` predicate. `isOnboardingComplete` (`onboarding.ts:28`) runs 6 sequential queries per owner and returns a boolean — calling it for every user would be N×6 queries that burn the shared invocation budget before any sync runs. Instead select distinct owners that have the minimal sync prerequisites (a `jiraProject` + a `githubCredential`; a cheap proxy for onboarded) in one query. The per-owner predicate stays reserved for the on-demand path / guard, not loop enumeration.
- For each owner call `syncOwner({ db, ownerId, env })`, which internally skips a `(owner, integration)` when EITHER (a) its lease is still fresh (per-integration guard, F3) OR (b) it is **not yet due** — `lastSuccessfulSyncAt` is newer than `now - freshnessWindowMinutes` for that row (FR-011 configurability, F5). The scheduled loop honors the per-owner `freshnessWindowMinutes` this way (an owner on a 30-min window is skipped on every other 15-min fire). **Known limitation**: because the cron interval is a global `*/15`, a `freshnessWindowMinutes` **below 15 is effectively floored at ~15 min** — sub-cron-interval freshness is out of scope for MVP (would need a shorter cron or fan-out). The on-demand `syncNow` path ignores the due-check (an explicit user request always syncs).
- Enforce a hard **per-cycle owner/scan cap** so the shared 10k-subrequest budget isn't exhausted; remaining owners/backlog drain next cycle (cursor-driven).
- Wrap per-owner work so one owner's throw doesn't abort the loop (catch, record `ERROR`, continue).
- After the loop, `ctx.waitUntil(pool.end())`.

#### 3. On-demand `syncNow` Server Action

**File**: `src/lib/integrations/sync/actions.ts` (new), mirroring the existing
`src/app/(app)/setup/*/actions.ts` Server Action convention (route group `(app)`)

**Intent**: Let the just-finished-setup UI (and a future "sync now" button) trigger the
current owner's sync immediately, reusing the store layer.

**Contract**: `"use server"` action: `requireSession` → resolve `ownerId` →
`getDbWithPool(getCloudflareContext().env)` → `syncOwner(...)` (bypassing the due-check —
an explicit request always syncs) → close the pool (`ctx.waitUntil` via
`getCloudflareContext().ctx`, or `await pool.end()` if no ctx on the action path). Returns a
minimal result the caller can surface (per-integration OK/ERROR + `lastSuccessfulSyncAt`).
Follows the `src/app/(app)/setup/*/actions.ts` convention.

### Success Criteria:

#### Automated Verification:

- Build succeeds with the custom worker entry (`npm run build`) and the generated `fetch` path is preserved
- `wrangler.jsonc` contains `triggers.crons` `*/15 * * * *` and `main` points at the custom entry
- Unit test: `runScheduledSync` iterates owners, skips fresh-lease owners, continues past a per-owner throw, and schedules pool teardown
- Type checking passes
- Linting passes

#### Manual Verification:

- After completing setup with real credentials, invoking `syncNow` populates the synced tables and `syncState` for the owner within one action call (S-07 would have data)
- Scheduled path (local dev cron or deployed) runs the loop and stamps `lastSuccessfulSyncAt`; a second immediate fire skips the still-leased owner
- No pooled connection is left open after a run (no connection-exhaustion under repeated fires)

**Implementation Note**: Final phase — confirm the full cron + on-demand flow before marking the change done.

---

## Testing Strategy

### Unit Tests:

- Client methods (`github.ts`, `jira.ts`) with mocked `fetchImpl`: happy path, pagination
  cap, cross-origin next-link/next-page rejection, 401→Auth, 403/429/5xx/network→Unavailable,
  changelog-expand parsing, token pagination, story-point field resolution.
- `linkTicketKey`: project-scoped match across branch/title/body; foreign-key rejection; null.
- `syncOwner`: per-integration independence (GitHub fails, Jira still OK), cursor advance,
  PR cap, lease skip.
- `runScheduledSync`: owner iteration, fresh-lease skip, per-owner error isolation, pool
  teardown scheduled.

### Integration Tests:

- End-to-end `syncNow` against mocked GitHub + Jira servers (injectable `baseUrl`) writing
  to a local DB, asserting the five synced tables + `syncState` rows and `linkedTicketKey`.
  Follow the repo convention: `*.integration.test.ts` run via `vitest.integration.config.ts`
  (`npm run test:integration`); pure unit tests are `*.test.ts` via `npm run test`.

### Manual Testing Steps:

1. Connect real GitHub + Jira credentials, complete setup, trigger `syncNow`; verify all
   five tables populate and `syncState` shows OK + fresh per-integration timestamps.
2. Open a PR that references a monitored-project Jira key; re-sync; verify `linkedTicketKey`
   is set.
3. Simulate a Jira outage (bad token); verify Jira `syncState` → ERROR while GitHub stays OK.
4. Fire the scheduled path twice in quick succession; verify the second skips the leased owner.

## Performance Considerations

- **Subrequest budget** (Workers 10k/invocation): PR count is the dominant multiplier
  (per-PR detail + reviews). The per-cycle scan cap + cursor keep a single invocation
  bounded and let backlogs drain across cycles.
- **Connection pinning**: fetch strictly precedes each short transaction so the single
  Hyperdrive-backed connection is never held during network I/O.
- **Capped global loop is budget-shared** across owners — acceptable at MVP scale; revisit
  fan-out (Queues/self-fetch) when owner count grows.

## Migration Notes

- Single additive, nullable column (`sync_state.claimed_until`); no backfill, no data
  migration. Existing `syncState` rows keep NULL and are immediately eligible for sync.

## References

- Frame brief: `context/changes/data-sync-engine/frame.md`
- Research: `context/changes/data-sync-engine/research.md`
- Jira enhanced search endpoint: context7 `/websites/developer_atlassian_cloud_jira_platform_rest_v3` — `GET /rest/api/3/search/jql` (token pagination; `GET /search` deprecated)
- OpenNext scheduled handler: context7 `/opennextjs/opennextjs-cloudflare` — custom worker.ts entry adding `scheduled` to `export default`
- Client pattern to mirror: `src/lib/github.ts:34-52,95-111,164-242`, `src/lib/jira.ts:8-16,177-190,243-322`
- Store/write convention: `src/lib/integrations/jira-store.ts:100-117,172-240`, `github-store.ts:128-140`, `roster-store.ts:183`
- Owner-isolation query pattern: `src/lib/onboarding.ts:28-78`
- Schema: `src/db/schema.ts:349-378` (syncState), `:419-575` (synced tables), `:65-79` (enums)
- Pool: `src/lib/db.ts:4-12`
- Lessons: `context/foundation/lessons.md` #1 (NOT NULL dedup), #3 (pool teardown), #4 (capped+origin-checked pagination)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — claim/lease overlap guard

#### Automated

- [x] 1.1 Migration generates cleanly and matches schema — 77bd291
- [x] 1.2 Migration applies cleanly to local Supabase — 77bd291
- [x] 1.3 Type checking passes — 77bd291
- [x] 1.4 Linting passes — 77bd291

#### Manual

- [x] 1.5 `claimed_until` column present on `sync_state`; existing rows NULL — 77bd291

### Phase 2: GitHub client fetch methods

#### Automated

- [x] 2.1 Unit tests per new method (happy/cap/origin/401/5xx)
- [x] 2.2 Type checking passes
- [x] 2.3 Linting passes

#### Manual

- [ ] 2.4 Real-repo shape correct; cap holds; no token in error/log

### Phase 3: Jira client fetch methods

#### Automated

- [ ] 3.1 Unit tests: token pagination, cap, origin rejection, changelog expand, 401/5xx
- [ ] 3.2 Unit test: story-point field resolution
- [ ] 3.3 Type checking passes
- [ ] 3.4 Linting passes

#### Manual

- [ ] 3.5 Real Jira project: issues + changelog correct; cursor pulls only delta

### Phase 4: Sync store layer

#### Automated

- [ ] 4.1 Unit test: `linkTicketKey` project-scoped match / foreign reject / null
- [ ] 4.2 Unit tests: `syncOwner` per-integration independence, cursor advance, PR cap
- [ ] 4.3 Unit test: fresh lease causes concurrent entry to skip
- [ ] 4.4 Type checking passes
- [ ] 4.5 Linting passes

#### Manual

- [ ] 4.6 Real owner: five tables populate; `linkedTicketKey` set; per-integration OK + fresh timestamps

### Phase 5: Cron + on-demand wiring

#### Automated

- [ ] 5.1 Build succeeds with custom worker entry; `fetch` path preserved
- [ ] 5.2 `wrangler.jsonc` has `triggers.crons */15` and `main` → custom entry
- [ ] 5.3 Unit test: `runScheduledSync` iterates, skips fresh lease, isolates per-owner throw, schedules teardown
- [ ] 5.4 Type checking passes
- [ ] 5.5 Linting passes

#### Manual

- [ ] 5.6 Post-setup `syncNow` populates tables + `syncState` in one call
- [ ] 5.7 Scheduled path stamps `lastSuccessfulSyncAt`; second fire skips leased owner
- [ ] 5.8 No pooled connection left open after repeated fires
