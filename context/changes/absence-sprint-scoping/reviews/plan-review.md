<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Absence sprint scoping (S-20)

- **Plan**: `context/changes/absence-sprint-scoping/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → SOUND after triage (all three findings fixed in the plan)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → fixed (F1) |
| Plan Completeness | WARNING → fixed (F2, F3) |

## Grounding

14/14 paths ✓ · 12/12 symbols and line anchors ✓ · brief↔plan ✓

Verified against the code rather than taken from the plan:

- `sprint-at-risk.ts:146` is the ONLY `absence.sprintId` reader in `src/` (grep over all non-test sources); `reconcile-sprint.ts` has zero `absence` references, as claimed.
- `seedScenario` early-returns at `detect.integration.test.ts:87`; the `teamMember` insert sits at `:105-113` and does not depend on the sprint row.
- `getActiveSprintRow` (`sprint.ts:19-42`) falls back to the most-recently-started sprint of any state, so NULL is reachable only for an owner with zero sprint rows — the plan's claim holds.
- roadmap anchors `:54`, `:567`, `:573`, `:646-679`, `:1085` and archive anchors `absence-calendar/plan.md:154-163`, `:488-490`, `sprint-reconciliation/research.md:119`, `:271` all say what the plan says they say.
- Gate 2.5's grep matches two live sites today (`sprint-at-risk.ts:121`, `roadmap.md:662`) — it is a real gate, not a vacuous one.
- Progress↔Phase mechanical contract is well-formed: one `## Progress`, matching `### Phase N` headings, one Progress row per Success-Criteria bullet, no stray checkboxes in phase bodies.
- `makeAbsence` (`test-support.ts:156-168`) uses a fixed `id: "absence-1"` and a Mon 10 → Fri 14 window, so the plan's `dedupKey` / `workingDaysLost: 5` / `workingDaysLeft: 5` expectations for the inverted test are correct.

Checked and deliberately NOT raised as findings:

- **No duplicate inbox rows across the rollover.** `reader.ts:57-60` filters anomalies by `sprint_id` and `detect.ts` reconciles within `(owner_id, sprint_id)`, so the frozen ACTIVE row in sprint N is invisible on N+1's dashboard. The widened predicate adds a row in N+1; it does not surface two.
- **Blast radius is genuinely narrow.** The stamp can only differ from the snapshot's sprint in two situations — a NULL stamp (owner had zero sprint rows at write time) and two or more sprint rows. Both are exactly the two integration cases the plan adds. Between sprints, `getActiveSprintRow`'s fallback stamps and reads the same row, so behaviour is unchanged there.

## Findings

### F1 — The anomaly's own copy contradicts the case the reversal enables

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 ("Nothing else in the file moves")
- **Detail**: `sprint-at-risk.ts:177` writes "… is unexpectedly away for N of the M working day(s) left in the sprint — the commitment did not account for it." In the carried-over case the slice newly enables (stamped N, fires in N+1) the trailing clause is false: the absence was recorded before N+1 was planned, and `capacity.ts:164-176` — date-based and untouched by this slice — had already subtracted it from N+1's man-days before the commitment was made. The same row would claim the commitment ignored what the capacity number it is judged against already accounted for. The Phase 1 contract froze the file below `:147` and no test asserts on description text, so nothing in the slice would have surfaced it.
- **Fix A ⭐ Recommended**: Drop the trailing clause; keep the true first half.
  - Strength: One string edit in a file Phase 1 already opens; "away for N of the M working days left" is true in every sprint the dates touch, which is what the date rule asserts.
  - Tradeoff: Slightly less punch in the common same-sprint case where the clause is accurate.
  - Confidence: HIGH — the clause is a literal, and no test pins it (`toMatchObject` on `context` / `dedupKey` / `magnitude` only).
  - Blind spot: FR-018 renders `description` verbatim — worth a glance that no recap test pins the old string.
- **Fix B**: Branch the copy on whether the absence predates sprint start.
  - Strength: Keeps the sharp wording where true, says something honest where not.
  - Tradeoff: Re-introduces a sprint-membership judgement one layer above the predicate S-20 just deleted.
  - Confidence: MED.
  - Blind spot: A carry-over is indistinguishable from an absence merely starting early without reading `created_at`.
- **Decision**: FIXED via Fix A. Applied to Phase 1 §1, with one addition found during triage: `src/lib/demo/fixture.ts:640` hard-codes the full sentence for the demo's pre-baked `SPRINT_AT_RISK` row and must change in the same commit. A new automated gate (Progress 1.7, `grep -rn "did not account for it" src/` returns nothing) holds the two sites together.

### F2 — Three open manual rows, a two-row checklist, and no home for the other two

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5 + `## Progress`
- **Detail**: Progress carries three open manual rows — the app check plus 2.6/2.7, which are "read a Markdown file and confirm it no longer says X". Phase 2 §5 specified a two-row checklist and sent "the corresponding entries" to backlog §1, the list the non-technical tester works from. §3 "Zobowiązania dokumentacyjne (nie testy aplikacji)" exists for exactly the doc-reading kind. `scripts/manual-test-sweep.mjs` only checks that a section for the slice exists (verified: it reports 3 open rows for this plan and exits 1 today because no section exists yet), so gate 2.4 would pass either way and hide the mis-filing.
- **Fix**: State the split in §5 — the app row to §1, the two documentation rows to §3, closed by the implementer rather than the tester.
- **Decision**: FIXED. Applied to Phase 2 §5, including the note that the sweep cannot make this distinction for us.

### F3 — The NULL-stamp integration case needs an id the helper creates but never returns

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3 and §4
- **Detail**: §4 correctly notes the manual ACTIVE-sprint insert needs the owner's `jiraProject` id and that the helper creates it before the early return (`:82-86`) — but `seedScenario` does not return it, and §3 pins the contract shut ("`Seeded` keeps its shape"). The team-member side is already solved by `onlyMemberId` (`:334`); the project side had no equivalent, leaving the implementer to invent one mid-phase.
- **Fix**: Name a `projectIdOf(ownerId)` sibling to `onlyMemberId` inside the absences describe block.
- **Decision**: FIXED. Applied to Phase 1 §4.

## Plan edits applied during triage

1. Phase 1 §1 — the description-copy exception, its rationale, and the `demo/fixture.ts:640` twin site.
2. Phase 1 §4 — `projectIdOf(ownerId)` named explicitly.
3. Phase 2 §5 — backlog §1 / §3 split for the three manual rows.
4. Phase 1 Success Criteria + Progress — new automated row 1.7 (copy-drift grep); the manual row renumbered 1.7 → 1.8.
