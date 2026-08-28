<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phase 6 of 7 — "The relation, and the estimate" (commit `f166dc8`)
- **Date**: 2026-08-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

### What was verified

- `npm run typecheck` — pass (exit 0)
- `npm run lint` — pass, 0 errors / 5 warnings, all pre-existing in
  `src/lib/anomaly/rules/*` and `detect.integration.test.ts`; none in a Phase 6 file
- `npm test` — 68 files, 851 tests, all pass
- Progress rows 6.1 / 6.2 / 6.3 / 6.4 / 6.7 checked with `f166dc8`; manual rows
  6.5 / 6.6 correctly left unchecked. No rubber-stamping found.
- Plan file list vs. diff: every planned file present. Two additions beyond the
  literal file list — `src/lib/measurement/reader.ts`
  (`listSprintMeasurementsForOwner`) and the `emptyReason` split — are both
  named in the plan's own §1/§3 prose, so neither is scope creep.
- "What We're NOT Doing" respected: one number plus one average is not the
  multi-sprint trend chart that stays phase-2.

## Findings

### F1 — Phase 6 consumed the measurement series without clearing the tie-break its own prerequisite gated on

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `context/changes/capacity-in-man-days/follow-ups/review-fixes.md:21`, `src/lib/measurement/sweep.ts:162`
- **Detail**:
  Phase 4's impl-review (F3) wrote a file titled **"Phase 6 prerequisite"** with
  three questions "to decide before Phase 6 consumes the series", on the explicit
  grounds that "FR-024 averages normalised velocity across these records, so a
  double count does not stay local — it inflates the estimate the lead is shown."
  Phase 6 shipped the consumer. The file was not touched by `f166dc8`, no
  decision is recorded in the plan's Phase 6 section, and both halves of the
  premise still hold in the code:
  - `src/lib/sprint.ts:29-31` still documents that an owner can hold more than
    one `ACTIVE` sprint row, because `importCadence` conflicts on `jiraSprintId`
    and inserts rather than updates.
  - `sweep.ts:162` still computes `deliveredSp` from the `[sprintStart, sprintEnd]`
    window alone, deliberately not narrowed by `jira_ticket.sprint_id` (that
    non-narrowing is what integration test 4.10 protects).
  Two overlapping sprint windows therefore each count the same first-DONE
  instants, both records are finalized, and `estimateActiveSprintVelocity` averages
  both. The failure is silent: the lead sees a plausible, inflated `≈ N SP` with
  no signal that two records describe overlapping work.
  Not a code defect introduced by this phase — a gate the phase crossed without
  answering. The cheapest close is the follow-up's own question 1.
- **Fix**: Answer question 1 of the follow-up before Phase 7 — check whether the
  monitored board ever runs parallel sprints (`select jira_sprint_id, start_date,
  end_date, state from sprint where owner_id = '<owner>' order by start_date`,
  looking for overlapping windows). If it never does, record that in the plan's
  Phase 6 section as the decision and close the follow-up; if it can, the
  tie-break (questions 2–3) becomes a Phase 7 change to `sweep.ts` — and whatever
  is chosen must not narrow by `sprint_id`, which would regress 4.10.
  - Strength: Turns an open gate into a recorded decision at the cost of one
    query, and the honest outcome ("not reachable here") is the likely one for a
    single-team MVP account.
  - Tradeoff: If it *is* reachable, Phase 7 grows a schema-adjacent change late
    in the slice.
  - Confidence: HIGH — both halves of the premise re-verified in the code today.
  - Blind spot: Whether the real FM board runs parallel sprints is unverified;
    only the owner can answer it.
- **Decision**: FIXED — question 1 measured against local Postgres 2026-08-28
  (zero overlapping windows, one ACTIVE row per owner on both accounts); the
  decision and its re-check query are recorded in `plan.md` Phase 6 → "The
  overlapping-sprint tie-break, answered", and `follow-ups/review-fixes.md` is
  closed. Questions 2–3 deliberately left open.

### F2 — With ≥2 closed sprints and no usable ones, the estimate panel states a falsehood

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/components/organisms/dashboard/velocity-estimate.tsx:56-58`, `src/app/(app)/dashboard/page.tsx:118`
- **Detail**:
  The panel re-derives *why* the estimate is `null` from three loose props
  instead of being told. `hasCapacity` is `currentCapacity !== null` — i.e.
  "`getSprintCapacity` returned a row" — but `estimateActiveSprintVelocity`
  additionally returns `null` when `current.fullMd <= 0` (`estimate.ts:95`) and
  when fewer than two records *survive* its filters (`:94`), neither of which
  `hasCapacity` can see. So with, say, three finalized records whose
  `capacityAdjustedMd` is `0` (a sprint the whole team was away for, or one swept
  while the roster was empty), the panel renders:

  > SprintFlow has 3 closed sprints recorded and needs 2 before it will estimate.

  — a sentence that contradicts itself on screen. The same happens when the
  active sprint's `nominalMd` is `0` while ≥2 usable records exist.

  This is also the one place in the phase that reverses its own stated pattern.
  Phase 6 §1's rationale for extracting `reliability-kpi-view.ts` was that
  decisions belong in the pure sibling and "the component renders what it
  returns" — `VelocityEstimatePanel` instead branches on inputs the reducer has
  already judged.
- **Fix**: Have the reducer say why. Return a discriminated result from
  `estimateActiveSprintVelocity` (or a small `toVelocityEstimateView` sibling
  alongside it) carrying `usableSprints` and a reason of
  `too-few-sprints | no-capacity | none-measurable`, and let the panel render one
  string per reason. Drop the `hasCapacity`/`closedSprints` props in favour of it.
  - Strength: Removes the duplicated null-decision, matches the phase's own
    `*-view.ts` pattern, and makes each empty state assertable in `estimate.test.ts`
    — which today asserts only that `null` comes back, never what the lead is told.
  - Tradeoff: Touches the signature the plan's §2 Contract fixed, so the plan's
    contract line needs a one-line amendment.
  - Confidence: HIGH — the contradictory branch is reachable by inspection of
    `estimate.ts:86,94,95` against `page.tsx:118`.
  - Blind spot: How often a zero-capacity finalized record occurs in practice is
    unmeasured; the `nominalMd = 0` path is the rarer of the two.
- **Decision**: FIXED — `toVelocityEstimateView` in `estimate.ts` now returns
  `{ estimate, reason, closedSprints, usableSprints }` with
  `too-few-sprints | none-measurable | no-capacity`; the filter moved into one
  shared `normalisedVelocities` helper so the reported count and the divided
  count cannot drift; `velocity-estimate.tsx` branches on `view.reason` only;
  `page.tsx` passes the view; six empty-state assertions added to
  `estimate.test.ts`; plan §2 Contract amended. 857 tests pass.

### F3 — `DEFAULT_LIMIT = 12` silently makes FR-024's "average of past sprints" a rolling window

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/measurement/reader.ts:60,106`
- **Detail**:
  `listSprintMeasurementsForOwner` passes the default `limit(12)` through, and
  Phase 6 is the first consumer the series has ever had, so this is where the cap
  becomes load-bearing. FR-024 says "the average of past sprints' normalised
  velocity" with no window, and FR-023's retention exception was carved out of an
  explicit non-goal precisely because "an average that resets every three sprints
  is not an average". A 12-sprint rolling average is very likely the *better*
  statistic — recent sprints describe the current team — but that is a product
  decision the plan never states, and nothing on screen tells the lead the
  average covers at most 12 sprints. Note `sampleSize` *is* rendered, so the
  number is not hidden, merely unexplained.
- **Fix**: Record the intent in the plan's Phase 6 section — one sentence saying
  the average is a rolling 12-sprint window and why — or drop the limit for this
  caller if a lifetime average was meant.
- **Decision**: FIXED — intent recorded in `plan.md` Phase 6 §2 ("The average is
  a rolling window of at most 12 sprints"). No code change; the cap stays.

### F4 — `estimateNextSprintVelocity` is named for the sprint the phase decided it is not about

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/measurement/estimate.ts:68` (as shipped in `f166dc8`)
- **Detail**:
  Plan review F1 is the reason this phase exists in its current shape: the ratio
  is the **active** sprint's, not a future one's, because SprintFlow cannot see an
  unstarted window (S-18). The file's own header shouts that in capitals at
  `:10-14`, the JSDoc repeats it at `:71-74`, and the UI copy names the active
  sprint. The exported symbol still says `NextSprint`. The plan's §2 Contract
  specified this name, so this is faithful implementation of a stale contract
  rather than drift — but the call site in `page.tsx:120` reads as the exact claim
  four separate comments were written to deny.
- **Fix**: Rename to `estimateVelocity` (or `estimateActiveSprintVelocity`) and
  amend the §2 Contract line — three call sites, all in-repo.
- **Decision**: FIXED — renamed to `estimateActiveSprintVelocity` in
  `estimate.ts` and `estimate.test.ts`; plan §2 Contract amended with the old
  name recorded. Progress row 6.1's title left verbatim per the step-title
  convention, with the rename noted beside it.
