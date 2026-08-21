<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Anomaly Detection Engine (S-06)

- **Plan**: context/changes/anomaly-detection-engine/plan.md
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → SOUND (all findings fixed in plan)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS (1 observation — fixed) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (1 finding — fixed) |
| Plan Completeness | WARNING (1 finding + 2 obs — fixed) |

## Grounding

5/5 modify-paths exist ✓, brief↔plan consistent ✓, Progress↔Phase mapping exact ✓;
2 risky claims contradicted the plan (F1 PR/sprint relation, F2 missing Stryker config).

## Findings

### F1 — PR-only anomalies have no sprint, but anomaly.sprintId is NOT NULL

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — loadSprintSnapshot / orchestrator mapping
- **Detail**: `github_pull_request` has no sprint column (schema.ts:453–488); PRs relate to
  repos. `anomaly.sprint_id` is NOT NULL (schema.ts:591). PR-only rules (PR_REVIEW_STALLED,
  PR_TOO_BIG) fire on PRs that may have no linked ticket → no natural sprint. Plan said
  "load that sprint's PRs" (not implementable — no FK) and never specified sprintId for
  ticket-less anomalies.
- **Fix ⭐**: Loader pulls PRs by owner's monitored repos (not by sprint); orchestrator
  attributes ALL cycle anomalies to the active sprint id. Added to Critical Implementation
  Details + Phase 3 loader/orchestrator contracts.
- **Decision**: FIXED (Fix applied)

### F2 — Phase 2 requires a passing mutation run, but Stryker is unconfigured

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criterion 2.2 (`npm run test:mutation`)
- **Detail**: `test:mutation` script + `@stryker-mutator/*` deps installed, but no
  `stryker.conf.*` exists. `stryker run` can't scope mutants, pick the vitest runner, or
  apply a threshold without config. Criterion 2.2 not actionable; no phase created the config.
- **Fix ⭐**: Added Phase 2 change #4 — create `stryker.conf.json` (vitest runner +
  typescript-checker, `mutate` = anomaly rules + risk-score, thresholds high 85 / break 70),
  with a vitest-v4 compat check note.
- **Decision**: FIXED (Fix applied)

### F3 — SprintSnapshot.statusHistory loaded "if needed" but no rule uses it

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 (types) / Phase 3 (loader)
- **Detail**: All 8 detectors use `ticket.lastStatusChangeAt`/`currentCategory`; none walks
  `jira_status_history`. That history is S-10's aging-report input (YAGNI here).
- **Fix**: Dropped `statusHistory` from `SprintSnapshot`/types with an explicit note.
- **Decision**: FIXED (Fix applied)

### F4 — magnitude undefined for binary rules → risk_score undefined

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — risk-score / PR_TICKET_DESYNC
- **Detail**: `risk_score = severityWeight × magnitude`, but `PR_TICKET_DESYNC` is binary
  (no distance past threshold) → magnitude undefined.
- **Fix**: Binary conditions emit `magnitude = 1`; gradient conditions (ToDo-near-end) keep
  a scaled magnitude. Noted in risk-score contract + the PR_TICKET_DESYNC bullet.
- **Decision**: FIXED (Fix applied)

### F5 — `now` referenced in the syncNow wiring but not defined there

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — syncNow wiring
- **Detail**: Plan showed `detectAnomalies({…, now})` in syncNow, which has no `now` variable.
- **Fix**: syncNow introduces one `const now = new Date()` shared by syncOwner + detection.
- **Decision**: FIXED (Fix applied)
