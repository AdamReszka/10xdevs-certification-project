# Absence Calendar (S-08 / FR-010) Implementation Plan

## Overview

Make absences first-class data: a surface to record them, and the three downstream
calculations FR-010 requires — `DEVELOPER_INACTIVE` suppression, a `SPRINT_AT_RISK`
signal for unplanned mid-sprint absences, and a sprint-capacity number that finally
gives `team_member.sp_capacity` a reader.

## Current State Analysis

The `absence` table shipped in F-02 and has **never been written to** — verified
`select count(*) from absence` → 0, and nothing in `src/` inserts. Its three consumers
are in three different states:

- **Suppression**: the seam was cut deliberately in S-06.
  `src/lib/anomaly/load-snapshot.ts:78` hardcodes `absences: []`, and
  `src/lib/anomaly/types.ts:45` already types the field correctly.
  `src/lib/anomaly/rules/developer-inactive.ts:11-13` reserves the slot in prose.
- **`SPRINT_AT_RISK`**: no absence handling of any kind
  (`src/lib/anomaly/rules/sprint-at-risk.ts`), and no headroom to add weight — its
  default severity is already `HIGH` (`src/db/defaults.ts:64-65`) and the
  `todo_near_end` condition already reaches `magnitude: 1`. See *Implementation
  Approach*.
- **Capacity**: does not exist. `sp_capacity` is written by the roster editor and read
  by nothing (`src/lib/roster.ts:66` exposes it on the editor projection only; the
  dashboard reader does not select it).

Two shared constraints discovered during research:

- `countWorkingDays` (`src/lib/anomaly/rules/helpers.ts:60-79`) is the only working-day
  math in the repo and is **server-local** — `cursor.setHours(0,0,0,0)` and
  `cursor.getDay()`, no timezone parameter. Every dashboard day axis instead goes
  through the zone-aware `src/lib/dashboard/day-bucket.ts` family keyed on
  `jira_project.time_zone`. On Workers the server is UTC so they agree today; a Warsaw
  absence would not.
- S-08 is the first slice to arm the S-15 delete gate for real. Once one absence
  exists, `getMemberHistory` (`src/lib/integrations/roster-store.ts:542-579`) returns a
  non-zero count and the "Delete permanently" option disappears for that member
  (`src/components/organisms/setup/roster-editor.tsx:761-789`). Correct behaviour,
  newly reachable.

## Desired End State

The owner can record, edit and remove per-member absences from
`/settings/absences`, and see who is away — this sprint and the next equivalent window
— from a tab on Dashboard "Today". A recorded absence immediately silences that
member's `DEVELOPER_INACTIVE`; an unplanned mid-sprint one raises a distinct
`SPRINT_AT_RISK` anomaly sized by the working days it costs; and the sprint's capacity
number drops accordingly.

Verified by: `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`,
a production build listing `/settings/absences`, and the manual rows in Phase 6.

### Key Discoveries

- `src/lib/anomaly/load-snapshot.ts:78` — `absences: []` is the entire load-side change.
- `src/lib/anomaly/detect.ts:121-129` — detection is a *reconcile*: a `dedupKey` that
  stops being emitted is flipped to `RESOLVED`, so suppression removes the row from the
  inbox with no extra work. But it only runs on the cron cycle or `syncNow` — hence D1.
- `src/lib/integrations/roster-store.ts:388-445` — `saveRoster`'s differential upsert,
  including `UnknownMemberError` for foreign ids and the redundant-but-kept
  `AND owner_id = ?`. The absence store copies the isolation rules, not the diffing:
  `absence` has no hand-entered children, so single-row CRUD is honest here.
- `src/lib/integrations/roster-store.integration.test.ts:860-872` — an `addAbsence`
  helper already exists and is directly reusable.
- `src/components/organisms/dashboard/today-tabs.tsx:32-40` — Dashboard "Today" is
  already a four-tab shell. FR-016 is explicit that panels sit behind tabs so the inbox
  stays the headline, so the availability view is a **fifth tab**, not a always-on card.
- `@shadcn/calendar` pulls **`react-day-picker` and `date-fns`** (confirmed via the
  shadcn registry); `popover` and `dialog` need only `radix-ui`, already installed.

## What We're NOT Doing

- **No public-holiday or company-day-off calendar.** Phase 3 builds the seam (a
  non-working-days set) and passes it empty. Polish holidays plus per-sprint custom days
  off become their own roadmap slice — they need a country signal the app does not have
  today (only `jira_project.time_zone`), new data, new UI and new tests.
- **No next-sprint capacity forecast.** The widget shows *who is away* in the next
  window; it does not compute that window's capacity number. Deferred to its own slice.
- **No `/team` navigation section.** Recorded in the roadmap as a future navigation
  refactor. Moving `/settings/team` now would invalidate S-15 manual rows 5.3/5.4, which
  are still unticked.
- **No per-member working-day patterns and no `fte` column.** `sp_capacity` is defined by
  FR-006 as capacity *per sprint*, so a part-timer's number is already reduced; adding an
  FTE multiplier would double-count. The roster editor gets a hint instead.
- **No component-test harness.** No jsdom, no RTL — pure logic is extracted to `.ts`
  siblings, per `context/foundation/test-plan.md:126-128`.
- **No change to `absence.team_member_id`'s `ON DELETE CASCADE`**, and no regression of
  `saveRoster` to delete-then-insert (`context/foundation/lessons.md`).

## Implementation Approach

**Suppression is a guard inside the rule, not a pre-filter.** `snapshot.teamMembers` is
shared by five other detectors that `indexBy` it for `relatedTeamMemberId` attribution;
removing an absent member from that array would silently strip attribution from
unrelated anomalies. The guard also needs the rule's own evaluation window, which only
the rule knows.

**`SPRINT_AT_RISK` gets a third condition, not a heavier weight.** The FR says an
unplanned absence "raises the sprint-risk score", but the per-anomaly score is
`WEIGHT[severity] × magnitude × 100/3` (`src/lib/anomaly/risk-score.ts:14-20`) and the
rule is already `HIGH` with conditions that reach `magnitude: 1`. There is nothing to
raise. Emitting an additional anomaly with its own `dedupKey` is the only mechanism that
reliably increases the risk the lead actually sees, and it matches the rule's documented
one-anomaly-per-condition contract (`sprint-at-risk.ts:20-28`).

**`date-fns` arrives as a dependency of the calendar primitive, but our own date logic
stays on `day-bucket.ts`.** Two idioms for the same problem is how day axes drift; the
zone-aware family is already the house convention and is what the rest of the dashboard
agrees on.

## Critical Implementation Details

**Timing & lifecycle (D1).** Every **absence mutation** re-runs detection. The rule is
scoped to this slice's own writes on purpose: `saveRoster` is also anomaly-affecting —
deactivating a member changes `DEVELOPER_INACTIVE`, and deleting one cascades their
absences away (`schema.ts:446-448`) — but *What We're NOT Doing* forbids touching it here,
so roster saves keep waiting for the cron cycle. That is a known, accepted gap, not an
oversight; a future slice can widen D1 to "every save of an anomaly-affecting factor" once
`saveRoster` is in scope. The re-detect must fire **after the write transaction commits** and be
wrapped in `try/catch` so a failed detection never fails the save — the precedent is
`syncNow` (`src/lib/integrations/sync/actions.ts:77`). Note the cost: `loadSprintSnapshot`
issues five selects, so this is not a free call inside a Server Action.

**State sequencing.** `roster-store.ts:49-52` requires every credentialed network read to
complete before any `db.transaction` opens, because a `fetch` inside a transaction pins a
Hyperdrive-backed `pg` connection for the network duration. S-08 makes no outbound calls,
but the re-detect must still sit outside the write transaction.

---

## Phase 1: Absence data layer

### Overview

The table, its validation, an owner-scoped store, and Server Actions that re-run
detection. No UI yet — Phase 2 mounts it.

### Changes Required:

#### 1. Close the `is_planned` tri-state

**File**: `src/db/schema.ts`, plus a generated migration under `src/db/migrations/`

**Intent**: `is_planned` is nullable with no default, but FR-010 keys `SPRINT_AT_RISK` off
"unplanned". NULL would mean only "the form did not ask" — a UI gap, not a domain fact.
The table holds zero rows, so this is the cheapest this change will ever be.

**Contract**: `absence.isPlanned` becomes `.default(true).notNull()`; `SelectAbsence.isPlanned`
narrows from `boolean | null` to `boolean`. Generate the migration with the project's
existing Drizzle workflow — do not hand-write SQL.

**`sprint_id` stays nullable, but S-08 starts writing it.** The column already exists
(`schema.ts:449-451`, FK to `sprint`, `ON DELETE CASCADE`) and no schema change is needed —
what was missing is a rule for filling it. Without one the column stays NULL forever and
`is_planned` becomes unmoored: D2 defines planned-ness *relative to a sprint* ("known
before sprint start"), so with no record of which sprint the judgement was made against, an
absence entered mid-sprint (unplanned) that spans into the next sprint keeps firing
`SPRINT_AT_RISK` after the rollover — when by D2's own definition it is planned there.
Rule: `createAbsence` stamps `sprintId` with the active sprint at the moment of recording,
or NULL when there is none; `is_planned` is judged against **that** sprint's start date;
and the Phase 4 condition only fires for an absence whose `sprintId` equals the snapshot's
sprint, so an absence carried into a later sprint stops raising risk on its own.

#### 2. Validation schemas

**File**: `src/lib/validations/absence.ts` (new)

**Intent**: One source of truth shared by the client form and server-side re-validation,
mirroring `src/lib/validations/roster.ts` — and, like it, **free of server-only imports**
so client modules can import it without dragging Node globals into the bundle.

**Contract**: `absenceTypeSchema` mirroring the `absence_type` pgEnum;
`absenceSaveSchema` with `teamMemberId`, `type`, `startDate`, `endDate`, `isPlanned`,
optional `id`; `absenceIdSchema`. One cross-field rule, and it is the only one zod can
carry here: `endDate >= startDate`. Dates cross the wire as `YYYY-MM-DD` day keys, not
instants (see Phase 1 item 4). `sprintId` is **not** on the wire — it is server-derived in
the store (item 1), so a client cannot pin an absence to a sprint of its choosing.

**Overlap is NOT a zod rule — it belongs to the store (item 3).** The roster precedent at
`validations/roster.ts:49-58` puts a cross-row constraint in zod only because
`rosterSaveSchema` receives the **whole** member array and its `superRefine` iterates
`value.members` (`roster.ts:60-63`). `absenceSaveSchema` carries a **single** absence, so a
`superRefine` over it has nothing to compare against. Overlap is a database question —
"does this member already have a window covering these days?" — and it is answered in
`createAbsence` / `updateAbsence` with the owner-scoped read those functions already
perform, which also makes it unbypassable by a crafted payload. On overlap the store throws
an `OverlappingAbsenceError` that the action maps to a field-level failure. The client-side
warning is a separate, advisory copy of the same predicate living in Phase 2's
`absence-calendar-view.ts` sibling, which already lists overlap detection among its pure
logic.

#### 3. Absence store

**File**: `src/lib/absence-store.ts` (new)

**Intent**: Owner-scoped CRUD. Unlike the roster, `absence` has no hand-entered children,
so single-row create/update/delete is honest — the differential-upsert idiom is not needed
here. What *is* copied verbatim from `roster-store.ts` is the isolation discipline.

**Contract**: `listAbsences({ db, ownerId, from, to })`, `createAbsence`, `updateAbsence`,
`deleteAbsence`, each owner-scoped. Two mandatory rules, both from
`context/foundation/lessons.md`: an id outside the caller's set throws (an
`UnknownAbsenceError` mirroring `UnknownMemberError` at `roster-store.ts:335`), and every
write carries `AND owner_id = ?` even where the prior check makes it redundant. Writes
must also verify the referenced `teamMemberId` belongs to the same owner — otherwise a
crafted payload could attach an absence to another account's member. Reads take
`db: Reader` (`roster-store.ts:63-71`) so they work on a pool or an open transaction.

This module also owns the **overlap** rule moved here from zod (see item 2): before
inserting or updating, select the member's other absences and throw an
`OverlappingAbsenceError` if any window shares a day — on update, excluding the row being
edited, so re-saving an unchanged window is not a self-collision. The action maps that
error to a field-level failure rather than the unexpected branch.

#### 4. Whole-day semantics

**File**: `src/lib/absence-dates.ts` (new)

**Intent**: An absence is a *date range*, but the columns are `timestamp`. Pin the mapping
once, here, so the calendar, the store and every consumer agree. `end_date` is
**inclusive** — a user picking 5–9 May is away through the whole of the 9th.

**Contract**: Conversion helpers between a `DayKey` (`YYYY-MM-DD`, the type already
defined in `src/lib/dashboard/day-bucket.ts`) and the stored instants, resolved in the
team's Jira timezone via `dayRangeInTimeZone`: `start_date` is the first instant of the
first absent day, `end_date` the last instant of the last absent day. Plus an
`overlaps(absence, from, to)` predicate — no such helper exists in the repo today.

#### 5. Server Actions

**File**: `src/app/(app)/settings/absences/actions.ts` (new)

**Intent**: One module owning every `absence` mutation, following the convention stated at
`src/app/(app)/setup/team/actions.ts:277-280`. Each action re-runs detection per D1.

**Contract**: `"use server"` at file top. `createAbsenceAction` / `updateAbsenceAction` /
`deleteAbsenceAction`, each taking `unknown`, `safeParse`ing inside, and returning the
house discriminated union on `ok` with the shared `ActionFailure` shape
(`setup/team/actions.ts:64-69`). Errors map through a local `toFailure(err, tag)` ladder
where **only the unexpected branch logs**. After the write commits, call `detectAnomalies`
in a `try/catch` that swallows failures — the save's result must not depend on it.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase
- `npm run typecheck` passes, and `SelectAbsence.isPlanned` is `boolean`
- `npm run lint` passes
- `npm test` passes, including new unit tests for `absence-dates.ts` and the zod schemas
- `npm run test:integration` passes, including: create/update/delete round-trip; a
  cross-owner sibling test proving a foreign absence id throws and leaves the victim row
  untouched; a test proving an absence cannot be attached to another owner's member; an
  overlap pair (a colliding window is rejected, and re-saving the edited row's own
  unchanged window is not); and a test proving a failed re-detect does not fail the save

#### Manual Verification:

- (none — no surface yet)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Absence management surface

### Overview

Add the three missing shadcn primitives and build `/settings/absences` — a team-wide
calendar plus add/edit/delete. After this phase absences can actually be entered.

### Changes Required:

#### 1. Install the missing primitives

**File**: `src/components/ui/calendar.tsx`, `popover.tsx`, `dialog.tsx` (generated)

**Intent**: None of the three exist. `alert-dialog` is present but is a destructive-confirm
shell with no close button or scrollable body — the wrong shell for a form.

**Contract**: `npx shadcn add calendar popover dialog`. Never re-run `shadcn init` —
`components.json` is already configured. This adds `react-day-picker` and `date-fns` to
`package.json`; both are expected, and `date-fns` is not to be used by our own date logic
(see *Implementation Approach*). The range picker is `mode="range"` on the single
`calendar` primitive — there is no separate range component in the registry.

#### 2. Register the tab

**File**: `src/app/(app)/settings/layout.tsx`

**Intent**: Make the surface reachable. The tab registry already reserves the next slot in
a comment for S-14.

**Contract**: One entry appended to `TABS` — `{ label: "Absences", href: "/settings/absences" }`.
Active styling is prefix-matched and needs no change
(`src/components/molecules/settings-tabs.tsx:26`).

#### 3. The page

**File**: `src/app/(app)/settings/absences/page.tsx` (new)

**Intent**: Server component that resolves the owner, loads the roster and the current
sprint's absences, and hands plain data to a client organism.

**Contract**: Copy the owner-resolution shape verbatim from
`src/app/(app)/settings/team/page.tsx:25-30` — `requireSession()`, `getCloudflareContext()`,
one `getDb(env)`. Do **not** re-declare `force-dynamic` or `requireSession` at page level;
both are inherited from `src/app/(app)/layout.tsx:9,22`.

#### 4. The editor organism

**File**: `src/components/organisms/settings/absence-editor.tsx` (new) plus a pure
`absence-calendar-view.ts` sibling

**Intent**: The calendar plus the add/edit/delete flows. Since there is no component-test
infrastructure, all decision logic — which days are covered, how rows map to calendar
cells, overlap detection for the client-side warning — lives in the `.ts` sibling so it
can be unit-tested, following `roster-merge.ts` / `inbox-controls.ts`.

**Contract**: `"use client"`. `react-hook-form` + `zodResolver(absenceSaveSchema)`.
Add/edit opens a `dialog` containing the range `calendar`, a member `select` and a type
`select`; delete routes through the existing
`src/components/molecules/confirm-dialog.tsx`, which names what it destroys. `is_planned`
renders as a checkbox whose default is derived from timing (D2) — pre-checked when the
absence starts before the active sprint's start, unchecked otherwise — and stays
user-overridable. Every control carries an `aria-label` so Playwright's `getByLabel` rule
holds. After a successful action call `router.refresh()`; there is no `revalidatePath`
anywhere in `src/`.

#### 5. Roster capacity hint

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: `sp_capacity` is about to become load-bearing for the first time. A part-timer's
value must already be their real per-sprint number — the capacity formula multiplies by
available working days and would double-count an extra FTE factor.

**Contract**: Helper text on the existing story-point capacity input (`:602-606`) stating
that the number is this person's realistic SP for a full sprint, part-time included.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`, `npm run lint`, `npm test` pass — including unit tests for
  `absence-calendar-view.ts` (day coverage, overlap detection, member row mapping)
- Production build succeeds and lists `/settings/absences` among the routes

#### Manual Verification:

- Recording a vacation for a member from `/settings/absences` persists across a refresh
- The delete dialog names the absence it is about to remove
- Editing a window changes it rather than creating a second row

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: One source of truth for working days

### Overview

Fix the timezone bug in `countWorkingDays` and give it the seam a future
holidays/company-days-off slice will fill. Shared foundation for Phases 4 and 5.

### Changes Required:

#### 1. Zone-aware working-day counter

**File**: `src/lib/anomaly/rules/helpers.ts`

**Intent**: The function counts days with `setHours(0,0,0,0)` and `getDay()` — server-local.
Every other day axis in the app buckets through the team's Jira timezone
(`src/lib/dashboard/day-bucket.ts:1-12`). Capacity is about to become its second caller;
two counters that disagree is the failure mode `context/foundation/lessons.md` already
records once.

**Contract**: `countWorkingDays(from, to, workingDays, timeZone, nonWorkingDays?)` —
iteration moves over `DayKey`s via `enumerateDayKeys` in the given zone rather than over
server-local `Date`s, and `nonWorkingDays` is an optional set of `DayKey`s excluded from
the count. S-08 passes it empty; the holidays slice fills it. The existing caller
(`src/lib/anomaly/rules/ticket-status-aging.ts:64`) passes the project timezone, which
means the snapshot must carry it — see item 2.

**Boundary semantics — do not lose these.** The function today counts days
**strictly after `from`, up to and including `to`** (`helpers.ts:55-56`, and the
`cursor.setDate(cursor.getDate() + 1)` before the loop at `:75`). That half-open range is
right for `TICKET_STATUS_AGING`, which measures elapsed time since a movement, and
**wrong** for both new callers, which count a **closed** range: an absence from Monday to
Friday is 5 working days, but `countWorkingDays(Mon, Fri)` returns 4. Left unaddressed the
off-by-one lands silently in the `SPRINT_AT_RISK` magnitude and in the capacity divisor,
and no existing test catches it (`helpers.test.ts:46` asserts the current semantics).

Make the boundary **explicit rather than implicit**: keep the aging rule's behaviour byte
for byte and give the two new callers a closed-range count — either a `boundary:
"exclusive-start" | "inclusive"` option on the shared function (default
`"exclusive-start"`, so `ticket-status-aging.ts:64` is unchanged) or a thin
`countWorkingDaysInclusive` wrapper over the same iteration. One implementation, two named
intents; never two counters. Whichever shape is chosen, the docstring must state both.

**Two test files break, not one.** Review the 10 `TICKET_STATUS_AGING` tests —
expectations that were implicitly UTC must become explicit about the zone. But
`countWorkingDays` also has **five direct assertions of its own** at
`helpers.test.ts:41-66`, and a required `timeZone` parameter breaks all five at compile
time. The blast-radius sweep found no other callers anywhere in `src/` or `test/`, so
those two files plus `ticket-status-aging.ts:64` are the complete list.

#### 2. Timezone on the snapshot

**File**: `src/lib/anomaly/load-snapshot.ts`, `src/lib/anomaly/types.ts`

**Intent**: Rules are pure and take only the snapshot, so the zone has to arrive that way.

**Contract**: `SprintSnapshot` gains a `timeZone: string | null` field, populated in
`loadSprintSnapshot` from `jira_project.time_zone` via the existing reader
(`src/lib/dashboard/time-zone-reader.ts:14-24`) and defaulted through `safeZone`.
`makeSnapshot` in `src/lib/anomaly/test-support.ts` gains the field.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including new boundary tests for `countWorkingDays`: a non-UTC zone
  where the server-local answer differs, an entry in `nonWorkingDays` reducing the count,
  and the existing Mon–Fri fallback still holding
- A test pinning **both** boundary semantics on the same Mon–Fri input: the
  exclusive-start count is 4 (unchanged, what `TICKET_STATUS_AGING` needs) and the
  inclusive count is 5 (what an absence spanning Mon–Fri costs)
- The 10 `TICKET_STATUS_AGING` tests and the 5 `countWorkingDays` assertions at
  `helpers.test.ts:41-66` both pass, with any changed expectation carrying a comment
  saying why the zone changed it
- `npm run test:integration`, `npm run typecheck`, `npm run lint` pass
- `npm run test:mutation` keeps the rules above the 70 break threshold

#### Manual Verification:

- (none — pure logic, covered by unit tests)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Wire absences into the anomaly engine

### Overview

The two FR-010 anomaly effects: suppression, and the new unplanned-absence condition.

### Changes Required:

#### 1. Load real absences

**File**: `src/lib/anomaly/load-snapshot.ts`

**Intent**: Replace the S-06 placeholder with a real read.

**Contract**: `absences: []` at `:78` becomes an owner-scoped select added to the existing
parallel query set, bounded to windows overlapping the sprint. Note there is **no
`(owner_id, …)` index on `absence`** — the only index is
`(team_member_id, start_date, end_date)` (`src/db/schema.ts:459-464`), so a member-keyed
shape is what the index supports.

#### 2. Suppress `DEVELOPER_INACTIVE`

**File**: `src/lib/anomaly/rules/developer-inactive.ts`

**Intent**: An absent developer with no commits is explained, not anomalous. FR-010 makes
suppression unconditional on absence type — planned or not.

**Contract**: A guard inserted between the `hasActiveWork` check (`:30`) and the commit
scan (`:32`), continuing when the member has an absence overlapping the rule's own
evaluation window `[now − noCommitDays, now]`. Placement matters: after the cheap ticket
filter, and inside the rule rather than as a roster pre-filter or a post-detection filter
(see *Implementation Approach*). Update the rule's docstring, which currently says
suppression is not wired.

#### 3. New `SPRINT_AT_RISK` condition

**File**: `src/lib/anomaly/rules/sprint-at-risk.ts`, `src/lib/anomaly/context.ts`,
`src/lib/anomaly/suggested-action.ts`, `src/db/defaults.ts`

**Intent**: An unplanned mid-sprint absence removes working days the commitment assumed
were available. Emitted as its own anomaly because the rule has no headroom to raise (see
*Implementation Approach*).

**Contract**: A third condition appended before `return out` at `:109`, firing for an
absence with `isPlanned === false` (strict, per the `scope-creep.ts:17` precedent) **whose
`sprintId` is the snapshot's sprint** (per Phase 1 item 1 — an absence carried over from an
earlier sprint was unplanned *there*, not here) and whose window overlaps
`[now, sprint.endDate]`. `dedupKey` keyed on the absence id so two
absences for one member produce two anomalies and a deleted absence resolves cleanly.
`relatedTeamMemberId` set to the absent member. `magnitude` is spelled out the way both
existing conditions spell theirs (`:70`, `:84-85`), not left to the implementer:

- **numerator** — working days the absence removes from the rest of the sprint: the
  **inclusive** count (Phase 3) over `[max(now, absence.startDate), min(absence.endDate,
  sprint.endDate)]` in the snapshot's zone.
- **denominator** — working days remaining in the sprint: the inclusive count over
  `[now, sprint.endDate]`.
- **zero-denominator fallback** — if the sprint has no working days left, `magnitude = 1`
  (an absence on the final day costs the whole of what is left), mirroring the
  `committed > 0 ? … : 1` guard at `:85`.
- **magnitude 0 still emits.** The lead needs to know someone is unexpectedly away even
  when it costs no working days — a Sat–Sun sickness that ends before Monday. The risk
  score simply reads 0. This is the deliberate opposite of suppressing the row.

Note what the denominator is **not**: the member's remaining assigned work. Tying the
sprint's risk to one person's ticket load would divide by zero for exactly the common case
(an absent developer often has nothing assigned) and would edge toward the per-developer
framing the PRD guardrail forbids. Clamp through `clamp01` regardless.

**The description names the days lost, never the absence type.** FR-018 puts every anomaly
into the Daily Recap email, so a `SICKNESS` absence would otherwise become health
information about a named person in outbound mail. "3 working days lost to an unplanned
absence" reads identically for the lead and leaks nothing; the type stays on
`/settings/absences`, where the owner entered it. This applies to the `description`, the
`suggestedAction` template and the `SprintAtRiskContext` variant alike — the context object
is serialized into the `anomaly` row and rendered as a chip, so putting the type there
leaks it just the same.

Needs a new variant in the
`SprintAtRiskContext` union (`context.ts:49-64`) plus its chip branch (`:194-200`), a new
`suggestedAction.sprintAtRiskAbsence` template, and any new threshold added to
`DEFAULT_THRESHOLDS.SPRINT_AT_RISK.thresholds` (`defaults.ts:66-72`) — note that override
merging is a **shallow** spread, so nested objects are replaced wholesale.

#### 4. Fixture builder

**File**: `src/lib/anomaly/test-support.ts`

**Intent**: Every rule test builds its world from this module.

**Contract**: A `makeAbsence(over: Partial<SelectAbsence> = {})` builder alongside the
existing makers, and `makeSnapshot` accepting absences. Keep it outside `rules/` so
Stryker does not mutate it (`:15-19`).

### Success Criteria:

#### Automated Verification:

- `npm test` passes with, per `context/foundation/test-plan.md:102`, a positive fixture
  that fires, a healthy fixture that stays silent, and boundary cases: absence covering
  only the first day of the window, only the last day, adjacent-but-not-overlapping, an
  unplanned absence stamped with an *earlier* sprint staying silent in this one, a
  weekend-only absence emitting at `magnitude: 0` rather than being suppressed, and a
  sprint with no working days left resolving to `magnitude: 1` instead of dividing by zero —
  with every expected output hand-derived from FR-010, never lifted from engine output
  (`test-plan.md:65`)
- `npm run test:integration` passes with a lifecycle test modelled on
  `detect.integration.test.ts:272-315`: detect → assert `DEVELOPER_INACTIVE` ACTIVE →
  insert an overlapping absence → re-detect → assert the row is `RESOLVED` and gone from
  the inbox
- An integration test proving an unplanned mid-sprint absence produces a `SPRINT_AT_RISK`
  row, and that deleting the absence resolves it
- `npm run test:mutation` stays above threshold

#### Manual Verification:

- Recording an absence for a member who currently shows `DEVELOPER_INACTIVE` makes that
  anomaly disappear from the inbox **without waiting for the next sync** (proves D1)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 5: Capacity and the dashboard availability tab

### Overview

The third FR-010 effect, plus the surface that makes it visible.

### Changes Required:

#### 1. Capacity module

**File**: `src/lib/dashboard/capacity.ts` (new)

**Intent**: No capacity calculation exists anywhere. This gives `sp_capacity` its first
reader.

**Contract**: A pure reducer with `now` injected, following the split documented at
`src/lib/dashboard/aging.ts:14-18`. Each active member contributes
`spCapacity × (available working days ÷ sprint working days)`, where availability is
reduced by absence days through the Phase 3 counter — the **inclusive** boundary, both for
the absence days subtracted and for the sprint's own working-day total. Members with a **null** `spCapacity`
are excluded from the total and counted separately, so the caller can render "N members
without capacity set" — a null must never silently read as zero. Returns the team total,
the unadjusted total, and the excluded-member count.

#### 2. Reader

**File**: `src/lib/dashboard/capacity.ts` (reader half)

**Intent**: Owner-scoped data loading, kept out of the reducer.

**Contract**: A **standalone** reader half in `capacity.ts` — not an extension of
`getBurndownSeries`. The alternative was weighed and rejected: §3 specifies the tab as two
member × day absence grids plus one capacity number, and neither renders a burndown series,
so extending `burndown.ts:23-109` would make the availability tab pay for a series it never
draws. The reader selects the sprint, the project timezone via
`time-zone-reader.ts:14-24`, the active roster with `id` and `spCapacity`, and the
absences overlapping the sprint — owner-scoped, shaped to the
`(team_member_id, start_date, end_date)` index.

#### 3. Availability tab

**File**: `src/components/organisms/dashboard/availability.tsx` (new) plus a pure
`availability-view.ts` sibling; `src/components/organisms/dashboard/today-tabs.tsx`;
`src/app/(app)/dashboard/page.tsx`

**Intent**: The everyday surface — who is away, seen where the lead already looks each
morning. FR-016 requires the inbox to stay the headline with other panels behind tabs, so
this is a fifth tab rather than an always-on card.

**Contract**: Two stacked sections. The first covers the **current sprint window**; the
second covers the **next window of the same length** — computed as
`sprint.endDate + (sprint.endDate − sprint.startDate)`, deliberately **not** from the
cadence columns, which are written-but-never-read and carry no test coverage. Each section
is a member × day grid marking absent days, reusing the shape of the existing activity
matrix (`src/lib/dashboard/activity-grid.ts`, with `activity-grid.test.ts` as the
unit-test shape to copy) and the same
zone-aware `enumerateDayKeys` axis. The current-sprint section also shows the capacity
number with its "N members without capacity set" note. A "Manage" button links to
`/settings/absences`. All grid-building logic lives in the `.ts` sibling for unit testing.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including capacity unit tests: a member with null `spCapacity` is
  excluded and counted, a fully absent member contributes zero, a half-absent member
  contributes proportionally, and a sprint with no working days does not divide by zero
- `availability-view.ts` unit tests cover the next-window computation and day marking
- `npm run typecheck`, `npm run lint`, `npm run test:integration` pass
- Production build succeeds

#### Manual Verification:

- The availability tab shows the current sprint and the next window, with the right people
  marked on the right days
- Recording an absence lowers the capacity number by a plausible amount
- A team with no `sp_capacity` values set sees the explanatory note, not "0 SP"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 6: Demo seed, roadmap entries, and the manual checklist

### Overview

Close the slice: demo data that exercises all three effects, the deferred work recorded
where scope changes belong, and the short manual list.

### Changes Required:

#### 1. Seed absences

**File**: `scripts/seed-dashboard.mjs`

**Intent**: The seed currently creates zero absence rows, so demo mode (S-09) would inherit
a surface with nothing on it and none of the three effects would be demonstrable.

**Contract**: Three absences inserted after the roster loop (`:186-207`): a planned one
that only lowers capacity, an unplanned mid-sprint one that raises `SPRINT_AT_RISK`, and
one overlapping Erik Lund so `DEVELOPER_INACTIVE` suppression is visible. Note the seeded
`DEVELOPER_INACTIVE` row (`:239-242`) is a **hand-written static row** that the engine does
not regenerate — either drop it in favour of a real detection run, or document that it will
not self-suppress. Add `"absence"` to the cleanup list (`:133-152`) **before**
`"team_member"`, matching the file's stated children-before-parents convention (`:130-132`).

#### 2. Roadmap entries for the deferred work

**File**: `context/foundation/roadmap.md`

**Intent**: Scope changes start in the roadmap, not in issue bodies
(`context/foundation/task-tracking.md`). Three things were deliberately deferred during
planning and must not evaporate.

**Contract**: New slice rows for (a) the working-days calendar — public holidays plus
per-sprint company days off, filling the `nonWorkingDays` seam from Phase 3, and needing a
country signal the app does not currently store; (b) the next-sprint capacity forecast, as
distinct from this slice's who-is-away view; (c) the `/team` navigation section, noted as a
navigation refactor that would move `/settings/team` and therefore invalidate S-15 manual
rows 5.3/5.4. Also update the S-08 row's status.

#### 3. Manual checklist

**File**: `context/changes/absence-calendar/MANUAL-CHECKLIST.md` (new)

**Intent**: The short list of what genuinely blocks the slice, per `CLAUDE.md`.

**Contract**: 3–5 rows, each carrying where / what to do / what must be true / why it
matters, signed off with the phase number. One row is mandatory: **S-08 is the first slice
to arm the S-15 delete gate for real** — after recording one absence for a member, that
member's delete dialog must offer Deactivate only, with no "Delete permanently" button, and
must say "1 recorded absence". This catches a regression in
`getMemberHistory`/`deleteMember` that no automated test would surface as user-visible.
Include the destructive-path warning that `db:seed:demo` deletes its target owner's
credentials.

### Success Criteria:

#### Automated Verification:

- `npm run db:seed:demo` completes against a throwaway local owner and creates the three
  absence rows
- Re-running the seed is idempotent — no duplicate absences
- `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint` all pass

#### Manual Verification:

- A member with a recorded absence cannot be permanently deleted; the dialog offers
  Deactivate only and names the absence count
- The seeded demo shows all three effects on the dashboard
- The remaining rows of `MANUAL-CHECKLIST.md` pass

**Implementation Note**: This is the final phase. After it, tick `## Progress`, update `change.md`, and mark the PR ready.

---

## Testing Strategy

### Unit Tests

- `absence-dates.ts` — day-key ↔ instant conversion in a non-UTC zone, inclusive
  `end_date`, overlap predicate at both edges
- `validations/absence.ts` — `endDate >= startDate`, enum mirroring (overlap is not tested
  here; it lives in the store, and its advisory client copy in `absence-calendar-view.ts`)
- `countWorkingDays` — non-UTC zone where the server-local answer differs, `nonWorkingDays`
  exclusion, Mon–Fri fallback, and both boundary semantics on one input (exclusive-start 4
  / inclusive 5 for Mon–Fri)
- `developer-inactive` / `sprint-at-risk` — positive, healthy-silent, and the three
  boundary cases per `test-plan.md:102`
- `capacity.ts` — null `spCapacity` excluded and counted, full/partial absence,
  zero-working-day sprint
- `availability-view.ts` — next-window computation, day marking

### Integration Tests

- Absence CRUD round-trip, owner-scoped
- **Cross-owner siblings for every operation**, per the policy at
  `roster-store.integration.test.ts:825-826` and `test-plan.md:58-59` (Risk #4, IDOR)
- An absence cannot be attached to another owner's team member
- A failed re-detect does not fail the save
- Suppression lifecycle: detect → ACTIVE → add absence → re-detect → `RESOLVED`
- Unplanned absence produces `SPRINT_AT_RISK`; deleting it resolves the anomaly
- Absences survive a `saveRoster` call (extends the existing S-15 assertion)

Integration tests need `npx supabase start` and refuse any `DATABASE_URL` that is not
`127.0.0.1:54322` (`test/integration/setup.ts:33-46`).

### Manual Testing

Owned by `MANUAL-CHECKLIST.md` (Phase 6). Browser-only paths — the calendar interaction,
the availability grid rendering — go there or to Playwright, because there is no
component-test harness.

## Performance Considerations

`detectAnomalies` runs on every absence save (D1) and loads a five-select snapshot. This is
acceptable for a hand-driven settings mutation but must not be extended to any high-frequency
path. The `absence` table has no `(owner_id, …)` index; the snapshot query should be shaped
to the existing `(team_member_id, start_date, end_date)` index, and an owner-scoped index
considered only if a real query proves slow.

## Migration Notes

One migration: `absence.is_planned` → `NOT NULL DEFAULT true`. Safe because the table holds
zero rows (verified 2026-08-25). No backfill. No other column changes — `absence` is marked
STABLE in `context/changes/data-schema-baseline/research.md:108` and stays that way.

## References

- Research: `context/changes/absence-calendar/research.md` — including the binding owner
  decisions D1 and D2
- Roster surface precedent: `src/lib/integrations/roster-store.ts:388-445`
- Detection reconcile loop: `src/lib/anomaly/detect.ts:121-129`
- Delete gate this slice arms: `src/lib/integrations/roster-store.ts:542-579`
- Lessons that constrain this slice: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Absence data layer

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — 7f2249f
- [x] 1.2 `npm run typecheck` passes and `SelectAbsence.isPlanned` is `boolean` — 7f2249f
- [x] 1.3 `npm run lint` passes — 7f2249f
- [x] 1.4 `npm test` passes with unit tests for `absence-dates.ts` and the zod schemas — 7f2249f
- [x] 1.5 `npm run test:integration` passes: CRUD round-trip, cross-owner refusal, foreign-member refusal, overlap rejected / self-overlap allowed on edit, failed re-detect does not fail the save — 7f2249f

### Phase 2: Absence management surface

#### Automated

- [x] 2.1 `npm run typecheck`, `npm run lint`, `npm test` pass including `absence-calendar-view.ts` unit tests — 6bdb448
- [x] 2.2 Production build succeeds and lists `/settings/absences` — 6bdb448

#### Manual

- [ ] 2.3 Recording a vacation persists across a refresh
- [ ] 2.4 The delete dialog names the absence it will remove
- [ ] 2.5 Editing a window changes it rather than creating a second row

### Phase 3: One source of truth for working days

#### Automated

- [x] 3.1 `npm test` passes with new `countWorkingDays` boundary tests (non-UTC zone, `nonWorkingDays`, Mon–Fri fallback) — a8b9dad
- [x] 3.1b Both boundary semantics pinned on one Mon–Fri input: exclusive-start 4, inclusive 5 — a8b9dad
- [x] 3.2 The 10 `TICKET_STATUS_AGING` tests and the 5 `countWorkingDays` assertions in `helpers.test.ts` pass, changed expectations commented — a8b9dad
- [x] 3.3 `npm run test:integration`, `npm run typecheck`, `npm run lint` pass — a8b9dad
- [x] 3.4 `npm run test:mutation` stays above the 70 break threshold — a8b9dad

### Phase 4: Wire absences into the anomaly engine

#### Automated

- [x] 4.1 `npm test` passes with positive, healthy-silent and three boundary cases per rule, expectations hand-derived from FR-010 — a046bba
- [x] 4.2 `npm run test:integration` passes the suppression lifecycle (detect → ACTIVE → absence → RESOLVED) — a046bba
- [x] 4.3 `npm run test:integration` passes the unplanned-absence `SPRINT_AT_RISK` case and its resolution on delete — a046bba
- [x] 4.4 `npm run test:mutation` stays above threshold — a046bba

#### Manual

- [ ] 4.5 Recording an absence clears that member's `DEVELOPER_INACTIVE` without waiting for the next sync

### Phase 5: Capacity and the dashboard availability tab

#### Automated

- [x] 5.1 `npm test` passes capacity unit tests (null capacity excluded, full/partial absence, zero-working-day sprint) — a01dbb3
- [x] 5.2 `npm test` passes `availability-view.ts` unit tests — a01dbb3
- [x] 5.3 `npm run typecheck`, `npm run lint`, `npm run test:integration` pass — a01dbb3
- [x] 5.4 Production build succeeds — a01dbb3

#### Manual

> Moved to `context/foundation/manual-test-backlog.md` §8 (2026-08-25) — deferred, not dropped. Kept unticked here because this plan stays canonical.

- [ ] 5.5 The availability tab shows the current sprint and the next window with the right people on the right days
- [ ] 5.6 Recording an absence lowers the capacity number plausibly
- [ ] 5.7 A team with no `sp_capacity` set sees the explanatory note, not "0 SP"

### Phase 6: Demo seed, roadmap entries, and the manual checklist

#### Automated

- [x] 6.1 `npm run db:seed:demo` creates the three absence rows against a throwaway owner — 417b969
- [x] 6.2 Re-running the seed is idempotent — no duplicate absences — 417b969
- [x] 6.3 `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint` all pass — 417b969

#### Manual

- [ ] 6.4 A member with a recorded absence cannot be permanently deleted; the dialog offers Deactivate only and names the count
- [ ] 6.5 The seeded demo shows all three effects on the dashboard
- [ ] 6.6 The remaining rows of `MANUAL-CHECKLIST.md` pass
