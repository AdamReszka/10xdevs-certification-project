# Cadence Override Retention (S-30) Implementation Plan

## Overview

A hand-entered sprint cadence stops being four columns on a row the Jira sync
owns, deletes and reseeds, and becomes a **record of what the lead chose** —
keyed by the Jira-side sprint id, carrying no foreign key into the sync graph
(the `sprint_measurement` shape), with three NULLABLE fields where NULL means
"follow the source for THIS field".

The frame's reframed problem is that SprintFlow has no durable representation of
*"this is the cadence the lead chose for this sprint"*. Five paths replace that
statement today — disconnect, project switch, rollover, the "Restore Jira's
values" button, and migration `0022`'s fleet-wide unfreeze feeding the ordinary
15-minute cycle — and none of them emits an event, a status, or a word of copy.
Only two of the five involve a credential at all, which is why re-homing the
values is necessary but not sufficient.

## Current State Analysis

**The columns.** `sprint.length_days`, `start_day`, `working_days`,
`cadence_overridden` (`schema.ts:438-441`), created by
`0001_lying_human_cannonball.sql:219-222`. `sprint` cascades off `jira_project`,
which cascades off `jira_credential` (`schema.ts:322-324`, `:415-417`), and both
S-26 disconnect outcomes therefore destroy them — `mode` gates only the `absence`
wipe (`jira-store.ts:320-337`). Two further EXPLICIT deletes fire on a project
switch (`jira-store.ts:258-260`, `connection-service.ts:449-451`) against a
`jira_project` row that is UPDATEd in place, so no referential action is in their
path at all.

**The asymmetry the plan is organised around.** `working_days` has **nine**
computation consumers; `length_days` and `start_day` have **zero**. The nine:
`pr-review-stalled.ts:39`, `ticket-status-aging.ts:102`, `developer-inactive.ts:47`,
`ticket-no-commit-link.ts:42` and `:56`, `sprint-at-risk.ts:96`/`:158`/`:180`,
`capacity.ts:279`, plus `team-days-off-view.ts:88`. Exhaustive greps over `src/`,
`e2e/` and `scripts/` return, for the other two columns, only prefill, validation,
the dirty-check that sets the flag, and the reconciler's own carry/refresh.

**One flag over two provenances.** `sameCadence` is one all-three equality
(`roster-store.ts:1022-1028`) collapsed onto one boolean (`:1072`, `:1081`), and
the reconciler gates all three columns on it (`reconcile-sprint.ts:381-383`).
`deriveCadence` hard-codes Mon–Fri and never asks Jira (`cadence.ts:19-26`,
`:99-106`). Consequence: **no reachable state gives a Mon–Thu team both its
working days and FR-007's auto-pull.** The shipped copy already draws the line
the schema does not — `CADENCE_PROVENANCE` (`cadence-editor-view.ts:97-107`) says
length and start day are "Derived from … Jira" while working days are
"SprintFlow's own Mon–Fri default — Jira has no working-days field to pull."

**The restore contradiction.** `cadence-editor.tsx:239` promises *"Working days
are not pulled from Jira and stay as they are"*; `forceCadenceRefresh`
(`reconcile-sprint.ts:373-379`) resets them to the Mon–Fri constant. The
destruction is pinned green by `roster-store.integration.test.ts:705`, whose own
comment — *"Back to what the sprint's own Jira dates derive"* — is false: Mon–Fri
is derived from nothing.

**The blast radius, measured rather than assumed.** A read of the local database
during planning returns six `sprint` rows: five `(MON, 14)` and one `(FRI, 14)`,
**all** carrying `["MON","TUE","WED","THU","FRI"]` and `cadence_overridden = f`.
Production holds zero `sprint` rows. So no account anywhere currently holds a
non-default working-day pattern — a live mechanism with an empty blast radius,
the same shape as S-28's stored-numeric-override finding. **No data-repair
migration is needed**, only closure of the mechanism and a correctness-only
backfill.

Note the second fact in that measurement: `start_day` genuinely varies (MON and
FRI), which is what makes `sprint.length_days` / `start_day` a real derived cache
and `sprint.working_days` a constant.

**The copy guard is structurally blind.** `deriveImpact`
(`disconnect-impact.test.ts:64-96`) accumulates a set of **table names** from
`getTableConfig(t).foreignKeys`; `sprint` is already declared in
`destroyedTables` (`disconnect-impact.ts:128`), so the guard is green, and the
four cadence columns appear in no FK, so no assertion in the file can reference
them. The guard can say *"a table you named dies"*; it can never say *"and one of
its columns was the lead's, not Jira's."*

**The atomicity requirement, stated correctly.** `forceCadenceRefresh`'s
guarantee is NOT "one SQL statement" — two statements in one transaction are
equally safe. It is that **the intent is an argument**, because every Jira
network call completes before the transaction opens (`:156`, `:165`, `:185`;
transaction at `:209`) **and** four Jira outcomes return successfully having
written nothing, with no exception for a caller to catch: `no_board` (`:166`),
`board_ambiguous` (`:181`), `no_active_sprint` (`:191`), `sprint_undated`
(`:200`). A caller-side pre-clear would commit "auto-pull is back on" and then be
told nothing was written. `importCadence` passes `storedBoardId: null`
unconditionally (`roster-store.ts:900-909`), so the restore path always
re-discovers boards and `board_ambiguous` is genuinely reachable from the button.

**Inheritance stops being free.** `carry` (`:316-335`) works only because cadence
is a column of the INSERTed row. A rollover mints a new `jira_sprint_id`, so a
Jira-keyed lookup finds nothing.

## Desired End State

- A lead sets Mon–Thu working days. They disconnect Jira choosing "keep", or
  switch the monitored Jira project, or the sprint rolls over. The pattern is
  still Mon–Thu, and length and start day are still auto-pulled from Jira — a
  state that is unreachable today in either direction.
- "Restore Jira's values" returns length and start day to Jira's and leaves the
  working days alone, which is what its dialog has been promising since S-29.
- `DISCONNECT_IMPACT` names the surviving cadence among what a disconnect keeps,
  and a structural regression fails the build if the new table ever acquires a
  foreign key that puts it back in the cascade.
- A sync cycle that resolves a cadence from the default while the account holds a
  cadence record elsewhere says so in `sync_attempt.outcome` instead of
  finalizing as `status: OK, outcome: null`.
- Re-pointing at a DIFFERENT Jira instance with a colliding sprint id no longer
  lets one team's cadence carry onto another workspace's sprint.

Verified by: the integration suite (structural twins of the `sprint_measurement`
project-scope and cross-owner cases), the hermetic reader guard, the copy
assertions, one net-new Playwright spec, and the manual checklist.

### Key Discoveries:

- **`working_days` has 9 computation consumers; `length_days` / `start_day` have
  zero.** Every fact the owner associates with the latter two — start, duration,
  remaining — is computed from `sprint.start_date` / `end_date`
  (`availability-view.ts:40-43`, `team/absences/page.tsx:53-54`).
- **15 textual reads funnel through 3 DB-access paths.**
  `getSprintCapacityFor` (`capacity.ts:223-289`) covers the dashboard *and* the
  measurement sweep; `loadSprintSnapshot` (`load-snapshot.ts:35-128`) covers all
  8 anomaly-rule sites. `working-time.ts` and `helpers.ts` need **no change at
  all** — every pure function already takes the array as a parameter.
- **`sprint.working_days` becomes a constant column** once the override leaves.
  Every remaining writer writes `deriveCadence().workingDays`, which is
  `[...DEFAULT_WORKING_DAYS]` unconditionally (`cadence.ts:99-106`); the demo
  fixture writes the same constant (`fixture.ts:74`, `:828`).
- **The house rule for outliving a sync-lifecycle parent is "carry no foreign key
  at all"**, not "soften the cascade" — *"it is 'refuse to be deleted', not
  'recover after deletion'"* (`disconnect-data-retention/frame.md:118-127`).
- **Provenance is encoded as row existence or a nullable reason, never a
  boolean.** `anomaly_settings` deliberately DROPPED `is_default` — *"a row
  exists here IF AND ONLY IF the rule differs from `src/db/defaults.ts`"*
  (`schema.ts:945-951`), enforced by deleting the row on a defaults-equal save
  (`anomaly-settings.ts:120-123`). `recap_settings` uses a nullable reason
  (`schema.ts:990-1004`). **The `anomaly_settings` half transfers only to a model
  with no inheritance tier** — see the precedence note above; here row existence
  is repointed from "differs from the source" to "the lead has spoken for this
  sprint".
- **`sync_attempt.outcome` is `text` with no enum** (`schema.ts:577`), so a new
  diagnostic token needs **no migration**, and `sync-history.tsx:90-92` renders
  `outcome.replace(/_/g, " ")` — so a token displays with **zero component
  change**.
- **`normalizeWorkspaceUrl` already exists** (`jira.ts:168`) and is applied
  before storing (`setup/jira/actions.ts:125-127`), so the stored
  `jira_credential.workspace_url` is already canonical — the identity fix is a
  string equality, not a new normalizer.
- **Homonym trap for greps.** `absence-dates.ts:32-60`,
  `absence-calendar-view.ts:39-168` and `team/absences/page.tsx:53-54` all use
  `startDay` as a **`DayKey` (`YYYY-MM-DD`)**, unrelated to `sprint.start_day`'s
  weekday code.

## What We're NOT Doing

- **Not dropping any column from `sprint`.** All four stay (owner's decision).
  `length_days` / `start_day` remain a genuine derived cache and are the
  resolver's third tier; `working_days` and `cadence_overridden` become written
  but never read. The risk that creates — "which copy is true" for the next
  reader — is neutralized in Phase 2 by a hermetic reader guard and in Phase 1 by
  a `schema.ts` docblock marking them superseded. The DROP itself becomes a
  roadmap follow-up, not part of this slice.
- **Not giving `length_days` / `start_day` a consumer.** That means inventing a
  nominal-vs-actual surface or building S-18's future-sprint projection — new
  scope with no PRD backing inside S-30. They keep being stored so FR-007's
  override stays literally kept.
- **Not adding a column registry to the copy guard.** The repo has twice
  demonstrated that a hand-maintained enumeration of losses goes stale
  (`integration-card-copy.ts:138-147` records it going stale three times), and a
  registry's own staleness is invisible.
- **Not touching `stryker.conf.json`.** Every file this slice edits is outside
  the mutation glob and stays outside. Recorded rather than assumed: the
  resolver is database reads and coalescing, where mutants are cheap to kill
  with the integration tests this plan already writes, and a first run against an
  untuned file can drop the aggregate below `break: 70` and break CI.
- **Not building a write-time rollover seed.** Inheritance is read-time, so
  `sweep.ts:17-26`'s recorded *"A SWEEP, NOT A HOOK, deliberately"* objection
  does not apply.
- **Not a data-repair migration.** Measured: no account holds a non-default
  pattern. The backfill in Phase 1 is written for correctness, not for repair.

## Implementation Approach

One new table in the `sprint_measurement` shape, one resolver module, and then
the existing code is pointed at the resolver in the order that keeps every
intermediate state shippable: the record and its reads land before any write path
changes, so at the end of Phase 2 the resolver is live and answering from the
third tier (`sprint`'s own columns) exactly as today.

**Precedence, stated once because everything else follows from it:**

1. The override record for **this exact** `(owner_id, jira_sprint_id)`. The row
   exists iff **the lead has spoken for this sprint** — deliberately NOT iff the
   values differ from the source. A NULL field here means "follow the source for
   this field" and falls through to tier 3 — **not** to tier 2. A lead who
   cleared a field is not silently given the old one back, and a row whose three
   fields are ALL NULL is a meaningful state, not an inert one: *for this sprint,
   follow the source and do not inherit*.
2. Only when **no record exists for this sprint at all**: the latest earlier
   record for `(owner_id, jira_project_id)` — the Jira-side project id — with
   `start_date <= this sprint's start_date`. This is inheritance.
3. `sprint.length_days` / `sprint.start_day` for those two fields;
   `DEFAULT_CADENCE.workingDays` for working days. `sprint.working_days` is
   deliberately NOT consulted: it can only ever hold the constant, and consulting
   a second copy of a constant is precisely the duplicate that produced the S-29
   defect one layer up.
4. `DEFAULT_CADENCE` for anything still null.

**Why row existence is not `anomaly_settings`' rule (plan review F1).** That
table's *"a row exists IF AND ONLY IF the rule differs from `defaults.ts`"* is
safe because it has no inheritance tier. Copied here it makes "stop inheriting"
inexpressible: a lead on Mon–Thu at sprint N who saves Mon–Fri at sprint N+1
writes three source-equal fields, the row is deleted, no record exists for N+1,
tier 2 fires and returns Mon–Thu — the save silently reverted, which is the
failure mode this slice exists to end. So **no write path in this slice deletes a
row**. The cost is rows that hold three NULLs; at one per sprint the lead touched
that is the `sprint_measurement` order of magnitude, and their eventual cleanup is
not this slice's problem.

## Critical Implementation Details

**The recency fallback is ordered relative to the sprint being resolved, not to
now.** `start_date <= sprint.startDate`, never "the owner's newest record". The
measurement sweep iterates every sprint row the owner has (`sweep.ts:111-115`)
and `shouldFinalize` returns false unconditionally when `committed_frozen_at IS
NULL` (`sweep.ts:52`) — so a sprint that closed without a frozen commitment never
finalizes and its capacity is recomputed on every cycle. A "newest record"
fallback would let a cadence chosen last week rewrite the capacity frozen into a
closed sprint's lifetime FR-023 record. Finalized records are safe either way
(`setWhere: isNull(...)`, `:65-67`, `:213`); the unfinalized ones are protected by
nothing but this predicate.

**The override write must join the reconciler's own transaction, and the intent
must arrive as an argument.** Not because one statement is safer than two — it is
not — but because all four of `board_ambiguous` / `no_board` / `no_active_sprint`
/ `sprint_undated` return **before** the transaction opens, successfully, having
written nothing and with no exception to catch. A caller cannot join that
transaction today: `reconcileActiveSprint` takes `db`, not `tx`
(`reconcile-sprint.ts:49`).

**`ON CONFLICT DO UPDATE` binding.** An unqualified column binds to the existing
row and `excluded.*` to the proposed one, which is how the current three-way SET
reads the row's own flag at update time. `working_days` needs the explicit
`::jsonb` cast (`:377`, `:383`) because the parameter is a `JSON.stringify`'d
literal built at `:205`.

**Three readers coalesce with `?? [...DEFAULT_CADENCE.workingDays]`, which
catches `null` but not `[]`.** Nothing can write `[]` today
(`validations/roster.ts:148`); the new write path must keep it that way.

---

## Phase 1: The record and its resolver

### Overview

Add the table, the migration and the resolution logic. Nothing reads the resolver
yet — this phase is additive and inert.

### Changes Required:

#### 1. The table

**File**: `src/db/schema.ts`

**Intent**: Add `sprintCadenceOverride` in the `sprint_measurement` shape — the
durable record of what the lead chose, immune to the Jira cascade. Also amend the
docblocks on `sprint.working_days` and `sprint.cadence_overridden` to record that
they are superseded and written-but-never-read, naming the resolver as the reader.

**Contract**: table `sprint_cadence_override`, columns `id` (text PK), `owner_id`
(text NOT NULL, `references(() => user.id, { onDelete: "cascade" })` — the only
FK, and it is to the account, not to the sync graph), `jira_project_id` (text NOT
NULL, the **Jira-side** id, deliberately NOT a foreign key — same reasoning as
`schema.ts:461-470`), `jira_sprint_id` (text NOT NULL), `start_date` (timestamp **NOT NULL**,
the sprint's start, carried so the recency fallback can order without touching
`sprint` — NOT NULL because it is the ORDERING key of tier 2 and a NULL there
makes the comparison return no rows instead of erroring, which is inheritance
silently disappearing rather than failing; plan review F8), `length_days` (integer, nullable), `start_day` (text, nullable),
`working_days` (jsonb `$type<string[]>()`, nullable), `created_at`, `updated_at`.
Constraints: `unique("sprint_cadence_override_owner_sprint_uq").on(ownerId,
jiraSprintId)` — both NOT NULL per `lessons.md` #1, since the upsert's idempotence
rests on it — and `index("sprint_cadence_override_series_idx").on(ownerId,
jiraProjectId, startDate)`, mirroring `sprint_measurement_series_idx`.

#### 2. The migration

**File**: `src/db/migrations/0023_*.sql` (generated via `npm run db:generate`)

**Intent**: Create the table and backfill it from any `sprint` row that currently
carries `cadence_overridden = true`, so an account this plan never measured does
not lose its override at the moment the resolver goes live.

**Contract**: `CREATE TABLE` + the two constraints, then one
`INSERT … SELECT` from `sprint` joined to `jira_project` (to reach the Jira-side
project id) `WHERE sprint.cadence_overridden = true`, writing each of the three values only
when it DIFFERS from what the source derives — a source-equal field is written
NULL, or the backfill would assert on day one a choice nobody made (a lead who
overrode only the length would get a record claiming they also chose Mon–Fri, and
would be pinned to it forever after). That is the same invariant every write path
holds, applied to the one write the migration performs (plan review F9).
**The backfill statement is authored once and exported as a re-runnable constant**
(`BACKFILL_CADENCE_OVERRIDES` beside the resolver) that the migration and its test
both execute, because a test cannot otherwise observe it: `db:migrate` runs before
the integration suite, so `0023` has already executed against an empty table and a
row the test seeds afterwards is never seen (plan review F6). `ON CONFLICT DO
NOTHING` is what makes the second execution safe, so it is load-bearing rather
than defensive.
Measured no-op in every known database — local holds six rows all with the flag
`false`, production holds zero — so this is correctness, not repair. The insert
must be `ON CONFLICT DO NOTHING` so re-running is safe.

#### 3. The resolver

**File**: `src/lib/cadence-override.ts` (new — sits beside `src/lib/sprint.ts`,
the other cross-cutting sprint resolver)

**Intent**: One place that answers "what cadence applies to this sprint", and one
place that writes the record. Split pure from impure so the precedence logic is
unit-testable without a database — CLAUDE.md's rule, and the reason
`cadence-editor-view.ts` exists.

**Contract**:
- `pickCadence(input: { own: OverrideFields | null; inherited: OverrideFields |
  null; sprintLengthDays: number | null; sprintStartDay: string | null }):
  ResolvedCadence` — **pure**, implements the four tiers above.
  `ResolvedCadence = DerivedCadence & { source: CadenceSource }` where
  `CadenceSource = "own" | "inherited" | "source" | "source_with_prior_override"`.
- `resolveCadenceFor(db, ownerId, sprintRow: SelectSprint): Promise<ResolvedCadence>`
  — performs the two selects and calls `pickCadence`. The inherited select joins
  `jiraProject` on `jiraProject.jiraProjectId = sprintCadenceOverride.jiraProjectId`
  and filters `jiraProject.id = sprintRow.jiraProjectId`, exactly as
  `reconcile-sprint.ts:286-292` bridges the two project identities; ordered
  `desc(startDate)`, `limit(1)`, filtered `startDate <= sprintRow.startDate`.
  **`sprintRow.startDate` is itself nullable on `sprint`** (`capacity.ts:228`
  guards it explicitly), and `NULL <= NULL` is not false but unknown — so the
  resolver SKIPS tier 2 outright for an undated sprint row and goes to tier 3,
  stated here rather than left to SQL three-valued logic (plan review F8). Every
  write path already refuses an undated sprint (`sprint_undated`,
  `reconcile-sprint.ts:200`), so this arm is a guard, not a path.
  `source_with_prior_override` is returned when no record applies to this sprint
  but the owner holds at least one record — the condition Phase 4 reports.
- `writeCadenceOverride(tx, { ownerId, jiraProjectId, jiraSprintId, startDate,
  fields })` — upserts on the unique key and **never deletes**. A save whose three
  fields all equal the source writes a row of three NULLs; that row is the record
  of the lead having chosen the source FOR THIS SPRINT, and it is the only thing
  that stops tier 2 handing back an earlier pattern. Takes a transaction handle,
  not `db`.
- `clearCadenceOverrideFields(tx, { ownerId, jiraProjectId, jiraSprintId,
  startDate, resolved, fields })` — sets the named fields NULL and **creates the
  row when absent**, because a sprint whose cadence is inherited has no row of its
  own and a clear against a missing row is a no-op that leaves the inherited value
  in force. On that create it materialises `resolved` — the currently RESOLVED
  value — for every field it is NOT clearing, or the restore would drop the
  inherited working-day pattern along with the inherited length. Keeps the row
  when nothing is left. Phase 3's restore passes `["lengthDays", "startDay"]`.
- Re-export nothing from `cadence.ts`; that module stays pure and DB-free.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Postgres: `npm run db:migrate`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests for `pickCadence` cover all four tiers, per-field NULL fallthrough
  to tier 3 (not tier 2), and every `CadenceSource` value: `npm test`
- Integration tests for `resolveCadenceFor` include structural twins of the
  `sprint_measurement` cases the research named — project-scoped (a record for a
  different Jira-side project is not inherited, twin of case (t)
  `reconcile-sprint.integration.test.ts:655-687`) and cross-owner (twin of case
  (r) `:641`) — plus a case asserting the fallback is ordered against the
  sprint's `start_date` and not against the newest record:
  `npm run test:integration`
- The backfill is asserted by an integration test that seeds a `sprint` row with
  `cadence_overridden = true` and a non-default pattern, **re-executes the
  exported backfill statement** (the migration itself ran before the suite), then
  runs the resolver and gets that pattern back — and a second execution changes
  nothing

#### Manual Verification:

- The migration has a named route to production and it is applied there BEFORE
  any manual row that depends on the new table (`lessons.md`: schema and code
  travel on different tracks; a green deploy is not evidence of a migrated
  database). See `## Migration Notes`.

---

## Phase 2: The read seams

### Overview

Point every reader at the resolver. Behaviour is unchanged at the end of this
phase — no record exists yet for anyone, so every read lands on tier 3 and
returns exactly what it returns today. That is what makes this phase safe to
verify: the existing suite should stay green except where it asserted the shape
of a function signature.

### Changes Required:

#### 1. The capacity seam — covers dashboard AND the measurement sweep

**File**: `src/lib/dashboard/capacity.ts`

**Intent**: `getSprintCapacityFor` stops reading `sprint.workingDays` (`:279`) and
resolves instead. One added call covers both callers — `dashboard/page.tsx:118`
and `sweep.ts:162` — because the sweep already goes through this function.

**Contract**: `computeSprintCapacity`'s `workingDays` argument is fed from
`resolveCadenceFor(db, ownerId, sprint)`. The function already has `db` and
`ownerId` in scope and already does a `Promise.all` of four reads; the resolve
joins it as a fifth. `computeSprintCapacity` itself is pure and unchanged.

#### 2. The anomaly seam — covers all 8 rule sites

**Files**: `src/lib/anomaly/load-snapshot.ts`, `src/lib/anomaly/types.ts`

**Intent**: Surface `SprintSnapshot.workingDays` as a top-level field beside the
`timeZone` and `nonWorkingDays` that already exist for exactly this reason,
turning all eight rule sites into a mechanical rename from
`snapshot.sprint.workingDays` to `snapshot.workingDays`.

**Contract**: `SprintSnapshot` gains `workingDays: string[]`; `loadSprintSnapshot`
adds the resolve to its existing `Promise.all` (`:65-105`) and populates the field
next to `timeZone` (`:125`) and `nonWorkingDays` (`:126`). The eight consumers:
`pr-review-stalled.ts:39`, `ticket-status-aging.ts:102`, `developer-inactive.ts:47`,
`ticket-no-commit-link.ts:42` and `:56`, `sprint-at-risk.ts:96`, `:158`, `:180`.
`working-time.ts` and `helpers.ts` are untouched — every pure function already
takes the array as a parameter.

#### 3. The cadence editing surfaces

**Files**: `src/lib/integrations/roster-store.ts` (`cadenceFromRow`, `:982-988`),
`src/app/(app)/team/cadence/page.tsx:50-56`,
`src/app/(app)/setup/team/page.tsx:73-79`,
`src/app/(app)/team/days-off/page.tsx:59`

**Intent**: The four places that prefill or display a cadence read the resolved
value, so what the form shows is what the engine uses.

**Contract**: `cadenceFromRow` becomes a thin adapter over the resolver's result
(or is replaced by it at each call site); the three pages resolve rather than
coalescing `activeSprint.workingDays`. All keep spreading `DEFAULT_CADENCE` for
their own defaults — the S-29 impl-review F2 rule that there is only one spelling
of these three values stands.

#### 4. The second, uncanonicalised Mon–Fri copy

**File**: `src/components/organisms/settings/team-days-off-view.ts`

**Intent**: `:14` declares its own `DEFAULT_WORKING_DAYS` and `:79-81` falls back
without the S-28 intersection guard, so under a non-canonical array every holiday
renders `costsNothing: true` while the guarded engine still subtracts it — two
counters disagreeing. Today the defect sleeps because nobody has a pattern other
than Mon–Fri; this slice is what wakes it.

**Contract**: the local constant goes; the module spreads `DEFAULT_CADENCE.workingDays`
and routes its `:88` `costsNothing` computation through `workingDaySet`
(`helpers.ts:150-179`), the S-28 canonicalisation guard.

#### 5. The two casts that would hide compile breaks

**Files**: `src/lib/anomaly/test-support.ts:46`, `src/lib/demo/fixture.test.ts:113`

**Intent**: Both use `as SelectSprint`, so a changed snapshot shape does not fail
to compile there. Update by hand.

**Contract**: the fixtures produce the new `SprintSnapshot` shape without a cast
widening past it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit suite green: `npm test`
- Integration suite green with **no behavioural assertion changed** in this phase
  — every read lands on tier 3 and returns today's value: `npm run test:integration`
- A new integration test asserts the sweep recomputing an unfinalized closed
  sprint takes that sprint's own cadence, not a later record's

#### Manual Verification:

- Dashboard "Today" and Sprint Detail render with the same numbers as before the
  phase for an account with no override record

---

## Phase 3: The write paths — save and restore

### Overview

The lead's edits start landing in the record, per field. The restore button stops
contradicting its own dialog.

### Changes Required:

#### 1. `saveCadence` writes the record, per field, in a transaction

**File**: `src/lib/integrations/roster-store.ts` (`:1056-1090`)

**Intent**: The dirty-check stops being one all-three equality collapsed onto one
boolean and becomes three independent comparisons against **the source value for
that field** — which is what makes a Mon–Thu team's working days coexist with
FR-007's auto-pull for length and start day. A field equal to its source is stored
as NULL; all three NULL leaves a three-NULL row, which is what says "for this
sprint, follow the source" and blocks tier 2 (plan review F1).

**Contract**: `saveCadence` keeps its signature and its `getActiveSprintRow`
resolution (S-29's "the row the lead is looking at and the row the save writes are
one sentence"), and keeps the `owner_id` predicate alongside the id
(`lessons.md` corollary (a)). It now opens a transaction — it has none today
(`:1073-1082`), harmless while it was a single statement and not harmless for a
two-table save — and inside it: computes the three source values
(`sprint.lengthDays ?? DEFAULT`, `sprint.startDay ?? DEFAULT`,
`DEFAULT_CADENCE.workingDays`), builds the NULL-or-value triple through
`canonicalWorkingDays` so a reordered set is still not an edit, and calls
`writeCadenceOverride`. It still writes the three values to `sprint` as before, so
the columns stay populated and a rollback of this slice is a code revert.
`cadence_overridden` is no longer written by this path. Return type gains
per-field provenance in place of the single `overridden` boolean; `NoSprintRowError`
behaviour is unchanged.

#### 2. Restore preserves the working days

**Files**: `src/lib/integrations/roster-store.ts` (`restoreCadenceFromJira`,
`:1114-1140`), `src/lib/integrations/reconcile-sprint.ts` (`forceCadenceRefresh`)

**Intent**: "Restore Jira's values" clears the length and start-day override — the
two fields Jira genuinely derives — and does not touch the working-day pattern.
"Restoring from Jira" a field Jira does not have is not a restore; it is deleting
the lead's choice under someone else's name.

**Contract**: `forceCadenceRefresh` keeps its name and its intent-as-argument
position, and its effect becomes `clearCadenceOverrideFields(tx, { fields:
["lengthDays", "startDay"] })` **inside the reconciler's transaction** (Phase 4
delivers the plumbing). `restoreCadenceFromJira` is otherwise unchanged, including
its `NoSprintRowError` pre-check and its `noActiveSprint` honesty path.
`cadence-editor.tsx:239` is **not edited** — the sentence becomes true.

#### 3. Per-field provenance in the editor state

**File**: `src/components/organisms/settings/cadence-editor-view.ts`

**Intent**: `cadenceEditorState` keys off one `cadenceOverridden` boolean
(`:30-87`), which can no longer describe an account whose working days are
hand-set and whose length is auto-pulled — the state this slice exists to create.

**Contract**: the input becomes the resolver's per-field provenance instead of a
boolean; the `"overridden"` kind's body distinguishes "you set the working days by
hand, and length and start day still follow Jira" from the all-three case.
`CADENCE_PROVENANCE` (`:97-107`) is already per field and correct — it stays as
the wording those states quote. The `no_sprint` / `no_active_sprint` kinds are
untouched except by Phase 5's dead-end fix.

**The four files the boolean also travels through (plan review F3)** — named here
so the copy decision is made in the plan and not as a compile error mid-phase:

- `src/app/(app)/setup/team/actions.ts:419`, `:470` — `saveCadenceAction`
  destructures `{ overridden }` from the service and returns it verbatim in its
  success shape. It carries the per-field provenance through instead, unchanged
  in every other respect.
- `src/components/organisms/settings/cadence-editor.tsx:61`, `:87`, `:96` — the
  `cadenceOverridden: boolean` prop, its `useState` seed and the value handed to
  `cadenceEditorState`. All three take the per-field shape.
- `cadence-editor.tsx:115-124` — `setOverridden(result.overridden || overridden)`
  is a STICKY OR, there so a confirming save cannot un-override an account
  (`:120-122`). Per field it becomes a per-field merge with the same intent: a
  field the save did not claim keeps the provenance it had.
- `cadence-editor.tsx:198-208` — the post-save banner has exactly two sentences
  today ("SprintFlow will keep these values and stop taking the sprint length and
  start day from Jira" / "Nothing changed, so this account keeps following Jira").
  It gains a third for the state this slice creates: the working days are kept and
  the sprint length and start day still come from Jira. All three quote
  `CADENCE_PROVENANCE`'s wording rather than restating it.
- `src/components/organisms/setup/cadence-form.tsx:76` — the same prop on the
  wizard mount. It does NOT read `result.overridden` (`:155` discards it), so the
  wizard needs the type change and no copy change.

#### 4. Reverse the test that pins the destruction

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: `:689-707` ("refreshes the cadence PAST the override and clears the
flag") asserts `["MON","TUE","WED","THU","FRI"]` at `:705` after a restore over a
saved `{21, WED, ["MON","TUE","WED"]}`. That assertion is the defect, pinned green.

**Contract**: `:705` asserts the working days are **preserved** as
`["MON","TUE","WED"]` while `lengthDays` and `startDay` return to Jira's derived
values; the case is renamed to say so. Its companion at `:709-732`, which already
asserts preservation on a failed Jira call, is extended rather than changed. The
research's other MUST-CHANGE sites in this file — `:466`, `:547`, `:566`, `:588`,
`:655`, `:734` — move to the per-field provenance return shape.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run typecheck && npm run lint`
- Unit suite green, including the rewritten `cadence-editor-view.test.ts` cases
  (`:18`, `:53`, `:64`, `:118`): `npm test`
- Integration suite green, including the reversed `:705` assertion and
  `setup/team/actions.integration.test.ts:274-287`, `:320`: `npm run test:integration`
- A new integration case: save Mon–Thu, then restore — working days survive,
  length and start day return to Jira's derived values
- A new integration case: with an override on sprint N, saving the SOURCE values
  on sprint N+1 leaves a three-NULL row and the resolver returns the source —
  inheritance does not hand sprint N's pattern back (plan review F1)

#### Manual Verification:

- On `/team/cadence`, set working days to Mon–Thu and save; the page reports the
  working days as hand-set and length/start day as following Jira
- Press "Restore Jira's values" and confirm; the working days are still Mon–Thu
  and the dialog's promise held

---

## Phase 4: The reconcile

### Overview

The reconciler stops owning the override. Its cadence SET becomes unconditional,
`carry` disappears, and the one durable diagnostic this slice owes `lessons.md`
gets its channel.

### Changes Required:

#### 1. The transaction takes the intent

**File**: `src/lib/integrations/reconcile-sprint.ts`

**Intent**: `forceCadenceRefresh` stops being a branch in the SQL and becomes a
call to `clearCadenceOverrideFields` inside the transaction that already exists,
after the upsert returns. Its position as an **argument** is what this slice must
not lose: the four Jira outcomes that return successfully having written nothing
must leave the override intact, and they return before the transaction opens.

**Contract**: the `forceCadenceRefresh` ternary at `:373-384` goes; the CONFLICT
branch writes `lengthDays` / `startDay` / `workingDays` from `deriveCadence`
**unconditionally** (no `case when`, no `excluded` subtleties, and the `::jsonb`
cast stays because the parameter is still a stringified literal). The clear
happens on both upsert branches, keyed on `(ownerId, jiraSprintId)` of the row
just returned, and it CREATES that row when absent. A restore that races a
rollover lands on a fresh `jira_sprint_id` with no record of its own, and a clear
that no-ops there would let tier 2 resurrect from the previous sprint exactly the
override the restore was asked to drop — the guarantee
`reconcile-sprint.ts:314-317` holds deliberately today under `!forceCadenceRefresh`
and that this slice must not lose (plan review F1). `cadenceOverridden` is written `false` on insert and left alone on
conflict — it is now inert, per the Phase 1 docblock.

#### 2. `carry` disappears

**File**: `src/lib/integrations/reconcile-sprint.ts` (`:316-335`)

**Intent**: Read-time inheritance replaces it. Deleting `carry` also deletes, by
construction, the second unguarded hole the research found: the guard at `:319-323`
checks `lengthDays != null && startDay != null` but **not `workingDays`**, and
`:327` coalesces NULL to Mon–Fri — so an override with a lead-set length but NULL
working days silently re-seeded Mon–Fri on every rollover while still writing
`cadenceOverridden: true`.

**Contract**: the `carry` const and both its branches go; the INSERT `values`
spread at `:351` takes `deriveCadence`'s three values directly. The `previous`
select (`:214-227`) is kept but narrowed to what still uses it — `id` and
`jiraSprintId` for `switched` and the `isRecreate` guard. The freeze-restore block
(`:278-302`) is untouched.

#### 3. The durable diagnostic

**Files**: `src/lib/integrations/reconcile-sprint.ts`,
`src/lib/integrations/sync/run-sync.ts`

**Intent**: `lessons.md`'s obligation (a) — the operator log must record WHICH
predicate produced the result, so "nothing matched" is never reported as an
ordinary successful run. The condition worth acting on under the new model is
narrow and exact: **the cycle resolved a cadence from the default while this
account holds a cadence record somewhere else.** That is the recency predicate
having failed to find what the lead chose — the failure mode this whole slice
exists to prevent, reported instead of hidden.

**Contract**: `ReconcileResult`'s `"reconciled"` variant gains
`cadenceSource: CadenceSource` (the four-value union from Phase 1) — `switched` is
the precedent for a field on that variant. **The reconciler does not resolve a
cadence today, it writes one**, so the value comes from one added
`resolveCadenceFor` call inside the existing transaction, against the row the
upsert just returned and AFTER the clear (plan review F7) — reading before the
clear would report the pre-restore source. It is a diagnostic, not a write: it
must not be able to roll the transaction back, so a failure there yields no token
rather than failing the cycle. `run-sync.ts` captures it near `:695`
and `jiraCycleOutcome` (`:956-966`) gains a third parameter, pushing the fixed
token `cadence_default_fallback` when and only when `cadenceSource ===
"source_with_prior_override"`. Tokens only, no field names, no ids — the
docblock's rule at `:943-955`. No migration: `sync_attempt.outcome` is `text`
with no enum (`schema.ts:577`), and `sync-history.tsx:90-92` already renders
`outcome.replace(/_/g, " ")`.

#### 4. The dead `no_sprint` arm

**File**: `src/lib/integrations/sync/run-sync.ts:707`

**Intent**: `const reason = reconcile.status === "reconciled" ? "no_sprint" :
reconcile.status` — the first arm is unreachable, because if the status is
`"reconciled"` then `chosenSprint` is non-null and the block is not entered. The
plan touches this ternary anyway; not preserving the dead arm by accident is free.

**Contract**: the ternary collapses to `reconcile.status`. Before removing
`"no_sprint"` from `IntegrationOutcome` (`:123`), check for other producers — if
any exists, leave the token and only fix the ternary.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run typecheck && npm run lint`
- Unit suite green: `npm test`
- Integration suite green, including the research's MUST-CHANGE reconcile cases
  (c) `:257`, (d) `:280`, (i) `:458`, (k) `:515`: `npm run test:integration`
- **A direct test for the force branch**, which has none today — the branch is
  exercised only indirectly through `restoreCadenceFromJira`
- **Case (k) asserts `workingDays`**, which it never did (`:533-535` pins only
  the flag, `lengthDays` and `startDay`) — the one field the frame identifies as
  consequential is the one that carry-forward test omitted
- A rollover integration case: an override on sprint N is inherited by sprint N+1
  through the resolver with no write at rollover
- A cycle whose cadence falls back to the default while a record exists elsewhere
  finalizes with `outcome` containing `cadence_default_fallback`, not `null`

#### Manual Verification:

- Trigger a sync on an account with a hand-set cadence; the cadence is unchanged
  and Sync history shows no new diagnostic
- Disconnect Jira choosing "keep", reconnect, and let a cycle run; the hand-set
  working days are still in force

---

## Phase 5: Copy, the contract, and the identity gap

### Overview

Make the promise the UI has been making true, make the guard able to notice if it
stops being true, and close the collision this slice's own mechanism opens.

### Changes Required:

#### 1. The disconnect and switch promises

**File**: `src/lib/integrations/disconnect-impact.ts`

**Intent**: `keeps` is built entirely around the hand-entered/durable distinction
— *"the recorded absences you entered by hand"*, the roster, the team-wide days
off (`:150-157`) — and cadence, which is now exactly that kind of thing, is absent
from it. `grep -i cadence` over every pre-action copy module returns zero hits.

**Contract**: both Jira roots gain a `keeps` fragment naming the surviving
cadence, in the module's shape-checked style (no leading capital, no trailing
period, `:225-226`) — for `jira` and for `projectSwitch` alike. `destroys[1]`
(*"every sprint, ticket and status-change history **synced** from it"*) is
**not** edited: the word "synced" stops being a misdescription on its own, because
the hand-entered part no longer lives in that table.

#### 2. The declared clause

**File**: `src/components/organisms/settings/integration-card-copy.ts`

**Intent**: `COMMITMENT_FREEZE_CLAUSE` (`:189-206`) is the declared hand-written
exception for the *other* non-FK survivor of the same delete, with its own
reasoning — *"A hand-written clause hidden inside a module whose header claims
everything is derived is how the next reader stops trusting either half; this is
that clause, declared."* Cadence is the same shape of problem and has nothing.

**Contract**: a `CADENCE_RETENTION_CLAUSE` following that template exactly,
declaring why it is hand-written (the record's survival is a property of having no
FK, which the FK graph cannot express as a positive fact), pinned by a test
asserted against the exported constant so the sentence and the clause cannot
drift apart — the pattern at `integration-card-copy.test.ts:151-162`. Budget the
coupling at `:184`, which forces `reconnectCost` to quote every fragment of its
source entry.

#### 3. The structural regression

**File**: `src/lib/integrations/disconnect-impact.test.ts`

**Intent**: The guard consumes only `collectEdges()` and asserts set equalities
over table names, so it can never see a column-level loss. It CAN see the thing
that actually matters now: whether the new table ever acquires a foreign key that
puts it back in the cascade.

**Contract**: a named regression in the shipped style (`:140-183` is the pattern)
asserting `sprint_cadence_override` is absent from `deriveImpact`'s destroyed set
for **every** root and from every declared `destroyedTables`; plus a copy
assertion mirroring `:239-243` that both Jira roots name the surviving cadence
among what stays. Roughly 30 lines, no new mechanism, and explicitly **not** a
column registry.

#### 4. The workspace-URL identity gap

**File**: `src/lib/integrations/jira-store.ts` (`:210-212`)

**Intent**: `projectChanged` compares the Jira-side project id string alone, and
`workspaceUrl` is stored, normalized and displayed but never compared anywhere in
`src/`. Jira Cloud project ids are unique per instance and conventionally start at
`10000`, and `/settings/connections/jira:51-65` explicitly offers "Reconnect Jira"
over an existing credential. Today the switch-delete masks the collision for
cadence; **after this slice the record deliberately survives that delete**, so a
Jira-instance re-point with a colliding sprint id would make the new sprint adopt
the old team's cadence. Same class as S-26 impl-review F2 — which this slice would
re-create for a new payload.

**Contract**: the `previous` read that already computes `projectChanged`
(`:204-212`) also reads the existing credential's `workspace_url`;
`projectChanged` becomes true when **either** the Jira-side project id **or** the
normalized workspace URL differs. Stored values are already canonical
(`normalizeWorkspaceUrl`, `jira.ts:168`, applied at `setup/jira/actions.ts:125-127`),
so this is a string equality, not a new normalizer.
`connection-service.ts:430` needs no change — the settings project switch cannot
change the credential, so the workspace URL cannot move on that path; say so in a
comment rather than adding a second unreachable predicate. The resolver's
project-scoped inheritance (Phase 1) closes the other half.

#### 5. The dead-end route

**Files**: `src/components/organisms/settings/jira-project-editor.tsx:167`,
`src/components/organisms/settings/jira-project-editor-copy.ts:82-87`,
`src/components/organisms/settings/cadence-editor.tsx:232`

**Intent**: After a project switch has deleted every `sprint` row, the editor
sends the lead to `/team/cadence`, which renders `no_sprint`, whose restore button
is `disabled={initialCadence == null}` and whose save throws `NoSprintRowError`.
The copy promises a control that cannot be operated. This slice is what gives the
page something to show — the override record now survives the switch.

**Contract**: the `no_sprint` state (`cadence-editor-view.ts:30-47`) reports the
surviving override where one exists and says the values will attach to the next
imported sprint; the copy at `jira-project-editor-copy.ts:85-86` stops promising
an operable control at a moment when there is no sprint row, and names the sync
that will create one. The button's `disabled` predicate is unchanged where there
is genuinely nothing to restore from.

#### 6. The reader guard

**File**: `src/lib/cadence-override-readers.test.ts` (new)

**Intent**: The columns stay on `sprint`, so nothing but a test can stop a future
reader from picking up the stale copy. Follows `src/lib/demo/boundary-inventory.test.ts`
exactly — a hermetic source scan with a file allowlist, which is the shape this
repo already trusts after a hand-maintained enumeration went stale three times.

**It lands HERE, not in Phase 2 (plan review F2)**, because it cannot go green
before the identifier has left the UI layer. Seven non-test files carry
`cadenceOverridden` today — `setup/team/page.tsx:79`, `team/cadence/page.tsx:56`,
`roster-store.ts:1081`, `cadence-editor-view.ts:35`, `cadence-editor.tsx:61`,
`setup/cadence-form.tsx:76`, `anomaly/test-support.ts:42` — and Phase 3 is what
removes the first six.

**Contract**: scans `src/**/*.{ts,tsx}` (excluding tests) for two things and fails
when either appears outside the allowlist. First, the identifier
`cadenceOverridden`. Second — and NOT the single dotted spelling
`sprint.workingDays`, which is the trap (plan review F4): a case-sensitive scan
for that string matches `snapshot.sprint.workingDays` and `capacity.ts:279` while
missing both other spellings live in the repo today, `activeSprint.workingDays`
(`setup/team/page.tsx:76`, `team/cadence/page.tsx:53`) and `row.workingDays`
(`roster-store.ts:985`) — and `db.select().from(sprint)` followed by `.workingDays`
on the result is precisely the future reader this guard exists to stop. So the
second scan is for the bare property access `.workingDays` in any file that also
references the `sprint` table or the `SelectSprint` type; the two conditions
together keep the allowlist short.

The allowlist: `src/db/schema.ts`, `src/lib/integrations/reconcile-sprint.ts`
(the writer), `src/lib/demo/fixture.ts`, `src/lib/cadence-override.ts`, and
`src/lib/anomaly/test-support.ts` — the last belongs there permanently rather than
by glob accident: it builds a `SelectSprint` literal, the column stays NOT NULL,
so the field cannot be dropped there while the column exists. The allowlist IS the
contract; the test's message must say so, say why the columns still exist, and
name what the scan CANNOT see — a read in a file that mentions neither the table
nor the type is invisible to it, and that limit belongs in the message rather than
in a reviewer's memory.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run typecheck && npm run lint`
- Unit suite green, including the new `disconnect-impact.test.ts` regression, the
  copy assertions, the `CADENCE_RETENTION_CLAUSE` pin and **the reader guard**:
  `npm test`
- `disconnect-confirm-copy.test.ts` and `integration-card-copy.test.ts` green,
  including `:184`'s fragment-quoting coupling
- An integration test for the identity gap: reconnecting against a DIFFERENT
  workspace URL with the SAME Jira project id takes the changed branch, and no
  cadence record is inherited across it: `npm run test:integration`

#### Manual Verification:

- The Jira disconnect dialog names the surviving cadence among what it keeps
- After a project switch, the "Import sprint cadence" route lands on a page that
  says something true about what is there

---

## Phase 6: E2E, manual tests and bookkeeping

### Overview

The copy↔code contradiction this slice closes is visible only on the surface a
lead sees, and no spec under `e2e/` touches `/team/cadence`, the restore dialog,
or the wizard's cadence step. This phase adds the one that matters, then closes
the paperwork.

### Changes Required:

#### 1. The E2E spec

**File**: `e2e/cadence-restore.spec.ts` (new)

**Intent**: Assert at the browser level the promise the dialog makes: restore
returns length and start day to Jira's and leaves the working days alone.

**Contract**: driven through `/10x-e2e` per CLAUDE.md, not hand-written here.
Locators are `getByRole` / `getByLabel` / `getByText`; no
`page.waitForTimeout`; the test seeds its own account with a unique timestamp
suffix and cleans up after itself.

**How the spec gets a sprint row (plan review F5).** `e2e/accounts.ts:109-111`
does not license "set it through the UI" — it says the opposite: *"Deliberately
NOT seeded: sprint, tickets, commits"*. Without a `sprint` row `/team/cadence`
renders the `no_sprint` state, the restore button is `disabled`, and `saveCadence`
throws `NoSprintRowError` (`roster-store.ts:1057-1058`), so there is nothing for
the spec to drive. The route is the Jira fixture server the setup specs already
use — `e2e/jira-fixture-server.mjs`, booted by `playwright.config.ts:91` on port
3098 with the app pointed at it: the spec walks `/setup/jira` against the fixture
so the reconciler mints a REAL sprint row, then sets Mon–Thu on `/team/cadence`
and presses Restore.

**This costs three fixture endpoints it does not have.** The fixture serves only
`/rest/api/3/myself`, `/project/search` and `/project/{id}/statuses`
(`jira-fixture-server.mjs:39-70`); `reconcileActiveSprint` additionally calls the
**agile** API — `listBoards` and `getActiveSprint` — and returns `no_board` against
a 404. So Phase 6 adds `/rest/agile/1.0/board` and `/board/{id}/sprint` to the
fixture, serving one board and one dated active sprint whose derived length and
start day DIFFER from what the spec then sets by hand, so "restore returned length
and start day to Jira's" is an assertable change rather than a coincidence. Budget
this as part of the phase; it is the reason `/team/cadence` has zero E2E coverage
today.

#### 2. The manual checklist

**File**: `context/changes/cadence-override-retention/MANUAL-CHECKLIST.md` (new)

**Intent**: Four rows, each carrying the four things a row needs — where, what to
do, what must be true, why it matters (CLAUDE.md).

**Contract**: (1) the production migration, run BEFORE every other row; (2) set
Mon–Thu, disconnect Jira choosing keep, reconnect — the pattern survives; (3)
press Restore — working days survive, length and start day change; (4) switch the
monitored Jira project — the cadence survives and `/team/cadence` is operable.

#### 3. The backlog and the roadmap

**Files**: `context/foundation/manual-test-backlog.md`,
`context/foundation/roadmap.md`, `context/foundation/prd.md`

**Intent**: Keep the three sources of manual-test truth equal, record the FR-007
amendment, and open the follow-up this slice deliberately defers.

**Contract**: run `node scripts/manual-test-sweep.mjs` and act on it before the
epilogue commit. Backlog row 3.6 (`:217-220`) is annotated — it closed on live
data and explicitly disclaimed the INSERT branch, which is the branch this slice
changes. FR-007's Socratic block gains a dated note: the override now lives in a
record that outlives the credential, and working days are lead-owned with no
upstream, so their protection is independent of the auto-pull flag governing the
other two. Roadmap S-30 closes. The follow-up it defers is **already on the roadmap as
S-32** ("Retire what S-30 leaves behind" — the `sprint.working_days` /
`cadence_overridden` DROP plus the pruning of override records, added at plan
review): check its prerequisites still read as written rather than opening a
second line for the same work.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm run lint && npm run typecheck && npm test && npm run test:integration`
- E2E spec passes: `npm run test:e2e` (not in parallel with another worktree —
  CLAUDE.md)
- `node scripts/manual-test-sweep.mjs` exits zero

#### Manual Verification:

- The four `MANUAL-CHECKLIST.md` rows, in order, with row 1 first

---

## Testing Strategy

### Unit Tests:

- `pickCadence`: all four tiers; per-field NULL falls to tier 3 and **not** to
  tier 2; every `CadenceSource` value; a reordered working-day set is not an edit
- The reader guard: `cadenceOverridden`, and `.workingDays` in a file that also
  names the `sprint` table or `SelectSprint`, appear only in the allowlisted files
- `cadence-editor-view.ts`: the mixed state — working days hand-set, length and
  start day following Jira — renders a body that says both
- Copy: `CADENCE_RETENTION_CLAUSE` pinned against the exported constant; both
  Jira roots' `keeps` name the cadence

### Integration Tests:

- Resolver: project-scoped (twin of case (t) `:655-687`), cross-owner (twin of
  case (r) `:641`), and ordered against the sprint's own `start_date`
- Save: a source-equal save on a sprint that would otherwise inherit leaves a
  three-NULL row and the resolver returns the source; a Mon–Thu save leaves a row
  with `length_days` and `start_day` NULL
- Restore: working days survive, length and start day return to Jira's — the
  reversal of `roster-store.integration.test.ts:705`
- Restore against a failed Jira call: nothing is written (the existing
  `:709-732` case, extended)
- Restore against `board_ambiguous`: nothing is written and the override stands
  — the no-exception case, and reachable because `importCadence` passes
  `storedBoardId: null` unconditionally
- Restore on a sprint whose cadence is INHERITED: the row is created with length
  and start day NULL and the inherited working days materialised, so the
  inherited length does not survive and the pattern does
- Rollover: sprint N's override applies to sprint N+1 with no write at rollover
- Disconnect (keep) → reconnect: the override survives
- Project switch: the override survives; a switch to a different Jira-side
  project does not inherit
- Reconnect against a different workspace URL with a colliding project id: the
  changed branch fires, nothing is inherited
- The sweep recomputing an unfinalized closed sprint uses that sprint's cadence
- A cycle falling back to the default while a record exists elsewhere writes
  `cadence_default_fallback`

### Manual Testing Steps:

See `MANUAL-CHECKLIST.md`. The production migration is row 1 and gates the rest.

## Performance Considerations

The resolver adds at most two indexed selects per cadence read. Both are covered
by `sprint_cadence_override_owner_sprint_uq` and
`sprint_cadence_override_series_idx`. The second select runs only when the first
misses, so the steady state for an account with a current override is one round
trip. In `getSprintCapacityFor` and `loadSprintSnapshot` the resolve joins an
existing `Promise.all` and adds no serial latency.

The sweep iterates every sprint row the owner has (`sweep.ts:111-115`) and now
resolves per row. At the PRD's retention bound — current plus two sprints — that
is a handful of rows per owner per cycle.

## Migration Notes

`0023` is **additive**: one `CREATE TABLE` plus a backfill — the exported
`BACKFILL_CADENCE_OVERRIDES` statement, `ON CONFLICT DO NOTHING` so it is safe to
run again — that is a measured no-op (local: six rows, all `cadence_overridden = f`; production: zero `sprint`
rows). No column is dropped, so a revert of this slice is a code revert.

**Named route to production** (`lessons.md`: a phase that adds a migration is done
when the migration has a named route, and a green deploy is never evidence of a
migrated database — schema and code travel on different tracks here): the
production Supabase host is IPv6-only and unreachable from this Mac via
drizzle-kit, so the route is the **pooler connection string with
`DATABASE_URL_OVERRIDE`**, or the Supabase MCP `apply_migration` with the
drizzle bookkeeping row written by hand. Apply it BEFORE merging the code that
reads the new table, and re-run the pre-flight
`select count(*) from sprint where cadence_overridden = true;` immediately before
applying — today's zero is a fact about today, not a guarantee.

## References

- Frame brief: `context/changes/cadence-override-retention/frame.md`
- Research: `context/changes/cadence-override-retention/research.md`
- The record shape to copy: `src/db/schema.ts:461-470`, `:490`, `:541-547`
- The transaction to join: `src/lib/integrations/reconcile-sprint.ts:209`, `:278-302`
- The declared-clause template: `src/components/organisms/settings/integration-card-copy.ts:189-206`
- The hermetic-guard precedent: `src/lib/demo/boundary-inventory.test.ts`
- The house rule: `context/archive/2026-08-30-disconnect-data-retention/frame.md:118-127`
- The operator-log obligation: `context/foundation/lessons.md` (rule (a), the
  narrowing-predicate lesson)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The record and its resolver

#### Automated

- [x] 1.1 Migration applies cleanly against local Postgres — 86f69f7
- [x] 1.2 Type checking passes — 86f69f7
- [x] 1.3 Linting passes — 86f69f7
- [x] 1.4 Unit tests for `pickCadence` cover all four tiers and every `CadenceSource` — 86f69f7
- [x] 1.5 Integration tests for `resolveCadenceFor`: project-scoped, cross-owner, start_date-ordered — 86f69f7
- [x] 1.6 Integration test re-executes the exported backfill statement and asserts it, twice — 86f69f7

#### Manual

- [ ] 1.7 Migration has a named route to production and is applied there first

### Phase 2: The read seams

#### Automated

- [x] 2.1 Type checking passes — c1bec2f
- [x] 2.2 Linting passes — c1bec2f
- [x] 2.3 Unit suite green — c1bec2f
- [x] 2.4 Integration suite green with no behavioural assertion changed — c1bec2f
- [x] 2.5 Integration test: the sweep uses the closed sprint's own cadence — c1bec2f

#### Manual

- [ ] 2.6 Dashboard and Sprint Detail render unchanged numbers for an account with no override

### Phase 3: The write paths — save and restore

#### Automated

- [x] 3.1 Type checking and linting pass — 5dd0f03
- [x] 3.2 Unit suite green, including rewritten `cadence-editor-view.test.ts` — 5dd0f03
- [x] 3.3 Integration suite green, including the reversed `:705` assertion — 5dd0f03
- [x] 3.4 Integration case: restore preserves working days, resets length and start day — 5dd0f03
- [x] 3.5 Integration case: a source-equal save blocks inheritance instead of deleting the row — 5dd0f03

#### Manual

- [ ] 3.6 `/team/cadence` reports working days hand-set and length/start day following Jira
- [ ] 3.7 Restore leaves the Mon–Thu pattern intact

### Phase 4: The reconcile

#### Automated

- [x] 4.1 Type checking and linting pass
- [x] 4.2 Unit suite green
- [x] 4.3 Integration suite green, including reconcile cases (c), (d), (i), (k)
- [x] 4.4 A direct test for the force branch, which has none today
- [x] 4.5 Case (k) asserts `workingDays`
- [x] 4.6 Rollover integration case: inheritance with no write at rollover
- [x] 4.7 A default-fallback cycle finalizes with `cadence_default_fallback`

#### Manual

- [ ] 4.8 A sync on an account with a hand-set cadence changes nothing
- [ ] 4.9 Disconnect (keep) → reconnect → cycle: the working days survive

### Phase 5: Copy, the contract, and the identity gap

#### Automated

- [ ] 5.1 Type checking and linting pass
- [ ] 5.2 Unit suite green, including the disconnect-impact regression, the clause pin and the reader guard
- [ ] 5.3 `disconnect-confirm-copy` and `integration-card-copy` suites green
- [ ] 5.4 Integration test: reconnect against a different workspace URL takes the changed branch

#### Manual

- [ ] 5.5 The disconnect dialog names the surviving cadence
- [ ] 5.6 After a project switch, "Import sprint cadence" lands somewhere truthful

### Phase 6: E2E, manual tests and bookkeeping

#### Automated

- [ ] 6.1 Full suite green (lint, typecheck, unit, integration)
- [ ] 6.2 E2E spec passes
- [ ] 6.3 `node scripts/manual-test-sweep.mjs` exits zero

#### Manual

- [ ] 6.4 The four `MANUAL-CHECKLIST.md` rows, row 1 first
