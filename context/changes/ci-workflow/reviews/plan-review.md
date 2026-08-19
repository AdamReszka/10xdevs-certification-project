<!-- PLAN-REVIEW-REPORT -->
# Plan Review: CI — integration-suite job

- **Plan**: context/changes/ci-workflow/plan.md
- **Mode**: Deep
- **Date**: 2026-08-19
- **Verdict**: REVISE → SOUND after fixes (all findings applied)
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F2) → resolved |
| Lean Execution | WARNING (F1) → resolved |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F3) → resolved |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓, 2/2 symbols ✓, brief↔plan ✓. Deep-verify sub-agent confirmed all four riskiest claims against code (supabase snapshot is infra-only → no drizzle conflict; only one integration test file, 3 tables; ci.yml sole workflow, no in-repo blast radius; dotenv 16.6.1 doesn't override pre-set env and no-ops on missing file).

## Findings

### F1 — `supabase start` boots the whole stack for a Postgres-only need

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 / Critical Implementation Details
- **Detail**: Bare `supabase start` pulls/boots Studio, Auth, Realtime, Storage, imgproxy, edge-runtime, etc.; the integration suite hits Postgres directly and needs only the DB. Extra services = slower cold-start + bigger flakiness surface in CI.
- **Fix**: `supabase start -x <non-db services>` (boot Postgres only); exact exclusion list confirmed at implement time.
- **Decision**: FIXED (added `-x` exclusion list to the Critical Implementation Details bullet + the Phase 1 job YAML).

### F2 — "Both jobs green to merge" isn't enforced by the workflow file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; wording/scope clarification
- **Dimension**: End-State Alignment
- **Location**: Desired End State
- **Detail**: Adding the `integration` job doesn't make it a required status check — that's a GitHub branch-protection repo setting outside the tree. The end-state wording implied automated merge-gating the file alone can't deliver.
- **Fix**: Reword to "jobs run & report status on every PR"; note that making `integration` merge-blocking is a separate branch-protection step (out of scope).
- **Decision**: FIXED (note added to plan Desired End State; brief reworded).

### F3 — `dotenv` imported by setup.ts but undeclared in package.json

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — obvious, narrow fix
- **Dimension**: Blind Spots
- **Location**: test/integration/setup.ts import (pre-existing), now relied on by the CI job
- **Detail**: setup.ts imports `dotenv`, present only transitively (16.6.1). CI works today via `npm ci`, but the integration job now depends on an undeclared package.
- **Fix**: Add `dotenv` to devDependencies.
- **Decision**: FIXED (added Changes Required #2 + a success criterion + Progress 1.5).
