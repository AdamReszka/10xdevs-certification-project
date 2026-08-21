# Anomaly Detection Engine (S-06) Implementation Plan

## Overview

Build the anomaly detection engine: a standalone `src/lib/anomaly/` module that runs
after each owner sync, correlates the already-synced Jira + GitHub data, and detects
all 8 anomaly types (`PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`,
`TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`,
`PR_TICKET_DESYNC`) against configurable thresholds that ship with FR-009 defaults.
Each detected anomaly carries all five FR-014 attributes (severity, description,
context, one-line suggested action, source deep-link) plus a severity-weighted
sprint-risk score. Anomalies are persisted idempotently (upsert by a stable
`dedup_key`, with an ACTIVE/RESOLVED lifecycle so `detectedAt` — the FR-015 recency
signal — stays stable across 15-minute re-runs). A default-ordered reader
(`listAnomaliesForSprint`, severity → recency) exposes the inbox data for S-07/S-11.

## Current State Analysis

S-05 (data-sync-engine) landed all the correlated inputs this engine consumes; F-02
landed the output tables. Concretely, already in place:

- **PR↔ticket correlation is a stored column.** `github_pull_request.linked_ticket_key`
  is populated at ingestion by `src/lib/integrations/sync/link-ticket.ts`
  (`linkTicketKey` parses `{PROJECTKEY}-{n}` from a PR's branch/title/body, project-scoped
  and case-insensitive). No detection-time join is needed.
- **FR-009 defaults exist as a typed constant.** `src/db/defaults.ts` →
  `DEFAULT_THRESHOLDS: Record<AnomalyTypeValue, { severity, thresholds }>` is exhaustive
  over the 8-value enum at compile time and already encodes every threshold in FR-009
  (per-SP In-Progress budgets, review/code-review/testing timeouts, max-parallel limits,
  PR size, scope-creep %, no-commit days, ToDo lead time).
- **Output tables are defined by F-02.** `anomaly` (type, severity, description, context
  jsonb, suggestedAction, sourceUrl, riskScore, relatedTeamMemberId `ON DELETE SET NULL`,
  detectedAt, status `ACTIVE`/`RESOLVED`, sprintId `NOT NULL`) and `anomaly_settings`
  (per-account `severityOverride` + `thresholds` jsonb, `UNIQUE(owner_id, anomaly_type)`).
  The `anomaly` table currently has **no** unique/dedup constraint and **no** writer — S-06
  is its first writer, so it is empty.
- **Synced data shapes** (`src/db/schema.ts`):
  - `github_pull_request`: `state` (OPEN/CLOSED/MERGED), `additions`/`deletions`/`changedFiles`
    (populated from PR detail), `openedAt`, `mergedAt`, `readyForReviewAt` (= openedAt for
    non-draft, null for draft), `authorGithubUsername`, `linkedTicketKey`, `sourceUrl`.
  - `github_review`: `state`, `submittedAt`, `reviewerGithubUsername`, FK → PR.
  - `github_commit`: `sha`, `authorGithubUsername`, `authoredAt`, `message`. **`branch`,
    `additions`, `deletions` are NULL by design** (`GithubCommitData` documents this — the
    commits-list endpoint carries no per-commit branch/stats). Commit→ticket correlation
    must therefore use `message`, not `branch`.
  - `jira_ticket`: `currentCategory` (5-category enum), `storyPoints`, `lastStatusChangeAt`,
    `assigneeJiraAccountId`, `addedAfterSprintStart`, `sourceUrl`, `sprintId`.
  - `jira_status_history`: append-only `fromCategory`/`toCategory`/`changedAt` per ticket.
  - `sprint`: `state`, `startDate`, `endDate`, `committedSp`, `completedSp`, `workingDays`.
  - `team_member`: `githubUsername`, `jiraAccountId`, `technologyTrack`, `isActive` — the
    join key between GitHub author and Jira assignee.
- **Entry points.** `syncOwner({db, ownerId, env, now})` (`sync/run-sync.ts`) is called by
  the cron loop `runScheduledSync` (`sync/scheduled.ts`) and by the on-demand `syncNow`
  Server Action (`sync/actions.ts`). Both are the sites where detection must be triggered
  after the sync completes.
- **Conventions.** Pure, injectable `{ db, ownerId, now }` functions with clock injection;
  short per-unit transactions with network I/O kept outside them; idempotent
  `onConflictDoNothing`/`onConflictDoUpdate` on `NOT NULL` dedup keys; unit tests via
  `vitest run`, real-DB integration via `vitest run --config vitest.integration.config.ts`;
  optional `stryker run` mutation testing.

### Key Discoveries:

- `src/lib/integrations/sync/link-ticket.ts:32` — `linkTicketKey(pr, projectKey)` is the
  reusable extractor; generalize its regex core to also scan a commit `message`.
- `src/db/defaults.ts:41` — `DEFAULT_THRESHOLDS` is the fallback the engine reads directly;
  `anomaly_settings` rows are written only when a user overrides (S-14), so the effective
  config is a **merge** (`stored override ?? default`), not a plain table read.
- `src/db/schema.ts:584` — the `anomaly` table lacks a dedup constraint; `lessons.md` rule
  #1 (nullable column in a UNIQUE dedup key defeats dedup) forces a `dedup_key text NOT NULL`
  column + `UNIQUE(owner_id, sprint_id, dedup_key)` for the idempotent upsert path.
- `src/lib/integrations/sync/run-sync.ts:552` — `syncOwner` returns per-integration
  `IntegrationOutcome`; detection runs regardless of that outcome (best-available cached data).
- `src/db/schema.ts:326` — `sprint.state` `ACTIVE`; detection targets the active sprint via
  the same "prefer ACTIVE, else most-recently-started" selection `syncJira` uses
  (`run-sync.ts:408`).

## Desired End State

After this plan, for any onboarded owner with synced data and an active sprint, a sync
cycle (cron or on-demand) produces up-to-date rows in the `anomaly` table reflecting the
current correlated state: newly-true conditions inserted (ACTIVE, `detectedAt` = first
sight), still-true conditions left untouched (stable `detectedAt`), and no-longer-true
conditions flipped to RESOLVED. Every ACTIVE anomaly has all five FR-014 attributes and a
0–100 risk score. `listAnomaliesForSprint(ownerId, sprintId)` returns the ACTIVE inbox in
FR-015 default order (severity high→medium→low, then `detectedAt` desc). Verified by: a
green unit suite (positive + negative per rule), a passing mutation run on the detectors,
and an integration test that seeds a sprint fixture, runs detection twice, and asserts the
insert/no-op/resolve/reactivate lifecycle against a real Postgres.

## What We're NOT Doing

- **No inbox UI, panels, or error banner** — that is S-07. This slice ships the engine +
  a data reader only.
- **No interactive re-sort / filter** (by age/ticket/member/type) — S-07. S-06 ships only
  the FR-015 *default* ordering.
- **No absence suppression / absence-weighting** — S-08. This slice ships with absence =
  empty: `DEVELOPER_INACTIVE` fires without absence suppression, and `SPRINT_AT_RISK`
  carries no absence factor yet. S-08 wires those on top (the detectors take an absence
  input that is an empty list here).
- **No settings-page UI** to edit thresholds/severity — S-14. S-06 reads
  `DEFAULT_THRESHOLDS` and honors any `anomaly_settings` override rows if present, but does
  not create the editing surface.
- **No daily-recap email** — S-11 (it will reuse `listAnomaliesForSprint` and the stored
  `suggestedAction`).
- **No AI** anywhere in detection — suggested actions are deterministic templates (PRD:
  AI is confined to the Refinement Helper).
- **No per-commit size/branch backfill** — the NULL commit `branch`/`additions` columns
  stay NULL; no rule depends on them.

## Implementation Approach

A new `src/lib/anomaly/` module, mirroring the `src/lib/integrations/sync/` shape:

- **Pure detectors.** Each of the 8 rules is a pure function
  `detectX(snapshot, effectiveThresholds, now): DetectedAnomaly[]` over an in-memory
  `SprintSnapshot` (no DB, no I/O) — trivially unit- and mutation-testable. Each returns
  the full attribute set: `type`, default `severity`, `dedupKey`, `description`,
  `suggestedAction`, `context`, `sourceUrl`, `relatedTeamMemberId`, and a normalized
  `magnitude ∈ [0,1]`.
- **Central scoring + severity resolution.** The orchestrator applies the effective
  severity (override ?? rule default) and computes `riskScore` from
  `severityWeight × magnitude`.
- **A data loader** builds the `SprintSnapshot` from the DB for the active sprint (the
  correlated read), tolerating stale/partial data (best-available cache).
- **A reconcile step** diffs the freshly-detected set against the stored ACTIVE rows by
  `dedup_key` and performs insert / no-op / resolve via idempotent upsert.
- **Two-line wiring** into `runScheduledSync` (per owner, after `syncOwner`) and `syncNow`
  (after `syncOwner`), each calling `detectAnomalies({ db, ownerId, now })`.
- **A reader** returns the default-ordered ACTIVE inbox.

## Critical Implementation Details

- **`detectedAt` stability is the whole point of the lifecycle.** Reconcile must NOT
  delete-and-reinsert ACTIVE rows; it must upsert by `dedup_key` and set `detectedAt` only
  on first insert (`onConflictDoUpdate` must leave `detectedAt` and `id` untouched for an
  already-ACTIVE row). A RESOLVED row whose condition recurs is reactivated with a **new**
  `detectedAt` (the anomaly genuinely restarted). Getting this wrong silently breaks FR-015
  recency ordering and S-11/S-12 anomaly-id references.
- **`dedup_key` must be `NOT NULL` and deterministic** (`lessons.md` #1). Shape per rule,
  e.g. `PR_REVIEW_STALLED:pr:<githubPrId>`, `TICKET_STATUS_AGING:ticket:<jiraKey>`,
  `SPRINT_AT_RISK:parallel:<memberId>:<category>`, `SCOPE_CREEP:sprint:<sprintId>`. The
  key is scoped by `(owner_id, sprint_id)` via the unique index, so it need not embed the
  owner.
- **`SPRINT_AT_RISK` stays team/sprint-level, never per-developer performance framing**
  (PRD guardrail). The per-condition choice means a max-parallel condition produces one
  anomaly per (member, category), but its `description` is flow-phrased ("3 tickets held in
  parallel in Code Review"), and `relatedTeamMemberId` exists only to target the suggested
  action ("rebalance / pair up"), never to rank or evaluate the person.
- **PRs are repo-scoped, not sprint-scoped — the active sprint is the detection
  context.** `github_pull_request` has no sprint column (PRs relate to repos), yet
  `anomaly.sprint_id` is `NOT NULL`. PR-only rules (`PR_REVIEW_STALLED`, `PR_TOO_BIG`)
  fire on PRs that may have no linked ticket. Resolution: the loader pulls PRs by the
  owner's monitored repos (not by any sprint join), and the orchestrator stamps **every**
  anomaly it emits this cycle — including ticket-less PR anomalies — with the active
  sprint's id. The inbox is inherently sprint-scoped, so attributing a PR anomaly to the
  current sprint window is the correct semantic. Across a sprint rollover the PR anomaly
  simply RESOLVES under the old sprint and re-inserts under the new one.
- **Detection runs on best-available cached data.** It is triggered after `syncOwner`
  regardless of the returned `IntegrationOutcome`; a sync ERROR/RATE_LIMITED for this cycle
  means detection simply runs over the last successfully-cached rows. Detection is skipped
  only when the owner has no active/most-recent sprint (nothing to detect against).

## Phase 1: Foundations — schema, thresholds, shared correlation & types

### Overview

Land the dedup constraint the upsert needs, the effective-threshold resolver, the
generalized ticket-key extractor, and the shared types every later phase imports.

### Changes Required:

#### 1. Anomaly dedup key (migration + schema)

**File**: `src/db/schema.ts`, `src/db/migrations/0004_*.sql` (generated)

**Intent**: Give `anomaly` the `NOT NULL` dedup key + unique index the idempotent upsert
relies on, per `lessons.md` #1. The table is empty, so the `NOT NULL` add needs no backfill.

**Contract**: Add `dedupKey: text("dedup_key").notNull()` to the `anomaly` table and a
`unique("anomaly_owner_sprint_dedup_uq").on(ownerId, sprintId, dedupKey)`. Generate the
migration with `npm run db:generate` (produces `0004_*.sql`); do not hand-edit the journal.

#### 2. Effective-threshold resolver

**File**: `src/lib/anomaly/thresholds.ts`

**Intent**: Resolve the effective per-rule config for an owner by layering any stored
`anomaly_settings` override on top of the `DEFAULT_THRESHOLDS` constant, so detectors read
one merged config and un-overridden rules need no DB rows.

**Contract**: `resolveEffectiveThresholds(db, ownerId): Promise<Record<AnomalyType, { severity, thresholds }>>`
— reads `anomaly_settings` for the owner, and for each of the 8 types returns
`severity = row.severityOverride ?? DEFAULT_THRESHOLDS[type].severity` and
`thresholds = { ...DEFAULT_THRESHOLDS[type].thresholds, ...(row.thresholds ?? {}) }`.
Also update the stale comment in `src/db/defaults.ts` ("S-06 … write the per-account
default rows") to reflect the fallback-merge decision (no seeding).

#### 3. Generalized ticket-key extraction

**File**: `src/lib/integrations/sync/link-ticket.ts` (extend) or `src/lib/anomaly/correlate.ts`

**Intent**: Reuse the existing project-scoped `{PROJECTKEY}-{n}` regex to extract ticket
keys from a commit `message`, so `TICKET_NO_COMMIT_LINK` can correlate commits→tickets
without a branch label.

**Contract**: Export `extractTicketKey(text: string | null, projectKey: string): string | null`
(the current `linkTicketKey` body, factored to accept a single string) and keep
`linkTicketKey` delegating to it over branch/title/body. Same canonicalization (uppercase
project key). No behavior change to existing PR linking.

#### 4. Shared types

**File**: `src/lib/anomaly/types.ts`

**Intent**: Define the in-memory contract the loader produces and the detectors consume/emit.

**Contract**: `SprintSnapshot` (sprint row; `tickets: JiraTicket[]`; `pullRequests`
with their `reviews`; `commits`; `teamMembers`; `absences: []` placeholder for S-08 —
note: `jira_status_history` is deliberately NOT in the snapshot; no S-06 rule walks it
(all use `ticket.lastStatusChangeAt`/`currentCategory`), and it is S-10's aging-report
input) and `DetectedAnomaly` (`type`, `severity`,
`dedupKey`, `description`, `suggestedAction`, `context: Record<string, unknown>`,
`sourceUrl`, `relatedTeamMemberId: string | null`, `magnitude: number`).

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` (creates `0004_*.sql`, no drift)
- Migration applies to local Supabase: `npm run db:migrate`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test` (existing `link-ticket.test.ts` still green after refactor)

#### Manual Verification:

- `anomaly` table in local DB shows `dedup_key NOT NULL` + the unique index (`\d anomaly`).

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Detectors — 8 rules, risk-score, suggested-action templates

### Overview

Implement the 8 pure detectors, the risk-score formula, and the per-rule suggested-action
templates. This is the correctness core; test it hardest (positive + negative per rule +
mutation).

### Changes Required:

#### 1. Risk-score formula

**File**: `src/lib/anomaly/risk-score.ts`

**Intent**: Turn (severity, magnitude) into the FR-015 0–100 severity-weighted score,
displayed-but-non-driving (it does not change the default sort).

**Contract**: `riskScore(severity, magnitude): number` where
`weight = { HIGH: 3, MEDIUM: 2, LOW: 1 }[severity]` and
`score = clamp(round(weight * magnitude * (100/3)), 0, 100)` — a full-magnitude HIGH → 100,
MEDIUM → 67, LOW → 33. `magnitude ∈ [0,1]` is each detector's "how far past threshold,
capped" factor. **Binary conditions** with no "distance past threshold" to scale (e.g.
`PR_TICKET_DESYNC` — a PR is either desynced from its ticket or not) emit `magnitude = 1`
(full magnitude at their severity tier). Conditions with a natural gradient keep a scaled
magnitude (e.g. ToDo-near-end scales by remaining ToDo SP share).

#### 2. Suggested-action templates

**File**: `src/lib/anomaly/suggested-action.ts` (or co-located per rule)

**Intent**: One deterministic template per rule, interpolating the anomaly's own context so
the line is grounded (FR-014), reused verbatim by S-11's email.

**Contract**: A `Record<AnomalyType, (ctx) => string>` producing lines like
`Ping {reviewer} — PR #{number} has waited {hours}h for review` /
`Check in on {ticketKey} — In Progress {days}d with no linked commit`. Pure string builders.

#### 3. The 8 detectors

**File**: `src/lib/anomaly/rules/*.ts` (one file per rule) + `src/lib/anomaly/rules/index.ts`

**Intent**: Each pure function detects its rule over the snapshot using the effective
thresholds and injected `now`, returning zero or more `DetectedAnomaly`. Correlation logic
per rule below.

**Contract** (per rule — `detect(snapshot, thresholds, now): DetectedAnomaly[]`):

- **`PR_REVIEW_STALLED`** — OPEN, non-draft PRs whose `readyForReviewAt` is older than
  `hours` (24) with no `github_review` submitted since ready. `magnitude = min(1, ageHours / (2*threshold))`.
  `dedupKey = PR_REVIEW_STALLED:pr:<githubPrId>`. `sourceUrl` = PR url; related member = PR author.
- **`TICKET_STATUS_AGING`** — tickets whose time since `lastStatusChangeAt` exceeds the
  category budget: In-Progress → `inProgressHoursBySp[storyPoints]` (resolve the
  `"8_WORKING_DAYS"` sentinel against `sprint.workingDays`); Code Review → `codeReviewHours`
  (24); Testing → `testingHours` (48). `dedupKey = TICKET_STATUS_AGING:ticket:<jiraKey>`.
- **`DEVELOPER_INACTIVE`** — team members (matched by `githubUsername`) who have ≥1 assigned
  In-Progress ticket (via `jiraAccountId` ↔ `assigneeJiraAccountId`) but zero commits in the
  last `noCommitDays` (2). Absence input is empty this slice (no suppression).
  `dedupKey = DEVELOPER_INACTIVE:member:<memberId>`. Framing stays flow-corrective.
- **`TICKET_NO_COMMIT_LINK`** — In-Progress tickets with no commit whose `message` references
  the ticket key (via `extractTicketKey`) within `noCommitDays` (2).
  `dedupKey = TICKET_NO_COMMIT_LINK:ticket:<jiraKey>`.
- **`SPRINT_AT_RISK`** (per condition):
  - max-parallel: per member per category, count assigned tickets in
    IN_PROGRESS/CODE_REVIEW/TESTING; emit one anomaly per (member, category) exceeding
    `maxParallelByCategory[category]`. `magnitude = min(1, (count - limit) / limit)`.
    `dedupKey = SPRINT_AT_RISK:parallel:<memberId>:<category>`.
  - ToDo-before-end: if `sprint.endDate - now ≤ toDoBeforeSprintEndLeadTimeHours` (48) and
    tickets remain in TODO, emit one anomaly. `magnitude` from remaining ToDo SP share.
    `dedupKey = SPRINT_AT_RISK:todo_near_end:<sprintId>`.
- **`PR_TOO_BIG`** — PRs (OPEN or recently MERGED) with `additions + deletions > maxLines`
  (500). `magnitude = min(1, (lines - maxLines) / maxLines)`.
  `dedupKey = PR_TOO_BIG:pr:<githubPrId>`.
- **`SCOPE_CREEP`** — sum `storyPoints` of tickets with `addedAfterSprintStart = true`
  divided by `sprint.committedSp`; fire when `> percent` (20%). One anomaly per sprint.
  `dedupKey = SCOPE_CREEP:sprint:<sprintId>`.
- **`PR_TICKET_DESYNC`** — PRs with `state = MERGED` and a `linkedTicketKey` whose ticket's
  `currentCategory` is not `DONE`. Binary condition → `magnitude = 1`.
  `dedupKey = PR_TICKET_DESYNC:pr:<githubPrId>`.

#### 4. Stryker mutation config

**File**: `stryker.conf.json` (new)

**Intent**: The `test:mutation` script (`stryker run`) and `@stryker-mutator/*` deps are
installed but there is no config file — `stryker run` cannot pick a runner, scope its
mutants, or apply a threshold without one. Add the config so criterion 2.2 is runnable and
mutation is scoped to the correctness core (not the whole repo).

**Contract**: `stryker.conf.json` with `testRunner: "vitest"`, the `typescript-checker`
plugin, `mutate: ["src/lib/anomaly/rules/**/*.ts", "src/lib/anomaly/risk-score.ts"]`, and
a `thresholds` block (e.g. `high: 85, low: 70, break: 70`) so a weak-assertion regression
fails the run. Confirm `@stryker-mutator/vitest-runner` v9 is compatible with vitest v4 on
first run; if incompatible, pin/adjust before relying on 2.2.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` — for each of the 8 rules a **positive** case (fires with
  correct attributes) and a **negative** case (healthy data → no anomaly); risk-score and
  suggested-action builders unit-tested.
- Mutation testing on the detectors passes threshold: `npm run test:mutation` (scoped to
  `src/lib/anomaly/rules/**` + `risk-score.ts`)
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check one detector's output shape (all 5 FR-014 attributes present, `sourceUrl` is a
  real deep-link, suggested action reads as context-grounded not generic).

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Orchestration — loader, reconcile, wiring

### Overview

Load the sprint snapshot from the DB, run all detectors, reconcile the result into the
`anomaly` table (insert/no-op/resolve), and trigger detection from both sync entry points.

### Changes Required:

#### 1. Sprint-snapshot loader

**File**: `src/lib/anomaly/load-snapshot.ts`

**Intent**: Build the in-memory `SprintSnapshot` for an owner's active sprint from the
synced tables, tolerating stale data (best-available cache).

**Contract**: `loadSprintSnapshot(db, ownerId): Promise<SprintSnapshot | null>` — selects the
active sprint (prefer `state = ACTIVE`, else most-recent by `startDate`, matching
`syncJira`); returns `null` when none. Loads: that sprint's tickets; the owner's PRs
(+ reviews) **scoped by monitored repos, NOT by sprint** — PRs have no sprint FK, and the
PR-only rules apply to all monitored PRs (see Critical Implementation Details); recent
commits (authoredAt within the max no-commit window); and active team members. Returns
`absences: []`. The active sprint's id is carried on the snapshot so the orchestrator can
attribute every anomaly (including ticket-less PR anomalies) to it.

#### 2. Detect + reconcile orchestrator

**File**: `src/lib/anomaly/detect.ts`

**Intent**: The public engine entry: resolve thresholds, load snapshot, run all detectors,
apply effective severity + risk score, and reconcile against stored ACTIVE rows.

**Contract**: `detectAnomalies({ db, ownerId, now }): Promise<DetectResult>`. Steps:
(1) `loadSprintSnapshot`; if null, return `{ skipped: "no_sprint" }`. (2)
`resolveEffectiveThresholds`. (3) run the 8 detectors → `DetectedAnomaly[]`. (4) map each to
a row (apply effective `severity`, compute `riskScore`, set `sprintId = the active sprint's
id for ALL anomalies — including PR-only ones with no linked ticket, satisfying the NOT NULL
constraint`, `detectedAt = now` for new rows).
(5) in one transaction: upsert each by `(ownerId, sprintId, dedupKey)` —
`onConflictDoUpdate` refreshes mutable fields (severity, description, context, riskScore,
suggestedAction, status→ACTIVE) but **leaves `detectedAt` and `id` unchanged** on an
already-ACTIVE row, and sets a fresh `detectedAt` when reactivating a RESOLVED row; then set
`status = RESOLVED` for every ACTIVE row of this sprint whose `dedup_key` is absent from the
freshly-detected set. Return counts `{ inserted, updated, resolved }`.

#### 3. Wire into the two entry points

**File**: `src/lib/integrations/sync/scheduled.ts`, `src/lib/integrations/sync/actions.ts`

**Intent**: Run detection after each owner's sync, on best-available data, without letting a
detection failure abort the cron loop.

**Contract**: In `runScheduledSync`, after `await runOwner(...)`, call
`await detectAnomalies({ db, ownerId, now })` inside the same per-owner try (a throw counts
the owner as failed and continues; does not abort the batch). In `syncNow`, introduce a
single `const now = new Date()` for the cycle, pass it to `syncOwner({ …, now })`, and after
it call `detectAnomalies({ db, ownerId: session.user.id, now })` before pool teardown — one
clock shared by sync and detection. Detection reuses the same `db`/pool; teardown timing
(lesson #3) is unchanged (detection is awaited before the `finally` closes the pool).

### Success Criteria:

#### Automated Verification:

- Integration test passes: `npm run test:integration` — seed a sprint fixture producing ≥4
  anomaly types; run `detectAnomalies` twice; assert: first run inserts (correct count,
  ACTIVE, all attributes), second run with unchanged data is a no-op (same `id`s, same
  `detectedAt`), clearing a condition flips exactly that row to RESOLVED, re-introducing it
  reactivates with a new `detectedAt`.
- Existing sync integration tests still pass: `npm run test:integration`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Trigger `syncNow` in `next dev` against local seeded data; confirm `anomaly` rows appear
  with populated `risk_score`, `suggested_action`, `source_url`, and stable `detected_at`
  across a second trigger.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Reader + end-to-end verification

### Overview

Expose the default-ordered inbox reader (the S-06 data outcome S-07/S-11 consume) and verify
the full sync→detect→read path.

### Changes Required:

#### 1. Default-ordered inbox reader

**File**: `src/lib/anomaly/reader.ts`

**Intent**: Return an owner's ACTIVE anomalies for a sprint in FR-015 default order, with the
five attributes plus risk score. No interactive sort/filter (S-07).

**Contract**: `listAnomaliesForSprint(db, ownerId, sprintId): Promise<AnomalyView[]>` — selects
`status = ACTIVE` for `(ownerId, sprintId)`, ordered by severity (HIGH→MEDIUM→LOW) then
`detectedAt` desc. `AnomalyView` carries the five FR-014 attributes + `riskScore`, `type`,
`detectedAt`, `relatedTeamMemberId`.

### Success Criteria:

#### Automated Verification:

- Unit/integration test passes: `npm run test` / `npm run test:integration` — reader returns
  ACTIVE-only rows in the exact default order; excludes RESOLVED.
- Full suite green: `npm run test && npm run test:integration`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Seed a mixed healthy/crisis sprint locally, run a sync, and read back via the reader
  (temporary script or the integration harness): the inbox lists the expected anomalies,
  each with a working deep-link and a context-grounded suggested action, in severity order.

**Implementation Note**: Pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Per rule: one positive (fires, correct 5 attributes + dedupKey + magnitude) and one
  negative (healthy data → empty) case. Edge cases: draft PR excluded from
  `PR_REVIEW_STALLED`; `"8_WORKING_DAYS"` sentinel resolution for a 21-SP In-Progress ticket;
  `SCOPE_CREEP` denominator `committedSp = 0`/null (no divide-by-zero → no fire);
  `PR_TICKET_DESYNC` ignores PRs with no `linkedTicketKey`; commit-message key extraction is
  project-scoped (foreign key ignored).
- `riskScore` boundaries (magnitude 0 → 0; full HIGH → 100; clamp).
- Suggested-action interpolation.
- Mutation testing (`stryker`) scoped to `src/lib/anomaly/rules/**` + `risk-score.ts` to
  catch weak threshold assertions.

### Integration Tests:

- Reconcile lifecycle (insert → no-op → resolve → reactivate) against real Postgres,
  asserting `detectedAt`/`id` stability.
- Reader ordering + ACTIVE-only filtering.
- End-to-end: seeded sync → `detectAnomalies` → `listAnomaliesForSprint`.

### Manual Testing Steps:

1. Seed a local sprint with a stalled PR, an aging Code-Review ticket, an oversized PR, and
   post-start scope additions.
2. `syncNow` (or run the cron path) and confirm ≥4 anomaly types persist with all attributes.
3. Re-run; confirm `detected_at` is unchanged for still-true anomalies.
4. Resolve one condition in the fixture, re-run; confirm exactly that anomaly flips RESOLVED
   and drops out of the reader.

## Performance Considerations

Detection adds one correlated read (snapshot) + one upsert transaction per owner per cycle,
on top of `syncOwner`. At the 3–10-person target scale (tens of tickets/PRs) this is well
within the Workers per-invocation CPU/subrequest budget — the snapshot is a handful of
indexed queries (`anomaly_owner_sprint_idx`, `jira_ticket_sprint_idx`,
`github_pr_owner_state_idx`), and all detectors run in memory. The cron loop already caps at
`MAX_OWNERS_PER_CYCLE = 50`.

## Migration Notes

One additive migration (`0004_*.sql`): `anomaly.dedup_key text NOT NULL` +
`UNIQUE(owner_id, sprint_id, dedup_key)`. Safe without backfill because the `anomaly` table
has no rows before this slice. Generated via `npm run db:generate`, applied via
`npm run db:migrate` (drizzle-kit migrate connects directly to Supabase, per F-02 notes).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06)
- Change identity: `context/changes/anomaly-detection-engine/change.md`
- Correlation helper: `src/lib/integrations/sync/link-ticket.ts:32`
- Threshold defaults: `src/db/defaults.ts:41`
- Output schema: `src/db/schema.ts:584` (`anomaly`), `:617` (`anomaly_settings`)
- Sync entry points: `src/lib/integrations/sync/{run-sync,scheduled,actions}.ts`
- Lessons: `context/foundation/lessons.md` (#1 dedup NOT NULL, #3 pool teardown)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — schema, thresholds, shared correlation & types

#### Automated

- [x] 1.1 Migration generates cleanly: `npm run db:generate` — dc458cc
- [x] 1.2 Migration applies to local Supabase: `npm run db:migrate` — dc458cc
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — dc458cc
- [x] 1.4 Linting passes: `npm run lint` — dc458cc
- [x] 1.5 Unit tests pass (link-ticket refactor still green): `npm run test` — dc458cc

#### Manual

- [ ] 1.6 `anomaly` table shows `dedup_key NOT NULL` + unique index (`\d anomaly`)

### Phase 2: Detectors — 8 rules, risk-score, suggested-action templates

#### Automated

- [x] 2.1 Unit tests pass — positive + negative per rule, risk-score, suggested-action: `npm run test` — 323c1c5
- [x] 2.2 Mutation testing passes threshold on detectors: `npm run test:mutation` — 323c1c5
- [x] 2.3 Type checking passes: `npx tsc --noEmit` — 323c1c5
- [x] 2.4 Linting passes: `npm run lint` — 323c1c5

#### Manual

- [ ] 2.5 Spot-check one detector output: all 5 FR-014 attributes, real deep-link, grounded action

### Phase 3: Orchestration — loader, reconcile, wiring

#### Automated

- [x] 3.1 Reconcile lifecycle integration test passes: `npm run test:integration` — bbdeb40
- [x] 3.2 Existing sync integration tests still pass: `npm run test:integration` — bbdeb40
- [x] 3.3 Type checking passes: `npx tsc --noEmit` — bbdeb40
- [x] 3.4 Linting passes: `npm run lint` — bbdeb40

#### Manual

- [ ] 3.5 `syncNow` in `next dev` produces anomaly rows with stable `detected_at` across two triggers

### Phase 4: Reader + end-to-end verification

#### Automated

- [x] 4.1 Reader ordering + ACTIVE-only test passes: `npm run test` / `npm run test:integration` — 0fbcece
- [x] 4.2 Full suite green: `npm run test && npm run test:integration` — 0fbcece
- [x] 4.3 Type checking passes: `npx tsc --noEmit` — 0fbcece
- [x] 4.4 Linting passes: `npm run lint` — 0fbcece
- [x] 4.5 Production build passes: `npm run build` — 0fbcece

#### Manual

- [ ] 4.6 Seeded mixed sprint reads back the expected ordered inbox with working deep-links
