---
date: 2026-08-31T14:49:35+02:00
researcher: Adam Reszka
git_commit: 010b7475021db18fac228353da12b83bc9fe0ed6
branch: feat/cadence-override-retention
repository: 10xdevs-certification-project
topic: "S-30 cadence override retention — write/read paths, the reconcile contract, working_days consumers, copy guards and pinning tests"
tags: [research, codebase, cadence, reconcile-sprint, working-days, disconnect-impact, sprint-measurement]
status: complete
last_updated: 2026-08-31
last_updated_by: Adam Reszka
---

# Research: S-30 cadence override retention

**Date**: 2026-08-31T14:49:35+02:00
**Researcher**: Adam Reszka
**Git Commit**: `010b7475021db18fac228353da12b83bc9fe0ed6`
**Branch**: `feat/cadence-override-retention`
**Repository**: 10xdevs-certification-project

## Research Question

Following `frame.md` (HIGH confidence): the cadence moves off the `sprint` row into a
per-sprint record keyed by the **Jira-side sprint id** with no FK into the sync graph
(the `sprint_measurement` shape). Cadence stays a property of the SPRINT — the
account-level model is ruled out by the owner. Six areas: (1) every cadence write and
read path, (2) the `reconcileActiveSprint` contract and what breaks when cadence leaves
its upsert, (3) every `working_days` consumer, (4) the copy modules and the guard that
cannot see a column-level loss, (5) the tests pinning current behaviour, (6) migration
`0022`'s real blast radius. Plus two decisions: what to do with `length_days` /
`start_day`, and whether the workspace-URL identity gap belongs to S-30.

## Summary

**The single most useful number in this document: `working_days` has 9 computation
consumers; `length_days` and `start_day` have zero.** Not "few" — zero. Exhaustive greps
over `src/`, `e2e/` and `scripts/` return only prefill, validation, the dirty-check that
sets the flag, and the reconciler's own carry/refresh. That asymmetry is what the plan
must be organised around.

**The move is smaller than it looks: two functions, not fifteen edits.** There are 15
textual reads of `.workingDays` off a sprint row across 8 modules, but they funnel
through three DB-access paths. `getSprintCapacityFor` (`capacity.ts:223-289`) covers the
dashboard *and* the measurement sweep in one added resolver call; `loadSprintSnapshot`
(`load-snapshot.ts:35-128`) covers all 8 anomaly-rule sites by surfacing a new top-level
`SprintSnapshot.workingDays` beside the `timeZone` and `nonWorkingDays` that already
exist for exactly this reason. **`working-time.ts` and `helpers.ts` need no change at
all** — every pure function already takes the array as a parameter. The remaining four
sites are the cadence *editing* surfaces, unavoidably explicit.

**The atomicity constraint the plan must preserve is not the one the frame named.**
`forceCadenceRefresh`'s guarantee is not "one SQL statement" — two statements in one
transaction are equally safe. It is that the *intent is an argument*, because every Jira
network call completes before the transaction opens **and** four Jira outcomes return
successfully having written nothing, with no exception to catch. That survives the table
move, provided the second write joins the reconciler's own transaction — which a caller
cannot do today, because the function takes `db`, not `tx` (`reconcile-sprint.ts:49`).

**Inheritance stops being free.** `carry` (`:316-335`) works only because cadence is a
column of the INSERTed row. A rollover mints a new `jira_sprint_id`, so a Jira-keyed
record is not found and inheritance must become an explicit write or a read-time
fallback. `sweep.ts:17-26`'s recorded "A SWEEP, NOT A HOOK, deliberately" argument
applies to the write-time option and must be answered.

**Four defects surfaced that the frame did not have**, listed under Open Questions and
New Findings below — including one dead-end route the app actively sends leads down.

## Detailed Findings

### 1. Cadence write and read paths

**Columns**: `src/db/schema.ts:438-441`, created by `0001_lying_human_cannonball.sql:219-222`.

**Writers** (all production writes):

| Site | Lines | Notes |
| --- | --- | --- |
| `reconcile-sprint.ts` `carry`, override branch | `:316-330` | Copies `previous`'s three values + `cadenceOverridden: true`. **Guard omits `workingDays`** — `:327` coalesces NULL to Mon–Fri. See New Findings #2. |
| `carry`, else branch | `:330-335` | All four from `deriveCadence`, flag `false`. |
| INSERT `values` | `:338-357` | Spreads `...carry` (`:351`) and `...restoredFreeze` (`:356`); `id: randomUUID()` at `:341`. |
| CONFLICT, `forceCadenceRefresh` | `:373-379` | All four unconditionally; `workingDays` → the Mon–Fri constant. **The copy contradiction.** |
| CONFLICT, ordinary | `:380-384` | Three `case when cadence_overridden` expressions; flag not in the SET at all. |
| `saveCadence` | `roster-store.ts:1073-1082` | **Not in a transaction.** Keyed `(sprint.id, ownerId)`. Writes `cadenceOverridden: true` only on a real edit; omits — never writes `false` — otherwise (`:1080-1081`). |
| Demo fixture | `fixture.ts:825-829` → `load.ts:97` | Inside the demo transaction, DEMO owner only. |
| Migration `0022` | `:28` | `UPDATE "sprint" SET "cadence_overridden" = false;` fleet-wide. |

No writer in `scripts/`. `e2e/accounts.ts:110` documents that E2E seeding excludes cadence on purpose (S-04 finding F1).

**Server Actions** (`src/app/(app)/setup/team/actions.ts`): `importCadenceAction` (`:325-361`),
`restoreCadenceAction` (`:378-406`), `saveCadenceAction` (`:421-484`). Note
`saveCadenceAction` has **no demo refusal**, unlike the other two (`:326-327`, `:379-380`)
— it relies on `resolveWorkspace()` alone.

**Readers**, by class:

- **Computation** — all nine are `working_days` (§3). Zero for `length_days` / `start_day`.
- **Prefill** — `team/cadence/page.tsx:50-56`, `setup/team/page.tsx:73-79`,
  `cadenceFromRow` (`roster-store.ts:982-988`), `sameCadence` (`:1024-1026`),
  `team/days-off/page.tsx:59`, client defaults in `cadence-editor.tsx` /
  `cadence-form.tsx`, `validations/roster.ts:144-146`.
- **Display/provenance** — `cadence-editor-view.ts:30-107`, `cadence-fields.tsx:86/115/159`,
  `cadence-editor.tsx:87`/`:239`, the two page blurbs, `team-days-off-view.ts:88`.

**Homonym trap for the plan's greps**: `absence-dates.ts:32-60`,
`absence-calendar-view.ts:39-168` and `team/absences/page.tsx:53-54` all use `startDay` as
a **`DayKey` (`YYYY-MM-DD`)**, unrelated to `sprint.start_day`'s weekday code — and
`absences/page.tsx:53-54` derives it from `sprint.startDate`.

### 2. The `reconcileActiveSprint` contract

**Invariants the file claims** (`:24-47`): one owner-scoped function so the three-way
cadence SET, the one-ACTIVE-row rule (C2, `:392-401`) and the anomaly sweep (Item B,
`:407-416`) exist in one place; **reads-before-transaction** (Jira calls at `:156`,
`:165`, `:185`; transaction opens `:209`); **NEVER BLANKS (C3)**; UI-free.

**Early returns, none of which write cadence**: `no_board` (`:166`, writes nothing),
`board_ambiguous` (`:181`, writes nothing), `no_active_sprint` (`:191`, own transaction:
board + close-ended), `sprint_undated` (`:200`, board only).

**The upsert**. Conflict target `(ownerId, jiraSprintId)` = `sprint_owner_sprint_uq`
(`schema.ts:448`). In `ON CONFLICT DO UPDATE`, an unqualified column binds to the existing
row and `excluded.*` to the proposed one — which is how `case when sprint.cadence_overridden
then sprint.length_days else $derived end` reads the row's own flag at update time
(`:367` says exactly this). `working_days` needs the explicit `::jsonb` cast (`:377`,
`:383`) because the parameter is a `JSON.stringify`'d literal built at `:205`. The
INSERT-only freeze restore works because the conflict branch never names
`excluded.committed_sp` (`:352-355`), and the `isRecreate` guard (`:278-280`) makes that
true of the *query* rather than only of its answer.

**The atomicity requirement, stated correctly.** The rationale at `roster-store.ts:1094-1113`
defends against **caller-side pre-clear → network throw**, and the network sits *outside*
any transaction. Two statements in one transaction are equally safe — Postgres rolls both
back. What the single call genuinely buys, and what a two-table design must re-buy:

1. **No read-modify-write window** against a concurrent `saveCadence` or cron cycle.
   Preserved by two statements in the same transaction targeting the same row (row locks
   serialize); lost only if the clear moves outside.
2. **The no-exception case, which is the real one**: Jira answers successfully but with
   nothing to restore from. All four of `board_ambiguous` / `no_board` /
   `no_active_sprint` / `sprint_undated` return **before** the transaction having written
   no cadence. A pre-clear would have committed `cadence_overridden = false` and then
   received "we wrote nothing" with no exception. Worth stressing: `importCadence` passes
   `storedBoardId: null` unconditionally (`roster-store.ts:900-909`), so the restore path
   always re-discovers boards and `board_ambiguous` is genuinely reachable from the button.

**Callers — exactly two.** `run-sync.ts:685-695` (headless; passes the stored board id,
never `forceCadenceRefresh`, reads only `status` and `sprint`) and `importCadence`
(`roster-store.ts:892-911`, passes `storedBoardId: null`, maps the union in a `switch` at
`:913-972`, reading cadence back off the persisted row via `cadenceFromRow`). Note the
name collision: `ImportCadenceResult` is exported from both `roster-store.ts:811` and
`actions.ts:158` with different shapes, kept apart by the `importCadenceService` alias
(`actions.ts:36`).

**Inheritance under the new model.** A rollover mints a new `jira_sprint_id`, so a
Jira-keyed lookup returns nothing. Two mechanisms:

- **(A) Write-time ("seed on first sight")** — inside the existing transaction, after the
  upsert returns, copy the predecessor record under the new key. Predecessor identity
  should mirror `sprint_measurement_series_idx` (`schema.ts:542-547`,
  `(owner_id, jira_project_id, start_date)`) — *"the owner's latest cadence record for
  THIS Jira-side project"* — which closes the project-scope crack for free.
  **Objection on record**: `sweep.ts:17-26` — *"A SWEEP, NOT A HOOK, deliberately. Hanging
  the write off `reconcileActiveSprint`'s `switched` flag would mean a stalled cron or an
  expired token at the exact moment of rollover loses that sprint FOREVER."*
- **(B) Read-time ("resolve by recency")** — no rollover write; the resolver answers
  *record for X ?? latest earlier record for (owner, Jira project) ?? `deriveCadence`*. A
  record then exists **iff the lead chose something** — the `anomaly_settings` house rule
  (`schema.ts:945-951`). No rollover window, so `sweep.ts`'s objection does not apply.

`switched` (`:96-97`, `:418`) is available as a rollover trigger but **has no consumer
anywhere in `src/`** — the only mention outside the file is `sweep.ts:21` explaining why
not to use it.

**Where a "replaced a lead-entered value" event would travel.** The decision is currently
made *inside Postgres* (`:381-383`), so TypeScript never learns which arm fired — but the
reconciler already holds `previous` (`:214-227`) and the derived `cadence` in TS, so the
comparison costs zero round trips and is exact precisely when `!isRecreate`. Channel:
surface a field on the `"reconciled"` variant (`switched` is the precedent) → capture in
`run-sync.ts` near `:695` → fold into `jiraCycleOutcome(...)` (`:956-966`, which joins
fixed tokens with `;` and whose docblock at `:943-955` forbids field names, issue keys and
credentials) → `finalizeSyncState` (`:929`) → `recordAttempt` (`:307`, never throws) →
`sync_attempt.outcome`, which is `text` with **no enum** (`schema.ts:577`), so **no
migration is needed** → `SyncAttemptView` (`connections.ts:34-39`) → `sync-history.tsx:90-92`,
which renders `outcome.replace(/_/g, " ")` — so a token like `cadence_replaced` displays
as "cadence replaced" with **zero component change**.

`lessons.md:46` obligation (a) requires that such a cycle not finalize as
`status: OK, outcome: null`, that the record be a **bounded diagnostic token** (reinforced
by `schema.ts:551-554`: no error-text column, ever), and that it name **which predicate**
decided — so the token should name the branch, not merely "cadence changed".

### 3. Every `working_days` consumer

**The canonicalisation guard is `workingDaySet` (`helpers.ts:150-179`)**: null/empty →
Mon–Fri (`:153-154`); otherwise **intersect** with the seven uppercase codes, keeping the
recognisable half (`:169-171`); empty intersection → `console.error` + Mon–Fri
(`:173-178`). This is the S-28 impl-review F3 guard that stops the clock being zeroed
forever. Pinned at `working-time.test.ts:420-478`.

**The combination rule is one line**: `isWorkingDay` (`working-time.ts:73-79`) —
`!nonWorkingDays.has(dayKey) && days.has(weekdayOf(dayKey))`. `working_days` is a weekday
pattern, `team_day_off` a date exclusion, and both must pass before the day's
`[08:00,16:00)` window contributes. Individual absences deliberately do not stop the clock
(`working-time.ts:27-31`).

**The nine computation consumers**: `pr-review-stalled.ts:39`, `ticket-status-aging.ts:102`,
`developer-inactive.ts:47`, `ticket-no-commit-link.ts:42` and `:56`, `sprint-at-risk.ts:96`
(`hoursLeft`), `:158` (`workingDaysLeft`), `:180` (`workingDaysLost`), `capacity.ts:279`,
and `team-days-off-view.ts:88` (`costsNothing`). All eight rule sites pass the same triple:
`snapshot.sprint.workingDays`, `snapshot.timeZone`, `snapshot.nonWorkingDays`.

**Capacity chain**: `capacity.ts:279` → `computeSprintCapacity` → `:126-132`
`sprintWorkingDays` (already net of `team_day_off`, `:61-68`) → `:152` `nominalMd` → `:171-181`
`adjustedMd`. Two callers only: `dashboard/page.tsx:118` (live) and `sweep.ts:162` (any row).

**The measurement sweep and the conditional protection.** `sweep.ts:179` writes
`workingDays: capacity.capacity.sprintWorkingDays` as an **integer count** (`schema.ts:494`).
`shouldRecompute` is false once `finalized_at` is stamped, enforced in Postgres by
`setWhere: isNull(...)` (`:65-67`, `:213`) — a finalized record is genuinely immutable.
**But `shouldFinalize` returns false unconditionally when `committed_frozen_at IS NULL`
(`:52`)**, so a sprint that closed without a frozen commitment never finalizes and its
capacity is recomputed from the current pattern on every cycle, over every sprint row the
owner has (`:111-115`). *This corrects the frame's Step-5 pressure test, which assumed
protection was structural.*

**Closed-sprint display is safe.** `sprint-detail/page.tsx:279-289` builds capacity **only**
from `measurement.capacityAdjustedMd` / `capacityFullMd` / `workingDays`, all three
required non-null; the page never calls `getSprintCapacity*` at all. So the S-25 switcher's
closed-sprint read path is undisturbed by the move.

**The minimal seam**: 15 reads, 8 modules, **3 DB-access paths** —
`getActiveSprintRow`, the sweep's own join, and the reconciler's `previous` select. Two
functions collapse most of it: `getSprintCapacityFor` (covers dashboard + sweep, keyed by
`sprint.jiraSprintId`, already in scope) and `loadSprintSnapshot` (one entry in the existing
`Promise.all` at `:65-105`, surfaced as `SprintSnapshot.workingDays`, turning all 8 rule
sites into a mechanical rename).

**Two casts will hide compile breaks**: `test-support.ts:46` (`as SelectSprint`) and
`fixture.test.ts:113`. Both must be updated by hand.

### 4. Copy modules and the guard

**What is actually derived.** `disconnect-impact.ts`'s header claims the module is
schema-derived (`:19-23`), and that is true of exactly three fields — `destroyedTables`,
`weakenedTables[].table/.column`, `clearedTables`. **Every prose fragment in `destroys` /
`clears` / `keeps` is hand-written**; the guard checks only their shape (`:225-226`: no
leading capital, no trailing period), never their truth.

**Why the guard is structurally blind.** `deriveImpact` (`disconnect-impact.test.ts:64-96`)
consumes only `collectEdges()` (`:37-56`), which flattens `getTableConfig(t).foreignKeys`.
The BFS accumulates a set of **table names** (`:65-77`); `weakened` is emitted only for
`SET NULL` FK edges (`:84-92`); the assertions (`:121-136`) are set equalities over table
names. `sprint` is already declared in `destroyedTables` (`disconnect-impact.ts:128`), so
the guard is green — and the four cadence columns appear in no FK, so `collectEdges` never
emits them and no assertion in the file can reference them. The guard can say *"a table you
named dies"*; it can never say *"and one of its columns was the lead's, not Jira's."*

**The promise that breaks.** `DISCONNECT_IMPACT.jira.keeps` (`:150-157`) is built entirely
around the hand-entered/durable distinction — *"the recorded absences **you entered by
hand**"*, the roster, the team-wide days off — while `destroys[1]` frames the loss as
*"every sprint, ticket and status-change history **synced** from it"* (`:139`). The dialog
closes with *"Reconnecting re-syncs what Jira still holds"* (`disconnect-confirm-copy.ts:87-104`),
true of tickets and false of a `working_days` array Jira never held. The switch copy is
careful to flag the status mapping as *"which you re-enter for the new project rather than
lose"* (`:197`) and gives cadence no such clause. `grep -i cadence` over all four pre-action
copy modules returns exactly one hit, and it is post-commit.

**The template already exists.** `COMMITMENT_FREEZE_CLAUSE` (`integration-card-copy.ts:189-206`)
is the declared hand-written exception for the *other* non-FK casualty of the same delete,
with its own reasoning — *"A hand-written clause hidden inside a module whose header claims
everything is derived is how the next reader stops trusting either half; this is that
clause, declared."* — and its own test (`integration-card-copy.test.ts:151-162`, asserted
against the exported constant so the sentence and the clause cannot drift apart).
`committedSp` and the cadence columns are the same shape of problem; one has this treatment
and the other has nothing.

**Guard recommendation (evaluated three options).** Do the **structural** one plus a narrow
copy assertion; explicitly do **not** build a column registry — the repo has twice
demonstrated that a hand-maintained enumeration of losses goes stale
(`integration-card-copy.ts:138-147` records it going stale three times), and a registry's
own staleness is invisible. Three additions, ≈30 lines, no new mechanism:

1. A named regression in the shipped style (`disconnect-impact.test.ts:140-183` is the
   pattern): assert the new table is absent from `deriveImpact`'s destroyed set for every
   root, and from every declared `destroyedTables`.
2. A copy assertion mirroring `:239-243`: both Jira roots name the surviving cadence among
   what stays.
3. A declared `CADENCE_*_CLAUSE` following `COMMITMENT_FREEZE_CLAUSE` exactly, for whatever
   residue stays on `sprint`, pinned against the exported constant.

### 5. Tests pinning current behaviour

**The headline change**: `roster-store.integration.test.ts:689-707`, named *"refreshes the
cadence PAST the override and clears the flag"*. Setup saves
`{21, WED, ["MON","TUE","WED"]}` (`:673-687`); `:705` asserts
`expect(row.workingDays).toEqual(["MON","TUE","WED","THU","FRI"])`. Its own comment at
`:702` — *"Back to what the sprint's own Jira dates derive"* — is false of `:705`: Mon–Fri
is derived from nothing. The companion at `:709-732` asserts `["MON","TUE","WED"]` is
**preserved** on a failed Jira call (`:731`), so the suite already knows what preservation
looks like and simply asserts the opposite on the success path.

**MUST CHANGE**: `reconcile-sprint.integration.test.ts` (c) `:257`, (d) `:280` (its `:295`
is the `0022` exposure in test form), (i) `:458`, (k) `:515`;
`roster-store.integration.test.ts` `:466`, `:547`, `:566`, `:588`, `:655`, `:689`, `:734`;
`cadence-editor-view.test.ts` `:18`, `:53`, `:64`, `:118`;
`setup/team/actions.integration.test.ts:274-287`, `:320`.

**SHOULD EXTEND**: (a) `:222`, (f) `:345`, (g) `:362`, (h) `:377`, (j) `:484`;
`roster-store` `:406`, `:611`, `:637`, `:709`, `:747`; the `disconnect-impact.test.ts` and
`disconnect-confirm-copy.test.ts` copy assertions; `integration-card-copy.test.ts:151`
(the clause template) and `:184` (which forces `reconnectCost` to quote every fragment of
its source entry — a non-trivial coupling to budget for).

**UNAFFECTED**: the pure working-time consumers (`working-time.test.ts`, `helpers.test.ts`,
`capacity.test.ts`), the `sprint_measurement` integer-count suites, `cadence.test.ts`
(unless the plan stops `deriveCadence` emitting `workingDays` at all — then `:89-108`
become MUST CHANGE), `onboarding.integration.test.ts:23`.

**Two coverage holes the plan should close.** `forceCadenceRefresh` has **no direct test in
`reconcile-sprint.integration.test.ts` at all** — the force branch is exercised only
indirectly through `restoreCadenceFromJira`. And case **(k) never asserts `workingDays`**
(`:533-535` pins the flag, `lengthDays` and `startDay` only), so the field the frame
identifies as the only consequential one is the one field that carry-forward test omits.
Case (i) `:475` does assert it.

**Reference implementation for the new record**: cases (n)–(t), especially **(t) `:655-687`**
— a FK-free record keyed Jira-side, joined through `jiraProject.jiraProjectId`, project-scoped
so a switch cannot cross-contaminate — and (r) `:641` (cross-owner). The new cadence record
needs structural twins of both.

**E2E: none.** No spec under `e2e/` touches `/team/cadence`, the restore dialog, or the
wizard's cadence step. If the plan wants the copy↔code contradiction caught at the surface a
lead sees, that is net-new E2E, not an edit.

**Mutation config**: `stryker.conf.json` (`break: 70`) mutates `src/lib/anomaly/rules/**`,
`risk-score.ts`, `day-bucket.ts`, `suggested-action.ts`. **Every file S-30 will edit is
outside the glob** — `cadence.ts`, `reconcile-sprint.ts`, `roster-store.ts`,
`disconnect-impact.ts`, `cadence-editor-view.ts`, `capacity.ts`, `sweep.ts`. Adding the new
cadence producer is defensible on the S-28 precedent (the value moves five rules and the
lifetime FR-023 record) but is a config change with its own risk: a first run against an
untuned file can drop the aggregate below 70 and break CI. Budget it as its own phase, or
leave the glob alone and say so.

### 6. Migration `0022` — real blast radius is EMPTY

The migration's header reasons about `start_day` and the flag and **never mentions
`working_days`**; it verified the flag's distribution before writing, not the values. So the
mechanism is real: clearing the flag exposes any lead-chosen pattern to the ordinary
CONFLICT branch (`reconcile-sprint.ts:383`), which rewrites it to Mon–Fri and reports `OK`.

**Measured, not assumed.** A read of the local database returns six `sprint` rows, **all
carrying `["MON","TUE","WED","THU","FRI"]` and `cadence_overridden = f`**. Production holds
zero `sprint` rows. So no account anywhere currently holds a non-Mon–Fri pattern: this is a
live mechanism with an empty blast radius — the same shape as S-28's stored-numeric-override
finding. **The plan needs no data-repair migration**, only closure of the mechanism.

## Code References

- `src/db/schema.ts:438-441` — the four cadence columns; `:448` the upsert's conflict target
- `src/db/schema.ts:461-470`, `:490`, `:541`, `:542-547` — the `sprint_measurement` pattern to copy: Jira-side key, **no** `.references()`, owner+sprint unique, and the recency index a project-scoped predecessor lookup needs
- `src/db/schema.ts:945-951` — the `anomaly_settings` rule: a row exists iff it differs from the default; `is_default` deliberately dropped
- `src/db/schema.ts:577`, `:551-554` — `sync_attempt.outcome` is `text` with no enum (no migration for a new token) and there is deliberately no error-text column
- `src/lib/integrations/reconcile-sprint.ts:209` — the transaction boundary; `:214-227` the owner-scoped, project-blind `previous` read; `:278-302` the freeze restore; `:316-335` `carry`; `:373-384` both cadence branches
- `src/lib/integrations/roster-store.ts:1022-1028` `sameCadence`; `:1056-1090` `saveCadence` (no transaction); `:1094-1113` the atomicity rationale; `:1114-1140` `restoreCadenceFromJira`
- `src/lib/anomaly/rules/helpers.ts:150-179` — `workingDaySet`, the S-28 canonicalisation guard
- `src/lib/anomaly/rules/working-time.ts:73-79` — the one line combining pattern + days off
- `src/lib/dashboard/capacity.ts:279` — the single capacity read site; `:223-289` the seam
- `src/lib/measurement/sweep.ts:51-67` — `shouldFinalize` / `shouldRecompute`; `:17-26` the sweep-not-a-hook argument; `:179` the integer count
- `src/lib/integrations/disconnect-impact.ts:128`, `:139`, `:150-157`, `:197` — the declared table, the misdescription, the promise, the re-enterable-loss precedent
- `src/components/organisms/settings/integration-card-copy.ts:189-206` — `COMMITMENT_FREEZE_CLAUSE`, the template
- `src/components/organisms/settings/cadence-editor.tsx:239` — the false dialog string, an inline `.tsx` literal
- `src/lib/integrations/roster-store.integration.test.ts:705` — the assertion that pins the destruction green

## Architecture Insights

- **The house rule for outliving a sync-lifecycle parent is "carry no foreign key at all"**, not "soften the cascade" — *"it is 'refuse to be deleted', not 'recover after deletion'"* (`disconnect-data-retention/frame.md:118-127`). `sprint_measurement` is the shipped instance and case (t) is its test.
- **Provenance is encoded as a nullable reason, not a boolean** (`recap_settings.disabled_reason`, `schema.ts:990-1004`). `cadence_overridden` is the last surviving boolean of that kind — and the one S-29 had to repair because it meant "the lead finished setup" rather than "the lead chose this".
- **Copy is two-layered on purpose**: a fact layer derived from the FK graph and a prose layer that is hand-written but shape-checked. The layering's honesty depends on hand-written exceptions declaring themselves, which is exactly what `COMMITMENT_FREEZE_CLAUSE` does and what cadence lacks.
- **Decision logic in a `.tsx` escapes testing by construction** — there is no component harness (CLAUDE.md), which is why `cadence-editor-view.ts` exists and why the one string left in the `.tsx` is the one that is wrong.

## Historical Context (from prior changes)

- `context/archive/2026-08-30-disconnect-data-retention/frame.md:54`, `:144-147` — the keepability rule and its sufficiency clause (*"precisely because nothing reads the link"*), which cadence fails on both halves; `plan.md:118-123` records the deferral verbatim
- `context/archive/2026-08-30-disconnect-data-retention/reviews/impl-review.md:63` — Jira sprint ids are unique per **instance**, not globally: the identity class this slice re-opens
- `context/archive/2026-08-31-post-setup-cadence-surface/plan.md:114-116` — S-29 explicitly left the ownership question open and noted a disconnect still loses the override
- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:63` — the only recorded reason for the original placement, and it is not a domain argument: *"nowhere else to put a default"*
- `context/foundation/lessons.md:42-46` — obligation (a): an operator log must distinguish which predicate produced the result
- `context/foundation/manual-test-backlog.md:217-220` — row 3.6 proved the CONFLICT branch preserves the override on live data and explicitly disclaims the INSERT branch, which is the one a disconnect forces

## Related Research

- `context/changes/cadence-override-retention/frame.md` — the framing this research was scoped from. **Four of its claims were corrected in place after this research**: the Step-5 pressure test (protection is conditional on finalization), the `run-sync.ts:947-953` citation (omission, not a recorded judgment), the `forceCadenceRefresh` guarantee (intent-as-argument, not one-statement), and the carry-forward compatibility (intent yes, mechanism no).

## Open Questions

1. **`length_days` / `start_day` — recommendation: keep storing, label honestly (option c).** They have zero computation consumers; every fact the owner associates with them (start, duration, remaining) is computed from `sprint.start_date` / `end_date`, with `working_days` supplying the calendar. Giving them a consumer means inventing a nominal-vs-actual surface or building S-18's future-sprint projection — new scope with no PRD backing inside S-30. Demoting them to a derived cache is worse: it would **delete FR-007's override outright**, since the lead could then no longer state a rhythm differing from Jira's dates — precisely the divergence case FR-007 exists for. Keeping them stored keeps FR-007 literally kept while the plan stops spending protection budget on two inert columns. **Owner's confirmation still wanted**, because the owner believed them load-bearing and the code disagrees.
2. **Inheritance mechanism — (A) write-time seeding or (B) read-time recency fallback.** (B) has no rollover window and matches the `anomaly_settings` house rule; (A) must answer `sweep.ts:17-26`. This is a plan decision, flagged here with both arguments.
3. **Workspace-URL identity gap — belongs IN S-30.** `workspaceUrl` is stored, normalized and displayed but **never compared** (no equality test anywhere in `src/`), while `projectChanged` compares the Jira-side project id string alone (`jira-store.ts:210-212`, `connection-service.ts:430`) and `/settings/connections/jira:51-65` explicitly offers "Reconnect Jira", telling the lead it is *"Replacing the credentials currently connected to \<old workspace URL\>"*. Today the switch-delete masks the collision for cadence. **After S-30 the record deliberately survives that delete, so a Jira-instance re-point with a colliding sprint id makes the new sprint adopt the old team's cadence** — S-30's own mechanism opens it, which is the same class as S-26 impl-review F2. Shipping without it re-creates F2 for a new payload.
4. **Mutation glob** — add the new cadence producer to `stryker.conf.json` as its own phase, or leave the glob and say so. Not free either way.

## New Findings (not in the frame brief)

1. **`Import sprint cadence` is a dead-end route.** `jira-project-editor.tsx:167` sends the lead to `/team/cadence` after a project switch has deleted every `sprint` row. That page renders `no_sprint`, whose restore button is `disabled={initialCadence == null}` (`cadence-editor.tsx:232`) and whose save throws `NoSprintRowError` (`roster-store.ts:1070`). The copy at `jira-project-editor-copy.ts:85-86` promises a control that cannot be operated.
2. **A second, unguarded `workingDays` hole in `carry`.** The guard at `:319-323` checks `lengthDays != null && startDay != null` but **not `workingDays`**, and `:327` coalesces NULL to Mon–Fri — so an override with a lead-set length but NULL working days silently re-seeds Mon–Fri on every rollover while still writing `cadenceOverridden: true`.
3. **A second, uncanonicalised copy of the Mon–Fri default.** `team-days-off-view.ts:14` declares its own `DEFAULT_WORKING_DAYS` and `:79-81` falls back without the S-28 intersection or log. Under a non-canonical array every holiday renders `costsNothing: true` while the guarded engine still subtracts them — two counters disagreeing, already live.
4. **`saveCadence` runs outside a transaction** (`roster-store.ts:1073-1082`) while every reconcile write is inside one. Harmless today (single statement); a two-table save needs a transaction it does not currently have.
5. **Three readers coalesce with `?? [...DEFAULT_CADENCE.workingDays]`**, which catches `null` but **not `[]`**. Nothing can write `[]` today (`validations/roster.ts:148`); the new write path must keep it that way or add the guard.
6. **`run-sync.ts:707`'s `"no_sprint"` arm is unreachable** — if the status is `"reconciled"` then `chosenSprint` is non-null, so the block cannot be entered. The token remains in `IntegrationOutcome` (`:123`). Not in S-30's path, but the plan should not preserve the dead arm by accident if it touches that ternary.
