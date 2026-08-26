<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-16 Sprint Reconciliation

- **Plan**: `context/changes/sprint-reconciliation/plan.md`
- **Scope**: Phases 1–4 of 4 (all automated criteria complete)
- **Date**: 2026-08-26
- **Verdict**: NEEDS ATTENTION → **APPROVED** after triage (both warnings fixed)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING → PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Scope check

Every `src/` file in the diff appears in the plan; no unplanned source files.
Two documented adaptations (both recorded in their phase commits): `board_id`
now persists on `no_active_sprint` / `sprint_undated`, and one pre-existing
`run-sync` test was rewritten because C4 changed its premise.

## Success criteria

All 16 automated criteria re-verified at review time: `tsc` clean, lint 0 errors
(5 pre-existing warnings, none in this diff), 437 unit / 172 integration passing,
mutation 78.96 ≥ 70, and the four grep gates return 1 / 1 / 6 / 3.

Five manual rows remain `- [ ]` (2.7, 3.6, 3.7, 3.8, 4.6) — open by decision, not
rubber-stamped. None is marked complete without evidence.

## Findings

### F1 — The wizard can no longer re-render the board chooser once `board_id` is stored

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/integrations/roster-store.ts:780`
- **Detail**: `importCadence` passes
  `storedBoardId: chosenBoardId != null ? null : coerceStoredBoardId(project.boardId)`.
  The pre-S-16 `importCadence` called `listBoards` **unconditionally** and returned
  `boardCandidates` whenever a project had more than one sprint-capable board. Now,
  once `jira_project.board_id` is set — which the first successful pass through
  `/setup/team` guarantees — the reconciler short-circuits to the stored board and
  never calls `listBoards`, so `board_ambiguous` is unreachable and the chooser
  cannot render again. Since `/setup/team` is the only mount of the chooser and
  nothing else clears `board_id` within one project (`connection-service` clears it
  only on a project *change*; `disconnectJira` cascades everything away), an owner
  who picks the wrong board on first setup has no in-app way to change it. This
  also collides with manual row 2.7, which asks the user to confirm the chooser
  still renders — on a re-visit it provably will not.
- **Fix**: Pass `storedBoardId: null` unconditionally from `importCadence`.
  - Strength: Restores the pre-S-16 behaviour exactly — the wizard step exists to
    (re-)choose a board, so discovery is its job. The headless cycle keeps the
    stored-board fast path, which is where the per-cycle subrequest cost matters.
  - Tradeoff: One extra `listBoards` per wizard visit — which is precisely what the
    code did before this slice, so it is not a new cost.
  - Confidence: HIGH — the pre-change behaviour is visible in the diff, and the
    reconciler already treats `storedBoardId: null` as "discover".
  - Blind spot: None significant; the existing `roster-store` integration cases
    cover both the single-board and the chooser paths.

### F2 — The stale-`board_id` 404 fallback has no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/integrations/reconcile-sprint.ts:130-137`
- **Detail**: Phase 1's own text calls the 404 branch "the load-bearing one" — the
  whole reason `JiraBoardNotFoundError` exists is so a board deleted in Jira falls
  back to discovery instead of failing the cycle. `jira.test.ts` pins that the
  client *throws* the error, but nothing exercises the reconciler *catching* it:
  neither `reconcile-sprint.integration.test.ts` (11 cases, none 404) nor
  `run-sync.integration.test.ts` drives a stored board that 404s. The branch that
  justified Phase 1 is the one branch with no coverage, so a refactor that widened
  the catch back to `JiraUnavailableError` would pass every gate.
- **Fix**: Add one reconciler case — seed `storedBoardId` pointing at a board the
  mock 404s, have `/board?` return a different valid board, and assert the result is
  `reconciled` on the discovered board with `jira_project.board_id` repointed.

### F3 — `JiraBoardNotFoundError` can still reach `classifyError`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/integrations/sync/run-sync.ts:373`
- **Detail**: The plan states "`JiraBoardNotFoundError` is caught by the reconciler
  and never reaches [`classifyError`]". That holds for the stored-board call, which
  is wrapped in try/catch, but not for the second `getActiveSprint` in the discovery
  branch (`reconcile-sprint.ts:157`) — if a freshly listed board is deleted between
  the two calls, the error propagates. `classifyError` has no branch for it, so it
  lands in the generic tail as `status: "ERROR"` with the message "Jira board N no
  longer exists." That is a defensible outcome (owner-actionable, token-free), so
  this is a documentation gap rather than a defect: the plan's absolute claim is
  wrong in a narrow race.
- **Fix**: Either wrap the discovery-branch call in the same catch (returning
  `no_board`), or correct the plan's claim. No behaviour change is required.

### F4 — The override carry-forward read is `NULLS FIRST`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/integrations/reconcile-sprint.ts:185-190`
- **Detail**: The `previous` read orders `desc(sprint.startDate)` with no NULLS
  handling. Postgres `ORDER BY … DESC` is NULLS FIRST, so a dateless row would
  outrank a correctly dated one and become the row an override is carried from —
  the exact hazard the plan flagged under *Key Discoveries* and that
  `getActiveSprintRow` (`sprint.ts:33`) carries a comment about. Unreachable today:
  both writers refuse dateless rows (`hasDates`, and this module's `sprint_undated`
  branch), and `run-sync` only touches `committedSp`/`completedSp`. Recorded because
  the invariant is enforced by convention at two call sites rather than by the query.
- **Fix**: Append `NULLS LAST` to the ordering, matching the intent already written
  into `sprint.ts`.

### F5 — Between sprints, the cycle demotes the row and then still pulls it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/integrations/sync/run-sync.ts:673-676`
- **Detail**: `storedSprint` is read *before* the reconcile. When Jira reports no
  active sprint and the stored row's `endDate` has passed, the reconciler flips it to
  `CLOSED`, then `chosenSprint` falls back to that same (now stale-in-memory) row and
  the cycle pulls its tickets and rewrites its `committedSp`/`completedSp`. So a
  sprint the database just declared finished keeps being synced every 15 minutes.
  Not a regression — pre-S-16 the cycle also synced the stored sprint — and it keeps
  the dashboard's last-good view fresh, which is the C3 intent. But it is an
  unstated consequence of the F4-fix demotion interacting with the fallback, and
  plan case (d) does not reach it (it deliberately uses a future `endDate`).
- **Fix A ⭐ Recommended**: Leave the behaviour, record it at the seam.
  - Strength: Keeps the last good sprint rendering with fresh scalars, which is what
    C3 exists to protect; changing it risks a between-sprints dashboard going stale.
  - Tradeoff: A closed sprint keeps consuming a `searchSprintIssues` call per cycle.
  - Confidence: HIGH — the alternative regresses the C3 guarantee this slice states.
  - Blind spot: Not measured how long a real team sits between sprints.
- **Fix B**: Skip the pull when the reconcile demoted the fallback row.
  - Strength: Stops syncing a finished sprint; saves one subrequest per cycle.
  - Tradeoff: The dashboard's scalars freeze at the moment of demotion, and the
    `SKIPPED` reason would need a sixth vocabulary entry.
  - Confidence: MEDIUM — no evidence anyone wants the freeze.
  - Blind spot: Interaction with S-12 recap history is unexamined.

### F6 — The wizard now shows stored cadence, not derived cadence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/integrations/roster-store.ts:cadenceFromRow`
- **Detail**: `importCadence` previously returned `deriveCadence`'s output; it now
  reads the persisted row back. These differ exactly when `cadence_overridden = true`
  — the old code showed the derived 14 days while the database held the owner's 21.
  The new behaviour is the better one (the form shows what is actually stored), but
  it is a user-visible change the plan does not mention, and manual row 2.7 is
  worded against the old expectation ("the auto-pulled sprint name and cadence").
- **Fix**: Keep it; note in the plan's Phase 2 section that the wizard now reflects a
  live override, and reword manual row 2.7 so a 21-day display is a pass, not a fail.

## Triage (2026-08-26)

| Finding | Decision |
|---|---|
| F1 | **FIXED** — `importCadence` now passes `storedBoardId: null` unconditionally (`roster-store.ts:777-786`); unused `coerceStoredBoardId` import dropped. |
| F2 | **FIXED** — reconciler cases (l) and (m) added: a stored board that 404s falls back to discovery and repoints `board_id`; a 5xx on the same call propagates instead of re-discovering. |
| F3 | **SKIPPED** — narrow race, and the generic `classifyError` tail already yields an owner-actionable, token-free `ERROR`. The plan's absolute claim stays inaccurate; recorded here rather than chased. |
| F4 | **SKIPPED** — unreachable today (both writers refuse dateless rows). Recorded so the next reader knows the invariant is held by convention, not by the query. |
| F5 | **ACCEPTED (Fix A)** — behaviour kept: pulling the demoted sprint is what keeps the between-sprints dashboard fresh, which is the C3 guarantee. |
| F6 | **ACCEPTED** — the wizard showing stored (overridden) cadence instead of derived is the better behaviour; manual row 2.7 should treat a 21-day display as a pass. |

Post-triage gates: `tsc` clean, lint 0 errors, 437 unit, **174** integration
(was 172; +2 from F2).
