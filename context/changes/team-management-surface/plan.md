# S-15 Team Management Surface — Implementation Plan

## Overview

FR-006 does not describe a one-time import. It says the owner "can edit each
member's profile … **and can change the technology track over time**". S-04 closed
FR-006 with the wizard step alone, so the lifecycle half of the requirement has no
surface: `/setup/team` is the only place the roster can be edited, nothing links
back to it after first run, and re-import grows the roster instead of reconciling
with it.

This plan delivers that surface as a Settings tab — but it fixes the persistence
model **first**, because the surface would otherwise multiply an existing defect:
every roster save today deletes the whole team and re-inserts it, firing two
foreign-key actions that the re-insert does not undo.

## Current State Analysis

Full detail in `context/changes/team-management-surface/research.md`. The
load-bearing facts:

- **`saveRoster` (`roster-store.ts:274-292`) is delete-then-insert of the entire
  owner-scoped set.** `absence.team_member_id` is `ON DELETE CASCADE` and
  `anomaly.related_team_member_id` is `ON DELETE SET NULL`
  (`0001_lying_human_cannonball.sql:269,273`, neither `DEFERRABLE`), so both fire
  on the DELETE and survive the re-INSERT even though the rows come back with the
  same ids. `is_active` is reset to `true` because the insert omits the column.
  Proven against local Postgres in a rolled-back transaction: after a save that
  changed nothing, absences 1 → 0, attribution `s15p-mem` → NULL, `is_active`
  false → true.
- **`saveRoster` has zero test coverage.** `roster-store.integration.test.ts`
  covers `importRoster` and the cadence pair; `saveRoster` is not even imported.
- **`teamMember.isActive` is a fully-wired read path with no writer.** Read by
  `developer-inactive.ts:22`, `dashboard/page.tsx:110`, and `roster.ts:28`;
  covered by `dashboard-readers.integration.test.ts:195-232`; set by nothing.
- **`importRoster` (`:104-229`) is merge-by-key, and inserts directly into the
  DB.** It skips upstream identities already present as a key on some row, and
  never removes or updates anything. Four key-miss vectors make it grow the
  roster (research §2); the likeliest behind the reported 5 → 7 is
  `scripts/seed-dashboard.mjs:190-204`, which seeds five members with fabricated
  keys that no real import can ever match.
- **The Settings shell was built tabbed for exactly this** (`settings/layout.tsx:6-19`),
  but its nav has no active-tab styling — invisible with one tab, a real defect
  with two. It is already `max-w-6xl`, so `SetupWizardShell`'s `wide` opt-in is
  not needed here.
- **No dialog primitive exists in the repo.** `src/components/ui/` has no dialog
  or alert-dialog; `grep "Dialog\|confirm("` over `src/` returns nothing.
- **The editor is already reusable** — `RosterEditor` takes `{ initialMembers }`
  and carries no wizard chrome. `repo-selection-editor.tsx:57-91` is the
  precedent for mounting a wizard organism inside Settings.

## Desired End State

The owner reaches **Settings → Team** from the main nav, sees their roster, and
manages it for the life of the team: edit any profile field, change someone's
technology track as they grow into it, add a member the import cannot see, map a
GitHub-only person to their Jira account, deactivate someone who left or is on
long leave, and re-import to pick up new joiners — without any of it silently
destroying hand-entered data.

Verifiable end state:

- A roster save that changes one field writes one row. Absences, anomaly
  attribution, and `is_active` of every other member are untouched.
- The bulk save **never deletes**. Removal happens only through an explicit,
  confirmed, per-row action that names what disappears.
- "Remove from team" defaults to deactivation; permanent deletion is offered only
  when the service has verified the member has no absences and no anomalies, and
  is refused for the last remaining member.
- Re-import proposes changes in the grid instead of writing them: new people
  appear as unsaved rows, people who vanished upstream are flagged, and nothing
  is persisted until Save.
- `/setup/team` keeps working unchanged for first run.

### Key Discoveries

- The FK behaviour is correct; `saveRoster` is wrong to invoke it. `ON DELETE
  CASCADE` on absences is the right rule for a *real* deletion — the bug is that
  a save performs a real deletion to express "save".
- Because `isActive` is already read by the detection rules and the dashboard
  filter, writing it is the whole feature: no schema change, no new read path.
- The delete-then-insert idiom came from S-02/S-03's monitored-set stores
  (`github-store.ts:157-166`, `jira-store.ts:225-237`), where it is safe because
  those tables have no hand-entered children. The S-04 plan diverged from it for
  *import* ("precisely to satisfy FR-006",
  `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:59`) but kept it
  for *save* (`:141`). The divergence stopped halfway.
- `onboarding.ts:70` counts team-member rows, not active ones — so deactivation
  can never un-onboard an account. Only hard-deleting the last member can.

## What We're NOT Doing

- **No cadence on the Team tab.** `/setup/team` renders `RosterEditor` +
  `CadenceForm`; only the roster moves. Cadence is FR-007 and has its own
  lifecycle gap in S-16 (sprint reconciliation). Owner decision.
- **No dedicated Split control.** A mis-merge is recoverable by adding a row and
  moving the identity key across; true unmerge needs a history mechanism this
  slice will not build. Owner decision.
- **No absence calendar** — that is S-08 (FR-010). This plan only stops absences
  from being destroyed before they exist.
- **No schema migration.** Every column needed already exists. Cross-row
  uniqueness of identity keys is enforced in zod, not by a new partial index —
  an index would fail to apply on any account that already has duplicates, and
  the roadmap did not ask for it.
- **No `isOnboardingComplete` routing enforcement.** The predicate is still
  called from nowhere (`middleware.ts:34-47` gates on the session cookie only);
  wiring it up is a separate concern.
- **No fix for `IntegrationCard`'s unconfirmed Disconnect** — a sibling of the
  same defect class, but out of this slice's scope. Named here so it is not lost.
- **No `/setup/team` removal.** One organism, two mount points.

## Implementation Approach

Three structural moves, in order, each one making the next safe:

1. **The bulk save becomes upsert-only.** Update the owner's changed rows by id,
   insert rows without an id, delete nothing. This alone stops the data loss and
   makes `is_active` persistable.
2. **Deletion becomes an explicit, confirmed, single-member operation** with a
   history check behind it. Because the bulk save no longer deletes, one stray
   click on a trash icon cannot drop anyone — the defect becomes structurally
   impossible rather than merely warned about.
3. **Import stops writing.** It becomes a pure read + diff that hands the editor
   a proposed grid; the upsert save is then the *only* writer of `team_member` in
   the application. Additive-import cannot happen if import does not insert.

Then the UI: confirmation dialogs, an active/inactive column, and the Settings
tab that makes all of it reachable.

## Critical Implementation Details

**Cross-account isolation is no longer free.** Today's owner-scoped `DELETE`
accidentally guaranteed that a save could only ever touch the caller's rows. An
`UPDATE … WHERE id = $1` does not. Every update in the new save MUST carry
`AND owner_id = $ownerId`, and the service MUST reject a payload containing any
`id` that is not already in the owner's current set (→ `invalid_input`) rather
than treating it as new. Without that, a crafted payload edits another account's
member. This is the PRD's cross-account-isolation guardrail, and it is the single
most important review point in Phase 1.

**Reads-before-transaction still binds** (`roster-store.ts:46-51`, and the
pool-teardown entry in `lessons.md`). Phase 3's import diff fetches GitHub and
Jira first and opens no write transaction at all; the history check in Phase 2 is
DB-only and may share the write transaction.

**GitHub degradation must not produce false "gone upstream" flags.** When the
GitHub read fails (`githubDegraded`), the diff must treat the GitHub side as
*unknown*, never as *empty* — otherwise a missing `read:org` scope flags the
entire GitHub-sourced roster as departed. The same rule applies per-source: only
flag a member missing when the source that owns their key was read successfully.

## Phase 1: Upsert-only save + characterisation tests

### Overview

Stop the bleeding. Prove the current loss with a failing test, then replace
delete-then-insert with a differential upsert that never deletes.

### Changes Required

#### 1. Characterisation tests (write first, expect red)

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: Pin the defect before changing it. A new `describe("saveRoster")`
block seeding an owner with a member, one `absence` row, and one `anomaly` row
carrying `related_team_member_id`, then calling `saveRoster` with the member
**unchanged**, and asserting the absence still exists, the attribution is still
set, and `is_active` is still `false`. These fail against today's code.

**Contract**: Reuses the file's existing `pool`/`db` handles and per-test cleanup.
The anomaly row needs the `user → jira_credential → jira_project → sprint` chain
(`anomaly.sprint_id` is NOT NULL); build it once in the block's setup. Add
alongside: an isolation test asserting a payload carrying another owner's member
`id` is rejected, and a test that an unchanged save issues no write at all.

#### 2. Differential save

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Replace `saveRoster`'s body with a diff. Load the owner's current rows
inside the transaction, partition the payload into "has an id known to this owner"
(update) and "no id" (insert), apply both, and delete nothing. Rows the payload
omits are left alone — the bulk save is no longer authoritative over membership.

**Contract**: `saveRoster({ db, ownerId, members }) → { updated: number; inserted: number }`
(was `{ count }`; the single call site, `actions.ts:151`, discards the return
entirely, so the shape change needs no action-layer plumbing). `RosterMemberInput` gains
`isActive?: boolean`, persisted on both branches; `deriveSource` is unchanged.
Every `update` carries `and(eq(teamMember.id, m.id), eq(teamMember.ownerId, ownerId))`.
Any submitted `id` absent from the owner's current set throws a new
`UnknownMemberError` (mapped to `invalid_input` by the action layer) — never
silently re-inserted.

#### 3. Validation

**File**: `src/lib/validations/roster.ts`

**Intent**: Carry `isActive` through the schema, and reject two rows claiming the
same person — the anomaly rules index the roster by `githubUsername` /
`jiraAccountId` (`helpers.ts:84-88`) and silently keep whichever row they see
last, so a duplicate key corrupts attribution rather than erroring.

**Contract**: `rosterMemberSchema` gains `isActive: z.boolean().optional()`.
`rosterSaveSchema` gains a `.superRefine` rejecting duplicate non-empty
`githubUsername` and duplicate non-empty `jiraAccountId` across the array, with a
message naming the offending value. Comparison is case-insensitive for
`githubUsername` (GitHub logins are), exact for `jiraAccountId`.

#### 4. Client field plumbing

**Files**: `src/app/(app)/setup/team/actions.ts`, `src/components/organisms/setup/roster-editor.tsx`

**Intent**: `ClientMember` and `toFormMember` carry `isActive` so it round-trips
instead of defaulting to `true` on every save.

**Contract**: `ClientMember` gains `isActive: boolean`; `toClientMember` maps it;
`toFormMember` passes it through. No UI for it yet — that is Phase 4.

#### 5. Fix the action-level test the upsert breaks

**File**: `src/app/(app)/setup/team/actions.integration.test.ts`

**Intent**: The happy-path case (`:210-231`) imports the roster — which at this
phase still persists 4 members, since import is not defanged until Phase 3 — then
saves a 2-member payload carrying **no ids**, and asserts
`expect(rows).toHaveLength(2)`. That assertion only holds because the old save
deleted the owner's whole set first. Under the upsert it becomes 4 + 2 = 6 and the
suite goes red on a test this plan otherwise never mentions.

**Contract**: Rewrite the case to assert the post-upsert reality: either save the
imported rows **with their ids** (the realistic edit-then-save flow, asserting 4
rows with the two edited) or drop the preceding import from that case. The
`source === "BOTH"` assertion for the mapped member must survive either way, as
must the two token-leak assertions (`:250-251`) — those are the PRD guardrail and
are the reason this test exists.

**Note**: Phase 3 revisits this same file when `importRosterAction` stops writing;
expect a second, smaller edit there.

### Success Criteria

#### Automated Verification

- Characterisation tests fail before the `saveRoster` change and pass after: `npm run test:integration`
- Unchanged-save issues no write; absence, anomaly attribution and `is_active` all survive
- A payload carrying a foreign member `id` is rejected as `invalid_input`
- Duplicate identity keys across rows are rejected by the schema: `npm test`
- **The whole suite is green, not just the new tests**: `npm test && npm run test:integration` — `actions.integration.test.ts` is the known casualty of this change
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- On `/setup/team`, edit one member's role and save; confirm via psql that only that row's `updated_at` moved
- Deactivate a member directly in psql, save the roster from the UI, confirm `is_active` is still `false`

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Member lifecycle — deactivate, reactivate, delete, merge

### Overview

Give the roster the operations its lifecycle actually needs, each one explicit
and each one owning its own destructiveness.

### Changes Required

#### 1. History check

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Answer "what would deleting this person destroy?" so the confirmation
dialog can say it and the service can refuse an unsafe delete.

**Contract**: `getMemberHistory({ db, ownerId, memberId }) → { absences: number; anomalies: number; isLastMember: boolean }`.
Owner-scoped counts against `absence.teamMemberId` (covered by
`absence_member_window_idx`) and `anomaly.relatedTeamMemberId` (no index — an
owner-scoped scan, acceptable at the 3–10-person target scale). `isLastMember` is
true when the owner has exactly one member row.

#### 2. Deactivate / reactivate

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: The non-destructive answer to "this person left" or "is on long
leave" — the member stops counting toward capacity, stops being eligible for
`DEVELOPER_INACTIVE`, and drops out of the dashboard member filter, while every
absence, commit, PR and anomaly attribution stays intact.

**Contract**: `setMemberActive({ db, ownerId, memberId, isActive }) → { updated: number }`,
a single owner-scoped `UPDATE`. No history check — deactivation destroys nothing
and is freely reversible.

#### 3. Hard delete

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: A genuine `DELETE` for the group-A case only: someone the import
pulled in who was never on the team and has no history worth keeping.

**Contract**: `deleteMember({ db, ownerId, memberId }) → { deleted: true }`.
Re-runs `getMemberHistory` **inside the write transaction** and throws
`MemberHasHistoryError` when `absences > 0 || anomalies > 0`, or
`LastMemberError` when `isLastMember` (that would make `isOnboardingComplete`
false). The dialog's earlier check is advisory; this one is the gate.

#### 4. Merge

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Fuse a GitHub-only row with its Jira-only counterpart — the only way
to map one human appearing as two imported rows, and the reason the roadmap says
any redesign must keep it. It genuinely deletes the dropped row, so it is a
confirmed operation, not a grid edit.

**Contract**: `mergeMembers({ db, ownerId, keepId, dropId, merged }) → { id: string }`.
One transaction: verify both ids belong to the owner, update `keepId` with the
merged field set (`source` re-derived), delete `dropId`. `keepId` MUST be the id
the editor keeps in the grid — see Phase 4 §5, where today's `mergeSelected` picks
the surviving id by A/B while picking the surviving *row* by index; the two must
agree or the merge duplicates instead of fusing. Refuses when the dropped
row has absences or anomalies — the owner must deactivate it instead, since
merging away someone's recorded absences is exactly the loss this slice exists to
prevent.

#### 5. Server actions

**File**: `src/app/(app)/setup/team/actions.ts`

**Intent**: Expose the four operations. They live beside the existing roster
actions so all roster mutations stay in one module; the Settings page imports
from here, following the precedent at `settings/connections/page.tsx:11-12`.

**Contract**: `setMemberActiveAction(memberId, isActive)`,
`deleteMemberAction(memberId)`, `mergeMembersAction(input)`,
`getMemberHistoryAction(memberId)`. Each does `requireSession()` → `getDb(env)` →
delegate, returning `{ ok: true, … } | ActionFailure`. `toFailure` gains branches
for `UnknownMemberError` / `MemberHasHistoryError` / `LastMemberError` →
`invalid_input` with a human-readable message. Input ids validated as
`z.string().min(1)` before use.

#### 6. Rewire the editor's removal paths — same phase as the services

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: Phase 1 took deletion out of the bulk save, and the editor's only two
removal paths are client-side: `remove(index)` on the trash (`:357`) and
`remove(drop)` inside `mergeSelected` (`:175`). Both worked only because save was
delete-then-insert. Leaving them unrewired until Phase 4 means three
pause-for-confirmation phases where the trash shows "Saved N team members" and the
member is still there on refresh, and where merging two persisted rows *duplicates*
the person instead of fusing them. The rewire therefore belongs here, immediately
behind the actions it calls — not two phases later.

**Contract**: For a **persisted** row (has an `id`), the trash calls
`deleteMemberAction` / `setMemberActiveAction` and merge calls
`mergeMembersAction` — passing `keepId` / `dropId` consistent with the row the grid
keeps, which today's `mergeSelected` gets wrong when the second-selected row has
the lower index (Phase 4 §5) — each followed by `router.refresh()`; an **unsaved** row (no
`id`) keeps the pure client-side `remove(index)` / client-side merge — there is
nothing server-side to lose. Confirmation in this phase is an interim
`window.confirm` carrying the same copy the dialog will carry (the counts from
`getMemberHistoryAction`); Phase 4 §3 swaps it for `ConfirmDialog` with no change
to the call sites. A failed action surfaces through the existing `formError` path
and the row is NOT removed from the grid.

### Success Criteria

#### Automated Verification

- Integration tests: deactivate preserves absences and attribution; reactivate restores; delete of a member with an absence is refused; delete of the last member is refused; delete of a clean member succeeds; merge moves both identity keys onto the kept row and refuses when the dropped row has history: `npm run test:integration`
- Cross-owner attempts on every new action are refused
- Type checking and linting pass

#### Manual Verification

- Deactivating a member in psql-visible state matches what the service reports
- A deactivated member disappears from the dashboard's member filter but still labels their existing anomalies
- Trash on a persisted row removes them for real — the row is gone after a refresh, not just from the grid
- Merging two persisted rows leaves exactly one row in psql, not two

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Import becomes a diff, not a write

### Overview

Make re-import reconcile. The mechanism is to stop it writing at all: it proposes,
the owner reviews, Save persists.

**§0 repro — CONFIRMED as vector (4), the demo seed's synthetic keys.** Run on a
scratch account (`repro-57-*@sprintflow.test`, never `demo@sprintflow.test`) with
the demo roster seeded exactly as `scripts/seed-dashboard.mjs:189-204` writes it,
then two imports against fixture GitHub/Jira responses:

| step | rows | delta |
|---|---|---|
| after `db:seed:demo` | 5 | — |
| after 1st import | 9 | +4 |
| after 2nd import | 9 | +0 |

The seed stores `alice-kim … eriklund` / `acc-alice-kim … acc-eriklund`; upstream
returns `octocat, devtwo` / `acc-1, acc-2`. **The key overlap is empty**, so
`importRoster`'s merge-by-key skip can never fire on a demo row and every upstream
identity is inserted as new. All five demo rows survive untouched — import neither
updates nor reconciles them.

The growth is `5 + |upstream identities|` and happens **once** per identity, which
is why the count is stable on the second run rather than climbing: the reported
5 → 7 is this same vector against an upstream set of two. The other three key-miss
vectors in research §2 are not needed to explain it, and the diff below covers
them regardless.

### Changes Required

#### 0. Reproduce the 5 → 7 first

**Intent**: Confirm which key-miss vector is real before designing around it.
Research suspects vector (4) — the demo seed's synthetic keys
(`scripts/seed-dashboard.mjs:190-204`) matching nothing a real import returns.

**Contract**: On a scratch account (never `demo@sprintflow.test`, which holds the
real credentials — `context/changes/dashboard-sprint-detail/plan.md:998-1006`),
seed the demo roster, connect fixtures, run the import twice, record the row
count each time. Write the finding into this plan's Phase 3 overview. If the real
vector turns out to be (1) — a deleted member resurrecting — the diff below still
covers it; if it is something else, revisit before implementing.

#### 1. Preview instead of insert

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: `importRoster` keeps its network reads and its degradation handling
but loses its write. It returns what the roster *would* become, annotated, and
persists nothing.

**Contract**: `previewRosterImport({ db, ownerId, … }) → { members: PreviewMember[]; added: number; missing: number; githubDegraded: boolean; reason?: string }`
where `PreviewMember = RosterMemberInput & { id?: string; source: …; proposed?: true; upstreamMissing?: true }`.
Rules: an upstream identity matching no stored key yields a `proposed` row with
**no id** (the upsert save inserts it); a stored row whose key is absent from a
**successfully read** source is flagged `upstreamMissing`; `MANUAL` rows are never
flagged; when `githubDegraded`, no GitHub-sourced row may be flagged. Matching on
`githubUsername` is case-insensitive. The old name is retained as a deprecated
alias only if a call site needs it — otherwise renamed outright.

#### 2. Rewrite the import tests

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: The three existing `importRoster` cases assert DB state after import;
they now assert the returned preview instead. Their intent survives: fresh import
seeds from both sources with bots filtered, a re-import preserves edited fields
and never touches `MANUAL` rows, a GitHub 403 degrades without throwing.

**Contract**: Plus new cases — a deactivated member is not re-proposed; a member
whose upstream key vanished is flagged `upstreamMissing`; nothing is flagged when
`githubDegraded`; a case-differing login does not duplicate.

#### 3. Action + editor wiring

**Files**: `src/app/(app)/setup/team/actions.ts`, `src/components/organisms/setup/roster-editor.tsx`

**Intent**: The editor replaces its grid with the preview and surfaces a summary
line ("2 new, 1 no longer in GitHub — nothing is saved until you press Save") so
the owner understands that import is now a proposal.

**Contract**: `importRosterAction` returns the preview shape. The editor's
`runImport` still `replace()`s the field array; proposed rows render with a badge
and `upstreamMissing` rows with a muted "not in GitHub/Jira any more" marker plus
a one-click Deactivate. First-run auto-import (`roster-editor.tsx:132-140`) is
unchanged — it fires on an empty roster, and the owner's Save is what persists it.

**Where the flags live.** *Not* in the field array. `toFormMember` (`:65-75`)
projects down to `rosterMemberSchema`, which has no `proposed` / `upstreamMissing`
— it is the same reason `source` is already dropped and `originLabel` (`:76-85`)
re-derives the origin from the watched keys instead. Passing the flags through
`replace()` would silently discard them. Hold them in component state set
alongside the `replace()` call, mirroring how `degradedReason` is already held
outside the form (`:90`): a `Map` keyed by member `id` for persisted rows, and by
identity key (`githubUsername`/`jiraAccountId`, lowercased) for proposed rows that
have no id yet — **never by array index**, which `append` / `remove` reshuffles.
A row with no id and no key (a blank Add-member row) simply carries no flag.

### Success Criteria

#### Automated Verification

- The 5 → 7 repro is recorded, with the confirmed vector named
- Rewritten and new import tests pass: `npm run test:integration`
- `grep -n "insert(teamMember)" src/lib/integrations/roster-store.ts` returns only the save path
- Type checking and linting pass

#### Manual Verification

- Re-import on a populated roster adds no DB rows until Save
- Re-import after deactivating someone does not resurrect them
- With a GitHub token lacking `read:org`, the degradation banner shows and no member is flagged as departed

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Confirmation dialogs + the active/inactive column

### Overview

Give the destructive actions a mouth. Every one of them now names what it will
destroy before it does it.

### Changes Required

#### 1. Add the primitive

**Intent**: The repo has no dialog component. `@shadcn/alert-dialog` is the
right one — modal, focus-trapped, with an explicit Cancel/Action pair.

**Contract**: Confirm the component and its current API via the `@shadcn` MCP
server first — CLAUDE.md requires that lookup before any UI surface — then
`npx shadcn add alert-dialog` (never re-run `init` — `components.json` is already
wired). Lands at `src/components/ui/alert-dialog.tsx`;
`radix-ui` is already a dependency.

#### 2. Confirm dialog molecule

**File**: `src/components/molecules/confirm-dialog.tsx` (new)

**Intent**: One reusable confirmation shell so the roster's three destructive
actions — and the Disconnect button whenever someone fixes it — read the same.

**Contract**: `<ConfirmDialog trigger title description confirmLabel variant onConfirm />`,
client component, `onConfirm` async with a pending state. Sits in `molecules/`
beside `main-nav.tsx` per the atomic-design convention in CLAUDE.md.

#### 3. Swap the interim confirms for the dialog

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: Phase 2 §6 already routes the trash and merge through the lifecycle
actions behind a `window.confirm`. This replaces that prompt with the real
surface, so what is at stake is *shown* rather than crammed into a browser
alert. The call sites do not change — only the confirmation UI.

**Contract**: For a **persisted** row the trash opens a `ConfirmDialog` offering
*Deactivate* (default) and, only when `getMemberHistoryAction` reports zero
absences, zero anomalies and not-last-member, *Delete permanently* — with the
counts stated either way ("Erik has 2 recorded absences and 3 anomalies
attributed to him; they stay with a deactivated member and are destroyed by a
permanent delete"). For an **unsaved** row (no id) the trash still calls
`remove(index)` with no dialog — there is nothing to lose. **Merge** gets its own
confirmation naming the row being dropped; when either selected row is unsaved,
merge stays purely client-side (nothing to delete server-side). No
`window.confirm` remains in the file after this step.

#### 4. Active column

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: Deactivation is worthless if the owner cannot see or undo it.

**Contract**: A Status column rendering Active/Inactive, with inactive rows
visually muted and a Reactivate action. A "Show inactive members" toggle
(default: shown, since the roster is small and hiding them would make
reactivation undiscoverable). The grid is already horizontally scrollable
(`roster-editor.tsx:253`); adding a column needs no layout change.

#### 5. The lying comment — and the id it picks up with it

**File**: `src/components/organisms/setup/roster-editor.tsx:161-174`

**Intent**: Two defects in one function. The comment claims name selection prefers
the Jira `displayName`; the code is `a.name || b.name`, and both imported rows
always carry a name, so `a` always wins and merging a GitHub row first yields the
bare login. Implement the comment rather than deleting it — the behaviour it
describes is the better one.

The second is worse and previously invisible: `merged.id = a.id` (`:164`) where
`a = values[idxA]`, but keep/drop are chosen by **index** (`:173`), not by A/B. When
`idxB < idxA`, `update(idxB, merged)` writes `a`'s id into the surviving row while
`b`'s row is the one removed from the grid. Under the old delete-then-insert save
this was harmless — the whole set was replaced. From Phase 1 on, the save updates
`a.id`'s row and leaves `b.id`'s row untouched in the DB: the merge **duplicates**
the person instead of fusing them.

**Contract**: Extract the whole merge decision — surviving **id**, name, keys,
profile fields — into one pure helper. The surviving id is the *kept* row's id
(the one the grid keeps and the one passed as `keepId` to `mergeMembersAction`),
never unconditionally `a`'s; the dropped row's id is what goes to `dropId`. Name
selection uses a `looksLikeLogin(name, githubUsername)` helper (name equals the
GitHub login, case-insensitively) picking the other row's name when one row's name
is just its login; ties fall back to `a`. Unit-tested in a new
`roster-merge.test.ts` alongside the existing `repo-selection.test.ts` precedent
of extracting pure logic out of an organism.

### Success Criteria

#### Automated Verification

- `roster-merge.test.ts` covers: **the surviving id is the kept row's id in both selection orders** (select-B-then-A must not resurrect A's id); GitHub row first still yields the Jira display name; both-login case falls back to `a`; identity keys union in both orders: `npm test`
- `grep -n "window.confirm" src/components/organisms/setup/roster-editor.tsx` returns nothing — Phase 2's interim prompts are gone
- Type checking and linting pass

#### Manual Verification

- Trash on a member with absences offers Deactivate only, and says how many absences and anomalies are at stake
- Trash on a clean member offers both, and Delete permanently removes the row
- Trash on the last remaining member refuses the permanent delete
- Merge asks before dropping a row and names which one
- A deactivated row is visibly muted and can be reactivated
- Keyboard: dialog traps focus, Escape cancels, Cancel is the default focus

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: The Settings → Team tab

### Overview

Make all of the above reachable after first run — the actual roadmap ask.

### Changes Required

#### 1. Tab registration + active styling

**Files**: `src/app/(app)/settings/layout.tsx`, `src/components/molecules/settings-tabs.tsx` (new)

**Intent**: Add Team as the second tab, and give the nav an active state — with
one tab its absence was invisible, with two the owner cannot tell where they are.

**Contract**: `TABS` gains `{ label: "Team", href: "/settings/team" }` beside the
existing Connections entry and the S-14 placeholder comment. The nav moves into a
small client component using `usePathname` to mark the active link; the layout
stays a server component and keeps its `max-w-6xl` wrapper, its heading, and its
`aria-label="Settings sections"`.

#### 2. The page

**File**: `src/app/(app)/settings/team/page.tsx` (new)

**Intent**: The post-setup roster surface. Same organism as the wizard, different
chrome and different framing copy — the wizard says "review what we imported",
Settings says "this is your team".

**Contract**: Clone the boot sequence from `settings/connections/page.tsx:31-38`
— `requireSession()` → `getCloudflareContext().env` → `getDb(env)` → one
owner-scoped read → render `<RosterEditor initialMembers={…} />`. Do **not**
re-declare `force-dynamic` or `requireSession` (inherited from
`(app)/layout.tsx:9,22`). The member projection matches
`setup/team/page.tsx:27-39` plus `isActive`.

**The shared reader is a NEW export, not an extraction.** `src/lib/roster.ts`
already holds `listRoster` (`:28`) — the S-07 dashboard reader consumed by
`dashboard/page.tsx:58` and `dashboard/sprint-detail/page.tsx:69` and asserted by
`dashboard-readers.integration.test.ts:194-232`. Its projection is *narrower* than
the editor's: it has `isActive` but neither `spCapacity` nor `source`, both of
which `ClientMember` requires. Do **not** widen it — that would push two unused
columns and a shape change through both dashboards and their test for no gain.
Add `listRosterForEditor(db, ownerId)` beside it, returning the `ClientMember`
projection, and point *both* `setup/team/page.tsx` and `settings/team/page.tsx` at
it so the two editor mounts cannot drift. Carry a short comment saying why the
file has two readers, matching the existing one's why-comment style.

#### 3. Refresh after save

**File**: `src/components/organisms/setup/roster-editor.tsx`

**Intent**: On the Settings tab the saved roster feeds sibling surfaces; the repo
convention after a successful Server Action is `router.refresh()`
(`repo-selection-editor.tsx:87`, `jira-project-editor.tsx:166`,
`sync-now-button.tsx:51`) — there is no `revalidatePath` anywhere in `src/`.

**Contract**: Call `router.refresh()` after a successful save and after each
lifecycle action. Harmless in the wizard, load-bearing in Settings.

### Success Criteria

#### Automated Verification

- Type checking and linting pass
- Existing suites still green: `npm test && npm run test:integration`

#### Manual Verification

- Settings → Team is reachable from the main nav and shows the roster
- The active tab is visually distinct on both Connections and Team
- Editing a technology track from Settings persists and is reflected in the Sprint Detail sub-burndowns after the next sync
- `/setup/team` still works end-to-end for a fresh account
- Tablet width (10-inch floor, NFR): the grid scrolls horizontally, controls stay reachable — this closes the parked S-04 manual row 4.6

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: Documentation obligations

### Overview

Record what this slice learned so the next one does not repeat it.

### Changes Required

#### 1. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: The delete-then-insert idiom crossed the boundary where it was safe.
That is a class of bug, not an incident.

**Contract**: An append-only entry in the file's existing four-field shape
(Context / Problem / Rule / Applies to). Rule: *a full-set delete-then-insert is
safe only for tables with no hand-entered children; when any child FK exists,
express "save" as a differential upsert — the DB cannot tell that a re-inserted
row with the same id is "the same row", so referential actions fired by the
DELETE are permanent.*

#### 2. Roadmap + backlog

**Files**: `context/foundation/roadmap.md`, `context/foundation/manual-test-backlog.md`

**Intent**: Close S-15 in the Backlog Handoff table, and resolve the two S-04
manual rows parked pending this slice.

**Contract**: Roadmap S-15 row → `done` with the PR reference; the S-15 section
gains a short note that the research found a sixth defect and where it is
documented. In the backlog, row **4.3** (auto-import / merge / edits survive
re-import) is re-scoped to the new preview behaviour and row **4.6** (tablet
width) is closed by Phase 5's manual check.

#### 3. Manual checklist

**File**: `context/changes/team-management-surface/MANUAL-CHECKLIST.md` (new)

**Intent**: Same shape as `dashboard-sprint-detail/MANUAL-CHECKLIST.md` — the
manual rows from every phase, in one runnable list, with the account-safety note
that `demo@sprintflow.test` holds the real credentials and must never be seeded.

### Success Criteria

#### Automated Verification

- Linting passes on the touched markdown (if configured); no broken relative links

#### Manual Verification

- A cold reader can follow the checklist without asking which account to use

---

## Testing Strategy

### Unit Tests

- `roster-merge.test.ts` — name selection and key union in both selection orders
- `validations/roster.ts` — duplicate `githubUsername` (including case-differing) and duplicate `jiraAccountId` rejected; `isActive` round-trips

### Integration Tests

All against real Postgres (local Supabase `:54322`), extending
`roster-store.integration.test.ts`:

- **Characterisation (Phase 1)** — a no-op save preserves absences, anomaly
  attribution and `is_active`; a one-field save writes one row
- **Isolation** — a payload carrying a foreign member id is rejected; every
  lifecycle action refuses a member belonging to another owner
- **Lifecycle (Phase 2)** — deactivate/reactivate preserve children; delete
  refused with history and refused for the last member, succeeds when clean;
  merge unions keys, deletes the dropped row, refuses when it has history
- **Import diff (Phase 3)** — proposal counts, `upstreamMissing` flagging,
  no flagging under `githubDegraded`, deactivated members not re-proposed,
  case-insensitive login matching, and zero writes

### Manual Testing Steps

1. On a scratch account, seed the demo roster, run import twice, record counts (Phase 3 repro).
2. Edit one member's role on `/setup/team`, save, verify only that row moved in psql.
3. Record an absence in psql, save the roster from the UI, verify the absence survives.
4. Deactivate a member from Settings → Team; confirm they leave the dashboard member filter but still label their existing anomalies.
5. Try to permanently delete that member; confirm it is refused and says why.
6. Delete a clean member; confirm it succeeds and the confirmation named the (zero) stakes.
7. Merge a GitHub-only row with a Jira-only row selecting the GitHub row **first**; confirm the resulting name is the Jira display name, not the bare login.
8. Re-import; confirm new people appear unsaved and nothing is written until Save.
9. Check both settings tabs show a correct active state, at desktop and at 10-inch tablet width.

## Performance Considerations

The differential save issues one `UPDATE` per changed row instead of one bulk
delete + one bulk insert. At the PRD's 3–10-person target that is a handful of
statements per save; a roster is capped at 100 rows by
`rosterSaveSchema`. `getMemberHistory`'s anomaly count has no supporting index
(`anomaly` indexes `owner_sprint`, `type`, `severity` — not
`related_team_member_id`), so it is an owner-scoped scan; fine at this scale, and
it runs only when a confirmation dialog opens. Nothing here changes the sync or
detection hot paths.

## Migration Notes

No schema migration. Two behavioural migrations to be aware of:

- **`is_active` now round-trips.** Any account where a member was deactivated out
  of band kept that state only until its next save; after Phase 1 the state is
  authoritative. No data fix needed — nothing has ever written `false`.
- **Import no longer persists.** An account that imports and navigates away
  without saving ends with no roster, where previously it would have had one.
  This only affects the first run, where the wizard's Save is the obvious next
  action, and it makes the "nothing is saved until you press Save" promise true.

## References

- Research: `context/changes/team-management-surface/research.md`
- Roadmap entry: `context/foundation/roadmap.md:347-406`
- Prior slice's settings shell: `src/app/(app)/settings/layout.tsx:6-19`
- Reuse-the-wizard-organism precedent: `src/components/organisms/settings/repo-selection-editor.tsx:57-91`
- S-04's half-finished divergence: `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:59,141`
- Account safety: `context/changes/dashboard-sprint-detail/plan.md:998-1006`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Upsert-only save + characterisation tests

#### Automated

- [x] 1.1 Characterisation tests fail before the change and pass after — 4561a55
- [x] 1.2 Unchanged save issues no write; absence, attribution and `is_active` survive — 4561a55
- [x] 1.3 Foreign member `id` in a payload is rejected as `invalid_input` — 4561a55
- [x] 1.4 Duplicate identity keys rejected by the schema — 4561a55
- [x] 1.5 Whole suite green (`npm test && npm run test:integration`), incl. the repaired `actions.integration.test.ts` — 4561a55
- [x] 1.6 Type checking passes — 4561a55
- [x] 1.7 Linting passes — 4561a55

#### Manual

- [x] 1.8 One-field edit moves exactly one row's `updated_at` — 4561a55
- [x] 1.9 Out-of-band deactivation survives a UI save — 4561a55

### Phase 2: Member lifecycle — deactivate, reactivate, delete, merge

#### Automated

- [x] 2.1 Deactivate/reactivate preserve absences and attribution — 724e2bc
- [x] 2.2 Delete refused with history; refused for the last member; succeeds when clean — 724e2bc
- [x] 2.3 Merge unions both identity keys and refuses when the dropped row has history — 724e2bc
- [x] 2.4 Every lifecycle action refuses a cross-owner member — 724e2bc
- [x] 2.5 Type checking and linting pass — 724e2bc

#### Manual

- [x] 2.6 Service-reported state matches psql — 724e2bc
- [x] 2.7 Deactivated member leaves the dashboard filter but still labels existing anomalies — 724e2bc
- [x] 2.8 Trash on a persisted row removes them for real — gone after a refresh — 724e2bc
- [x] 2.9 Merging two persisted rows leaves exactly one row in psql — 724e2bc

### Phase 3: Import becomes a diff, not a write

#### Automated

- [x] 3.1 The 5 → 7 repro is recorded with the confirmed vector named — 1da8b24
- [x] 3.2 Rewritten and new import tests pass — 1da8b24
- [x] 3.3 `insert(teamMember)` appears only in the save path — 1da8b24
- [x] 3.4 Type checking and linting pass — 1da8b24

#### Manual

- [x] 3.5 Re-import adds no DB rows until Save — 1da8b24
- [x] 3.6 Re-import does not resurrect a deactivated member — 1da8b24
- [x] 3.7 Under GitHub degradation no member is flagged as departed — 1da8b24

### Phase 4: Confirmation dialogs + the active/inactive column

#### Automated

- [x] 4.1 `roster-merge.test.ts` covers surviving id, name selection and key union in both orders — 83384f4
- [x] 4.2 No `window.confirm` remains in the roster editor — 83384f4
- [x] 4.3 Type checking and linting pass — 83384f4

#### Manual

- [x] 4.4 Trash on a member with history offers Deactivate only, with counts stated
- [x] 4.5 Trash on a clean member offers both; permanent delete works
- [ ] 4.6 Permanent delete refused for the last remaining member
- [ ] 4.7 Merge confirms and names the dropped row
- [x] 4.8 Deactivated rows are muted and reactivatable
- [ ] 4.9 Dialog traps focus, Escape cancels, Cancel takes default focus

### Phase 5: The Settings → Team tab

#### Automated

- [x] 5.1 Type checking and linting pass — 5863b2e
- [x] 5.2 Existing unit and integration suites still green — 5863b2e

#### Manual

- [ ] 5.3 Settings → Team reachable from the nav and renders the roster
- [ ] 5.4 Active tab is visually distinct on both tabs
- [ ] 5.5 A track change from Settings reaches the sub-burndowns after a sync
- [ ] 5.6 `/setup/team` still works end-to-end for a fresh account
- [ ] 5.7 Tablet width: grid scrolls, controls reachable (closes S-04 row 4.6)

### Phase 6: Documentation obligations

#### Automated

- [x] 6.1 Touched markdown lints; no broken relative links — d8ecd0f

#### Manual

- [ ] 6.2 A cold reader can run the checklist without asking which account to use
