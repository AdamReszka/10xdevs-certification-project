<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phases 2 and 3 of 7 — Team days off + the seam at five sites (`8acf76f`); Honest sprint sums (`b710e5d`)
- **Date**: 2026-08-28
- **Verdict**: REJECTED → **APPROVED** after triage 2026-08-28 — 8 of 9 findings fixed, F8 consciously skipped
- **Findings**: 1 critical, 4 warnings, 4 observations

Phase 1 was reviewed separately (`impl-review-phase-1.md`, all 4 findings addressed) and is not re-reviewed here.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING → PASS (F7 fixed, F9 documented) |
| Safety & Quality | FAIL → PASS (F1, F3, F4 fixed; F8 skipped) |
| Architecture | WARNING → PASS (F5, F6 fixed) |
| Pattern Consistency | PASS |
| Success Criteria | WARNING → PASS (F2 corrected) |

## Success criteria (re-run 2026-08-28)

| Step | Command | Result |
|---|---|---|
| 2.1, 2.2, 3.1, 3.2, 3.11 | `npm test` | PASS — 800 tests / 63 files |
| — | `npm run db:migrate` | PASS — `0013_fresh_ultimates`, `0014_short_young_avengers` applied |
| 2.3, 3.3, 3.4, 3.5 | `npm run test:integration` | PASS — 246 tests / 20 files |
| 2.4 | `grep -rn "countWorkingDays" src/ --include="*.ts" \| grep -v test` | PASS — exactly 5 production call sites, all passing `nonWorkingDays` |
| 2.5, 3.6 | `npm run typecheck` | PASS |
| 2.6, 3.7 | `npm run lint` | PASS — 0 errors, 5 warnings, all verified pre-existing against `3f7c6d7` |

Manual rows 2.7–2.9 and 3.8 remain `- [ ]`, correctly. Rows 3.9 and 3.10 were ticked
in the implementation commit itself — see F2.

## Plan-adherence detail

Every one of the eleven contract items in Phases 2 and 3 was verified against the
implemented file, not merely against the commit message:

| # | Item | Verdict |
|---|---|---|
| P2 §1 | `teamDayOff` schema + `0013` migration | MATCH — column-for-column, `unique(owner_id, day)` with both columns NOT NULL |
| P2 §2 | `team-day-off-store.ts` — four functions, idempotent duplicate | MATCH |
| P2 §3a | `capacity.ts` — both `countWorkingDaysInclusive` calls, `Promise.all` load | MATCH |
| P2 §3b | `SprintSnapshot.nonWorkingDays`, loader, two rules, test-support default | MATCH |
| P2 §4 | Entry surface + thin actions + best-effort `redetect` | MATCH |
| P2 §5 | Working-day count and "− M team days off" under the MD figure | MATCH |
| P3 §1 | Story-point round/clamp guard | MATCH (but see F4) |
| P3 §2 | `resolveSprintFieldId`, fieldId match, display-name fallback, one log line | MATCH (see F5, F7) |
| P3 §3 | `added_after_sprint_start` from the latest `Sprint` transition | MATCH |
| P3 §4 | `committed_frozen_at`, one statement, guard reads the pre-UPDATE row | MATCH |
| P3 §5 | `first-done.ts` extracted; `burndown-series.ts` imports rather than copies | MATCH |

The "no double-subtraction" requirement is genuinely met: `capacity.ts:126` and
`:171` pass the *same* set, so a holiday inside a vacation is absent from both
terms of `available = sprintWorkingDays − absentWorkingDays`.

Scope guardrails from `## What We're NOT Doing` are all respected — no `numeric`
migration for `story_points`, no country-derived holidays, no fourth
`SPRINT_AT_RISK` condition, no per-member snapshots, no `timestamptz` migration.

## Findings

### F1 — The commitment freeze bakes in the OLD `added_after_sprint_start` rule on any sprint already in flight

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: `src/lib/integrations/sync/run-sync.ts:718-722` and `:884`; `src/db/migrations/0014_short_young_avengers.sql:1`
- **Detail**:
  The plan's own `## Critical Implementation Details` states the precondition:
  "The `Sprint`-changelog fix must land before the committed-SP freeze is switched
  on, or the first freeze captures today's wrong denominator permanently." Commit
  order satisfies it. The **upgrade path does not.**

  `added_after_sprint_start` is recomputed only for issues returned by the Jira
  pull, and that pull is a delta:

  ```ts
  const cursorMatchesSprint = lease.jiraCursorSprintId === chosenSprint.id;
  const updatedSince =
    cursorMatchesSprint && lease.jiraHistoryCursor ? new Date(lease.jiraHistoryCursor) : null;
  ```

  But the freeze aggregates over the **whole** `jira_ticket` table for the sprint:

  ```ts
  committedSp: sql`case when ${sprint.committedFrozenAt} is null then ${Number(totals?.committedSp ?? 0)} else ${sprint.committedSp} end`
  ```

  For a sprint already synced before this deploy, the cursor matches, the pull is
  a delta, and untouched tickets keep the verdict written by the old
  `createdAt > sprintStart` rule. The first post-deploy cycle therefore freezes a
  sum computed over a mixture of the old and new rules — and `case when
  committed_frozen_at is null` guarantees no later cycle can ever correct it.
  `0014` is a bare `ADD COLUMN` with no backfill and no cursor reset.

  This is not hypothetical and it has not fired yet — which is what makes it
  actionable. Verified against the local database on 2026-08-28:

  ```
  sprint          committed_sp  completed_sp  committed_frozen_at
  SCRUM Sprint 1  0             0             NULL
  Sprint 24       40            18            NULL

  sync_state (JIRA)  jira_history_cursor       jira_cursor_sprint_id
  74hVn…             2026-08-26T08:16:41.340Z  c98a6597… (= SCRUM Sprint 1)
  ```

  The real-credential owner's cursor matches its active sprint. The next
  "Sync now" is the cycle that stamps the permanent value. Once Phase 4 lands, that
  same figure becomes the FR-023 measurement record and the FR-024 denominator,
  for the lifetime of the team.
- **Fix A ⭐ Recommended**: Only stamp `committedFrozenAt` when the cycle did a FULL pull — i.e. gate the stamp on `updatedSince === null`, leaving `committed_sp` recomputing until one full pull has classified every ticket.
  - Strength: Self-healing and permanent — it fixes existing installs and every future one, including the case where a cursor survives some later refactor. States the actual precondition ("the freeze needs a completely classified table") in the code rather than in a one-off migration nobody re-reads.
  - Tradeoff: The freeze is delayed until the next full pull, which happens on the next sprint switch. That delay is exactly what the plan already chose for the sweep ("a sweep delays the record instead of losing it"), and `committed_frozen_at` makes the delay visible.
  - Confidence: HIGH — the guard sits three lines from the existing `case when`, and the freeze is already designed to tolerate a late stamp.
  - Blind spot: If an account's sprint never switches, the commitment stays unfrozen and keeps tracking scope creep until it does. Worth a follow-up check that the sweep in Phase 4 treats an unfrozen sprint as "no record yet" rather than recording a moving number.
- **Fix B**: Add a cursor reset to `0014` — `UPDATE sync_state SET jira_history_cursor = NULL, jira_cursor_sprint_id = NULL WHERE integration = 'JIRA';` so the next cycle does one full pull before anything freezes.
  - Strength: One line; the next cycle after deploy is correct with no behavioural change to the freeze.
  - Tradeoff: Fixes only the accounts that exist at migration time. Nothing prevents the same shape recurring, and `0014` is already applied to the local database — it would need a new migration `0015`.
  - Confidence: MEDIUM — correct for today's two accounts; silent about tomorrow's.
  - Blind spot: A full pull of a large sprint is a bigger Jira request than usual; the existing `MAX_SEARCH_PAGES = 20` cap throws rather than truncating, so a very large sprint would error rather than freeze a partial sum. That is the safe direction, but it is an error the lead would see.
- **Decision**: FIXED via Fix A + Fix B, 2026-08-28.
  - `src/lib/integrations/sync/run-sync.ts` — the stamp is now gated on `didFullPull = updatedSince === null` and simply omitted from the `SET` object on a delta cycle, so the row stays unfrozen and `committedSp` keeps recomputing. The reasoning (a SUM over the whole table cannot be frozen from a predicate only the delta rewrote) is recorded at the call site.
  - `src/db/migrations/0015_reset_jira_delta_cursor.sql` (new, data-only) — clears `jira_history_cursor` / `jira_cursor_sprint_id` for `integration = 'JIRA'` so the accounts that already exist get one full pull on their very next cycle rather than waiting for a rollover. Applied locally and verified: both owners' cursors are NULL.
  - `src/lib/integrations/sync/run-sync.integration.test.ts` — regression test "does not freeze on a delta cycle — the stamp waits for a full pull". Confirmed RED against the pre-fix file (`committedFrozenAt` was stamped on the delta cycle) and GREEN after.

### F2 — Manual rows 3.9 and 3.10 were ticked in the implementation commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/capacity-in-man-days/plan.md:1187-1188`
- **Detail**: `b710e5d` flipped `3.9 Adding a mid-sprint ticket does not raise the committed figure` and `3.10 A 0.5 estimate in Jira no longer wedges the sync` from `- [ ]` to `- [x] — b710e5d`, in the same commit as the code. Both rows require a real Jira: dragging a backlog ticket into the running sprint, and setting an estimate to `0.5`, each followed by a "Sync now". Neither is observable in the diff, and the owner confirmed on 2026-08-28 that no manual rows had been run. Row 3.8 in the same block was correctly left pending, and Phase 2 ticked only automated rows — so this is an isolated slip, not a habit. It matters because `## Progress` is the canonical state that `/10x-archive` and the next planning round read.
- **Fix**: Revert both rows to `- [ ]` and drop the SHA suffix.
- **Decision**: FIXED — both rows reverted to `- [ ]` during this review, at the owner's direction.

### F3 — The `namesSprint` narrowing predicate is uninstrumented, against an accepted lesson

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (lessons compliance)
- **Location**: `src/lib/integrations/sync/run-sync.ts:949-957`
- **Detail**: There are two nested narrowing predicates on the Sprint changelog. The first — the field-id match — *is* instrumented (`jira.ts:1013-1019` counts and logs). The second is not:

  ```ts
  if (!namesSprint(change.to, jiraSprintId)) continue;
  ...
  return createdAt ? createdAt > sprintStart : null;   // silent fallback
  ```

  `jiraSprintId` is `chosenSprint.jiraSprintId` — stored state owned by Jira, and the exact value class `lessons.md` was written about (the demo-seed `jira_sprint_id=1001` incident, where a wrong stored id produced an empty result that read as a healthy green sync for days). If it is stale, *every* issue takes the `createdAt` fallback and the commitment is systematically wrong — which F1's freeze then makes permanent. Nothing distinguishes "no issue moved sprints" from "the id I matched against is wrong". Violating an accepted lesson is a stronger signal than a generic nit.
- **Fix**: Count issues that carried ≥1 Sprint change of which none named `jiraSprintId`, and fold that count into the cycle's durable `sync_attempt.outcome` string (the same channel used at `run-sync.ts:203, 288, 307, 708`) — the lesson's requirement is that the operator log distinguish the cases.
- **Decision**: FIXED, 2026-08-28. `resolveAddedAfterSprintStart` now returns `{ addedAfterSprintStart, matchedSprintTransition }`; the ticket loop counts issues that carried Sprint changes yet matched none, and `jiraCycleOutcome` writes `sprint_changes_naming_no_sprint=N` into `sync_attempt.outcome`. Integration test: "records Sprint changes that named no known sprint in the attempt log".

### F4 — The story-point guard closes the fractional wedge but not the magnitude one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: `src/lib/jira.ts:887-888`
- **Detail**:

  ```ts
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.round(raw));
  ```

  `jira_ticket.story_points` is `integer("story_points")` (`schema.ts:685`) — int4, max 2147483647. A Jira number custom field accepts `1e10`; `Math.round(1e10)` is finite, passes the guard, and then the INSERT inside the sync transaction raises `value out of range for type integer`, rolling back the whole Jira pull and stamping `sync_state` ERROR every 15 minutes with no self-heal. That is verbatim the failure this guard's own doc comment describes closing. The lower bound is clamped; the upper bound is not.
- **Fix**: Clamp the top too — return `null` above a sane cap so an absurd value reads as "unestimated" rather than a fabricated number. FR-009's largest threshold is 21 SP, so any cap in the hundreds is generous.
- **Decision**: FIXED, 2026-08-28. `MAX_STORY_POINTS = 1000` in `jira.ts`; anything above returns `null` rather than a clamped invention. Unit test asserts `1e10` and `2_147_483_648` map to `null` while `21` still passes.

### F5 — The fallback diagnostic goes to `console.info` and fires on nearly every healthy sync

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/jira.ts:1013-1019`
- **Detail**: Two problems, one line. **Placement**: this is the only `console.*` in `src/lib/jira.ts`, and `src/lib/github.ts` has none — both sibling clients are log-free, with operator diagnostics carried by `finalizeSyncState(..., { outcome })` into `sync_attempt.outcome`. On Workers a `console.info` is ephemeral, so the signal `lessons.md` asks to be durable is the one that disappears. **Signal-to-noise**: the guard is `noSprintChangeWithChangelog > 0`, and a ticket that was in the sprint from the start has a status changelog but no Sprint change — so on a perfectly healthy English site this line prints essentially every cycle. A diagnostic that always fires is not a diagnostic. The implementation follows the plan's contract literally; the contract itself is what is miscalibrated, so this is a plan flaw as much as a code one. No secrets leak — the line carries counts and `"resolved"`/`"UNRESOLVED"` only.
- **Fix**: Return the counts from `searchSprintIssues` and fold them into the cycle's `outcome` string, and narrow the condition to the case worth reporting — the sprint-field id being unresolved, or (with F3) issues whose Sprint changes named no known sprint.
- **Decision**: FIXED, 2026-08-28. The `console.info` and its counter are gone from `jira.ts` (the client is log-free again, matching `github.ts`); `jiraCycleOutcome` in `run-sync.ts` reports `sprint_field_unresolved` and F3's count into `sync_attempt.outcome`, and returns `null` when neither applies. No signature change to `searchSprintIssues` was needed — `sprintFieldId` is already in scope at the call site. Integration test asserts the unresolved case is recorded AND that a healthy cycle records `null`.

### F6 — `nonWorkingDays` is optional in the two counters, required only in `computeSprintCapacity`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/anomaly/rules/helpers.ts:95` and `:108`
- **Detail**: `countWorkingDays` and `countWorkingDaysInclusive` both declare `nonWorkingDays?: ReadonlySet<DayKey>`, while `computeSprintCapacity` deliberately makes the same input required, with the rationale spelled out at `capacity.ts:119-124`: "REQUIRED, not optional: an omission here would silently keep the old, holiday-blind number, and the caller would have no way to tell." That argument applies identically to the two counters, which carry four of the five call sites. All five pass it today — criterion 2.4 verified — so this is not a live defect. But the guarantee rests on a grep, not on the type system, and the sixth call site is what `## Critical Implementation Details` singles out as the failure mode this phase exists to prevent. (`countTeamDaysOffInclusive` at `:132` correctly makes it required.)
- **Fix**: Make the parameter required in both counters and pass `new Set()` at any site that genuinely has none.
- **Decision**: FIXED, 2026-08-28. Both counters now take `nonWorkingDays: ReadonlySet<DayKey>` required, with the reason recorded on the shared doc comment. The compiler found all 17 affected call sites, every one of them in `helpers.test.ts`; they now pass a named `NO_DAYS_OFF` constant so the argument reads as a choice rather than as an omission. Zero production call sites needed changing — the grep was right, it just was not a guarantee.

### F7 — `resolveStoryPointFieldId` and `resolveSprintFieldId` have no production callers after the `resolveFieldIds` refactor

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/jira.ts:1017-1126`
- **Detail**: The plan asked for `resolveSprintFieldId` "beside" `resolveStoryPointFieldId`. What landed also introduces `fetchFieldDefinitions`, `pickStoryPointField`, `pickSprintField`, `JiraFieldIds` and `resolveFieldIds`, and production now calls only `resolveFieldIds` (`run-sync.ts:640`). The refactor is aligned with the plan's own reasoning ("the one call that lists every field") and saves a subrequest per cycle — this is not scope creep to be reverted. The residue is that both named single-field resolvers are now exported with no production caller, kept alive only by `jira.test.ts`. Tests that exercise a function nothing calls report on a path production does not take.
- **Fix**: Un-export the two single-field resolvers (or delete them) and point their tests at `resolveFieldIds` / `pickSprintField`, which is what production runs.
- **Decision**: FIXED, 2026-08-28. `resolveStoryPointFieldId` and `resolveSprintFieldId` deleted; their eleven tests now go through `resolveFieldIds`, reading `.storyPointFieldId` / `.sprintFieldId`. Same coverage, now over the path production actually takes — including the `fetchFieldDefinitions` error branch.

### F8 — Two extra full-sprint reads run every cycle inside the transaction holding the Hyperdrive connection

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: `src/lib/integrations/sync/run-sync.ts:846-868`
- **Detail**: `sprintTickets` and `doneTransitions` (joined to `jira_ticket`) are now read on every cycle, inside the transaction, even when the delta pull returned zero issues. Both are set-based — no N+1 — and bounded by sprint size, so this is not a correctness problem. It is a cost the 15-minute loop pays unconditionally on a connection the whole request shares.
- **Fix**: Skip the recompute when the delta returned no issues and `committed_frozen_at` is already set, or collapse the two reads into one aggregate.
- **Decision**: SKIPPED, 2026-08-28. Set-based, bounded by sprint size, no N+1, and no correctness impact. Adding a skip condition next to the freeze logic that F1 has just changed would obscure the part of this file that most needs to stay readable. Worth revisiting only if sprint sizes or cycle cost make it measurable.

### F9 — Two small additions not named in the Phase 2 contract

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/anomaly/rules/helpers.ts:129-143`; `src/components/organisms/settings/team-days-off-view.ts:32,90`
- **Detail**: `countTeamDaysOffInclusive` is a new exported helper that §5's contract implies ("− M team days off") but never names, and it is the right shape — it counts only holidays landing on working weekdays, so a Saturday holiday never renders as "− 1" next to a working-day total that did not move. The `costsNothing` flag and its "Not a working day anyway" badge (`team-days-off-editor.tsx:174-176`) go beyond "a list of dates with optional labels, add/remove", but serve the same §5 intent: keeping a non-moving capacity number from reading as a bug. Both are recorded as EXTRA for the record, not as work to undo.
- **Fix**: None needed — note them in the plan's Phase 2 section as delivered scope so a later review does not re-flag them.
- **Decision**: FIXED (documented), 2026-08-28. `plan.md` Phase 2 gains a "Delivered beyond the contract" subsection recording both additions and why each is kept. Nothing was reverted.

## What was verified clean

- **Cross-account isolation.** Every new query carries `owner_id` — `listTeamDaysOff`, `getNonWorkingDays`, `createTeamDayOff` (insert *and* the conflict re-read), and `deleteTeamDayOff` (`AND owner_id` in the DELETE, with an empty `returning` raised as `UnknownTeamDayOffError` rather than a silent success). Both new server actions call `requireSession()` first and take `ownerId` from the session only. This matters more than usual here: the Data API is off and there is no RLS, so the `WHERE` clause *is* the isolation.
- **Delete-then-insert lesson** — correctly avoided; the store is a single-row idempotent insert plus an owner-scoped single-row delete, and `team_day_off` has no children.
- **Nullable-UNIQUE-dedup lesson** — `unique(owner_id, day)` with both columns NOT NULL, which is what makes `onConflictDoNothing` actually dedup.
- **No-configuration-path lesson** — `resolveSprintFieldId` is tested through the real resolver with the field genuinely absent from `/rest/api/3/field`, and the degradation is tested end-to-end in the integration suite.
- **Secrets** — no token or credential reaches any log or error message on the changed paths.
- **Timestamp encoding** — `sql.param(now, sprint.committedFrozenAt)` is the correct fix for the `timestamp without time zone` local-offset hazard; the `case when` / `coalesce` pair reads the pre-UPDATE row, so guard and stamp cannot disagree.
- **Pattern consistency** — `team-day-off-store.ts` mirrors `absence-store.ts`; `validations/team-day-off.ts` mirrors `validations/absence.ts` (server-import-free, `z.iso.date()`, uniqueness left to the database); the new actions mirror the sibling absence actions including best-effort `redetect`. The `.tsx`/`.ts` split is genuine — all judgement lives in `team-days-off-view.ts` with 11 unit tests, matching the `absence-editor.tsx` / `absence-calendar-view.ts` precedent, as the no-component-harness rule requires.
- **Test coverage matches the plan's own criteria** rather than merely claiming to: `first-done.test.ts` covers all four named cases plus post-close idempotence; `jira.test.ts` covers fieldId-match-on-non-English, display-name fallback, and same-name-different-field rejection; `run-sync.integration.test.ts` covers the freeze, post-end `completed_sp` idempotence, and all four `added_after_sprint_start` branches.
