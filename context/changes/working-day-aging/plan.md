# Working-Day-Aware Anomaly Aging (S-28) Implementation Plan

## Overview

Every elapsed-time budget in the anomaly engine stops being a wall-clock budget
and becomes a **working-hours** budget: the clock advances only between 08:00 and
16:00 in the team's time zone, only on days in `sprint.working_days`, and never on
a day the lead has marked as a team-wide day off. Individual absences do not stop
the clock. Eight working hours make a working day, so every threshold that is
"hours" today keeps its unit name and changes its meaning, and the one threshold
that was a working-day sentinel becomes an ordinary number.

The defect this closes, in the owner's own report: a 3 SP ticket moved to In
Progress on Friday at 16:00 has a 48 h budget and fires on Sunday at 16:00, into
the Monday morning-sync inbox that FR-016 calls the product's headline surface.

## Current State Analysis

`countWorkingDays` / `countWorkingDaysInclusive` (`helpers.ts:96-118`) exist, are
tested, and take the sprint's `workingDays`, the team's zone and `nonWorkingDays`
— and are read by **3 of ~9** elapsed-time measurements. Everything else does raw
millisecond arithmetic:

| Rule / sub-condition | How it measures today | Aware? |
| --- | --- | --- |
| `PR_REVIEW_STALLED` | `hoursBetween` (`pr-review-stalled.ts:31`) | no |
| `TICKET_STATUS_AGING` — Code Review / Testing | `hoursBetween` (`:83`) | no |
| `TICKET_STATUS_AGING` — In Progress 1–13 SP | `hoursBetween` (`:77`) | no |
| `TICKET_STATUS_AGING` — In Progress 21 SP | `countWorkingDays` (`:67`) | **yes** |
| `DEVELOPER_INACTIVE` | `now − N × MS_PER_DAY` (`developer-inactive.ts:31`) | no |
| `TICKET_NO_COMMIT_LINK` | `daysBetween` (`:36`), same window (`:28`) | no |
| `SPRINT_AT_RISK` — ToDo near end | `hoursBetween` (`sprint-at-risk.ts:88`) | no |
| `SPRINT_AT_RISK` — absence cost | `countWorkingDaysInclusive` (`:142,164`) | **yes** |
| `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC` | no elapsed-time input | n/a |

The sharpest inconsistency is inside one function: `ticket-status-aging.ts`
measures the same field against the same conceptual budget in working days for
the 21-SP bucket and in wall-clock hours for every other branch — and states the
principle in a comment on the one branch that follows it (`:62-66`).

Everything the new math needs already rides on every snapshot:
`SprintSnapshot.timeZone` and `SprintSnapshot.nonWorkingDays` are populated once
in `load-snapshot.ts:62-64,104`, `snapshot.sprint` carries `workingDays`, and
`detect.ts:54-56` hands the snapshot to every detector. **No snapshot field, no
loader change, no migration.**

What does NOT exist is any notion of a working *hour*. Cadence is day-of-week
granularity only, and Jira exposes no working-hours field (PRD FR-007's own
Socratic note). The owner's decision settles this without a config surface:
08:00–16:00 is a hard-coded average, because a budget measured in whole shifts is
long enough that an hour either side of a person's real start time cannot change
which day the anomaly lands on.

## Desired End State

A ticket, PR or developer's clock advances only during the team's working hours.
Concretely, verifiable by hand: a ticket moved to Code Review on Friday at 15:00,
with the default 8-working-hour budget, does not appear in the inbox on Saturday
or Sunday, and appears on Monday at 15:00. If the lead has marked that Monday as
a company day off, it appears on Tuesday at 15:00 instead. If its assignee is on
recorded individual leave, it appears on Monday at 15:00 all the same — the
sprint is the team's, and the inbox is an alert for the lead, not a device
pointed at a person.

The settings page reads `working hours` next to every time budget, the 21-SP
bucket is a plain number field like the other six, and an account that had
customised a rule before this slice still sees its own number afterwards.

### Key Discoveries

- **`dayRangeInTimeZone` (`day-bucket.ts:109-137`) already solves the hard half.**
  It finds a local day's boundary instants by binary search rather than by hourly
  probing, because zone offsets are not all whole hours (Kolkata +05:30,
  Kathmandu +05:45). The 08:00/16:00 boundaries need the same idiom, and adding
  a wall-clock-hour resolver beside it keeps zone arithmetic in the one file that
  owns it.
- **Local midnight + 8 h is WRONG and the codebase already says so.**
  `localTimeOfDay`'s doc block (`day-bucket.ts:74-84`) records that
  `dayRangeInTimeZone(...).from + hour × 3_600_000` lands an hour off on
  DST-transition days. The new resolver must read the wall clock, not add to
  midnight.
- **Keeping the unit in hours is what avoids the slice's biggest trap.**
  `mergeRule` (`thresholds.ts:57-87`) revalidates every stored override on **every
  read** with a `.strict()` zod schema and, on failure, discards the whole
  override — severity included — with only a `console.error`. The settings card
  then shows a "Modified" badge over default values and an unprompted "Unsaved
  changes." on load. Changing threshold *values* does not trip this; changing
  their *shape* does. This plan changes values and keeps shapes.
- **The `"8_WORKING_DAYS"` sentinel dissolves rather than being extended.** With
  the unit in working hours, "8 working days" is 64 — an ordinary number. The
  detector's special branch (`ticket-status-aging.ts:63-75`, with the literals
  `8` and `16`) collapses into the generic branch, and `magnitude` keeps the same
  curve because the generic `2 × budget` denominator is 128, exactly twice 64.
  S-14's deliberately-parked "10 working days is inexpressible" problem
  (`anomaly-settings-page/plan.md:105-108`) stops existing.
- **`DEVELOPER_INACTIVE`'s `windowStart` serves three boundaries at once**
  (`developer-inactive.ts:31`): the threshold, the commit scan (`:56`) and the
  absence-overlap check (`:48`). They must move together or the rule starts
  answering two questions.
- **The demo anchor is real wall-clock time at load** (`load.ts:71,91,130`), not a
  frozen historical instant, and every fixture timestamp is an hour-offset back
  from it (`fixture.ts:135-139`). The fixture already fears this once —
  `SPRINT_HOURS_LEFT = 47` is chosen so a working day always remains
  (`fixture.ts:55-63`) — but the anomaly-producing offsets have no such guard.
  `fixture.ts` has no test.
- **`stryker.conf.json` (`break: 70`) mutates `src/lib/anomaly/rules/**`**, so the
  new primitive's branches need tests that kill their mutants. It wins by
  filename precedence over the stale `stryker.config.json` (CLAUDE.md).

## What We're NOT Doing

- **Not making working hours configurable.** 08:00–16:00 is a constant. A per-team
  window would need a column, a migration and a settings surface, and the owner's
  decision is explicit that the averaging error does not matter at these budget
  sizes.
- **Not subtracting individual absences from any clock.** The sprint is measured
  per team; a developer's day off does not pause a ticket's aging. This is the
  behaviour the code already has, and it is now recorded as a decision rather
  than left as an accident.
- **Not removing `DEVELOPER_INACTIVE`'s absence suppression.** That is a separate
  mechanism required by FR-010 (an absent developer with no commits is explained,
  not anomalous) and it stays exactly as it is at `developer-inactive.ts:45-50`.
- **Not touching the Daily Recap's own weekend behaviour.**
  `context/manual-tests/S-11-obserwacja-recap-dni-wolne.md` reports two further
  defects at a different layer — the recap sends on weekends, and its "yesterday"
  is a calendar day. Same class, different mechanism. Phase 4 annotates that note
  so it is not read as half-closed.
- **Not changing `SPRINT_AT_RISK`'s absence-cost arithmetic** — it already uses
  `countWorkingDaysInclusive` correctly and counts whole days, which is the right
  unit for a man-day cost.
- **Not adding a migration.** `anomaly_settings.thresholds` is `jsonb` with no
  shape constraint (`schema.ts:933`).
- **Not extending or renaming the `noCommitDays` field.** It stays a day count;
  the days it counts become working days.

## Implementation Approach

One new primitive, applied to every elapsed-time measurement, then the numbers
and the copy brought into line behind it.

The primitive is deliberately **symmetric**, mirroring the two-named-intents
pattern `helpers.ts` already uses for `countWorkingDays` /
`countWorkingDaysInclusive`: one shift function with a signed hour count, and
named wrappers so no caller has to remember which direction a negative means. The
rules only need the backwards direction; the demo fixture needs the forward one
to place the sprint end, and having both come out of one implementation is what
stops the fixture and the detector from disagreeing about where a working hour
is.

Ordering is chosen so no phase leaves the engine in a state where the math has
changed but the numbers have not: Phase 2 moves the three hour-denominated rules
**and** their default values together, and Phase 3's two rules keep the value they
have (`noCommitDays: 2`), so their meaning changes without their number moving.

## Critical Implementation Details

**Timing & lifecycle.** The demo fixture must resolve its team-day-off key
(`workingDayKeyOnOrBefore`, `fixture.ts:114-133`) **before** it computes any
working-hour offset, because that day is a non-working day for the primitive and
therefore changes where every offset lands. Today the ordering is incidental;
after Phase 5 it is load-bearing.

**Debug & observability.** `mergeRule`'s failure path is a bare `console.error`
(`thresholds.ts:75-81`). Phase 2 must be verified against a database row that
carries a pre-slice override, not only against defaults — a stored
`"8_WORKING_DAYS"` that stops validating would reset that account's whole rule,
severity included, and nothing on screen would say so.

---

## Phase 1: The working-time primitive

### Overview

Add the ability to measure and to walk elapsed time in working hours, with no
change to any rule's behaviour. Nothing calls it yet; this phase exists so the
zone and DST edges are settled and killed by tests before five detectors depend
on them.

### Changes Required:

#### 1. Wall-clock-hour resolution in the zone layer

**File**: `src/lib/dashboard/day-bucket.ts`

**Intent**: Give callers the instant at which a given wall-clock hour begins on a
given local day, so a working-hours window can be built without adding
milliseconds to local midnight — the formulation `localTimeOfDay`'s doc block
already records as wrong across DST.

**Contract**: `localHourInstant(dayKey: DayKey, hour: number, timeZone?: string | null): Date`
— the earliest instant within `dayKey`'s local range whose local wall-clock hour
is ≥ `hour`; the day's exclusive end when the day contains no such instant. Found
by the same binary search `dayRangeInTimeZone` uses, over `localTimeOfDay`'s
reading rather than over day keys, so sub-hour offsets and DST shifts are handled
by the same mechanism that already handles them. Degrades to UTC through
`safeZone`, never throws.

#### 2. The primitive itself

**File**: `src/lib/anomaly/rules/working-time.ts` (new)

**Intent**: Measure elapsed working hours between two instants, and find the
instant a given number of working hours away from another. Lives under `rules/`
so `stryker.conf.json`'s mutate glob covers it; lives in its own file rather than
in `helpers.ts` because it is the only piece of that file's time math with a DST
contract worth isolating.

**Contract**:

- `WORK_DAY_START_HOUR = 8`, `WORK_DAY_END_HOUR = 16`,
  `WORK_HOURS_PER_DAY = 8` — exported so the fixture, the rules and the tests
  cannot disagree about the window.
- `workingHoursBetween(from, to, workingDays, timeZone, nonWorkingDays): number`
  — the sum, over the day keys in `[from, to]`, of each qualifying day's overlap
  with `[from, to]` ∩ that day's `[08:00, 16:00)`, in hours. A day qualifies when
  its weekday is in `workingDays` (defaulting to Mon–Fri when empty or absent, as
  `helpers.ts` already does) and its key is not in `nonWorkingDays`. Returns 0
  when `to <= from`.
- `shiftWorkingHours(from, hours, workingDays, timeZone, nonWorkingDays): Date`
  — signed: negative walks backwards, positive forwards. The result satisfies
  `workingHoursBetween(result, from) === |hours|` for a negative shift and
  `workingHoursBetween(from, result) === hours` for a positive one, up to
  floating-point equality. Terminates under a lookback/lookahead bound derived
  from `hours` (generous enough to absorb weekends and a run of holidays) and
  clamps to that bound rather than spinning when the calendar cannot supply the
  requested hours.
- `workingHoursBefore(to, hours, …): Date` — the named backwards wrapper the
  rules call, so no detector spells a negative sign.

**Note**: `weekdayOf` and the Mon–Fri defaulting currently live private in
`helpers.ts:152-190`. Export them rather than reimplementing — a second copy of
the working-day calendar is the exact "two counters that disagree" failure
`helpers.ts:69-76` and `lessons.md` both already record once.

#### 3. Tests

**File**: `src/lib/anomaly/rules/working-time.test.ts` (new)

**Intent**: Pin the contract and kill the mutants Stryker will generate on the
new branches.

**Contract**: coverage must include — a span entirely inside one working day; a
span crossing a night (the night contributes nothing); a Friday-16:00 → Monday
start returning 0; a team-wide day off removing exactly 8 hours; a `workingDays`
set that is not Mon–Fri; a null/unrecognised zone degrading to UTC; a
non-whole-hour zone (`Asia/Kathmandu`); both DST transitions in `Europe/Warsaw`,
asserting explicitly what the wall clock gives on each; the empty and zero cases;
and a round-trip property for `shiftWorkingHours` in both directions across a
weekend.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- New primitive's mutation score clears the gate: `npm run test:mutation`
- No behaviour change: every pre-existing anomaly test still passes untouched

#### Manual Verification:

- None. This phase adds an uncalled function.

**Implementation Note**: no manual pause needed; proceed to Phase 2 once
automated verification passes.

---

## Phase 2: The hour-denominated rules and their recalibrated defaults

### Overview

Move `TICKET_STATUS_AGING`, `PR_REVIEW_STALLED` and `SPRINT_AT_RISK`'s
ToDo-near-end condition onto working hours, and recalibrate `DEFAULT_THRESHOLDS`
in the same phase so the engine is never running new math against old numbers.

### Changes Required:

#### 1. Ticket status aging

**File**: `src/lib/anomaly/rules/ticket-status-aging.ts`

**Intent**: All five branches measure the same way. The `8_WORKING_DAYS` special
case disappears into the generic path once the unit is working hours.

**Contract**: `hoursBetween(since, now)` at `:77` and `:83` becomes
`workingHoursBetween(since, now, snapshot.sprint.workingDays, snapshot.timeZone,
snapshot.nonWorkingDays)`. The `budget === "8_WORKING_DAYS"` branch (`:63-75`) is
removed from the detector; the sentinel is resolved to `64` at the point the
budget is read, so `inProgressBudget` returns a `number` and `AgingThresholds`
narrows to `Record<string, number>`. Magnitude stays `clamp01(elapsed / (2 *
budget))` for every branch. The comment at `:62-66` — the principle this slice
generalises — moves to the top of the detector and is rewritten to state the
whole rule, including that individual absences do not pause it.

#### 2. PR review stalled

**File**: `src/lib/anomaly/rules/pr-review-stalled.ts`

**Intent**: A PR's review clock stops overnight and over the weekend.

**Contract**: `hoursBetween(ready, now)` at `:31` becomes `workingHoursBetween`
with the snapshot's calendar. The description at `:42` and
`suggestedAction.prReviewStalled` must say **working hours**, not `h`, or the
number reads as a calendar claim it no longer makes.

#### 3. Sprint at risk — ToDo near sprint end

**File**: `src/lib/anomaly/rules/sprint-at-risk.ts`

**Intent**: The lead time before sprint end is counted in working hours, per the
owner's decision, so one unit governs the whole engine.

**Contract**: `hoursBetween(now, endDate)` at `:88` becomes `workingHoursBetween`.
This is the one place where the change makes a number *less* like the calendar —
"16 hours left" now means two working days, not sixteen. The description at `:99`
and `suggestedAction.sprintAtRiskTodoNearEnd` must therefore name the unit
explicitly (`16 working hours left in the sprint`), and the `hoursLeft` context
key keeps its name but gains a comment recording the unit. The parallel-work
condition and the absence-cost arithmetic (`:142,164`) are untouched.

#### 4. Recalibrated defaults

**File**: `src/db/defaults.ts`

**Intent**: Preserve each threshold's intent in days at 8 working hours per day,
so a ticket starting mid-week still ages out after roughly the same number of
calendar days it does today — while a Friday one stops firing on Saturday.

**Contract**:

| Field | Today | New | Intent preserved |
| --- | --- | --- | --- |
| `PR_REVIEW_STALLED.hours` | 24 | 8 | 1 day |
| `TICKET_STATUS_AGING.codeReviewHours` | 24 | 8 | 1 day |
| `TICKET_STATUS_AGING.testingHours` | 48 | 16 | 2 days |
| `inProgressHoursBySp` 1, 2 | 24 | 8 | 1 day |
| `inProgressHoursBySp` 3 | 48 | 16 | 2 days |
| `inProgressHoursBySp` 5 | 72 | 24 | 3 days |
| `inProgressHoursBySp` 8, 13 | 120 | 40 | 5 days (the code's own comment) |
| `inProgressHoursBySp` 21 | `"8_WORKING_DAYS"` | 64 | 8 working days |
| `SPRINT_AT_RISK.toDoBeforeSprintEndLeadTimeHours` | 48 | 16 | 2 days |
| `DEVELOPER_INACTIVE.noCommitDays` | 2 | 2 | unchanged, Phase 3 |
| `TICKET_NO_COMMIT_LINK.noCommitDays` | 2 | 2 | unchanged, Phase 3 |

`IN_PROGRESS_HOURS_BY_SP`'s type narrows to `Record<number, number>`. The file's
doc comment must state the unit is working hours and point at `working-time.ts`
for the window. These are defaults, not a ceiling — the settings page remains the
place a lead retunes them for their own team.

#### 5. Backward compatibility for stored overrides

**File**: `src/lib/validations/anomaly-settings.ts`

**Intent**: An account that saved `"8_WORKING_DAYS"` before this slice must keep
its rule. Dropping the literal from the union would fail `.strict()` on read and
silently reset that account's entire `TICKET_STATUS_AGING` rule, severity
included.

**Contract**: `inProgressBudgetSchema` keeps accepting the literal, and the
union's doc comment is rewritten: it is no longer a live sentinel but a **legacy
value retained for compatibility**, normalised to `64` on read. The normalisation
belongs next to the schema so both `resolveEffectiveThresholds` and the settings
page get it from one place; the detector must never see the string. The
seven-key `.strict()` rule on `inProgressHoursBySpSchema` is unchanged and its
rationale comment still holds.

#### 6. Tests

**Files**: `src/lib/anomaly/rules/ticket-status-aging.test.ts`,
`src/lib/anomaly/rules/pr-review-stalled.test.ts`,
`src/lib/anomaly/rules/sprint-at-risk.test.ts`

**Intent**: Re-seed the fixtures onto explicit weekdays and re-derive the
magnitude literals from the new budgets. These tests are seeded on Friday and
Saturday dates today (`ticket-status-aging.test.ts:15-42,83-156`,
`pr-review-stalled.test.ts:16-43,74-106`) and will break loudly, which is
correct.

**Contract**: each rewritten test must state which weekday it seeds and why. Add
at least one test per rule that is the point of the slice: a `from` on Friday
afternoon and a `now` on Sunday producing **no** anomaly, and the same `from`
with a `now` on Monday producing one. Add one test that a team-wide day off
(passed through `snapshot.nonWorkingDays`) delays the crossing by a further
working day — for a 3 SP ticket, which is the case `manual-test-backlog.md` 11.5
currently records as deliberately *not* reacting. Add one test proving a stored
`"8_WORKING_DAYS"` resolves to a 64-working-hour budget and does not reset the
rule.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Mutation gate holds on the rule files: `npm run test:mutation`
- `grep -rn "8_WORKING_DAYS" src/` returns only the validator's compatibility path and its comment — no detector branch

#### Manual Verification:

- On `/settings/anomalies`, an account that had already customised `TICKET_STATUS_AGING` before this slice still shows its own numbers, with no unprompted "Unsaved changes." banner on page load
- The Anomaly Inbox on `/dashboard` renders with the new defaults and no rule reports an age it cannot justify

**Implementation Note**: pause here for the human to confirm the two manual
checks before starting Phase 3. The first one is the slice's largest single risk
and cannot be observed from a green test run.

---

## Phase 3: The two window-based rules

### Overview

`DEVELOPER_INACTIVE` and `TICKET_NO_COMMIT_LINK` do not compare against a budget
— they build a window (`now − N days`) and use it for three different questions.
The window becomes N *working* days without the field changing name or value.

### Changes Required:

#### 1. Developer inactive

**File**: `src/lib/anomaly/rules/developer-inactive.ts`

**Intent**: A developer is not "silent for two days" because the two days were
Saturday and Sunday.

**Contract**: `windowStart` at `:31` becomes
`workingHoursBefore(now, noCommitDays * WORK_HOURS_PER_DAY, snapshot.sprint.workingDays,
snapshot.timeZone, snapshot.nonWorkingDays)`. All three consumers of
`windowStart` — the commit scan at `:56`, the absence-overlap check at `:48`, and
the description at `:64` — move with it by construction, because they read the
same variable; the description's "in the last N days" must become "in the last N
working days". FR-010's absence suppression (`:45-50`) is unchanged, and its
existing doc block gains one sentence recording that suppression is a separate
mechanism from the clock, which does not pause for individual absences.

#### 2. Ticket with no commit link

**File**: `src/lib/anomaly/rules/ticket-no-commit-link.ts`

**Intent**: Both halves of this rule — "is the ticket old enough to expect
commits" and "has anything referenced it lately" — are asked over working days.

**Contract**: `windowStart` at `:28` is built with `workingHoursBefore` as above.
The freshness gate at `:36-37` becomes a working-hours comparison
(`workingHoursBetween(since, now) < noCommitDays * WORK_HOURS_PER_DAY`), and
`daysInProgress` — which appears in the description at `:51`, the suggested
action, the context payload and the magnitude — is derived from those working
hours divided by `WORK_HOURS_PER_DAY`, with the copy saying **working days**.

#### 3. Tests

**Files**: `src/lib/anomaly/rules/ticket-no-commit-link.test.ts`,
`src/lib/anomaly/rules/developer-inactive.test.ts`

**Intent**: Re-seed onto explicit weekdays, and repair one test that will pass for
the wrong reason.

**Contract**: `ticket-no-commit-link.test.ts:42-58` asserts `[]` because a linked
commit suppresses the rule; under a working-day gate the same seed returns `[]`
because the ticket is too fresh, exiting before the commit is examined. Re-seed
it so it still exercises the suppression branch, and add a sibling asserting the
freshness branch separately. `developer-inactive.test.ts:42-50` pins a
window-boundary claim that goes stale; restate it in working days. Both files
gain a weekend-spanning case.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Mutation gate holds: `npm run test:mutation`
- `grep -rn "MS_PER_DAY" src/lib/anomaly/rules/` shows no remaining window arithmetic in these two files

#### Manual Verification:

- With a recorded absence covering the window, the absent developer still does not appear as `DEVELOPER_INACTIVE` — FR-010's suppression survived the window change

**Implementation Note**: pause for that one confirmation before Phase 4.

---

## Phase 4: Settings surface, copy, and the PRD

### Overview

Bring the lead-facing surfaces into line with the unit the engine now uses, and
amend FR-009, which today mixes units and says nothing about weekends.

### Changes Required:

#### 1. Unit labels and the retired sentinel

**File**: `src/components/organisms/settings/anomaly-rules-view.ts`

**Intent**: Every time budget names its real unit, and the 21-SP bucket stops
being a two-position choice now that its value is an ordinary number.

**Contract**: in `RULE_DESCRIPTORS`, `unit: "hours"` becomes `"working hours"`
for `PR_REVIEW_STALLED.hours`, `codeReviewHours` and `testingHours`;
`unit: "days"` becomes `"working days"` for both `noCommitDays` fields; and
`toDoBeforeSprintEndLeadTimeHours` becomes `"working hours before sprint end"`.
`SP21_CHOICES` is deleted along with its doc block — the reason it existed ("10
working days is not expressible") no longer holds. The `detects` copy for
`DEVELOPER_INACTIVE` and `TICKET_NO_COMMIT_LINK` says working days. Add one
sentence of section copy stating the window the clock runs in (08:00–16:00, team
working days, minus company days off) and that individual absences do not pause
it — per this file's own convention, that is a system behaviour which is
otherwise invisible and would be read as a bug.

#### 2. The story-point budget control

**File**: `src/components/organisms/settings/anomaly-rules-editor.tsx`

**Intent**: The 21-SP field becomes a plain number input like the other six.

**Contract**: remove the `SP21_CHOICES` select branch from `StoryPointBudgets`
(`:260-336`); all seven buckets render through the same numeric control. The
seven-key payload contract in `toPayload` is unchanged and must stay — it is what
stops the shallow merge from deleting six buckets.

#### 3. Inbox chips and shared copy

**Files**: `src/lib/anomaly/suggested-action.ts`, `src/lib/anomaly/context.ts`

**Intent**: Nothing pins these strings, so they will not fail — they will just
lie. `suggested-action.ts` is reused verbatim by the Daily Recap, so a wrong unit
here ships to email too.

**Contract**: the `Xh open` / `Xd no commits` chips (`context.ts:183-245`) and the
action sentences (`suggested-action.ts:12,18,21,27`) name working hours / working
days.

#### 4. PRD FR-009

**File**: `context/foundation/prd.md`

**Intent**: FR-009 fixes "1/2 SP=24h … 21 SP=8 working days" and never says how a
weekend is treated. Changing the unit without amending it leaves the requirement
describing a product that no longer exists.

**Contract**: FR-009's threshold list is restated in working hours with the new
values, and gains a sentence defining the clock: it advances only between 08:00
and 16:00 in the team's zone, only on the sprint's working days, and not on
team-wide days off (FR-007); individual absences (FR-010) do not pause it. A
`> Socratic (revised 2026-08-30 — context/changes/working-day-aging/):` blockquote
records why — the mixed units were never a decision, the archive holds no
argument for wall-clock aging, and the 08:00–16:00 window is a deliberate
hard-coded average rather than a config surface, because at these budget sizes an
hour either side cannot change which day an anomaly lands on. FR-013 and FR-016
need no text change: neither states a unit.

#### 5. Roadmap and the neighbouring report

**Files**: `context/foundation/roadmap.md`,
`context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`

**Intent**: S-28's entry still says the demo has a "frozen clock", which research
corrected; and the tester's recap note must not be read as half-closed by this
slice.

**Contract**: S-28's status moves to `active`, the frozen-clock line is corrected
to the anchor-at-load model, and the "left to planning" bullet is replaced by the
decisions made here. The S-11 note gains a dated paragraph stating that S-28
fixed the anomaly-engine half and that the recap's two defects — sending on
weekends, and a calendar-day "yesterday" — remain open and unclaimed.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- `grep -rn "SP21_CHOICES" src/` returns nothing

#### Manual Verification:

- `/settings/anomalies` shows "working hours" / "working days" on every time field, and the 21-SP bucket is a number input showing 64
- Saving a changed 21-SP value round-trips: reload the page and the value is still there, with no "Unsaved changes." on load
- An anomaly card in the inbox and the same anomaly in a recap preview state the same unit

**Implementation Note**: pause for these three before Phase 5.

---

## Phase 5: Demo honesty and test-backlog reconciliation

### Overview

US-02's acceptance criterion is that the demo shows at least four of the eight
anomaly types. Under working-hour math that becomes dependent on which weekday
the visitor pressed the button, and nothing tests it.

### Changes Required:

#### 1. Fixture offsets in working hours

**File**: `src/lib/demo/fixture.ts`

**Intent**: Express every anomaly-producing offset through the same primitive the
detector uses, so each crossing is exact by construction on any anchor weekday
rather than by arithmetic that happens to work on a Wednesday.

**Contract**: add a `wh(n)` helper alongside `h`/`d` — `n` working hours before
the anchor, via `workingHoursBefore` with `ZONE`, Mon–Fri, and the fixture's own
team-day-off key. The day-off key must be resolved **before** `wh` is used. The
rows below move onto `wh`, each keeping its multiple of the new budget so the
"→ fires X" comments stay true:

| Row | Today | Budget (new) | Target |
| --- | --- | --- | --- |
| `WEB-88` Code Review | `h(96)` | 8 wh | `wh(32)` — 4× |
| `WEB-90` Testing | `h(60)` | 16 wh | `wh(20)` — 1.25× |
| `WEB-91` In Progress 2 SP | `h(72)` | 8 wh | `wh(24)` — 3× |
| `WEB-93` In Progress 8 SP | `h(130)` | 40 wh | `wh(44)` — 1.1× |
| `WEB-99` In Progress 8 SP, **healthy** | `h(72)` | 40 wh | `wh(24)` — must stay under |
| PR `#142` ready | `h(31)` | 8 wh | `wh(10)` — 1.25× |
| PR `#150` ready / reviewed | `h(20)` / `h(16)` | 8 wh | `wh(6)` / `wh(4)` — reviewed, so not stalled |
| PR `#152` ready / reviewed | `h(30)` / `h(26)` | 8 wh | `wh(10)` / `wh(8)` — healthy |

`SPRINT_HOURS_LEFT` is replaced by a working-hour figure: the sprint end becomes
`shiftWorkingHours(anchor, +12, …)`, which is under the new 16-working-hour
`todo_near_end` lead time while leaving at least one whole working day — the
constraint `fixture.ts:55-63` already records and which a plain calendar offset
can no longer satisfy at both ends. The `WEB-95` / `WEB-96` To Do rows and the
`DONE` rows stay on calendar offsets: they feed the burndown axis, not a budget.

#### 2. The test the fixture has never had

**File**: `src/lib/demo/fixture.test.ts` (new)

**Intent**: Pin US-02's acceptance criterion directly, on every anchor weekday.
This is worth having independently of this slice — `fixture.ts` has no test at
all today.

**Contract**: for each of the seven weekdays, and at two times of day (one inside
the working window and one outside it), build the fixture at that anchor, feed it
through the real detector pipeline against `DEFAULT_THRESHOLDS`, and assert: at
least four **distinct** anomaly types are produced; every row whose comment says
"→ fires X" produces X; and every row commented "healthy" produces nothing. The
assertion must be on distinct types, not on a count, because US-02's wording is
about variety.

#### 3. Suites this worktree cannot run

**Files**: `src/lib/anomaly/detect.integration.test.ts`, `e2e/*.spec.ts`

**Intent**: `lessons.md` records this exact failure — a parallel worktree cannot
run the suite that guards the shape it is changing, and "verify after merge" names
no mechanism.

**Contract**: grep both trees for assertions on what changed — `PR_REVIEW_STALLED`
and the `.find(...)!` blocks at `detect.integration.test.ts:263,277-284,308-319`,
the Friday `SF-1` seed at `:127` and the Saturday PR `#42` at `:178`, plus any
`getByText` on an anomaly chip — and update them in this phase. Then run
`npm run test:integration` and `npm run test:e2e` from this worktree **only** once
the other session is confirmed idle and port 3000 is free; the constraint is two
worktrees at once, not one.

#### 4. Manual test reconciliation

**Files**: `context/foundation/manual-test-backlog.md`,
`context/changes/working-day-aging/MANUAL-CHECKLIST.md` (new)

**Intent**: Seven open backlog rows are invalidated by this slice; a row that pins
a value this plan changes is worse than no row.

**Contract**: update **10.3** (pins default values verbatim), **10.4** (shallow
merge of the SP map), **10.5** (the 21-SP sentinel round-trip — now a number
field), **10.D** (numeric domain rejection), **11.5** (a day off stops a 21-SP
ticket's clock — and explicitly records that a 3 SP ticket does *not* react,
which this slice reverses), **20.A** (`SPRINT_AT_RISK` absence arithmetic,
unchanged but adjacent) and the meta-row **10.7**. Write `MANUAL-CHECKLIST.md`
with 3–5 rows only: the Friday→Monday crossing on a real account, the
pre-existing-override survival check from Phase 2, the 21-SP field round-trip,
and a demo load on a Monday showing four anomaly types. Each row carries where,
what to do, what must be true, and why it matters. Then run
`node scripts/manual-test-sweep.mjs` and act on a non-zero exit.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Fixture test passes on all seven anchor weekdays: `npm test -- fixture`
- Integration suite passes: `npm run test:integration` (other session idle)
- E2E suite passes: `npm run test:e2e` (other session idle, port 3000 free)
- Manual-test sweep exits zero: `node scripts/manual-test-sweep.mjs`

#### Manual Verification:

- Load the demo on a Monday morning and confirm the Anomaly Inbox shows at least four distinct anomaly types
- Reset and re-load the demo; the same holds

**Implementation Note**: this is the closing phase — run the sweep before the
epilogue commit, per CLAUDE.md.

---

## Testing Strategy

### Unit Tests:

- The primitive: zone handling (null, unrecognised, non-whole-hour offsets), both
  DST transitions, weekend and holiday exclusion, non-Mon–Fri working weeks, and
  a round-trip property for the signed shift.
- Every rule: a Friday-afternoon start with a Sunday `now` producing nothing, and
  the same start with a Monday `now` producing the anomaly. This single pair is
  the slice's whole claim, and it belongs in all five rule test files.
- Compatibility: a stored `"8_WORKING_DAYS"` resolving to 64 working hours
  without resetting the rule.

### Integration Tests:

- `detect.integration.test.ts`'s Friday/Saturday seeds re-derived, including the
  reactivation path — the one place the whole pipeline runs against real
  Postgres.

### Manual Testing Steps:

1. On a real account, move a ticket to Code Review on a Friday afternoon; confirm
   it is absent from the inbox all weekend and present on Monday.
2. Mark that Monday as a company day off in `/settings/absences`; confirm the
   ticket appears on Tuesday instead.
3. Record an individual absence for the assignee instead; confirm the ticket
   still ages normally, while `DEVELOPER_INACTIVE` stays suppressed for that
   person.
4. On an account that customised a threshold before this slice, open
   `/settings/anomalies` and confirm its own value is still shown with no
   unprompted "Unsaved changes.".
5. Load the demo on a Monday and count the distinct anomaly types.

## Performance Considerations

`workingHoursBetween` is called once per ticket, PR and roster member per
detection cycle — the same order as today's `hoursBetween`, but each call now
enumerates day keys and resolves two zone boundaries per day. `day-bucket.ts`
already caches `Intl.DateTimeFormat` per resolved zone for exactly this reason
(`:27-32`, `time-zone.ts:24-31`), and `enumerateDayKeys` caps at 400 days.
Budgets are days, not months, so the per-call day count is single-digit. No
further measure is needed; if a hot spot appears it will be in
`localHourInstant`'s binary search, which is the same ~112-probe cost
`dayRangeInTimeZone` already pays and is the candidate for a
per-(dayKey, zone, hour) memo.

## Migration Notes

**No migration.** `anomaly_settings.thresholds` is `jsonb` with no shape
constraint (`schema.ts:933`) and rows exist only for rules a user has customised
(`anomaly-settings.ts:98-123`). The compatibility surface is therefore entirely
application code, and it is Phase 2's validator change: the `"8_WORKING_DAYS"`
literal stays accepted and is normalised to 64 on read. Removing it would fail
`mergeRule`'s `.strict()` validation on every read and silently discard that
account's whole `TICKET_STATUS_AGING` rule, severity included, with only a
`console.error`.

Because there is no `src/db/migrations/*.sql` file in this slice, the "code ships
without its migration" hazard in `lessons.md` does not apply.

## References

- Related research: `context/changes/working-day-aging/research.md`
- Change identity: `context/changes/working-day-aging/change.md`
- Frame that produced the slice: `context/changes/team-navigation-section/frame.md`
- Roadmap entry: `context/foundation/roadmap.md` (S-28)
- The principle, already stated in code: `src/lib/anomaly/rules/ticket-status-aging.ts:62-66`
- The zone-arithmetic trap this must not repeat: `src/lib/dashboard/day-bucket.ts:74-84`
- The read-time validation trap: `src/lib/anomaly/thresholds.ts:57-87`
- The parked sentinel decision this dissolves: `context/archive/2026-08-29-anomaly-settings-page/plan.md:105-108`
- Neighbouring open report, deliberately out of scope: `context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The working-time primitive

#### Automated

- [x] 1.1 Type checking passes — 1bbea5b
- [x] 1.2 Linting passes — 1bbea5b
- [x] 1.3 Unit tests pass — 1bbea5b
- [x] 1.4 New primitive's mutation score clears the gate — 1bbea5b
- [x] 1.5 No behaviour change: every pre-existing anomaly test still passes untouched — 1bbea5b

### Phase 2: The hour-denominated rules and their recalibrated defaults

#### Automated

- [x] 2.1 Type checking passes — 4992bfe
- [x] 2.2 Linting passes — 4992bfe
- [x] 2.3 Unit tests pass — 4992bfe
- [x] 2.4 Mutation gate holds on the rule files — 4992bfe
- [x] 2.5 `grep -rn "8_WORKING_DAYS" src/` returns only the validator's compatibility path — 4992bfe

#### Manual

- [ ] 2.6 A pre-existing customised `TICKET_STATUS_AGING` still shows its own numbers, no unprompted "Unsaved changes."
- [ ] 2.7 Anomaly Inbox renders with the new defaults and no unjustifiable age

### Phase 3: The two window-based rules

#### Automated

- [x] 3.1 Type checking passes
- [x] 3.2 Linting passes
- [x] 3.3 Unit tests pass
- [x] 3.4 Mutation gate holds
- [x] 3.5 `grep -rn "MS_PER_DAY" src/lib/anomaly/rules/` shows no window arithmetic in these two files

#### Manual

- [ ] 3.6 FR-010 absence suppression of `DEVELOPER_INACTIVE` survived the window change

### Phase 4: Settings surface, copy, and the PRD

#### Automated

- [ ] 4.1 Type checking passes
- [ ] 4.2 Linting passes
- [ ] 4.3 Unit tests pass
- [ ] 4.4 `grep -rn "SP21_CHOICES" src/` returns nothing

#### Manual

- [ ] 4.5 `/settings/anomalies` shows working-hour / working-day units and a numeric 21-SP field showing 64
- [ ] 4.6 A changed 21-SP value round-trips with no "Unsaved changes." on reload
- [ ] 4.7 Inbox card and recap preview state the same unit

### Phase 5: Demo honesty and test-backlog reconciliation

#### Automated

- [ ] 5.1 Type checking passes
- [ ] 5.2 Linting passes
- [ ] 5.3 Unit tests pass
- [ ] 5.4 Fixture test passes on all seven anchor weekdays
- [ ] 5.5 Integration suite passes (other session idle)
- [ ] 5.6 E2E suite passes (other session idle, port 3000 free)
- [ ] 5.7 Manual-test sweep exits zero

#### Manual

- [ ] 5.8 Demo loaded on a Monday shows at least four distinct anomaly types
- [ ] 5.9 Reset and re-load the demo; the same holds
