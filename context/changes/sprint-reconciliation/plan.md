# S-16 Sprint Reconciliation Implementation Plan

## Overview

Make `syncJira` reconcile the stored `sprint` row against Jira's actual active
sprint on every cycle, delivering FR-007's "pulls sprint cadence … on each sync".
The reconcile lives in one shared function that both the setup wizard and the
sync loop call, guarantees at most one `ACTIVE` sprint row per owner, and never
blanks the stored row on failure.

Scope is the owner's approved set: **C1–C6 plus B, E and H**
(`change.md` § *Scope decision — approved*).

## Current State Analysis

`importCadence` (`src/lib/integrations/roster-store.ts:838-870`) is the **only**
`insert(sprint)` in `src/`, and its only caller chain is the setup wizard
(`setup/team/actions.ts:214` → `cadence-form.tsx:102` → `setup/team/page.tsx:71`).
`run-sync.ts` writes exactly two sprint columns — `committedSp`/`completedSp` at
`:752-757` — and never touches `state`, `jiraSprintId`, or the dates.

Four consequences, all verified in code:

1. **The sprint captured at setup is synced forever.** Nothing re-asks Jira.
2. **`sprint.state` is written once and never revised**, so `getActiveSprintRow`'s
   "between sprints → null" branch (`src/lib/sprint.ts:35-42`) is unreachable once
   any row exists, and `ACTIVE` rows accumulate one per wizard re-run — the unique
   key is `(owner_id, jira_sprint_id)` (`schema.ts:349`), not "one active per owner".
3. **An owner who onboards between sprints gets no sprint row and never gets one.**
   `syncJira` returns `SKIPPED{no_sprint}` while stamping a fresh `OK`
   (`run-sync.ts:606-613`), so the account is permanently dead and permanently
   green. Three documents record the opposite as an accepted degradation
   (`archive/2026-08-20-setup-team-roster-cadence/plan.md:63`, `:277`;
   `onboarding-routing/change.md:60-67`).
4. **Old-sprint anomalies freeze `status='ACTIVE'` forever.** `detect.ts:70`
   scopes its `existing` set to `eq(anomaly.sprintId, sprintId)`, so the
   flip-to-RESOLVED sweep at `:118-127` never sees rows from a prior sprint.

Two nondeterminism twins of S-10 F7 remain live the moment a second `ACTIVE` row
exists: `setup/team/page.tsx:32-42` (`.limit(1)` with no `orderBy`) and
`saveCadence` (`roster-store.ts:900-908`, no `.limit(1)`, so an override lands on
*both* rows and `{updated}` returns 2 where every caller assumes 1).

## Desired End State

On every Jira sync cycle, SprintFlow asks the monitored project's board which
sprint is active and makes the database agree: the row is created if missing,
refreshed if stale, and any other `ACTIVE` row for that owner is demoted to
`CLOSED`. When Jira reports no sprint running at all, a stored sprint whose end
date has passed is closed too, so the database stops calling a finished sprint
active. An owner's cadence override survives every cycle, rollovers included. A failed or
inconclusive reconcile changes nothing and never blanks what is stored — the
dashboard keeps rendering the last good sprint.

**How to verify**: with the reconcile in place, an owner whose Jira sprint rolls
over sees the new sprint's tickets on the next cycle without touching the wizard;
an owner with zero sprint rows gets one on the first cycle after a sprint goes
active; `select count(*) from sprint where owner_id=$1 and state='ACTIVE'` never
exceeds 1.

### Key Discoveries:

- **The seam is exact**: between `run-sync.ts:604` (lease acquired) and `:606`
  (the `no_sprint` early return). Placed after the lease, the reconcile inherits
  the `claimed_until` + `SELECT … FOR UPDATE` guard (`run-sync.ts:192-253`) for
  free; placed before it, cron and a `syncNow` click race.
- **`deriveCadence` needs the owner's IANA zone, which arrives from
  `validateCredentials` at `run-sync.ts:635` — *below* the seam.** That call must
  move above the reconcile. This reorders an existing per-cycle subrequest; it
  adds no new cost.
- **`baseUrl`/`jiraCreds` (`run-sync.ts:615-616`) also sit below the seam**, and
  the `try` that reaches `classifyError` opens at `:628`. Both must move up so a
  reconcile throw is classified like any other Jira read.
- **`importCadence` is not directly reusable from a headless cycle**: its
  board-selection branch *returns* `boardCandidates` for a wizard chooser
  (`roster-store.ts:782-812`) and it unconditionally writes `jira_project.board_id`.
  But its conflict SET (`:855-866`) is the `cadence_overridden` contract to preserve.
- **`toSprintState` returns `null` for any unrecognised state string**
  (`roster-store.ts:720-731`), and a NULL `state` makes `saveCadence` a silent
  no-op that still reports success (`:907` + `actions.ts:271` ignoring the count).
- **NULL `startDate` is the nastiest half-populated row**: Postgres
  `ORDER BY … DESC` is NULLS FIRST, so a dateless `ACTIVE` row outranks a correctly
  dated one in *both* branches of `getActiveSprintRow` (`sprint.ts:33`, `:40`).
  `importCadence` already refuses to write a dateless sprint (`hasDates`, `:816-817`).
- **`listBoards` and `getActiveSprint` have no `JiraAuthError` branch**
  (`jira.ts:481-485`, `:540-544`); every non-OK including 401 becomes
  `JiraUnavailableError` → `RATE_LIMITED`. This is **not** load-bearing for a
  revoked token: `resolveStoryPointFieldId` (`jira.ts:916`) and
  `validateCredentials` (`jira.ts:226`) both classify 401 and both run before
  `searchSprintIssues` (`run-sync.ts:631`, `:635`, `:637`) — and Phase 3 keeps
  `validateCredentials` above the reconcile, so a wholly revoked token still
  throws there first. The gap that *is* reachable is narrower: a PAT that
  `/myself` accepts but that lacks Agile/board permission, where the agile 401 is
  the only 401 in the cycle.
- **`jiraFetch` in `run-sync.integration.test.ts:171-208` throws on unknown URLs**
  (`:205`), so adding agile calls to `syncJira` fails every existing Jira test in
  the file until the mock grows two branches.
- **`sync-now-button.tsx:31` renders skip reasons generically**
  (`outcome.reason.replace(/_/g, " ")`), so widening the reason union needs no UI
  switch update — only the `SyncNowOutcome` type in `sync/actions.ts:40`.

## What We're NOT Doing

- **Re-stamping `absence.sprint_id` at rollover** (research item A). Filed as
  roadmap **S-20** `absence-sprint-scoping`. Re-stamping would contradict S-08's
  recorded design rule that a carried-over absence *should* stop raising risk
  (`archive/2026-08-25-absence-calendar/plan.md:154-163`), and the real defect is
  that three consumers disagree about which sprint an absence belongs to:
  `sprint-at-risk.ts:141` is `sprint_id`-scoped while `capacity.ts:170-176` and
  `developer-inactive.ts:47-51` are date-scoped. That is a decision slice, not a
  filter fix.
- **Retention purge** (research item D) — S-12. S-16 turns "one sprint row per
  owner" into a growing series, so the gap stops being theoretical, but the purge
  itself stays with S-12.
- **Post-setup cadence UI** (research item F) — S-19 / S-15. `/setup/team`
  remains the only mount of `CadenceForm`.
- **`timestamptz` migration** of `sprint.startDate`/`endDate` (research item G) —
  out of scope as S-10 already recorded. Rollover arithmetic inherits the bare
  `timestamp` columns; nothing in this plan does date arithmetic across the
  rollover boundary, precisely to avoid depending on them.
- **Full demo ↔ real delineation** (PRD Open Question #2 / S-09). Phase 4 fixes
  only the wizard's missing project-change sprint delete — the symmetry gap that
  is the documented `jira_sprint_id=1001` incident's entry point.
- **Adding a `sync_status` enum value.** Board ambiguity and every other
  inconclusive reconcile stay `status: OK` with a new `sync_attempt.outcome`
  string. Widening `sync_status` would require a migration plus a new exhaustive
  branch in `failure-reason.ts:51-70`.
- **Making the one-cycle empty window invisible.** Decided: accept and document
  (see *Critical Implementation Details*).

## Implementation Approach

Extract the sprint upsert into one shared, UI-free reconciler that both callers
use, so the `cadence_overridden` three-way SET exists in exactly one place. The
reconciler completes every network read before opening its transaction (the
established `reads-before-txn` rule, `run-sync.ts:629`), then in one transaction
upserts the sprint, demotes every other `ACTIVE` row of that owner to `CLOSED`,
and closes anomalies belonging to any other sprint.

The sync loop calls it right after acquiring the lease. **A reconcile that cannot
conclude is non-fatal**: the cycle falls back to the stored sprint and pulls it as
before. Only when there is no stored sprint *and* the reconcile could not produce
one does the cycle skip — and then the recorded `outcome` names why. A reconcile
that *throws* (401, 5xx) propagates to the existing `classifyError`.

## Critical Implementation Details

**Ordering inside the reconcile transaction.** The upsert must run first and
return the row id; the demotion is then `state='ACTIVE' AND id <> <new id>`, and
the anomaly sweep is `sprint_id <> <new id> AND status='ACTIVE'`. Keying the
demotion on `jira_sprint_id` instead would misfire when the upsert took the
conflict branch. `anomaly.sprint_id` is `NOT NULL` (`schema.ts:650`), so the
`<>` comparison carries no NULL trap.

**A reconcile skip must not stop the pull.** An account whose board is ambiguous
but whose stored sprint is correct syncs fine today; halting it would make S-16 a
regression for working accounts. The cost, accepted at plan time: for such an
account the `board_ambiguous` condition is never surfaced to the owner, because
the cycle reports plain `OK`. Only an account with *no* stored sprint records the
diagnostic outcome.

**The one-cycle empty window.** Between the reconcile's transaction committing a
new sprint row and the ticket re-stamp committing in the later transaction, the
dashboard reads a sprint with zero tickets. Both transactions live inside one
`syncJira` call, so the window is seconds, not the 15-minute freshness interval —
but a dashboard loaded inside it shows an empty inbox with no error banner, which
is formally at odds with US-01. Accepted; documented in code at the seam and
carried as a manual-checklist row. Merging the two transactions is not available:
`searchSprintIssues` sits between them, and network-inside-transaction is exactly
what the `reads-before-txn` rule (F1, Hyperdrive single-connection) forbids.

**An override is stored per row, so a rollover must carry it forward.**
`saveCadence` (`roster-store.ts:890-908`) flips `cadence_overridden` on the
owner's ACTIVE sprint *row*, not on the owner. The upsert conflicts on
`(owner_id, jira_sprint_id)`, so a rollover takes the INSERT branch — and
`importCadence`'s INSERT values hard-code `cadenceOverridden: false`
(`roster-store.ts:851`). Copied verbatim, the reconcile would erase the owner's
override at every rollover: the one event this slice exists to handle, and the
one an owner cannot undo, because item F (post-setup cadence UI) is out of scope
and `/setup/team` is the only mount of `CadenceForm`. Hence the seeded INSERT
above. The conflict branch is unaffected — its three-way SET already preserves
the flag for the same sprint.

**Demoting between sprints makes `saveCadence` a no-op in that window.**
`saveCadence` (`roster-store.ts:900-908`) is scoped to `state = 'ACTIVE'`, so
once the ended sprint is demoted it updates zero rows and still returns success
(`actions.ts:271` ignores the count) — the silent-no-op hazard already recorded
under *Key Discoveries*. Accepted: `/setup/team` is the only mount of
`CadenceForm` (item F is out of scope), and an owner who re-runs the wizard
between sprints re-derives cadence through `importCadence` anyway. The window is
bounded by the next sprint going active, which re-creates an `ACTIVE` row.

**A stale `board_id` must degrade, not fail.** The reconcile reads the stored
`jira_project.board_id` to avoid a `listBoards` call per cycle. If that board was
deleted in Jira, `getActiveSprint` gets a 404 — which must fall back to board
discovery rather than failing the cycle. This needs a signal narrower than
`JiraUnavailableError`, which also covers 5xx and rate limits that must NOT
trigger a retry.

---

## Phase 1: Jira client — classify 401 on the agile endpoints

### Overview

Add the narrow "board is gone" signal the reconciler needs, and give
`listBoards` / `getActiveSprint` the same auth classification every other Jira
read already has. Isolated and dependency-free. The 404 branch is a hard
prerequisite for Phase 2's stale-`board_id` fallback; the 401 branch is
defence-in-depth.

### Changes Required:

#### 1. Auth and not-found branches

**File**: `src/lib/jira.ts`

**Intent**: Two branches, with different weights.

The **404** branch is the load-bearing one: Phase 2 reads the stored
`jira_project.board_id` to avoid a `listBoards` call per cycle, and a board
deleted in Jira must fall back to discovery rather than fail the cycle. That
needs a signal narrower than `JiraUnavailableError`, which also covers the 5xx
and rate-limit cases that must NOT retry.

The **401** branch is defence-in-depth, not a regression guard. A wholly revoked
token never reaches the agile endpoints — `validateCredentials` (`jira.ts:226`)
classifies it first and Phase 3 keeps that call above the reconcile. What the
branch does cover is the reachable narrow case: a PAT that `/myself` accepts but
that lacks Agile/board permission. Today that surfaces as `RATE_LIMITED` /
"nothing to do" instead of `ERROR` / "reconnect Jira" (`needsOwnerAction: true`),
and after Phase 3 it is a permanently silent reconcile.

**Contract**: In `listBoards` (`:481-485`) and `getActiveSprint` (`:540-544`), add
a `res.status === 401 → throw new JiraAuthError()` branch **above** the existing
`!res.ok` branch, exactly as `searchSprintIssues` does at `:841-843`. Additionally
`getActiveSprint` gains a `res.status === 404` branch throwing a new exported
`JiraBoardNotFoundError` (declared alongside `JiraAuthError` at `:43`), so a
deleted board is distinguishable from a 5xx. `classifyError` (`run-sync.ts:339-359`)
is not changed — `JiraBoardNotFoundError` is caught by the reconciler and never
reaches it.

Rewrite `listBoards`' doc comment with the branch: `jira.ts:451-452` currently
states "Runs only after `validateCredentials` accepted the creds, so a 401 here
is an availability blip → `JiraUnavailableError`" as settled reasoning. That
conclusion is exactly what this phase inverts, and leaving it in place would
invite the next reader to undo the branch.

#### 2. Unit coverage

**File**: `src/lib/jira.test.ts`

**Intent**: Pin both new branches so a later refactor cannot silently re-widen
them back into `JiraUnavailableError`.

**Contract**: Extend the existing `describe("listBoards")` (`:364`) and
`describe("getActiveSprint")` (`:471`) blocks with a 401 case asserting
`rejects.toBeInstanceOf(JiraAuthError)`, and a 404 case on `getActiveSprint`
asserting `JiraBoardNotFoundError`. The 5xx cases already present (`:450`, `:519`)
must keep asserting `JiraUnavailableError`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- New assertions exist: `grep -n "JiraBoardNotFoundError" src/lib/jira.test.ts` returns a match

#### Manual Verification:

- None. This phase has no user-visible surface; its effect is only observable
  through Phase 3.

---

## Phase 2: The shared sprint reconciler

### Overview

Extract the sprint upsert into one UI-free function that both the wizard and the
sync loop call, and give it the two behaviours the wizard never needed: demoting
the previous `ACTIVE` row (C2) and closing the previous sprint's anomalies (B).
This is where C1, C2, C4 and item B are implemented; Phase 3 only wires it in.

### Changes Required:

#### 1. The reconciler module

**File**: `src/lib/integrations/reconcile-sprint.ts` (new)

**Intent**: One owner-scoped function that asks Jira which sprint is active and
makes the database agree — creating the row when absent (C4), refreshing it when
stale (C1), demoting any other `ACTIVE` row (C2), and closing anomalies attached
to any other sprint (item B). All network reads complete before the transaction
opens (`reads-before-txn`, F1). Never deletes or blanks a stored row (C3).

**Contract**: Exports `reconcileActiveSprint(args) => Promise<ReconcileResult>`.

Args: `{ db, ownerId, baseUrl, creds, projectId, projectKey, storedBoardId,
timeZone, chosenBoardId?, jiraOpts? }`. `storedBoardId` is `number | null`, but
the column is `text` (`schema.ts:267`; `importCadence` writes `String(board.id)`
at `roster-store.ts:832`), so the caller coerces — `Number(project.boardId)` with
a guard that treats NULL, `""` and `NaN` alike as "no stored board" rather than
passing `NaN` into a Jira URL. It does **not** load credentials or the
project row itself — both callers already hold them, and taking them as arguments
keeps the function free of the wizard's `loadJiraCredentials` path.

Result is a discriminated union:

```ts
type ReconcileResult =
  | { status: "reconciled"; sprint: SelectSprint; switched: boolean; boardId: number }
  | { status: "board_ambiguous"; candidates: JiraBoard[] }
  | { status: "no_board" }
  | { status: "no_active_sprint"; boardId: number }
  | { status: "sprint_undated"; boardId: number };
```

`switched` is true when the upsert landed on a different row than the owner's
previous `ACTIVE` one — it is what Phase 3 logs and what makes the anomaly sweep
worth reporting. `sprint_undated` is separated from `no_active_sprint` because the
two have different causes and the operator log should say which happened; both
write no sprint row.

Behaviour, in order:

- **Board resolution.** Use `storedBoardId` when non-null; on
  `JiraBoardNotFoundError` from `getActiveSprint`, fall back to discovery. When
  `storedBoardId` is null, call `listBoards(baseUrl, creds, projectKey)`: zero
  sprint-capable boards → `no_board`; exactly one → use it; more than one →
  `chosenBoardId` if it matches, else `board_ambiguous` carrying the candidates
  and **persisting nothing** (a headless cycle has no UI to ask, and silently
  auto-picking is the defect class that `type === "scrum"` already cost us).
- **Sprint read.** `getActiveSprint(baseUrl, creds, board.id)`; `null` →
  `no_active_sprint` — and in that branch only, open a transaction to demote the
  owner's `ACTIVE` row to `CLOSED` **when its `endDate` is non-NULL and in the
  past**. Jira says no sprint is running; a row whose end date has passed agrees
  with that, and leaving it `ACTIVE` is what keeps `SPRINT_AT_RISK` firing on a
  finished sprint. The `endDate` guard is what makes this safe against a
  transient mid-sprint blip: a sprint still inside its window is left untouched.
  This is not blanking (C3) — `getActiveSprintRow`'s fallback branch
  (`sprint.ts:37-42`) returns the most-recently-started row regardless of
  `state`, so the dashboard keeps rendering the last good sprint. A sprint
  missing either `startDate` or `endDate` →
  `sprint_undated`, mirroring `importCadence`'s existing `hasDates` refusal
  (`roster-store.ts:816-817`) — a NULL-dated row would outrank a correctly dated
  one in both branches of `getActiveSprintRow`.
- **Cadence.** `deriveCadence({ startDate, endDate, timeZone })` — reused
  unchanged from `src/lib/integrations/cadence.ts:66-88`; it is pure and DB-free.
- **Transaction.** Read the owner's **most-recently-started** row first —
  `id`, `state`, `cadenceOverridden`, `lengthDays`, `startDay`, `workingDays`,
  ordered `startDate desc` like `getActiveSprintRow`. Deliberately **not** scoped
  to `state = 'ACTIVE'`: the `no_active_sprint` branch above may have demoted it
  to `CLOSED` on an earlier cycle, and the owner's override must still survive
  the rollover that follows. The demotion below stays `ACTIVE`-scoped. Persist
  `jira_project.board_id` when a board was resolved; upsert `sprint` reproducing
  `importCadence`'s conflict SET verbatim (`roster-store.ts:854-866`) — metadata
  always refreshes, cadence columns only via `case when cadence_overridden`.
  **The INSERT values differ from `importCadence`'s on one point**: when that
  previous `ACTIVE` row carried `cadence_overridden = true`, the new row's
  `lengthDays` / `startDay` / `workingDays` / `cadenceOverridden` are seeded from
  it rather than from `deriveCadence`, so a rollover does not silently reset the
  owner's override (see *Critical Implementation Details*). `.returning({ id })`.
  Then demote:
  `update(sprint).set({ state: "CLOSED" }).where(ownerId AND state='ACTIVE' AND
  id <> returnedId)`. Then sweep: `update(anomaly).set({ status: "RESOLVED" })
  .where(ownerId AND status='ACTIVE' AND sprintId <> returnedId)`.
- **State coercion.** Write `toSprintState(activeSprint.state) ?? "ACTIVE"`. The
  Jira call filters `state=active`, so the fallback is unreachable in practice —
  but a NULL `state` would make `saveCadence` a silent no-op that still reports
  success, and that failure is silent enough to be worth one `??`.

#### 2. Repoint the wizard onto the reconciler

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Delete `importCadence`'s own board-selection and upsert, so the
`cadence_overridden` three-way SET exists in exactly one place. The wizard keeps
its existing return shape — the chooser UI depends on it.

**Contract**: `importCadence` keeps its signature and `ImportCadenceResult`. It
loads credentials and the project row as today (`:762-776`), calls
`validateCredentials` for the zone, then delegates to `reconcileActiveSprint`,
mapping the result onto the existing fields: `reconciled` →
`{ cadence, boardId, jiraSprintId, sprintName, boardCandidates: [], noActiveSprint: false }`;
`board_ambiguous` → `{ cadence: DEFAULT_CADENCE, boardId: null, …, boardCandidates: candidates }`;
`no_board` / `no_active_sprint` / `sprint_undated` →
`{ cadence: DEFAULT_CADENCE, boardId: <as applicable>, …, noActiveSprint: true }`.
`toSprintState` moves into the reconciler module and is imported back if still
needed here. `saveCadence` (`:900-908`) is untouched — Phase 2's demotion removes
the second-`ACTIVE`-row precondition its unbounded UPDATE depends on.

#### 3. Integration coverage

**File**: `src/lib/integrations/reconcile-sprint.integration.test.ts` (new)

**Intent**: Prove the invariants against real Postgres, since every one of them is
a database-level guarantee. `roster-store.integration.test.ts` is the seed and
assertion style to follow.

**Contract**: Cases — (a) zero sprint rows → one row created, `state='ACTIVE'`
(C4); (b) rollover to a different `jira_sprint_id` → new row `ACTIVE`, old row
`CLOSED`, exactly one `ACTIVE` row for the owner (C2); (c) `cadence_overridden =
true` → `length_days`/`start_day`/`working_days` unchanged while `name`/`state`/
dates refresh (FR-007); (d) `cadence_overridden = false` → cadence columns
refresh; (e) rollover closes the previous sprint's `ACTIVE` anomalies and leaves
the new sprint's untouched (item B); (f) `getActiveSprint` → `null` with the stored sprint's `endDate` still in the
future leaves the row byte-identical, `state='ACTIVE'` (C3); (g) a thrown `JiraUnavailableError` leaves the
stored row byte-identical and writes nothing (C3); (h) two sprint-capable boards
with no `chosenBoardId` → `board_ambiguous`, and `jira_project.board_id` is still
NULL; (i) **rollover with `cadence_overridden = true` on the outgoing row** → the
NEW row carries the same `length_days` / `start_day` / `working_days` and
`cadence_overridden = true`, while `name` / `state` / dates come from Jira. This
is the case (c) cannot reach: (c) exercises the conflict branch, (i) the INSERT
branch; (j) `getActiveSprint` → `null` with the stored sprint's `endDate` in the
past → that row flips to `CLOSED` and every other column is byte-identical, and
`getActiveSprintRow` still returns it via the fallback branch; (k) rollover after
such a demotion still carries a `cadence_overridden = true` forward onto the new
row — the interaction between (i) and (j).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Exactly one **non-test** file still upserts the sprint:
  `grep -rl "insert(sprint)" src --include='*.ts' | grep -v '\.test\.' | wc -l`
  returns `1`. (Counts files, not lines, and excludes the nine
  `*.integration.test.ts` seed blocks — the line-counting form returns 13 both
  before and after this phase.)
- The `cadence_overridden` SET exists in one file:
  `grep -rl "cadenceOverridden}" src --include='*.ts' | wc -l` returns `1`.
  (The SET is three `case when` lines, so a line count returns 3, not 1; the
  glob must be quoted or zsh fails the command before grep runs.)

#### Manual Verification:

- The setup wizard's cadence step still works end to end after the repoint: on a
  real-credential account, `/setup/team` shows the auto-pulled sprint name and
  cadence, and the multi-board chooser still renders when the project has more
  than one board.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Wire the reconcile into the sync cycle

### Overview

Insert the reconciler at the seam, restructure the surrounding call order so it is
covered by `classifyError`, extend the skip vocabulary, and grow the test mock —
which otherwise fails every existing Jira test in the file.

### Changes Required:

#### 1. The seam

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Ask Jira which sprint is active before deciding what to pull, so a
rollover is followed within one cycle and an owner with no sprint row gets one.

**Contract**: Inside `syncJira`, after `acquireLease` succeeds (`:604`):

- Move `baseUrl` and `jiraCreds` (`:615-616`) above the insertion point.
- Move the `try` block that currently opens at `:628` up to just after the lease,
  so a reconcile throw reaches the existing `classifyError` → `finalizeSyncState`
  path unchanged.
- Move `validateCredentials` (`:635`) above the reconcile — the reconciler needs
  `identity.timeZone` for `deriveCadence`. Same subrequest, earlier; the
  `jira_project.timeZone` write at `:748` still uses the same `identity`.
- Call `reconcileActiveSprint` with the project row (already read at `:592-597`),
  `project.boardId` (add it to that select — the column is currently write-only),
  and `identity.timeZone`.
- Derive `chosenSprint` from the result: `reconciled` → the returned row; any
  other status → fall back to the `getActiveSprintRow` read at `:601`. A reconcile
  that cannot conclude must not stop a working account from syncing its stored
  sprint.
- Move the `if (!chosenSprint)` early return (`:606-613`) below the reconcile, and
  record the reconcile's status as the outcome — `board_ambiguous`, `no_board`,
  `no_active_sprint`, `sprint_undated` — falling back to `no_sprint` when the
  reconcile succeeded but no row resolved. `status` stays `OK`.
- Add a comment at the seam recording the one-cycle empty window and why the two
  transactions are not merged.

- Move the cursor guard (`:617-626`) below the reconcile with it — it reads
  `chosenSprint.id`, which is only known once the reconcile has returned.

Everything downstream is otherwise unchanged: the cursor guard already
compares `lease.jiraCursorSprintId` against `chosenSprint.id` and drops the delta
clause on a mismatch, which is exactly the rollover case it was built for
(`schema.ts:400-416`) and has never fired in production.

#### 2. Widen the skip-reason unions

**Files**: `src/lib/integrations/sync/run-sync.ts`, `src/lib/integrations/sync/actions.ts`

**Intent**: Let the new outcomes travel through the existing typed channels
without inventing a second vocabulary.

**Contract**: Extend `IntegrationOutcome`'s `SKIPPED.reason` union
(`run-sync.ts:113-116`) and `SyncNowOutcome`'s (`actions.ts:38-41`) in lockstep
with the four new strings; `toClientOutcome` (`actions.ts:49-57`) needs no change.
`sync-now-button.tsx:31` renders reasons generically
(`outcome.reason.replace(/_/g, " ")`), so no UI switch is affected. No
`sync_status` enum value is added — see *What We're NOT Doing*.

#### 3. Grow the integration-test mock

**File**: `src/lib/integrations/sync/run-sync.integration.test.ts`

**Intent**: Not optional. `jiraFetch` throws on any unrecognised URL (`:205`), so
without this every existing Jira test in the file fails the moment `syncJira`
makes an agile call.

**Contract**: Add two branches to `jiraFetch` (`:171-208`) before the throw:
`/rest/agile/1.0/board?` returning a one-board page, and
`/rest/agile/1.0/board/{id}/sprint?` returning the active sprint — by default
`id: 42` with dates matching the seeded row (`:259-271`), so existing tests see a
no-op reconcile. Expose options to override the returned sprint and the board
list, so the new cases can drive a rollover and an ambiguous board. Set
`jira_project.boardId` in `seedOwner` (`:249-252`).

#### 4. Cycle-level cases

**File**: `src/lib/integrations/sync/run-sync.integration.test.ts`

**Intent**: Pin the behaviours that only exist once the reconcile is inside the
cycle — the ones Phase 2's module tests cannot reach.

**Contract**: Cases — (a) Jira names a different sprint → the cycle pulls the new
sprint's tickets, the cursor guard drops the delta clause (assert via the
`searchJql(calls)` helper at `:611-614`, the sprint-switch analogue at `:609-658`),
and one `ACTIVE` row remains; (b) an owner seeded with **no** sprint row syncs
successfully and ends with one (C4) — today this path returns `SKIPPED{no_sprint}`
forever; (c) a PAT that `/myself` accepts but whose agile call returns 401 — the mock
must return 200 on `/myself` and 401 on `/rest/agile/1.0/…`, since a blanket 401
is caught by `validateCredentials` first and would never exercise Phase 1 —
classifies as `ERROR`, not `RATE_LIMITED` (C5);
(d) `getActiveSprint` → `null` with a stored sprint present → the cycle still
pulls the stored sprint and the row is unchanged; (e) an ambiguous board with a
stored sprint → the cycle pulls normally and reports `OK`; with no stored sprint →
`SKIPPED{board_ambiguous}`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration` — including every
  pre-existing Jira case in `run-sync.integration.test.ts`
- Mutation score holds: `npm run test:mutation` — a plain regression guard, not
  coverage of this phase: `stryker.conf.json` is scoped to the anomaly rules
  (CLAUDE.md), so neither the reconciler nor `run-sync.ts` is mutated. It must
  not drop; it will not rise.

#### Manual Verification:

- On a real-credential account, `/settings/connections` → "Sync now" produces a
  `sprint` row whose `jira_sprint_id` matches the sprint Jira currently shows as
  active — the FR-007 outcome itself.
- Dashboard "Today" renders that sprint's tickets and anomalies after the sync,
  with the last-successful-sync timestamp fresh.
- `select count(*) from sprint where owner_id = $1 and state = 'ACTIVE'` returns 1.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Close the wizard's entry point and record the lesson

### Overview

Two small, independent items from the approved scope: the missing project-change
sprint delete on the wizard path (E), and the pending `lessons.md` entry (H).

### Changes Required:

#### 1. Symmetry fix on the wizard's Jira store

**File**: `src/lib/integrations/jira-store.ts`

**Intent**: `storeJiraIntegration` upserts `jira_project` **in place**, preserving
the row id so nothing cascades, and never touches `sprint` (`:200-220`). Seeding
demo data and then connecting real Jira therefore leaves the demo sprint alive,
silently re-parented to the real project — `project_key` flips to the real key
while `jira_sprint_id` stays `1001`. That is the documented incident
(`dashboard-sprint-detail/plan.md:1020-1052`). The settings path was hardened for
exactly this (`connection-service.ts:405-411`); the wizard path was not.

**Pre-condition — settle the confirmation question first.** The settings path
pairs this delete with a gate: `jira-project-editor.tsx:24` records that a project
change "is DESTRUCTIVE, so it opens with a confirmation rather than the picker",
and `connection-service.ts:406-408` justifies the delete by "the caller's
destructive confirmation already promises" it. `jira-connect-form.tsx` has **no**
such gate — its only `destructive` Alert (`:211`) is an error banner. So before
writing the delete, establish whether a post-setup account can re-enter
`/setup/jira` and change projects (check the onboarding routing guard). If it
can, mirror the settings confirmation before the delete lands. If it cannot, the
path is pre-first-sync and there is nothing to discard — record that finding here
in one line so the asymmetry with the settings path is deliberate rather than
overlooked.

**Contract**: Inside the existing transaction, capture the pre-upsert
`jira_project.jiraProjectId` for this owner and, when the incoming project differs,
delete that owner's sprints for the existing project row — mirroring
`connection-service.ts:405-411`, including its comment's reasoning that
`jira_ticket` and `jira_status_history` cascade off `sprint`. Clear `boardId` and
`timeZone` with it, as the settings path does (`:398-400`): both describe the
project being left behind. Scoped to this symmetry only — full demo↔real
delineation stays with S-09 / PRD Open Question #2.

#### 2. Integration coverage for the symmetry fix

**File**: the existing integration test covering `storeJiraIntegration`

**Intent**: Pin that switching projects through the wizard discards the previous
project's sprint, so the incident cannot be reintroduced.

**Contract**: One case — store project A, insert a sprint against it, store
project B, assert zero sprints remain; plus a control asserting that re-storing
the **same** project keeps the sprint (the settings path's own distinction at
`connection-service.ts:404`).

#### 3. The pending lesson

**File**: `context/foundation/lessons.md`

**Intent**: Land the "narrowing predicate → empty result is indistinguishable from
true absence" entry, unwritten since 2026-08-23
(`dashboard-sprint-detail/plan.md:1103-1117`). S-16 fixes exactly this class, and
three of this project's most expensive bugs share it: `listBoards`' `type ===
"scrum"` filter, the sprint-blind delta cursor, and the `sprint = 1001` query.

**Contract**: Append one section in the file's established four-part shape —
`- **Context**` / `- **Problem**` / `- **Rule**` / `- **Applies to**` — matching
the five existing entries. The Rule must carry the actionable half: when a query
narrows on a value that came from elsewhere, an empty result must be treated as
"predicate may be wrong" and be distinguishable in the operator log from a
legitimate empty set — not silently reported as success.

#### 4. Correct the false retention claim

**File**: `src/app/(app)/settings/absences/page.tsx`

**Intent**: The module doc comment at `:24` tells the reader "retention already
bounds it to current + 2 previous sprints" as the justification for showing an
unwindowed absence list. No retention exists — `grep -i "retention|purge|prune"
src/` finds only `SYNC_ATTEMPT_RETENTION` for the operational log. S-16 turns "one
sprint row per owner" into a growing series, which makes the claim more wrong, not
less.

**Contract**: One-line doc-comment correction naming the bound as *planned* (S-12)
rather than existing, keeping the surrounding reasoning intact. No behaviour
change; the list stays unwindowed for the reasons the comment already gives.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- The lesson landed: `grep -c "^## " context/foundation/lessons.md` returns `6`

#### Manual Verification:

- On a local account, connecting a *different* Jira project through the setup
  wizard discards the previous project's sprint — matching what the settings path
  already does.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- `src/lib/jira.test.ts` — 401 → `JiraAuthError` and 404 → `JiraBoardNotFoundError`
  on both agile endpoints, with the existing 5xx cases still asserting
  `JiraUnavailableError`.
- `src/lib/integrations/cadence.test.ts` — unchanged; `deriveCadence` is reused
  as-is and this file is pure.

### Integration Tests:

- `reconcile-sprint.integration.test.ts` — the eleven cases in Phase 2 §3, against
  real Postgres. The invariants being tested (one `ACTIVE` row; `cadence_overridden`
  preservation; nothing written on failure) are database-level guarantees that a
  mocked DB cannot prove.
- `run-sync.integration.test.ts` — the five cycle-level cases in Phase 3 §4, plus
  every pre-existing Jira case in the file, which must still pass.
- The `storeJiraIntegration` project-switch case in Phase 4 §2.

### Manual Testing Steps:

Written into `context/changes/sprint-reconciliation/MANUAL-CHECKLIST.md` at
implementation time, per the repo's 3–5-rows-per-slice convention. The rows that
belong there — each blocking, each unreachable from automation:

1. **Rollover on real data** (`/settings/connections`, real-credential account) —
   close the sprint in Jira, start a new one, click "Sync now", confirm Dashboard
   "Today" shows the new sprint's tickets. *Catches*: the reconcile not firing at
   all, which is the whole slice.
2. **Cadence override survives a cycle _and a rollover_** (`/setup/team` then
   "Sync now") — set a custom sprint length, sync, confirm it is unchanged; then
   roll the sprint over in Jira, sync again, and confirm the custom length is
   still there on the NEW sprint. *Catches*: a reconcile that erases the owner's
   override — the most damaging way this slice can fail, and silent. The second
   half is not optional: the same-sprint cycle passes through the conflict branch,
   which was never the branch at risk.
3. **The wizard still works after the repoint** (`/setup/team`) — the cadence step
   shows the auto-pulled sprint, and the multi-board chooser still renders.
   *Catches*: Phase 2 breaking the only path that exists today.
4. **The empty window** — reload Dashboard "Today" repeatedly during the first
   post-rollover sync. *Catches*: an empty inbox lasting longer than the
   documented seconds, which would mean the reconcile and the pull are not in the
   same cycle after all.

## Performance Considerations

For an owner whose `jira_project.board_id` is set, the reconcile adds **one** Jira
subrequest per cycle (`getActiveSprint`). `validateCredentials` already costs one
per cycle on this same path and is merely being reordered.

**Two populations pay more, and one of them pays it forever.** `listBoards` runs
whenever `board_id` is NULL or the stored board 404s — and `board_ambiguous` /
`no_board` deliberately persist nothing, so those owners' `board_id` stays NULL
and `listBoards` re-runs every cycle until someone picks a board at `/setup/team`.
`listBoards` is paginated, capped at `MAX_AGILE_PAGES = 20` (`jira.ts:441`), so
the realistic cost there is **+2** subrequests per cycle, not +1. This is not an
edge population: `board_id` is NULL for every demo-seeded account and for every
account that came through `storeJiraIntegration` (`change.md`, research item C).
An owner with no stored sprint at least sees the `board_ambiguous` outcome in
their sync history; an owner who has one syncs fine, reports plain `OK`, and is
never told to pick — so nothing prompts them to end the repeat.

At the PRD's scale this stays inside a classic PAT's 5000 req/h ceiling; PRD Open
Question #3 (measuring that budget at 50 owners × 4 cycles/hour) remains open and
is not resolved here.

The transaction grows by two owner-scoped `UPDATE`s — the demotion and the anomaly
sweep — both hitting indexed `owner_id` predicates on tables bounded by a single
team's sprint.

## Migration Notes

**No schema migration.** Every column the reconcile writes already exists.

Existing accounts converge on their own: the first cycle after deploy reconciles
each owner's sprint, and an account that already carries two `ACTIVE` rows has the
extras demoted at that moment — which is also when its two nondeterminism twins
(`setup/team/page.tsx:32-42`, `saveCadence`) stop being reachable. No backfill
script is needed, and none should be written: the cycle is the backfill.

The demo-seeded `jira_sprint_id=1001` row loses `ACTIVE` on the first real cycle
and stops winning `getActiveSprintRow`. Its `jira_ticket` / `anomaly` /
`team_member` rows detach and linger — full cleanup is S-09.

## References

- Change identity and approved scope: `context/changes/sprint-reconciliation/change.md`
- Research: `context/changes/sprint-reconciliation/research.md`
- The upsert to preserve: `src/lib/integrations/roster-store.ts:838-870`
- The seam: `src/lib/integrations/sync/run-sync.ts:599-628`
- The pattern Phase 4 mirrors: `src/lib/settings/connection-service.ts:390-411`
- The incident this closes: `context/changes/dashboard-sprint-detail/plan.md:1020-1052`
- The finding that filed S-16: `context/changes/dashboard-sprint-detail/reviews/impl-review.md:117-134`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Jira client — classify 401 on the agile endpoints

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — 3048ba7
- [x] 1.2 Linting passes: `npm run lint` — 3048ba7
- [x] 1.3 Unit tests pass: `npm test` — 3048ba7
- [x] 1.4 New assertions exist: `grep -n "JiraBoardNotFoundError" src/lib/jira.test.ts` returns a match — 3048ba7

### Phase 2: The shared sprint reconciler

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 3679cd2
- [x] 2.2 Linting passes: `npm run lint` — 3679cd2
- [x] 2.3 Unit tests pass: `npm test` — 3679cd2
- [x] 2.4 Integration tests pass: `npm run test:integration` — 3679cd2
- [x] 2.5 Exactly one non-test file still upserts the sprint — 3679cd2
- [x] 2.6 The `cadence_overridden` SET exists in one file — 3679cd2

#### Manual

- [ ] 2.7 The setup wizard's cadence step still works end to end after the repoint

### Phase 3: Wire the reconcile into the sync cycle

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — 5912485
- [x] 3.2 Linting passes: `npm run lint` — 5912485
- [x] 3.3 Unit tests pass: `npm test` — 5912485
- [x] 3.4 Integration tests pass: `npm run test:integration` — 5912485
- [x] 3.5 Mutation score holds: `npm run test:mutation` (regression guard only — Stryker is scoped to the anomaly rules) — 5912485

#### Manual

- [ ] 3.6 Real-credential "Sync now" produces a `sprint` row matching Jira's active sprint
- [ ] 3.7 Dashboard "Today" renders that sprint's tickets and anomalies
- [ ] 3.8 Exactly one `ACTIVE` sprint row for the owner

### Phase 4: Close the wizard's entry point and record the lesson

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit`
- [x] 4.2 Linting passes: `npm run lint`
- [x] 4.3 Unit tests pass: `npm test`
- [x] 4.4 Integration tests pass: `npm run test:integration`
- [x] 4.5 The lesson landed: `grep -c "^## " context/foundation/lessons.md` returns `6`

#### Manual

- [ ] 4.6 Connecting a different Jira project through the wizard discards the previous project's sprint
