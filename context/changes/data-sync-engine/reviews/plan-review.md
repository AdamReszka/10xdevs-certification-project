<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-05 Data Sync Engine

- **Plan**: context/changes/data-sync-engine/plan.md
- **Mode**: Deep
- **Date**: 2026-08-20
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F5 — fixed) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3 — fixed) |
| Blind Spots | WARNING (F2, F4 — fixed) |
| Plan Completeness | WARNING (F1, F6 — fixed) |

## Grounding

6/6 paths ✓, 5/5 symbols ✓ (`getDb` db.ts:4, `isOnboardingComplete` onboarding.ts:28,
`linkedTicketKey` schema.ts:470, `githubGet`/`jiraGet` github.ts:95/jira.ts:177,
`syncState` schema.ts:349), brief↔plan ✓. Verified in code: `isOnboardingComplete` is
per-owner (6 sequential queries → boolean); `githubCommit.additions/deletions` nullable
(schema.ts:432-433); test framework = vitest + playwright + stryker with
`*.integration.test.ts` / `vitest.integration.config.ts` convention; scripts
`db:generate`/`db:migrate` (drizzle-kit); `wrangler.jsonc` main=`.open-next/worker.js`,
HYPERDRIVE binding present, no `triggers.crons`.

## Findings

### F2 — Scheduled loop has no owner-enumeration query

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 — change #2 (capped global loop)
- **Detail**: Plan said "query owners with completed setup (reuse onboarding-complete predicate)". `isOnboardingComplete` (onboarding.ts:28) is per-owner — 6 sequential queries returning a boolean for one owner. No "list all onboarded owners" query exists. Naive reuse = N users × 6 queries that burn the shared per-invocation subrequest budget before any sync starts.
- **Fix**: Define a set-based enumeration query in Phase 5 (distinct owners with a `jiraProject` + `githubCredential` as a cheap onboarded proxy) as the loop input; the per-owner predicate stays for the on-demand path / guard, not enumeration.
- **Decision**: FIXED (Fix in plan)

### F3 — Lease granularity ambiguous (per-owner vs per-integration)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 (column), Phase 4 (acquisition), Phase 5 (skip)
- **Detail**: `syncState` has `unique(ownerId, integration)` → two rows per owner (GITHUB + JIRA). Phase 1 said lease "per (ownerId, integration)" but Phase 4/5 described "owner-sync start stamps claimedUntil" and "skip owner" as if one lease per owner. Which row gates the owner was undefined.
- **Fix A ⭐ Recommended**: Lease per-integration on the existing `syncState` row; guard and skip per `(owner, integration)`; loop iterates owner×integration.
  - Strength: Zero new model — `claimedUntil` sits on the existing row; consistent with per-integration status/cursor/freshness.
  - Tradeoff: Loop shape iterates per integration; allows partial overlap (GH leased, Jira not).
  - Confidence: HIGH — matches syncState's already per-integration nature.
  - Blind spot: Interaction with per-integration retry on partial failure.
- **Fix B**: Owner-level lease in a separate location (one integration-row as proxy, or a new `owner_sync_lease` table).
  - Strength: One lease = one owner, simple skip.
  - Tradeoff: Either abuses an integration-row as proxy (confusing) or adds schema.
  - Confidence: MED.
  - Blind spot: Interaction with per-integration partial-failure retry.
- **Decision**: FIXED (Fix A — per-integration; Critical Details + Phase 4 + Phase 5 reconciled)

### F4 — Commit line-counts: `/commits` list omits additions/deletions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #1 (`listCommits`)
- **Detail**: `listCommits` contract said "branch/line data available on the resource". GitHub `GET /repos/{repo}/commits` (list) does NOT include per-commit `stats.additions/deletions`; those need a per-commit `GET /repos/{repo}/commits/{sha}`. Commits outnumber PRs, so per-commit GETs would multiply the fan-out beyond even per-PR detail (the D2 budget risk). `githubCommit.additions/deletions` are nullable (schema.ts:432-433) and no anomaly rule uses per-commit size (PR_TOO_BIG measures per-PR). Research Q5 flagged this; plan didn't resolve it.
- **Fix**: Explicitly leave `githubCommit.additions/deletions` NULL in MVP; remove "line data" from the `listCommits` contract. No per-commit GET.
- **Decision**: FIXED (Fix in plan)

### F5 — `freshnessWindowMinutes` unused; cron hard-coded `*/15`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 (cron), overall
- **Detail**: FR-011 requires a configurable freshness window. The `freshnessWindowMinutes` column (per-owner, default 15, from F-02) exists, but the plan hard-coded a `*/15` cron and never read the column — configurability neither delivered nor explicitly deferred.
- **Fix A ⭐ Recommended**: Use the column as a "due?" gate — skip an owner/integration whose `lastSuccessfulSyncAt` is within its window; cron stays global `*/15`.
  - Strength: Realizes FR-011 upward (a 30-min-window owner is skipped every other fire).
  - Tradeoff: Windows below 15 min aren't honored (floored at the cron interval) — must be recorded as a known limitation.
  - Confidence: HIGH — column + default confirmed in schema.
  - Blind spot: Interacts with F2 (the "due" check is part of the enumeration/skip).
- **Fix B**: Explicitly defer configurability to NOT-doing.
  - Strength: Smaller scope now.
  - Tradeoff: Leaves an implemented column dead and FR-011 partially unmet.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — due-check; sub-15-min floor recorded in "What We're NOT Doing")

### F1 — Phase Success-Criteria use `- [ ]` (contract: checkboxes only in Progress)

- **Severity**: ⚠️ WARNING (progress-format contract classifies as CRITICAL)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All phases, "#### Automated/Manual Verification:" blocks
- **Detail**: Phase blocks carried `- [ ]` checkboxes in Success Criteria while `## Progress` held its own set. The mechanical progress-format contract requires plain `- ` bullets in phase blocks (checkbox state only in `## Progress`) to avoid double-parsing by /10x-implement. (The /10x-plan template itself models checkboxes in phases — hence WARNING severity rather than a hard CRITICAL.)
- **Fix**: Convert phase-block Success Criteria to plain `- ` bullets; state lives only in `## Progress`.
- **Decision**: FIXED (Fix in plan — 0 checkboxes before Progress, 29 in Progress)

### F6 — Setup-actions path imprecise + integration-test convention

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — change #3
- **Detail**: Plan wrote `src/app/setup/*/actions.ts`; actual path is `src/app/(app)/setup/*/actions.ts` (route group `(app)`). Repo integration tests use `*.integration.test.ts` + `vitest.integration.config.ts`; plan said only "integration tests".
- **Fix**: Correct the path; add the integration-test naming convention.
- **Decision**: FIXED (Fix in plan)
