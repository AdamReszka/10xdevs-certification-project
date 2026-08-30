<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence sprint scoping (S-20)

- **Plan**: `context/changes/absence-sprint-scoping/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (re-run at review time)

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 5 warnings, all pre-existing at `51d4c12` (`byJira`, `githubReview`, `K`, `DetectedAnomaly`, `round`) |
| `npx tsc --noEmit` | PASS — no output |
| `npm test` | PASS — 89 files, 1102 tests |
| `npm run test:integration` | PASS — 30 files, 339 tests |
| `node scripts/manual-test-sweep.mjs` | PASS — exit 0, `absence-sprint-scoping/plan.md` covered |
| `grep -n "sprintId" src/lib/anomaly/rules/sprint-at-risk.ts` | PASS — no match |
| `grep -rn "did not account for it" src/` | PASS — no match |
| `grep -rn "sprintId is the snapshot\|stamped with THIS sprint\|sprint_id.*differs from the snapshot" src/ context/foundation/` | PASS — no match |
| `absence-store.integration.test.ts` still asserts the stamp | PASS — `:160`, `:180`, `:270` intact |

Manual rows: `1.8` correctly pending (tester-owned). `2.6` / `2.7` are ticked in
`## Progress` and the diff carries their evidence (roadmap S-20 + S-26 rewritten;
the reversal marker leads recommendation **A** and the three-consumers paragraph
in `sprint-reconciliation/research.md`) — not rubber-stamped. See F2 for the half
that did not follow.

## Plan adherence detail

| Planned item | Verdict |
|---|---|
| `sprint-at-risk.ts` — delete `:146` predicate + F10 `KNOWN GAP` | MATCH |
| `sprint-at-risk.ts` — comment rewritten with the boundedness argument | MATCH (near-verbatim from the plan) |
| `sprint-at-risk.ts` — drop the "commitment did not account for it" clause | MATCH; guard order and magnitude arithmetic untouched |
| `demo/fixture.ts:640` — same literal, same commit | MATCH |
| `sprint-at-risk.test.ts:249-264` — invert the D2 assertion | MATCH (5 of 5 working days, as planned) |
| `sprint-at-risk.test.ts` — new `sprintId: null` case | MATCH |
| `sprint-at-risk.test.ts:236-247` — planned-absence guard untouched | MATCH |
| `detect.integration.test.ts` — `teamMember` insert above the early return | MATCH |
| `detect.integration.test.ts` — `projectIdOf` sibling to `onlyMemberId` | MATCH |
| `detect.integration.test.ts` — NULL-stamp + N→N+1 cases, hand-derived counts | MATCH (N flipped to CLOSED, not deleted, per the cascade note) |
| `absence-store.ts` — both docstrings re-based on provenance | MATCH |
| `validations/absence.ts:18-20` — trailing `is_planned` clause dropped | MATCH |
| `roadmap.md` — four edits (`:54`, `:567`, S-20 section, `:1085` + `:573`) | MATCH |
| Archive markers — dated, in place, original not rewritten | DRIFT — see F1 |
| `MANUAL-CHECKLIST.md` — 2 rows, honest about what is not hand-reproducible | MATCH |
| Backlog — `1.8` to §1, `2.6`/`2.7` to §3 | DRIFT — see F3 (deliberate and correct); §3 half MATCH |

## Findings

### F1 — The archive reversal marker swallows four lines of the decision it corrects

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/archive/2026-08-25-absence-calendar/plan.md:516-520`
- **Detail**: The marker block ends at `:516` and `:517` follows with no blank
  line, so Markdown lazy-continuation pulls `:517-520` — ` \`dedupKey\` keyed on
  the absence id … not left to the implementer:` — inside the blockquote. Four
  lines of S-08's original contract then render as S-20's reversal note. The
  plan's Phase 2 §4 contract is explicit that the original text is "**not**
  rewritten or deleted"; it is neither, but it is re-attributed, which is the
  same failure the in-place-marker convention exists to prevent. `:517` also
  carries a stray leading space. The sibling marker at `:163` is correctly
  fenced by blank lines on both sides, as is the house original at `:603`.
- **Fix**: Insert a blank line after `:516` and strip the leading space from
  `:517`, leaving the marker adjacent to (and before) the clause it corrects.
  - Strength: Preserves d8b2eeb's own principle — the correction precedes what
    it corrects — while restoring the paragraph to S-08's voice. Matches `:163`
    and `:603` exactly.
  - Tradeoff: The original paragraph is left split at a sentence boundary that
    already existed; nothing is reworded.
  - Confidence: HIGH — verified against the rendered lazy-continuation rule and
    the two correctly-formed markers in the same file.
  - Blind spot: None significant.
- **Decision**: FIXED — blank line after :516, leading space stripped from :517

### F2 — Rows 2.6 / 2.7 are ticked in the plan and still open in the backlog

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/foundation/manual-test-backlog.md:426,435`
- **Detail**: `plan.md ## Progress` marks `2.6` and `2.7` `- [x]`; the backlog's
  §3 rows for the same two obligations are still `- [ ]`. CLAUDE.md makes the
  backlog answer "what is left to test" for a second person, and the two files
  now disagree about work that is done. `manual-test-sweep.mjs` cannot catch
  this — it checks presence, not tick state, which is exactly why it exits 0.
  Secondary: the two Progress ticks carry no ` — <commit sha>` suffix that the
  Progress convention asks for (Phase 1's and Phase 2's automated rows all do).
- **Fix**: Tick `2.6` and `2.7` in backlog §3 with the closing date, and append
  the closing commit sha to both Progress rows.
  - Strength: Restores the invariant the project treats as load-bearing (backlog
    == plans) in the one direction the sweep cannot police.
  - Tradeoff: None — two-line edit in each file.
  - Confidence: HIGH — evidence for both rows is in the diff.
  - Blind spot: None significant.
- **Decision**: FIXED — backlog §3 rows ticked with date + sha; Progress rows carry 14338d8 / d8b2eeb

### F3 — Plan sends row 1.8 to backlog §1; the implementation opened its own section instead

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/absence-sprint-scoping/plan.md` (Phase 2 §5) vs
  `context/foundation/manual-test-backlog.md:2191`
- **Detail**: The plan directs the tester-facing row to "backlog **§1**, the list
  the second person works from". §1 is a **closed** section — "✅ ZAMKNIĘTA
  2026-08-29 … nie dopisuj tu nowych wierszy" — and every per-slice list since
  S-15 lives in its own numbered section (§7–§17). The implementation opened
  §20 and put `20.A` there, which is the right call and matches the file. The
  drift is in the plan's text, which now describes a placement the repo
  contradicts and would send the next reader to the wrong section.
- **Fix**: Correct the plan's Phase 2 §5 pointer from "§1" to "a new per-slice
  section, per §7–§17", noting it was resolved during implementation.
- **Decision**: FIXED — plan Phase 2 §5 now points at a new per-slice section (§7–§17), naming §20

### F4 — `change.md` title still promises the three-way reconciliation the slice dropped

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/absence-sprint-scoping/change.md:3`
- **Detail**: `title:` reads "The three consumers of a recorded absence agree
  which sprint it belongs to" — the framing Phase 2 removed from `roadmap.md:54`
  precisely because it describes a reconciliation that did not happen (two of
  the three consumers were already correct and were left untouched). The
  `## Notes` line carries the same sentence in Polish. Phase 2 enumerated six
  instructional sites and did not include this one; the folder is archived
  verbatim, so the superseded description ships with it.
- **Fix**: Reword `title:` and the `## Notes` line to match the roadmap's
  wording — `SPRINT_AT_RISK` matches a recorded absence by its dates.
- **Decision**: FIXED — title and Notes reworded to the roadmap's date-matching wording
