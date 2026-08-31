# Working-days calendar (S-17) Implementation Plan

## Overview

Stop treating the team's working-day calendar as an input the lead will supply
unprompted. Three things ship together: the product **says** when its capacity
figure and its five anomaly budgets were computed against an empty calendar; the
Polish public-holiday calendar is **derived** from a country stored on the
account instead of typed in date by date; and the derivation is **re-offered
every year** as a proposal the lead approves, so 1 January is not a silent
regression.

The derivation is the smallest of the three. The seam it feeds was built and
wired by S-23 — `getNonWorkingDays` already reaches all five elapsed-time rules
(`load-snapshot.ts:65,134`) and the man-day divisor (`capacity.ts:264`). What is
missing is the country, the recurrence, and the sentence.

## Current State Analysis

**The plumbing is complete and deliberately shaped for this slice.**
`schema.ts:794` states in prose that `team_day_off` is *"the row shape S-17 will
later GENERATE from a country, so that slice appends rows rather than reshaping
the model"*; `team-day-off-store.ts:27` chose `ON CONFLICT DO NOTHING` for that
reason, and `:119` already rules that the lead's own label outranks *"S-17's
generator"*. No inbound foreign keys, per-row idempotent writes, `date` column
returning a `DayKey` with no zone conversion anywhere on the path.

**Nothing on the account is a jurisdiction.** `jira_project.time_zone` is the
only geographic signal, it is rewritten 1:1 by every Jira cycle, and it dies with
the credential and on a project switch. Vienna and Warsaw share it and differ on
holidays. `recap_settings`' own header (`schema.ts:1076-1079`) already records
the argument against parking a second geographic value there, and `user` is
contractually Better Auth's (`schema.ts:1063-1066`). So a new home is
unavoidable — which is what S-32 concluded for the cadence override and solved
with a record whose only foreign key points at the account.

**No holiday data or dependency exists.** `date-fns` is the only date library.
CI's bundle tripwire is 5000 KiB gzip (`ci.yml:75`), so weight does not constrain
the choice.

**Zero holidays is indistinguishable from a verified-empty calendar.**
`availability.tsx:247` gates the *only* days-off disclosure on `teamDaysOff > 0`.
Meanwhile `days-off/page.tsx:50` promises a recorded day *"stops tickets ageing
across it"* and `WORKING_TIME_HINT` (`anomaly-rules-view.ts:269`) asserts the
clock runs *"never on a company day off"* — both true of the mechanism, both
currently vacuous on every real account. Measured 2026-08-31: **no real account
holds a single `team_day_off` row**; only the four demo accounts do, two each,
from the fixture.

**The house pattern for a defaulted input is written down and live.**
`CADENCE_PROVENANCE.workingDays` (`cadence-editor-view.ts:147-149`) names the
missing input, what it silently defaulted to, and the number it moves. It is a
pure `.ts` view module with a `.test.ts` sibling, because this repo has no
component-test harness.

## Desired End State

A lead whose calendar is empty sees, on the dashboard panel carrying the man-day
figure and on `/team/days-off`, a sentence saying the numbers currently assume
nobody is ever off. They pick Poland once; SprintFlow proposes that year's public
holidays; they uncheck what their team works and approve; the rows land as
`source = 'derived'` alongside anything they typed by hand, and the capacity
number and every aging budget move accordingly. Next January the same surfaces
say the new year is not reviewed yet, and the proposal is offered again — against
the days they already decided about, never re-proposing one they declined.

Verified by: the notice renders on an account with no `team_day_off` rows and
does not render on one that has them; `holidaysForYear('PL', 2026)` returns 14
dates with Easter Monday on 2026-04-06 and Boże Ciało on 2026-06-04; approving a
year twice writes rows once; and a day deleted after approval stays deleted
across every later render.

### Key Discoveries

- The generator's target table was designed for it: `src/db/schema.ts:786-823`,
  `src/lib/team-day-off-store.ts:24-31,115-155`.
- Both consumers call the same required-parameter reader:
  `src/lib/anomaly/load-snapshot.ts:106`, `src/lib/dashboard/capacity.ts:264`,
  `src/lib/anomaly/rules/helpers.ts:105`.
- The silence is one gate wide: `availability.tsx:247`.
- `SprintCapacity` already carries the whole account's day-off set through
  `computeSprintCapacity` (`capacity.ts:120-140`), so "is the calendar empty at
  all" costs no extra query.
- A unique dedup key must be NOT NULL end to end
  (`context/foundation/lessons.md` #1).
- A migration is not done until it has a named route to production
  (`context/foundation/lessons.md`, last entry).
- Demo owners hold two fixture rows (`demo/fixture.ts:266-274`), so the notice
  is silent in demo without a demo-specific branch.

## What We're NOT Doing

- **No regional subdivision.** German Länder, Swiss cantons, UK nations — out.
  One country, whole team, settled at framing.
- **No countries other than Poland.** The column stores an ISO code and the rules
  live in a table keyed by it, so a second country is an append with no migration
  — but none ships here.
- **No cron step.** See *Critical Implementation Details*.
- **No holiday data over the network**, no npm holiday package, no secret.
- **No push notification.** The recap does not learn about the calendar.
- **No setup-wizard step.** `onboarding.ts` keeps its six probes; adding a
  seventh would gate `/dashboard` on a field that has a working default.
- **Not touching `WORKING_TIME_HINT`.** Considered and deliberately left: the
  sentence is true of the mechanism, and the honest fix belongs where the number
  is, which is where this plan puts it.
- **Not fixing the three defects the frame filed as out of scope** — the
  wall-clock/working-hours split between `time-in-status.ts` and
  `ticket-status-aging.ts`, FR-024's sprint-length cancellation, and
  `WORKING_TIME_HINT` naming neither the zone nor its UTC fallback. Each needs
  its own roadmap entry.

## Implementation Approach

Four phases, ordered so the cheapest and most valuable ships first. Phase 1 is
copy plus one derived boolean and needs no schema; it is the phase that must not
be cut. Phase 2 adds the two records that make a year's decision durable.
Phase 3 is a pure, I/O-free calendar engine testable to the day. Phase 4 joins
them into the proposal-and-approval flow and extends Phase 1's notice with the
branches the new records make expressible.

## Critical Implementation Details

**Why there is no cron step, and what makes the offer annual instead.** The
proposal is a pure function of `(country, year, existing rows, approval record,
today)` — nothing is lost if no one computes it, because the rule table
reconstructs any year forever. That is what separates this from
`sweep.ts:17-25`, whose argument was that a sprint missed at rollover is
*unrecoverable*. A cron step caching a recomputable proposal would be a cache
with an invalidation problem. What makes the offer annual is the **approval
record keyed by year**: on 2027-01-01 the question "is 2027 approved?" answers
itself on every render, and the notice sits on the panel the target persona opens
each morning.

**The approval record is the only thing standing between a regeneration and the
S-30 defect.** A derived row the lead deletes must never come back. Deletion does
NOT clear the approval, and the proposal for an approved year is not recomputed
at all — the year is closed. This is why provenance alone would not have been
enough: a `source` column says where a row came from, but only the year record
says *this year has already been decided about*.

**Writing an approval is one transaction**: insert the accepted rows and stamp
the year together, or neither. A half-applied approval would leave a year that
looks decided with only some of its days present.

**A country switch re-opens every year and destroys nothing.** Approvals are
keyed `(owner, country, year)`, so switching country makes the current year
unapproved and re-proposes it under the new rules. Rows derived under the old
country are left in place — they are days the team was off, and deleting them
would be precisely the lead's-choice-replaced failure this slice exists to avoid.

**Approval re-runs detection**, following decision D1 as written at the head of
`src/app/(app)/team/actions.ts`: best-effort, after the commit, in a swallowing
try, on the workspace clock rather than `new Date()`.

## Phase 1: The sentence

### Overview

Make an empty calendar say so, on the two surfaces where the number it moves is
on screen. No schema, no derivation, no new query. Valuable on its own and
correct before any holiday is ever derived.

### Changes Required

#### 1. The notice's decision logic

**File**: `src/lib/holidays/calendar-notice.ts` (new), with
`calendar-notice.test.ts`

**Intent**: Decide whether to say anything about the working-day calendar, and
what. Extracted to a pure module because two organisms consume it and this repo
has no component-test harness — the same split as `absence-calendar-view.ts` and
`cadence-editor-view.ts`.

**Contract**: `holidayCalendarNotice(input: { calendarIsEmpty: boolean }):
{ kind: "empty"; title: string; body: string } | null`. Returns `null` when the
calendar has any row. The body follows `CADENCE_PROVENANCE.workingDays`' three
beats — name the missing input, name what it silently defaulted to, name the
number it moves — and must mention both the man-day figure and the aging budgets,
because one calendar drives both. The return type is a discriminated union with a
`kind` so Phase 4 adds `"no_country"` and `"year_unapproved"` members without
touching either call site's shape.

#### 2. "Is the calendar empty at all"

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: Surface the fact the reducer already holds. `teamDaysOff` answers
"how many did THIS sprint lose", which is zero both for an account with a full
calendar and a holiday-free sprint and for an account with no calendar at all —
the two states the notice must separate.

**Contract**: `SprintCapacity` gains `calendarIsEmpty: boolean`, computed inside
`computeSprintCapacity` from the `nonWorkingDays` set it already receives.
Unbounded by date by construction (`team-day-off-store.ts:93-97`), so an empty
set means the account holds no rows at all — not "none in this window". Costs no
query. Document that alongside the existing `teamDaysOff` note, which already
explains why the two counts are reported separately.

#### 3. The dashboard panel

**File**: `src/components/organisms/dashboard/availability.tsx`

**Intent**: Replace the `teamDaysOff > 0` gate at line 247 so that zero is no
longer rendered as silence. The existing "− N team days off already subtracted"
line stays exactly as it is for the non-empty case.

**Contract**: `CapacitySummary` renders the notice from
`holidayCalendarNotice({ calendarIsEmpty })` when it is non-null, and the
existing subtraction line when `teamDaysOff > 0`. The two are mutually exclusive
in practice but the component must not assume it.

#### 4. The calendar page

**File**: `src/app/(app)/team/days-off/page.tsx`

**Intent**: Say the same thing where the lead can act on it. The page already
promises a recorded day *"stops tickets ageing across it"* (line 50) — a promise
with no rows behind it.

**Contract**: Renders the same notice above `TeamDaysOffEditor`, driven by
`daysOff.length === 0` — the page has the list in hand and needs no capacity
read.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm test`
- The notice module's tests cover both branches, empty and non-empty
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:integration`
- A new integration test drives `calendarIsEmpty` through the REAL reader, not the injected set (`lessons.md` #49): an owner with zero rows reports `true`, and the same owner with one row dated OUTSIDE the sprint window reports `false` — which is what pins `getNonWorkingDays` being unbounded, the claim the whole notice rests on

#### Manual Verification

- On an account with no days off recorded, the dashboard Availability panel and
  `/team/days-off` both carry the sentence
- After recording one day off by hand, the sentence disappears from both and the
  existing "− 1 team day off" line appears on the panel
- In demo the sentence never appears (the fixture holds two rows)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 2: The records that make a year's decision durable

### Overview

Two records and one column: where the team is, which years have been decided
about, and where each day off came from. No UI, no derivation.

### Changes Required

#### 1. Schema

**File**: `src/db/schema.ts`

**Intent**: Give the account a jurisdiction, give a year's review a durable
answer, and let a row say whether a human typed it.

**Contract**: Three additions.

`holidayCalendar` — per-owner singleton on the `recapSettings` shape:
`id`, `ownerId` (FK to `user`, cascade, `unique`), `countryCode` (text, NOT
NULL), `createdAt`, `updatedAt`. A row exists only once the lead has picked a
country; its absence is the "no country" state.

`holidayYearApproval` — the year record: `id`, `ownerId` (FK to `user`,
cascade), `countryCode` (text NOT NULL), `year` (integer NOT NULL),
`approvedAt` (timestamp NOT NULL), with
`unique("holiday_year_approval_owner_country_year_uq")` on
`(ownerId, countryCode, year)`. All three NOT NULL per
`context/foundation/lessons.md` #1 — a nullable column in a UNIQUE dedup key
never collides. Carries `countryCode` rather than keying on `(owner, year)`
alone so a country switch re-opens the year rather than inheriting a decision
made about a different calendar.

`teamDayOff.source` — `text("source").default("manual").notNull()`, values
`'manual' | 'derived'`. NOT NULL with a default so the migration classifies every
existing row correctly: everything in the table today was typed by a human.

Each of the three carries a header comment in the style of its neighbours,
stating what its absence means and why it is not a column somewhere cheaper —
`holidayCalendar` in particular must record why not `jira_project` (dies with the
credential and on a project switch, the S-32 finding) and why not
`recap_settings` (its own header rejects a second geographic value).

#### 2. Migration

**File**: `src/db/migrations/0025_*.sql` (generated)

**Intent**: Apply the schema delta.

**Contract**: Produced by `npm run db:generate`, never hand-written, then applied
locally with `npm run db:migrate`. Two `CREATE TABLE` plus one `ALTER TABLE …
ADD COLUMN … NOT NULL DEFAULT 'manual'`. See `## Migration Notes`.

#### 3. The store

**File**: `src/lib/holidays/calendar-store.ts` (new), with
`calendar-store.integration.test.ts`

**Intent**: Owner-scoped reads and writes for the country and the year
approvals, in the request-context-free `{ db, ownerId }` shape of
`team-day-off-store.ts` and `absence-store.ts`.

**Contract**: `getHolidayCalendar` (country or `null`), `setHolidayCountry`
(upsert on the owner-unique key), `listApprovedYears({ db, ownerId, countryCode
})` → `Set<number>`, and `approveHolidayYear` taking a `Tx` so Phase 4 can stamp
the year inside the same transaction that inserts the rows. Every read and every
write carries `AND owner_id = ?`, defence in depth on cross-account isolation.

#### 4. Provenance on the write path

**File**: `src/lib/team-day-off-store.ts`

**Intent**: Let a caller say a row was derived, and let the approval write a
batch in one round trip rather than one insert per holiday.

**Contract**: `TeamDayOffInput` gains an optional `source` defaulting to
`'manual'`, so every existing call site is unchanged. A new
`createDerivedDaysOff({ db, ownerId, days })` inserts many rows in one statement
with the same `onConflictDoNothing` target and accepts a `Tx`. `listTeamDaysOff` returns `source` alongside `day` and `label`, so the page can
hand it on. The existing comment at `:115-155` about the owner's wording
outranking the generator's now describes shipped behaviour rather than an
intention — update its tense.

#### 5. Provenance where the lead can see it

**Files**: `src/components/organisms/settings/team-days-off-view.ts` (+ its
`.test.ts`), `src/components/organisms/settings/team-days-off-editor.tsx`,
`src/app/(app)/team/days-off/page.tsx`

**Intent**: Give the `source` column a reader in the same phase that adds it. A
column that is only ever written is not provenance, it is a migration with no
consequence — and Progress row 2.7 ("all show as manually entered") cannot be
executed against a list that never says.

**Contract**: `toTeamDayOffRows` (`team-days-off-view.ts:70-95`) gains `source`
on its row shape and the editor renders it exactly as it already renders
`costsNothing` — a quiet marker on the derived rows, nothing at all on the
manual ones, so the list of an account that has never approved a year looks
unchanged. The page passes `d.source` through the mapping that today carries
`id`, `day` and `label`. All judgement stays in the `.ts` sibling, which has a
test harness; the `.tsx` only renders.

**Why it belongs here and not in Phase 4**: it is what makes the migration
observable. After Phase 4 the same marker answers the question a lead will
actually ask having just approved fourteen rows — which of these did I type
myself?

### Success Criteria

#### Automated Verification

- Migration generates and applies cleanly: `npm run db:generate` then `npm run db:migrate`
- Integration tests pass, including a new test that a second `approveHolidayYear` for the same `(owner, country, year)` is a no-op: `npm run test:integration`
- Cross-account isolation is asserted for every new store function
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`

#### Manual Verification

- Existing recorded days off still list correctly at `/team/days-off`, and none of them carries the derived marker — the list looks exactly as it did before the migration
- Capacity on the dashboard is unchanged for an account that had days off before the migration

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: The Polish calendar as rules

### Overview

A pure, I/O-free engine that answers "which days are public holidays in country
X in year Y". No database, no network, no dependency. Testable to the day, and
mutation-testable.

### Changes Required

#### 1. Easter

**File**: `src/lib/holidays/easter.ts` (new), with `easter.test.ts`

**Intent**: Four of Poland's fourteen holidays are Easter-relative, so the whole
engine rests on this one function. It is the single piece of arithmetic here that
is easy to get subtly wrong, which is why it is isolated with its own tests.

**Contract**: `easterSunday(year: number): DayKey`, the anonymous Gregorian
algorithm (Meeus/Jones/Butcher). Returns a `YYYY-MM-DD` string and constructs no
`Date` at all — the day keys the rest of this repo passes around are zone-free
calendar facts (`components/organisms/settings/team-days-off-view.ts:52-60`), and introducing an instant here
would be the one place a holiday could shift by a day. Tested against at least
six known years spanning both March and April Easters, and a leap year.

#### 2. The Polish rule table

**File**: `src/lib/holidays/poland.ts` (new), with `poland.test.ts`

**Intent**: State Poland's public holidays as data, not code, so a correction is
a one-line edit and a second country is a sibling file.

**Contract**: An exported array of rules, each either
`{ kind: "fixed"; month; day; label }` or
`{ kind: "easter"; offsetDays; label }`, with an optional `fromYear` for rules
that have not always existed. Ten fixed — 01-01, 01-06, 05-01, 05-03, 08-15,
11-01, 11-11, 12-24, 12-25, 12-26 — and four Easter-relative at offsets 0, +1,
+49 and +60. **12-24 (Wigilia) carries `fromYear: 2025`**: it became a statutory
non-working day in Poland only from 2025, and a table that emitted it for 2024
would be wrong about a year the lead may still be looking at. Labels in Polish,
matching what the lead would have typed themselves. Two of the fourteen always
fall on a Sunday — that is correct and already handled honestly downstream, where
`toTeamDayOffRows` marks a day that costs nothing
(`components/organisms/settings/team-days-off-view.ts:31,70-95`).

#### 3. The engine's entry point

**File**: `src/lib/holidays/index.ts` (new), with `index.test.ts`

**Intent**: One function the rest of the app calls, plus the list of countries
the app is willing to offer.

**Contract**: `SUPPORTED_COUNTRIES` as ISO 3166-1 alpha-2 codes with display
names — `[{ code: "PL", name: "Poland" }]` for now — and
`holidaysForYear(countryCode: string, year: number): { day: DayKey; label:
string }[]`, sorted, returning `[]` for an unknown code rather than throwing, so
a stored code the app no longer supports degrades to "nothing to propose" rather
than to a crash. Verified anchors for the tests: in 2026 Easter Monday is
**2026-04-06** and Boże Ciało is **2026-06-04**; 2025 returns 14 days and 2024
returns 13, the 12-24 rule being the difference.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm test`
- `easterSunday` matches six known years including both March and April Easters
- `holidaysForYear('PL', 2026)` returns 14 dates with the two anchors above
- `holidaysForYear('PL', 2024)` returns 13 and `holidaysForYear('PL', 2025)` returns 14
- `holidaysForYear('XX', 2026)` returns `[]` and does not throw
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- None — this phase has no user-visible surface.

**Implementation Note**: No manual pause; this phase is fully covered by
automated verification. Proceed directly to Phase 4.

---

## Phase 4: The proposal and its approval

### Overview

Join the three: pick a country, review the year SprintFlow proposes, approve it.
Extend Phase 1's notice with the two branches the Phase 2 records now make
expressible.

### Changes Required

#### 1. The proposal

**File**: `src/lib/holidays/proposal.ts` (new), with `proposal.test.ts`

**Intent**: Decide what to offer, purely, so the rule that stops a resurrection
is unit-testable without a database.

**Contract**: `holidayProposal({ countryCode, years, approvedYears, existingDays
}): { year: number; day: DayKey; label: string }[]`. A year in `approvedYears`
contributes nothing — an approved year is closed, and that, not the `source`
column, is what keeps a deleted holiday deleted. Every other year contributes
`holidaysForYear` minus the days already present, so a date the lead typed by
hand is never offered twice. Which years are asked about comes from the caller,
never from `new Date()` inside this module.

**`years` is every year the ACTIVE SPRINT touches, not just the year `now` falls
in.** A single-year proposal has a guaranteed annual failure: in mid-December the
current year is approved, so the proposal is empty and the notice is silent,
while the active sprint runs into January and its capacity divisor and all five
aging budgets count 1 and 6 January as ordinary working days. The recurrence
argument — "on 2027-01-01 the question answers itself" — is true and fires one to
three weeks after the lead committed to that sprint. So the caller passes
`[year(sprintStart), year(sprintEnd)]` deduplicated: one year for eleven months,
two for the sprint that crosses. It costs no new read — `loadSprintCapacity`
already holds both dates (`capacity.ts:283-284`) and `/team/days-off` already
loads the active sprint row for its working-day count. With no active sprint
there is no window, and the caller falls back to the single year `now` falls in.
`approvedYears` is already a `Set<number>`, and approving two years is two stamps
inside the one transaction Phase 4 §3 already specifies.

#### 2. Validation

**File**: `src/lib/validations/holiday-calendar.ts` (new)

**Intent**: One source of truth for the country and approval payloads, shared by
the client form and the server re-validation, free of server-only imports —
mirroring `validations/team-day-off.ts`.

**Contract**: A country-code schema constrained to `SUPPORTED_COUNTRIES`, and an
approval schema carrying `years: number[]` plus the day keys the lead kept
(reusing `dayKeySchema`). The kept-days list travels on the wire so unchecking a
day is expressed as not sending it, never as sending a deletion. `years` is sent
alongside rather than derived from the kept days, because a year in which the
lead kept nothing must still be stamped — otherwise it re-opens on the next
render and the proposal comes back.

#### 3. Actions

**File**: `src/app/(app)/team/actions.ts`

**Intent**: Two mutations alongside the existing days-off family, which already
share this file's `redetect()` helper.

**Contract**: `saveHolidayCountryAction` and `approveHolidayYearAction`,
following the file's established shape exactly — `resolveWorkspace()`, parse,
`getDb(env)`, delegate, `redetect(db, ownerId, now)` best-effort after the
commit, returning the existing `ActionFailure` union. `approveHolidayYearAction`
re-validates each submitted day against `holidaysForYear(country, year(day))`
server-side and wraps `createDerivedDaysOff` + one `approveHolidayYear` per
submitted year in a single `db.transaction`, so a two-year approval is
all-or-nothing exactly as a one-year approval is. A submitted day that is not in
its own year's calendar, or whose year is not among the submitted `years`, is
refused rather than stored.

#### 4. The surface

**File**: `src/components/organisms/settings/holiday-calendar-editor.tsx` (new),
with `holiday-calendar-view.ts` and `holiday-calendar-view.test.ts`

**Intent**: The country picker and the year's review list. All judgement lives in
the `.ts` sibling; the `.tsx` renders and submits.

**Contract**: The view module owns the copy and the list shaping — each proposed
day formatted through the existing `formatDayOff`, flagged with `costsNothing`
through the existing `toTeamDayOffRows` logic so a holiday landing on a Saturday
says so before the lead wonders why capacity did not move. Every day is checked
by default; unchecking one and approving means it is never offered again. The
country list renders from `SUPPORTED_COUNTRIES` with a sentence saying more
countries are coming, so a one-entry list reads as a boundary rather than as a
bug. Built with shadcn/ui primitives already in the project.

#### 5. Wiring and the notice's new branches

**Files**: `src/app/(app)/team/days-off/page.tsx`,
`src/lib/holidays/calendar-notice.ts`,
`src/components/organisms/dashboard/availability.tsx`,
`src/app/(app)/dashboard/page.tsx`

**Intent**: Put the editor on the page that owns the calendar, and let the notice
tell the three states apart now that it can.

**Contract**: The page reads the country, the approved years, and the proposal
for every year the active sprint touches,
and renders the editor above the existing manual list. `holidayCalendarNotice`
gains three inputs — `countryCode: string | null`, `currentYearApproved:
boolean`, `isDemo: boolean` — and three members: `"no_country"` (offer to pick
one), `"year_unapproved"` (name the year and offer the review) and
`"country_unavailable"` (name the stored code and say we no longer have its
rules). The
dashboard page passes the new facts through to `Availability`; the two reads
are one indexed lookup each on `owner_id`, and `isDemo` costs nothing because
`resolveWorkspace()` already returns it at both call sites.

**The precedence is a table, not an accident, and the module states it in
order.** Four inputs can be true at once and the branch that wins must be
decided here rather than discovered:

| # | Condition | Result | Why it sits here |
| --- | --- | --- | --- |
| 0 | `isDemo` | `null` | A demo visitor deliberately skipped configuration; an offer to pick a country is a prompt to configure the tenant they chose not to configure. This is what keeps Progress row 1.8 true after Phase 4, rather than a Phase 1 criterion that Phase 4 quietly reverses. |
| 1 | `holidaysForYear(countryCode, …)` is empty for every year asked about, and `countryCode !== null` | `"country_unavailable"` | The lead picked a jurisdiction and we have no rules for it — reachable only if a code is dropped from `SUPPORTED_COUNTRIES` after being stored. Without this row the lead reviews an empty list and approves a year with zero holidays, which is `lessons.md` #42 exactly: a wrong value narrowed into an empty result that reads as success. |
| 2 | `countryCode === null` | `"no_country"` | Outranks `calendarIsEmpty` deliberately: an account that typed holidays by hand still has no jurisdiction, no recurrence, and no answer for next January — which is the state this slice exists to close. |
| 3 | a year asked about is not approved | `"year_unapproved"` | Names the year and offers the review. |
| 4 | otherwise | `null` | |

**Phase 1's `"empty"` member is retired here, and that is the point of the
approval record.** Rows 2 and 3 between them catch every account that has not
yet decided about this year, so the only state left for `"empty"` would be a
country set, the year approved, and no rows — which is precisely a lead who
picked Poland, unchecked every day because their team works them, and approved.
Telling *that* account its numbers "assume nobody is ever off" aims the sentence
at the one person who verified the opposite. The approval record, not the row
count, is what says the calendar was reviewed; Phase 4 drops the member and its
branch rather than leaving it reachable. Phase 1 is unaffected —
`currentYearApproved` is `false` for every account until Phase 2 exists, so
`"empty"` is the whole notice for as long as it is the whole slice.

Row 2's consequence is deliberate and the copy must carry it: an account with
hand-entered days off is still offered a country. The offer is not a complaint
about the rows they typed — the proposal excludes every day already present
(Phase 4 §1), so accepting it adds only what they are missing. The `"no_country"`
body says exactly that, or the notice reads as a nag at the accounts that did
the most work.

### Success Criteria

#### Automated Verification

- Unit tests pass, including that `holidayProposal` returns `[]` for an approved year and omits days already present: `npm test`
- The notice module's tests enumerate the whole precedence table — demo, country unavailable, no country, year unapproved, silent — including a demo account that has a country and an unapproved year and is still silent
- Integration tests pass, including that approving the same year twice writes rows once and that a day deleted after approval is not re-proposed: `npm run test:integration`
- A submitted day outside the country's calendar for that year is refused, as is one whose year was not submitted
- A sprint spanning a year boundary proposes both years; a sprint inside one year proposes one
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- On an account with no country, `/team/days-off` and the dashboard both offer to pick one
- Picking Poland proposes that year's holidays, each dated and labelled in Polish, with any Saturday/Sunday entry marked as costing nothing
- Approving writes the days; the dashboard capacity drops by the number of holidays that fall on working days, and the panel's "− N team days off" line matches
- Unchecking one holiday before approving, then reloading, shows it is not offered again
- Deleting a derived day from the list and reloading does not bring it back
- The notice is gone once the year is approved
- In demo the notice still never appears, even though the demo owner has no country

**Implementation Note**: Pause for manual confirmation. The delete-then-reload
row is the one that proves the S-30 class of defect is closed — do not skip it.

---

## Testing Strategy

### Unit Tests

- `easterSunday` against six known years, March and April, including a leap year
- `holidaysForYear` for 2024 / 2025 / 2026, asserting the 12-24 `fromYear` boundary and the two 2026 anchors
- An unknown country code returns `[]` rather than throwing
- `holidayProposal`: an approved year contributes nothing; an unapproved year contributes the full set minus days already present; a hand-entered day is never offered; two years in, two years out, each tagged with its own `year`
- `holidayCalendarNotice` across the precedence table: demo, country unavailable, no country, year unapproved, silent — and, before Phase 4, the `"empty"` branch on its own
- `computeSprintCapacity` sets `calendarIsEmpty` from an empty set and clears it from a non-empty one

### Integration Tests

- `calendarIsEmpty` through `loadSprintCapacity` itself: zero rows → `true`; one row dated outside the sprint window → `false`
- Every new store function is cross-account isolated: a foreign `ownerId` reads nothing and writes nothing
- Approving a year twice writes its rows exactly once
- A derived day deleted after approval stays deleted across a re-read of the proposal
- Setting a country twice upserts rather than duplicating
- `listTeamDaysOff` reports `source` for rows written before the migration as `'manual'`
- An approval that fails partway leaves neither rows nor a stamped year

### Manual Testing Steps

Carried as the phase-level Manual Verification lists above; the rows that block
the slice are the delete-then-reload check in Phase 4 and the capacity movement
after approval.

## Performance Considerations

`calendarIsEmpty` reuses a set the reducer already receives — no query. The two
new reads on `/team/days-off` and `/dashboard` are single indexed lookups on
`owner_id`, on pages that already issue several. `holidaysForYear` is fourteen
rules and one Easter computation, called once per render; no caching is
warranted and adding some would be the kind of premature state this plan is
otherwise avoiding.

## Migration Notes

`0025` adds two tables and one column. **The route to production is manual**, per
`context/foundation/lessons.md`: merge-to-main triggers a code-only Cloudflare
Workers deploy, and nothing in CI applies migrations to production. The prod
Supabase host is IPv6-only and unreachable by `drizzle-kit` from this machine, so
apply it via the pooler or the Supabase MCP with hand-written drizzle
bookkeeping, exactly as `0024` was applied. It is
`MANUAL-CHECKLIST.md` row 0, and it runs before every other row on that list —
each of them reads one of the new tables or the new column.

The column is additive with a NOT NULL default, so a code rollback needs no
schema rollback — existing rows read as `'manual'`, which is what they are.

## References

- Frame brief: `context/changes/working-days-calendar/frame.md`
- Roadmap: `context/foundation/roadmap.md` § S-17
- The target table and its S-17 intent: `src/db/schema.ts:786-823`
- The store's collision policy: `src/lib/team-day-off-store.ts:24-31,93-97,115-155`
- The lifecycle argument this plan declines to copy: `src/lib/measurement/sweep.ts:17-25`
- The record-without-a-sync-FK precedent: `src/db/schema.ts:610-660` (S-32)
- The disclosure house pattern: `src/components/organisms/settings/cadence-editor-view.ts:140-160`
- The gate being replaced: `src/components/organisms/dashboard/availability.tsx:247`
- Consumers already fed: `src/lib/anomaly/load-snapshot.ts:106`, `src/lib/dashboard/capacity.ts:264`
- Action shape and decision D1: `src/app/(app)/team/actions.ts:28-60`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The sentence

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — da7bc9c
- [x] 1.2 The notice module's tests cover both branches, empty and non-empty — da7bc9c
- [x] 1.3 Type checking passes: `npm run typecheck` — da7bc9c
- [x] 1.4 Linting passes: `npm run lint` — da7bc9c
- [x] 1.5 Integration tests pass: `npm run test:integration` — da7bc9c
- [x] 1.6 `calendarIsEmpty` is asserted through the real reader: zero rows → `true`; one row outside the sprint window → `false` — da7bc9c

#### Manual

- [ ] 1.7 On an account with no days off recorded, the dashboard Availability panel and `/team/days-off` both carry the sentence
- [ ] 1.8 After recording one day off by hand, the sentence disappears from both and the "− 1 team day off" line appears on the panel
- [ ] 1.9 In demo the sentence never appears

### Phase 2: The records that make a year's decision durable

#### Automated

- [x] 2.1 Migration generates and applies cleanly: `npm run db:generate` then `npm run db:migrate` — 6a76fcb
- [x] 2.2 Integration tests pass, including a repeated `approveHolidayYear` being a no-op: `npm run test:integration` — 6a76fcb
- [x] 2.3 Cross-account isolation is asserted for every new store function — 6a76fcb
- [x] 2.4 Type checking passes: `npm run typecheck` — 6a76fcb
- [x] 2.5 Linting passes: `npm run lint` — 6a76fcb
- [x] 2.6 Unit tests pass: `npm test` — 6a76fcb

#### Manual

- [ ] 2.7 Existing recorded days off still list correctly and none carries the derived marker
- [ ] 2.8 Capacity is unchanged for an account that had days off before the migration

### Phase 3: The Polish calendar as rules

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — 792547f
- [x] 3.2 `easterSunday` matches six known years including both March and April Easters — 792547f
- [x] 3.3 `holidaysForYear('PL', 2026)` returns 14 dates with Easter Monday 2026-04-06 and Boże Ciało 2026-06-04 — 792547f
- [x] 3.4 `holidaysForYear('PL', 2024)` returns 13 and `('PL', 2025)` returns 14 — 792547f
- [x] 3.5 `holidaysForYear('XX', 2026)` returns `[]` and does not throw — 792547f
- [x] 3.6 Type checking passes: `npm run typecheck` — 792547f
- [x] 3.7 Linting passes: `npm run lint` — 792547f

### Phase 4: The proposal and its approval

#### Automated

- [x] 4.1 Unit tests pass, including `holidayProposal` returning `[]` for an approved year and omitting days already present: `npm test`
- [x] 4.2 The notice module's tests enumerate the whole precedence table, including the country-unavailable row, including demo silence with a country set and a year unapproved
- [x] 4.3 Integration tests pass, including double approval writing rows once and a deleted day not being re-proposed: `npm run test:integration`
- [x] 4.4 A submitted day outside that year's calendar, or whose year was not submitted, is refused
- [x] 4.5 A sprint spanning a year boundary proposes both years; a sprint inside one year proposes one
- [x] 4.6 Type checking passes: `npm run typecheck`
- [x] 4.7 Linting passes: `npm run lint`

#### Manual

- [ ] 4.8 An account with no country is offered one on both surfaces
- [ ] 4.9 Picking Poland proposes the year's holidays, dated and labelled, with weekend entries marked as costing nothing
- [ ] 4.10 Approving writes the days and capacity drops to match the panel's "− N team days off" line
- [ ] 4.11 Unchecking a holiday before approving means it is not offered again after reload
- [ ] 4.12 Deleting a derived day and reloading does not bring it back
- [ ] 4.13 The notice is gone once the year is approved
- [ ] 4.14 In demo the notice still never appears, even with no country on the demo owner
