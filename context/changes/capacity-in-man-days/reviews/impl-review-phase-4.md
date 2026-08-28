<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phase 4 of 7 — The per-sprint measurement record
- **Date**: 2026-08-28
- **Commit under review**: `c3f882c`
- **Verdict**: NEEDS ATTENTION → **triaged 2026-08-28**: 4 fixed, 1 skipped
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run at review time: `npm test` 809/809, `npm run test:integration`
257/257, `npm run typecheck` clean, `npm run lint` 0 errors (5 warnings, all
pre-existing in `src/lib/anomaly/**`, none in Phase 4 files).

## Findings

### F1 — "A finalized record never moves" is enforced by a read-then-write, not by the database

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/measurement/sweep.ts` (the `shouldRecompute` guard and the `onConflictDoUpdate` set)
- **Detail**: The sweep reads every existing record's `finalized_at` into a map,
  then decides per sprint whether to write. Between that read and the write, a
  concurrent sweep (the 15-minute cron and a user's "Sync now" can overlap) may
  finalize the same row — and the first sweep's `set` still carries
  `finalizedAt: null`, un-finalizing it. Narrow (it needs a sweep straddling the
  sprint's end instant) and self-healing on the next cycle, but the invariant the
  whole slice rests on is currently an application-level check against a stale
  read. This repo has already made the opposite call once, in writing:
  `team-day-off-store.ts`'s header argues that "an insert that has to ask 'is it
  already there?' first would race; `ON CONFLICT DO NOTHING` against the unique
  key cannot."
- **Fix**: Add `setWhere: isNull(sprintMeasurement.finalizedAt)` to the
  `onConflictDoUpdate`, so Postgres — not the map — refuses to touch a finalized
  row. Keep `shouldRecompute` as the cheap early-out that skips the four capacity
  queries.
  - Strength: Makes the guarantee unconditional, and `drizzle-orm` supports
    `setWhere` natively on the conflict clause.
  - Tradeoff: The `upserted` counter then over-reports by one when the DB
    refuses a write the map thought was needed — cosmetic.
  - Confidence: HIGH — one line, and integration test 4.4 already covers the
    behaviour it protects.
  - Blind spot: No test currently interleaves two sweeps; the fix is verified by
    construction rather than by a concurrency test.
- **Decision**: FIXED — `setWhere: isNull(finalizedAt)` added to the conflict clause; the guard is now Postgres-enforced.

### F2 — `capacity_full_md` subtracts team-wide days off, which FR-023 reads as belonging only to the adjusted figure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/measurement/sweep.ts` (`capacityFullMd: mdToColumn(capacity.capacity.nominalMd)`)
- **Detail**: The sweep maps the reducer's `nominalMd` onto `capacity_full_md`,
  which is the most direct reading of the plan ("§2 above" as the source). But
  `nominalMd` is `Σ fte × sprintWorkingDays`, and `sprintWorkingDays` is already
  net of team-wide days off — so a public holiday reduces BOTH columns. FR-023
  words the record as "its full capacity, its capacity after absences and
  team-wide days off", which reads as full being before both. The consequence is
  downstream, not here: FR-024 normalises past velocity against `capacity_full_md`,
  so under the current mapping a holiday-shortened sprint is never normalised back
  up, and its velocity enters the average as if the team had had the full calendar.
  Whether that is right is a genuine domain question — FR-022 says capacity is
  reduced by absences and days off "alike", which cuts the other way.
- **Fix A ⭐ Recommended**: Leave the arithmetic as shipped and settle the question
  explicitly in Phase 6, where the normalisation is actually written; record the
  decision in `plan.md` Phase 4 §1 so it is inherited deliberately.
  - Strength: The column comment already states the nuance, so nothing is
    silently wrong; and Phase 6 is where the choice becomes observable.
  - Tradeoff: Any records frozen before Phase 6 carry the current reading and
    cannot be recomputed (the roster has no time dimension).
  - Confidence: MEDIUM — depends on the owner's intent, which the PRD states
    twice in mutually tensioned words.
  - Blind spot: How many real sprints will close between now and Phase 6.
- **Fix B**: Change `capacity_full_md` now to `Σ active fte × (sprintWorkingDays +
  teamDaysOff)`, using the reducer's already-returned `teamDaysOff`.
  - Strength: Matches FR-023's literal wording and makes the two columns answer
    genuinely different questions.
  - Tradeoff: Adds a derivation the plan's contract does not name, and pre-empts
    a Phase 6 decision from inside the write path.
  - Confidence: MEDIUM — the arithmetic is trivial; the intent is not.
  - Blind spot: Whether the owner wants holidays normalised away at all.
- **Decision**: FIXED via Fix A — arithmetic unchanged; the mapping, its FR-022/FR-023 tension and the FR-024 consequence are recorded in `plan.md` Phase 4 §1 and deferred to Phase 6.

### F3 — Two overlapping sprints would both claim the same delivered story points

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/measurement/sweep.ts` (the delivered-SP recomputation)
- **Detail**: Delivered SP is deliberately NOT narrowed by `jira_ticket.sprint_id`
  — that is the fix that makes a re-stamped carried-over ticket count in the
  sprint that finished it (test 4.10). The window alone is therefore the only
  predicate, which is sound exactly as long as sprint windows do not overlap.
  They can: `src/lib/sprint.ts` documents, in a comment added at S-16 impl-review,
  that an owner can hold more than one ACTIVE sprint row because `importCadence`
  conflicts on `jira_sprint_id` and inserts rather than updates — and Jira
  Software permits parallel sprints on one board. Two overlapping records would
  each count the same first-DONE instants, and FR-024 averages over those records,
  so the inflation compounds into the estimate rather than staying local.
- **Fix**: Record the non-overlap assumption explicitly in `plan.md` Phase 4 §3
  and open a follow-up to decide the tie-break (nearest start? the sprint the
  ticket was stamped to at first-DONE time?) before Phase 6 consumes the series.
  Do not narrow by `sprint_id` — that would undo test 4.10.
  - Strength: Keeps the phase's central fix intact while making the boundary
    condition visible to Phase 6 instead of buried in a passing test suite.
  - Tradeoff: Leaves a known-wrong case in the code for now.
  - Confidence: HIGH — the reachable multi-ACTIVE state is documented in this
    repo, not hypothesised.
  - Blind spot: Whether the monitored FM project ever actually runs parallel
    sprints; unverified.
- **Decision**: FIXED — non-overlap assumption stated in `plan.md` Phase 4 §3; tie-break queued as a Phase 6 prerequisite in `follow-ups/review-fixes.md`.

### F4 — The record's project identity is a decision the plan never states

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/db/schema.ts` (`sprintMeasurement.jiraProjectId`), `src/lib/measurement/sweep.ts` (the `jiraProject` join)
- **Detail**: The plan says `jira_project_id` is "plain text with no foreign key"
  but never says WHICH id. The implementation stores the Jira-side id
  (`jira_project.jira_project_id`, e.g. `"10000"`), not the internal row id,
  because `connection-service.ts` UPDATES the project row in place on a switch —
  so the internal id is stable across a switch while the team it names is not,
  and keying on it would average two teams together. The reasoning is written into
  the column comment but not into the plan, so a later phase could reasonably
  assume the other one.
- **Fix**: Add the choice and its reason to `plan.md` Phase 4 §1's contract.
- **Decision**: FIXED — the Jira-side-id choice and its reason recorded in `plan.md` Phase 4 §1.

### F5 — A sprint that closes without ever being frozen is re-measured every cycle, forever

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/measurement/sweep.ts` (the per-sprint loop)
- **Detail**: `shouldRecompute` skips finalized records before any capacity query
  runs, so in steady state the sweep costs four queries for the one live sprint.
  A CLOSED sprint whose `committed_frozen_at` stayed NULL never finalizes by
  design (FR-023's honest "no data"), so it keeps its open record and keeps being
  recomputed at four queries per cycle indefinitely. The values are stable (the
  window's upper bound is `sprintEnd`), so this is cost and noise, not
  incorrectness — and it is the price of the self-healing the sweep exists for.
- **Fix**: None needed now; revisit if the operator log ever shows open records
  outliving several sprints.
- **Decision**: SKIPPED — cost, not incorrectness; it is the price of the sweep's self-healing. Revisit only if open records outlive several sprints.

## Success criteria

Automated 4.1–4.7 and 4.10: all `[x]`, re-verified at review time.

Manual 4.8 / 4.9: pending, correctly unchecked. 4.8 is gated on a real sprint
rollover in the FM project and must not block Phases 5–7 — the sweep records a
closed sprint whether it runs at the rollover or days later, which is precisely
what integration test 4.2 pins. Manual rows from Phases 1–3 (1.7–1.9, 2.7–2.9,
3.8–3.10) also remain pending; 3.8 is still blocked on `manual-test-backlog.md`
row 1.8 (SP estimates absent in the FM project).
