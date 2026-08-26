<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-16 Sprint Reconciliation

- **Plan**: `context/changes/sprint-reconciliation/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-26
- **Verdict**: REVISE → **SOUND** after triage (all 10 findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

12/12 paths ✓, 16/16 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (21 criteria, all
mapped; one `## Progress`, no stray checkboxes in phase bodies).
Verified directly rather than via a sub-agent, per this session's standing rule.

## Findings

### F1 — Cadence override is lost at every rollover

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1 · Desired End State
- **Detail**: `saveCadence` (`roster-store.ts:890-908`) flips `cadence_overridden`
  on the sprint **row**. The upsert conflicts on `(owner_id, jira_sprint_id)`, so
  a rollover takes the INSERT branch, whose values hard-code
  `cadenceOverridden: false` (`roster-store.ts:851`). The override dies at exactly
  the event this slice exists to handle, and item F (post-setup cadence UI) is out
  of scope so the owner cannot re-apply it. Phase 2 case (c) and manual row #2
  both exercised only the conflict branch, so nothing would have caught it.
- **Fix A ⭐ Applied**: Seed the INSERT's cadence columns + flag from the owner's
  previous row when it carried `cadence_overridden = true`; new integration case
  (i); manual row #2 rewritten to span a rollover.
- **Decision**: FIXED (Fix A)

### F2 — Automated criteria 2.5 and 2.6 can never pass

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Success Criteria · Progress 2.5, 2.6
- **Detail**: `grep -rn "insert(sprint)" src/ | wc -l` returns 13 (nine matches
  are `*.integration.test.ts` seed blocks) and still would after Phase 2.
  `grep -rn "cadenceOverridden}" …` returns 3 — the SET is three `case when`
  lines — and the unquoted `--include=*.ts` is a zsh glob error before grep runs.
  `/10x-implement` treats both as gates.
- **Fix Applied**: Count files not lines, quote the glob, exclude tests. Both
  commands verified to execute and return `1`.
- **Decision**: FIXED

### F3 — Phase 1's stated regression cannot occur

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 Intent · Phase 3 §4 case (c) · Key Discoveries
- **Detail**: `resolveStoryPointFieldId` (`jira.ts:916`) and `validateCredentials`
  (`jira.ts:226`) already classify 401 and both run before `searchSprintIssues`
  (`run-sync.ts:631`, `:635`, `:637`); Phase 3 keeps `validateCredentials` above
  the reconcile. The reconcile can never be the first Jira call, so the stated
  downgrade is unreachable and case (c) would have passed vacuously. The
  reachable case is narrower: a PAT `/myself` accepts but that lacks Agile
  permission. Phase 1 still earns its place — `JiraBoardNotFoundError` is
  load-bearing for the stale-`board_id` fallback.
- **Fix Applied**: Phase 1 reframed to lead with the 404 branch; 401 restated as
  defence-in-depth over the reachable case; Key Discoveries bullet corrected;
  case (c) reworded to `/myself` 200 + agile 401.
- **Decision**: FIXED

### F4 — Between sprints, the DB keeps a finished sprint ACTIVE forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 (`no_active_sprint`) · Desired End State
- **Detail**: The demotion fired only on the upsert path, so `no_active_sprint`
  left the ended sprint `ACTIVE` — the DB disagreeing with Jira, with `detect`,
  `capacity` and both dashboards still treating it as current and
  `SPRINT_AT_RISK` still firing on it. C3 does not force this: demoting is not
  blanking, since `getActiveSprintRow`'s fallback (`sprint.ts:37-42`) returns the
  most-recently-started row regardless of `state`.
- **Fix A ⭐ Applied**: Demote to `CLOSED` on `no_active_sprint` when `endDate` is
  non-NULL and in the past (the guard makes it safe against a mid-sprint blip).
  Case (f) split, cases (j) and (k) added. The `saveCadence` no-op consequence is
  recorded under Critical Implementation Details.
- **Interaction**: F1's carry-forward read was changed from `state='ACTIVE'` to
  most-recently-started, so an override still survives a rollover that follows a
  between-sprints demotion.
- **Decision**: FIXED (Fix A)

### F5 — `listBoards` runs every cycle forever for the targeted population

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is one paragraph
- **Dimension**: Blind Spots
- **Location**: Performance Considerations
- **Detail**: `board_ambiguous` / `no_board` persist nothing by design, so
  `board_id` stays NULL and `listBoards` (paginated, capped at 20 pages,
  `jira.ts:441`) re-runs every cycle indefinitely. `change.md` records `board_id`
  as NULL for every demo-seeded account and every account that came through
  `storeJiraIntegration` — the default population. Real cost is +2 subrequests,
  not +1, with PRD Open Question #3 unresolved.
- **Fix Applied**: Performance Considerations rewritten with the per-population
  cost and the fact that nothing prompts an owner with a stored sprint to end the
  repeat.
- **Decision**: FIXED

### F6 — Phase 4 copies a destructive delete without its confirmation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: `jira-project-editor.tsx:24` records that the settings project
  change "is DESTRUCTIVE, so it opens with a confirmation rather than the
  picker", and `connection-service.ts:406-408` justifies its sprint delete by
  that confirmation. `jira-connect-form.tsx` has no such gate (its one
  `destructive` Alert at `:211` is an error banner). Phase 4 copied the delete
  without the gate, so a wizard project switch would silently discard
  `sprint` + `jira_ticket` + `jira_status_history`.
- **Fix A ⭐ Applied**: Added a Phase 4 §1 pre-condition — establish whether a
  post-setup account can re-enter `/setup/jira`; mirror the settings confirmation
  if it can, record the pre-first-sync reasoning in one line if it cannot.
- **Decision**: FIXED (Fix A)

### F7 — `jira_project.board_id` is `text`, the plan types it `number`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1 args contract
- **Detail**: `schema.ts:267` is `text("board_id")` and `importCadence` writes
  `String(board.id)` (`roster-store.ts:832`), but `ReconcileResult.boardId` and
  `storedBoardId` imply numeric.
- **Fix Applied**: Coercion named in the args contract, with a guard treating
  NULL / `""` / `NaN` alike as "no stored board".
- **Decision**: FIXED

### F8 — Phase 3 didn't say the cursor guard moves

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1
- **Detail**: The guard at `run-sync.ts:617-626` reads `chosenSprint.id`, only
  known after the reconcile, yet the plan said "everything downstream is
  unchanged".
- **Fix Applied**: Explicit move bullet added.
- **Decision**: FIXED

### F9 — `listBoards`' doc comment becomes false

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1
- **Detail**: `jira.ts:451-452` states "a 401 here is an availability blip →
  `JiraUnavailableError`" as settled reasoning — the exact conclusion Phase 1
  inverts.
- **Fix Applied**: Doc-comment rewrite folded into Phase 1's contract.
- **Decision**: FIXED

### F10 — Criterion 3.5 (`npm run test:mutation`) gates nothing here

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria · Progress 3.5
- **Detail**: `stryker.conf.json` is scoped to the anomaly rules (CLAUDE.md), so
  neither the reconciler nor `run-sync.ts` is mutated by it.
- **Fix Applied**: Relabelled as a regression guard only, in both the criteria
  and the Progress line.
- **Decision**: FIXED

## Carried into implementation

- **Phase 4 §1 pre-condition** (F6): reachability of `/setup/jira` for a
  post-setup account must be settled before the delete is written.
- **PRD Open Question #3** stays open — the reconcile's real per-cycle subrequest
  cost is now stated per population (F5) but not measured.
