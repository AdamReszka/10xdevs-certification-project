<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cadence after setup (S-29)

- **Plan**: `context/changes/post-setup-cadence-surface/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND (all six findings fixed in the plan)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

13/13 paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (5 phases, all
success criteria matched, no stray checkboxes outside `## Progress`).

## Findings

### F1 — The restore's pre-clear is not atomic with the pull it enables

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 — `restoreCadenceFromJira`
- **Detail**: The plan cleared `cadence_overridden` by id, then delegated to
  `importCadence`. Every Jira network call in `reconcileActiveSprint` runs
  *before* its transaction opens (`reconcile-sprint.ts:35`, calls at
  `:138,:147,:167`), so an invalid token, a rate limit or a dropped connection
  throws with the clear already committed. The action reports failure while the
  account is silently back on auto-pull, and the next 15-minute sync overwrites
  the lead's deliberate cadence with Jira's — moving capacity and all five
  time-based anomaly rules (S-28).
- **Fix A ⭐ Recommended**: `forceCadenceRefresh?: boolean` on
  `reconcileActiveSprint`; the CONFLICT branch drops its `case when` wrappers and
  adds `cadenceOverridden: false` to the same SET; the restore passes it through
  `importCadence` and performs no UPDATE of its own.
  - Strength: Clear and refresh land in one transaction — the ordering trap stops
    existing rather than being guarded against.
  - Tradeoff: Touches the shared sync path; needs a default-false param.
  - Confidence: HIGH — the CONFLICT branch is three `sql` expressions in one
    place, and all I/O is already outside the transaction.
  - Blind spot: The INSERT-branch `carry` needs the same parameter threaded.
- **Fix B**: Keep the pre-clear, re-set the flag on any throw.
  - Strength: Zero blast radius on the sync path.
  - Tradeoff: The compensation can itself fail; a second mechanism writes the flag.
  - Confidence: MEDIUM — `noActiveSprint: true` is not a throw and needs its own
    decision.
- **Decision**: FIXED via Fix A — new Phase 3 §1 (`forceCadenceRefresh`), §2
  rewritten to do no UPDATE, §4 atomicity coverage (failed-pull case + the
  default-unchanged regression guard), Critical Implementation Details rewritten,
  Progress 3.6/3.7 added. Brief synced.

### F2 — "start_day corrects itself from FRI" is not what the mechanism does

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State bullet 3; Phase 2 Manual; Progress 2.5
- **Detail**: `deriveCadence` computes `startDay` as the weekday of the sprint's
  own `startDate` (`cadence.ts:83`) — there is no other source. The plan's own
  Current State Analysis says that account reads FRI *because its sprint was
  started in Jira on a Friday evening*. Clearing the flag re-derives FRI at every
  sync until a sprint starts on another weekday. Manual row 2.5 could only ever
  be ticked as "no change observed", inviting a bogus bug report.
- **Fix**: Restate the end state as what Phase 2 buys (auto-pull reaches the row
  again; the lead can now correct FRI with an override that means something);
  rewrite 2.5 to verify propagation, not the disappearance of FRI.
- **Decision**: FIXED

### F3 — The plan names an e2e assertion on the doorstep copy that does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §3
- **Detail**: "`e2e/setup-doorstep.spec.ts` asserts on this copy" is false.
  Grepping the strings across `src/` and `e2e/` returns only
  `setup-doorstep-view.ts`; `setup-doorstep-view.test.ts:76-80` only asserts
  `detail` is truthy, and the spec's only copy assertion is the demo banner
  (`:154`).
- **Fix**: Drop the claim; add the guard to `setup-doorstep-view.test.ts`
  (pure, in-suite) instead.
- **Decision**: FIXED

### F4 — The dirty-check's comparison basis is unspecified, and the read path coalesces NULLs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — Contract
- **Detail**: All three cadence columns are nullable (`schema.ts:438-440`) and
  `setup/team/page.tsx:67-77` coalesces them to `14` / `"MON"` /
  `DEFAULT_WORKING_DAYS` before the form sees a value. Comparing a submitted `14`
  against a stored `NULL` scores an untouched confirm as an edit and re-freezes
  the account — the read-wider-than-write shape this slice exists to close, one
  layer down. Latent rather than live: both current writers fill the columns.
- **Fix**: State that both sides normalise through the read's defaults; add the
  NULL-stored case to the Phase 1 (b) integration test.
- **Decision**: FIXED

### F5 — The four view states have no room for "restore ran, Jira had nothing"

- **Severity**: 💭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 + Phase 4 §2
- **Detail**: `cadence-editor-view.ts`'s union (`no_sprint`, `no_active_sprint`,
  `overridden`, `in_sync`) has no member for the outcome Phase 3 explicitly wants
  surfaced, and no test covers it. After the F1 fix the override is still in
  force in that case, so copy claiming auto-pull is back on would be false.
- **Fix**: Export the restore's own outcome messages and cover both in
  `cadence-editor-view.test.ts`.
- **Decision**: FIXED

### F6 — saveCadenceAction gains a second caller but keeps its wizard-only framing

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2, Phase 4 §3
- **Detail**: `actions.ts:373` opens "THIS IS WHAT FINISHES THE WIZARD" and the
  `no_roster` copy is wizard-specific, but Phase 4 gives the action a second
  caller where that sentence is wrong and the pre-check unreachable.
- **Fix**: Rewrite the comment in Phase 1 to name both callers and record that
  `no_roster` is wizard-only.
- **Decision**: FIXED
