<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI — integration-suite job

- **Plan**: context/changes/ci-workflow/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-08-19
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

Evidence: commit `89a6ea1`; PR #39 CI run `32249861745` — both `test` (49s) and `integration` (2m35s) green (`Start Postgres (supabase)` → `Apply schema` → `Integration tests` all ✓). Local: `npm test` 31 green, `npm run test:integration` 4 green. No `secrets.*` reference in the workflow.

## Findings

### F1 — `supabase/setup-cli@v1` pinned to `version: latest`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reproducibility/reliability)
- **Location**: .github/workflows/ci.yml (setup-cli step)
- **Detail**: The CLI floats to `latest`, so a future Supabase CLI release can change behavior or break the `integration` job on a PR that changed nothing related. Plan chose `latest` deliberately; flagged for the record. CI is green today.
- **Fix**: Optionally pin `version:` to the CLI release verified green (reproducible CI) — accept the small maintenance cost of bumping it intentionally.
- **Decision**: FIXED — pinned `version: 2.101.0` (aligned with the `supabase` devDependency `^2.101.0`).

### F2 — Exclusion list expanded from the plan's literal snippet

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .github/workflows/ci.yml (Start Postgres step)
- **Detail**: The plan's candidate `-x` list (11 services) was replaced with the full 13-service non-db set (adds `kong`, `postgres-meta`), verified against the current CLI reference via Context7. This is exactly what the plan's Critical Implementation Detail F1 asked for ("confirm the exact exclusion list against the installed CLI at implement time"). Not drift — a plan-sanctioned refinement; CI green confirms all names valid.
- **Fix**: None needed — noted for traceability between plan snippet and shipped workflow.
- **Note**: CI log shows `-x` skips container *startup* but not image *pull* (excluded services' images still download), so the cold-start saving is smaller than the plan's F1 assumed; correctness unaffected.
- **Decision**: SKIPPED — accepted; matches plan detail F1, CI green.

### F3 — Node 20 deprecation warning on checkout@v4 / setup-node@v4

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml (both jobs; pre-existing on `test`)
- **Detail**: The CI run emits "Node.js 20 is deprecated … forced to run on Node.js 24" for `actions/checkout@v4` and `actions/setup-node@v4`. Upstream, ecosystem-wide, non-blocking; not introduced by this change (the existing `test` job already carried it). Resolves when the actions publish Node-24 majors.
- **Fix**: None now; bump action majors when upstream ships them (future chore, not this change).
- **Decision**: SKIPPED — accepted; upstream/ecosystem-wide, non-blocking, pre-existing.

## Triage summary (2026-08-19)

- **Fixed**: F1 (pinned `supabase/setup-cli` → `2.101.0`)
- **Skipped/Accepted**: F2 (matches plan F1), F3 (upstream deprecation, pre-existing)

The F1 fix edits `ci.yml` after the green run on `89a6ea1`, so a fresh CI run on the pinned workflow is required before the manual success criteria (1.6–1.8) can be confirmed and the change merged.

## Notes

- Benign improvement over the plan's YAML snippet: `DATABASE_URL` was hoisted to job-level `env:` (DRY) instead of duplicated per step. Satisfies the plan's "set for the migrate + test steps" contract. Not a finding.
- Manual success criteria 1.6–1.8 remain `[ ]` (pending user confirmation) — correctly not rubber-stamped.
