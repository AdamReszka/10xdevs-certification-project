<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Team Navigation Section (S-19)

- **Plan**: `context/changes/team-navigation-section/plan.md`
- **Mode**: Deep (codebase verification run inline)
- **Date**: 2026-08-30
- **Verdict**: REVISE → **SOUND** after triage (all six findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 0 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

12/12 paths ✓, 5/5 live route refs in 3 files ✓, 26 stale backlog strings ✓,
`revalidatePath` one caller ✓, `boundary-inventory.test.ts` scope ✓, brief↔plan ✓.

Every quantified claim in the plan held exactly as written. The findings below
are all about what surrounds it — a sibling branch that had already finished, and
one silent-failure path introduced by Phase 2.

## Findings

### F1 — Phase 3's backlog numbers are already invalidated by S-26

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4, §5; Success Criteria 3.2
- **Detail**: `origin/feat/disconnect-data-retention` (S-26) is finished — epilogue
  committed, pushed, 8 commits ahead of `main` — and edits both files Phase 3
  rewrites. It appends `## 21. S-26 disconnect-data-retention` to the backlog while
  `origin/main` already holds `## 21. S-28 working-day-aging`, so the tail renumbers
  when S-26 lands and the plan's pinned `## 22. S-19` (plus rows 22.A–22.E, quoted
  again in `MANUAL-CHECKLIST.md`) claims a number someone else holds. Its new rows
  also add ~11 more `/settings/absences` and `/settings/team` strings — `grep -c`
  gives **26** on this branch and **33** on theirs — so "twenty-six occurrences" is
  stale on arrival and criterion 3.2 (`grep -c … returns 0`) goes red the moment
  S-26 merges. It touches `roadmap.md` too, which Phase 3 §2 rewrites.
- **Fix A ⭐ Recommended**: Rebase onto `main` before Phase 3; express the section
  number and the occurrence count relatively.
  - Strength: Phases 1–2 are pure `src/` work and do not collide with S-26 at all —
    only Phase 3 does, so deferring the rebase to that phase boundary keeps the code
    work moving now.
  - Tradeoff: Phase 3 is blocked until S-26's PR merges; if it stalls, close-out stalls.
  - Confidence: HIGH — verified in the actual branch diff, not inferred.
  - Blind spot: Whether S-26's PR is open and how soon it merges.
- **Fix B**: Write Phase 3 against S-26's branch content now (all 33 strings up front).
  - Strength: No waiting.
  - Tradeoff: Guesses S-26's post-merge section number; redone if their own
    21-vs-21 conflict resolves differently.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 3 gained a `Prerequisite: rebase onto main
  first` block recording the collision with evidence; the section number is now
  `<N>` ("next free number after the rebase — 22 today, 23 if S-26 lands first"),
  rows are `<N>.A`–`<N>.E`, and the count is "count them with `grep -c` after the
  rebase; do not trust the figure recorded here". Criterion 3.8 and the Phase 3
  manual criterion no longer name a literal section number.

### F2 — `/team/days-off` never enters `WORKSPACE_SCOPED_PATHS`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 (and Phase 1 §10)
- **Detail**: Phase 1 correctly repoints the two existing entries in
  `settings/demo/actions.ts:39-40`. Phase 2 then creates a THIRD workspace-scoped
  route — `/team/days-off` reads `listTeamDaysOff` under `resolveWorkspace()` — and
  no phase adds it to the array. After entering or resetting demo, that page renders
  the previous workspace's holidays until the next navigation. This is exactly the
  silent failure the plan-brief names as the slice's top risk, caught for Phase 1 and
  missed for Phase 2; backlog row `<N>.E` only exercised `/team/roster`, so nothing
  would have caught it.
- **Fix**: Add `/team/days-off` to `WORKSPACE_SCOPED_PATHS` as a Phase 2 change and
  extend the demo backlog row to open it too.
- **Decision**: FIXED — new Phase 2 §3 ("Workspace revalidation list gains the new
  route"), new Progress row `2.8` and matching manual criterion, and row `<N>.E`
  now covers both `/team/roster` and `/team/days-off`.

### F3 — The doorstep E2E spec enumerates the four nav labels

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis ("e2e is not affected"); What We're NOT Doing
- **Detail**: `e2e/setup-doorstep.spec.ts:71` loops over the literal list
  `["Dashboard", "Sprint Detail", "Settings", "Refinement"]` asserting each has
  `toHaveCount(0)` on the doorstep, under a comment about "four exits". Adding `Team`
  to `NAV_ITEMS` does not break the test — it silently stops covering the new link,
  and the comment becomes wrong. The plan's claim was narrower than it read: no spec
  references the moving *routes*, but one pins the *nav list* this slice changes.
  This is the recurring rule in `lessons.md` ("A parallel worktree cannot run the
  suite that guards the shape it is changing"), whose own text also corrects the
  exclusion rationale — the constraint is `test:e2e` in TWO worktrees at once, and
  S-26 has finished, so ports 3000 and 3098/3099 are free.
- **Fix**: Add `"Team"` to the label list and fix the "four exits" comment in Phase 1;
  soften the "e2e is not affected" claim; run that one spec.
- **Decision**: FIXED — new Phase 1 §11, corrected Current State paragraph and Key
  Discoveries bullet, rewritten "not doing" entry (full suite out, single spec in),
  new criterion/Progress row `1.7` (`npx playwright test e2e/setup-doorstep.spec.ts`).

### F4 — The Team tab strip is announced as "Settings sections"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1; What We're NOT Doing ("Renaming `SettingsTabs`")
- **Detail**: `settings-tabs.tsx:26` hard-codes `aria-label="Settings sections"`. The
  plan noted this and then reused the component verbatim, so the Team section would
  ship a nav announcing itself as Settings — user-facing copy, not a component name,
  and Phase 3 is precisely the phase for making the words match. Declining the
  *rename* is right; inheriting the label is a different call the plan did not separate.
- **Fix**: Optional `label?: string` prop defaulting to `"Settings sections"`;
  `/team/layout.tsx` passes `"Team sections"`. One prop, zero call-site churn.
- **Decision**: FIXED — new Phase 1 §2, Team layout contract updated to pass the
  label, Current State and Key Discoveries corrected, "not doing" entry now
  distinguishes the rename (declined) from the `aria-label` (fixed).

### F5 — The moved actions file keeps seven `[settings/absences]` log tags

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §6; Success Criteria 1.5
- **Detail**: `settings/absences/actions.ts` carries seven runtime strings naming its
  own route — six `toFailure(err, "[settings/absences] …")` tags (lines 92, 121, 142,
  181, 202) plus the `console.error` at line 230 — and a doc comment at line 29. §6's
  contract covered exports and importers but not these, so the operator log would
  name a route that from Phase 1 onward only redirects. Criterion 1.5 was also not
  machine-checkable: that grep returns ~35 lines today and "returns only comments and
  the two stub files" is a human judgment on a wall of historical prose.
- **Fix**: Add the log-tag and doc-comment rewrite to §6's contract; restate 1.5 as a
  precise grep that can actually return zero.
- **Decision**: FIXED — §6 now names the seven strings and the doc comment (all become
  `[team/absences]`); criterion 1.5 replaced by two exact greps (`href="/settings/(team|absences)"`
  and `(app)/settings/absences/actions|\[settings/absences\]`), with a note saying the
  loose grep is explicitly NOT the criterion.

### F6 — MANUAL-CHECKLIST sign-off numbers don't match Progress

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §6
- **Detail**: §6 said the rows carry `1.6`, `1.7`, `2.5`, `2.6`, `3.x`. `1.6` is an
  automated row (`test:integration`), `2.6` is the subtitle-copy check, and `3.x` is a
  literal placeholder. `CLAUDE.md` requires the phase number so `plan.md`'s Progress
  ticks in step, so a placeholder costs a round trip with the tester.
- **Fix**: Replace the list with the real mapping and drop `3.x`.
- **Decision**: FIXED — §6 now carries a mapping table (`<N>.A`→1.8, `<N>.B`→2.7,
  `<N>.C`→1.9, `<N>.D`→1.10 + 2.5, `<N>.E`→1.11 + 2.8), states that Phase 3 signs off
  nothing because it changes no clickable behaviour, and instructs re-reading the
  numbers against `## Progress` before writing the file.

## Post-triage verification

`## Progress` contract re-checked after all edits: 3/3 phase headings matched between
body and Progress; criterion counts equal per phase (Phase 1: 7 automated / 4 manual,
Phase 2: 4 / 4, Phase 3: 5 / 3); zero stray `- [ ]` checkboxes outside the Progress
section. Phase 1's `#### N.` item numbering re-sequenced 1–12 after the two insertions.
