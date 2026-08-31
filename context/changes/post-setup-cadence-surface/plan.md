# Cadence after setup (S-29) — Implementation Plan

## Overview

Finishing the setup wizard currently opts an account out of FR-007's auto-pull
forever: `saveCadence` sets `cadence_overridden = true` unconditionally, and that
action *is* what finishes the wizard. Whatever `deriveCadence` produced at that
minute is then frozen for the account's lifetime — and the only surface that
could correct it is unreachable, while between sprints its write silently
persists nothing and still reports success.

This plan fixes the lifecycle first and adds the screen last: the write keys on
the same row the read returned and reports rows-affected; the override flag flips
only when the lead actually changes a value; a migration unfreezes every account
that never chose; a new action hands the cadence back to Jira; and `/team/cadence`
becomes a reachable, non-wizard surface worth trusting.

## Current State Analysis

**One mount, no route.** `CadenceForm` is mounted exactly once repo-wide
(`src/app/(app)/setup/team/page.tsx:104`). `/settings` carries four tabs
(`settings/layout.tsx:22-30`), `/team` three (`team/layout.tsx:18-24`); none is
cadence. The only in-app link back (`jira-project-editor.tsx:169-171`) renders
only after a Jira project switch, and its own comment says "A Settings-local
cadence surface is a separate slice" — this slice.

**The read is wider than the write.** The page reads through
`getActiveSprintRow` (`src/lib/sprint.ts:20-42`), whose second tier is
state-unscoped and returns the most-recently-started row. `saveCadence` UPDATEs
`where owner_id AND state = 'ACTIVE'` (`roster-store.ts:1003`). Between sprints
the form pre-fills from a CLOSED row and the UPDATE matches zero rows.
`saveCadence` *does* return `{updated: rows.length}` (`:1006`) —
`actions.ts:396` discards it and returns unconditional `{ok: true}`. The sibling
`setMemberActive` (`roster-store.ts:653-660`) throws on zero rows; the guard
already exists 350 lines above in the same file. No test covers the zero-row case.

**The flag means the wrong thing.** `roster-store.ts:1001` sets
`cadenceOverridden: true` with no comparison against what was stored, and
`actions.ts:373` labels itself "THIS IS WHAT FINISHES THE WIZARD". So *confirming*
the derived values is recorded as *overriding* them, and
`reconcile-sprint.ts:346-348` then faithfully preserves that freeze on every
future sync. Verified on the live database: the one real onboarded account has
`cadence_overridden = t` and `start_day = FRI` because its sprint was started in
Jira on a Friday evening; the five rows that never went through the wizard are
all `f`.

**Provenance splits three ways, and the form's copy is false for one of them.**
`length_days` and `start_day` are derived from the sprint's Jira dates
(`cadence.ts:66-88`) and read by nothing outside the form and the writers
(`availability-view.ts:40-43` states this in the source). `working_days` is the
hard-coded constant `MON..FRI` (`cadence.ts:19-26`) — Jira exposes no such field
— yet `cadence-form.tsx:203` presents all three as "Pulled from your active
sprint". Since S-28, `working_days` drives capacity (`dashboard/capacity.ts`),
the measurement sweep (`measurement/sweep.ts`), the days-off editor, and all five
time-based anomaly rules (`anomaly/rules/working-time.ts` and its four callers).

**"Pull from Jira" is itself override-aware.** `importCadence`
(`roster-store.ts:838-940`) is a thin wrapper over `reconcileActiveSprint`, whose
CONFLICT branch keeps the stored cadence when `cadence_overridden` is true. On an
overridden account, pressing "Pull from Jira" therefore returns the *stored*
values, not fresh ones — a restore built naively on top of it would be a third
silent no-op.

**Rollover already carries an override.** `reconcile-sprint.ts:191-209` reads the
owner's most-recently-started row regardless of state, so an override written
onto a CLOSED row does survive the next rollover. Pinned by three integration
tests (`reconcile-sprint.integration.test.ts:257,280,458`).

### Key Discoveries

- `saveCadence` returns rows-affected and the caller throws it away —
  `roster-store.ts:1006` vs `actions.ts:396`.
- `getActiveSprintRow` is already the single shared resolver for the wizard
  (`setup/team/page.tsx:69`), the anomaly engine (`anomaly/load-snapshot.ts:40`)
  and the days-off page (`team/days-off/page.tsx:36`). The write is the one
  place that hand-rolls a narrower predicate.
- `ActionFailure.error` is a closed union (`actions.ts:106-118`); adding
  `no_sprint` there is the established way to name a new refusal.
- `team/days-off/page.tsx:52` already receives `sprint.workingDays` as a prop and
  computes its copy from it — cadence and the company calendar are one model, and
  `/team` is where that model already lives.
- No component-test harness exists (CLAUDE.md), so any decision logic in a
  `.tsx` must move to a pure `.ts` sibling to be testable — the precedent is
  `team-days-off-view.ts`, `availability-view.ts`, `setup-doorstep-view.ts`.
- Latest migration is `0021_tricky_electro.sql`; `db:generate` is plain
  `drizzle-kit generate`, so a data-only migration needs `--custom`.

## Desired End State

- `cadence_overridden` means "the lead deliberately changed this", never "the
  lead finished setup". Confirming the derived values without editing leaves the
  account on auto-pull.
- A cadence save either changes exactly one named row or fails with a message
  that says why. No path returns `{ok: true}` having written nothing.
- Every existing account is back on auto-pull, so a Jira-side cadence change now
  reaches the row again instead of being discarded by a flag nobody set.
  **`FRI` does not disappear on its own**: `deriveCadence` reads `start_day` off
  the sprint's own `startDate` (`cadence.ts:83`), and that sprint really was
  started on a Friday evening — so auto-pull keeps deriving `FRI` until a sprint
  starts on another weekday. What changes is that the lead can now correct it on
  `/team/cadence`, and the override that records the correction finally means
  "the lead chose this".
- `/team/cadence` is reachable from the Team tab strip, shows all three fields
  with honest provenance, saves without leaving the page, and offers a way back
  to Jira's values.
- Between sprints — the exact moment a lead revises a cadence — the surface saves
  onto the CLOSED row the rest of the app already detects against.

Verified by: the integration suite (zero-row, dirty-check, restore ordering), the
e2e doorstep spec, and the manual rows in `MANUAL-CHECKLIST.md`.

## What We're NOT Doing

- **Not moving cadence off the `sprint` row.** An account-level cadence model is
  S-30's modelling question; this plan keys the write on `sprint.id` and leaves
  the ownership question open. A disconnect still loses the override.
- **Not creating a placeholder sprint row** when none exists. `jira_sprint_id` is
  NOT NULL and unique per owner; an invented key would collide with a real
  rollover, and that is the account model arriving by the back door.
- **Not adding an explicit "don't sync with Jira" toggle.** The flag is derived
  from a dirty-check in one place; two mechanisms writing it would reproduce the
  read/write drift this slice exists to close.
- **Not deriving working days from a country** (S-17), **not projecting an
  unstarted sprint** (S-18), **not fixing `jira_project.time_zone` nulling on a
  project switch** (backlog row 28.A). The Reconnect/Disconnect affordance
  (**S-31**) shipped and was archived on 2026-08-31 (PR #97) while this plan was
  in review — it is not re-opened here. Its one overlap with this slice is
  layout-only: it added `w-full` to four `jira-project-editor.tsx` branches, so
  the link Phase 5 §2 retargets is untouched in substance.
- **Not re-litigating the settled safe behaviour**: the override survives a sync
  and a rollover, and re-entering `/setup/team` fires no auto-write for an
  onboarded lead.

## Implementation Approach

Fix the mechanism before building on it. Phases 1–3 are all service-and-action
work with integration coverage and no new UI, so each defect is closed against a
test rather than against a screenshot. Phase 4 adds the surface once the write
underneath it is truthful. Phase 5 spends the remaining budget on the copy and
the links that made the gap invisible in the first place.

The shared-resolver discipline is the spine: `saveCadence` stops hand-rolling a
predicate and calls `getActiveSprintRow` — the same function the page, the
anomaly snapshot and the days-off editor already use — so "the row the lead is
looking at" and "the row the save writes" become the same sentence.

## Critical Implementation Details

**Timing & lifecycle — the restore carries its intent INTO the reconcile; it
never clears the flag beforehand.** `importCadence` runs through
`reconcileActiveSprint`, whose CONFLICT branch is
`case when cadence_overridden then <existing> else <proposed> end`
(`reconcile-sprint.ts:346-348`). Reconciling first and clearing the flag
afterwards refreshes nothing and reports success — the same defect shape this
slice is closing, in a new place. But clearing FIRST as a separate UPDATE is
worse: every Jira network call in `reconcileActiveSprint` runs *before* its
transaction opens (`:35`, calls at `:138,:147,:167`), so an invalid token, a rate
limit or a dropped connection throws with the clear already committed. The action
then reports failure while the account is silently back on auto-pull, and the
next 15-minute sync overwrites the lead's deliberate cadence with Jira's —
moving capacity and all five time-based anomaly rules (S-28) off a value nobody
chose to change. Neither order is safe, so there is no pre-clear: the restore
passes `forceCadenceRefresh` into the reconcile, and the flag is cleared by the
same statement that refreshes the columns, inside the one transaction. A failed
pull leaves the row exactly as it was.

**State sequencing — an unchanged save must omit the column, not write `false`.**
The dirty-check decides whether to *set* `cadence_overridden = true`. When the
submitted cadence equals the stored one, the UPDATE must leave the column out of
its SET entirely: writing `false` would silently un-override a lead who genuinely
overrode earlier and then re-saved an unrelated field.

**Debug & observability — rows-affected is the contract, not a diagnostic.**
`saveCadence` already returns `{updated}`; the action must branch on it. Per
`lessons.md` ("a narrowing predicate turns 'wrong value' into 'empty result',
which reads as success"), an empty result here is a failure to report, not a
successful no-op.

---

## Phase 1: The write stops lying

### Overview

`saveCadence` keys on the row the read returned, reports what it changed, and
flips `cadence_overridden` only on a real edit. `saveCadenceAction` surfaces the
zero-row case as a named refusal instead of `{ok: true}`.

### Changes Required

#### 1. Cadence write service

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Resolve the target sprint through the same reader the form used,
update that row by id, and make the override flag mean a deliberate change.
Resolving *inside* the service rather than taking a `sprintId` argument is what
stops the wizard action and the new Settings action from drifting apart again.

**Contract**: `saveCadence({db, ownerId, cadence})` keeps its signature and
returns `{updated: number; overridden: boolean}`. It calls
`getActiveSprintRow(db, ownerId)`; on `null` it throws a new exported
`NoSprintRowError` (beside `UnknownMemberError` / `LastMemberError`). The UPDATE
is `where id = row.id and owner_id = ownerId` — the owner predicate stays even
though the id came from an owner-scoped read, matching the corollary in
`lessons.md` on differential upserts. `cadenceOverridden: true` is included in
the SET **only** when the submitted cadence differs from the row's stored values;
weekday arrays are compared canonicalised to Mon→Sun order, so a reordered
identical set is not an edit. **Both sides of that comparison are normalised
through the same defaults the read applied** — all three columns are nullable
(`schema.ts:438-440`) and `setup/team/page.tsx:67-77` coalesces them to
`14` / `"MON"` / `DEFAULT_WORKING_DAYS` before the form ever sees a value.
Comparing a submitted `14` against a stored `NULL` would score an untouched
confirm as an edit and re-freeze the account — the read-wider-than-write shape
this slice exists to close, one layer down. `updated === 0` after a by-id UPDATE is
unreachable and throws `NoSprintRowError` too rather than returning quietly.

#### 2. Action failure mapping

**File**: `src/app/(app)/setup/team/actions.ts`

**Intent**: Stop discarding the service's answer, and give the zero-row state a
name the UI can render.

**Contract**: `ActionFailure["error"]` gains `"no_sprint"`. `SaveCadenceResult`
becomes `{ok: true; overridden: boolean} | ActionFailure`. `saveCadenceAction`
maps `NoSprintRowError` to
`{ok: false, error: "no_sprint", message: <copy naming that cadence is stored
against a sprint and none has been imported yet>}` and otherwise returns the
service's `overridden`. The existing `no_roster` pre-check and the demo/workspace
resolution are unchanged in behaviour — but the comment above it
(`actions.ts:373`, "THIS IS WHAT FINISHES THE WIZARD") stops being true of the
action as a whole in Phase 4, when `/team/cadence` becomes its second caller. It
is rewritten here, in the phase that touches the function, to name both callers
and to record that `no_roster` is reachable only from the wizard: an onboarded
lead on `/team/cadence` always has a `team_member` row, so its wizard-specific
copy ("Save your team roster first…") is unreachable there rather than merely
unlikely.

#### 3. Coverage for the three states that had none

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: Pin the between-sprints save, the dirty-check in both directions, and
the missing-row refusal.

**Contract**: New cases beside the existing override test (`:474-490`) — (a) an
owner whose only `sprint` row is CLOSED: `saveCadence` reports `updated: 1` and
the row carries the new values; (b) re-submitting the stored cadence unchanged
leaves `cadence_overridden` at its prior value, asserted from both `false` and
`true`, and once more against a row whose three cadence columns are `NULL` while
the submit carries the page's coalesced defaults — which must also count as
unchanged; (c) an owner with no `sprint` row: `saveCadence` rejects with
`NoSprintRowError`.

**File**: `src/app/(app)/setup/team/actions.integration.test.ts`

**Contract**: `saveCadenceAction` on an owner with no sprint row returns
`{ok: false, error: "no_sprint"}`; the happy path (`:274-282`) additionally
asserts `overridden` is `true` after a changed submit.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- A CLOSED-only account's cadence save persists (`updated: 1`), asserted in
  `roster-store.integration.test.ts`
- An account with no sprint row gets `{ok: false, error: "no_sprint"}` from
  `saveCadenceAction`, not `{ok: true}`
- An unchanged submit leaves `cadence_overridden` untouched from both `false` and
  `true`, including a NULL-cadence row confirmed with the page's defaults; a
  changed submit sets it to `true`

#### Manual Verification

- Finishing the setup wizard still lands on `/dashboard` and the sprint row
  carries the confirmed values, with `cadence_overridden` now `false` when
  nothing was edited

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 2: Unfreeze the accounts that never chose

### Overview

Every existing account carries an override it did not make. One data-only
migration clears the flag and leaves the values alone, so the next reconcile
refreshes `length_days` / `start_day` from Jira.

### Changes Required

#### 1. Data migration

**File**: `src/db/migrations/0022_<generated>.sql`

**Intent**: Reset `cadence_overridden` to `false` on every `sprint` row without
touching the cadence values, so the accounts frozen by the wizard rejoin
FR-007's auto-pull.

**Contract**: Generated with `npm run db:generate -- --custom --name=unfreeze_cadence_override`
(there is no schema diff, so the ordinary generate emits nothing and the journal
entry would be missing). Body is a single
`UPDATE "sprint" SET "cadence_overridden" = false;` — unqualified on purpose: the
flag is currently unreliable for *every* row, so a narrowing predicate would only
re-introduce the guessing this slice removes. Values are deliberately not reset:
the next reconcile is what corrects them, and only for accounts whose Jira
actually has an active sprint.

#### 2. Migration route to production

**File**: `context/changes/post-setup-cadence-surface/MANUAL-CHECKLIST.md`

**Intent**: Name the route before any manual row depends on the new state
(`lessons.md`: "a deploy that ships code but not migrations breaks silently").

**Contract**: A first row applying `0022` to production via the Supabase MCP
`apply_migration` path plus the hand-written `drizzle.__drizzle_migrations`
bookkeeping — `drizzle-kit` cannot reach the production host from this machine.
The row runs before every other row in the file.

### Success Criteria

#### Automated Verification

- Migration applies cleanly locally: `npm run db:migrate`
- Integration tests pass against the migrated database: `npm run test:integration`
- Type checking passes: `npm run typecheck`

#### Manual Verification

- `0022` applied to production; the one real onboarded account reads
  `cadence_overridden = f`
- Auto-pull reaches that account again: after the next sync its `length_days`
  and `start_day` match what the sprint's current Jira dates derive. (`FRI` is
  expected to STAY `FRI` — that sprint started on a Friday. This row verifies
  the values track Jira, not that any particular value changed.)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Hand the cadence back to Jira

### Overview

A lead who overrode by accident — or whose Jira config has since been corrected —
needs a way back to auto-pull. The reconcile is told to ignore the flag and to
clear it, so the whole restore is one transaction that a failed Jira call leaves
untouched.

### Changes Required

#### 1. The reconcile learns to be told "ignore the override"

**File**: `src/lib/integrations/reconcile-sprint.ts`

**Intent**: Give the one place that already owns the flag a way to refresh past
it, so the restore needs no second writer and no window between two statements.

**Contract**: `reconcileActiveSprint` takes `forceCadenceRefresh?: boolean`,
defaulting to `false`. When set, the CONFLICT branch (`:346-348`) drops its three
`case when` wrappers and assigns the proposed cadence outright, and adds
`cadenceOverridden: false` to the same SET — one statement, inside the existing
transaction. The INSERT branch's `carry` (`:305-320`) takes the non-overridden
side for the same reason, so a restore that races a rollover does not resurrect
the override it was asked to drop. **The 15-minute sync never passes it**: the
default keeps `run-sync` and every existing caller byte-identical, which is what
makes this safe to add to a shared path. Assert that in a test rather than in a
comment.

#### 2. Restore service

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Hand the restore's intent to the reconcile and let it do both halves
atomically — no pre-clear, no compensating write.

**Contract**: `restoreCadenceFromJira({db, ownerId, env, jiraBaseUrl, jiraOpts})`
returns `ImportCadenceResult`. It resolves the row via `getActiveSprintRow` and
throws `NoSprintRowError` when there is none — the check is for the caller's
benefit, not the write's — then delegates to `importCadence` with the same
arguments plus `forceCadenceRefresh: true`, which `importCadence` passes straight
through to `reconcileActiveSprint`. It performs **no UPDATE of its own**; see
Critical Implementation Details for why a pre-clear is the wrong shape. When
`importCadence` comes back with `noActiveSprint: true` nothing was written — the
flag is still set and the account is unchanged, which is the honest outcome for
"there is nothing to restore from"; the result carries it to the caller rather
than presenting `DEFAULT_CADENCE` as a pull.

#### 3. Restore action

**File**: `src/app/(app)/setup/team/actions.ts`

**Intent**: Expose the restore with the same guards `importCadenceAction` uses,
because it spends the account's real Jira credentials.

**Contract**: `restoreCadenceAction(): Promise<ImportCadenceResult>` resolves
through `workspaceForImport()` (`requireRealWorkspace` + the demo flag), returns
`demoRefusal()` in demo, and maps `NoSprintRowError` to `no_sprint`. Logged tag
`[setup/team] restoreCadence`, no token in any return value.

#### 4. Atomicity coverage

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: Pin the two properties a naive implementation gets wrong — the
refresh past the flag, and the fact that a failed pull writes nothing.

**Contract**: Three cases. (a) An account with `cadence_overridden = true` and
cadence values that differ from what its Jira fixture would derive: after
`restoreCadenceFromJira` the row's cadence columns equal the derived values and
`cadence_overridden` is `false`. (b) The same account with a `fetchImpl` that
rejects: the call rejects, and the row still carries **both** its overridden
values and `cadence_overridden = true` — this is the case a pre-clear would fail.
(c) An ordinary `importCadence` (no `forceCadenceRefresh`) on an overridden
account still preserves the override, so the default did not change the sync
path; the existing test at `:474-490` already asserts this and is the regression
guard for the new parameter.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Restore on an overridden account refreshes the cadence columns and clears the
  flag
- A restore whose Jira call fails leaves the row's cadence AND its override flag
  exactly as they were
- `importCadence` without `forceCadenceRefresh` still preserves an override
- `restoreCadenceAction` refuses with `demo_mode` while the workspace is demo

#### Manual Verification

- None for this phase — the surface that calls it arrives in Phase 4

---

## Phase 4: `/team/cadence`

### Overview

A reachable, non-wizard screen: all three fields editable, each labelled with
where its value came from, saving in place, with the restore from Phase 3 beside
it and an honest state when there is no sprint to write to.

### Changes Required

#### 1. Shared cadence fields

**File**: `src/components/organisms/setup/cadence-fields.tsx`

**Intent**: Lift the three form controls out of `CadenceForm` so the wizard and
the new editor cannot drift into two spellings of the same cadence.

**Contract**: A presentational client component taking the
`react-hook-form` control for `CadenceValues` plus a `provenance` flag, rendering
the length / start-day / working-days fields exactly as `cadence-form.tsx:262-355`
does today. No actions, no router, no submit button — the two owners keep their
own footers. When `provenance` is on, each field carries its source: length and
start day derived from the sprint's Jira dates, working days SprintFlow's own
Mon–Fri default with no Jira source.

#### 2. The editor's decision logic

**File**: `src/components/organisms/settings/cadence-editor-view.ts`

**Intent**: There is no component-test harness, so the banner state machine and
the provenance copy live in a pure module that unit tests can reach — the
established pattern (`team-days-off-view.ts`, `setup-doorstep-view.ts`), and the
one S-31 has just re-affirmed at the largest scale yet in
`integration-card-copy.ts` + its 246-line test, where the card's strings are
DERIVED from the model they describe so the promise cannot outlive it.

**Contract**: Exports the view state for the editor as a discriminated union over
`no_sprint` (nothing to write to), `no_active_sprint` (writing onto a closed
sprint), `overridden` (auto-pull is off for this account) and `in_sync`, plus the
per-field provenance strings and the label for the save button. Pure, no React,
no `Date` construction.

It additionally exports the message for the **restore's own outcomes**, which are
not the same set: a restore that pulled reports that Jira's values are back and
auto-pull is on, while a restore that came back `noActiveSprint: true` must say
that there is no sprint in Jira to restore *from* — after the Phase 3 fix nothing
was written and **the override is still in force**, so copy claiming auto-pull is
back on would be false. That is the honest state, and it is the one a lead
between sprints will actually hit.

**File**: `src/components/organisms/settings/cadence-editor-view.test.ts`

**Contract**: One case per state, plus the provenance strings, plus both restore
outcomes — the `noActiveSprint` message must not claim the override was lifted.

#### 3. The editor organism

**File**: `src/components/organisms/settings/cadence-editor.tsx`

**Intent**: The post-setup counterpart to `CadenceForm` — same fields, different
job: it saves and stays, it never finishes a wizard, and it never redirects.

**Contract**: Client component taking the same `InitialCadence | null` shape the
wizard page builds. Submit calls `saveCadenceAction` and renders the result in
place — a success confirmation, or the failure's message, with `no_sprint`
rendering the explanatory state from `cadence-editor-view.ts` rather than a
generic error. A secondary "Restore Jira's values" control calls
`restoreCadenceAction` behind a confirmation, resets the form from the result,
and renders the restore outcome through `cadence-editor-view.ts` — including the
`noActiveSprint` case, where the form is left as it is (nothing was written) and
the message says there is nothing in Jira to restore from, rather than silently
showing defaults or claiming the override was lifted. No `exitDemoAction`, no
`router.push`.

#### 4. The route

**File**: `src/app/(app)/team/cadence/page.tsx`

**Intent**: Server component that reads the same row the anomaly engine detects
against and hands it to the editor.

**Contract**: Mirrors `team/days-off/page.tsx` — `resolveWorkspace()` (follows
the active workspace, like every other roster/cadence read), one `getDb` handle,
`getActiveSprintRow` + `getJiraTimeZone` in parallel, `toSprintIdentity` built
server-side. Inherits `requireSession()` + `force-dynamic` from
`(app)/layout.tsx`; does not re-declare either. Passes `initialCadence: null`
when no row resolves, which is the `no_sprint` state.

#### 5. The tab

**File**: `src/app/(app)/team/layout.tsx`

**Intent**: Make the screen reachable, and stop the shell's subtitle from
describing only two thirds of what it now holds.

**Contract**: A fourth entry `{label: "Sprint cadence", href: "/team/cadence"}`
after "Team days off", and a subtitle that covers the sprint's rhythm as well as
who the team is and when they are away.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass, including `cadence-editor-view.test.ts`: `npm test`
- Integration tests pass: `npm run test:integration`
- Production build succeeds: `npm run build`

#### Manual Verification

- `/team/cadence` is reachable from the Team tab strip and pre-fills with the
  stored cadence
- Changing working days and saving persists across a reload, and the dashboard's
  capacity figure moves with it
- On an account between sprints, the save reports success **and** the value is
  actually there after a reload
- "Restore Jira's values" returns the sprint's derived length and start day and
  reports that auto-pull is back on
- In demo, the restore refuses with the demo message rather than reaching Jira

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Close the loop — links, copy, and the backlog

### Overview

The gap was invisible partly because three pieces of copy asserted a surface that
did not exist. With the surface built, they become true — and the wizard moves
onto the shared fields so the two screens stay one cadence.

### Changes Required

#### 1. The wizard adopts the shared fields

**File**: `src/components/organisms/setup/cadence-form.tsx`

**Intent**: Replace the three inline fields with `cadence-fields.tsx`, keeping
every wizard-specific behaviour — "Save & finish setup", `exitDemoAction`, the
`/dashboard` push, the board chooser and the auto-pull effect — exactly as it is.

**Contract**: Behavioural no-op. Additionally, the description at `:203` stops
claiming all three values were pulled from the active sprint; the provenance now
lives per field.

#### 2. The Jira project editor points at the real surface

**File**: `src/components/organisms/settings/jira-project-editor.tsx`

**Intent**: After a project switch, send the lead to the cadence screen instead
of back into the wizard's Polish "Krok 4 z 4" stepper.

**Contract**: The link at `:169-171` targets `/team/cadence`; the comment block
above it (`:158-168`), which currently explains the seam by saying a
Settings-local cadence surface is a separate slice, is rewritten to record that
the slice landed. The label and the link stay inline — `jira-project-editor-copy.ts`
(S-26) owns the project-switch warning copy, not this button.

#### 3. The doorstep tells the truth

**File**: `src/components/organisms/setup/setup-doorstep-view.ts`

**Intent**: The onboarded-lead detail (`:96-102`) promises that changes are made
later "w Ustawieniach", which was self-refuting for cadence.

**Contract**: The copy names the Team section as where the roster, absences and
sprint rhythm live. **Nothing currently asserts this string** — grepping it
across `src/` and `e2e/` returns only the module itself, and
`setup-doorstep-view.test.ts:76-80` only checks that `detail` is truthy, so the
edit breaks no suite. Since the copy is now a promise about a route that exists,
give it a guard in the same phase.

**File**: `src/components/organisms/setup/setup-doorstep-view.test.ts`

**Contract**: The onboarded door's `detail` names the Team section rather than
Settings — a pure in-suite assertion, not an e2e one (`lessons.md`: guard the
thing you changed where the suite can actually reach it).

#### 4. Manual rows and the backlog

**File**: `context/changes/post-setup-cadence-surface/MANUAL-CHECKLIST.md`

**Intent**: 3–5 rows covering only what genuinely blocks the slice — the
production migration, the between-sprints save, and the restore.

**Contract**: Each row carries where / what to do / what must be true / why it
matters, and is signed off with its phase number so `## Progress` ticks in step.

**File**: `context/foundation/manual-test-backlog.md`

**Contract**: Every open row this slice creates appears in §1. `node
scripts/manual-test-sweep.mjs` exits zero.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- E2E passes (single suite, no other worktree running one): `npm run test:e2e`
- Manual backlog is complete: `node scripts/manual-test-sweep.mjs` exits 0
- Production build succeeds: `npm run build`

#### Manual Verification

- The setup wizard still finishes and lands on `/dashboard`, with the cadence
  fields rendering exactly as before
- After switching the monitored Jira project, "Import sprint cadence" lands on
  `/team/cadence`, not in the wizard

---

## Testing Strategy

### Unit Tests

- `cadence-editor-view.ts` — one case per view state (`no_sprint`,
  `no_active_sprint`, `overridden`, `in_sync`), the per-field provenance strings,
  and both restore outcomes (pulled / nothing to pull, the latter not claiming
  the override was lifted).
- The cadence comparison used by the dirty-check: reordered weekday arrays are
  equal; a stored `NULL` equals the default the read substitutes for it; a
  different working-day set, length or start day is not.

### Integration Tests

- Save onto a CLOSED-only account persists and reports `updated: 1`.
- Save with no `sprint` row rejects with `NoSprintRowError` / `no_sprint`.
- Unchanged submit preserves `cadence_overridden` from both `false` and `true`;
  changed submit sets it `true`.
- `restoreCadenceFromJira` refreshes the cadence columns on an overridden
  account and clears the flag, in one transaction; a restore whose Jira call
  rejects leaves both the values and the flag untouched.
- `importCadence` without `forceCadenceRefresh` still preserves an override —
  the guard that the new parameter left the 15-minute sync alone.
- `restoreCadenceAction` refuses in demo.

### Manual Testing Steps

1. Apply `0022` to production and confirm the real account reads
   `cadence_overridden = f`.
2. Open `/team/cadence`, uncheck Friday, save, reload — Friday is still
   unchecked, and the Sprint Detail capacity figure has dropped.
3. On an account between sprints, change the sprint length and save; reload and
   confirm the value persisted (this is the path that used to report success and
   write nothing).
4. Press "Restore Jira's values" on an overridden account and confirm the length
   and start day come back from the sprint's real dates.
5. Finish the setup wizard on a fresh account without editing anything and
   confirm the sprint row's `cadence_overridden` is `false`.

## Performance Considerations

None. Every added read is a single owner-scoped row lookup through the resolver
the page already calls; the restore adds one UPDATE ahead of an import that
already ran.

## Migration Notes

`0022` is data-only — no schema change, so `drizzle-kit generate` produces
nothing without `--custom`, and the `meta/_journal.json` entry must come from the
generator rather than by hand.

**Named route to production**: the production Supabase host is IPv6-only and
`drizzle-kit` cannot reach it from this machine, so the migration is applied via
the Supabase MCP `apply_migration` path with the `drizzle.__drizzle_migrations`
bookkeeping written by hand — the route established for `0021`. This runs as the
first row of `MANUAL-CHECKLIST.md`, before any manual row that depends on the
unfrozen state.

**Rollback**: re-setting `cadence_overridden = true` restores the frozen state
but not the values, which the next reconcile will already have refreshed. The
migration is deliberately one-way for that reason; the values it lets Jira
refresh are ones no lead chose.

## References

- Frame brief: `context/changes/post-setup-cadence-surface/frame.md`
- Roadmap S-29: `context/foundation/roadmap.md:1373-1406`; adjacent S-30 at
  `:1407-1441`
- Write: `src/lib/integrations/roster-store.ts:976-1007`; caller
  `src/app/(app)/setup/team/actions.ts:354-409`
- Read: `src/lib/sprint.ts:20-42`
- Reconciliation: `src/lib/integrations/reconcile-sprint.ts:191-209,336-352`
- Derivation: `src/lib/integrations/cadence.ts:19-26,66-88`
- Surface precedent: `src/app/(app)/team/days-off/page.tsx`,
  `src/app/(app)/team/layout.tsx`
- Zero-row guard precedent: `src/lib/integrations/roster-store.ts:653-660`
- Lessons: `context/foundation/lessons.md` — "empty result reads as success",
  "a deploy that ships code but not migrations breaks silently", "a parallel
  worktree cannot run the suite that guards the shape it is changing"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The write stops lying

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 4b67b4f
- [x] 1.2 Type checking passes: `npm run typecheck` — 4b67b4f
- [x] 1.3 Unit tests pass: `npm test` — 4b67b4f
- [x] 1.4 Integration tests pass: `npm run test:integration` — 4b67b4f
- [x] 1.5 A CLOSED-only account's cadence save persists (`updated: 1`) — 4b67b4f
- [x] 1.6 No sprint row yields `{ok: false, error: "no_sprint"}`, not `{ok: true}` — 4b67b4f
- [x] 1.7 Unchanged submit preserves the flag from both values and on a NULL-cadence row; changed submit sets it true — 4b67b4f

#### Manual

- [ ] 1.8 Wizard still finishes to `/dashboard`, and an unedited confirm leaves `cadence_overridden` false

### Phase 2: Unfreeze the accounts that never chose

#### Automated

- [x] 2.1 Migration applies cleanly locally: `npm run db:migrate` — 2c3bdc2
- [x] 2.2 Integration tests pass against the migrated database: `npm run test:integration` — 2c3bdc2
- [x] 2.3 Type checking passes: `npm run typecheck` — 2c3bdc2

#### Manual

- [ ] 2.4 `0022` applied to production; the real onboarded account reads `cadence_overridden = f`
- [ ] 2.5 After the next sync, that account's cadence matches what its Jira dates derive (`FRI` may legitimately stay)

### Phase 3: Hand the cadence back to Jira

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Type checking passes: `npm run typecheck`
- [x] 3.3 Unit tests pass: `npm test`
- [x] 3.4 Integration tests pass: `npm run test:integration`
- [x] 3.5 Restore on an overridden account refreshes the cadence columns and clears the flag
- [x] 3.6 A restore whose Jira call fails leaves the cadence AND the flag untouched
- [x] 3.7 `importCadence` without `forceCadenceRefresh` still preserves an override
- [x] 3.8 `restoreCadenceAction` refuses with `demo_mode` while the workspace is demo

### Phase 4: `/team/cadence`

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Unit tests pass, including `cadence-editor-view.test.ts`: `npm test`
- [ ] 4.4 Integration tests pass: `npm run test:integration`
- [ ] 4.5 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.6 `/team/cadence` is reachable from the Team tab strip and pre-fills correctly
- [ ] 4.7 Changed working days persist across a reload and move the capacity figure
- [ ] 4.8 Between sprints, the save reports success AND the value is there after a reload
- [ ] 4.9 "Restore Jira's values" returns the derived length and start day
- [ ] 4.10 In demo, the restore refuses instead of reaching Jira

### Phase 5: Close the loop — links, copy, and the backlog

#### Automated

- [ ] 5.1 Linting passes: `npm run lint`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Unit tests pass: `npm test`
- [ ] 5.4 Integration tests pass: `npm run test:integration`
- [ ] 5.5 E2E passes: `npm run test:e2e`
- [ ] 5.6 Manual backlog is complete: `node scripts/manual-test-sweep.mjs` exits 0
- [ ] 5.7 Production build succeeds: `npm run build`

#### Manual

- [ ] 5.8 The wizard still finishes to `/dashboard` with the fields rendering as before
- [ ] 5.9 After a Jira project switch, "Import sprint cadence" lands on `/team/cadence`
