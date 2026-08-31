<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Working-days calendar (S-17)

- **Plan**: `context/changes/working-days-calendar/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed)
- **Findings**: 1 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

10/11 paths ✓ (one wrong — F7), 8/8 symbols ✓, migration `0025` is next ✓,
`## Progress` ↔ phase-criteria contract ✓, brief ↔ plan ✓.

Verified directly rather than assumed: `getNonWorkingDays` is unbounded by date
(`team-day-off-store.ts:93-112`); `computeSprintCapacity` already receives
`nonWorkingDays` as a required parameter (`capacity.ts:110-140`); `Tx` and
`db.transaction` precedent exist (`team-day-off-store.ts:36`,
`absence-store.ts:156`); demo is tenancy with its own `user` row
(`workspace.ts:29-50`) and the demo owner holds two `team_day_off` fixture rows
(`demo/fixture.ts:266-274`); Poland's rule table is arithmetically right —
Easter 2026 is 5 April, so Easter Monday 2026-04-06 and Corpus Christi (+60)
2026-06-04, 10 fixed + 4 Easter-relative = 14, and `fromYear: 2025` on 24
December is correct.

## Findings

### F1 — The notice's branch precedence is unspecified, and one reading regresses Phase 1

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §5
- **Detail**: Four notice members, no statement of which wins when several inputs
  are true. Two live states unresolved: an account with hand-typed rows and no
  country (nagged forever, or never offered derivation), and demo — the demo
  owner has two fixture rows and no country row, so a "pick a country" prompt
  would appear and silently reverse Phase 1's Progress row 1.8/1.9.
- **Decision**: FIXED via Fix A — explicit precedence table in Phase 4 §5,
  `isDemo` added as a third input and short-circuiting to `null`; new Progress
  row 4.14 verifies demo silence with a country absent.

### F2 — The "empty" branch nags the one account that verified it is empty

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §5
- **Detail**: The plan kept `"empty"` for "a country and an approved year but
  genuinely no rows" — i.e. a lead who picked Poland, unchecked every day because
  their team works them, and approved. The approval record is precisely the
  signal the calendar was reviewed; the plan-brief names that as the mitigation
  and Phase 4 spent it on the wrong state.
- **Decision**: FIXED — an approved year with zero kept days returns `null`; the
  `"empty"` member is explicitly retired by Phase 4 and the plan now says so and
  why. Phase 1 is unaffected.

### F3 — A sprint crossing 31 December is computed against a year nobody proposed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: A single-year proposal is silent in mid-December while the active
  sprint runs into January, so the capacity divisor and all five aging budgets
  count 1 and 6 January as ordinary working days. The recurrence argument fires
  one to three weeks after the lead committed to that sprint.
- **Decision**: FIXED via Fix A — `holidayProposal` takes `years: number[]`,
  the caller passes `[year(sprintStart), year(sprintEnd)]` deduplicated (no new
  read), the approval payload carries `years`, and the transaction stamps each.
  New Progress row 4.5 covers the boundary sprint.

### F4 — `team_day_off.source` is written and never read

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 §1/§4, Progress 2.7
- **Detail**: Nothing in any phase reads the column — the proposal takes
  `existingDays` unfiltered, and the plan argues the column is *not* what keeps a
  deleted holiday deleted. Manual row 2.7 ("all show as manually entered") asks
  for a display no phase builds.
- **Decision**: FIXED via Fix A — new Phase 2 §5 puts `source` through
  `toTeamDayOffRows` and renders it in the existing list the way `costsNothing`
  is already rendered; `listTeamDaysOff` returns it; row 2.7 rewritten to an
  observable condition.

### F5 — No MANUAL-CHECKLIST.md exists, and Migration Notes point at it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Migration Notes`; change folder
- **Detail**: The file CLAUDE.md requires per change did not exist, and the plan
  instructed the implementer to add a row to it. 12 manual rows across four
  phases with no statement of which block the slice.
- **Decision**: FIXED — `MANUAL-CHECKLIST.md` written with five rows: prod
  migration `0025` first (row 0, hard ordering dependency), then the empty-
  calendar sentence, demo silence, capacity movement after approval, and the
  delete-then-reload row. Migration Notes now cross-reference row 0.

### F6 — `calendarIsEmpty` is tested only through the injected set

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2; Testing Strategy
- **Detail**: The named test hands the set into the pure reducer — the shape
  `lessons.md` #49 warns about. The load-bearing claim (`getNonWorkingDays` is
  unbounded) is true today but unpinned; windowing that reader later would turn
  "holiday-free sprint" into "no calendar at all" with a green suite.
- **Decision**: FIXED — new Progress row 1.6: an integration test through
  `loadSprintCapacity` asserting zero rows → `true` and one row outside the
  sprint window → `false`.

### F7 — Two references to a file path that does not exist

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1/§2
- **Detail**: Cited as `team-day-off-view.ts:20-31,36-38`; the real module is
  `src/components/organisms/settings/team-days-off-view.ts` (plural, under
  `components/organisms/settings/`), with `costsNothing` at :31, `formatDayOff`
  at :52 and `toTeamDayOffRows` at :70-95. Phase 4 §4 tells the implementer to
  reuse both by name.
- **Decision**: FIXED — both citations corrected.

### F8 — An unsupported stored country code degrades to "nothing to propose"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3
- **Detail**: `lessons.md` #42 in miniature. A stored code no longer in
  `SUPPORTED_COUNTRIES` yields an empty proposal; the lead approves a year with
  zero holidays, indistinguishable from a team that works every day. Only
  reachable if a code is removed from the list after being stored.
- **Decision**: FIXED — a `"country_unavailable"` member added at row 1 of the
  precedence table, naming the stored code rather than folding it into "nothing
  to propose".
