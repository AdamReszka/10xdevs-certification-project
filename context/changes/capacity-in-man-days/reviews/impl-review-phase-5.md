<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phase 5 of 7 — "The lead's override and correction" (commit `162eb16`)
- **Date**: 2026-08-28
- **Verdict**: NEEDS ATTENTION → triaged 2026-08-28: 7 fixed, 1 no-change-needed, 2 skipped
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Success criteria re-run (2026-08-28)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 5 warnings — all present on `main` too, none in Phase 5 files |
| `npm test` | 831 passed / 66 files |
| `npm run test:integration` | 265 passed / 22 files |

Progress 5.1–5.6 and 5.9 are ticked accurately against real assertions (see F5 for
the one caveat). Manual rows 5.7 / 5.8 are honestly left unticked.

## What was verified clean

Recorded so a later review does not re-derive it:

- **Owner scoping is correct on every statement.** `overrides.ts:152` carries
  `and(eq(sprint.ownerId, …), eq(sprint.jiraSprintId, …))` and throws
  `UnknownSprintError` on a miss, so a foreign sprint id is *refused*, not treated
  as new — the exact corollary `lessons.md` records. `overrides.integration.test.ts:271`
  proves it with a real but foreign sprint id and asserts neither account gained a row.
- **The sweep and the lead's writers are genuinely disjoint.** `sweep.ts`'s conflict
  `set` names no lead column; `writeLeadColumn`'s names only the one being written.
  `sprint_measurement_owner_sprint_uq` backs both `ON CONFLICT` targets.
- **The finalization guard claim holds.** It is `setWhere: isNull(finalizedAt)` on the
  sweep's upsert (`sweep.ts:213`) — Postgres-evaluated, no trigger anywhere — and
  `writeLeadColumn` omits it deliberately. Asserted at `overrides.integration.test.ts:251`.
- **A lead-created bare row does not block the sweep**: `shouldRecompute` (`sweep.ts:66`)
  and the `setWhere` both admit `finalized_at IS NULL`.
- **Validation runs server-side** (`actions.ts:57`, `:93`) before any DB call; the
  client `parse` is convenience only. `null` vs `0` is unambiguous end to end.
- **The `numeric`-is-a-string trap is closed** once at the boundary
  (`overrides.ts:213-215`), asserted with `toBe(12.5)`.
- **Pattern compliance is close to exact** against `settings/absences/actions.ts`,
  `team-days-off-editor.tsx`, `validations/team-day-off.ts` and `availability-view.ts`.
  The documented deviations (no re-detection, `no_active_sprint` as its own code,
  `router.refresh()` rather than `revalidatePath` — there is no `revalidatePath`
  anywhere in `src/`) are all justified in comments and correct.
- **The extra `capacity-adjustments-view.ts` + test is not scope creep** — it follows
  the CLAUDE.md rule that `.tsx` decision logic is extracted to a pure `.ts` sibling,
  the same rule the plan itself invokes for Phases 6 and 7.

## Findings

### F1 — An empty `type=number` field means "clear", so a typo silently deletes the override and reports success

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/dashboard/capacity-adjustments.tsx:155-165
- **Detail**: The doc comment at `:104-108` claims "`parse` returning `null` for an
  unparseable entry is a separate case, caught before the round trip." That branch is
  unreachable for `input[type=number]`: per the HTML value-sanitization algorithm, an
  entry that is not a valid floating-point number exposes `.value === ""`, so `onChange`
  writes `""` into state and the "clear it" path fires instead of the error path.
  **Failure scenario**: an override of 90 MD is saved. The lead means to change it to 92
  and types `9,2` (comma decimal separator — Polish keyboard) or fat-fingers `9o`. The
  browser sanitizes to `""`; the lead clicks Save; the action receives `{ md: null }`.
  The override is deleted and the toast reads "Capacity override cleared." A destructive
  outcome is reported as a deliberate one — and per FR-022/FR-024 that figure feeds
  every later normalisation.
- **Fix A ⭐ Recommended**: Make clearing an explicit act only — on Save with an empty
  field, show an error ("Nothing to save — use Reset to computed to clear it") rather
  than submitting `null`. The "Reset to computed" button at `:202-212` already exists
  as the intended clearing path.
  - Strength: Removes the destructive path entirely without changing the input type,
    and makes the two intentions ("set" / "clear") map to two distinct controls.
  - Tradeoff: A lead who expects "blank the field, save" to clear must learn the button.
  - Confidence: HIGH — the button is already rendered whenever `current !== null`,
    i.e. in exactly the state where clearing is meaningful.
  - Blind spot: Not checked whether any E2E test drives the blank-and-save path.
- **Fix B**: Switch to `type="text"` + `inputMode="decimal"` so a malformed entry
  survives in state and reaches the intended `parse → null` error branch.
  - Strength: Makes the existing doc comment true and preserves blank-means-clear.
  - Tradeoff: Loses the native numeric keypad/stepper affordances; needs its own
    parse handling for comma separators to actually help the Polish-keyboard case.
  - Confidence: MEDIUM — fixes the reachability but leaves "blank = destructive" intact.
  - Blind spot: No other numeric input in this repo uses `type="text"`, so it would be
    the first of its kind.
- **Decision**: FIXED via Fix A — clearing is now performed only by “Reset to computed”; an empty field on Save shows `emptyFieldMessage(current)` instead of submitting `null`. Help copy and the doc comment corrected to match.

### F2 — The action re-resolves the active sprint, so a rollover between render and click files the override against the wrong sprint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/dashboard/actions.ts:69, :105
- **Detail**: The header comment justifies server-side resolution as "the surface only
  ever edits the sprint it is displaying, which is the active one". The hole is that the
  displayed sprint is a snapshot taken at render while the action performs a *fresh*
  resolution — two reads separated by however long the tab was open.
  **Failure scenario**: the lead opens Availability while Sprint 41 is active and leaves
  the tab open. The 15-minute cron runs `reconcileActiveSprint`; Jira closes 41 and starts
  42. The lead returns, reads Sprint 41's figures still on screen, types `12`, clicks Save.
  `getActiveSprintRow` now returns Sprint 42 and the override lands there.
  `router.refresh()` repaints with Sprint 42's numbers plus the badge, so nothing
  announces the substitution. Sprint 41 finalizes without the override; Sprint 42 carries
  one the lead never intended, and it feeds FR-024's normalisation. `getActiveSprintRow`
  also falls back to *most recently started* (`src/lib/sprint.ts:36-42`), so between
  sprints the target can be a closed, already-finalized record.
- **Fix**: Carry the displayed `jiraSprintId` in the payload (add it to
  `capacityOverrideSaveSchema` / `deliveredCorrectionSaveSchema`) and let
  `writeLeadColumn`'s owner-scoped lookup be the authority.
  - Strength: It already throws `UnknownSprintError` on a foreign or stale id, and the
    action already maps that to "That sprint is out of date. Reload the page and try
    again." — a message that today has **no reachable producer**, since the action
    resolves the sprint itself. This gives it one, and turns a silent mis-file into a
    reload prompt. It is also the shape `lessons.md` prescribes (reject a stale id
    rather than silently retarget) and removes the duplicate sprint lookup in F9.
  - Tradeoff: The client now names a sprint, which the current comment argues against —
    but the store's owner-scoped refusal is what actually enforces isolation, not the
    client's silence.
  - Confidence: HIGH — the refusal path and its error mapping are already written and
    already tested (`overrides.integration.test.ts:271`).
  - Blind spot: Not verified whether Phase 6's panels will want the same payload shape.
- **Decision**: FIXED — `jiraSprintId` added to both save schemas and threaded page.tsx → availability.tsx → capacity-adjustments.tsx; the actions no longer call `getActiveSprintRow`, and `no_active_sprint` was removed as unreachable. `UnknownSprintError` is now the stale-page path it was written to be.

### F3 — The correction is bound to the active sprint, which is the one sprint FR-023 is not about

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/app/(app)/dashboard/actions.ts:105; src/components/organisms/dashboard/availability.tsx:177
- **Detail**: Two halves of one problem. `overrides.ts:27-32` drops the finalization
  guard on the explicit grounds that "a closed sprint is the only kind whose figure is
  worth fixing", and the store supports exactly that (`overrides.integration.test.ts:251`
  passes). But the only surface that reaches the writers targets
  `getActiveSprintRow`, and `CapacitySummary` returns `null` without a live capacity
  (`availability.tsx:177`). So: **(a)** once the next sprint goes ACTIVE, the previous
  sprint's `delivered_sp_corrected` is unreachable from any screen — and Phase 7's
  switcher is read-only by its own contract, so no later phase closes this; **(b)** the
  correction that *is* offered applies to a running sprint whose delivered figure is
  still moving. **Failure scenario for (b)**: on sprint day 4 the lead corrects a
  measured 8 SP to 21. The sprint goes on to deliver 34. The sweep writes
  `delivered_sp = 34` and finalizes; `delivered_sp_corrected` stays 21 (correctly — the
  writers are disjoint). Phase 6's `estimateNextSprintVelocity` prefers corrected over
  computed, so that sprint enters the velocity average at 21 forever, with no signal
  that the correction was entered mid-flight.
- **Fix A ⭐ Recommended**: Widen Phase 7 so the selected sprint is also the correction's
  target — the switcher already resolves a `jira_sprint_id`, which is exactly the payload
  F2 wants — and gate the delivered-SP field on `finalizedAt !== null`.
  - Strength: Makes FR-023 reachable for the sprint it was written about, and removes the
    mid-flight-correction trap in one move. Composes with F2 rather than fighting it.
  - Tradeoff: Phase 7 grows from read-only to read-write, which is the phase the plan
    calls "safely cuttable under deadline pressure" — cutting it would then also cut
    FR-023's correction path.
  - Confidence: MEDIUM — the store already supports it and needs no change; the work is
    surface plus one action-payload field. The scheduling risk is the real cost.
  - Blind spot: Have not checked whether the capacity override wants the same treatment
    (it plausibly does not — capacity is a plan for the whole window).
- **Fix B**: Keep the current scope and soften the claim — amend `overrides.ts:27-32`
  and the plan to record that the MVP corrects only the sprint currently resolved as
  active, with the closed-sprint path named as a follow-up.
  - Strength: Zero code risk; keeps Phase 7 cuttable; the comment stops overstating what
    ships.
  - Tradeoff: FR-023's stated purpose ("the lead may correct the recorded figure" of a
    closed sprint) is not met by the MVP, and the mid-flight trap stays live.
  - Confidence: HIGH — it is a documentation change only.
  - Blind spot: Phase 6's estimate consumes the corrected value either way, so the trap
    in (b) still needs at least a copy warning.
- **Decision**: FIXED via Fix A, in two parts. Part 1 (code, this phase): the delivered-SP field is gated on `finalizedAt !== null`, carried as `SprintAdjustments.isFinalized`. Part 2 (scope): plan.md Phase 7 gains §4 “The delivered-SP correction, on the SELECTED sprint” plus criteria 7.7/7.8/7.9, and states plainly that Phase 7 is no longer wholly cuttable.

### F4 — `step="0.5"` makes the browser reject values the schema explicitly accepts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/dashboard/capacity-adjustments.tsx:71 (with :181)
- **Detail**: The form is a plain `<form onSubmit>` with a `type="submit"` button and no
  `noValidate`, so native constraint validation runs first. With `min={0}` and
  `step="0.5"`, any value that is not a multiple of 0.5 is a `stepMismatch` and the
  browser blocks submission ("The two nearest valid values are 12 and 12.5"). But
  `capacityOverrideMdSchema` deliberately allows two decimals, and
  `measurement.test.ts:28` asserts `parse({ md: 0.29 })` succeeds. A mixed roster
  (0.75 FTE × 11 working days) computes 12.25 MD, which the lead then cannot enter.
  `formatNumber` (`:220`) also rounds the placeholder to one decimal, so copying the
  displayed computed figure can itself produce a stepMismatch.
- **Fix**: Use `step="0.01"` (or `step="any"`) on the MD field and let the server-side
  `atMostTwoDecimals` refinement be the authority. Keep `step="1"` for delivered SP —
  that one agrees with `.int()`.
- **Decision**: FIXED — `step="0.01"` on the MD field, with the reason recorded inline; `step="1"` kept for delivered SP.

### F5 — `getActiveSprintMeasurement` has no production caller, and Progress 5.9 is ticked against it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/measurement/overrides.ts:229-236
- **Detail**: The plan asked for `getActiveSprintMeasurement` to be joined to the
  `Promise.all`. It exists, but `page.tsx:84` calls the lower-level
  `getSprintMeasurement` instead — a *better* choice, documented inline at `:79-82`
  (the active sprint is already resolved at `:45`, so the higher-level helper would
  re-query for an answer already held), and the substance the plan cared about (one
  handle, one fan-out, `lessons.md` #3) is satisfied. The residue is that
  `getActiveSprintMeasurement`'s only callers are its own tests, while its docblock
  claims it is "the read the dashboard needs, and the one the server actions resolve
  their target sprint through" — neither is true. `lessons.md` names this shape
  directly: "dead code emits no signal, and the tests routed around it."
- **Fix**: Delete `getActiveSprintMeasurement` and repoint criterion 5.9 at
  `getSprintMeasurement` (which the same test file already exercises for owner scoping
  at `:329`), or keep it and record in `plan.md` which later phase consumes it. Either
  way correct the docblock, and do not leave a Progress item ticked against an
  unreachable path.
- **Decision**: FIXED — `getActiveSprintMeasurement` deleted; criterion 5.9 and the Phase 5 prose now name `getSprintMeasurement`, and the test block was repointed.

### F6 — No test covers the one ordering where the two insert paths actually contend

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/measurement/overrides.integration.test.ts:166-221
- **Detail**: `overrides.ts:123-128` claims "the computed columns stay NULL for the
  sweep's next pass, which is free to fill them precisely because `finalized_at` is still
  NULL." The three tests are: lead creates a bare row and the computed columns are NULL
  (`:166`, **no sweep afterwards**); sweep first, then override (`:187`); sweep, override,
  sweep again (`:222`). None runs **lead-creates-bare-row → sweep → assert the sweep
  completed it**, which is the only claim in that comment block with no assertion behind
  it, and the only ordering where the writers' insert paths contend. (I verified the
  guard logic admits it — `shouldRecompute` returns true on `finalizedAt === null` — so
  this is missing coverage, not a suspected defect.)
- **Fix**: Add a fourth case to `describe("setCapacityOverride")`: override with no prior
  sweep, then `sweepSprintMeasurements`, then assert `capacityAdjustedMd` / `workingDays`
  are filled and `capacityOverrideMd` is unchanged.
- **Decision**: FIXED — new integration case “leaves a row it created for the sweep to complete”: override with no prior sweep → sweep at `AFTER` → asserts the computed columns and `finalized_at` are filled and the override is untouched. (First draft asserted `delivered_sp` at `now: START`, which is before the ticket's Done transition; corrected to sweep past the window.)

### F7 — A stray Save on an already-empty field creates an all-NULL measurement row

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/dashboard/capacity-adjustments.tsx:156
- **Detail**: Submitting `null` when `current` is already `null` makes `writeLeadColumn`
  INSERT a row carrying only the identity columns. Benign today — `reader.ts:75` filters
  `isNotNull(finalizedAt)`, so it never reaches the series, and the next sweep fills it
  provided the sprint has both dates. It becomes permanent litter only for a sprint that
  never gains both dates, where `sweep.ts:163` `continue`s forever.
- **Fix**: No-op the submit when `current === null` and the field is empty. F1's Fix A
  removes this path as a side effect.
- **Decision**: NO CHANGE NEEDED — closed as a side effect of F1: an empty field no longer submits `null`, so the all-NULL row can no longer be created this way.

### F8 — Two verbatim helper duplications

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/measurement/overrides.ts:57-60; src/components/organisms/dashboard/capacity-adjustments.tsx:219
- **Detail**: `mdToColumn` is byte-identical to `sweep.ts:71-74`, comment included — two
  copies of the `numeric(8,2)` write-side convention that can drift, while the read side
  correctly shares `toMd` from `reader.ts`. Separately, `formatNumber` reimplements
  `round1` from the `capacity-adjustments-view.ts` sibling it already sits beside.
- **Fix**: Move `mdToColumn` next to `toMd` in `reader.ts` and import it in both writers;
  have `formatNumber` call `round1`.
- **Decision**: SKIPPED — duplication accepted for now.

### F9 — Two different "delivered SP" numbers now render on one dashboard

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/app/(app)/dashboard/page.tsx:143 vs src/components/organisms/dashboard/availability.tsx:223
- **Detail**: Availability now shows `sprint_measurement.delivered_sp` (first-entry-into-Done
  semantics, Phase 3/4), while Reliability still shows `sprint.completedSp`
  (`page.tsx:143`), the live sync scalar. These are different definitions — a ticket that
  entered Done and later reopened counts in one and not the other — so the two tabs can
  legitimately disagree on screen with no explanation. Phase 6 §1 changes ReliabilityKpi's
  props to add capacity but does not say it switches the delivered term, so the divergence
  survives the plan as written.
- **Fix**: Decide in Phase 6 whether ReliabilityKpi's `completedSp` should come from the
  measurement record; if it deliberately should not, label the two figures so the
  difference reads as a definition, not a bug.
- **Decision**: FIXED (as a recorded decision) — plan.md Phase 6 §1 now requires this phase to choose one delivered-SP source or label two, with criterion 6.7 and a success-criteria row; shipping both silently is explicitly ruled out.

### F10 — The `jiraProject` join is not owner-scoped

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/measurement/overrides.ts:151
- **Detail**: `.innerJoin(jiraProject, eq(sprint.jiraProjectId, jiraProject.id))` carries
  no `eq(jiraProject.ownerId, ownerId)`. Not exploitable — the `sprint` row is already
  owner-scoped and the sync only ever points it at the owner's own project — and it
  matches `sweep.ts:114`, so this is symmetry rather than a defect. Flagged because this
  repo has no RLS and the house standard is that isolation is visible at the query.
- **Fix**: Add the owner predicate to the join in both `overrides.ts` and `sweep.ts`.
- **Decision**: SKIPPED — not exploitable, and symmetric with `sweep.ts:114`.
