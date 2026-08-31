<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Working-Day-Aware Anomaly Aging (S-28)

- **Plan**: `context/changes/working-day-aging/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged 2026-08-31 (7 fixed, 1 recorded, 1 deferred, 1 accepted)
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run for this review)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npx eslint src e2e` | 0 errors (4 pre-existing warnings) |
| `npm test` | PASS — 96 files, 1319 tests |
| `npm test -- fixture` | PASS — 84 tests |
| `npm run test:integration` | PASS — 30 files, 370 tests |
| `npm run test:e2e` | PASS — 17/17 |
| `npm run test:mutation` | PASS — score **85.61** vs `break: 70` |
| `node scripts/manual-test-sweep.mjs` | exit 0 |
| `grep SP21_CHOICES src/` | empty ✓ |
| `grep MS_PER_DAY src/lib/anomaly/rules/` | only `helpers.ts` definition; **zero rule callers** ✓ |
| `grep 8_WORKING_DAYS src/` | validator compat path + comments; **no detector branch** ✓ |

All eight automated criteria pass. The eight manual rows (2.6, 2.7, 3.6, 4.5, 4.6, 4.7, 5.8, 5.9) are pending, none rubber-stamped.

## Findings

### F1 — Pre-slice NUMERIC overrides are silently reinterpreted as ~3× longer

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/db/defaults.ts:38-62, src/lib/anomaly/thresholds.ts:83
- **Detail**: The plan's `## Migration Notes` reasons carefully about the `"8_WORKING_DAYS"` string sentinel and concludes "no migration" — and for the sentinel that is right, handled by a schema-level transform and pinned by three tests. It never addresses the **numeric** case, which is the larger population: every override that is not the 21-SP bucket. Defaults moved by exactly 3× (24→8, 48→16, 72→24, 120→40), but a *stored* override does not move. An owner who saved `codeReviewHours: 24` meaning one calendar day now has 24 **working** hours = 3 working days; a saved `inProgressHoursBySp["8"]: 120` becomes 15 working days ≈ 3 calendar weeks, so `TICKET_STATUS_AGING` effectively stops firing for that account for the rest of the sprint. Nothing on screen says so — the card shows the same digits it always showed, only the unit label changed. The failure direction is **suppression**, which is invisible by construction. `MANUAL-CHECKLIST.md` row 2.6 asks the tester to confirm the card "shows the account's own values" — i.e. it verifies precisely the property that hides this.
- **Fix A ⭐ Recommended**: Tell the user rather than migrating — add a line to `WORKING_TIME_HINT` (and/or the card body for `isOverridden` rules) saying a number saved before this change is now read as working hours, eight to the day, so it means roughly 3× longer than intended; plus a backlog row to revisit.
  - Strength: No data is rewritten, so nobody's deliberate choice is overwritten; the copy layer is already the single place this slice puts unit explanations.
  - Tradeoff: Leaves each account to act; a lead who never opens settings stays mis-tuned.
  - Confidence: HIGH — the copy hook exists and is already rendered above `SAVE_HINT`.
  - Blind spot: How many real accounts actually hold overrides; production may hold none, which would make this moot.
- **Fix B**: One-off backfill dividing pre-slice numeric bodies by 3.
  - Strength: Preserves each account's original *intent* exactly, with no user action.
  - Tradeoff: Rewrites user data on a guess about when the row was written; there is no timestamp distinguishing a pre-slice 24 from a deliberate post-slice 24, so it would corrupt anyone who tuned after the merge.
  - Confidence: LOW — the "written before the slice" predicate may not be reconstructable.
  - Blind spot: Have not checked whether `anomaly_settings` carries a usable `updated_at`.
- **Decision**: RECORDED — impact corrected from HIGH to LOW at triage: `select count(*) from anomaly_settings` on production returns **0**, so the blast radius was empty and neither fix was warranted. Written up in `change.md` ("Stored numeric thresholds changed meaning, and nobody held one") so a later reader does not hunt a victimless bug.

### F2 — `shiftWorkingHours` clamps silently, and the clamp suppresses anomalies

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/anomaly/rules/working-time.ts:190
- **Detail**: Termination is genuinely sound and was verified by execution, not by reading the comment — `maxDays = ceil(remaining/8)*7 + 14` is reached and clamps under every pathological input tried (every day a non-working day; a `workingDays` array that never matches; the 2000-hour validator ceiling; `NaN`). There is no CPU-limit risk. The problem is what happens *after*: line 190 returns the walked-to cursor with nothing distinguishing "found the hours" from "gave up". A lead who records a ~4-week company shutdown as team-wide days off (FR-007) makes `detectDeveloperInactive` ask for 16 working hours back with `maxDays = 28`; the shutdown swallows all of them and `windowStart` clamps to roughly a month earlier. The rule then asks "has this developer committed since a month ago?", nearly always yes, and emits nothing. `TICKET_NO_COMMIT_LINK` behaves the same. The inbox reads as a healthy quiet sprint. This is `lessons.md`'s "a narrowing predicate turns 'wrong value' into 'empty result', which reads as success", including its obligation (a) — the operator log must distinguish the cases — which is not met. `mergeRule` two files over honours that obligation with a `console.error`.
- **Fix**: Make the clamp announce itself — return `{ instant, clamped }`, or at minimum `console.error("[anomaly/working-time] calendar could not supply N working hours within M days; window clamped")` at line 190, matching `thresholds.ts:76`'s idiom.
  - Strength: Converts a permanent silent suppression into something the operator log names; one line for the minimal form.
  - Tradeoff: A returned flag touches every call site; the log-only form does not.
  - Confidence: HIGH — the failure path is reachable with ordinary FR-007 data.
  - Blind spot: Whether Workers' log retention makes a `console.error` actually visible to this operator.
- **Decision**: FIXED — the clamp now calls `console.error` naming the hours asked for, the day bound, how many working hours short it fell, and that any rule using the window is measuring a WIDER span than it requested. Two tests added: one pinning the log (message content, not just the call), one asserting silence when the calendar CAN supply the hours.

### F3 — A non-canonical `workingDays` array zeroes the clock permanently and silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/anomaly/rules/helpers.ts:167-175
- **Detail**: `workingDaySet` treats any non-empty array as authoritative without checking its members are canonical `WeekdayCode`s, while `weekdayOf` only ever produces `"MON"…"SUN"`. Measured: `["MON",…,"FRI"]` → 40 working hours over a week; `["mon",…,"fri"]` → **0**; `["Monday","Tuesday"]` → **0**. Any `sprint.working_days` row with lowercase or long-form codes makes `workingHoursBetween` return 0 for every span forever, so `TICKET_STATUS_AGING`, `PR_REVIEW_STALLED` and `TICKET_NO_COMMIT_LINK` never fire — and `SPRINT_AT_RISK`'s `hoursLeft` collapses to `0 <= 16`, so `todo_near_end` fires on day one of every sprint. The signature is "one permanent sprint-at-risk row and nothing else", which reads as a quiet sprint plus a nag rather than a broken clock. Reachability today is low — the only writers are `deriveCadence` (always canonical) and a zod-enum'd roster form — but it becomes reachable the moment anything writes that column out of band, which is exactly what **S-17** (holiday derivation) is scheduled to do.
- **Fix**: In `workingDaySet`, intersect the supplied array against the seven known codes and fall back to Mon–Fri when the intersection is empty, with a `console.error`. Two lines in a function both counters already share, so it covers `countWorkingDays` at the same time; add the matching case to `working-time.test.ts`, the one branch that otherwise-excellent suite does not cover.
- **Decision**: FIXED — `workingDaySet` now intersects the stored array against the seven codes `weekdayOf` can emit. A partial match is honoured (`["MON","TUE","junk"]` → two working days, no log); a total mismatch falls back to Mon–Fri and logs. Three tests added, including the message content.

### F4 — `fixture.ts:315` still describes the retired 48-hour lead time

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/demo/fixture.ts:315
- **Detail**: `// Still To Do with under 48h left → SPRINT_AT_RISK (todo_near_end).` The lead time is now **16 working hours** and the fixture's sprint tail is **12**, so the sentence names two numbers that no longer exist. The behaviour is correct — `fixture.test.ts` asserts `todo_near_end` fires on all fourteen anchors — only the prose lies. It matters more than an ordinary stale comment because this file's comments are the fixture's contract: `fixture.test.ts` was built precisely to make the "→ fires X" comments executable, and this one sits just outside that net.
- **Fix**: Rewrite to name the working-hour lead time and the 12-working-hour tail.
- **Decision**: FIXED — the comment now names the working-hour lead time (16) and the fixture's 12-working-hour tail, and records why the two To Do rows deliberately keep calendar offsets.

### F5 — `countWorkingDays` is now dead production code

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/anomaly/rules/helpers.ts:104
- **Detail**: The exclusive-start variant had exactly one caller — the 21-SP branch this slice dissolved. Grep confirms zero production callers remain; only doc references and its own test file. `countWorkingDaysInclusive` still has four real callers. The plan never asked for its removal, so this is a by-product rather than a violation, but it leaves a second working-day counter in the tree that nothing exercises — the "two counters that disagree" shape `lessons.md` and this plan's own note both warn about, now with one of the two unread.
- **Fix**: Delete it with its test, or document it as deliberately retained.
- **Decision**: FIXED — `countWorkingDays` deleted, and `countDays`' now-constant `skipFirst` parameter with it. Its tests were NOT deleted: they pinned the walk SHARED with `countWorkingDaysInclusive` (zone bucketing, Mon–Fri fallback, custom day set, `safeZone` degradation), so they were re-pointed at the surviving counter with a note saying why they read the way they do.

### F6 — `working-time.ts`'s doc block asserts semantics the code does not implement

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/anomaly/rules/working-time.ts:88-92
- **Detail**: The block claims "a span whose working portion is 08:00–16:00 on a spring-forward day is 8 working hours even though 7 hours of real time passed. That is the intended reading." Line 119 computes `(hi - lo) / MS_PER_HOUR` — real elapsed milliseconds. Were a zone ever to transition inside 08:00–16:00 local, the function would return 7, not 8. No current IANA zone does, which is why nothing catches it. `shiftWorkingHours:174` uses the same real-elapsed formula, so the two stay mutually consistent and the round-trip property is safe. The risk is a future maintainer "repairing a bug" against that paragraph and breaking the round trip. (The primitive itself is correct across DST — verified on both Warsaw transitions plus Santiago, Lord Howe, Chatham, Tehran, Havana, Troll, and the sub-hour zones Kolkata / Kathmandu / Eucla: 8 hours each.)
- **Fix**: Say the window is *bounded* by wall-clock hours but *measured* in real elapsed time, or delete the claim.
- **Decision**: FIXED — the block now states that the window is BOUNDED by wall-clock hours and MEASURED in real elapsed time, and records that the previous wording claimed the opposite and would have led a future reader to break `shiftWorkingHours`' round-trip while 'fixing' it.

### F7 — The DST-critical half sits outside the mutation glob the primitive was placed inside

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: stryker.conf.json
- **Detail**: `working-time.ts` was deliberately put under `src/lib/anomaly/rules/` — the plan says so explicitly — so `stryker.conf.json`'s mutate glob covers it, and it scores 90.16. But it delegates its hardest arithmetic, `localHourInstant`'s binary search over local wall-clock hours, to `src/lib/dashboard/day-bucket.ts`, which is **not** in the glob. The reasoning that put the primitive under `rules/` applies at least as strongly to the function doing the DST math.
- **Fix**: Extend the mutate glob to `src/lib/dashboard/day-bucket.ts`, or record the asymmetry as deliberate.
- **Decision**: FIXED — `src/lib/dashboard/day-bucket.ts` added to `stryker.conf.json`'s mutate glob with the reasoning in the config comment. Re-run: gate holds at **85.34** (was 85.61 over a smaller surface) and the newly-covered file scores **88.76**.

### F8 — `ticket-status-aging.ts` is the weakest file in the mutation gate, at 72.41

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/anomaly/rules/ticket-status-aging.ts
- **Detail**: The gate passes overall at 85.61 against `break: 70`. Per file, `ticket-status-aging.ts` scores **72.41** with 7 survived mutants — the lowest of the twelve, 2.41 points above the break threshold and below `stryker.conf.json`'s own `low: 70`/`high: 85` band. It is also the file this slice restructured most heavily: the `"8_WORKING_DAYS"` branch was dissolved and all five budget branches re-pointed at the new primitive. Not a gate failure; a thin margin on the file that changed most.
- **Fix**: Look at the 7 survivors and kill the ones that are real (boundary comparisons on `ageHours < budget` and the `magnitude` denominator are the likely candidates).
- **Decision**: INVESTIGATED, NO TEST ADDED — and that is the finding. All seven survivors were read from the JSON report: five are EQUIVALENT mutants in `inProgressBudget` (`Object.keys` returns integer-like keys in ascending order by spec, so `.sort` and its comparator are unobservable; `budget == null` is loose, so `undefined` and `null` take the same branch; the exact-match short-circuit and the `k <= sp` loop select the same key), and two are string mutants inside the description sentence. Tests for these could not fail. Recorded in a doc block on `inProgressBudget` so the next reader does not spend an afternoon on it. The 72.41 is a measurement artifact, not a coverage gap.

### F9 — Changing the monitored Jira project nulls `time_zone`, moving the whole clock to UTC

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/jira-store.ts:233
- **Detail**: `...(projectChanged ? { boardId: null, timeZone: null } : {})`. Until the team step re-runs and repopulates it from Jira's `/myself`, `safeZone` degrades to UTC and the working window becomes 08:00–16:00 **UTC**. For a US-Pacific team that is 01:00–09:00 local: weekends are still excluded, so the slice's headline promise survives, but the clock's phase is off by up to ~16 hours and a ticket can age out most of a day early or late. No banner, no log. Pre-existing, and this slice is what gives it teeth.
- **Fix**: Backlog row rather than a change in this slice.
- **Decision**: DEFERRED to the backlog as row **28.A** (`manual-test-backlog.md` §3), with the route, the mechanism, the US-Pacific worked example and the pass condition. Pre-existing defect that S-28 gives teeth to; not this slice's to fix.

### F10 — `sprint-at-risk.test.ts` lacks the Friday/Sunday/Monday pair the Testing Strategy required in all five rule test files

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/anomaly/rules/sprint-at-risk.test.ts:98
- **Detail**: The plan's `## Testing Strategy` says the Friday-afternoon / Sunday / Monday pair "belongs in **all five** rule test files". Four have it. `sprint-at-risk.ts` has an equivalent working-vs-calendar boundary test instead (16 wh fires, 20 wh does not) — defensible, because this condition counts *forward* to sprint end and the pair does not translate. Recorded only because the plan stated the requirement absolutely.
- **Fix**: Accept the substitution and note it in the plan, or add the pair if it can be made meaningful.
- **Decision**: ACCEPTED — the substitution is right, because `SPRINT_AT_RISK` counts FORWARD to sprint end and the Friday-afternoon anchor has nothing to attach to. The plan's `## Testing Strategy` is amended in place to state the requirement as it was actually reaching for: all five files pin the working-vs-calendar difference.

## Notes not raised as findings

- **The plan's own biggest named risk was closed properly.** The `"8_WORKING_DAYS"` sentinel does not trip `mergeRule`'s `.strict()` discard: it is accepted by a union and transformed to 64 at the schema boundary, so the detector never sees a string, severity is preserved, and there is no unprompted "Unsaved changes." on load. Pinned by a unit test, a detector test *and* a real-Postgres integration test.
- **No performance finding.** A realistic cold detect cycle (60 tickets, 20 PRs, 6 developers, 3-week window) measures 5.9 ms; warm, 2.9 ms. `shiftWorkingHours` is correctly hoisted out of both detector loops, and the zone/day/hour caches collapse the binary searches to one per key for the isolate's life.
- **Float accumulation reaches 63.99999999999999** on an exact-64-hour span, which evaluates as not-yet-aged for one detect cycle and self-heals on the next. Not worth a change; worth knowing before someone asserts exact equality at a threshold.
- **`enumerateDayKeys`' 400-day cap** silently truncates very old spans — a 2.6-year span measures 2296 working hours against a true ~5520. Verdicts are unaffected (both are far past any budget and `magnitude` clamps), but the rendered `daysInProgress` would understate an ancient ticket. Pre-existing; this slice surfaces it in user-visible copy.
- **The working-day predicate is now written three times** (`working-time.ts:78`, `helpers.ts:190-191`, `helpers.ts:153-154`). Collapsing them would also make F3's fix land in one place.
- **Scope discipline is clean.** Every "not doing" boundary held: no migration, no configurable window, individual absences stop no clock, `DEVELOPER_INACTIVE`'s FR-010 suppression byte-identical, `SPRINT_AT_RISK`'s absence arithmetic untouched, the Daily Recap untouched, `noCommitDays` neither renamed nor extended. The extras — the `localHourInstants` memo, `workingHoursAfter`, and five further fixture rows converted to working hours — are all justified; the fixture ones were necessary, since two of them were suppressing `DEVELOPER_INACTIVE` and `TICKET_NO_COMMIT_LINK` outright on a Monday anchor.
