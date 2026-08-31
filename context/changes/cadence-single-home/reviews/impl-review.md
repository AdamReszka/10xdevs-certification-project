<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: The cadence a lead chose has exactly one home in the database (S-32)

- **Plan**: `context/changes/cadence-single-home/plan.md`
- **Scope**: full plan — Phases 1–3 of 3
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING → PASS (F1 fixed) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS (F2, F3, F5 fixed) |
| Success Criteria | PASS |

## Grounding

**15/15 planned edits MATCH; zero drift.** Including the negatives the plan was
explicit about: `cadence-editor-view.test.ts` untouched, `reconcile-sprint.ts:345`
comment kept, `0023_flowery_flatman.sql` not edited, no new guard test added,
`context/archive/` not written to, and — the one the plan-review's F2 warned
about — the assertion in `reconcile-sprint.integration.test.ts` test (d) was
DELETED, not retargeted onto the resolver. No `resolvedFor` was introduced
anywhere in that file.

**Success criteria 13/13.** `typecheck` clean · `lint` 0 errors (4 pre-existing
warnings in untouched files) · 1369 unit · 411 integration · `db:migrate`
applied · `\d sprint` shows 15 columns with neither dropped one · exactly two
`DROP COLUMN` and two DDL statements total in `0024` · `manual-test-sweep.mjs`
exit 0. Criterion 1.5 is met more strictly than written: `schema.ts` no longer
matches the grep at all, because its tombstone uses snake_case.

**Blast radius independently confirmed.** Zero hits for either column name in
`e2e/`, `scripts/`, `supabase/`. Every `src/` hit classifies as the surviving
`sprint_cadence_override`, the unrelated `sprint_measurement.working_days`
integer column, or prose. `/team/days-off` — the page the deleted guard's own
blind-spot note called out — reads through `resolveCadenceFor`. Drizzle snapshot
chain validated: `0024_snapshot.json.prevId` matches `0023_snapshot.json.id`, and
diffing the two yields exactly two removed keys on `public.sprint` and nothing
else. `0023` still reads both columns and still runs at `idx: 23` against a table
that has them.

**Deleted tests assessed, not waved through.** The guard was a regex over source
with two writer-shaped blind spots; the schema now enforces the same condition
through the typechecker with none. The four backfill integration tests are
genuinely unrecoverable — they seed `cadenceOverridden: true`, which neither the
schema nor the database can express — and the exposure is small: `0023` is frozen
history and, with `BACKFILL_CADENCE_OVERRIDES` deleted, there is no second copy
left to drift from. The four removed assertions each leave their test still
proving its own name; three are compensated in place by a `resolvedFor` assertion
on the durable record, and the fourth's real guarantee (a reconcile must not
clobber the lead's pattern) is carried by its sibling test (c).

## Findings

### F1 — The roadmap's SECOND summary table still describes S-32 as unstarted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/roadmap.md:585` (`## Backlog Handoff`)
- **Detail**: Phase 3 §3 said "Detail block and summary row updated in place" —
  singular. There are two summary tables: `## At a glance` (`:66`) and
  `## Backlog Handoff` (`:585`). Only the first was updated. The second still
  reads `| S-32 | — | Retire what S-30 leaves behind… | yes |` — no Change ID, and
  `Ready for /10x-plan: yes` on a slice that shipped. Its Notes cell also still
  points the reader at `src/lib/cadence-override-readers.test.ts` as a live file
  that "sends the reader here"; that file was deleted in `8455a8f`.
  This is not a generic omission: the immediately preceding commit on main
  (`97ccce6`, "give S-32 a row in both summary tables") exists **specifically**
  because S-32 was missing from both, and that row's own text warns that "a slice
  invisible in the tables is a dangling promise". The plan inherited the singular
  wording and the implementation followed it faithfully — the plan was wrong here,
  not the execution.
  It is also about to get worse rather than better: `/10x-archive` flips the
  matched `## At a glance` row and the `### S-32:` body `Status:` line only, so
  the archive commit will leave a shipped, archived slice advertised as ready to
  plan.
- **Fix**: Update the `## Backlog Handoff` row in the same commit as the archive —
  `Change ID` → `cadence-single-home`, `Ready` → `done`, and replace the Notes
  cell's forward-looking prose with what shipped, dropping the pointer to the
  deleted guard file.
- **Decision**: FIXED

### F2 — The `cadence_overridden` half of the stale-prose sweep was never done

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/integrations/reconcile-sprint.ts:34`, `:85`; `src/lib/integrations/roster-store.ts:857`, `:1072`
- **Detail**: Commit `7f913fc` swept eleven comments naming `sprint.working_days`.
  The symmetric sweep for the flag was not run, and two of the survivors assert
  **current structure in the present tense** about a mechanism that now exists in
  zero places:
  - `reconcile-sprint.ts:34` — "so the `cadence_overridden` three-way SET, the
    'at most one ACTIVE row per owner' invariant, and the rollover anomaly sweep
    exist in exactly ONE place". The first of the three exists nowhere.
  - `roster-store.ts:857` — "The board selection, the upsert, and the
    `cadence_overridden` three-way SET all live in `reconcile-sprint.ts` now".
  Two more are weaker but still misleading: `reconcile-sprint.ts:85` ("the one
  function that already owns **the flag**") names a flag that is gone, and
  `roster-store.ts:1072` ("`sprint.cadence_overridden` is no longer written by
  this path at all") reads as though the column exists and some other path might
  write it. Sites that are legitimately historical and should stay:
  `reconcile-sprint.ts:345` and `:383`, `cadence-override.ts:8` and `:80`,
  `roster-store.ts:1198`, `cadence-form.tsx:61`, and the two test-file comments.
  This repo has recorded history of stale enumerations going unnoticed —
  `integration-card-copy.ts` went stale three times, which is why S-27 replaced it
  with a scan.
- **Fix**: One follow-up sweep mirroring `7f913fc`: rewrite the two present-tense
  assertions to name what actually exists, and put `:85` / `:1072` in the past
  tense. Prose only.
- **Decision**: FIXED

### F3 — The schema tombstone is a JSDoc block, so it now documents `createdAt`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/db/schema.ts:445-453`
- **Detail**: Phase 2 §1 said to remove the two fields "with the two docblocks
  that exist to explain why they were still there". The implementation replaced
  them with one combined tombstone instead — defensible, and better than a silent
  deletion — but it is a `/** … */` block with nothing between it and the next
  declaration, so TypeScript binds it to `createdAt`. IDE hover on
  `sprint.createdAt` now shows text about two dropped cadence columns. Its
  singular "this column" inside a block about two columns is a leftover of the
  merge. No runtime or type effect. The repo already has the right idiom for
  exactly this case at `src/db/schema.ts:1050` — `// NO \`is_default\` COLUMN
  (dropped by S-14): …` — a `//` comment precisely so it attaches to nothing.
- **Fix**: Convert the block to `//` lines, matching the `is_default` tombstone,
  and make "this column" plural.
- **Decision**: FIXED

### F4 — Eleven source edits landed after the epilogue with no Progress row

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit `7f913fc` (11 files)
- **Detail**: The comment-correction commit is the right work — every site
  described a dropped column as live, which is the exact defect class this slice
  exists to remove, and two of the eleven were more than wording (an operator
  `console.error` naming a dropped column, and a false claim that S-17 would write
  to it). But it landed AFTER the epilogue commit `fbdf3b8`, so `plan.md`
  `## Progress` carries no row and no SHA covering it. A reader reconciling the
  plan against the branch finds eleven source edits with no plan entry — the one
  place this slice's paper trail is thinner than the rest of it. The commit
  message itself is detailed, which limits the damage.
- **Fix**: Accept as-is (the commit message carries the record), or add one
  `## Progress` row under Phase 3 with `7f913fc` before archiving.
- **Decision**: FIXED

### F5 — A test name still promises to check "the flag"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/integrations/roster-store.integration.test.ts:868`
- **Detail**: `it("a FAILED Jira call leaves both the values and the flag exactly
  as they were")`. There is no flag. The body is correct — it asserts the surviving
  columns plus the record's full `provenance` — but the name sends a reader
  looking for something that does not exist.
- **Fix**: Rename to name the record, e.g. "…leaves both the columns and the
  override record exactly as they were".
- **Decision**: FIXED

### F6 — `0024`'s header does not say that applying it spends S-30's escape hatch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/db/migrations/0024_watery_rocket_racer.sql:1-20`; `MANUAL-CHECKLIST.md:25-48`
- **Detail**: The plan's `## Migration Notes` states it plainly — rollback is "a
  code revert plus a hand-written re-add migration — no longer 'just a code
  revert'". Neither the migration header nor the checklist row that actually
  applies it repeats that. Once `0024` lands on production, reverting to any
  pre-S-32 commit fails hard rather than silently: `reconcile-sprint.ts` at that
  commit emits an INSERT naming both columns and every reconcile errors `42703
  column does not exist`. The plan is about to be archived; the header and the
  checklist are where an operator will actually look.
- **Fix**: One sentence in the `0024` header (or in `MANUAL-CHECKLIST.md` row 1's
  "why it matters") saying the revert window closes when the migration lands.
- **Decision**: FIXED

## What was checked and found clean

- **Security** — nothing touched. No credential, encryption, logging or
  cross-account-isolation surface is in this diff; the owner-scoped predicates in
  `saveCadence` and the reconcile upsert target are unchanged.
- **Performance** — two fewer columns per row; no index, query plan or N+1 shape
  changed. `DROP COLUMN` is catalog-only in Postgres (no table rewrite).
- **Reliability** — the upsert's two branches stayed symmetric (`workingDays` left
  both; `cadenceOverridden` was insert-only with no conflict counterpart to
  orphan); `saveCadence`'s `NoSprintRowError` guard is unchanged in meaning,
  because dropping a column from a SET does not change whether the statement
  matches a row; the reworded `console.error` concatenates with correct spacing and
  still contains the substring `working-time.test.ts:456` asserts on.
- **Migration pattern** — a long hand-written header on a drizzle-GENERATED
  migration is well-precedented here (`0009`, `0023`), and the
  `ALTER TABLE "x" DROP COLUMN "y";` form with no `IF EXISTS` matches both drop
  precedents (`0012:3`, `0018:1`) exactly.
