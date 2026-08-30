# Disconnect Data Retention (S-26) Implementation Plan

## Overview

Disconnecting an integration stops destroying data the lead entered by hand, and
stops silently corrupting a permanent record. The cascade is narrowed so
`absence` and the whole GitHub subtree survive; Disconnect and the Jira project
switch each offer two completions — keep (default) or deliberately clear; and a
re-created `sprint` row recovers its frozen commitment from `sprint_measurement`
instead of freezing a second time at the wrong sum.

## Current State Analysis

Framing, evidence and the owner's scope decisions are settled in
`context/changes/disconnect-data-retention/frame.md`. What matters here:

- **Nothing in `src/` ever deletes an `absence` row explicitly.** Absences die
  only as a side effect of a `sprint` row being deleted — cascaded through
  `jira_credential`→`jira_project`→`sprint` on disconnect
  (`jira-store.ts:301-310`, `schema.ts:317-319,410-412,642-644`), and by an
  explicit `tx.delete(sprint)` on the project switch
  (`connection-service.ts:416-423`). One referential-action change therefore
  neutralises both paths.
- **`absence.sprint_id` has no reader.** S-20 settled it as write-time
  provenance; `SPRINT_AT_RISK` matches by dates (`sprint-at-risk.ts:117-131`),
  joining four date-based siblings. The column is already nullable
  (`schema.ts:642-644`), so the migration needs no `DROP NOT NULL` step.
- **The GitHub subtree is re-linkable, unlike the Jira one — but only after the
  wizard's reconnect stops minting new ids.** `monitored_repo` carries
  `unique("monitored_repo_owner_repo_uq").on(owner_id, github_repo_id)`
  (`schema.ts:306-308`) — a durable GitHub-side key — and commits, PRs and
  reviews hang off the internal `monitored_repo.id`. By contrast
  `jira_project.id` / `sprint.id` are `randomUUID()` and are hard-deleted, which
  is why `anomaly` and `status_mapping` cannot be kept and stay in the cascade.

  **The internal id does NOT survive a reconnect today (plan-review F1).**
  `storeGithubIntegration` (`github-store.ts:157-166`) writes the repo set as
  `tx.delete(monitoredRepo).where(eq(ownerId))` followed by an insert with fresh
  `randomUUID()`s, so every `github_commit` / `github_pull_request` cascades away
  and reviews go with the PRs. After a disconnect the credential row is gone, so
  the wizard IS the reconnect path — a "keep" that the next screen undoes is not
  a keep. This repo has already reached this verdict once for the sibling path:
  `connection-service.ts:297-304` refuses the idiom in so many words and uses a
  differential upsert instead (impl-review F1), and `lessons.md:35-40` states the
  rule with the corollary to check inbound referential actions first. Phase 2
  brings the wizard path along; without it the GitHub half of this slice is copy,
  not behaviour.
- **The guard test already models the outcome.** `deriveImpact`
  (`disconnect-impact.test.ts:61-91`) walks only `cascade` edges (`:69`) and
  models `set null` separately as `weakened` (`:79-87`). Changing the FK
  reclassifies the tables automatically; only the declaration in
  `disconnect-impact.ts` moves.
- **The dialog shell already supports two completions.** `ConfirmDialog.secondary`
  (`confirm-dialog.tsx:30-34,99-107`) renders a second `AlertDialogAction` with
  its own `onConfirm`, variant and pending gate. `roster-editor.tsx:859-885`
  uses exactly this shape (`Deactivate` primary, `Delete permanently` secondary).
  `disconnect-confirm.tsx:54-56` merely declines to pass it.
- **Prior art for the migration exists.** `0019_old_spectrum.sql` took
  `daily_recap.sprint_id` off cascade for the same reason (a project switch was
  destroying the recap archive). Drop + recreate the auto-named constraint.
- **`committed_sp` re-freezes on reconnect.** `run-sync.ts:882-921` freezes once,
  guarded by `committed_frozen_at IS NULL`. A re-created sprint row has that NULL,
  so the next full pull — forced, because `jiraCursorSprintId` no longer matches
  the new `sprint.id` (`run-sync.ts:712-722`) — re-freezes at the reconnect-time
  sum. `sprint_measurement.committedSp` is copied and never recomputed
  (`schema.ts:502-506`) and feeds FR-024 for the team's lifetime.
  `shouldRecompute` (`sweep.ts:66`) protects already-finalized records, so the
  damage is bounded to a sprint still in flight.
- **There is no automated route from merge to a migrated production database.**
  CI migrates its own ephemeral Postgres (`.github/workflows/ci.yml:53`);
  Cloudflare Workers Builds deploys code only. `DATABASE_URL_OVERRIDE` +
  `npm run db:migrate` is the sole documented route (`drizzle.config.ts:8-16`),
  and `lessons.md:56-60` records that S-12 shipped `0019`/`0020` without applying
  them.

## Desired End State

A lead who disconnects Jira or GitHub is asked, and gets two real choices. The
default keeps everything they entered by hand and everything a reconnect can
re-link; the second, destructive choice removes it deliberately. A lead who
rotates a token mid-sprint and reconnects finds their absences intact and their
sprint's committed story points unchanged.

Verified by: the guard test deriving `absence` as weakened rather than destroyed;
integration tests proving an `absence` row survives a real `jiraCredential`
delete against Postgres; and an integration test that disconnects mid-sprint,
reconnects, re-syncs, and asserts `committed_sp` did not move.

### Key Discoveries

- `absence.sprint_id` is already nullable — the migration is drop + recreate only
  (`schema.ts:642-644`, constraint named in `0001_lying_human_cannonball.sql:270`).
- `deriveImpact` treats any `onDelete` that is neither `cascade` nor `set null` as
  fully unaffected, so the guard model needs no new code for a "kept" outcome
  (`disconnect-impact.test.ts:69,79-87`).
- `boundary-inventory.test.ts:50` scans source text for the literal
  `/if\s*\(\s*isDemo\s*\)\s*return/`. Adding a parameter to the disconnect actions
  must not disturb that shape.
- `e2e/disconnect.ts:31` is the single helper all four E2E disconnect flows use;
  it clicks one confirm button by accessible name.
- `sprint_measurement` has no foreign key at all, by design
  (`schema.ts:446-470`) — which is what makes it available as the authority in
  Phase 5.

## What We're NOT Doing

- **Not keeping `anomaly`.** `sprint_id` is `NOT NULL`, sits in the dedup key
  `(owner_id, sprint_id, dedup_key)` (`schema.ts:913-917`) and the rollover sweep
  depends on its NULL-free comparison (`reconcile-sprint.ts:283`). Rows are fully
  re-derived by the next detection cycle.
- **Not keeping `status_mapping`.** Owner decision: the lead passes through the
  wizard on reconnect and re-mapping is one step. It is also wiped and re-inserted
  on every `storeJiraIntegration` call regardless of project change
  (`jira-store.ts:262-275`), so preserving the row would not take effect.
- **Not deleting `sprint_measurement` in either branch.** Owner decision. The PRD
  amended its own retention non-goal for exactly this record; a disconnect never
  touched it and still does not.
- **Not restoring the erased cadence override.** It has the same root — carry-forward
  reads the previous sprint row, which the cascade removed, so the row reseeds with
  Jira's defaults and `cadenceOverridden: false` (`reconcile-sprint.ts:190-231`) —
  but `sprint_measurement` stores a working-day COUNT, not the cadence
  configuration, so Phase 5's mechanism does not reach it. Recorded here and
  proposed as a roadmap entry rather than smuggled into this slice.
- **Not fixing the affordance problem.** Reconnect already rotates a token
  losslessly (`jira-store.ts:189-231`); that Disconnect sits beside it looking
  equally reasonable is a UI question this slice does not own. Roadmap line.
- **Not changing demo behaviour.** S-24 and S-27 settled it; this slice only keeps
  the existing refusal shape intact.

## Implementation Approach

Narrow the cascade first, so the default outcome becomes safe even before any UI
exists; then give the stores two explicit outcomes; then surface the choice.
Each phase leaves the app in a shippable state: after Phase 1 nothing is lost on
a disconnect, after Phase 2 a deliberate wipe is possible from the server, after
Phase 3 the lead can express the choice.

## Critical Implementation Details

**Ordering.** Phase 1's migration must be applied to every environment before
Phase 2's `clear` path is exercised, because `clear` deletes explicitly what the
cascade previously removed — running Phase 2's code against an un-migrated
database double-deletes harmlessly, but running Phase 1 without Phase 2 leaves no
way to wipe at all. Ship them in order, in one branch.

**Nullable `monitored_repo.credential_id` is a new state the read path has never
seen.** Between a keep-disconnect and a reconnect, repos exist with no
credential. Every query that joins `monitored_repo` to `github_credential` must
tolerate the null rather than silently dropping rows — the sync path cannot run
without a credential anyway, but the settings and dashboard read paths render
counts.

---

## Phase 1: Schema and migration — narrow the cascade

### Overview

`absence` and the GitHub subtree stop dying with their credential. The impact
model is re-declared to match, and the schema-derived guard test proves the two
agree.

### Changes Required:

#### 1. Schema

**File**: `src/db/schema.ts`

**Intent**: Take `absence` off the sprint cascade and `monitored_repo` off the
credential cascade, so neither disconnect path destroys them by side effect.

**Contract**: `absence.sprintId` (`:642-644`) changes `onDelete` from `"cascade"`
to `"set null"`; column stays nullable, no other change.
`monitoredRepo.credentialId` (`:298-300`) loses `.notNull()` and changes
`onDelete` from `"cascade"` to `"set null"`. `unique("monitored_repo_owner_repo_uq")`
is untouched — it is what re-links a repo on reconnect.

#### 2. Migration

**File**: `src/db/migrations/0021_<generated>.sql` (+ `meta/_journal.json` entry)

**Intent**: Apply both referential-action changes, following the one prior art in
this repo for the same move.

**Contract**: Generated by `npm run db:generate`. Follow the shape of
`0019_old_spectrum.sql`: `ALTER TABLE … DROP CONSTRAINT "<auto name>"` then
`ADD CONSTRAINT` with the same name and the new `ON DELETE set null`. The
`absence` half needs no `ALTER COLUMN … DROP NOT NULL` (already nullable); the
`monitored_repo` half does. Carry a header comment naming S-26 and why, as 0019
does. **Nothing in this migration deletes rows.**

#### 3. Impact declaration

**File**: `src/lib/integrations/disconnect-impact.ts`

**Intent**: Restate what each root destroys now that two edges no longer cascade,
and introduce the vocabulary the second button needs.

**Contract**: `jira.destroyedTables` loses `"absence"`; `jira.weakenedTables`
gains `{ table: "absence", column: "sprint_id" }`. `github.destroyedTables`
becomes empty (`monitored_repo` survives, so its children are no longer in the
closure); `github.weakenedTables` gains
`{ table: "monitored_repo", column: "credential_id" }`. Add one field to
`DisconnectImpact`: `clears: readonly string[]` — the prose clauses naming what
the destructive second button additionally removes — plus a `clearedTables:
readonly string[]` naming the tables the `clear` store path deletes explicitly.
Move the absence clause out of `jira.destroys` into `jira.clears`; move the
GitHub repo/commit clauses out of `github.destroys` into `github.clears`. `keeps`
gains the corresponding survivors for the default branch.

**`clearedTables` is DERIVED, not asserted in prose** (plan-review F4). This
module's whole premise is the one in its own header — no list here is
hand-maintained, because a hand-maintained list is a second copy that drifts, and
it already did in four places before S-24. A literal `clearedTables` would
reintroduce exactly that at the point where the FK change first makes orphan
children possible. Its definition is mechanical: **`clear` removes precisely what
the cascade stopped removing**, i.e. for every entry in `weakenedTables`, that
table plus its own cascade closure. State it that way in the field's docstring
and hold it in §4 with the existing walker, so a future slice hanging a child
under `absence` or `monitored_repo` fails the build instead of being quietly left
behind by `clear`.

#### 4. Guard and regression tests

**File**: `src/lib/integrations/disconnect-impact.test.ts`

**Intent**: `deriveImpact` and the two set-equality `it.each` assertions
(`:117-133`) need no change — they re-derive from the schema. FIVE hand-written
assertions below them pin the old behaviour and must be inverted (plan-review F2:
the first draft of this plan froze `:103-153`, which silently included two of
them).

**Contract**: `deriveImpact` itself and the two `it.each` set-equality tests stay
as written. Each of the following changes:

1. *"a Jira disconnect destroys the hand-entered absences"* (`:135-138`) —
   rewritten to assert `absence` appears in `weakenedTables` and in `clears`,
   never in `destroyedTables`. Add the mirror for `monitored_repo` under GitHub.
2. *"daily_recap is weakened, not destroyed"* (`:145-153`) — its
   `expect(...weakenedTables).toEqual([{ table: "daily_recap", column: "sprint_id" }])`
   is an EXACT array equality and `absence` now joins that list. Keep the test's
   point (daily_recap is not destroyed) and assert containment plus the absence
   of `daily_recap` from `destroyedTables`, rather than an exact list that this
   slice and every future one must edit.
3. *"%s names both what goes and what stays"* (`:159-160`) — asserts
   `impact.destroys.length > 0` for EVERY key, and `github.destroys` becomes
   empty. Restate the invariant as `destroys.length + clears.length > 0` so it
   still guards the GitHub entry instead of being deleted, and extend the
   fragment-shape loop (`:162-169`) over `clears` too — the new clauses render in
   the same paragraph and must obey the same "clause, not label" rule.
4. *"the Jira copy says the absences cannot be recovered"* (`:171-175`) — moves
   to the `clears` list, since that is the branch the sentence is now true of.
   (Phase 3 §4 makes the identical move in `disconnect-confirm-copy.test.ts`;
   both copies of the assertion exist and both must move.)
5. *"the project-switch copy keeps the token and the status mapping"*
   (`:177-184`) — unaffected, listed here so the implementer does not have to
   re-check it.

One test is NEW, and it is the one that keeps `clearedTables` honest (F4): for
each of the three roots, assert `clearedTables` equals the union over
`weakenedTables` of `{ entry.table } ∪ deriveImpact(entry.table, edges).destroyed`
— reusing the walker already in the file. A root with no weakened references has
an empty `clearedTables`, which the same expression yields for free.

#### 5. New integration coverage

**Files**: `src/lib/absence-store.integration.test.ts`,
`src/app/(app)/setup/jira/actions.integration.test.ts`,
`src/app/(app)/setup/github/actions.integration.test.ts`

**Intent**: Nothing today verifies the real cascade against Postgres — only the
hermetic schema graph. Prove the new behaviour end to end.

**Contract**: New cases: deleting a `sprint` row leaves its `absence` rows in
place with `sprint_id` null; deleting a `jira_credential` leaves the owner's
absences intact; deleting a `github_credential` leaves `monitored_repo` and its
commits/PRs/reviews in place with `credential_id` null. The three existing
`sprintId` stamping assertions (`absence-store.integration.test.ts:146-161,163-181,245-271`)
remain valid as written — do not touch them.

#### 6. Stale docstrings

**Files**: `src/lib/integrations/jira-store.ts:289-297`,
`src/lib/integrations/github-store.ts:174-179`

**Intent**: Both describe a cascade depth that is about to be wrong; the module
comment in `disconnect-impact.ts:1-22` names the old counts too.

**Contract**: Correct the depth and the table lists; keep the existing
instruction not to restate the list, pointing at `disconnect-impact.ts`.

#### 7. Manual checklist — created here, not at the end

**File**: `context/changes/disconnect-data-retention/MANUAL-CHECKLIST.md`

**Intent**: The migration row has to exist before the manual row that depends on
it, and this phase IS that row (plan-review F5: the first draft created the file
in Phase 6, after five manual rows in Phases 1, 3 and 4 had already come due).

**Contract**: Create the file with ONE row — apply migration `0021` to the
production database via `DATABASE_URL_OVERRIDE` and confirm it is recorded,
having first checked whether `0019`/`0020` are actually applied
(`lessons.md:56-60`). It carries route, exact command, observable pass condition
and the defect it catches, and is signed off `phase 1`. Phases 3 and 4 APPEND
their rows as they close; the file ends at 3–5 rows total, the migration first.

### Success Criteria:

#### Automated Verification:

- Migration generates and applies cleanly against local Supabase: `npm run db:generate && npm run db:migrate`
- Guard test agrees with the schema graph: `npm test -- disconnect-impact`
- Unit suite passes: `npm test`
- Integration suite passes, including the new survival cases: `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Migration `0021` applied to the production database via `DATABASE_URL_OVERRIDE` and confirmed present in the migrations table

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Stores and actions — two outcomes

### Overview

The server learns to do the thing the dialog will offer: disconnect keeping the
lead's data, or disconnect clearing it.

### Changes Required:

#### 1. Store functions

**Files**: `src/lib/integrations/jira-store.ts`, `src/lib/integrations/github-store.ts`

**Intent**: Give each disconnect two modes. `keep` relies on the narrowed
cascade; `clear` additionally deletes, explicitly and owner-scoped, exactly what
the cascade no longer removes.

**Contract**: `disconnectJira({ db, ownerId, mode })` and
`disconnectGithub({ db, ownerId, mode })` where `mode: "keep" | "clear"`. Both
run in a transaction. `clear` for Jira additionally deletes `absence` for the
owner; `clear` for GitHub additionally deletes `monitored_repo` for the owner
(its children follow by cascade). Neither branch touches `sprint_measurement`,
`team_member` or `team_day_off`. The tables each `clear` branch deletes must
equal `DISCONNECT_IMPACT[key].clearedTables`. Ownership remains the only guard —
every added statement carries `owner_id`, as the existing IDOR tests exercise.

#### 2. The wizard's reconnect stops discarding what `keep` kept

**File**: `src/lib/integrations/github-store.ts:157-166`

**Intent**: Without this the GitHub `keep` is copy rather than behaviour. The
FK change lets `monitored_repo` survive the disconnect; `storeGithubIntegration`
then deletes the whole set and re-inserts it with fresh `randomUUID()`s on the
very next screen, cascading away every commit, PR and review the keep preserved.

**Contract**: Replace the delete-then-insert with the differential upsert the
sibling path already runs (`connection-service.ts:305-331`): insert the selected
repos with `.onConflictDoUpdate({ target: [monitoredRepo.ownerId,
monitoredRepo.githubRepoId], set: { credentialId, fullName: sql`excluded.full_name` } })`,
`id` deliberately omitted so a re-connected repo keeps its row identity, then
delete only the repos NOT in the submitted set
(`notInArray(monitoredRepo.githubRepoId, keptRepoIds)`), owner-scoped. The upsert
also re-points `credential_id`, which is what re-links the repos left null by a
keep-disconnect. Carry the same explanatory comment shape as
`connection-service.ts:297-304` — this is the second site to learn the rule in
`lessons.md:35-40`, and a third author must not have to rediscover it.

**Note**: this narrows nothing else. Deselecting a repo in the wizard still
removes it and its synced history, exactly as the settings editor does.

#### 3. Server Actions

**Files**: `src/app/(app)/setup/jira/actions.ts:300`,
`src/app/(app)/setup/github/actions.ts:211`

**Intent**: Thread the mode from the client without disturbing the demo refusal,
and without trusting the client to name the destructive branch.

**Contract**: Both exported actions take the mode as their argument and pass it
through. **The literal `if (isDemo) return demoRefusal…` line must remain
textually intact and remain the first statement after the session resolution** —
`boundary-inventory.test.ts:50` matches it with a regex over the file's source.

**The argument is validated server-side and fails toward `keep`** (plan-review
F3). A Server Action parameter is a public HTTP parameter and the
`"keep" | "clear"` union is erased at runtime, so the type at the four call sites
guards nothing an attacker — or a future caller passing `undefined` — has to
respect. Parse it like every other inbound value in this repo
(`src/lib/validations/`), and resolve **anything that is not exactly `"clear"` to
`"keep"`**: the safe branch is also the product default, so the guard and the
design agree rather than pulling apart. The coercion belongs in the action, above
the store call, not in the store — the store's contract stays the honest
two-member union.

Add to §4: `undefined → keep` and a garbage string `→ keep`, asserted against
real Postgres for both integrations, so the fail-safe is a test rather than a
sentence in a plan.

#### 4. Tests

**Files**: the two `actions.integration.test.ts`,
`src/app/(app)/setup/github/actions.integration.test.ts`, store unit tests

**Intent**: Both modes proven against real Postgres — and the keep proven across
the reconnect, not only across the delete.

**Contract**: For each integration: `keep` leaves the retained rows; `clear`
removes exactly `clearedTables` and nothing else — assert explicitly that
`sprint_measurement`, `team_member` and `team_day_off` survive both. Keep the
existing cross-owner isolation case (`jira/actions.integration.test.ts:458`) and
extend it so account A's absences survive account B's `clear`.

The case that pins §2 must span the whole round trip, because a test that stops
at the delete passes today: seed a `monitored_repo` with commits, PRs and
reviews; `disconnectGithub` with `keep`; assert `credential_id` is null and the
children are still there; then call `storeGithubIntegration` with the SAME repo
selected and assert the `monitored_repo.id` is unchanged and every child row
survived. Add the mirror negative: a repo left OUT of the reconnect selection
does go, with its children.

### Success Criteria:

#### Automated Verification:

- Demo boundary guard still matches both actions: `npm test -- boundary-inventory`
- Unit suite passes: `npm test`
- Integration suite passes with both modes covered: `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- A repo's synced history survives disconnect-with-keep AND the reconnect that follows: `npm run test:integration -- setup/github`

#### Manual Verification:

- None — no user-visible surface changes in this phase

---

## Phase 3: The dialog — two buttons

### Overview

The lead is offered the choice, with keeping as the default and clearing as the
explicitly destructive second action.

### Changes Required:

#### 1. Disconnect dialog

**File**: `src/components/molecules/disconnect-confirm.tsx`

**Intent**: Stop omitting `secondary`; offer keep as the primary confirm and
clear as the destructive alternative.

**Contract**: `onConfirm` becomes `(mode: DisconnectMode) => Promise<void>`. The
primary action keeps (non-destructive variant); `secondary` is
`{ label: …, variant: "destructive", onConfirm: () => onConfirm("clear") }`.
Replace the comment at `:54-56` — it asserts no safer alternative exists, which
this change makes false. Follow the shape at `roster-editor.tsx:859-885`.

**One line changes in the shell itself** (plan-review F7):
`confirm-dialog.tsx` renders the `isPending` label (`"Working…"`) only on the
PRIMARY action (`:107-112`); the secondary keeps its own label and is merely
disabled (`:97-105`). Under this change the secondary is the irreversible branch,
so the more dangerous of the two buttons would be the one with no progress
signal while a slow Server Action runs. Give `secondary` the same pending
treatment. It is a change to a shared shell, so it also lands on
`roster-editor.tsx`'s "Delete permanently" — which wants it for the same reason,
and is the only other `secondary` consumer.

#### 2. Copy layer

**File**: `src/components/molecules/disconnect-confirm-copy.ts`

**Intent**: Say what each of the two buttons does, sourced from
`DISCONNECT_IMPACT` so it cannot drift from the schema.

**Contract**: `disconnectDescription` composes `destroys` (what goes either way),
`keeps` (what survives by default) and `clears` (what the second button
additionally removes) via `joinClauses`. Add label helpers for both buttons. The
description stays a plain string — it renders inside `AlertDialogDescription` →
Radix `Primitive.p`, where a list would be invalid nesting.

**Both accessible names are DECIDED here, not in Phase 6** (plan-review F6), and
the constraint on them is not stylistic. `e2e/disconnect.ts:11-18` records that
`getByRole`'s `name` is a case-insensitive SUBSTRING match, which is why the
existing helper needs `{ exact: true }` on every locator — with the dialog open,
`"Disconnect"` already matches the trigger AND the dialog's action, and
`"Connect"` matches three nodes. A second action makes that worse in a way the
copy can prevent or guarantee:

- **Neither label may be a substring of the other, nor of the trigger's
  `"Disconnect"`, in either direction.** `"Disconnect Jira"` /
  `"Disconnect Jira and delete data"` is exactly the pair that breaks — the first
  is a strict-mode violation the moment the second exists, even under
  `{ exact: true }` for the trigger. A pair like `"Keep my data"` /
  `"Delete everything"` has no shared prefix and no overlap with the trigger.
- The existing `confirmLabel !== "Disconnect"` assertion in
  `disconnect-confirm-copy.test.ts` stays, and gains a sibling asserting the
  mutual-non-substring property across all three strings, per integration. That
  test is what stops a later copy edit from silently breaking four E2E specs
  the local suite cannot run in a worktree (`lessons.md`, worktree entry).

Phase 6 §1 then consumes these literals rather than discovering them.

#### 3. Call sites

**Files**: `src/components/organisms/setup/jira-connection-status.tsx:54-70`,
`src/components/organisms/setup/github-connection-status.tsx:50-67`,
`src/components/organisms/settings/integration-card.tsx:126,162-171`,
`src/app/(app)/settings/connections/page.tsx:66,103`

**Intent**: Carry the mode from the dialog to the Server Action through all four
paths.

**Contract**: Each `handleDisconnect` takes the mode. `integration-card.tsx`'s
`onDisconnect` prop type (`:126`) becomes
`(mode: DisconnectMode) => Promise<{ ok: true } | { ok: false; message: string }>`;
the two bindings on the Connections page pass the Server Actions through
unchanged in shape. `isDemo` continues to disable the trigger (`:282`).

#### 4. Copy tests

**File**: `src/components/molecules/disconnect-confirm-copy.test.ts`

**Intent**: The existing assertions pin sentences this change invalidates.

**Contract**: The Jira assertions on `/cannot be synced back/` and `absences`
appearing among the destroyed must move to the clear-branch copy. Keep the
structural assertions (sentence count, no double punctuation, confirm label ≠
"Disconnect"). Add cases asserting the keep branch names absences as surviving,
and that both integrations expose two distinct button labels.

### Success Criteria:

#### Automated Verification:

- Copy tests pass: `npm test -- disconnect-confirm-copy`
- Unit suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On `/settings/connections`, Disconnect offers two clearly different buttons and Cancel; the default (primary) button keeps data
- After choosing keep on Jira, recorded absences are still present at the absences surface
- After choosing clear on Jira, they are gone

These three rows are APPENDED to `MANUAL-CHECKLIST.md` as this phase closes, below
the migration row Phase 1 §7 created (plan-review F5).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: The project switch gets the same choice

### Overview

The third path into the same loss stops behaving differently from the other two.

### Changes Required:

#### 1. Service

**File**: `src/lib/settings/connection-service.ts:359-446`

**Intent**: `updateJiraProject` takes the same mode and honours it on the branch
that deletes the previous project's sprints.

**Contract**: The explicit `tx.delete(sprint)` (`:416-423`) stays — sprints are
the previous project's synced state. Under `clear`, additionally delete the
owner's `absence` rows; under `keep`, do not. The `projectChanged` guard
(`:402`) is unchanged.

**A kept absence crosses the project boundary, and that is the decision**
(plan-review F8). Under `keep` the previous project's absences survive with
`sprint_id` NULL, and `SPRINT_AT_RISK` matches absences by DATE, not by sprint
(`sprint-at-risk.ts:117-131`) — so from the first sync they feed the NEW
project's risk score and its capacity. That is the right answer, because an
absence is a fact about a PERSON on a calendar and the roster it hangs off
(`absence.team_member_id`) is untouched by a project switch: a developer on
holiday is on holiday whichever project the lead is watching. But it is a
behaviour the lead is entitled to be told about rather than to discover, so it is
stated in the copy rather than left implicit — §3 puts it in `keeps`.

#### 2. Editor surface

**File**: `src/components/organisms/settings/jira-project-editor.tsx`

**Intent**: Offer the choice on the surface that already carries a bespoke
destructive `Alert` gating a multi-step flow.

**Contract**: The existing inline `Alert` gains a second confirming control
rather than being replaced by `ConfirmDialog` — the modal cannot serve a flow
that must stay visible across steps, which is why this surface diverged in the
first place. Both controls read their copy from
`DISCONNECT_IMPACT.projectSwitch`.

#### 3. Impact copy

**File**: `src/lib/integrations/disconnect-impact.ts`

**Intent**: `projectSwitch` currently lists `absence` as destroyed; after Phase 1
it is not.

**Contract**: `projectSwitch.destroyedTables` loses `"absence"`;
`weakenedTables` gains it; the absence clause moves from `destroys` to `clears`.
The guard test re-derives this automatically.

`projectSwitch.keeps` gains a clause saying the absences stay with the TEAM
rather than with the project — a fragment, lowercase-initial, no trailing period,
per the shape assertion in `disconnect-impact.test.ts` — so §1's cross-project
semantics is something the lead reads before switching rather than infers from a
risk score afterwards (plan-review F8).

### Success Criteria:

#### Automated Verification:

- Guard test agrees for all three roots: `npm test -- disconnect-impact`
- Unit suite passes: `npm test`
- Integration suite passes, with a project-switch case asserting absences survive `keep`: `npm run test:integration`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Switching the monitored Jira project with keep leaves recorded absences intact
- The warning text on that surface names the same outcomes the buttons deliver

Appended to `MANUAL-CHECKLIST.md` as this phase closes (plan-review F5).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: The measurement is the authority for the frozen commitment

### Overview

A re-created sprint recovers what it was, instead of being mistaken for a sprint
never seen and re-frozen at the wrong sum.

### Changes Required:

#### 1. Sprint reconciliation

**File**: `src/lib/integrations/reconcile-sprint.ts:233-264`

**Intent**: When a `sprint` row is created for a `jira_sprint_id` that already has
a measurement record, restore the frozen commitment from it rather than leaving
`committed_frozen_at` NULL.

**Contract**: On insert (not on the metadata refresh path), look up
`sprint_measurement` by `(owner_id, jira_sprint_id)` — its own unique key, no FK
— and seed `committed_sp` and `committed_frozen_at` from
`sprintMeasurement.committedSp` / `.committedFrozenAt` when a record exists and
its `committedFrozenAt` is non-null. Where nothing is found, behaviour is
unchanged. Carry a comment stating the direction of the dependency explicitly:
the sweep copies sprint → measurement (`schema.ts:502-506`), and this is the one
deliberate read back, for the case where the sprint row was destroyed and
recreated.

#### 2. Freeze guard

**File**: `src/lib/integrations/sync/run-sync.ts:882-921`

**Intent**: With `committed_frozen_at` restored, the existing `case when … is
null` guard already refuses to re-freeze. Verify rather than change.

**Contract**: No behavioural change expected. If the restore lands before the
first full pull, the guard holds on its own; assert this rather than adding a
second guard.

#### 3. Regression coverage

**File**: `src/lib/integrations/reconcile-sprint.integration.test.ts` (or the
nearest existing sync integration suite)

**Intent**: Encode the exact scenario that produced the corruption.

**Contract**: Seed an owner mid-sprint with a frozen `committed_sp` and a
non-finalized `sprint_measurement`; disconnect Jira; reconnect with the same
project and sprint; run a full sync; assert `committed_sp` and
`committed_frozen_at` equal their pre-disconnect values, and that the measurement
record was not rewritten with a later commitment. Add the negative case: a sprint
with no measurement record still freezes normally.

### Success Criteria:

#### Automated Verification:

- The disconnect→reconnect regression passes: `npm run test:integration`
- Unit suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- None beyond the automated regression — the scenario is not reachable by hand within a testing session without a live sprint rollover

---

## Phase 6: Documents, E2E and the stale claims

### Overview

Every sentence in the repo that describes the old behaviour is corrected in the
same branch as the behaviour.

### Changes Required:

#### 1. E2E helper and specs

**Files**: `e2e/disconnect.ts:19-37`, `e2e/setup-github.spec.ts:89-126`

**Intent**: The shared helper clicks one confirm button by name; there are now
two. Its choice must be explicit rather than incidental.

**Contract**: `disconnectIfConnected` takes the mode and clicks the button by the
accessible name Phase 3 §2 committed to (plan-review F6 — the labels are an input
here, not a decision), defaulting to `clear` — the fixture account must end each
spec genuinely clean, which `e2e/seed.spec.ts:34` and
`e2e/dashboard-sprint-detail.spec.ts:51` depend on. Keep `{ exact: true }` on
every locator, including the pre-click trigger check, for the reason the file's
own ⚠️ gives. The copy assertions at
`setup-github.spec.ts:110-111` move to whichever branch still names repositories
and synced artefacts. Add one case asserting both buttons are present and
distinguishable.

#### 2. Manual backlog

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: Rows 16.A / 16.B and the section's framing sentence assert that a
confirmed disconnect destroys absences irrecoverably. That becomes false.

**Contract**: Rewrite the framing sentence (~`:2033-2034`) and row 16.B to test
the new pass condition — the dialog offers two outcomes and keep is the default.
Row 16.A's GitHub copy assertions are updated to the branch that still names
repositories. Nothing is deleted; superseded wording moves with its reason.

#### 3. Roadmap and change record

**Files**: `context/foundation/roadmap.md` (S-26 block), `context/changes/disconnect-data-retention/change.md`

**Intent**: The roadmap still lists `anomaly.status` as hand-entered triage; it is
`ACTIVE`/`RESOLVED` written only by `detect.ts` and the rollover sweep.

**Contract**: Correct that sentence, record Open Roadmap Question 4 as answered
with the resolution, and add two proposed entries: the cadence-override erasure,
and the Reconnect-vs-Disconnect affordance.

#### 4. Manual checklist — final pass only

**File**: `context/changes/disconnect-data-retention/MANUAL-CHECKLIST.md`

**Intent**: The file was created in Phase 1 §7 and appended to by Phases 3 and 4
as those rows came due (plan-review F5). Nothing new is authored here.

**Contract**: Verify the file reads as one coherent 3–5-row list with the
migration row first, every row signed off with its phase number so `## Progress`
ticks in step, and each carrying route, click sequence, observable pass condition
and the defect it catches. Add a row only if a phase closed without leaving one.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `npm run test:e2e`
- Manual-test sweep exits zero: `node scripts/manual-test-sweep.mjs`
- Unit suite passes: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- A tester following backlog row 16.B sees the two-button dialog and can complete both branches
- No document in the repo still claims a disconnect destroys absences unconditionally

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests

- `disconnect-impact` guard: derived table sets equal the declaration for all three roots after the FK change.
- Copy: both button labels, keep-branch and clear-branch descriptions, structural invariants retained.
- `boundary-inventory`: both disconnect actions still match the demo-refusal regex.

### Integration Tests

- Deleting `sprint` leaves `absence` with `sprint_id` null.
- Deleting `jira_credential` / `github_credential` under `keep` leaves the retained rows; under `clear` removes exactly `clearedTables`.
- `sprint_measurement`, `team_member`, `team_day_off` survive both branches, for both integrations.
- Cross-owner isolation for the new explicit deletes.
- Disconnect mid-sprint → reconnect → full sync leaves `committed_sp` and `committed_frozen_at` unchanged.

### Manual Testing Steps

1. Apply migration `0021` to the target database and confirm it is recorded.
2. Record an absence, disconnect Jira with the default button, confirm the absence is still there.
3. Reconnect the same Jira project mid-sprint; confirm the sprint's committed SP is unchanged.
4. Disconnect again with the destructive button; confirm the absence is gone.

## Performance Considerations

Negligible. The clear branch adds one owner-scoped delete per integration inside
an existing transaction; Phase 5 adds one indexed lookup on
`(owner_id, jira_sprint_id)` per sprint insert, which happens at most once per
sprint per owner.

## Migration Notes

`0021` changes two referential actions and deletes nothing. It runs in the MAIN
checkout — every worktree shares one local Postgres (`CLAUDE.md`).

**Named route to production**: there is no automated one. CI migrates its own
ephemeral database (`.github/workflows/ci.yml:53`) and Cloudflare Workers Builds
deploys code only. The route is manual: set `DATABASE_URL_OVERRIDE` to the
production connection string and run `npm run db:migrate`
(`drizzle.config.ts:8-16`). This must happen **before** the deployed code runs
the `clear` path, which assumes the cascade no longer removes what it deletes
explicitly.

**Check for prior debt first.** `lessons.md:56-60` records that migrations `0019`
and `0020` shipped at the S-12 merge without being applied to production. Confirm
the production migration state before applying `0021`, rather than assuming it is
at `0020`.

**Rollback**: re-point both constraints at `ON DELETE cascade`. Rows retained
under the new behaviour would then be destroyed by the next disconnect, so a
rollback is safe for the schema and lossy for anything a lead kept in between —
prefer rolling forward.

## References

- Frame brief: `context/changes/disconnect-data-retention/frame.md`
- Migration prior art: `src/db/migrations/0019_old_spectrum.sql`
- `secondary` precedent: `src/components/organisms/setup/roster-editor.tsx:859-885`
- Impact model + guard: `src/lib/integrations/disconnect-impact.ts`, `…/disconnect-impact.test.ts:61-91`
- Lessons: `context/foundation/lessons.md:35-40` (hand-entered children), `:56-60` (migration route)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema and migration — narrow the cascade

#### Automated

- [x] 1.1 Migration generates and applies cleanly against local Supabase — 3658a81
- [x] 1.2 Guard test agrees with the schema graph — 3658a81
- [x] 1.3 Unit suite passes — 3658a81
- [x] 1.4 Integration suite passes, including the new survival cases — 3658a81
- [x] 1.5 Type checking passes — 3658a81
- [x] 1.6 Linting passes — 3658a81

#### Manual

- [ ] 1.7 Migration 0021 applied to the production database and confirmed present

### Phase 2: Stores and actions — two outcomes

#### Automated

- [x] 2.1 Demo boundary guard still matches both actions — e2f78ae
- [x] 2.2 Unit suite passes — e2f78ae
- [x] 2.3 Integration suite passes with both modes covered — e2f78ae
- [x] 2.4 Type checking passes — e2f78ae
- [x] 2.5 Linting passes — e2f78ae
- [x] 2.6 A repo's synced history survives disconnect-with-keep and the reconnect that follows — e2f78ae

### Phase 3: The dialog — two buttons

#### Automated

- [x] 3.1 Copy tests pass — 169b3a1
- [x] 3.2 Unit suite passes — 169b3a1
- [x] 3.3 Type checking passes — 169b3a1
- [x] 3.4 Linting passes — 169b3a1
- [x] 3.5 Production build succeeds — 169b3a1

#### Manual

- [ ] 3.6 Disconnect offers two clearly different buttons and Cancel; the primary keeps data
- [ ] 3.7 Keep on Jira leaves recorded absences present
- [ ] 3.8 Clear on Jira removes them

### Phase 4: The project switch gets the same choice

#### Automated

- [x] 4.1 Guard test agrees for all three roots — 92ef756
- [x] 4.2 Unit suite passes — 92ef756
- [x] 4.3 Integration suite passes with a project-switch keep case — 92ef756
- [x] 4.4 Type checking passes — 92ef756
- [x] 4.5 Linting passes — 92ef756

#### Manual

- [x] 4.6 Switching the monitored Jira project with keep leaves absences intact — 92ef756
- [x] 4.7 The warning names the same outcomes the buttons deliver — 92ef756

### Phase 5: The measurement is the authority for the frozen commitment

#### Automated

- [x] 5.1 The disconnect→reconnect regression passes
- [x] 5.2 Unit suite passes
- [x] 5.3 Type checking passes
- [x] 5.4 Linting passes

### Phase 6: Documents, E2E and the stale claims

#### Automated

- [ ] 6.1 E2E suite passes
- [ ] 6.2 Manual-test sweep exits zero
- [ ] 6.3 Unit suite passes
- [ ] 6.4 Linting passes

#### Manual

- [ ] 6.5 A tester following backlog row 16.B completes both branches
- [ ] 6.6 No document still claims a disconnect destroys absences unconditionally
