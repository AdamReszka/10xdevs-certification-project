<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-04 — Setup Wizard: Team Roster + Sprint Cadence

- **Plan**: context/changes/setup-team-roster-cadence/plan.md
- **Mode**: Deep
- **Date**: 2026-08-20
- **Verdict**: REVISE → SOUND (all findings fixed during triage)
- **Findings**: 1 critical · 3 warnings · 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (via F1) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3) |
| Blind Spots | FAIL (F1, F2) |
| Plan Completeness | WARNING (F4) |

## Grounding

12/12 paths ✓, 6/6 symbols ✓, brief↔plan ✓, schema claims ✓ (jiraSprintId NOT NULL, PROVIDER AAD `GITHUB`/`JIRA`, plaintext workspaceUrl/jiraEmail confirmed in code).

## Findings

### F1 — "No active sprint" path can't persist cadence, so the wizard can't complete

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots (also End-State Alignment)
- **Location**: Critical Implementation Details → "No-active-sprint degradation" (plan:62); Phase 2 importCadence (plan:141); Phase 5 isOnboardingComplete (plan:275)
- **Detail**: Three plan claims were mutually inconsistent. (1) plan:62 said the no-active-sprint path persists a sprint row with default cadence. (2) Schema (verified): `sprint.jiraSprintId` is `NOT NULL`, keyed `UNIQUE(ownerId, jiraSprintId)`; with no active sprint there is no `jiraSprintId`, and cadence columns live only on `sprint` — nowhere to put a default. (3) plan:275 required "a sprint row with cadence populated" for `isOnboardingComplete`. Net: a team onboarding **between sprints** (brief:29, explicitly supported) could never create a sprint row → `isOnboardingComplete` false forever → wizard cannot finish, the opposite of the stated degradation goal.
- **Fix A ⭐ Recommended**: Drop the sprint/cadence requirement from the completion predicate.
  - Strength: Removes the impossible write; matches FR-007 "cadence re-pulls each sync"; wizard finishes between sprints.
  - Tradeoff: "Complete" onboarding may briefly lack cadence until a sprint starts — acceptable.
  - Confidence: HIGH — aligns predicate with what's structurally guaranteeable.
  - Blind spot: onboarding-routing must agree to the relaxed predicate shape.
- **Fix B**: Persist default cadence against a FUTURE sprint id if one exists, else fall back to Fix A.
  - Strength: Keeps cadence on a real sprint id when a future sprint is planned.
  - Tradeoff: More Agile calls; still needs Fix A's relaxation for the empty case.
  - Confidence: MED — future-sprint start/end dates often null → derived cadence = defaults anyway.
  - Blind spot: future-sprint availability across real projects unverified.
- **Decision**: FIXED via Fix A — predicate no longer requires sprint/cadence; no-active-sprint path persists only `boardId` + banner and writes no `sprint` row (Critical Impl Details, importCadence contract, Phase 2 tests 2.4, Phase 5 predicate + 5.2 updated).

### F2 — Cadence override not preserved on re-import/sync

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 importCadence (plan:141); Critical Impl Details (plan:60)
- **Detail**: The plan preserves user edits for the roster (merge-by-key) but left the cadence upsert's SET target unspecified. `importCadence` "upserts the sprint row (onConflictDoUpdate)" while also claiming not to commit user-overridable fields "blindly". FR-007 requires overrides to persist across syncs; an unconditional SET would silently clobber a user with `cadenceOverridden = true`.
- **Fix**: On conflict, SET always refreshes sprint metadata (name/state/startDate/endDate) but refreshes cadence columns (lengthDays/startDay/workingDays) only when existing `cadenceOverridden == false`. Add an integration test: override cadence → re-import → override survives.
- **Decision**: FIXED — added "Cadence override preservation (hard, F2)" to Critical Impl Details + integration test (Progress 2.5).

### F3 — Owner timeZone sourced via the unreliable email join the plan rejected for dedup

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Critical Impl Details "Cadence derivation & timezone" (plan:60); Phase 2 importCadence (plan:141)
- **Detail**: Cadence TZ was to be taken from "the owner's own assignable/search entry", which requires matching on `emailAddress` — the exact field research declared unreliable/withheld (research:144, the reason dedup went manual). The owner match would frequently miss → UTC fallback → the off-by-one weekday the plan tried to avoid. Meanwhile `validateCredentials` already calls `/rest/api/3/myself` (jira.ts:165), which returns `timeZone` for the authenticated account directly.
- **Fix**: Extend the existing `JiraIdentity`/myself read to capture `timeZone` and source cadence TZ from there; drops importCadence's TZ dependence on `listAssignableUsers`.
- **Decision**: FIXED — TZ source switched to `/myself` in Critical Impl Details + importCadence contract + Phase 1 #2 (`JiraIdentity` gains `timeZone`).

### F4 — Progress bar caps at 75%: totalSteps=4 but Team is the final step at step={3}

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Overview (plan:5), Phase 4 page.tsx (plan:223); shell totalSteps=4
- **Detail**: Verified: shell default `totalSteps=4`; github `step={1}`, jira `step={2}`, neither overrides `totalSteps`. Team as last step at `step={3}` makes the final screen read "Step 3 of 4" / 75% with no step 4. research OQ#2 flagged exactly this; the plan collapsed 3+4 into one page but never reconciled the denominator, while asserting "No shell edit needed".
- **Fix**: Change the shell `totalSteps` default `4 → 3` (single-point fix; github/jira pages inherit "of 3"). Grep for any test asserting the literal "of 4".
- **Decision**: FIXED — shell default → 3 (Current State + Phase 5 #3 + criteria 5.4); Overview reworded to "step 3 of 3".
