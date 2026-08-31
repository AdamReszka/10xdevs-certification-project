<!-- PLAN-REVIEW-REPORT -->
# Plan Review: The cadence a lead chose has exactly one home in the database (S-32)

- **Plan**: `context/changes/cadence-single-home/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 2 warnings, 1 observation (all fixed in plan)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

16/16 paths ✓, 9/9 symbols ✓, brief↔plan ✓ — `schema.ts:444-466`,
`cadence-override.ts:524-553`, `reconcile-sprint.ts:229/363/366/391`,
`roster-store.ts:1156-1160`, `roadmap.md:66` and `:1534-1573`, `prd.md:237` are
all where the plan says. Blast radius independently confirmed: zero references to
either column in `e2e/`, `scripts/` or `supabase/`; `restoredFreeze` carries only
`committedSp`/`committedFrozenAt`; `MON_THU` stays used; `readFileSync` and `sql`
do go unused as predicted; `0022` is DML-only so the drizzle snapshot base is clean.

## Findings

### F1 — Criterion 3.3 is unachievable; no phase makes it true

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Success Criteria / Progress 3.3
- **Detail**: `node scripts/manual-test-sweep.mjs` fails today on exactly this plan
  ("brak sekcji w backlogu dla planu: context/changes/cadence-single-home/plan.md
  (3 otwartych)"). No phase writes the backlog section or a `MANUAL-CHECKLIST.md`,
  which CLAUDE.md requires per slice, so 3.3 could only ever fail. `lessons.md`
  § "A deploy that ships code but not migrations breaks silently" additionally
  requires the migration's production route be named and put on the checklist;
  `## Migration Notes` said "No production migration" instead.
- **Fix**: New Phase 3 item §4 covering `MANUAL-CHECKLIST.md` (production-migration
  row + rows 2.8/2.9) and backlog §27; `## Migration Notes` and the scope bullet
  now name `0024`'s route and record why the drop degrades cleanly if code runs
  ahead of it (`working_days` nullable, `cadence_overridden` DEFAULT false).
- **Decision**: FIXED

### F2 — The retarget at :358 relocates a guarantee onto a constant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §6 — `reconcile-sprint.integration.test.ts`
- **Detail**: Test (d) — "with no record at all, the cadence columns refresh from
  Jira" — seeds a stale Mon–Tue–Wed onto the sprint row (`:350`) and asserts the
  reconciler overwrote it (`:358`). The plan said to retarget `:358` "onto the
  resolver, which is where that guarantee now lives". It does not live there: with
  no override record `resolveCadenceFor` returns `DEFAULT_CADENCE.workingDays`
  unconditionally — tier 3 has no working-days input by construction, pinned by
  `cadence-override.test.ts:147` — so the retargeted assertion passes whatever the
  reconciler does. Separately, `:350` is the only `seedSprint` call site in the file
  passing `workingDays` (the other twelve literals are `seedOverride`) and the plan
  never named it, making it a Phase 2 typecheck error.
- **Fix**: Delete `:350` and `:358`; the `lengthDays`/`startDay` assertions at
  `:356-357` carry the test. The plan now states explicitly why NOT to retarget,
  and contrasts it with the sound `roster-store` retargets where a record is a real
  witness.
- **Decision**: FIXED

### F3 — Criterion 1.5's grep cannot return only schema.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria / Progress 1.5
- **Detail**: Two `cadenceOverridden` matches survive every Phase 1 edit and neither
  file was in the edit list: `cadence-editor-view.test.ts:11` and
  `reconcile-sprint.ts:346`. Both are historical prose worth keeping — `:346`
  explains the `carry` hole S-30 deleted.
- **Fix**: Both sites named as deliberate non-edits (new Phase 1 §5, plus a note in
  §3); criterion 1.5 narrowed to "no line of executable code matches", with the two
  comment lines exempted by name, in both Success Criteria and Progress.
- **Decision**: FIXED

### F4 — Three Phase 1 edits are at file granularity where the rest is line-exact

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3, §6
- **Detail**: `fixture.test.ts` imports no `DEFAULT_CADENCE` today. `roster-store.ts`
  has two in-function comments beyond the docblock at `:1090-1091`: `:1141-1144`
  points at a docblock Phase 2 deletes, and `:1170` says "the `sprint` columns above
  still took the values" — after this phase it is two, not three.
- **Fix**: Import and both comment sites added to the Phase 1 edit list; the
  `source` literal's continued use of `row.lengthDays`/`row.startDay` stated in the
  Contract so it is not swept up.
- **Decision**: FIXED
