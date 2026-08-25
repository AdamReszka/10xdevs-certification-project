<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence Calendar (S-08 / FR-010)

- **Plan**: `context/changes/absence-calendar/plan.md`
- **Scope**: Phases 1–6 (full plan)
- **Date**: 2026-08-25
- **Verdict**: NEEDS ATTENTION → all findings triaged 2026-08-25 (6 fixed, 4 accepted)
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after fixes |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS after fixes |
| Success Criteria | PASS |

Automated criteria re-run independently for this review: `npm test` 431/34 ✅ ·
`npm run test:integration` 154/14 ✅ · `npm run typecheck` ✅ · `npm run lint`
0 errors / 5 pre-existing warnings ✅ · production build lists `/settings/absences` ✅ ·
`npm run test:mutation` 78.96 ≥ break 70 ✅ · migration verified in the local DB
(`is_planned` NOT NULL DEFAULT true, `sprint_id` still nullable) ✅.

No manual row is ticked anywhere, so there is nothing rubber-stamped.

## Findings

### F1 — Next window repeats the sprint's last day for a real Jira end date

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (correctness)
- **Location**: src/components/organisms/dashboard/availability-view.ts:41-48
- **Detail**: `nextWindowAfter` starts the next window at `sprintEnd + 1 millisecond`,
  but both grids are drawn in calendar DAYS via `enumerateDayKeys`. Real Jira sprints
  end at an arbitrary instant, not at end-of-day — `run-sync.integration.test.ts:269`
  stores `2026-08-31T08:00:00.000Z`. Reproduced directly against the shipped logic with
  `start 2026-08-17T08:00Z / end 2026-08-28T08:00Z`: the current window's last day key
  is `2026-08-28` and the next window's first day key is also `2026-08-28`. The lead
  sees the sprint's final day twice, and an absence on that day is painted in both
  grids. The unit tests miss it because they use `SPRINT_END = …T23:59:59.999Z`
  (`availability-view.test.ts:20`) — the one shape where `+1ms` lands on the next day.
- **Fix**: Derive the next window from DAY KEYS rather than instants — take the day
  after the sprint's end day key in the team's zone and use `dayRangeInTimeZone(...).from`
  as the start — and add a regression test with a mid-day `sprintEnd`.
  - Strength: Puts the function on the same zone-aware day axis the grids already use, so the two windows cannot share a column by construction.
  - Tradeoff: `nextWindowAfter` gains a `timeZone` argument it does not take today.
  - Confidence: HIGH — the overlap was reproduced, not inferred.
  - Blind spot: None significant; the capacity number is unaffected (it reads only the current sprint).
- **Decision**: FIXED — next window now resolves through day keys in the team's zone; proven by reverting the fix and watching the 2 new tests go red

### F2 — Seed writes absence days that are wrong on any non-UTC host

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (correctness / demo data)
- **Location**: scripts/seed-dashboard.mjs:146-150 (`zonedDayStart`)
- **Detail**: The helper computes `asZoned − utcGuess`, which is
  `zoneOffset − hostOffset`, not `zoneOffset`. It is only correct when the seeding
  machine runs in UTC. Measured for `2026-08-25` with `SEED_ZONE = Europe/Warsaw`:
  `TZ=UTC` → stored `08-24T22:00Z .. 08-25T21:59:59.999Z`, reads back `08-25 .. 08-25` ✅;
  `TZ=Europe/Warsaw` → stored `08-25T00:00Z .. 08-25T23:59:59.999Z`, reads back
  `08-25 .. 08-26` ❌; `TZ=America/Los_Angeles` → reads back `08-24 .. 08-25` ❌.
  **This machine is `Europe/Warsaw`**, so every seeded absence is currently one day
  longer than intended — on the exact surface the block's own comment says it exists to
  protect. The demo dataset is load-bearing for the PRD's second success criterion and
  is the input to S-09.
  **The Phase 6 verification in this session reported a false pass**: it checked with
  `start_date at time zone 'Europe/Warsaw'`, which *interprets* a naive `timestamp`
  rather than converting it, so it could not have detected this.
- **Fix**: Mirror `dayRangeInTimeZone`'s approach instead of `toLocaleString` + `new Date`
  — derive the offset from `Intl.DateTimeFormat(...).formatToParts`, or binary-search the
  boundary as `day-bucket.ts` does. Re-seed a throwaway owner and verify by reading the
  stored instants back through `Intl` in the seed zone, not through `at time zone`.
  - Strength: Removes host dependence entirely; the seed produces identical data on any developer machine and in CI.
  - Tradeoff: A few more lines in a .mjs script that deliberately cannot import the TS helper.
  - Confidence: HIGH — measured across three host zones.
  - Blind spot: Whether any other seeded surface silently depended on the current (wrong) day span.
- **Decision**: FIXED — offset derived via `formatToParts`; verified identical on 4 host zones incl. both 2026 DST transitions, then re-seeded and read back through `Intl`

### F3 — `nextWindowAfter` tests are tautological

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test quality)
- **Location**: src/components/organisms/dashboard/availability-view.test.ts:27-42
- **Detail**: Both tests restate the implementation's arithmetic back to itself
  (`toBe(SPRINT_END.getTime() + 1)`; `to − from === end − start`). Neither expresses the
  function's real contract — "the two rendered day axes must not share a day" — which is
  precisely why F1 shipped. The second test is also strictly implied by the first.
- **Fix**: Replace both with assertions over `buildAvailabilityGrid(...).days` for the two
  windows, using a mid-day `sprintEnd`. Fixing F1 and F3 is one edit.
- **Decision**: FIXED — both tautological tests replaced by assertions over the days the grids actually draw

### F4 — Seeded `DEVELOPER_INACTIVE` names a member with no In-Progress work

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (demo data consistency)
- **Location**: scripts/seed-dashboard.mjs:314-319
- **Detail**: The static row was moved off Erik (now absent, so the flag would have
  contradicted the absence) onto Dana. But Dana holds only `WEB-90` (TESTING) and
  `WEB-97` (null category) — no `IN_PROGRESS` ticket — while the row's own description
  says "while holding in-progress work". A real `detectAnomalies` run would not emit
  `DEVELOPER_INACTIVE` for her either, so the demo inbox loses that anomaly type after
  the first real detection. Cosmetic for S-08; it matters as an input to S-09, whose
  success criterion counts visible anomaly types.
- **Fix**: Move the unplanned absence from Alice to Bob and put the flag on Alice, who
  holds `WEB-93` (IN_PROGRESS) and would then carry no absence — making every static row
  consistent with what a real detection run would produce. Update the
  `SPRINT_AT_RISK:absence` row and MANUAL-CHECKLIST row 6.5 to match.
- **Decision**: FIXED — flag moved to Alice (holds WEB-93 IN_PROGRESS, no absence); unplanned absence moved to Bob, capacity-only to Chen

### F5 — `SET NOT NULL` migration has no backfill guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: src/db/migrations/0008_flawless_veda.sql:2
- **Detail**: `is_planned` was created nullable (`0001_lying_human_cannonball.sql:23`),
  and `SET DEFAULT true` does not rewrite existing NULLs. Any pre-existing NULL row makes
  the migration abort with `column "is_planned" contains null values` and blocks the
  deploy. The local table holds 0 rows and S-08 is the column's first writer, which is why
  this is a warning and not critical — but the statement is unsafe by construction and
  nothing guards it.
- **Fix**: Prepend `UPDATE "absence" SET "is_planned" = true WHERE "is_planned" IS NULL;`
  to the migration.
- **Decision**: FIXED — backfill UPDATE prepended; local ledger unchanged (drizzle keys on the journal timestamp), so it applies on first run elsewhere

### F6 — The slice takes two contradictory positions on `Date` across the RSC boundary

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/(app)/settings/absences/page.tsx:57-64 vs src/app/(app)/dashboard/page.tsx:155-161
- **Detail**: The dashboard converts dates to ISO strings and justifies it with
  *"A `Date` in props would not survive serialization"*; the absences page hands raw
  `Date` objects to a `"use client"` component. Both work — React's Flight serializer
  encodes `Date` — so the comment's stated reason is false. But the house rule is written
  down at `src/components/organisms/anomaly/types.ts:5` ("no `Date`/`unknown` across the
  RSC boundary"), and the absences page is the only surface in `src/` that breaks it.
- **Fix**: Serialize on the absences page too, and correct the justification comment on
  the dashboard page to cite the convention rather than a limitation that does not exist.
- **Decision**: FIXED — absences page serializes; the false serialization justification on the dashboard corrected to cite the convention

### F7 — `computeSprintCapacity` takes no `now` (planned drift, defensible)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/dashboard/capacity.ts:63-67
- **Detail**: The plan said "a pure reducer with `now` injected". `now` is absent and the
  omission is argued in the docstring. The property the convention exists to protect —
  no hidden clock reads — is fully preserved: there is no `Date.now()` or `new Date()` in
  the function, so it is deterministic on its inputs. Worth knowing: this makes capacity a
  WHOLE-SPRINT number, so on day 9 of 10 it still reports the full-sprint figure. That is
  what the plan's Desired End State asks for, but it is not "capacity remaining".
- **Fix**: None recommended. Accept, or record the whole-sprint semantics in the plan.
- **Decision**: ACCEPTED — plan amended with the whole-sprint semantics so S-18 cannot assume 'remaining capacity'

### F8 — `/settings/absences` reads the owner's whole absence set

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/(app)/settings/absences/page.tsx:32-37
- **Detail**: The plan said "the current sprint's absences"; the page passes no window and
  documents why (a vacation booked for next month would be entered and then appear to
  vanish; a past absence would be uncorrectable). The `from`/`to` parameters exist on
  `listAbsences` and are simply unused here. It is an unbounded owner-scoped scan on a
  table with no `(owner_id, …)` index — benign at the PRD's 3–10-person scale with
  current+2-sprint retention, but it is the one place the plan's Performance
  Considerations note is not honoured.
- **Fix**: None required now. Revisit if a real query proves slow, per the plan's own rule.
- **Decision**: ACCEPTED — documented tradeoff; revisit only if a real query proves slow, per the plan's own rule

### F9 — `defaultIsPlanned` keys off when the absence STARTS, not when it was recorded

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (the plan's own rule is the thing in question)
- **Location**: src/components/organisms/settings/absence-calendar-view.ts:146-152
- **Detail**: D2's wording is "known before the sprint started", but the implemented
  default — which follows the plan's Phase 2 contract literally — is "starts before the
  sprint started". A vacation booked three weeks in advance that begins on sprint day 3
  therefore defaults to UNPLANNED and raises `SPRINT_AT_RISK` unless the owner notices and
  unchecks the box. The checkbox is overridable and labelled, so this is a default-quality
  issue, not a correctness one — but it is inverted for the most common planned case.
  Note this is a challenge to the PLAN, not a deviation from it.
- **Fix**: Either accept (the owner overrides), or default from `created_at` vs sprint
  start instead of from the window's start — which would need a decision, since the row
  does not exist yet at the moment the form renders.
- **Decision**: ACCEPTED — the implementation follows the plan; the default's inversion for advance-booked mid-sprint holidays is recorded here as a question for a future slice

### F10 — An absence recorded with no active sprint can never raise risk

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/anomaly/rules/sprint-at-risk.ts:136
- **Detail**: `createAbsence` stamps `sprintId: activeSprint?.id ?? null` and the rule
  requires `absence.sprintId === snapshot.sprint.id`, so an unplanned absence entered
  between sprints stores NULL and can never raise `SPRINT_AT_RISK` — not even once the
  sprint it falls inside becomes active. The store test asserts the NULL is stored;
  nothing covers the downstream consequence. Probably acceptable for the MVP.
- **Fix**: Add a comment at the rule's sprint check naming the gap, or re-stamp `sprintId`
  when a sprint becomes active (which belongs with S-16 sprint reconciliation).
- **Decision**: FIXED — gap named in a comment at the rule's sprint check, pointing at S-16 as the owner

## Consolidated minor notes (not tracked as findings)

- `developer-inactive.ts:47-50` — suppression fires on any overlap, so a developer back
  since Monday with a Friday-ending absence stays suppressed for the rest of the
  no-commit window. Pinned as intended by a test; defensible.
- `capacity.ts:151,184` — re-resolves the sprint and timezone the dashboard page already
  holds (3 avoidable round-trips). `getBurndownSeries` has the same habit, so it matches
  the existing precedent; the divergence is that the sibling takes `sprintId` as a param.
- `absence-store.ts:141-142,183` — two independent `await`s that could be one `Promise.all`.
- `capacity.ts:92` — `byMember` rebuilds the array per absence; irrelevant at this scale.
- `helpers.test.ts:88-97` — the `nonWorkingDays` seam has no production caller, and that
  test sits inside `describe("countWorkingDays")` while asserting the inclusive variant.
- `detect.integration.test.ts` — the hand-derivation comment contradicts itself in its
  first clause; the assertion matches the second reading.
- `absence-editor.tsx:385-389,449-455` — `emptyValues` seeds `""`, so submitting with no
  days picked shows zod's generic "Invalid ISO date"; `errors.startDate` is never rendered.
- Not reproduced: an agent reported `npm run lint` failing on a stale `.stryker-tmp`
  sandbox. `.stryker-tmp` is present on disk and lint passes cleanly. No action.

## Security — clean

Every read and write in `absence-store.ts`, `capacity.ts` and `load-snapshot.ts` carries an
explicit `eq(…ownerId, ownerId)`. IDOR is closed on both id paths: `updateAbsence`
selects-then-throws rather than upserting, `deleteAbsence` returns-and-throws on zero rows,
and `assertOwnedMember` blocks attaching an absence to a foreign `team_member_id` — each
with a cross-owner integration test that also asserts the victim's row is untouched.
Redundant owner predicates are kept as defence in depth. No secrets reach logs or action
return types, and the absence TYPE is deliberately kept out of the persisted anomaly row
(asserted at both the rule and DB layers) because FR-018 mails those rows out.

## Post-triage verification (2026-08-25)

`npm test` 433/34 · `npm run test:integration` 154/14 · `npm run typecheck` ✅ ·
`npm run lint` 0 errors / 5 pre-existing warnings · production build lists
`/settings/absences` · `npm run test:mutation` 78.96 ≥ break 70 · seed re-run twice
against a throwaway owner (created and deleted), absence day spans read back
through `Intl` in the team zone and match the intended offsets exactly.
