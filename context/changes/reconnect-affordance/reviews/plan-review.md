<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-31 — Reconnect and Disconnect stop looking like the same decision

- **Plan**: `context/changes/reconnect-affordance/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → **SOUND** after triage (all 7 findings fixed in the plan)
- **Findings**: 2 critical, 5 warnings, 0 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

18/18 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓
(5 phases, 24 rows at review, 26 after fixes, all matched).
✗ 2 of 2 E2E break-sites named in Phase 4 were misidentified.
✗ 2 line refs drifted (`repo-selection-editor` :64→:66; `jira-project-editor`
"picker/cadence stages" — no cadence stage exists).
`docs/reference/contract-surfaces.md` absent — surface check skipped.

## Findings

### F1 — Jira's promise is derived from the wrong root

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Current State Analysis; Phase 1 → `reconnectCost`; Phase 1 test #3
- **Detail**: The plan claimed a Jira reconnect with a different project "deletes
  exactly the rows a disconnect deletes" and sourced `reconnectCost` from
  `DISCONNECT_IMPACT.jira.destroys`. `jira-store.ts:185-260` shows otherwise: the
  credential is upserted, the `jira_project` row is upserted with `id` omitted so
  it SURVIVES, `status_mapping` is deleted and re-inserted from the submitted form
  (REPLACED, not lost), and only `sprint` is deleted, cascading `jira_ticket` /
  `jira_status_history` / `anomaly`. That set is `DISCONNECT_IMPACT.projectSwitch`,
  and `disconnect-impact.ts:161-169` names this exact conflation as the failure the
  module exists to end. Shipped as planned, the card would tell the lead a project
  switch loses "the monitored Jira project and its status mapping" — it does not —
  and the test would pin that. Second consequence: the `destroys.length > 0 / === 0`
  switch cannot express the right answer, because `projectSwitch` is not keyed by
  integration name.
- **Fix A ⭐ Recommended**: explicit per-integration source map
  (`jira → projectSwitch.destroys`, `github → github.clears`).
  - Strength: stays inside the slice's licence (no edit to S-24/S-26's fact module),
    stays guarded by `disconnect-impact.test.ts`, makes the asymmetry visible.
  - Tradeoff: two named keys instead of one expression.
  - Confidence: HIGH — both store paths read directly.
  - Blind spot: None significant.
- **Fix B**: add a fourth root to `DISCONNECT_IMPACT` so the module owns the answer.
  - Strength: no judgement in the copy layer.
  - Tradeoff: edits S-24/S-26's module and widens its schema-derived guard.
  - Confidence: MED. Blind spot: whether the derivation generalises to a row-set root.
- **Decision**: FIXED via Fix A

### F2 — Phase 4's two named break-sites are both wrong

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 4 → "The four specs"; Current State Analysis (E2E paragraph)
- **Detail**: `setup-github.spec.ts:104` is the Cancel test clicking Disconnect and
  `:112-117` are `toContainText` assertions on S-26 dialog copy this slice does not
  touch; the "three controls" count is at `:167-183`, **dialog-scoped**, and is
  S-26's mutual non-containment guard written deliberately without `exact` —
  editing it toward "four" weakens it. `demo-boundary.spec.ts` never visits
  `/setup/github` or `/setup/jira`; it and `dashboard-sprint-detail.spec.ts:200-262`
  assert only the not-connected branch. Every connected-surface locator uses
  `{ exact: true }` on `"Disconnect"` / `"Connect"` (`e2e/disconnect.ts:54,68`,
  `setup-github.spec.ts:104,125,130,160`), so Phase 3's `Reconnect` link breaks
  none of them. No spec anywhere exercises the connected `/settings/connections`
  card. This is `lessons.md` #9 verbatim — the grep was run, the results read wrong.
- **Fix**: rewrite Phase 4 as additive — record the verified finding, empty the
  repair list, make new connected-card coverage the deliverable, keep the single
  local run as the gate.
- **Decision**: FIXED

### F3 — The one unrecoverable loss never reaches the card

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Current State Analysis (last bullet) → no backing phase
- **Detail**: The plan names the FR-023 commitment freeze (`run-sync.ts:907-917`,
  `sweep.ts:51-54`) as "the concrete unrecoverable casualty", then never puts it in
  a phase. It cannot arrive via the derivation — it is a column re-computation, not
  a table in the FK graph — so the promised "line saying what re-submitting costs"
  would omit the loss the plan itself calls unrecoverable.
- **Fix**: one hand-written clause on the Jira sentence, declared as not-derived in
  the module header with its two citations, plus Phase 1 assertion #8.
- **Decision**: FIXED

### F4 — "Change monitored project" is named as the safe route, and isn't

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 1 → `reconnectCost` jira branch
- **Detail**: `updateJiraProject` (`connection-service.ts:444-451`) runs the
  identical `delete(sprint)` cascade and additionally offers a `clear` mode that
  deletes hand-entered absences (`:453-458`), which the reconnect form has no mode
  for. The editor is not cheaper; it is equal, and in one mode worse. Its real
  advantage is the warning stage at `jira-project-editor.tsx:110-145`.
- **Fix**: reword to name the real distinction (same cost, shown first), plus a
  Phase 1 assertion that no comparative framing surrounds `selectionEditorLabel`.
- **Decision**: FIXED

### F5 — The wizard's promise points at a control that isn't on the wizard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 → "`CardContent` gains `reconnectCost(integration)`"
- **Detail**: `reconnectCost("jira")` quotes `Change monitored project`, a control
  that exists only on `/settings/connections`; the wizard status cards' footers hold
  `Disconnect` and `Continue` and nothing else. Same failure class as a stale label
  quote, but of SURFACE — which a pure-string test cannot catch.
- **Fix**: `reconnectCost(integration, surface)` with `"settings" | "wizard"`; the
  wizard variant omits the routing clause. Phase 1 assertion #7 pins both directions.
- **Decision**: FIXED

### F6 — "Test connection moves above the row" leaves the bottom-pin undecided

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 → contract item 1
- **Detail**: "Above the jobs row to sit with the status alerts" reads two ways;
  moving it out of the `mt-auto` block (`integration-card.tsx:263`) breaks the
  bottom-pinning the comment at `:260-262` exists for — which is what criterion
  2.10 checks. The plan gave a test for the outcome but no instruction.
- **Fix**: pin it — `Test connection` stays inside the `mt-auto` block as its first
  child, above `jobsIntro`.
- **Decision**: FIXED

### F7 — The `w-full` container list is under-enumerated and misnames a stage

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 → contract item 2
- **Detail**: The repo editor's open container is `:66`, not `:64`.
  `jira-project-editor.tsx` has FOUR open containers — `:112` warning, `:149`
  discarded, `:182` project, `:206` mapping — and no cadence stage. A missed
  container is a panel sharing a line with `Reconnect`.
- **Fix**: enumerate all five by line.
- **Decision**: FIXED

## Changes applied to the plan

- Current State Analysis: Jira project-switch bullet rewritten with the real
  cascade; E2E paragraph corrected.
- Desired End State: F4 and F5 wording.
- Key Discoveries: the per-integration source map replaces the length-branch bullet.
- Phase 1: `reconnectCost(integration, surface)`, explicit source map, non-derived
  freeze clause, assertions #3 (negative half), #5 (own-entry fragment sync),
  #7 (wizard variant), #8 (commitment freeze); "eight assertion groups".
- Phase 2: `Test connection` pinned inside `mt-auto`; five `w-full` containers
  enumerated; new manual criterion + Progress row 2.11.
- Phase 3: `reconnectCost(integration, "wizard")`; new manual criterion + row 3.7.
- Phase 4: renamed and rewritten as additive; new connected-card coverage step;
  existing specs marked read-only with the repair list empty.
- `plan-brief.md` synced on all of the above.
