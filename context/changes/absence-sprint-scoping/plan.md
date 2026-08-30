# Absence sprint scoping (S-20) Implementation Plan

## Overview

`SPRINT_AT_RISK` decides whether a recorded absence belongs to the sprint it is
evaluating by comparing `absence.sprint_id` to the snapshot's sprint. That column
records something else entirely — which sprint was active at the moment the lead
typed the row. The owner has ruled that risk follows the absence's **dates**, as
every other absence reader in the codebase already does.

This slice deletes one predicate, proves the reversal with the two cases that
predicate made unreachable, and corrects the superseded rule (S-08's "D2") in
every place it is still stated — including two archived folders, because the
sentence that blocked this change for four days lives in one of them.

## Current State Analysis

**One reader in eight consults the stamp.** Every other absence reader resolves
membership from dates: `absence-store.ts:103` (`listAbsences`), `:263`
(`assertNoOverlap`), `load-snapshot.ts:90-99`, `capacity.ts:164-176`,
`capacity.ts:252`, `developer-inactive.ts:47`. Only
`sprint-at-risk.ts:146` — `if (absence.sprintId !== snapshot.sprint.id) continue;`
— compares the column.

**The two other consumers are correct and must not change.**
`capacity.ts:164-176` clips each absence to the sprint's own window and **has to
stay date-only**: `getSprintCapacityFor` is called by `measurement/sweep.ts:162`
to compute a **closed** sprint's capacity for the FR-023 measurement record, and
a closed sprint has no "active sprint" to compare a stamp against.
`developer-inactive.ts:47` matches a **rolling** `now − noCommitDays` window that
is not a sprint window at all and can precede sprint start. The owner confirmed
both after being shown that moving capacity to `sprint_id` would break S-23's
frozen record and FR-024's estimated velocity.

**The snapshot already carries the rows the rule is dropping.**
`load-snapshot.ts:90-99` windows absences by dates alone —
`startDate <= absencesUntil`, `endDate >= commitsSince`, where `commitsSince` is
the sprint's own start (`:44-46`). A cross-boundary absence is therefore already
in `snapshot.absences`; it is being discarded in the rule, not missing from the
data. **No loader change is needed, and no query changes.**

**`sprint_id` is a write-side provenance stamp.** `absence-store.ts:157` stamps
it from `getActiveSprintRow`, never from the row's own dates, and
`updateAbsence` deliberately never re-stamps (`:166-172`). It is kept off the
wire (`validations/absence.ts:18-20`). `reconcile-sprint.ts` contains **zero**
references to `absence`, so the re-stamping the code says "belongs with S-16" was
never built. After this slice the column has one writer and **no reader**.

**The old rule is still stated in nine places**, six of them instructions rather
than history:

| Where | What it says |
| --- | --- |
| `sprint-at-risk.ts:120-123` | "Scoped to absences stamped with THIS sprint… must stop raising risk at the rollover" |
| `sprint-at-risk.ts:141-145` | F10 `KNOWN GAP` — a NULL stamp can never raise risk; re-stamping "belongs with S-16" |
| `sprint-at-risk.ts:146` | the predicate itself |
| `absence-store.ts:115-128` | `createAbsence` docstring deriving the stamp from D2 |
| `absence-store.ts:166-172` | `updateAbsence` docstring, "moving the window does not move that judgement (D2)" |
| `validations/absence.ts:18-20` | "…and thereby change how `is_planned` is judged" |
| `sprint-at-risk.test.ts:249-264` | D2 encoded as a passing assertion |
| `roadmap.md:646-679`, `:1085` | S-20's own section, and S-26's sequencing note |
| `absence-calendar/plan.md:154-163`, `:488-490`; `sprint-reconciliation/research.md:119,271` | the recorded decision and the recommendation that deferred it |

**`schema.ts:646-652` is NOT in that list and must not be edited.** It invokes D2
to justify `is_planned`'s `true` default — and D2's *definition of planned-ness*
("was it known before the sprint started?") survives this change untouched.
What is reversed is only the inference drawn from it: *therefore* risk is scoped
by the recording sprint.

**Nothing has ever observed the divergence.** No test, fixture or manual row
exhibits it; the demo has one sprint and stamps all three of its absences with it
(`demo/fixture.ts:161-197`). This is a code-read finding from S-16 research, and
the plan treats it as one.

## Desired End State

An unplanned absence raises `SPRINT_AT_RISK` in whichever sprint its dates fall
in, for as long as its dates overlap what is left of that sprint — including a
sprint it was not recorded in, and including one recorded when the owner had no
sprint row at all. Verify by running `npm test` (the inverted unit assertion and
the new NULL case) and `npm run test:integration` (the two new end-to-end cases),
and by reading `roadmap.md` S-20 and the two amended archive files, none of which
still instruct a reader to scope absence risk by `sprint_id`.

### Key Discoveries

- **The "raises risk forever" fear behind D2 is bounded by the absence's own
  dates.** `overlaps(absence, now, endDate)` (`sprint-at-risk.ts:147`) stops
  firing the moment the absence ends. D2's stated worry — an absence that "keeps
  firing `SPRINT_AT_RISK` after the rollover"
  (`absence-calendar/plan.md:158-160`) — describes at most the one rollover the
  absence actually spans, not an unbounded condition. This argument appears
  nowhere in the repo and is the reason the reversal is safe; it belongs in the
  rewritten comment, not just in this plan.
- **`sprint-at-risk.ts:146` is the narrowing-predicate lesson verbatim.**
  `context/foundation/lessons.md:42-47` — "a narrowing predicate turns 'wrong
  value' into 'empty result', which reads as success". A `NULL` stamp is unequal
  to every sprint id, so the rule drops the absence in every sprint forever and
  reports nothing. Deleting the predicate dissolves F10 rather than documenting
  it a third time.
- **`seedScenario(false)` returns at `detect.integration.test.ts:87`, before the
  `teamMember` insert.** An owner with no sprint therefore has no roster, so the
  NULL-stamp case cannot be built from the helper as it stands. The insert does
  not depend on the sprint row and can move above the early return; the only
  existing consumer of `newScenario(false)` is `:241-245`, which asserts
  `{status: "skipped", reason: "no_sprint"}` and is unaffected.
- **`getActiveSprintRow` returns NULL only when the owner has zero sprint rows**
  (`sprint.ts:19-42`, two-tier fallback). That is the sole path to a NULL stamp,
  and it is the first-run window before the first sync ingests a sprint.
- **The house convention for correcting an archived decision is a dated
  in-place marker**, not a rewrite: `absence-calendar/plan.md:578`
  (`> **Amended after impl-review (2026-08-25, F7).**`),
  `capacity-in-man-days/plan.md:276`, `setup-team-roster-cadence/plan.md:426`
  (`SUPERSEDED 2026-08-30 by S-22`).

## What We're NOT Doing

- **No migration, and no schema edit.** `absence.sprint_id`, its
  `ON DELETE CASCADE` FK (`schema.ts:642-644`) and its relation
  (`schema.ts:1297-1300`) are left exactly as they are. That cascade is the
  data-loss path **S-26** owns, and `roadmap.md:1085` explicitly asks that the
  column not be settled twice. Keeping the slice migration-free is also what
  makes it safe to run in a parallel worktree alongside S-25/S-27.
- **Not dropping the column and not stopping the writer.** `createAbsence` keeps
  stamping. Stopping it would deliver half of S-26 — a smaller disconnect blast
  radius — without S-26's consent decision, and would destroy the provenance
  S-26 may want to use.
- **Not touching `capacity.ts` or `developer-inactive.ts`.** Both are correct;
  the frame's investigation and the owner both confirmed it.
- **Not re-deriving `is_planned`.** It stays the surprise flag, a user checkbox
  written verbatim on create and update. `schema.ts:646-652` stays as written.
- **Not adding a `sprint_id` re-stamp at rollover.** That is what
  `sprint-reconciliation/research.md:271` rejected, and this slice does not
  revive it — it removes the only reader that would have needed it.
- **Not changing `load-snapshot.ts`.** Its absence window is already date-based
  and already generous enough.
- **No PRD change.** FR-010 states only that an unplanned mid-sprint absence
  raises the sprint-risk score — which this change makes *more* true. D2 was a
  plan-level decision and was never in the PRD, so a `> Socratic (revised …)`
  entry would record a reversal the PRD never made.

## Implementation Approach

Two phases, in this order. Phase 1 changes behaviour and proves it; Phase 2
corrects the record. The order matters only in that the rewritten comments in
Phase 2 should describe code that already exists — but the phases are otherwise
independent and a reviewer can read either alone.

The centre of gravity is Phase 2, not Phase 1. Phase 1 is a deleted line and four
tests. Phase 2 is why this slice is a slice: three separate documents currently
instruct a future reader to re-derive the design the owner has just reversed, and
one of them (`sprint-reconciliation/research.md:271`) is exactly the citation
that deferred this change once already.

## Phase 1: The predicate and its proof

### Overview

Delete the `sprint_id` comparison from the absence condition and encode the new
behaviour in tests, including the two cases the predicate previously made
unreachable: a `NULL`-stamped absence, and an absence stamped with an earlier
sprint.

### Changes Required

#### 1. The rule

**File**: `src/lib/anomaly/rules/sprint-at-risk.ts`

**Intent**: Make the absence condition match on dates alone, like its seven
sibling readers. Remove the F10 `KNOWN GAP` comment — the gap is dissolved by
this change, not amended by it — and replace the block's "scoped to THIS sprint"
rationale with the reason the date reading is safe.

**Contract**: `:146` (`if (absence.sprintId !== snapshot.sprint.id) continue;`)
and the `KNOWN GAP` comment at `:141-145` are deleted. The condition's remaining
guards are unchanged and keep their order: `absence.isPlanned !== false` at
`:140` (strict `false`, per the `scope-creep.ts` precedent) then
`overlaps(absence, now, endDate)` at `:147`. Nothing else in the file moves — the
magnitude arithmetic at `:152-168`, the `dedupKey`, and the zero-denominator
guard are untouched — **with one exception, the copy**.

**The description's trailing clause goes (plan review F1).** `:177` reads
"… is unexpectedly away for N of the M working day(s) left in the sprint — **the
commitment did not account for it.**" In the case this slice newly enables — an
absence stamped with sprint N firing in N+1 — that clause is false: the absence
was recorded before N+1 was planned, and `capacity.ts:164-176` (date-based, and
deliberately untouched here) had already subtracted it from N+1's man-days before
the commitment was made. Leaving it would let the same row claim the commitment
ignored what the capacity number it is judged against already accounted for —
which is D2's real objection surviving in the copy layer after the predicate is
gone. The clause is dropped; the first half stands unchanged, because "away for N
of the M working days left" is true in every sprint the absence's dates touch,
which is exactly what the date rule asserts. `suggestedAction.sprintAtRiskAbsence`
(`suggested-action.ts:32`, "Re-plan around …") needs no change — re-planning is
the right action in both sprints.

`src/lib/demo/fixture.ts:640` hard-codes the full sentence for the demo's
pre-baked `SPRINT_AT_RISK` row and must be edited in the same commit, or the demo
shows copy the live rule can no longer produce. No test asserts on the string
(the unit cases use `toMatchObject` on `context` / `dedupKey` / `magnitude`), so
this is a two-site literal change, not a test-surface change.

The comment at `:119-123` is rewritten to carry the argument that makes the
reversal safe, which is currently written down nowhere:

```
// --- 3. Unplanned mid-sprint absences (S-08, FR-010) ----------------------
//
// Matched by DATES, like every other absence reader in this codebase
// (capacity.ts:164-176, developer-inactive.ts:47, absence-store.ts:103,263,
// load-snapshot.ts:90-99). It used to be scoped to `absence.sprint_id`
// instead — S-08's D2 rule, REVERSED 2026-08-30 (S-20) by the owner: risk
// follows the absence's dates into whichever sprint they fall in.
//
// D2 feared an absence that "keeps raising risk after the rollover, forever".
// It cannot: `overlaps(absence, now, endDate)` below stops firing the moment
// the absence ends, so the exposure is the one rollover the absence actually
// spans. `sprint_id` also records write-time provenance — which sprint was
// active when the lead typed the row — not membership, so comparing it
// answered a different question from the one asked here. A NULL stamp is
// unequal to every sprint id, which is why the old predicate silently
// dropped between-sprints absences in EVERY sprint (impl-review F10) —
// lessons.md, "a narrowing predicate turns 'wrong value' into 'empty
// result'". `is_planned` remains the surprise flag; only the scoping changed.
```

#### 2. Unit tests for the reversal

**File**: `src/lib/anomaly/rules/sprint-at-risk.test.ts`

**Intent**: Invert the assertion that encodes D2, and add the NULL case that had
no coverage at all.

**Contract**: The test at `:249-264` (`"stays silent for an absence stamped with
an EARLIER sprint"`) is rewritten, not deleted — its title and body invert to
assert the absence now fires. The default `makeAbsence` window
(`test-support.ts:163-164`, Mon 10 → Fri 14) against the fixture clock
(NOW = Mon 2026-08-10T12:00Z, sprint end Sat 2026-08-15, Mon–Fri, UTC) costs all
5 remaining working days, so the expectations mirror the existing
`"fires for an unplanned absence covering the rest of the sprint"` case at
`:163-189`: one anomaly, `magnitude: 1`, `workingDaysLost: 5`,
`workingDaysLeft: 5`. Its comment states that this is the D2 reversal and why the
old "forever" worry does not apply.

A sibling case covers `makeAbsence({ isPlanned: false, sprintId: null })` with the
same expectations, naming impl-review F10 as what it closes.

Every other assertion in the file is unchanged — in particular
`"stays silent for a PLANNED absence"` (`:236-247`), which is the guard proving
this change did not widen the rule to planned absences.

#### 3. A roster for the no-sprint scenario

**File**: `src/lib/anomaly/detect.integration.test.ts`

**Intent**: `seedScenario` returns at `:87` before inserting the team member, so
`newScenario(false)` yields an owner with no roster and the NULL-stamp case
cannot be built. The insert does not depend on the sprint row.

**Contract**: The `db.insert(teamMember)` call currently at `:105-113` moves
above the `if (!withSprint) return …` early return at `:87`. Nothing else about
the helper changes; `Seeded` keeps its shape and `newScenario(false)` keeps
returning empty strings for `sprintId` / `stalledPrRowId`. The existing
`"skips when the owner has no sprint"` test (`:241-245`) asserts only
`{ status: "skipped", reason: "no_sprint" }` and stays green.

#### 4. Integration coverage for the two previously-unreachable cases

**File**: `src/lib/anomaly/detect.integration.test.ts`

**Intent**: Prove the reversal through the real store and the real reconcile
loop, not against the pure rule. F10's own text is the reason this is worth the
DB round trip: *"The store test asserts the NULL is stored; nothing covers the
downstream consequence."*

**Contract**: Two cases added to the existing
`describe("detectAnomalies — absences (S-08, FR-010)")` block, reusing its
`absencesOf(ownerId, "absence")` helper.

- **NULL stamp, then a sprint appears.** `newScenario(false)` →
  `createAbsence` (which stamps `null`, since `getActiveSprintRow` finds no row)
  → assert the stored `sprint_id` is `null` → insert an ACTIVE sprint row over
  `SPRINT_START`/`SPRINT_END` → `detectAnomalies` → exactly one `condition:
  "absence"` row, `dedupKey` `SPRINT_AT_RISK:absence:<id>`.

  The sprint insert needs the owner's `jiraProject` id. The helper creates that
  project before the early return (`:82-86`) but does **not** return it, and
  `Seeded` keeps its shape (§3) — so add a `projectIdOf(ownerId)` sibling to
  `onlyMemberId` (`:334`) inside this describe block, selecting
  `jiraProject.id` by `ownerId`, in the same style. `onlyMemberId` already covers
  the team-member id `createAbsence` needs; it works here only because §3 moved
  the roster insert above the early return (plan review F3).
- **Stamped with sprint N, fires in N+1.** Full `newScenario()` →
  `createAbsence` unplanned with a window running past `SPRINT_END` → assert the
  stored `sprint_id` is sprint N's → flip N to `state: "CLOSED"` and insert an
  ACTIVE N+1 whose window covers the absence's later days → `detectAnomalies` at
  a clock inside N+1 → one `condition: "absence"` row, attributed to N+1.
  Flipping rather than deleting N is deliberate: `absence.sprint_id` is
  `ON DELETE CASCADE`, so deleting N would take the absence with it.

Both cases assert `workingDaysLost` / `workingDaysLeft` derived by hand from the
sprint window and a Mon–Fri week, per the convention the block already states at
`:439-443` (*"Hand-derived, not lifted from engine output"*).

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass, including the inverted D2 assertion and the new `sprintId: null` case: `npm test`
- Integration tests pass, including the NULL-stamp and cross-boundary cases: `npm run test:integration`
- `grep -n "sprintId" src/lib/anomaly/rules/sprint-at-risk.ts` returns nothing
- `absence-store.integration.test.ts` still asserts the stamp is written (`:160`, `:180`, `:270`) — the writer is unchanged
- The F1 copy change landed at BOTH sites, so the demo cannot show a sentence the rule can no longer produce: `grep -rn "did not account for it" src/` returns nothing

#### Manual Verification

- With an unplanned absence recorded for today through past the current sprint's end, `/dashboard` shows exactly one "unexpectedly away" `SPRINT_AT_RISK` row and its working-day count matches the sprint's remaining days — the guard that the widened predicate did not start double-firing

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 2. Phase blocks use plain bullets — the corresponding
checkboxes live in `## Progress`.

---

## Phase 2: The reversal recorded where the old rule still stands

### Overview

Correct the superseded rule in the six places that instruct a future reader, and
mark it as superseded in the two archived places that record it as history.
Without this, the next person to read `sprint-reconciliation/research.md:271`
re-derives the design the owner just reversed — which is how this change came to
be deferred once already.

### Changes Required

#### 1. The store's two docstrings

**File**: `src/lib/absence-store.ts`

**Intent**: Both docstrings derive the stamping rule from D2 and from the
`sprint-at-risk` comparison that no longer exists. The behaviour they describe is
unchanged — the *reason* they give for it is now wrong, and one of them
(`:126-128`) points at a comparison the reader will not find.

**Contract**: `createAbsence`'s docstring (`:115-128`) keeps "stamped SERVER-SIDE
from the owner's active sprint (or NULL when they have none) and deliberately
absent from the wire", drops the D2 planned-ness paragraph and the "Phase 4
comparison can never disagree" claim, and states plainly what the column now is:
write-time provenance — which sprint was active when the lead typed the row —
with **no reader in the codebase** since S-20, retained because
`absence.sprint_id` is `ON DELETE CASCADE` on `sprint` and **S-26** owns that
decision (`roadmap.md:1085`: do not settle the column twice). `updateAbsence`'s
docstring (`:166-172`) keeps "not re-stamped" and replaces the D2 rationale with
the same: there is nothing to keep in sync, because nothing reads it.

#### 2. The validation schema's note

**File**: `src/lib/validations/absence.ts`

**Intent**: `:18-20` justifies keeping `sprintId` off the wire by "so a client
cannot pin an absence to a sprint of its choosing **and thereby change how
`is_planned` is judged**". The first half stands; the trailing clause describes a
judgement nothing performs any more.

**Contract**: The trailing clause is dropped. The remaining sentence — server-
derived, not client-supplied — is unchanged, and so is the corresponding
docstring in `validations/absence.test.ts:15-16`, which never carried the D2
clause.

#### 3. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: S-20's section is written as an open question ("nothing states which
reading is canonical", "the slice is the *decision* plus its consistent
application"). It is now answered, and the answer is not the one the section
predicts.

**Contract**: Four edits.

- **`:646-679`, the S-20 section.** The Outcome is rewritten: not "all three
  consumers agree" but *`SPRINT_AT_RISK` matches absences by date, like every
  other reader; capacity and `DEVELOPER_INACTIVE` were already correct*. The
  "This is not simply a bug to fix" paragraph is replaced by the ruling and its
  two reasons — the owner's date rule, and the finding that `sprint_id` records
  provenance rather than membership. The "Related, deliberately excluded" F10
  paragraph records that F10 is **closed by this slice**, dissolved rather than
  documented. `Status: proposed` → `done`.
- **`:54`, the summary table row.** The description stops promising a three-way
  reconciliation; status column updated to match.
- **`:567`, the detail-table row.** "Decision slice, not a filter fix" is now
  misleading in the other direction — the decision was made, and it made the
  change small. Reword and mark done.
- **`:1085`, the S-26 sequencing note.** S-20 is no longer pending, so "Sequence
  S-20 first or fold the decision into it" becomes a statement of what S-20
  decided: the column is write-only provenance, `SET NULL` no longer collides
  with any reader, and S-26 is free to choose the referential action on its own
  merits. `:573`'s **blocked on S-20** is lifted.

#### 4. The two archived decisions

**File**: `context/archive/2026-08-25-absence-calendar/plan.md`,
`context/archive/2026-08-26-sprint-reconciliation/research.md`

**Intent**: These are history, not instructions — but `research.md:271` is the
sentence a future reader would cite to reject exactly this change, and
`plan.md:154-163` is the "recorded design rule" it cites in turn. Marked in
place, per the convention already used at `absence-calendar/plan.md:578`.

**Contract**: Dated in-place markers; the original text is **not** rewritten or
deleted.

- `absence-calendar/plan.md:154-163` (the D2 stamping rule) and `:488-490` (the
  Phase 4 contract's "whose `sprintId` is the snapshot's sprint") each gain a
  `> **REVERSED 2026-08-30 by S-20** (`context/changes/absence-sprint-scoping/`).`
  block naming what replaced it — date matching — and the reason the "forever"
  worry did not hold.
- `sprint-reconciliation/research.md:271` (recommendation **A**) and `:119` (the
  "three consumers disagree… a genuine owner call" paragraph) each gain the same
  marker, recording that the owner's call landed on dates, that only one of the
  three consumers turned out to be wrong, and that the deferral's reasoning —
  re-stamping would contradict D2 — was correct: S-20 removed the reader instead
  of adding a re-stamp.

#### 5. The manual checklist

**File**: `context/changes/absence-sprint-scoping/MANUAL-CHECKLIST.md` (new)

**Intent**: This slice destroys no data and adds no surface, so the checklist is
short by design. The one thing worth a human's eyes is that the widened predicate
did not start over-firing on the account's existing absence rows.

**Contract**: Two rows, each carrying where / what to do / what must be true /
why it matters, signed off with the phase number so `## Progress` can be ticked
in step. The rows must also state honestly that the reversal's two core cases
(NULL stamp, cross-boundary) are covered by integration tests and are not
hand-reproducible without DB access — otherwise the tester spends a session
trying.

**Where each Progress row goes (plan review F2).** This slice has three open
manual rows, and they are not the same kind of work:

- **1.8 — the only tester row.** It is an app check at `/settings/absences` +
  `/dashboard`, and it is what the two checklist rows above cover. Appended to
  `context/foundation/manual-test-backlog.md` **§1**, the list the second person
  works from.
- **2.6 and 2.7 — documentation obligations, not app tests.** Both are "read a
  Markdown file and confirm it no longer says X" (`roadmap.md` S-20 / S-26,
  `sprint-reconciliation/research.md:271`). They belong in backlog **§3
  "Zobowiązania dokumentacyjne (nie testy aplikacji)"** and are closed by the
  implementer at the end of Phase 2, not handed to the tester — a non-technical
  reader cannot judge whether a roadmap section still reads as an open
  reconciliation.

`node scripts/manual-test-sweep.mjs` must exit zero. Note it only checks that a
section for this slice EXISTS — it counts all three rows but cannot tell §1 from
§3, so the split above is a judgement the gate will not make for us.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests still pass after the comment edits: `npm test`
- The manual backlog covers this slice's open rows: `node scripts/manual-test-sweep.mjs` exits 0
- No instruction to scope absence risk by `sprint_id` survives outside a dated reversal marker: `grep -rn "sprintId is the snapshot\|stamped with THIS sprint\|sprint_id.*differs from the snapshot" src/ context/foundation/` returns nothing

#### Manual Verification

- Reading `roadmap.md` S-20 top to bottom leaves no impression that the three-way reconciliation is still open, and the S-26 entry no longer reads as blocked
- Reading `sprint-reconciliation/research.md:271` reaches the reversal marker before the recommendation it superseded

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests

- The D2 assertion inverts: an absence stamped with an earlier sprint now fires
  (`sprint-at-risk.test.ts:249-264`).
- A `sprintId: null` absence fires — impl-review F10, previously untested at any
  level.
- The planned-absence guard (`:236-247`) stays green, proving the predicate was
  narrowed on `sprint_id` only and not on `is_planned`.
- The existing magnitude, weekend, zero-denominator and days-off cases stay
  green, proving the arithmetic was not disturbed.

### Integration Tests

- A NULL-stamped absence recorded with no sprint row raises risk once a sprint
  row exists — the end-to-end consequence F10 said nothing covered.
- An absence stamped with sprint N raises risk in N+1 once N closes — the
  reversal itself, through the real store and the real reconcile loop.
- The existing raise-and-resolve-on-delete case (`detect.integration.test.ts:414`)
  stays green.

### Manual Testing Steps

1. Sign in, open `/dashboard`, note which `SPRINT_AT_RISK` rows are present.
2. At `/settings/absences`, record an **unplanned** absence for a roster member
   running from today to a date past the current sprint's end.
3. Wait for the next detection cycle (or trigger a sync) and reload `/dashboard`.
4. Exactly one new row reads "… is unexpectedly away for N of the M working
   day(s) left in the sprint"; M matches the working days from today to sprint
   end, and N matches the part of the absence inside that window.
5. Delete the absence; the row resolves and leaves the inbox.

## Migration Notes

None. No schema change, no data change, no backfill. The behavioural change takes
effect on the next detection cycle: absences that were silently dropped begin
raising `SPRINT_AT_RISK`, and the reconcile loop inserts them as ordinary new
rows. Nothing is resolved or deleted by the change itself.

Reverting is a one-line restore of the predicate; no state would need unwinding.

## References

- Frame brief: `context/changes/absence-sprint-scoping/frame.md`
- Source: `src/lib/anomaly/rules/sprint-at-risk.ts:119-160`,
  `src/lib/absence-store.ts:115-215`, `src/lib/anomaly/load-snapshot.ts:44-99`,
  `src/lib/dashboard/capacity.ts:130-180`,
  `src/lib/anomaly/rules/developer-inactive.ts:28-52`,
  `src/lib/validations/absence.ts:18-20`, `src/lib/sprint.ts:19-42`,
  `src/db/schema.ts:636-663`
- Prior decisions: `context/archive/2026-08-25-absence-calendar/plan.md:154-163,488-490`
  (D2), `.../reviews/impl-review.md:198-211` (F10),
  `context/archive/2026-08-26-sprint-reconciliation/research.md:119,271`
- Convention: `context/foundation/lessons.md:42-47` (narrowing predicate);
  `context/archive/2026-08-25-absence-calendar/plan.md:578` (archive amendment marker)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The predicate and its proof

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 9f7d2a2
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 9f7d2a2
- [x] 1.3 Unit tests pass, including the inverted D2 assertion and the new `sprintId: null` case: `npm test` — 9f7d2a2
- [x] 1.4 Integration tests pass, including the NULL-stamp and cross-boundary cases: `npm run test:integration` — 9f7d2a2
- [x] 1.5 `grep -n "sprintId" src/lib/anomaly/rules/sprint-at-risk.ts` returns nothing — 9f7d2a2
- [x] 1.6 `absence-store.integration.test.ts` still asserts the stamp is written — the writer is unchanged — 9f7d2a2
- [x] 1.7 `grep -rn "did not account for it" src/` returns nothing — the F1 copy change landed in the rule AND the demo fixture — 9f7d2a2

#### Manual

- [ ] 1.8 An unplanned absence running past sprint end produces exactly one "unexpectedly away" row with a working-day count matching the sprint's remaining days

### Phase 2: The reversal recorded where the old rule still stands

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 14338d8
- [x] 2.2 Type checking passes: `npx tsc --noEmit` — 14338d8
- [x] 2.3 Unit tests still pass after the comment edits: `npm test` — 14338d8
- [x] 2.4 The manual backlog covers this slice's open rows: `node scripts/manual-test-sweep.mjs` exits 0 — 14338d8
- [x] 2.5 No instruction to scope absence risk by `sprint_id` survives outside a dated reversal marker — 14338d8

#### Manual

- [x] 2.6 `roadmap.md` S-20 no longer reads as an open reconciliation, and S-26 no longer reads as blocked
- [x] 2.7 `sprint-reconciliation/research.md:271` reaches the reversal marker before the recommendation it superseded
