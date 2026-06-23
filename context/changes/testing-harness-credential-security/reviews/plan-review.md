<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Rollout Phase 1 — Harness Bootstrap + Credential Security

- **Plan**: context/changes/testing-harness-credential-security/plan.md
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical · 2 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F1 — fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS (F4 observation — fixed) |
| Blind Spots | WARNING (F2 — fixed) |
| Plan Completeness | PASS (F3 observation — fixed) |

## Grounding

5/5 paths ✓, 4/4 symbols ✓ (encryptToken/decryptToken/redactToken/TokenCryptoError),
brief↔plan ✓. Also verified: package-lock.json tracked (npm ci works) ✓; `tsc
--noEmit` exits 0 with zero output (tree typecheck-clean) ✓; S-02 change.md still
`preparing` (deferral note will be read when S-02 is planned) ✓; `integration`
pgEnum has "GITHUB" @ schema.ts:62 ✓. Note: `.github/` does not exist at all
(plan said "empty"); `.nvmrc` pins Node 24 (plan said CI Node 20).

## Findings

### F1 — Phase 3 leaves test-plan §5 gate contradicting the deferral

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3
- **Detail**: §5 row "unit + integration — required after §3 Phase 1" becomes false once Phase 1 completes, because all integration tests are deferred to S-02; §5 would claim an integration gate is enforced while zero integration tests exist (CI runs unit-only).
- **Fix A ⭐ Recommended**: Split the §5 row — unit required after Phase 1, integration required after S-02.
- **Fix B**: Keep §5 text, add a footnote that integration rides with S-02.
- **Decision**: FIXED via Fix A — added Phase 3 Change #3 "Reconcile the §5 quality-gate row" + success criterion 3.5 / Progress 3.5; renumbered subsequent change items.

### F2 — CI Node version (20) contradicts repo `.nvmrc` (24)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Change #1 (CI workflow)
- **Detail**: Plan specified Node 20; `.nvmrc` pins Node 24. CI would exercise a different runtime than local dev. The "20" likely came from `@types/node ^20`, but the runtime contract is `.nvmrc`.
- **Fix**: Pin CI runtime via `actions/setup-node` `node-version-file: .nvmrc`, no hardcoded version.
- **Decision**: FIXED — Change #1 contract updated to `node-version-file: .nvmrc`; success criterion 3.3 / Progress 3.3 added.

### F3 — `.github/` doesn't exist (plan says "currently empty")

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Change #1
- **Detail**: Neither `.github/` nor `.github/workflows/` exists; the implementer must create the directory tree.
- **Fix**: Reword to "create `.github/workflows/`; the `.github` directory does not exist yet."
- **Decision**: FIXED — Change #1 File line reworded.

### F4 — Vitest alias snippet yields a double-slash resolution

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Change #3 (vitest.config.ts snippet)
- **Detail**: Alias key `"@"` + trailing-slash value (`./src/`) resolves `@/lib/crypto` to `…/src//lib/crypto`. Usually normalized, so the smoke test may not catch it — but §6.1 would enshrine a sloppy reference config.
- **Fix**: Use `fileURLToPath(new URL("./src", import.meta.url))` (no trailing slash), or adopt `vite-tsconfig-paths`.
- **Decision**: FIXED — snippet + Critical Implementation Details reference both updated to the no-trailing-slash `fileURLToPath` form.
