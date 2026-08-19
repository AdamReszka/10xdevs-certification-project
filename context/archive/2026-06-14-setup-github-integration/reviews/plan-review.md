<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Setup Wizard — GitHub Integration (S-02)

- **Plan**: context/changes/setup-github-integration/plan.md
- **Mode**: Deep
- **Date**: 2026-07-09
- **Verdict**: REVISE → SOUND (all findings fixed in triage)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | FAIL (F1) → resolved |
| Blind Spots | WARNING (F4, F5) → resolved |
| Plan Completeness | WARNING (F2, F3) → resolved |

## Grounding
10/10 paths ✓, symbols ✓ (getCloudflareContext pattern in auth.ts + route.ts confirmed), brief↔plan ✓, no contract-surfaces.md (skipped). Verified: vitest include glob `src/**/*.test.ts`; requireSession→getOptionalSession dynamically imports @opennextjs/cloudflare + next/headers; getDb falls back to process.env.DATABASE_URL; playwright webServer runs `npm run dev`; no MSW dep.

## Findings

### F1 — Integration tests can't invoke the Server Actions as designed

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; sets the template S-03 copies
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 (actions.ts) + Phase 3 (#2/#3 integration tests)
- **Detail**: Actions get ownerId from requireSession()→getOptionalSession(), which dynamically imports @opennextjs/cloudflare + next/headers and calls getCloudflareContext() (auth.ts:89-96) — none of which exists in a plain Vitest node run. Phase 3's "call validate/store with Account B's session.user.id" can't be authored against the action directly.
- **Fix**: Split a thin `"use server"` action wrapper over an injectable service core (src/lib/integrations/github-store.ts taking `{db, ownerId, …}`). Integration tests drive the service with a real getDb() + explicit ownerId, no request context. Mirrors the crypto/auth seam pattern.
- **Decision**: FIXED (Fix in plan) — added service core as Phase 2 #3; actions became thin delegators (#4); Phase 3 #2/#3 retargeted at the service.

### F2 — Integration-test harness contradicts the default `npm test`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real config decision; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 #1; success criteria across all 3 phases
- **Detail**: `*.integration.test.ts` under src/ matches the unit glob `src/**/*.test.ts`, so it runs (and needs Postgres) on `npm test`. Phases 1–2 say "`npm test` green" (hermetic); Phase 3 says "`npm test` with :54322 up". Same command can't be both.
- **Fix**: Two Vitest projects — unit excludes `**/*.integration.test.ts`; new `test:integration` script (DATABASE_URL→:54322) runs the integration project. Retarget Phase-3 criteria.
- **Decision**: FIXED (Fix in plan) — harness contract, success criteria, testing strategy, and Progress 3.1/3.2 updated.

### F3 — E2E server-side GitHub mock is underspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real harness decision; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 #4
- **Detail**: Missing three links: who serves the mock, how `npm run dev` (webServer) receives GITHUB_API_BASE_URL, how github.ts reads it into opts.baseUrl. No mock dep installed.
- **Fix**: webServer.command = "GITHUB_API_BASE_URL=http://localhost:PORT npm run dev"; action reads process.env.GITHUB_API_BASE_URL into opts.baseUrl; tiny fixture server in Playwright globalSetup serves /user + /user/repos.
- **Decision**: FIXED (Fix in plan) — three-link seam pinned in Phase 3 #4.

### F4 — Re-connect upsert can point repos at a stale credential id

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — subtle correctness gotcha; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 #3 (storeGithubIntegration)
- **Detail**: randomUUID for credential.id is discarded by onConflictDoUpdate(target: ownerId) on re-connect; if repo rows use the discarded id, credential_id FK points at nothing (schema.ts:242-244).
- **Fix**: Use the persisted id from `.returning({ id })` for repo rows; never put id in the onConflict `set`; add a re-connect FK-integrity integration assertion.
- **Decision**: FIXED (Fix in plan) — added to service-core contract, Critical Implementation Details, and Phase 3 integration test.

### F5 — Non-401 GitHub failures not specified for validate

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 #1 (github.ts) / Phase 2 validate
- **Detail**: 401 handled; 403/5xx/network not — a valid token could be mislabeled invalid when GitHub is down (PRD graceful-degradation).
- **Fix**: Distinct `GithubUnavailableError` for non-401 failures → form shows "couldn't reach GitHub, try again" vs "invalid token".
- **Decision**: FIXED (Fix in plan) — github.ts contract, Phase 1 unit criteria, and Progress 1.1 updated.
