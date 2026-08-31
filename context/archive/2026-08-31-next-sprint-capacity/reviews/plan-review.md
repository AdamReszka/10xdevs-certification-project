<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Next-window capacity as a number on the availability tab

- **Plan**: `context/changes/next-sprint-capacity/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-01
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F2, F4) |
| Blind Spots | WARNING (F3) |
| Plan Completeness | FAIL (F1, F5) |

## Grounding

11/11 existing paths ✓ (`next-window.ts` is new, expected), 6/6 symbols ✓,
brief↔plan ✓, Progress↔Phase mechanical contract ✓ (one `## Progress`, all three
phases matched, every success-criteria bullet has a numbered row, no stray
checkboxes in phase bodies).

## Findings

### F1 — The plan contradicts itself on whether the grid changes, and Progress 1.7 cannot pass

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries · Critical Implementation Details · Migration Notes · Progress 1.7
- **Detail**: Key Discoveries claimed the resolved cadence gives "identical output for an account that has never opened `/team/cadence`"; Critical Implementation Details says the forecast window deliberately drops the extra boundary day. The arithmetic backs the second, for every account: a normal Jira sprint (`2026-08-17T08:00Z` → `2026-08-31T08:00Z`) yields `deriveCadence` `lengthDays = 14` (`integrations/cadence.ts:99`, written on every reconcile at `reconcile-sprint.ts:365`); the old ms-span rule drew `09-01…09-15` = 15 day keys, the new rule draws `09-01…09-14` = 14. Manual row 1.7 ("draws the same days it drew before this phase") was therefore designed to fail, and Phase 1 blocks on it.
- **Fix**: Reword Key Discoveries (the superset is about the length SOURCE, not drawn days), rewrite Progress 1.7 to assert exactly `lengthDays` days with no shared day, extend Migration Notes to say every account loses one column.
- **Decision**: FIXED

### F2 — The zero-absence notice fires in the ordinary healthy case

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §2 — `next-window-capacity-view.ts`
- **Detail**: `absencesRecorded === 0` over a 14-day forward window is the normal state of a 3–10-person team, not evidence of missing data — the notice would be on almost always, and could not separate "checked, nobody is away" from "nothing entered", since both render as zero. The S-17 precedent it invoked is a different shape: `calendarIsEmpty` is account-wide and unbounded by date (`team-day-off-store.ts:104-110`), which is what makes an empty set mean "this lead has never done the work".
- **Fix A ⭐ Recommended**: Condition on an account-level fact — no absence anywhere ending after the current sprint's end (`hasForwardAbsence`), as a `limit(1)` existence read in the same fan-out.
  - Strength: The true analogue of `calendarIsEmpty`; separates the lead's habit from the fortnight's weather.
  - Tradeoff: One extra cheap indexed read.
  - Confidence: HIGH — the absence table is free-dated (`schema.ts:741`) and the index fits.
  - Blind spot: A lead who records forward once and then stops is still not caught.
- **Fix B**: Drop the second notice; keep the unconditional caveat only.
- **Decision**: FIXED via Fix A

### F3 — A "Projected" figure for a window that may already be in the past

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (window derivation) · Phase 3 §2 (the label)
- **Detail**: Nothing in the derivation takes `now` — the window is `sprintEnd + 1 day`, unconditionally. But `getActiveSprintRow` (`src/lib/sprint.ts:36-42`) falls back to the most-recently-STARTED sprint when none is ACTIVE, and `dashboard/page.tsx`'s own comment records that Jira can leave a sprint ACTIVE past its end date. Between sprints, or after a stalled sync, the "next window" is a fortnight that has already happened, and a `Projected` badge asserts the opposite. Today the second grid costs nothing (it only says who WAS away); a number makes it a false claim. Same stale-sprint case impl-review F1 on S-17 forced `holidayYears` to handle.
- **Fix A ⭐ Recommended**: Pass `now` into the view module; `isProjected` becomes a decision, and when the window's first day has arrived the badge is withheld and the caveat is replaced by an "already begun or ended" line.
  - Strength: Matches the house label-or-withhold rule; `now` stays a parameter, as in every neighbouring module.
  - Tradeoff: One more branch and two more unit cases; a copy decision the plan had not made.
  - Confidence: HIGH — the stale-sprint path is proven, not theorized.
  - Blind spot: The exact wording in that state is still to be written.
- **Fix B**: Withhold the figure entirely when the displayed sprint has ended.
- **Decision**: FIXED via Fix A

### F4 — Phase 1 splits one fan-out into two rounds, including inside the sweep's per-sprint loop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §2 · Performance Considerations
- **Detail**: Phase 1 §2 required the cadence read to be "sequenced ahead of the absence read rather than sitting beside it in the same `Promise.all`", while Performance Considerations reported only "no new queries". `getSprintCapacityFor` runs once per recomputable sprint in `sweep.ts:162`, so a cron cycle over N sprints would go from N round trips to 2N; `lessons.md` #3's surviving rule is one handle, one fan-out.
- **Fix**: Keep the single `Promise.all` and bound the absence read at `sprintEnd + MAX_CADENCE_LENGTH_DAYS`, the cadence editor's own ceiling (`z…max(90)`, `src/lib/validations/roster.ts:144`, exported as a named constant so there is one spelling). `computeSprintCapacity` clips and `buildAvailabilityGrid` filters already, so the extra rows are inert.
- **Decision**: FIXED

### F5 — Two citations an implementer would copy are slightly wrong

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis · Key Discoveries · Phase 1 §3
- **Detail**: (a) `pickCadence` tier 3 does not "derive length from the sprint's own dates" — it reads the stored `sprint.length_days` column (`cadence-override.ts:149`, via `resolveCadenceFor:210`), the reconciler's cache, falling back to `DEFAULT_CADENCE.lengthDays = 14` when NULL. (b) Phase 1 §3 said `resolveCadenceFor` "already takes exactly such a `Pick`"; its `Pick` has no `endDate` (`cadence-override.ts:204-207`) — the plan's is a superset, which is fine, but the sentence was not.
- **Fix**: Correct both sentences; name the NULL-`length_days` fallback as an accepted case in Critical Implementation Details.
- **Decision**: FIXED

## Verified and sound (no findings)

- Blast radius is exactly two callers of `getSprintCapacityFor` — `dashboard/page.tsx:124` and `sweep.ts:162` — and the sweep has an integration guard (`sweep.integration.test.ts`), so "must keep producing identical capacity numbers" is testable.
- The three-holiday-surface argument holds: `dashboard/page.tsx:149`, `days-off/page.tsx:61` and `team/actions.ts:307`'s server-side re-derivation are real, and the action does refuse years outside its own window.
- `npm run test:e2e -- cadence-restore` is a valid invocation (`playwright test <filter>`).
- Progress↔Phase mechanical contract passes; `/10x-implement` will parse it.
