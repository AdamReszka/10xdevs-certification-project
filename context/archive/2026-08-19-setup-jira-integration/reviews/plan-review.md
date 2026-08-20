<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Setup Wizard — Jira Integration (S-03)

- **Plan**: context/changes/setup-jira-integration/plan.md
- **Mode**: Deep
- **Date**: 2026-08-20
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

7/7 template paths ✓, 7/7 new-file paths correctly absent ✓, symbols ✓
(`encryptToken`/`redactToken`, `integration` enum has `"JIRA"`,
`jira_credential`/`jira_project`/`status_mapping` tables, `GITHUB_API_BASE_URL`
seam), brief↔plan ✓, Progress↔Phase ✓ (3 phases, every Success Criteria bullet
mapped), no `docs/reference/contract-surfaces.md` (skipped).

## Findings

### F1 — Jira network calls must sit OUTSIDE the DB transaction

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 — storeJiraIntegration
- **Detail**: storeJiraIntegration makes three Jira round-trips at save
  (re-validate creds, re-list projects, re-list statuses) then does a DB
  transaction. The template (github-store.ts:110 vs :128) runs network BEFORE the
  transaction; the plan's bullet order implied this but didn't state it. A fetch
  nested in the transaction holds a Hyperdrive-backed pg connection open for the
  network duration (lessons.md §"Request-scoped pg.Pool").
- **Fix**: Made the contract explicit — all Jira reads complete before
  `db.transaction`; the transaction body contains only DB writes.
- **Decision**: FIXED

### F2 — Pagination origin-check must use the effective fetch base, not the stored workspace URL

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — listProjects / Critical Implementation Details
- **Detail**: In prod the base origin is the normalized workspace; in non-prod it
  is the `JIRA_API_BASE_URL` override (localhost fixture). The `nextPage`
  origin-check (lesson 4) must compare against the effective fetch base
  (override-or-workspace), not the stored `workspaceUrl`, or the e2e fixture's
  localhost `nextPage` is wrongly rejected. "Configured base" was ambiguous given
  the two-source base.
- **Fix**: Specified the origin baseline is the same value passed as the fetch
  base URL, computed once and reused for request + origin-check (as
  github.ts:185 derives `baseOrigin`).
- **Decision**: FIXED

### F3 — statusCategory may be absent from /project/{key}/statuses

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — listProjectStatuses / suggestCategory
- **Detail**: The Context7 example of `/project/{key}/statuses` returned statuses
  without a `statusCategory` field. The plan's name-regex fallback degrades
  gracefully, but the "native + name" framing over-promised the native half.
- **Fix**: Noted `nativeCategoryKey` is optional and may be absent; `suggestCategory`
  must produce an acceptable seed from the name regex alone; confirm the field in
  the Phase 1 fixture, accept regex-only seeds if absent (no `/rest/api/3/status`).
- **Decision**: FIXED

### F4 — "statuses changed between render and save" has no recovery UX

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1/§2 — incomplete_mapping
- **Detail**: The save-time completeness re-check throws `incomplete_mapping` if a
  Jira status appeared/disappeared since the mapper rendered; the plan mapped it
  to a failure but didn't specify the user-visible recovery.
- **Fix**: Added that `incomplete_mapping` re-runs `fetchProjectStatuses`, shows a
  "Jira statuses changed — please review the mapping again" alert, and returns to
  the mapper stage with the fresh status set.
- **Decision**: FIXED
