# Absence sprint scoping (S-20) — Plan Brief

> Full plan: `context/changes/absence-sprint-scoping/plan.md`
> Frame brief: `context/changes/absence-sprint-scoping/frame.md`

## What & Why

`SPRINT_AT_RISK` answers "is this absence a surprise for the sprint I am
evaluating?" by consulting a column that records something else entirely — which
sprint was active when the row was typed — and the owner has ruled that risk
should follow the absence's **dates**, as every other consumer already does.

## Starting Point

Eight places in the codebase read a recorded absence. Seven resolve membership
from dates; one, `sprint-at-risk.ts:146`, compares `absence.sprint_id`. That
column is stamped once at creation from the active sprint and never re-stamped,
so it is write-time provenance, not membership. The frame's investigation found
no three-way disagreement to reconcile: capacity must stay date-only (S-23
measures **closed** sprints through it) and `DEVELOPER_INACTIVE` matches a
rolling window that is not a sprint window at all. One reader is wrong.

## Desired End State

An unplanned absence raises `SPRINT_AT_RISK` in whichever sprint its dates fall
in — including a sprint it was not recorded in, and including one recorded when
the owner had no sprint row at all. The impl-review F10 blindness (a `NULL` stamp
never raises risk in any sprint, ever) dissolves rather than being documented for
a third time.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which reading is canonical | Dates, not `sprint_id` | The owner ruled risk follows the dates into the next sprint; seven of eight readers already do this | Frame |
| Capacity & `DEVELOPER_INACTIVE` | Unchanged | Both correct, and capacity's date-only read is what lets S-23 measure a closed sprint at all | Frame |
| D2 ("a carried-over absence is planned here") | Reversed, deliberately and on the record | The "raises risk forever" worry is bounded by the absence's own dates — `overlaps(…, now, endDate)` stops firing when it ends | Plan |
| The writer (`createAbsence` stamping) | Keeps stamping; redocumented as provenance | Stopping it would deliver half of S-26's disconnect fix without S-26's consent decision, and `roadmap.md:1085` asks that the column not be settled twice | Plan |
| The column and its `ON DELETE CASCADE` FK | Untouched, no migration | That cascade is the data-loss path S-26 owns; migration-free also keeps the slice safe beside S-25/S-27 in a parallel worktree | Frame |
| How far the correction reaches | Code + roadmap + dated markers on two archived docs | `sprint-reconciliation/research.md:271` is the exact citation that deferred this change once already | Plan |
| Test shape | Invert the D2 unit test, add the NULL case, add two integration cases | F10's own text says "the store test asserts the NULL is stored; nothing covers the downstream consequence" | Plan |
| PRD FR-010 | No change | FR-010 never stated D2 — it says only that an unplanned mid-sprint absence raises risk, which this makes *more* true | Plan |

## Scope

**In scope:** the absence predicate in `sprint-at-risk.ts` · its unit tests ·
two new integration cases (NULL stamp, cross-boundary) · five code-comment
rationales · roadmap S-20 and the S-26 sequencing note · dated reversal markers
on two archived documents · a two-row manual checklist.

**Out of scope:** any migration or schema edit · dropping the column or stopping
the writer (S-26) · `capacity.ts` and `developer-inactive.ts` · re-deriving
`is_planned` · re-stamping `sprint_id` at rollover · `load-snapshot.ts` · the
PRD · `schema.ts:646-652`, whose D2 reference justifies `is_planned`'s default
and remains correct.

## Architecture / Approach

Delete one line. `snapshot.absences` already contains the rows the rule is
dropping — `load-snapshot.ts:90-99` windows them by dates alone — so no query,
loader or schema change is involved. Removing
`if (absence.sprintId !== snapshot.sprint.id) continue;` leaves
`isPlanned !== false` and `overlaps(absence, now, endDate)` as the whole
predicate, which is the same shape the seven sibling readers use. Everything else
in the slice exists to make sure the next reader does not put the line back.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The predicate and its proof | Date-based matching, an inverted D2 test, a NULL-stamp unit case, two integration cases | `seedScenario(false)` returns before the `teamMember` insert, so the no-sprint scenario has no roster until that insert moves above the early return |
| 2. The reversal on the record | Five rewritten rationales, roadmap S-20 + S-26 updated, dated markers on two archived docs, manual checklist + backlog rows | Under-reaching: leaving `research.md:271` uncorrected is how this change was deferred the first time |

**Prerequisites:** S-08 and S-16, both done. No migration, so this runs safely in
a parallel worktree — but `npm run test:integration` must not run concurrently
with another worktree's suite.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- **Never observed in the running app.** This is a code-read finding from S-16
  research; no test, fixture or manual row exhibits the divergence, and the demo
  has one sprint with all three absences stamped to it. The integration cases are
  the first artefacts that will ever exercise it.
- **Widening a predicate can over-fire.** The planned-absence guard
  (`sprint-at-risk.test.ts:236-247`) and the manual row both exist to catch that;
  the rule stays keyed on `isPlanned === false`.
- **The cross-boundary integration case must flip sprint N to CLOSED, not delete
  it** — `absence.sprint_id` is `ON DELETE CASCADE`, so deleting N takes the
  absence with it.
- **S-26 inherits a column with a writer and no reader.** That is deliberate and
  recorded in both docstrings, but it is a state a future cleanup could
  misread as dead code and remove — taking the cascade decision with it.

## Success Criteria (Summary)

- An unplanned absence crossing a sprint rollover raises risk in the sprint its
  dates fall in, proved end to end through the real store and reconcile loop.
- An absence recorded between sprints (NULL stamp) raises risk once the sprint it
  falls inside is active — impl-review F10, closed rather than re-documented.
- No document in the repo still instructs a reader to scope absence risk by
  `sprint_id` except behind a dated reversal marker.
