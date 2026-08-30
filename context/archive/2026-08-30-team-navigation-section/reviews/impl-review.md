<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Team Navigation Section (S-19)

- **Plan**: `context/changes/team-navigation-section/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

### Automated criteria — all re-run at review time

| Criterion | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors (4 pre-existing warnings) |
| `npm test` | 1319 passed |
| `npm run test:integration` | 370 passed |
| `npm run build` | all four `/team/*` routes dynamic (`ƒ`), both stubs present |
| 1.5 — two precise greps | both empty |
| 1.7 — `e2e/setup-doorstep.spec.ts` | 4 passed |
| 3.1 — `node scripts/manual-test-sweep.mjs` | exit 0 |
| 3.2 — `grep -c` on the backlog | **returns 5, not 0** (see F3) |

### Manual criteria

11 rows pending (`1.8`–`1.11`, `2.5`–`2.8`, `3.6`–`3.8`), none marked complete
without evidence. Deferred by design to the tester; covered by
`MANUAL-CHECKLIST.md` and backlog §23.

## Findings

### F1 — Availability's "Manage" link no longer reaches the days-off editor it surfaces

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/organisms/dashboard/availability.tsx:144`, with `:234-236`
- **Detail**: The Availability card renders a `− N team days off already subtracted`
  line (`:234-236`), so team-day-off data is visible ON the dashboard. Its single
  `Manage` button used to point at `/settings/absences`, which carried BOTH
  editors — one click reached both halves of what the card shows. Phase 1
  repointed it to `/team/absences`, correct at that moment because the page still
  carried both. Phase 2 then moved the days-off editor to `/team/days-off` and did
  not revisit the inbound link. The plan's Phase 2 §5 added cross-references
  BETWEEN the two Team pages but never considered the link coming in from the
  dashboard. Not broken — the Absences subtitle names the Team days off tab, so
  it is two clicks — but the number the card displays no longer has a direct route
  to the surface that edits it.
- **Fix A ⭐ Recommended**: Add a second link to `/team/days-off` in the card header, beside `Manage`.
  - Strength: Restores one-click reach for both halves of what the card actually
    displays; the card already renders the days-off line, so the affordance
    matches the content.
  - Tradeoff: Two buttons in a card header that had one; needs a label that does
    not read as a duplicate of `Manage`.
  - Confidence: MEDIUM — the change is small and local, but the header's layout
    was not designed for two controls.
  - Blind spot: No manual pass has been run on this card since the split; the
    visual result is unverified.
- **Fix B**: Leave it. The Absences subtitle already points at the sibling tab.
  - Strength: Zero code change; the path exists and the slice shipped as planned.
  - Tradeoff: A lead reading `− 1 team day off` on the dashboard clicks `Manage`,
    lands on a page with no days off on it, and has to read a subtitle to find
    where they went.
  - Confidence: HIGH — the route is genuinely reachable.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `availability.tsx` header now carries two
  controls: `Manage` → `/team/absences` (outline) and `Days off` →
  `/team/days-off` (ghost), wrapped in a `flex shrink-0 gap-2` div, with a
  comment recording why the card needs two.

### F2 — An archived plan was edited; archived folders are read-only by convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `context/archive/2026-08-23-team-management-surface/plan.md:900-901`
- **Detail**: S-15 rows 5.3 and 5.4 were annotated in place with `⚠️ SUPERSEDED`.
  `/10x-archive` states that archived folders are read-only by convention and
  that other 10x skills refuse to write inside `context/archive/`. The plan's
  Phase 3 §4 contract did not ask for this — it said only that the replacements
  belong to S-19 and must carry S-19's number. The edit was made because a
  **ticked** row asserting a navigation path this slice deleted is actively
  misleading, which is CLAUDE.md's own stated principle about notes that outlive
  their repair. It is a deliberate, disclosed exception, not an oversight — but
  it is still an exception to a convention, and it is not recorded as one
  anywhere except the commit message.
- **Fix A ⭐ Recommended**: Keep the edit; make the exception explicit where conventions live.
  - Strength: Preserves the honesty win — a future reader of the S-15 plan is not
    misled — while stopping the precedent from being silent. The roadmap's S-19
    note already says "marked `SUPERSEDED` in the archive"; one line in
    `CLAUDE.md`'s archive paragraph would make the carve-out a rule rather than a
    one-off.
  - Tradeoff: Widens a convention on the strength of one case.
  - Confidence: MEDIUM — the case is clearly right; whether it generalises is
    the owner's call.
  - Blind spot: Have not checked whether other archived plans carry ticked rows
    invalidated by later slices, which would tell us how often this recurs.
- **Fix B**: Revert the archive edit; rely on backlog §23 and the roadmap note alone.
  - Strength: Convention held strictly; archived folders stay immutable.
  - Tradeoff: `plan.md:900-901` keeps asserting, as a **passed** test, a
    navigation path that no longer exists.
  - Confidence: HIGH — reverting is a two-line change.
  - Blind spot: None significant.
- **Decision**: KEPT via Fix A — the edit stands, and the exception is now a
  written rule. `CLAUDE.md` gained "The one licensed write into
  `context/archive/`" under the backlog-equality section: a **ticked** manual row
  invalidated by a later slice is annotated in place as
  `⚠️ SUPERSEDED <date> by <slice>` naming its replacement, and the replacement
  opens under the new slice's number. Nothing else in an archived folder is ever
  edited. S-19 is named as the precedent.

### F3 — Progress row 3.2 is ticked while its literal check returns 5

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/team-navigation-section/plan.md` `## Progress`, row 3.2
- **Detail**: The criterion reads "No stale path strings remain in
  `manual-test-backlog.md`", with `grep -c` expected to return 0. It returns 5.
  All five are deliberate and name the OLD paths *as* old paths: the header's
  dated reconciliation note, the §23 preamble, and row **23.C**, which cannot
  instruct a tester to verify the redirects without naming what to type. The
  criterion was written before §4 of the same phase mandated 23.C, so it became
  unsatisfiable by the plan's own design. The intent — no row *sends* the tester
  to a path that redirects — holds. Disclosed in the Phase 3 commit message, but
  the Progress row itself reads as cleanly satisfied.
- **Fix**: Append one addendum line under the plan's `## Progress` convention note recording that 3.2's literal count is 5 by design, naming the three sites.
- **Decision**: NOTED — recorded here and in the Phase 3 commit message; the plan
  is about to be archived, so no further edit. Intent of the criterion holds.

### F4 — Three doc comments edited outside the plan's file list

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/components/organisms/settings/absence-calendar-view.ts:6`,
  `absence-editor.tsx:66`, `team-days-off-editor.tsx:42`
- **Detail**: `absence-calendar-view.ts` appears nowhere in the plan's Changes
  Required; the other two were listed only for the action-import repoint. All
  three had doc comments naming their host route, which Phases 1 and 2 moved, so
  left alone they would have named a route that only redirects — the same
  argument the plan itself makes for the seven runtime log tags in §6. Disclosed
  to the owner at the end of Phase 1. Benign, and consistent with the plan's
  reasoning rather than against it.
- **Fix**: None needed. Recorded so the file list and the diff reconcile.
- **Decision**: NOTED — no action.

### F5 — Phase 3 §1 (section copy) was implemented in Phase 1

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/app/(app)/team/layout.tsx`
- **Detail**: The plan scheduled the Team section's heading and subtitle for
  Phase 3 ("Section copy"). They landed in Phase 1 with the layout, because a
  layout cannot be created without them. Phase 3 consequently had nothing to do
  for that item. Settings' subtitle was left unchanged, exactly as §1 specified.
  No behavioural difference; the phase boundary was the only casualty.
- **Fix**: None needed.
- **Decision**: NOTED — no action.

## Triage outcome (2026-08-31)

| Finding | Decision |
| --- | --- |
| F1 | FIXED via Fix A — second link in the Availability card |
| F2 | KEPT via Fix A — exception written into `CLAUDE.md` |
| F3 | NOTED |
| F4 | NOTED |
| F5 | NOTED |

Post-triage re-verification: `npm run typecheck`, `npm run lint`, `npm test`
(1319) and `npm run build` all green after the F1 edit.
