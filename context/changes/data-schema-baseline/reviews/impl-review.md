<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-02 Data Schema Baseline

- **Plan**: context/changes/data-schema-baseline/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Notes: the plan's CRITICAL blind spot (Supabase Data API exposing public tables to the browser-bundled publishable key) was caught at the Phase 4 isolation gate and RESOLVED — Data API disabled, re-verified `503` cross-account on `user`/`session`/`account`/`github_credential`. `tsc` + `lint` pass; `0001` migration applied to remote Supabase; `0000` untouched; all manual criteria confirmed.

## Findings

### F1 — status-history dedup key column is nullable

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Data Safety
- **Location**: src/db/schema.ts (jiraStatusHistory) / src/db/migrations/0001_lying_human_cannonball.sql
- **Detail**: `UNIQUE("ticket_id","jira_changelog_id")` is the incremental-upsert dedup key the plan's Performance section relies on, but `jira_changelog_id` is nullable. Postgres treats NULLs as distinct, so if a changelog id is ever absent during S-05 sync, duplicate history rows slip past the constraint. Matches the plan contract (listed as plain `text`), so this is a latent note, not drift.
- **Fix**: Consider `notNull()` on `jiraChangelogId` when S-05 wires the upsert (Jira changelog entries always carry an id). Defer to S-05; no action needed in F-02.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Nullable column in a UNIQUE dedup key defeats deduplication" (lessons.md). jiraChangelogId → NOT NULL; migration 0002_dusty_dexter_bennett.sql.

### F2 — NOT NULL constraints added beyond the literal plan contract

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/db/schema.ts (githubCredential/jiraCredential.encryptedToken, anomaly.sprintId)
- **Detail**: The plan only explicitly marked jira's `workspaceUrl`/`jiraEmail` and `dailyRecap.sprintId` as NOT NULL. `encryptedToken` and `anomaly.sprintId` were also made NOT NULL (disclosed at the phase gates). Both are defensible — a credential row without a secret is invalid, and anomalies are sprint-scoped — and they strengthen integrity. Benign drift, already surfaced.
- **Fix**: None needed. Accept as intended.
- **Decision**: PENDING

### F3 — production TOKEN_ENCRYPTION_KEY secret not yet provisioned

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .env.example / Workers Secrets
- **Detail**: The key is documented in `.env.example` and read via `env?.TOKEN_ENCRYPTION_KEY ?? process.env`. No runtime code consumes it yet (call sites land in S-02/S-03), so this is not an F-02 gap — but the Workers Secret (`wrangler secret put TOKEN_ENCRYPTION_KEY`) must exist before S-02/S-03 deploy, or `encryptToken` throws in prod.
- **Fix**: Ensure the prod secret is set as part of S-02/S-03 deploy prep.
- **Decision**: PENDING
