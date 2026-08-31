# Next-window capacity as a number on the availability tab — Implementation Plan

## Overview

The Availability tab on Dashboard "Today" draws two member × day grids and puts a
capacity figure in man-days under the first only. This plan puts a number under
the second — and, because two of that number's three inputs degrade silently past
the active sprint's end and both degrade in the same direction, it also closes
the degradation and states on screen what the figure is allowed to assert.

Three things ship together, in this order, and the order is load-bearing:

1. The next window stops being an extrapolation of *this* sprint's accidental
   span and becomes the lead's own durable cadence.
2. The holiday-approval horizon reaches that window, so a January the sprint does
   not touch stops counting as ordinary working days.
3. The number appears, marked `Projected`, with a sentence naming both ways it
   can be too high — and a stronger one for a lead who has never recorded an
   absence past the running sprint.

## Current State Analysis

Lifted from `frame.md`'s Hypothesis Investigation, which settled the framing; not
re-investigated here.

**The arithmetic already exists and is already reachable.** `getSprintCapacityFor`
(`src/lib/dashboard/capacity.ts:248`) loads, in ONE fan-out on ONE handle, every
input the second window needs: the roster with `fte`, the absences (already read
to a `lookahead` past sprint end, `capacity.ts:257-258`), the Jira time zone, the
team-wide day-off set, and the resolved cadence. `computeSprintCapacity`
(`capacity.ts:123`) is pure and takes its window as two parameters. A second call
on the next window's dates costs zero queries.

**The window is drawn client-side from the sprint's own instants.**
`nextWindowAfter` (`src/components/organisms/dashboard/availability-view.ts:53`)
takes `from` = the day key after the sprint's last drawn day, and
`to` = `from + (sprintEnd − sprintStart)` in milliseconds. It deliberately ignores
`sprint.length_days`, and the comment saying why (`availability-view.ts:38-42`)
is now false: it calls the cadence columns "written by the Jira importer and read
by nothing", which S-29 / S-30 / S-32 made untrue. Since S-30 the lead's chosen
length is durable, project-scoped, and resolved by `resolveCadenceFor`
(`src/lib/cadence-override.ts:196`) through a tier chain whose bottom tier
(`pickCadence` tier 3, `cadence-override.ts:149`) falls back to the stored
`sprint.length_days` column — the reconciler's derived cache of what Jira's dates
say (`reconcile-sprint.ts:365`), i.e. the same extrapolation, computed once at
sync time instead of on every render.

**The holiday-approval horizon stops at the active sprint's end.** `holidayYears`
(`src/lib/holidays/proposal.ts:58`) returns today's year ∪ every year the ACTIVE
sprint touches. A sprint ending 2026-12-20 whose next window runs into January
never proposes 2027, so 1 and 6 January carry no `team_day_off` row and are
counted as ordinary working days — in the next window's capacity, and nowhere
else, because nothing else looks past sprint end.

**Three surfaces call `holidayYears`, and one of them validates.**
`src/app/(app)/dashboard/page.tsx:149` renders the notice;
`src/app/(app)/team/days-off/page.tsx:61` builds the proposal; and
`src/app/(app)/team/actions.ts:307` — `approveHolidayYearAction` — RE-DERIVES the
window server-side and refuses any submitted year outside it
("That list is out of date"). Widening the horizon on the pages without widening
it in the action produces a notice that names 2027 and a button that rejects it.

**Absence coverage in the forecast window is partial by the owner's own report**
(frame, Narrowing Signals): long holidays go in early, shorter ones and sickness
do not. `absence` is free-dated (`src/db/schema.ts:741-778`) so nothing prevents
forward entry — it simply is not done consistently. Every missing absence moves
`adjustedMd` up. Combined with the unapproved-holiday gap, both identified errors
inflate and there is no offsetting term.

### Key Discoveries:

- `pickCadence` tier 3 reads the stored `sprint.length_days` column
  (`cadence-override.ts:149`, fed by `resolveCadenceFor:210`) — the reconciler's
  derived cache of Jira's own dates (`reconcile-sprint.ts:365`, from
  `deriveCadence`) — falling back to `DEFAULT_CADENCE.lengthDays = 14` when it is
  NULL. So the resolved cadence is a **strict superset of today's LENGTH SOURCE**:
  Jira's own number for an account that has never opened `/team/cadence`, the
  lead's for one that has. It is NOT a superset of today's DRAWN DAYS — see
  Critical Implementation Details: every account's "Next window" grid loses one
  column, because the ms-span rule drew `lengthDays + 1`.
- `resolveCadenceFor` needs a database handle, so moving the window onto the
  cadence moves its computation from the client to the server. `capacity.ts`
  already resolves it (`capacity.ts:294`) and simply does not return it.
- The absence query's upper bound is the OLD window's far edge
  (`capacity.ts:258`). Once length comes from the cadence, that bound can fall
  short of the window actually drawn — absences past it silently vanish and
  `adjustedMd` rises. `lessons.md`'s narrowing-predicate rule, one window right.
  The bound must therefore be one no resolved window can exceed, and it must not
  cost a second round trip — see Phase 1 §2.
- `getSprintCapacityFor` is typed `sprint: SelectSprint` (`capacity.ts:251`),
  which no unstarted window can supply; it reads five fields.
- `sweep.ts:162` is the other caller of `getSprintCapacityFor`, for CLOSED
  sprints. It must keep working and must ignore the new field.
- The convention for a figure weaker than a measurement is established and
  enforced four times over: `Overridden` (FR-022), `Corrected` (FR-023), FR-024's
  withholding below two closed sprints, and S-17's calendar notice. A label, never
  silent equalisation.
- There is no component-test harness (CLAUDE.md), so every sentence the panel
  renders must be decided in a `.ts` sibling — the `calendar-notice.ts` /
  `capacity-adjustments-view.ts` pattern.
- `e2e/cadence-restore.spec.ts` is the only E2E spec touching this copy; check it
  before closing Phase 1 (`lessons.md`: a worktree cannot run the suite that
  guards the shape it changes).

## Desired End State

The Availability tab shows, above the "Next window" grid, a capacity figure in
man-days for that window — the window being the lead's cadence length starting the
day after this sprint ends — carrying a `Projected` badge while the window is
still in the future, the working-day count
it was computed from, the team days off already subtracted, and a sentence naming
that unrecorded absences and unreviewed public holidays both push the figure up.
When the account holds no absence at all ending past the running sprint — the
lead has never recorded one forward — a second, stronger line says the figure is a
ceiling rather than a plan, and links to `/team/absences`.

The holiday proposal, the calendar notice and the approval action all reason about
the same horizon, which now reaches the end of the forecast window; approving a
year that only the forecast window touches succeeds.

Verify by: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:integration`, plus the manual rows in `## Progress`.

## What We're NOT Doing

- **No story-point estimate for the next window.** FR-024's estimate stops at the
  ACTIVE sprint by design (`src/lib/measurement/estimate.ts:10-14`); the frame
  records the MD number, not the SP answer, as the felt gap. Projecting an
  unstarted window's velocity stays roadmap S-18's successor, not this slice.
- **No Jira `state=future` fetch.** `getActiveSprint` hard-codes `state=active`
  (`src/lib/jira.ts:560`) and is the only sprint entry point; S-16 shipped without
  making a future sprint a row, and the owner reports future sprints commonly
  carry no dates. Building the path would add an integration that returns null in
  the common case.
- **No capacity override and no delivered-SP line for the next window.** Both are
  keyed by `sprint_measurement.jira_sprint_id`; the forecast window has no Jira
  sprint id, and inventing one would put a hand-entered figure into FR-024's
  normalisation under a key nothing can reconcile.
- **The CURRENT sprint's window is not touched.** Its bounds are the real Jira
  instants and its capacity is an FR-022 measurement; changing it would rewrite a
  number the lead has been planning against.
- **No new database columns, no migration.** Every input already exists.
- **No change to how absences are entered.** Making forward entry easier is a
  separate slice; this one makes the consequence of not doing it visible.

## Implementation Approach

The next window becomes a resolved server-side fact rather than a client-side
guess, because its length now comes from a record only the server can read. That
one move carries three others with it: the absence query's bound follows the real
window, the holiday horizon can be derived from the same helper on all three
surfaces, and the stale rationale comment goes away with the function it justified.

The number is then a second call to a reducer that already exists, and the whole
remaining risk is in what the panel claims. That claim is decided in a pure `.ts`
module, as every other sentence on this card is.

## Critical Implementation Details

**The next window is `lengthDays` calendar days, and this is one FEWER drawn day
than the current grid shows — for every account, not only for one that set a
cadence.** The cadence editor's field is labelled
"Sprint length (days)" (`src/components/organisms/setup/cadence-fields.tsx:75`),
so `lengthDays = 14` means fourteen calendar days: `to` is `from` plus
`lengthDays − 1` day keys. A real Jira sprint ends at the same time of day it
starts — `2026-08-31T08:00:00.000Z` — so `enumerateDayKeys(start, end)` draws both
boundary days and the current grid shows `lengthDays + 1` columns. The forecast
window deliberately does NOT reproduce that extra day: it is the difference
between a 14-day window and a 15-day one, and the extra day would inflate the
figure by one working day per FTE, in the same direction as every other error this
slice exists to close. The visible consequence — "This sprint … over 11 working
days" beside "Next window … over 10 working days" for two nominally identical
sprints — is accepted and named here so it is not rediscovered as a bug. A
sprint whose `length_days` is NULL is the one case where the window stops
tracking Jira's dates: it falls to `DEFAULT_CADENCE.lengthDays = 14` regardless of
the sprint's real span. Accepted — `reconcile-sprint.ts` writes the column on
every sync and the demo fixture sets it — but named rather than discovered.

**The three holiday surfaces must derive the horizon from one spelling.**
`approveHolidayYearAction` refuses years outside its own re-derivation
(`team/actions.ts:305-317`), so a page that offers 2027 while the action computes
a horizon ending in 2026 produces a dead end on screen. This is the same class as
`DEFAULT_CADENCE`'s "must be the only spelling" rule
(`src/lib/integrations/cadence.ts:37-44`): one pure function, three callers, no
restatement.

**`sweep.ts` shares the reader.** `getSprintCapacityFor` gains a field and a wider
absence bound; the sweep (`src/lib/measurement/sweep.ts:162`) must keep producing
identical `capacity` numbers for closed sprints. The next window it computes for a
long-closed sprint is meaningless and simply unread — that is acceptable because
it costs no query, but the sweep must not start persisting it.

---

## Phase 1: The next window becomes a resolved, server-side fact

### Overview

Move the window's derivation off the sprint's accidental span and onto the lead's
durable cadence, which moves it from the client to the server. Nothing the lead
sees changes for an account that has never set a cadence. Two cleanups the frame
named fall out here.

### Changes Required:

#### 1. The window helper, as a lib module

**File**: `src/lib/dashboard/next-window.ts` (new)

**Intent**: Hold the one definition of "the window after this sprint" so the
capacity reader, the holiday horizon and the grid all mean the same dates. Pure —
no database, no clock — like every other module under `lib/dashboard/`.

**Contract**: `nextWindowAfter({ sprintEnd, lengthDays, timeZone }): { from: Date; to: Date }`.
`from` is the start of the day key following `sprintEnd`'s day key in `timeZone`
(the existing S-08 rule, which is what keeps the two grids from sharing a day —
impl-review F1 on the original). `to` is the END of the day key `lengthDays − 1`
days after `from`'s, resolved through `dayRangeInTimeZone` so no zone offset can
shift it. Day-key arithmetic, not millisecond arithmetic: a DST transition inside
the window must not move the boundary.

#### 2. The reader resolves and returns the window

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: `getSprintCapacityFor` already resolves the cadence and throws it
away after reading `workingDays`; have it also build the next window from
`cadence.lengthDays` and return both the window and the cadence, so callers stop
re-deriving either.

**Contract**: `CapacityReadResult` gains `nextWindow: { from: Date; to: Date }`
and `cadence: ResolvedCadence`. `nextWindow` is built from `cadence.lengthDays`
AFTER the fan-out resolves, and the absence query's upper bound stops being the
millisecond `lookahead` (`capacity.ts:258`).

**The fan-out stays ONE round (plan-review F4).** The obvious shape — resolve the
cadence, then bound the absence read on the window it yields — makes the cadence
read sequential, and `getSprintCapacityFor` is called once per recomputable sprint
inside the sweep's loop (`sweep.ts:162`), so a cron cycle over N sprints would go
from N round trips to 2N. `lessons.md` #3's surviving rule is one handle, one
fan-out. Instead the absence bound is `sprintEnd + MAX_CADENCE_LENGTH_DAYS`, where
the constant is the cadence editor's own ceiling (`z…max(90)`,
`src/lib/validations/roster.ts:144`) — a bound no resolved window can exceed, so
nothing the window draws can fall outside the loaded set. `computeSprintCapacity`
already clips each absence to the window it is given, and `buildAvailabilityGrid`
already filters to its own axis (`availability-view.ts`, `overlaps`), so the extra
rows are inert. It reads at most a quarter's absences per owner on the
`(team_member_id, start_date, end_date)` index the query already uses.

The constant is exported from the validation module rather than restated here —
same "only spelling" rule as `DEFAULT_CADENCE` (`integrations/cadence.ts:37-44`):
if the editor's ceiling ever rises and this bound does not, absences past it
vanish and `adjustedMd` silently rises, which is `lessons.md`'s narrowing-
predicate rule one window right.

#### 3. `getSprintCapacityFor` stops demanding a whole sprint row

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: The function reads five fields and is typed for the whole row, which
the frame names as a cleanup and which no unstarted window could ever supply.

**Contract**: `sprint: Pick<SelectSprint, "jiraProjectId" | "jiraSprintId" | "startDate" | "endDate" | "lengthDays" | "startDay">`.
A superset of `resolveCadenceFor`'s own `Pick` (`cadence-override.ts:204-207`,
which has no `endDate`), so it is assignable there unchanged; both existing
callers pass full rows and are unaffected.

#### 4. The client stops computing the window

**Files**: `src/components/organisms/dashboard/availability-view.ts`,
`src/components/organisms/dashboard/availability.tsx`,
`src/app/(app)/dashboard/page.tsx`

**Intent**: Delete `nextWindowAfter` and the stale rationale comment
(`availability-view.ts:37-64`) — the comment's claim that the cadence columns are
"read by nothing" is false as of S-30, and the function it justified is now
server-side. The tab receives the window's bounds as ISO strings, like every other
date crossing this boundary.

**Contract**: `Availability` gains `nextWindowStart: string | null` and
`nextWindowEnd: string | null`; the `useMemo` builds the second grid from them
instead of calling `nextWindowAfter`. `buildAvailabilityGrid` is untouched. The
page passes `availability?.nextWindow.from.toISOString() ?? null` and its `to`
sibling.

#### 5. Tests follow the function

**Files**: `src/lib/dashboard/next-window.test.ts` (new),
`src/components/organisms/dashboard/availability-view.test.ts`

**Intent**: Move the four `nextWindowAfter` cases out of the view test and re-base
them on `lengthDays`; keep the ones that assert on DRAWN DAYS rather than on the
arithmetic, which is what made the original suite able to fail at all.

**Contract**: Retained cases — no shared day when the sprint ends mid-day; no
shared day when it ends at the last instant; the boundary resolves in the team's
zone, not UTC. Replaced case — "keeps the next window the same length as the
sprint" becomes "draws exactly `lengthDays` days", with a case proving a lead's
21 on a 14-day sprint yields 21 drawn days and a case proving tier-3 fallback
reproduces the pre-change day count for a sprint ending at the last instant of a
day. New case — a window spanning a DST transition keeps its day count.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- `src/components/organisms/dashboard/availability-view.ts` no longer exports
  `nextWindowAfter`, and no `.tsx` imports it: `grep -rn "nextWindowAfter" src`
  returns only `lib/dashboard/next-window*`, `lib/dashboard/capacity.ts` and
  `lib/holidays/`
- `e2e/cadence-restore.spec.ts` still passes: `npm run test:e2e -- cadence-restore`

#### Manual Verification:

- On an account that has never opened `/team/cadence`, the "Next window" grid
  draws exactly `lengthDays` days — one fewer than before, per Critical
  Implementation Details — and still shares no day with the sprint grid

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to the next phase.

---

## Phase 2: The holiday-approval horizon reaches the forecast window

### Overview

Close D2 — a defect that exists today and becomes load-bearing the moment a number
is displayed. One pure derivation, three callers, so the surface that offers a
year and the action that accepts it can never disagree.

### Changes Required:

#### 1. The horizon, derived once

**File**: `src/lib/holidays/proposal.ts`

**Intent**: `holidayYears` currently answers "which years does the ACTIVE sprint
touch, plus today's". It must also cover the window the forecast is computed over,
because that window's capacity consumes the same day-off calendar and nothing else
looks past sprint end.

**Contract**: `holidayYears` gains `nextWindowEnd: Date | null`, folded into the
same union and read in the team's zone like the other dates. Add a sibling
`holidayReviewWindow({ sprint, cadence, now, timeZone }): number[]` in the same
module — pure — that composes `nextWindowAfter` with `holidayYears` so the three
callers share one spelling rather than three restatements. Both the existing
guarantees survive: `now` stays unconditional (impl-review F1 on S-17), and a
sprint without dates contributes nothing.

#### 2. The three callers

**Files**: `src/app/(app)/dashboard/page.tsx`,
`src/app/(app)/team/days-off/page.tsx`, `src/app/(app)/team/actions.ts`

**Intent**: Route all three through `holidayReviewWindow`. The dashboard takes the
cadence from `CapacityReadResult` (Phase 1 returns it — no new read); the days-off
page already resolves it (`days-off/page.tsx:55`); `approveHolidayYearAction`
gains a `resolveCadenceFor` call beside the reads it already does.

**Contract**: All three produce an identical `number[]` for the same account and
the same `now`. `approveHolidayYearAction`'s refusal message and its server-side
re-derivation are otherwise unchanged — it must still reject a year outside the
window, which is what stops a crafted payload from closing an unreviewed year
forever.

#### 3. Tests

**Files**: `src/lib/holidays/proposal.test.ts`,
`src/app/(app)/team/holiday-actions.integration.test.ts`

**Intent**: Pin the horizon's new reach, and pin the agreement between the surface
and the validator — the half that a unit test cannot see.

**Contract**: Unit — a December sprint whose forecast window runs into January
yields both years; a mid-year sprint yields one year (the horizon must not grow
without cause); a sprint without dates still yields today's year alone; a lead's
longer cadence extends the horizon where the old ms-span would not have.
Integration — `approveHolidayYearAction` ACCEPTS a year reachable only through the
forecast window, and still refuses one beyond it.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Every `holidayYears` caller goes through the shared derivation:
  `grep -rn "holidayYears(" src/app` returns nothing

#### Manual Verification:

- With the system date near the end of December on a sprint whose next window
  crosses into January, `/team/days-off` proposes the NEXT year's holidays and the
  Approve button accepts them without "That list is out of date"

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: The number, and what it is allowed to assert

### Overview

Compute the forecast window's capacity from the reducer that already exists, and
put it on screen with its provenance attached. The number and its label ship in
the same phase deliberately: a phase that rendered `X MD` unlabelled would be a
phase shipping precisely what this slice exists to prevent.

### Changes Required:

#### 1. The second computation

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: Call `computeSprintCapacity` a second time on the window Phase 1
resolved, with the same roster, absences, cadence, zone and day-off set. No new
query; the reducer is unchanged.

**Contract**: `CapacityReadResult` gains `nextWindowCapacity: SprintCapacity` and,
beside it, `hasForwardAbsence: boolean` — does this account hold ANY absence, on
any date, ending after the current sprint's end?

**Not "how many absences fall inside the forecast window" (plan-review F2).** Zero
absences in a fortnight is the ordinary state of a 3–10-person team, so a notice
keyed on it would be on almost always and would stop being read — and it could
not tell "checked, nobody is away" from "nothing entered", because both render as
zero. The distinction S-17 actually drew is account-level and UNBOUNDED BY DATE
(`calendarIsEmpty`, from a set `team-day-off-store.ts:104-110` loads whole), which
is what makes an empty one mean "this lead has never done the work". The same
shape here is "has this lead ever recorded an absence forward of the running
sprint" — a fact about the lead's habit, not about the fortnight.

Costs ONE extra indexed existence read — `select 1 from absence where owner_id = $1
and end_date > $sprintEnd limit 1` — joined to the SAME fan-out, since it depends
only on `sprintEnd`. `sweep.ts` ignores both new fields and persists nothing from
them.

#### 2. What the panel is allowed to say

**File**: `src/components/organisms/dashboard/next-window-capacity-view.ts` (new)

**Intent**: Decide the badge and the sentences here, not in the `.tsx`, because
this project has no component-test harness — the same split, and the same reason,
as `calendar-notice.ts` and `capacity-adjustments-view.ts`.

**Contract**: `toNextWindowCapacityView({ capacity, hasForwardAbsence, windowStart, now, timeZone }): { md, beforeAbsencesMd, workingDays, teamDaysOff, isProjected: boolean, caveat: string, noForwardAbsencesNotice: string | null }`.

**`isProjected` is a decision, not a constant (plan-review F3).** The window is
`sprintEnd + 1 day` unconditionally, and the sprint on screen is not always one
that is running: `getActiveSprintRow` (`src/lib/sprint.ts:36-42`) falls back to
the most-recently-STARTED sprint when none is ACTIVE, and the dashboard's own
comment records that Jira can leave a sprint ACTIVE past its end date. Between
sprints, or after a stalled sync or a disconnect, the "next window" is a
fortnight that has already happened. Today that costs nothing — the grid only
says who WAS away — but a figure badged `Projected` would assert the opposite of
what is true, on the one surface this slice exists to make honest. This is the
stale-sprint case impl-review F1 on S-17 already forced `holidayYears` to handle;
the module takes `now` as a PARAMETER, like every other module here that reasons
about time. When `windowStart`'s day key is not after `now`'s in `timeZone`,
`isProjected` is false and the caveat is replaced by one saying this window has
already begun or ended, so the figure describes time that is spent rather than
time the lead can promise. The `.tsx` renders no badge in that state.
The caveat is unconditional and names BOTH inflating terms in one sentence: the
window is projected from the team's cadence rather than from a sprint Jira has
created, and absences beyond the current sprint may not all be recorded yet — so
this figure is more likely too high than too low. `noForwardAbsencesNotice` is
non-null only when `hasForwardAbsence` is false, and says that this account holds
no absence at all past the running sprint — so the figure has nothing to subtract
and is a ceiling rather than a plan. It fires on the lead's HABIT, not on the
fortnight (plan-review F2): a lead who records holidays ahead never sees it, and
one who has never recorded any sees it until they do. No withholding branch: the
figure always renders,
because a panel that stayed silent whenever absence entry was incomplete would be
silent almost always, and the slice would not deliver what it exists for.

#### 3. The panel

**File**: `src/components/organisms/dashboard/availability.tsx`,
`src/app/(app)/dashboard/page.tsx`

**Intent**: Render a `NextWindowCapacity` block immediately above the existing
"Next window" grid, mirroring `CapacitySummary`'s shape so the two windows read as
the same kind of thing, differing exactly where their provenance differs.

**Contract**: The block shows `{md} MD`, a `Badge variant="outline"` reading
`Projected` when `isProjected` (and no badge otherwise),
`of {beforeAbsencesMd} MD, after absences`, the working-day line,
the `− N team days off` line on the same condition as the sprint block, then the
caveat, then the no-forward-absences notice with a link to `/team/absences` when
present. No override badge, no delivered-SP line, no adjustment form — none of
those exist for a window without a Jira sprint id. `Availability` gains
`nextWindowCapacity: SprintCapacity | null`, `hasForwardAbsence: boolean`,
`nextWindowStart: string | null` (already added in Phase 1) and `now: string`; the
page forwards `availability?.nextWindowCapacity ?? null`,
`availability?.hasForwardAbsence ?? false` and its own `now` as an ISO string —
the clock crosses the boundary as a value, never as a `new Date()` inside the
client component, the same rule `calendar-notice.ts`'s callers already follow.

#### 4. Tests

**Files**: `src/lib/dashboard/next-window-capacity-view.test.ts` (new),
`src/lib/dashboard/capacity.integration.test.ts`

**Intent**: Cover the copy decisions and the reader's new field; the reducer's own
arithmetic is already covered by `capacity.test.ts` and is not re-tested.

**Contract**: Unit — a caveat is present in every case; `isProjected` is true for
a window starting after `now`, false for one starting on today's day key and for
one wholly past, and the caveat text differs between the two states;
`noForwardAbsencesNotice` is non-null when `hasForwardAbsence` is false and null
when it is true; the headline reports the adjusted figure with the nominal beside
it; `teamDaysOff` of zero yields no line. Integration — the reader returns a
next-window capacity for a real owner; an absence falling ONLY in the forecast
window reduces `nextWindowCapacity.adjustedMd` and leaves `capacity.adjustedMd`
untouched (this is the case the old `lookahead` bound could drop); a team-wide day
off inside the forecast window reduces its working-day count; `hasForwardAbsence`
is false for an owner whose only absence ends inside the running sprint and true
for one with an absence ending after it — INCLUDING one that starts beyond the
forecast window, which is what makes the fact account-level rather than windowed;
cross-account isolation holds.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- No sentence is assembled inside the `.tsx`: every string the block renders comes
  from `next-window-capacity-view.ts` or is a static label

#### Manual Verification:

- On the seeded local account, the Availability tab shows a man-day figure above
  the "Next window" grid carrying a `Projected` badge and the caveat sentence —
  and, on an account whose displayed sprint has already ended, the same figure
  with no badge and the "already begun or ended" line instead
- Recording an absence that falls only in the next window lowers the next-window
  figure and leaves this sprint's figure unchanged
- On an account holding no absence ending past the running sprint, the stronger
  notice appears and its link reaches `/team/absences`; recording one forward
  absence clears it

**Implementation Note**: This is the last phase; run the manual rows before the
epilogue commit, and run `node scripts/manual-test-sweep.mjs` so the backlog
carries every open row from this plan.

---

## Testing Strategy

### Unit Tests:

- `next-window.test.ts` — window bounds under a lead-set length, under tier-3
  fallback, across a zone boundary, across a DST transition, and the
  no-shared-day-with-the-sprint invariant asserted on DRAWN DAYS.
- `proposal.test.ts` — the horizon's reach with and without a forecast window,
  with and without sprint dates, and under a longer lead cadence.
- `next-window-capacity-view.test.ts` — a caveat is always present and its text
  follows `isProjected`, which is false once `now` has reached the window's first
  day; the no-forward-absences notice switches on `hasForwardAbsence` alone.
- `availability-view.test.ts` — `buildAvailabilityGrid` coverage retained
  unchanged; the `nextWindowAfter` block is gone.

### Integration Tests:

- `capacity.integration.test.ts` — next-window capacity for a real owner; an
  absence only in the forecast window reduces only the forecast figure; a
  team-wide day off in the forecast window reduces its working days;
  `hasForwardAbsence` is account-level, not windowed; isolation.
- `holiday-actions.integration.test.ts` — a year reachable only through the
  forecast window is accepted by `approveHolidayYearAction`; a year beyond the
  horizon is still refused.

### Manual Testing Steps:

The blocking rows go in `context/changes/next-sprint-capacity/MANUAL-CHECKLIST.md`
(3–5 rows, per CLAUDE.md); everything else is appended to
`context/foundation/manual-test-backlog.md` in Polish. The three that block:

1. `/dashboard` → Availability tab: the "Next window" section shows a man-day
   figure with a `Projected` badge, a working-day count, and the caveat sentence.
   Catches the whole slice being invisible behind a null guard.
2. `/team/absences`: add an absence that falls entirely inside the next window,
   return to Availability — the next-window figure drops, this sprint's does not.
   Catches the widened absence bound silently failing (the figure would not move).
3. `/team/days-off` in the last two weeks of December: the proposal offers the
   NEXT year and Approve succeeds. Catches the horizon and the validator
   disagreeing — the dead end this plan's Phase 2 exists to prevent.

## Performance Considerations

One extra query and no extra round trip. The absence read's upper bound widens
from the sprint's own span to `sprintEnd + 90 days` — the cadence editor's ceiling,
so the loaded set covers any window the resolver can produce — which is at most a
quarter's absences per owner on the index the query already uses
(`(team_member_id, start_date, end_date)`), and the rows outside the drawn window
are clipped by the reducer and filtered by the grid. The `hasForwardAbsence`
existence check (Phase 3) is a `limit(1)` on the same index and joins the SAME
fan-out, because it depends only on `sprintEnd`; the fan-out therefore stays one
round, which matters most in the sweep, where the reader runs once per
recomputable sprint (`sweep.ts:162`). The second `computeSprintCapacity` call is
pure arithmetic over data already in memory. `approveHolidayYearAction` gains one
indexed read (`resolveCadenceFor`), on a path that runs once per approval.

## Migration Notes

None — no schema change, no migration, so `lessons.md`'s deploy-without-migration
rule does not apply to this slice. The behaviour change that is NOT covered by a
migration is the window's length, and it reaches EVERY account, not only one that
set a cadence: a sprint that ends at the same time of day it starts drew
`lengthDays + 1` columns under the ms-span rule and draws `lengthDays` after this
phase, so the "Next window" grid loses one day on first render after deploy. An
account that has set a cadence sees its own number on top of that. Both are the
intended outcome, and no data is rewritten.

## References

- Frame brief: `context/changes/next-sprint-capacity/frame.md`
- Roadmap entry: `context/foundation/roadmap.md` (S-18)
- Prior decisions: `context/archive/2026-08-25-absence-calendar/plan.md:650-655`
  (the original "deliberately not from the cadence columns" rationale, now stale);
  `context/archive/2026-08-27-capacity-in-man-days/plan.md:1046-1049` (S-18 parked
  pending S-23, since shipped)
- Similar implementation: `src/lib/holidays/calendar-notice.ts` (pure copy module
  for a component with no test harness); `src/lib/integrations/cadence.ts:37-44`
  (the "only spelling" rule this plan applies to the holiday horizon)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The next window becomes a resolved, server-side fact

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — b547b03
- [x] 1.2 Type checking passes: `npm run typecheck` — b547b03
- [x] 1.3 Unit tests pass: `npm test` — b547b03
- [x] 1.4 Integration tests pass: `npm run test:integration` — b547b03
- [x] 1.5 `nextWindowAfter` is gone from the client surface (grep) — b547b03
- [x] 1.6 `e2e/cadence-restore.spec.ts` still passes — b547b03

#### Manual

- [ ] 1.7 The "Next window" grid draws exactly the resolved `lengthDays` days —
      one FEWER than before for a sprint ending at the same time of day it starts
      — and still shares no day with the sprint grid

### Phase 2: The holiday-approval horizon reaches the forecast window

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Unit tests pass: `npm test`
- [x] 2.4 Integration tests pass: `npm run test:integration`
- [x] 2.5 No caller restates the horizon: `grep -rn "holidayYears(" src/app` is empty

#### Manual

- [ ] 2.6 A December sprint's next-year holidays are proposed AND approvable

### Phase 3: The number, and what it is allowed to assert

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Unit tests pass: `npm test`
- [ ] 3.4 Integration tests pass: `npm run test:integration`
- [ ] 3.5 Every rendered sentence originates in `next-window-capacity-view.ts`

#### Manual

- [ ] 3.6 The next-window figure renders with the `Projected` badge and the caveat
      on a running sprint, and WITHOUT the badge on a sprint whose end date has
      passed
- [ ] 3.7 An absence only in the next window moves only the next-window figure
- [ ] 3.8 On an account holding no absence past the running sprint, the stronger
      notice and its `/team/absences` link appear; recording one forward absence
      clears it
