<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Next-window capacity as a number on the availability tab

- **Plan**: `context/changes/next-sprint-capacity/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, F2) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Scope

23 files changed across `b547b03`, `88b4535`, `2675f65`, `83a1f5f`. **Every
changed source file is named in the plan; nothing outside it was touched.** All
six "What We're NOT Doing" boundaries hold in the diff: no SP estimate for the
next window, no `state=future` Jira fetch, no override or delivered-SP line for
the forecast window, the current sprint's bounds and capacity untouched, no
migration, no change to how absences are entered.

## Success criteria

| Criterion | Result |
|---|---|
| `npm run lint` | PASS — 0 errors (4 pre-existing warnings, untouched files) |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 1460 / 107 files |
| `npm run test:integration` | PASS — 450 / 34 files |
| 1.5 `nextWindowAfter` gone from the client surface | PASS — no `.tsx` hit |
| 2.5 `grep "holidayYears(" src/app` empty | PASS |
| 1.6 `test:e2e -- cadence-restore` | PASS — 2/2 |
| 3.5 every sentence from `next-window-capacity-view.ts` | PASS — `.tsx` carries static labels and counts only, mirroring `CapacitySummary` |

Five Manual rows (1.7, 2.6, 3.6, 3.7, 3.8) are correctly left `- [ ]` — deferred
by the owner, not rubber-stamped. They are carried in `MANUAL-CHECKLIST.md` and
backlog §29; `manual-test-sweep.mjs` exits 0.

**Verified sound, no finding:** `sweep.ts` reads only `capacity.capacity.*` and
the two dates, so it persists nothing from the new fields and its numbers are
unchanged — `countWorkingDaysInclusive` returns 0 on an inverted range
(`helpers.ts:107`), so the widened absence set cannot inflate a closed sprint's
absent days. The demo fixture sets `lengthDays: 14` and its Bob absence runs to
`dayKey(3)` against a sprint end ~1.5 working days out, so `hasForwardAbsence` is
true in demo and the stronger notice does not fire there.

## Findings

### F1 — An absence on the sprint's LAST DAY counts as "forward", suppressing the notice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/dashboard/capacity.ts:352` (`gt(absence.endDate, sprintEnd)`)
- **Detail**: `absence.end_date` is stored as the LAST INSTANT of its local day
  (`absence-dates.ts:45`, `dayRangeInTimeZone(endDay).to`), while `sprint.end_date`
  is Jira's arbitrary instant — typically 08:00Z. An absence recorded on the
  sprint's own final day therefore ends at 23:59:59.999 local, which is `>`
  sprintEnd, and `hasForwardAbsence` comes back **true** for a lead who has
  recorded nothing forward at all. The stronger notice is then suppressed for
  exactly the account it was written for. Confirmed empirically against local
  Postgres: sprint ending `2026-08-14T08:00:00.000Z`, one absence
  `2026-08-14 → 2026-08-14`, expected `false`, got `true`. Taking the sprint's
  last day off is a common thing to record, so this is not a corner.
- **Fix**: Compare on DAY KEYS in the team's zone rather than on instants — the
  same rule the window itself follows. Select the latest end date instead of
  `limit(1)` on the id (`orderBy(desc(absence.endDate)).limit(1)`, same index,
  same fan-out, same cost), then decide after the zone resolves:
  `hasForwardAbsence = maxEnd != null && dayKeyInTimeZone(maxEnd, timeZone) > dayKeyInTimeZone(sprintEnd, timeZone)`.
  - Strength: Exact, and keeps the ONE fan-out the plan's F4 answer rests on — the
    zone is already in the same result tuple, so no round trip is added.
  - Tradeoff: The predicate moves half into JS; the query alone no longer states
    the rule.
  - Confidence: HIGH — the storage convention is explicit in `absence-dates.ts`
    and the failure was reproduced, not inferred.
  - Blind spot: None significant; the probe covers the boundary directly.
- **Decision**: FIXED — `capacity.ts` now selects the latest `end_date` (`orderBy
  desc`, same index, same fan-out) and compares day keys in the team's zone. Two
  regression cases added to `capacity.integration.test.ts`: an absence on the
  sprint's own last day is NOT forward, one on the day after IS.

### F2 — The absence bound's stated invariant does not hold at the maximum cadence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/dashboard/capacity.ts:328` (`sprintEnd + MAX_CADENCE_LENGTH_DAYS × 86_400_000`)
- **Detail**: The comment above it claims "a bound no resolved window can exceed",
  and the constant exists precisely so that claim stays true. At `lengthDays = 90`
  — the editor's own ceiling — the margin is exactly zero, and a DST fall-back
  inside the window consumes it: 90 days of milliseconds added to an instant lands
  one hour EARLIER in local terms, so with a sprint ending in the first hour of
  its local day, an absence starting on the window's last day sits ~30 minutes
  past `lookahead` and is dropped. The symptom is silent and one-directional —
  the absence vanishes and `adjustedMd` rises — which is `lessons.md`'s
  narrowing-predicate rule, the very rule the constant was introduced to honour.
  Requires all three conditions at once, hence OBSERVATION rather than WARNING.
- **Fix**: Add two days of slack — `(MAX_CADENCE_LENGTH_DAYS + 2) × 86_400_000` —
  and say in the comment that the slack absorbs zone offsets and DST. The extra
  rows are inert: the reducer clips and the grid filters.
- **Decision**: FIXED — bound is now `(MAX_CADENCE_LENGTH_DAYS + 2)` days, and the
  comment states the slack absorbs every zone offset (-12…+14) and both DST
  directions rather than claiming an invariant that did not hold.

### F3 — The copy module's test sits beside the module, not where Testing Strategy named it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/organisms/dashboard/next-window-capacity-view.test.ts`
- **Detail**: The plan contradicted itself: Phase 3 §2 puts the module at
  `src/components/organisms/dashboard/next-window-capacity-view.ts`, while §4 and
  Testing Strategy name the test `src/lib/dashboard/next-window-capacity-view.test.ts`.
  The implementation followed §2 and placed the test as a sibling, matching
  `capacity-adjustments-view.ts` / `.test.ts` and `availability-view.ts` /
  `.test.ts`. This is the right resolution — recorded so the deviation from a
  literal plan path is not read later as an unexplained miss.
- **Fix**: None needed in code. Optionally note the resolution in the plan.
- **Decision**: FIXED — the plan's Testing Strategy now records the sibling path
  and why it won. No code change.
