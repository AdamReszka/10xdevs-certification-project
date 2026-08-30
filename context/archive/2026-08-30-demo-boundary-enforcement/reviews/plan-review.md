<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-27 — The demo boundary is a gate, not a convention

- **Plan**: `context/changes/demo-boundary-enforcement/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → **SOUND after fixes** (8/8 applied)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

22/22 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓
(5 phases, 25 rows, every Success Criteria bullet matched; no stray checkboxes
outside `## Progress`). The five unguarded call sites were confirmed at the exact
lines the plan cites: `setup/github/actions.ts:96,136`,
`setup/jira/actions.ts:131,170,215`.

Verified separately and found to be a non-issue: the plan-brief's "widening five
error unions touches the forms that consume them". All consumers read
`result.message` generically (`github-connect-form.tsx:87,113`;
`jira-connect-form.tsx:100,127,163`); the only `error ===` switch is on
`incomplete_mapping`.

## Findings

### F1 — Phase 2 turns the doorstep's configure door into a silent loop

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §2 (wizard step pages)
- **Detail**: `setup-doorstep.tsx:88-90` renders the configure door as a plain
  `<a href={door.href}>` pointing at `/setup/github|jira|team`
  (`setup-doorstep-view.ts:57-91`). Phase 2 §2 makes all three
  `redirect("/setup")` in demo, so the door bounces back to the doorstep with no
  explanation. The banner already solved this — `handleFinishSetup`
  (`demo-banner.tsx:71-82`) calls `exitDemoAction()` first, with its rationale in
  the docstring. PRD FR-008's Socratic note makes the way back to the wizard a
  requirement while the real account is un-onboarded. Also falsifies the
  doorstep's own copy at `:97-99` ("Do konfiguracji wrócisz w każdej chwili").
- **Fix A ⭐ Recommended**: Configure door exits demo, then navigates.
- **Fix B**: Redirect to `/setup?blocked=demo` and render an explanation.
- **Decision**: FIXED via Fix A — Phase 2 gained §3 (doorstep configure door),
  the Desired End State states it, Progress row 2.6 covers it.

### F2 — Phase 2 misses the "Connect" control, which is the one a demo visitor sees

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — Reconnect control (now §4)
- **Detail**: The plan targets `integration-card.tsx:230-232`, the CONNECTED
  branch. `:140-160` returns EARLY when `!connected`, rendering
  `<Button asChild><a href={reconnectHref}>Connect {name}</a></Button>` — no
  `isDemo`, and no demo explanation (that paragraph is at `:249-255`, in the
  branch never reached). A visitor who took the demo door holds zero credentials,
  so that branch is exactly what they see: two live links into the routes §1 now
  bounces. Boundary holds; the stated end state does not.
- **Fix**: Disable the Connect control in the `!connected` branch too and surface
  the demo note there; name both branches in the Intent.
- **Decision**: FIXED — §4 retitled and extended; manual bullet + row 2.4 updated.

### F3 — Phase 4 leaves two enumerations standing, one of which Phase 2 makes short

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 4 (four copy surfaces) + criterion 4.3
- **Detail**: Phase 4's premise is that enumerations go short; it lists four
  surfaces and misses two of the same kind. `integration-card.tsx:249-255`
  enumerates "test połączenia, odłączenie integracji oraz zmiana monitorowanego
  projektu i repozytoriów" — which Phase 2 invalidates by adding
  Connect/Reconnect to the disabled set. `setup-doorstep.tsx:97-99` carries
  "Twoje prawdziwe integracje pozostają nietknięte". Criterion 4.3 greps the
  exact string "Twoje prawdziwe dane są nietknięte", matching only
  `demo-panel-view.ts:66`; three files carry a "nietknięt" variant.
- **Fix A ⭐ Recommended**: Add both to Phase 4; replace the card's list with the
  general guarantee.
- **Fix B**: Broaden 4.3 to a repo-wide "nietknięt" stem grep.
- **Decision**: FIXED via Fix A — Phase 4 gained §5 (card note) and §6
  (doorstep card); 4.3 broadened; rows 4.3 and 4.6 updated.

### F4 — The Phase 2 e2e asserts on a control its account cannot render

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — E2E for the shortest path (now §5)
- **Detail**: The only existing demo e2e (`setup-doorstep.spec.ts:114-155`)
  enters demo via `signUpFreshAccount` + the demo door — zero credentials. Under
  that account the card renders the not-connected branch, so the control is
  "Connect GitHub", not "Reconnect", and a Reconnect locator finds nothing.
  Reaching Reconnect means connecting against `e2e/github-fixture-server.mjs`
  first, then loading demo — a second fixture-server consumer under parallel
  workers.
- **Fix A ⭐ Recommended**: Assert on the not-connected card, matching the demo
  persona.
- **Fix B**: Connect GitHub via the fixture server, then load demo.
- **Decision**: FIXED via Fix A — §5 now records why the account shape decides
  the assertion; Success Criteria and Testing Strategy updated.

### F5 — Manual row 1.5 becomes unperformable once Phase 2 lands

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress 1.5
- **Detail**: "In demo, submitting the GitHub connect form shows the refusal."
  After Phase 2 the form is unreachable in demo by any route — the point of the
  slice. A second, non-technical tester works these rows after the whole slice
  ships (CLAUDE.md), so the row hands them an impossible instruction.
- **Fix**: Reword to the post-slice observable.
- **Decision**: FIXED — criterion and row 1.5 reworded; the during-Phase-1 check
  is kept as a parenthetical.

### F6 — MANUAL-CHECKLIST.md is promised by the plan and does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Desired End State
- **Detail**: The plan says the end state is verified by "the manual rows in
  MANUAL-CHECKLIST.md"; the folder held only change.md, plan-brief.md, plan.md,
  research.md. CLAUDE.md also requires a `manual-test-sweep.mjs` run and a
  backlog entry before the epilogue commit — neither appeared in any phase.
- **Fix**: Write the checklist; add the sweep as a closing step.
- **Decision**: FIXED — `MANUAL-CHECKLIST.md` written with five blocking rows
  (1.5, 2.5, 2.6, 3.4, 4.4), each carrying where / what to do / what must be
  true / why it matters. Phase 5 gained §2 (backlog reconciliation) and row 5.4.

### F7 — `openDemoAction` is specified as duplication, not delegation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §1
- **Detail**: "delegates: … → the `enterDemoAction` body; absent → the
  `loadDemoAction` body" describes copying two bodies — the exact drift the
  plan-brief names as this phase's risk. They are plain async functions in the
  same module, so a direct call works; the repeated resolvers are memoized.
  `findDemoOwner` takes `(db, realOwnerId)` (`workspace.ts:186`), not `()`.
- **Fix**: Restate §1 as a dispatcher over the two existing exported actions.
- **Decision**: FIXED — §1 now carries the four-line dispatcher and the corrected
  signature.

### F8 — The doorstep's demo door still says "Zobacz demo" after Phase 3

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2 / Phase 4
- **Detail**: Once the door re-enters instead of rebuilding, "Zobacz demo" on a
  revisit describes the wrong act — the distinction `DEMO_TRANSITION_LABEL`
  (`demo-panel-view.ts:70-75`) already draws.
- **Fix**: Fold the label into Phase 4, reusing the existing constant.
- **Decision**: FIXED — Phase 4 gained §7 (door label); Phase 3 §2 points at it.
