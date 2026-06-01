<!-- PLAN-REVIEW-REPORT -->
# Plan Review: F-02 Data Schema Baseline

- **Plan**: context/changes/data-schema-baseline/plan.md
- **Mode**: Deep
- **Date**: 2026-05-31
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 1 warning, 2 observations (all triaged)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL → addressed |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, symbols ✓ (CLAUDE.md:42 neon line, userRelations@schema.ts:76, drizzle-kit 0.31.10), brief↔plan ✓, Progress↔Phase mechanical ✓, DATABASE_URL=direct:5432 (drizzle-kit migrate OK; not the 6543 pooler).

## Findings

### F1 — New tables inherit GRANT ALL TO anon with no RLS; publishable key is in the browser

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots (Security)
- **Location**: Phase 4 — Generate + apply migration
- **Detail**: Supabase baseline grants `anon` schema usage + ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES (supabase/migrations/20260524085002_remote_schema.sql:54,249); drizzle `0000` enables no RLS; `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is browser-bundled (wrangler.jsonc). F-02 adds credential metadata / rosters / anomalies — cross-account exposure via PostgREST unless the project's Data API is disabled. Breaches the PRD cross-account-isolation guardrail and widens a latent F-01 exposure (session.token).
- **Fix A ⭐ Recommended**: Confirm the Supabase Data API (PostgREST) is OFF; add a Phase 4 step proving it (curl `/rest/v1/github_credential` with the publishable key → no rows) and document direct-Hyperdrive-only access as the isolation rationale in infrastructure.md. If the API is ON, STOP and enable RLS + revoke anon/authenticated first.
  - Strength: App reaches the DB only via Hyperdrive direct connection, never PostgREST — disabling the Data API makes anon grants inert at zero schema cost.
  - Tradeoff: Relies on a project setting, not code; must be verified/documented and re-checked if re-enabled.
  - Confidence: MED — direct-connection architecture strongly implies PostgREST is unused, but the setting isn't verifiable from the repo.
  - Blind spot: Pre-existing F-01 auth-table exposure should be confirmed closed by the same setting.
- **Fix B**: Enable RLS + revoke anon/authenticated on every new table via hand-written SQL appended to 0001.
  - Strength: Defense-in-depth even if the Data API is later enabled; RLS-deny is the Supabase-native protection.
  - Tradeoff: drizzle-kit emits no RLS; adds real scope to a schema-only slice; with no logged-in Postgres role the policies reduce to "block anon" (same effect as Fix A, more code).
  - Confidence: HIGH.
  - Blind spot: Must not lock out the Hyperdrive/service connection.
- **Decision**: FIXED via Fix A (Critical Implementation Details note + Phase 4 §4 verification step + success criterion 4.5 + Progress 4.5/4.9; brief Open Risks updated)

### F2 — `userRelations` must be extended in place, not re-declared (spans Phases 2 & 3)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §4 and Phase 3 §4
- **Detail**: `userRelations` already exists at src/db/schema.ts:76-79. Drizzle requires one relations() per table; a second `const userRelations` is a duplicate-identifier error, and user/hub-table (monitoredRepo, sprint) relations straddle the phase split.
- **Fix**: Instruct extending the existing `userRelations` block in place (single declaration per table); flag hub tables completed in Phase 3; note it edits relations metadata, not table DDL (no migration impact).
- **Decision**: FIXED — Phase 2 §4 and Phase 3 §4 contracts updated.

### F3 — `bigint` columns need an explicit mode

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §2 (monitoredRepo.githubRepoId), Phase 3 §1 (githubPrId)
- **Detail**: Drizzle `bigint` defaults to returning JS BigInt; GitHub IDs fit JS safe-int range.
- **Fix**: Specify `bigint(name, { mode: "number" })`.
- **Decision**: FIXED — both contracts updated.

### F4 — Throwaway crypto script won't auto-load `.env`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Manual Verification
- **Detail**: A bare `node script.mjs` doesn't read `.env`, so `TOKEN_ENCRYPTION_KEY` is undefined and the round-trip fails as "missing key", masking the real test.
- **Fix**: Note `node --env-file=.env <script>` in the manual step.
- **Decision**: FIXED — folded into Phase 1 manual round-trip criterion (Progress unchanged).
