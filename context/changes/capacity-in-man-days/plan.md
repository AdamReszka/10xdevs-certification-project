# Capacity in man-days, velocity in story points — Implementation Plan

## Overview

SprintFlow never records what a sprint *was*. Capacity is computed live from a
roster with no time dimension and then discarded; the delivered-SP scalar is a
snapshot of "what is in Done right now", rewritten by every sync cycle including
the ones that run after the sprint has closed. This plan makes a sprint a **unit
of measurement**: capacity becomes man-days computed from an availability
fraction, delivered SP becomes "first entry into Done inside the sprint window",
and both are frozen into a durable per-sprint record that outlives retention and
a Jira-project switch. From that record the lead gets the relation they asked
for (capacity beside reliability) and an estimated velocity for the next sprint.

Roadmap slice **S-23**. PRD **FR-006, FR-007, FR-010, FR-016, FR-022, FR-023,
FR-024**.

## Current State Analysis

Established at framing (`frame.md`, five dimension agents + one pressure test)
and re-measured during planning (`planning-notes.md` §6). Not re-derived here.

- **`team_member.sp_capacity`** (`src/db/schema.ts:318`) is a nullable `integer`
  in story points with **21 non-test references** in `src/`. Nothing populates it
  — the roster import does not set it and new rows default to `null`
  (`roster-editor.tsx:736`) — so the live state is not "capacity in the wrong
  unit", it is **no denominator at all**. Stored non-null values are
  un-reinterpretable (`8` is indistinguishable as 8 SP and as 8 FTE), so the
  migration destroys them by necessity.
- **The reducer changes shape, not just unit.** `capacity.ts:124` computes
  `spCapacity × (available ÷ sprintWorkingDays)` — a ratio that cancels the day
  dimension. Man-days are `fte × availableDays`; the divisor disappears.
- **`sprintWorkingDays` is computed and never rendered.** Today's working-day
  count is unfalsifiable by the lead; in an MD model it becomes the headline.
- **The `nonWorkingDays` seam is declared and empty** (`helpers.ts:88,103,126`)
  with **five would-be call sites**: `capacity.ts:83,120`,
  `sprint-at-risk.ts:125,152`, `ticket-status-aging.ts:64`. No production caller
  passes it.
- **Both sprint scalars are recomputed every cycle** (`run-sync.ts:817-831`),
  after the sprint closes included. `committedSp` grows with scope creep, so
  reliability always looks good; `completedSp` is
  `sum(sp) filter (current_category = 'DONE')` — a snapshot of *now*.
- **The correct DONE primitive already exists twenty lines away**:
  `burndown-series.ts:144-153` burns SP on a ticket's *first* transition into
  DONE and never un-burns. It was simply never persisted as velocity.
- **`added_after_sprint_start` keys off ticket creation date**
  (`run-sync.ts:748-749`), so an old backlog item pulled in mid-sprint counts as
  committed — the reliability denominator is wrong today. The `Sprint`-field
  changelog that fixes it **is already fetched and thrown away**:
  `expand: "changelog"` is in the query (`jira.ts:863`) and `parseStatusHistory`
  drops everything with `field !== "status"` (`jira.ts:799`).
- **No column in any table has ever recorded a sprint's capacity.** Its inputs
  carry no time dimension (`grep valid_from|effective|as_of|snapshot` → zero
  hits); `is_active` flips in place, members can be deleted or merged. A carried
  ticket is re-stamped into the new sprint (`run-sync.ts:770`,
  unique `(owner_id, jira_key)`), so past sprints are unrecomputable.
- **The rollover hook exists and writes nothing.** `reconcileActiveSprint`
  returns `switched` (`reconcile-sprint.ts:288`) and records nothing about the
  sprint it just closed.
- **`ReliabilityKpi` takes exactly two scalars** (`reliability-kpi.tsx:31-37`)
  with no capacity term, so it cannot tell a full team's 100% from a half
  team's 100% — the owner's originating complaint.
- **`numeric` comes back from `pg` as a string.** Measured: `0.50::numeric(3,2)`
  → `'0.50'`, `typeof === "string"`, `'0.50' === 0.5` is `false`. That breaks
  `isUnchanged`'s `===` chain (`roster-store.ts:489`) — every roster save would
  look like a change.
- **`story_points integer` is not a precision defect, it is an availability
  defect.** Measured 2026-08-28 against local Postgres with the real `pg`
  driver: inserting `0.5` raises `invalid input syntax for type integer`, inside
  `db.transaction` (`run-sync.ts:735`), so the whole Jira transaction rolls back
  and `sync_state` is stamped `ERROR` — every 15 minutes, forever, with no
  self-heal path. FR-009's thresholds are Fibonacci (1/2, 3, 5, 8/13, 21):
  0.5 SP does not exist in this product's domain, so the column is correct and
  the parser is not.

## Desired End State

The lead opens the dashboard and sees, for the current sprint, a capacity in
man-days with the working-day count it was computed from, next to a reliability
figure that is now interpretable because the capacity stands beside it. They can
record the team's public holidays once, as dates, and every sprint that spans
them costs one man-day per person less. When a sprint closes, SprintFlow writes
a small permanent record of what that sprint was — full capacity, capacity after
absences and days off, committed SP frozen at sprint start, delivered SP counted
from first entry into Done. After two such sprints — two, not one, because one is not an
average — the lead gets an estimated velocity — the average of past normalised velocity scaled by the active sprint's
capacity ratio — shown together with the numbers it came from and withheld
entirely when there is no history. They can switch the Sprint Detail
page to a closed sprint and compare.

Verification: `npm test`, `npm run test:integration`, `npm run typecheck`,
`npm run lint` all pass; the per-phase manual rows in
`context/changes/capacity-in-man-days/MANUAL-CHECKLIST.md` are ticked.

### Key Discoveries:

- The repo already knows how to freeze a fact: `daily_recap.payload` is a
  durable per-day snapshot, and the per-sprint cadence columns
  (`sprint.length_days/start_day/working_days`) are a per-sprint *copy* rather
  than a global setting. The capability is not missing — the decision that a
  sprint is worth freezing is.
- The house read-side pattern is a pure reducer plus an owner-scoped reader
  beside it (`capacity.ts`, `aging.ts`). A "last N sprints" reader extends it.
- `absence` already has a nullable `sprint_id` (`schema.ts:456`), but
  `team_member_id` is NOT NULL — so team-wide days off cannot ride that table.
- Drizzle's `date()` column returns `'YYYY-MM-DD'` strings from `pg`, which is
  byte-identical to the `DayKey` type the seam consumes.
- `detectAnomalies` has exactly two production callers
  (`settings/absences/actions.ts:150`, `sync/actions.ts:91`) plus the cron loop
  in `scheduled.ts` — the same three seats the measurement sweep needs.

## What We're NOT Doing

- **No backfill.** The series starts at the first sprint closed after Phase 4
  ships. Historical capacity is physically unreconstructable — the roster has no
  time dimension — and inventing one would violate FR-023's "the system never
  substitutes a default conversion".
- **No `numeric` migration for `story_points`.** 0.5 SP is not in this
  product's domain (FR-009 is Fibonacci). The rounding guard closes the
  availability hole without modelling a quantity the product does not know.
  `roadmap.md`'s description of this defect is wrong about the consequence and
  is corrected in Phase 1.
- **No automatic derivation of public holidays from a country.** That stays
  **S-17**, now downstream of this slice. Phase 2 ships the row shape S-17 will
  populate.
- **No "you took on too much" warning.** Recorded as a candidate fourth
  condition for `SPRINT_AT_RISK`; its threshold needs history and a tolerance
  margin that cannot be chosen before the history exists, and a ceiling-picked
  threshold gets muted after the first false alarm and the rule dies.
- **No multi-sprint trend charts.** Phase 7 is a sprint *switcher*, not a trend
  dashboard; inter-sprint analytics stay phase-2 per `prd.md`.
- **No per-member historical snapshots.** The measurement record freezes team
  totals, not who was on the team.
- **No `timestamptz` migration for sprint boundaries.** Deferred again,
  deliberately; every day-boundary decision in this slice routes through the
  team's zone via `day-bucket.ts`.

## Implementation Approach

Four write-path phases, then three read-path phases. Phases 1–4 are the spine:
once Phase 4 lands, the history accumulates on its own whether or not 5–7 are
built, which is what makes 7 safely cuttable under deadline pressure.

The record lives in its **own table**, not in columns on `sprint`. `sprint` rows
cascade-delete on a Jira-project switch (`connection-service.ts:405-411`,
`jira-store.ts:255-259`) and fall under the "current + 2 sprints" retention
bound — the cascade exists today, the purge does not yet (the only retention in
`src/lib` is `SYNC_ATTEMPT_RETENTION`, `run-sync.ts:309`), so the decision rests
on the cascade and merely anticipates the purge (plan review F7); the measurement record must outlive both, so it carries `jira_project_id`
as **plain text with no foreign key** and the series filters on the current
project (mixing two projects' measurements would average two different teams,
which is worse than the honest "no data" FR-023 mandates).

The record is written by an **idempotent sweep on every sync cycle**, not by a
hook on `reconcileActiveSprint`'s `switched`. A stalled cron or an expired token
at the moment of rollover would make a hook lose that sprint *forever* — exactly
the class of silent loss the framing identified as the substance of the problem.
A sweep ("every sprint without a current record: compute and write") delays the
record instead of losing it. For the same reason, committed SP is frozen at the
first cycle that sees the sprint as `ACTIVE`, **with a timestamp of when the
freeze happened**, so a late freeze is visible rather than silent.

## Critical Implementation Details

**`numeric` → `number` conversion is mandatory, not cosmetic.** The `pg` driver
returns `numeric(3,2)` as the string `'0.50'`. Every read of `team_member.fte`
and of the measurement table's numeric columns must convert at the boundary, and
`isUnchanged` (`roster-store.ts:489`) compares with `===` — leaving a string
there makes every roster save look like a change and bumps `updated_at` on every
row.

**Ordering inside Phase 3.** The `Sprint`-changelog fix must land before the
committed-SP freeze is switched on, or the first freeze captures today's wrong
denominator permanently.

**The seam must be wired at all five sites in one phase.** A public holiday is
not a working day for capacity *and* not an aging day for
`TICKET_STATUS_AGING`. Half-wiring it produces two counters that disagree —
a failure `context/foundation/lessons.md` already records once.

## Phase 1: Availability fraction replaces story-point capacity

### Overview

Retire `team_member.sp_capacity` and replace it with `fte`, a four-choice
availability fraction. Because the removal leaves `capacity.ts` with nothing to
compute, this phase also carries the reducer's new arithmetic
(`fte × availableDays`) and the Availability tab's MD label — the owner's §4
sketch put the reshape in Phase 2, but Phase 1 cannot be left compiling and
truthful without it. Phase 2 keeps the rest of that bullet (days-off table,
seam, working-day display).

### Changes Required:

#### 1. Canonical documents

**File**: `context/foundation/prd.md`

**Intent**: Record three amendments explicitly rather than smuggling them. FR-007
currently says team-wide days off are recorded "for a given sprint"; the decision
is that they are **dates on the account**, so one entry works in every sprint
that spans it and S-17 later appends rows instead of rewriting the model. The
scope now includes a place to view closed sprints, which the same-day roadmap
note had parked. And FR-024's ratio is taken over the **active** sprint, not a
future one — see Phase 6 §2 (plan review F1).

**Contract**: FR-007's clause on team-wide days off; a `> Socratic (revised
2026-08-28)` line under it carrying the reason. FR-016 gains no new text — the
capacity-beside-reliability wording already covers Phase 6. FR-024's "the ratio
of the next sprint's capacity to its full capacity" becomes the **active**
sprint's, with a `> Socratic (revised 2026-08-28)` line recording why: a sprint
that has not started has no Jira row, no working-day count and no absences, so
"next" was never computable — `roadmap.md:744` already carries the owner's
formula as `capacity_current ÷ capacity_full`, and projecting an unstarted
window is roadmap **S-18**. FR-024's worked example is re-worded to the same
sprint (200 MD full, 180 MD after one full-sprint absence, average 100 SP → 90
SP) — the arithmetic is unchanged.

**File**: `context/foundation/roadmap.md`

**Intent**: Three edits. S-23's row/section absorbs the widened scope (per-sprint
entry surface + closed-sprint viewing) with the owner's reason: reliability from
a single sprint is a gadget, only a series makes it readable. S-17's note stays
downstream. The `story_points integer` defect description is corrected — it is
not "half points are lost", it is "the Jira transaction rolls back and the sync
is stuck in `ERROR`".

**Contract**: rows for S-17, S-18 and S-23 in the slice table
(`roadmap.md:517,518,523`) and the S-23 section body. **S-18** gains one line:
S-23 ships FR-024's estimate over the *active* sprint's capacity ratio; what
stays in S-18 is projecting an unstarted window (its own working-day config and
absence coverage), so S-23 does not close S-18 (plan review F1).

#### 2. Schema and migration

**File**: `src/db/schema.ts`

**Intent**: Drop `spCapacity`; add the availability fraction and a per-member
confirmation stamp. The stamp is what lets the Phase-1 banner know who still
carries the migration's default rather than a fact the lead confirmed.

**Contract**: on `teamMember` — remove `spCapacity`; add
`fte: numeric("fte", { precision: 3, scale: 2 }).notNull().default("1.00")` and
`fteConfirmedAt: timestamp("fte_confirmed_at")` (nullable).

**File**: `src/db/migrations/0012_*.sql` (generated)

**Intent**: `npm run db:generate`, then read the output before applying. The
`DROP COLUMN` is the deliberate data loss; the `ADD COLUMN … NOT NULL DEFAULT
'1.00'` backfills every existing member as full-time, which is the regression the
banner exists to surface.

**Contract**: `ALTER TABLE team_member DROP COLUMN sp_capacity;` plus the two
`ADD COLUMN`s. `fte_confirmed_at` must be left NULL for existing rows.

#### 3. The fraction as a domain value

**File**: `src/lib/fte.ts` (new)

**Intent**: One place that knows the four legal values and the string↔number
boundary, so the conversion cannot be forgotten at one of the five read sites.

**Contract**: `FTE_CHOICES = [1, 0.75, 0.5, 0.25] as const`;
`toFte(raw: string | number | null | undefined): number` (defaults to 1 on an
unparseable value, never NaN); `fteToColumn(value: number): string`;
`isFteChoice(value: number): boolean`.

**File**: `src/lib/validations/roster.ts`

**Intent**: Replace the story-point field with a non-nullable enumerated
fraction. There is no "not answered" state any more, so no `nullish()`.

**Contract**: `spCapacity: z.number().int().min(0).max(1000).nullish()` at line 42
becomes an `fte` field constrained to `FTE_CHOICES`.

**Amended during implementation (impl review F3): the field is REQUIRED, not
`.default(1)`.** A zod default makes the schema's input type diverge from its
output, and `zodResolver` then refuses to reconcile it with the editor's form
type. The stricter shape is also the better one: the only consumers are
`saveRosterAction` and `mergeMembersAction`, both fed by the editor, which always
sets the field — so a payload that omits `fte` is a stale client, and refusing it
with "reload the page" beats silently promoting somebody to full time. Carry the
human message on the type as well as the refinement (impl review F1):
`saveRosterAction` hands `issues[0].message` straight to a toast.

#### 4. Roster read/write path

**File**: `src/lib/roster.ts` (`:66,83`), `src/lib/integrations/roster-store.ts`
(`:128,246,318,452,475,489`), `src/components/organisms/setup/roster-merge.ts`
(`:31,87`), `src/app/(app)/setup/team/actions.ts` (`:56,140`)

**Intent**: Carry `fte: number` end to end, converting with `toFte` at every
`select`. The merge helper's `keep.spCapacity ?? drop.spCapacity ?? null` chain
collapses to `keep.fte` — a NOT NULL column has no absent state to fall through.

**Contract**: `MemberFields.fte: number`; `isUnchanged` compares converted
numbers (see Critical Implementation Details); `saveRoster` stamps
`fteConfirmedAt = now` on any row whose `fte` the save touched, and on every
insert.

#### 5. Roster editor

**File**: `src/components/organisms/setup/roster-editor.tsx` (`:99,535-538,610-619,736`)

**Intent**: Swap the free-number input for a four-option select — `0.5` is
currently unenterable at four layers at once, and a select removes all four. The
helper copy at 535-538 asserts the *opposite* model ("a half-time developer's
number is already halved… it never multiplies it by anything") and must be
rewritten: the fraction now multiplies the sprint's working days.

**Contract**: column header `Availability`; a shadcn `Select` bound through
`Controller` with options `Full time (1.0) / 0.75 / Half time (0.5) / 0.25`,
`aria-label="Availability"`; `append()` defaults `fte: 1`.

#### 6. Migration banner

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: The migration silently makes every part-timer full-time, which
inflates capacity with no signal. The banner names the count and disappears once
every member has been confirmed.

**Amended during implementation (impl review F4): `settings/team/page.tsx` needs
no change.** The banner lives entirely in the shared organism, which both mounts
already render, so the page passes nothing new. The side effect is that it also
appears on `/setup/team` — harmless, because a fresh owner has no members and the
count is zero, and an existing owner revisiting the wizard has the same problem
the banner is for.

**Contract**: rendered when `members.some(m => m.fteConfirmedAt === null)`;
copy names the count and says the previous story-point capacity could not be
converted; a "Confirm availability" action stamps `fte_confirmed_at` for all
listed members without changing their values.

#### 7. Capacity reducer in man-days

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: New arithmetic and new output. Each active member contributes
`fte × availableWorkingDays`; the `available ÷ sprintWorkingDays` ratio and the
whole `membersWithoutCapacity` path disappear (the column is NOT NULL — there is
no "not answered" state left to surface).

**Contract**: `CapacityMember.fte: number` replaces `spCapacity`;
`SprintCapacity` becomes
`{ adjustedMd: number; nominalMd: number; sprintWorkingDays: number }`. The
`sprintWorkingDays === 0` guard stays (a sprint with no working days has no
capacity, and the ceiling stays honest).

**File**: `src/components/organisms/dashboard/availability.tsx` (`:126-166`)

**Intent**: Render man-days. The `noneSet` empty state goes with
`membersWithoutCapacity`.

**Contract**: `CapacitySummary` renders `{adjustedMd} MD` with
`of {nominalMd} MD, after absences` when reduced.

#### 8. Fixtures

**File**: `src/lib/anomaly/test-support.ts` (`:57`), `scripts/seed-dashboard.mjs` (`:271`)

**Intent**: Keep the demo seed and the detector fixtures compiling and
realistic — the seed's six-person team should carry a mix of fractions so the
demo shows a capacity that is not a round multiple of the headcount.

**Contract**: `sp_capacity` column drops out of the seed insert; `fte` is added.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npm run db:migrate`
- `grep -rn "spCapacity\|sp_capacity" src/ scripts/ --include="*.ts" --include="*.tsx" --include="*.mjs"` returns no CODE references outside `src/db/migrations/`. Comments that explain why the column is gone are expected and must not be deleted to satisfy the grep — they are what stops someone reintroducing it (impl review F4)
- Unit tests pass, including new `src/lib/fte.test.ts` covering the string→number boundary: `npm test`
- A `roster-store` integration test asserts that saving an unchanged roster performs zero updates (the `numeric`-as-string trap): `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/settings/team` shows the banner naming how many members were defaulted to full-time; confirming it makes the banner disappear and it stays gone after a reload
- The Availability select offers exactly four options and a saved 0.5 survives a page reload as 0.5
- The dashboard Availability tab shows a capacity in MD that equals `Σ fte × working days` for a sprint with no absences recorded

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Team days off, and the empty seam wired at all five sites

### Overview

Give the lead a place to record public holidays and company days off as dates on
the account, and wire the `nonWorkingDays` seam that S-08 declared and left
empty — everywhere it is consumed, in one phase.

### Changes Required:

#### 1. Schema

**File**: `src/db/schema.ts`, `src/db/migrations/0013_*.sql`

**Intent**: A team-wide day off is not an absence — `absence.team_member_id` is
NOT NULL, so it cannot ride that table. It is a date on the account, so one
entry applies to every sprint spanning it, which is exactly the row shape S-17
will later generate from a country.

**Contract**: `teamDayOff` — `id` text PK, `ownerId` text NOT NULL FK
`user.id` ON DELETE CASCADE, `day` `date("day")` NOT NULL (the `pg` driver
returns `'YYYY-MM-DD'`, byte-identical to `DayKey`), `label` text nullable,
`createdAt`. `unique(ownerId, day)`; index on `ownerId`.

#### 2. Store

**File**: `src/lib/team-day-off-store.ts` (new)

**Intent**: Owner-scoped CRUD plus the one read the seam needs. Mirrors
`absence-store.ts` in shape.

**Contract**: `listTeamDaysOff({db, ownerId})`,
`getNonWorkingDays({db, ownerId}): Promise<ReadonlySet<DayKey>>`,
`createTeamDayOff`, `deleteTeamDayOff`. A duplicate date is an idempotent no-op,
not an error.

#### 3. Wiring the seam — all five sites

**File**: `src/lib/dashboard/capacity.ts` (`:83,120`)

**Intent**: Both the sprint's own working-day total and each absence's clipped
window must exclude team days off, or a holiday inside someone's vacation would
be subtracted twice.

**Contract**: `computeSprintCapacity` takes
`nonWorkingDays: ReadonlySet<DayKey>`; both `countWorkingDaysInclusive` calls
pass it; `getSprintCapacity` loads it in the existing `Promise.all`.

**File**: `src/lib/anomaly/types.ts`, `src/lib/anomaly/load-snapshot.ts`,
`src/lib/anomaly/rules/sprint-at-risk.ts` (`:125,152`),
`src/lib/anomaly/rules/ticket-status-aging.ts` (`:64`),
`src/lib/anomaly/test-support.ts`

**Intent**: Detectors are pure over the snapshot, so the calendar has to arrive
through it — the same argument that put `timeZone` there. A ticket does not age
on a public holiday, and a day the whole team is off is not a working day lost
to one person's absence.

**Contract**: `SprintSnapshot.nonWorkingDays: ReadonlySet<DayKey>`; the loader
reads it via `getNonWorkingDays`; the test-support factory defaults it to an
empty set.

#### 4. Entry surface

**File**: `src/components/organisms/settings/team-days-off-editor.tsx` (new),
`src/app/(app)/settings/absences/page.tsx`,
`src/app/(app)/settings/absences/actions.ts`

**Intent**: The absences page is already "who is not working"; team days off are
the same question asked of everyone. Adding a section there costs no new route
and puts the two calendars side by side. Mutations re-run detection for the same
reason absence mutations already do (`actions.ts:24-40`): a holiday changes
`TICKET_STATUS_AGING` budgets, and waiting 15 minutes would look broken.

**Contract**: a list of dates with optional labels, add/remove; server actions
mirroring the absence actions' thin shape (`requireSession` → `getDb` →
service), each followed by a best-effort `detectAnomalies`.

#### 5. Showing the divisor

**File**: `src/components/organisms/dashboard/availability.tsx`

**Intent**: `sprintWorkingDays` has been computed and never rendered since S-08,
which is why today's wrong divisor is invisible. FR-022 requires it beside the
capacity number.

**Contract**: under the MD figure, "N working days" and, when any fall in the
sprint, "− M team days off".

### Success Criteria:

#### Automated Verification:

- Unit tests: a holiday inside the sprint reduces `adjustedMd` by exactly one MD per full-time member, and a holiday inside an absence window is not subtracted twice: `npm test`
- Unit tests: `TICKET_STATUS_AGING` does not age a ticket across a team day off, and `SPRINT_AT_RISK`'s working-days-left drops by one: `npm test`
- Integration test: `getNonWorkingDays` is owner-scoped and a duplicate insert is a no-op: `npm run test:integration`
- `grep -rn "countWorkingDays" src/ --include="*.ts" | grep -v test` shows every production call site passing a `nonWorkingDays` argument
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- Adding a public holiday inside the active sprint on `/settings/absences` lowers the dashboard capacity by one MD per full-time member and the working-day count by one
- The same holiday stops a ticket's aging clock — a ticket that was one hour from flagging does not flag over the holiday
- Removing the day off restores both numbers

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Honest sprint sums

### Overview

Fix the three defects in the two scalars the reliability ratio divides:
committed SP grows with scope creep, its denominator keys off the wrong date,
and delivered SP is a snapshot of "what is in Done right now" that keeps being
rewritten after the sprint closes. Also close the sync-stopping hole in the
story-point parser.

### Changes Required:

#### 1. Story-point guard

**File**: `src/lib/jira.ts` (`:815-822`)

**Intent**: `extractStoryPoints` passes any `number` straight into an `integer`
column inside a transaction, so a single `0.5` estimate in Jira permanently
wedges the Jira sync in `ERROR` every 15 minutes with a cause the lead cannot
guess from the dashboard. Round at the boundary. The column is right — FR-009's
thresholds are Fibonacci and 0.5 SP is not in this product's domain — so this is
an input guard, not a model change.

**Contract**: non-finite → `null`; otherwise `Math.round(raw)` clamped to
non-negative.

#### 2. Sprint-field changelog

**File**: `src/lib/jira.ts` (`:780-810,863`)

**Intent**: `added_after_sprint_start` is `issue.createdAt > sprintStart`, so an
old backlog item pulled in mid-sprint counts as committed and the reliability
denominator is wrong today. The changelog that answers the question properly is
**already fetched and discarded** by the `field !== "status"` filter — this is a
parser extension, not a new API call.

**Contract**: `parseStatusHistory` keeps its status-only contract; a sibling
collects `Sprint`-field changes into
`JiraSprintIssue.sprintFieldChanges: { changedAt: Date | null; from: string | null; to: string | null }[]`.

**Match on the resolved field id, not the display name (plan review F5).** A
changelog item carries both `field` (the site's *display* name, localised and
renameable) and `fieldId` (`customfield_*`, stable). Matching only on
`field === "Sprint"` fails silently on a non-English or renamed site, and the
`createdAt` fallback then writes today's wrong denominator — which §4 **freezes
permanently** into the sprint row and, through it, into every measurement
record. That interaction is what upgrades this from the accepted risk the brief
recorded to something worth spending an API call on. The repo already solves
this exact class: `resolveStoryPointFieldId` (`jira.ts:941`) discovers the
site-specific id off `schema.custom` from `GET /rest/api/3/field` — the one call
that lists every field, and the same call the story-point id already comes from.

- Add `resolveSprintFieldId` beside it, matching `schema.custom` containing
  `greenhopper` + `sprint` (the Jira Software sprint field), resolved in the
  same place and cached the same way as `storyPointFieldId`.
- Match a changelog item when `it.fieldId === sprintFieldId`, falling back to
  `it.field === "Sprint"` when the id could not be resolved.
- Neither matched and the issue has a non-empty changelog → count it, and log
  the count once per sync, so the fallback path is visible rather than silent.
  No field names or issue content in the log line.

#### 3. Denominator from the changelog

**File**: `src/lib/integrations/sync/run-sync.ts` (`:748-749`)

**Intent**: A ticket is "added after sprint start" when the `Sprint` field
transition that put it into *this* sprint happened after the sprint started.

**Contract**: resolve the latest `sprintFieldChanges` entry whose `to` names this
sprint; `addedAfterSprintStart = thatChange.changedAt > sprintStart`. **Fallback
when no `Sprint` transition is present** (ambiguous: either it was there from the
start, or it was created directly into the sprint): keep today's
`createdAt > sprintStart` rule, which resolves both readings correctly.

#### 4. Freeze committed SP at first sighting

**File**: `src/db/schema.ts`, `src/db/migrations/0014_*.sql`,
`src/lib/integrations/sync/run-sync.ts` (`:817-831`)

**Intent**: A commitment that grows with the scope added to it is not a
commitment — it makes reliability look good by construction. Freeze it at the
first cycle that sees the sprint, and stamp *when*, so a late freeze (stalled
cron, expired token) is visible rather than silent.

**Contract**: `sprint.committedFrozenAt: timestamp` (nullable). The totals
`UPDATE` writes `committedSp` and stamps `committedFrozenAt = now` **only when
`committed_frozen_at IS NULL`**, expressed in the same statement (`case when …`,
the idiom already used for cadence at `reconcile-sprint.ts:258-260`). Per-ticket
`storyPoints` keeps refreshing every cycle — estimates change during refinement
and the live figures should follow.

#### 5. Delivered SP from first entry into Done

**File**: `src/lib/dashboard/first-done.ts` (new),
`src/lib/dashboard/burndown-series.ts` (`:144-153`),
`src/lib/integrations/sync/run-sync.ts`

**Intent**: The correct primitive already exists inside the burndown reducer and
was never persisted as velocity. Extract it so the two surfaces cannot drift,
then compute `completedSp` from it. Bounding the count to
`[sprintStart, sprintEnd]` is also what stops the scalar from being rewritten
after the sprint closes: a first-DONE instant never moves, so post-close cycles
become idempotent.

**Contract**: `firstDoneAtByTicket(transitions): Map<string, Date>` — earliest
transition with `toCategory === 'DONE'` and non-null `changedAt`;
`computeDeliveredSp({ tickets, firstDoneAt, sprintStart, sprintEnd, now })`
sums `storyPoints ?? 0` for tickets whose first DONE falls in
`[sprintStart, min(sprintEnd, now)]`. `burndown-series.ts` imports the first
helper rather than keeping its own copy. `run-sync` reads the sprint's tickets
and their DONE transitions inside the existing transaction and writes the result
to `sprint.completedSp`.

**Note on carried-over tickets**: a ticket whose first DONE predates this
sprint's start does not count as delivered here — it was delivered in the sprint
that closed it. FR-023's "a ticket that later reopened or carried over still
counts" is satisfied by *first* entry never being un-set.

### Success Criteria:

#### Automated Verification:

- Unit tests: a `0.5` from Jira becomes `1`, a `NaN`/`Infinity` becomes `null`: `npm test`
- Unit tests for `computeDeliveredSp`: reopened-and-reclosed counts once; closed-after-sprint-end does not count; carried-in already-done does not count; unestimated contributes 0, not NaN
- Integration test: a second sync cycle does not change `committed_sp` after a ticket is added to the sprint, and `committed_frozen_at` keeps its first value: `npm run test:integration`
- Integration test: `added_after_sprint_start` is false for a ticket created a month ago whose `Sprint` transition predates sprint start, and true when the transition follows it
- Unit test: a changelog item is matched by `fieldId` even when its display `field` is not the English `Sprint`, and the display-name path still matches when the id is unresolved (F5)
- Integration test: `completed_sp` is unchanged by a sync cycle that runs after `endDate` has passed
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- With SP estimates entered in the FM Jira project (manual-test row 1.8), a real sync writes `committed_sp` / `completed_sp` matching what Jira shows
- Adding a ticket to the running sprint in Jira raises the burndown's scope line but does **not** raise the committed figure on the Reliability panel
- Setting a Jira estimate to 0.5 no longer breaks the sync — the dashboard keeps updating and the ticket shows 1 SP

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: The per-sprint measurement record

### Overview

The spine of the slice. A separate, retention-exempt table records what each
sprint was, written by an idempotent sweep that runs in every sync cycle.

### Changes Required:

#### 1. Schema

**File**: `src/db/schema.ts`, `src/db/migrations/0015_*.sql`

**Intent**: A durable record that survives what `sprint` does not: the "current
+ 2 sprints" retention bound and the cascade delete a Jira-project switch fires.
Hence a separate table, and hence `jira_project_id` stored as **plain text with
no foreign key** — an FK would reintroduce exactly the cascade the record must
outlive. The row also holds the lead's overrides, kept alongside the computed
values rather than replacing them (FR-022, FR-023).

**Contract**: `sprintMeasurement` —
`id` text PK; `ownerId` text NOT NULL FK `user.id` ON DELETE CASCADE;
`jiraProjectId` text NOT NULL (no FK); `jiraSprintId` text NOT NULL;
`sprintName` text; `startDate`/`endDate` timestamp; `workingDays` integer;
`capacityFullMd` / `capacityAdjustedMd` `numeric(8,2)`;
`capacityOverrideMd` `numeric(8,2)` nullable;
`committedSp` / `deliveredSp` integer; `deliveredSpCorrected` integer nullable;
`committedFrozenAt` timestamp nullable; `state` `sprintState`;
`finalizedAt` timestamp nullable; `measuredAt`, `createdAt`, `updatedAt`.
`unique(ownerId, jiraSprintId)` — the ON CONFLICT key the sweep depends on, so
both columns are NOT NULL (`lessons.md` #1). Index
`(ownerId, jiraProjectId, startDate)` for the series read.

#### 2. Capacity for an arbitrary sprint

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: `getSprintCapacity` is pinned to `getActiveSprintRow` (`:151`), so no
function in the system can answer "capacity in sprint N−3". The sweep needs to
measure a sprint that has just closed.

**Contract**: extract `getSprintCapacityFor(db, ownerId, sprintRow)`;
`getSprintCapacity` becomes a thin wrapper resolving the active sprint first.
No behaviour change for existing callers.

#### 3. The sweep

**File**: `src/lib/measurement/sweep.ts` (new)

**Intent**: Write the record from a periodic sweep, never from
`reconcileActiveSprint`'s `switched` flag. A hook means a stalled cron or an
expired token at the moment of rollover loses that sprint permanently — the
exact silent loss the framing named as the substance of the problem. A sweep
delays the record instead of losing it.

**Contract**:
`sweepSprintMeasurements({ db, ownerId, now }): Promise<{ upserted: number; finalized: number }>`.
For every `sprint` row of the owner: upsert a measurement keyed on
`(ownerId, jiraSprintId)`. Computed columns are refreshed **only while
`finalized_at IS NULL`**; `finalizedAt` is stamped when the sprint's `state` is
`CLOSED` (or its `endDate` has passed), which is what freezes the record. The
override and correction columns are **never** written by the sweep. Idempotent:
a second run in the same cycle changes nothing.

**Where each column's value comes from (plan review F2).** The sweep measures
sprints that may already have closed, so the source of each number matters more
than the arithmetic:

- `capacityFullMd` / `capacityAdjustedMd` / `workingDays` —
  `getSprintCapacityFor(db, ownerId, sprintRow)` (§2 above).
- `committedSp` — **copied** from `sprint.committed_sp`, which Phase 3 §4 froze
  at the first cycle that saw the sprint. It must NOT be recomputed:
  `jira_ticket` is unique on `(owner_id, jira_key)` and `run-sync` overwrites
  `sprint_id` on conflict (`schema.ts:614`, `run-sync.ts:768`), so a carried-over
  ticket has been re-stamped into the *next* sprint and a
  `where sprint_id = N` sum silently loses it. `committedFrozenAt` is copied
  alongside, so a late freeze stays visible on the record too.
- `deliveredSp` — **recomputed**, not copied, using Phase 3's
  `firstDoneAtByTicket` / `computeDeliveredSp` over `jira_status_history`
  restricted to first-DONE instants inside `[sprintStart, sprintEnd]`. The join
  is on `jira_status_history.ticket_id`, which is stable, and is **not** filtered
  by `jira_ticket.sprint_id` — that is what makes it survive the re-stamp. Under
  one monitored Jira project a ticket whose first DONE falls in this sprint's
  window belongs to this sprint, so the window alone is a sufficient predicate.

Copying `sprint.completed_sp` instead would reintroduce the loss the sweep exists
to prevent: `run-sync.ts:817-831` writes the two scalars only for `chosenSprint`,
i.e. the sprint Jira currently reports as active, so after a rollover sprint N's
scalar is frozen at whatever the last cycle before the flip happened to see. A
cron stalled across the rollover would then record a stale delivered figure while
integration test 4.2 still passes — 4.2 asserts the row *exists*, not that its
number is right. Recomputing from the history closes that gap, and it is the
same primitive the burndown already uses, so the two surfaces cannot drift.

#### 4. Call sites

**File**: `src/lib/integrations/sync/scheduled.ts`,
`src/lib/integrations/sync/actions.ts` (`:91`)

**Intent**: The sweep must run whether or not the Jira pull succeeded — a sprint
that closed while the token was expired still has to be recorded once the token
is fixed. So it sits beside `detectAnomalies`, after the per-owner sync, in the
same best-effort try/catch shape.

**Contract**: called per owner in the cron loop and after a manual sync;
failures are swallowed and logged, never surfaced as a failed sync.

#### 5. Reader

**File**: `src/lib/measurement/reader.ts` (new)

**Intent**: The series every later phase reads, filtered to the current Jira
project so an average never mixes two teams.

**Contract**:
`listSprintMeasurements(db, ownerId, jiraProjectId, limit?): Promise<SprintMeasurement[]>`,
newest first, numerics converted to `number` at the boundary. Finalized rows
only for the history series; the active sprint's row is read separately.

### Success Criteria:

#### Automated Verification:

- Integration test: closing a sprint and running the sweep writes exactly one record; running the sweep again changes nothing (idempotence): `npm run test:integration`
- Integration test: a sweep that first runs three cycles *after* the rollover still records the closed sprint (the loss the hook design would have caused)
- Integration test: deleting the owner's `jira_project` row cascades away the `sprint` rows and leaves the measurement rows intact
- Integration test: a finalized record's computed columns do not move on subsequent sweeps
- Integration test: a ticket carried over into sprint N+1 (so its `jira_ticket.sprint_id` now names N+1) whose first DONE falls inside sprint N still counts in N's `delivered_sp`, and a sweep run after the rollover produces the same figure as one run before it
- Unit tests for the sweep's pure decision (`shouldFinalize`, `shouldRecompute`): `npm test`
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- After the real sprint in the FM project rolls over, a row appears in `sprint_measurement` with a capacity and a delivered figure that match what the dashboard showed on the sprint's last day
- Switching the monitored Jira project in settings and switching back leaves the record in place

**Implementation Note**: Pause for manual confirmation before proceeding. This
is the last phase of the write path — after it, history accumulates whether or
not phases 5–7 ship.

---

## Phase 5: The lead's override and correction

### Overview

Two marked manual entries: a per-sprint capacity override in MD (FR-022) and a
correction to delivered SP (FR-023). Both sit **at the sprint**, not in the
roster — the roster holds stable facts about people, capacity is an artefact of
a sprint.

### Changes Required:

#### 1. Store

**File**: `src/lib/measurement/overrides.ts` (new)

**Intent**: Write the two lead-owned columns without touching the computed ones,
so a correction stays visible *as* a correction rather than replacing the
measurement.

**Contract**: `setCapacityOverride({db, ownerId, jiraSprintId, md | null})` and
`setDeliveredCorrection({db, ownerId, jiraSprintId, sp | null})`. If no record
exists yet for the active sprint, the write creates one — carrying the NOT NULL
`ownerId` / `jiraProjectId` / `jiraSprintId` and leaving the computed columns for
the sweep's next pass, which is free to fill them because `finalized_at` is still
NULL. Passing `null` clears the override and restores the computed value. Both
are owner-scoped in the `WHERE`.

**And the matching read (plan review F6).** The write path alone leaves the
override invisible: the Availability tab's number comes from `getSprintCapacity`
(`dashboard/page.tsx:69`) and the Reliability panel's props from the `sprint`
scalars — neither has ever touched `sprint_measurement`. Add
`getActiveSprintMeasurement(db, ownerId): Promise<SprintMeasurement | null>`
beside the two writers (reusing `reader.ts`'s numeric conversion) and **join it
to the existing `Promise.all`** in `dashboard/page.tsx` — one request-scoped
`getDb` handle, no second fan-out (`lessons.md` #3). It is the same read Phase 6
§1 needs for `capacityOverridden`, so it is added once here rather than twice.

#### 2. Surface

**File**: `src/components/organisms/dashboard/capacity-adjustments.tsx` (new),
`src/components/organisms/dashboard/availability.tsx`,
`src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dashboard/actions.ts`

**Intent**: The Availability tab already answers "what is this sprint's capacity
and who is away"; the override belongs where the number it replaces is shown.
An overridden sprint must read as overridden — FR-022 makes it a marked
exception because an overridden figure feeds FR-024's normalisation and a
careless entry there skews every later average.

**Contract**: an MD input with the computed value as placeholder and a "Reset to
computed" action; when set, the headline shows the override with a badge and the
computed figure beneath it. The delivered-SP correction follows the same shape.
Server actions mirror the absences pattern (`requireSession` → `getDb` →
service).

#### 3. Validation

**File**: `src/lib/validations/measurement.ts` (new)

**Contract**: capacity override — non-negative, at most two decimals, bounded to
a sane ceiling; delivered correction — non-negative integer. Both nullable to
express "cleared".

### Success Criteria:

#### Automated Verification:

- Integration test: setting an override does not change `capacity_adjusted_md`, and clearing it restores the displayed value to the computed one: `npm run test:integration`
- Integration test: a sweep after an override leaves the override untouched
- Integration test: an override written for another owner's sprint id is rejected
- Integration test: `getActiveSprintMeasurement` returns the override as a `number`, not the `pg` driver's `numeric` string, and returns `null` when no record exists yet
- Unit tests for the validation schemas: `npm test`
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- Entering an override on the Availability tab shows the badge and the computed value underneath; reloading keeps both
- Clearing the override returns the headline to the computed number

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: The relation, and the estimate

### Overview

Put capacity beside reliability so the owner's two 100% cases stop rendering
identically, and compute FR-024's estimated velocity from the history Phase 4
has been accumulating.

### Changes Required:

#### 1. Capacity beside reliability

**File**: `src/components/organisms/dashboard/reliability-kpi-view.ts` (new),
`src/components/organisms/dashboard/reliability-kpi.tsx` (`:31-37,61`),
`src/app/(app)/dashboard/page.tsx`

**Intent**: The panel takes exactly two scalars and therefore cannot tell a full
team's 100% from a half team's 100%. Capacity is the context that makes the
ratio interpretable — FR-016 is explicit that it does **not** enter the ratio.
Also fix the empty-state copy: "fills in after the next sync" is wrong for "no
history yet", which no sync fixes.

**Contract**: new props `capacityAdjustedMd`, `capacityFullMd`, `workingDays`,
`capacityOverridden`. Rendered as a second line —
`Reliability 100% · Capacity 60 of 120 MD` — never folded into the percentage.

The ratio moves out of the `.tsx` into a pure `reliability-kpi-view.ts` sibling
(plan review F4): there is **no component-test harness** in this repo — both
vitest projects run `environment: "node"` and neither jsdom nor RTL is
installed (`CLAUDE.md`) — so a criterion asserting the ratio is unchanged is
unrunnable while the arithmetic lives inline at `reliability-kpi.tsx:61`. The
house pattern for exactly this already exists three files away
(`availability-view.ts`, `activity-matrix-view.ts`, `aging-report-controls.ts`).
`toReliabilityView({ committedSp, completedSp, capacityAdjustedMd,
capacityFullMd, workingDays, capacityOverridden })` returns the ratio, the
empty-state flag and the capacity line; the component renders what it returns.

#### 2. The estimate

**File**: `src/lib/measurement/estimate.ts` (new)

**Intent**: FR-024, two divisions over measured history. Each past sprint's
velocity is normalised up to full capacity before averaging; the average is then
scaled by a capacity ratio.

**Which sprint the ratio is taken over (plan review F1).** The ratio is the
**currently active sprint's** `adjusted ÷ full`, not a future sprint's. SprintFlow
cannot see a future sprint at all — the Jira issue search filters `state=active`
and `getSprintCapacity` resolves `getActiveSprintRow` (`capacity.ts:151`), so a
sprint that has not started has no row, no working-day count and no absences to
subtract. That is roadmap **S-18**'s slice, explicitly parked as post-MVP
("revisit after S-23, which makes the next window's capacity computable"), and
this slice does not reach into it. It is also the owner's own formula as
recorded at `roadmap.md:744` — `average(normalised velocity) × capacity_current
÷ capacity_full`. PRD FR-024's "next sprint" wording is the outlier and is
amended in Phase 1 §1.

**Contract**:
`estimateNextSprintVelocity(records, current: { adjustedMd: number; fullMd: number })
→ { estimateSp: number; averageNormalisedSp: number; sampleSize: number; ratio: number } | null`.
Normalised velocity of a record is `delivered ÷ (adjusted ÷ full)`, using the
corrected delivered figure when one exists and the override when one exists.
Records with `adjustedMd === 0` are skipped (an unmeasurable sprint, not a zero
one).

**Minimum sample size is two (plan review F8).** Returns `null` whenever fewer
than `MIN_SAMPLE_SIZE = 2` finalized records survive the filters — FR-023's
honest "no data" rule applies here first, and one sprint is not an average: a
single record would present the last sprint's velocity as a trend, which is the
gadget the owner's own scope note rejected (`planning-notes.md` §2). The
constant is exported so the panel's copy names the same number the reducer
enforces, rather than the two drifting.

#### 3. Surface

**File**: `src/components/organisms/dashboard/velocity-estimate.tsx` (new),
`src/app/(app)/dashboard/page.tsx`

**Intent**: FR-024 requires the estimate to appear together with the numbers it
came from and to be presented as a suggestion. Both guards are what keep it
arithmetic over measured history rather than a forecast.

**Contract**: renders the estimate, the sample size, the average normalised
velocity and the capacity ratio it was scaled by; the copy names the sprint the
ratio was taken over, so "estimate" never reads as a claim about a sprint the
system cannot see. When the estimate is `null`, states plainly how many
closed sprints it has and how many it needs (`MIN_SAMPLE_SIZE`, i.e. two) —
never a number. The `current`
argument comes from the `getSprintCapacity` result **already** in
`dashboard/page.tsx:69`'s `Promise.all` — the estimate adds only the
`listSprintMeasurements` read to it, one `getDb` handle, no second fan-out
(`lessons.md` #3).

### Success Criteria:

#### Automated Verification:

- Unit tests for `estimateNextSprintVelocity`: the FR-024 worked example (200 MD full, 180 MD adjusted on the active sprint, 100 SP average → 90 SP); empty history returns `null`; **one** finalized record also returns `null` and two returns a number (the F8 boundary); a zero-capacity record is skipped, not divided by; a corrected delivered value is preferred over the computed one: `npm test`
- Unit test on `toReliabilityView`: the ratio is unchanged by the capacity fields (capacity is not in the divisor), and the empty state still triggers only on a NULL scalar: `npm test`
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- With fewer than two closed sprints, the estimate panel says how many it has and that it needs two — it does not show a number
- The Reliability panel shows the capacity line, and the percentage is identical to what it was before the props were added

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 7: Sprint switcher on Sprint Detail

### Overview

Somewhere to look at closed sprints and compare them. Deliberately last and
deliberately cuttable: there is nothing to show before two sprints have closed,
so its position at the end costs nothing.

### Changes Required:

#### 1. Unpin the page from the active sprint

**File**: `src/app/(app)/dashboard/sprint-detail/sprint-selection.ts` (new),
`src/app/(app)/dashboard/sprint-detail/page.tsx`

**Intent**: The page resolves `getActiveSprintRow` and nothing else. A
`?sprint=` parameter lets it render a closed one. The three-way decision below
lives in a pure `sprint-selection.ts` sibling, not in the server component —
same reason as Phase 6 §1 (plan review F4): there is no component-test harness,
so logic that must be asserted is extracted to a `.ts` file first.

**Contract**: reads `searchParams.sprint` (a `jira_sprint_id`) and resolves it
**against `sprint_measurement` first**, then looks up the matching owner-scoped
`sprint` row separately. Three outcomes, and they are not the same (plan review
F3):

| `?sprint=` resolves to | Render |
| --- | --- |
| measurement **and** `sprint` row | the sprint, all tabs |
| measurement, **no** `sprint` row | the sprint's headline figures + §3's notice |
| neither (absent or unknown id) | the active sprint |

Falling back to the active sprint on a missing `sprint` row — the shape the
first draft implied — is the bug this table exists to prevent: a sprint from
before a Jira-project switch has had its `sprint` row cascade-deleted
(`connection-service.ts:405-411`, `jira-store.ts:255-259`) while its measurement
survives by design, so the page would silently render **the active sprint's
numbers under a switcher entry naming the old one**, and §3's notice would be
unreachable in exactly the case it was written for.

#### 2. The switcher

**File**: `src/components/organisms/dashboard/sprint-switcher.tsx` (new)

**Intent**: The list comes from `sprint_measurement` filtered to the current
Jira project, so it can name sprints whose raw data retention has already
purged.

**Contract**: a `Select` of sprints newest first, navigating to
`?sprint=<jiraSprintId>`.

#### 3. Say what is missing, out loud

**File**: `src/app/(app)/dashboard/sprint-detail/page.tsx`,
`src/components/organisms/dashboard/sprint-detail-tabs.tsx`

**Intent**: The three reducers (aging, activity matrix, burndown) read raw
synced data bounded to "current + 2 sprints", so an older sprint renders
**correct headline numbers beside empty detail tabs**. This was chosen with the
warning understood; the screen must state it rather than let it read as a bug.
Right after a Jira-project switch the history is empty despite rows existing,
for the same reason — also worth a line.

**Which of the two paths is exercisable today (plan review F7).** The
"current + 2 sprints" purge is **not implemented yet** — nothing in `src/lib`
deletes aged product data — so the retention half of this notice cannot be
triggered on a real account and must be covered by an integration test that
deletes the rows directly. The Jira-project-switch half *is* live (the cascade
at `connection-service.ts:405-411`), and it is the path the manual row uses.

**Contract**: when the selected sprint has a measurement record but no raw data,
the tabs render an explicit notice naming the reason — retention, or a
Jira-project switch — not a generic empty state. This is row 2 of §1's table, so
the two sections share one condition rather than each guessing at it.

### Success Criteria:

#### Automated Verification:

- Unit test for `sprint-selection.ts`, one case per row of §1's table (absent param → active; unknown id → active, not a crash; measurement without a `sprint` row → that sprint plus the notice, NOT the active sprint): `npm test`
- Integration test: the switcher's list is scoped to the owner and to the current `jira_project_id`: `npm run test:integration`
- Type checking and linting pass: `npm run typecheck`, `npm run lint`

#### Manual Verification:

- Switching the monitored Jira project away and back, then selecting a sprint recorded before the switch: its capacity, velocity and reliability still render, and the aging/matrix/burndown tabs show the notice naming the project switch — **not** the active sprint's data (this is the live path; the retention path has no purge to trigger it yet, so it is covered by an integration test instead)
- The URL is shareable — reloading `?sprint=<id>` lands on the same sprint

**Implementation Note**: Final phase. After manual confirmation, the slice is
complete.

---

## Testing Strategy

### Unit Tests:

- `fte.ts` — the `numeric`-as-string boundary in both directions, unparseable input, the four legal choices
- `capacity.ts` — `fte × availableDays` for mixed fractions; a holiday costing one MD per person; a holiday inside an absence not double-subtracted; zero working days
- `first-done.ts` / `computeDeliveredSp` — reopen-and-reclose counts once; closed after sprint end excluded; carried-in already-done excluded; unestimated contributes 0
- `extractStoryPoints` — rounding, non-finite, null
- `estimate.ts` — the FR-024 worked example, empty history, the one-vs-two sample boundary (F8), zero-capacity record, corrected-over-computed precedence; the ratio is the ACTIVE sprint's (F1)
- Aging and sprint-at-risk detectors with a non-empty `nonWorkingDays`
- `reliability-kpi-view.ts` and `sprint-selection.ts` — the two pure siblings F4 adds, because there is no component-test harness (`CLAUDE.md`)

### Integration Tests:

- Roster save with no changes performs zero updates (the `numeric` `===` trap)
- Migration `0012` leaves `fte_confirmed_at` NULL for pre-existing rows
- `committed_sp` frozen at first sighting, unchanged by a later scope addition, `committed_frozen_at` stable
- `added_after_sprint_start` from the `Sprint` changelog, both branches plus the fallback
- Sweep idempotence; late sweep still records AND records the right delivered figure (F2); finalized record immutable; overrides survive a sweep
- `sprint_measurement` survives a Jira-project switch that cascades `sprint` rows away
- Owner-scoping on every new store function

### Manual Testing Steps:

Rows land in `context/changes/capacity-in-man-days/MANUAL-CHECKLIST.md`, 3–5 per
phase, each carrying where / what to do / what must be true / why it matters, per
`CLAUDE.md`. The prerequisite is **manual-test-backlog row 1.8** — SP estimates
must be entered in the FM Jira project, which today has all `story_points =
NULL`. Without it the capacity↔velocity relation has nothing to measure on live
data, so Phase 3's manual rows cannot be judged.

## Performance Considerations

The sweep runs per owner per cycle and touches one row per sprint — a handful of
rows at the PRD's 3–10-person, one-project scale. It reuses the cron loop's
existing pooled handle (`getDbWithPool`), adding no second fan-out. The
dashboard's new reads join the existing `Promise.all` on the one request-scoped
handle; nothing new opens a pool (`lessons.md` #3).

## Migration Notes

- **`sp_capacity` values are destroyed, by necessity.** An `8` is
  indistinguishable as 8 SP and 8 FTE. Every member becomes full-time
  (`DEFAULT 1.00`), which silently inflates capacity for any team with
  part-timers — the `/settings/team` banner exists solely to make that visible
  and is not optional.
- **No backfill of historical sprints.** The series begins at the first sprint
  closed after Phase 4 ships. Sprint rows themselves date only from S-16
  (2026-08-26), and the roster has no time dimension, so anything earlier is
  unreconstructable.
- **Rollback**: phases 1–4 each add exactly one migration; reverting a phase
  means reverting its migration and its code together. Phase 1's is not
  reversible in data terms — the dropped column's values are gone.

## References

- Frame brief: `context/changes/capacity-in-man-days/frame.md`
- Planning decisions (binding): `context/changes/capacity-in-man-days/planning-notes.md`
- Domain notes: `context/foundation/capacity-model-notes.md`
- Recurring rules: `context/foundation/lessons.md` (#1 NOT NULL dedup key, #3 pool teardown, #5 delete-then-insert, #6 narrowing predicate)
- Current capacity reducer: `src/lib/dashboard/capacity.ts:68-128,147-200`
- The correct DONE primitive: `src/lib/dashboard/burndown-series.ts:135-153`
- Sprint scalars write: `src/lib/integrations/sync/run-sync.ts:748-749,770-772,817-831`
- Rollover hook: `src/lib/integrations/reconcile-sprint.ts:265-274,288`
- The empty seam: `src/lib/anomaly/rules/helpers.ts:78-128`
- Freeze precedent: `daily_recap.payload` (`src/db/schema.ts:757`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Availability fraction replaces story-point capacity

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — f3207db
- [x] 1.2 No `spCapacity` / `sp_capacity` references outside `src/db/migrations/` — f3207db
- [x] 1.3 Unit tests pass, including `fte.ts` string→number boundary — f3207db
- [x] 1.4 Integration test: unchanged roster save performs zero updates — f3207db
- [x] 1.5 Type checking passes — f3207db
- [x] 1.6 Linting passes — f3207db

#### Manual

- [ ] 1.7 `/settings/team` banner names the defaulted members and stays gone after confirming
- [ ] 1.8 Availability select offers four options; 0.5 survives a reload
- [ ] 1.9 Availability tab shows MD equal to Σ fte × working days

### Phase 2: Team days off, and the empty seam wired at all five sites

#### Automated

- [ ] 2.1 Unit tests: holiday costs one MD per full-time member; not double-subtracted inside an absence
- [ ] 2.2 Unit tests: aging does not advance across a team day off; sprint-at-risk working days drop
- [ ] 2.3 Integration test: `getNonWorkingDays` owner-scoped; duplicate insert is a no-op
- [ ] 2.4 Every production `countWorkingDays*` call site passes `nonWorkingDays`
- [ ] 2.5 Type checking passes
- [ ] 2.6 Linting passes

#### Manual

- [ ] 2.7 Adding a holiday lowers capacity by one MD per full-time member and the working-day count by one
- [ ] 2.8 The same holiday stops a ticket's aging clock
- [ ] 2.9 Removing the day off restores both numbers

### Phase 3: Honest sprint sums

#### Automated

- [ ] 3.1 Unit tests: `0.5` → `1`, non-finite → `null`
- [ ] 3.2 Unit tests for `computeDeliveredSp` (reopen, late close, carried-in, unestimated)
- [ ] 3.3 Integration test: committed SP frozen; `committed_frozen_at` stable
- [ ] 3.4 Integration test: `added_after_sprint_start` from the `Sprint` changelog, both branches + fallback
- [ ] 3.5 Integration test: `completed_sp` unchanged by a post-`endDate` cycle
- [ ] 3.6 Type checking passes
- [ ] 3.7 Linting passes
- [ ] 3.11 Unit test: the changelog item matches by `fieldId` on a non-English display name

#### Manual

- [ ] 3.8 Real sync writes `committed_sp` / `completed_sp` matching Jira (needs backlog row 1.8)
- [ ] 3.9 Adding a mid-sprint ticket does not raise the committed figure
- [ ] 3.10 A 0.5 estimate in Jira no longer wedges the sync

### Phase 4: The per-sprint measurement record

#### Automated

- [ ] 4.1 Integration test: sweep writes one record; re-running changes nothing
- [ ] 4.2 Integration test: a sweep three cycles late still records the closed sprint
- [ ] 4.3 Integration test: project deletion cascades `sprint` rows, leaves measurements intact
- [ ] 4.4 Integration test: finalized record's computed columns do not move
- [ ] 4.5 Unit tests for `shouldFinalize` / `shouldRecompute`
- [ ] 4.6 Type checking passes
- [ ] 4.7 Linting passes
- [ ] 4.10 Integration test: a re-stamped carried-over ticket still counts in the closed sprint's `delivered_sp`

#### Manual

- [ ] 4.8 After a real rollover, the record matches the sprint's last-day dashboard figures
- [ ] 4.9 Switching the Jira project away and back leaves the record in place

### Phase 5: The lead's override and correction

#### Automated

- [ ] 5.1 Integration test: override leaves the computed capacity untouched; clearing restores it
- [ ] 5.2 Integration test: a sweep after an override leaves the override untouched
- [ ] 5.3 Integration test: cross-owner override is rejected
- [ ] 5.4 Unit tests for the validation schemas
- [ ] 5.5 Type checking passes
- [ ] 5.6 Linting passes
- [ ] 5.9 Integration test: `getActiveSprintMeasurement` converts numerics and returns `null` with no record

#### Manual

- [ ] 5.7 Override shows the badge with the computed value beneath; survives a reload
- [ ] 5.8 Clearing the override returns the headline to the computed number

### Phase 6: The relation, and the estimate

#### Automated

- [ ] 6.1 Unit tests for `estimateNextSprintVelocity` (worked example, empty, zero-capacity, corrected-over-computed)
- [ ] 6.2 Unit test on `toReliabilityView`: the ratio is unchanged by the capacity fields
- [ ] 6.3 Type checking passes
- [ ] 6.4 Linting passes

#### Manual

- [ ] 6.5 With fewer than two closed sprints the estimate panel names the shortfall, not a number
- [ ] 6.6 Reliability shows the capacity line; the percentage is unchanged

### Phase 7: Sprint switcher on Sprint Detail

#### Automated

- [ ] 7.1 Unit test for `sprint-selection.ts`, one per row of §1's table (absent / unknown / measurement-without-sprint-row)
- [ ] 7.2 Integration test: switcher list scoped to owner and current Jira project
- [ ] 7.3 Type checking passes
- [ ] 7.4 Linting passes

#### Manual

- [ ] 7.5 A pre-project-switch sprint shows its figures; detail tabs show the notice, not the active sprint's data
- [ ] 7.6 `?sprint=<id>` is shareable and survives a reload
