---
date: 2026-08-23T17:11:11Z
researcher: Adam Reszka
git_commit: 1aa082794174580dbf5fe7dfa94fbb57ff88db53
branch: feat/s15-team-management-surface
repository: AdamReszka/10xdevs-certification-project
topic: "S-15 team-management-surface — post-setup roster management as a Settings tab"
tags: [research, codebase, roster, settings, team-member, fr-006]
status: complete
last_updated: 2026-08-23
last_updated_by: Adam Reszka
---

# Research: S-15 team-management-surface

**Date**: 2026-08-23 17:11 UTC
**Researcher**: Adam Reszka
**Git Commit**: `1aa0827`
**Branch**: `feat/s15-team-management-surface`
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

S-15 (`context/foundation/roadmap.md:347-406`) asks for post-setup roster
management as a **Settings tab**: review, edit, merge and remove members after
first run, with re-import reconciling instead of only appending. Seven areas were
investigated: (1) the `/setup/team` roster editor, (2) the `roster-store.ts`
services, (3) the S-10 `/settings` tabbed shell, (4) `SetupWizardShell`'s `wide`
opt-in, (5) the `team_member` schema + its inbound FKs, (6) `main-nav.tsx`
routing, (7) existing confirm-dialog precedent for the remove-confirmation ask.

## Summary

The roadmap's five defects are all real, but the research turned up a **sixth,
more severe one that the roadmap does not name and that changes the shape of the
slice**:

> **`saveRoster` destroys child data on EVERY save — including a save that
> changes nothing.** It is `DELETE FROM team_member WHERE owner_id = $1` followed
> by a re-INSERT of the same rows with the same ids
> (`roster-store.ts:274-292`). Both inbound FKs fire on that DELETE and are
> **not** undone by the re-INSERT: `absence.team_member_id` is `ON DELETE
> CASCADE` (every recorded absence for the whole team is gone) and
> `anomaly.related_team_member_id` is `ON DELETE SET NULL` (every anomaly on the
> board silently loses its attribution). `team_member.is_active` is also reset to
> `true`, because the insert omits the column.

Proven empirically against the local DB inside a rolled-back transaction
(nothing was persisted; probe rows verified gone):

| phase | absences for the owner | `anomaly.related_team_member_id` | `is_active` |
|---|---|---|---|
| before the save | 1 | `s15p-mem` | `false` |
| after a **no-op** save | **0** | **NULL** | **true** |

The roadmap frames defect #4 as "removing a member has no confirmation, and the
damage lands on Save". The blast radius is wider: the damage lands on *every*
Save, for *every* member, whether or not anything was removed. A confirmation
dialog does not fix that — the persistence model does. This should be the
slice's first phase, ahead of the UI work.

The second structural finding is the flip side: **`teamMember.isActive` is a
fully-wired read path with no writer.** `developer-inactive.ts:22` skips inactive
members, `dashboard/page.tsx:110` filters the member dropdown on it,
`roster.ts:6-14` documents the partition rule, and
`dashboard-readers.integration.test.ts:195-232` tests it — but nothing in the app
ever sets it to `false`, and `saveRoster` resets it to `true` if anything ever
did. Deactivation is the non-destructive answer to "this person left the team"
that FR-010's cascade makes dangerous to do with DELETE; the column is already
there, already read, already tested. S-15 only has to write it.

On the rest: the Settings tab has a clean slot to land in (`settings/layout.tsx`
was built tabbed for exactly this), the editor is reusable as-is (it takes props
and callbacks, no wizard chrome), and no confirm-dialog primitive exists anywhere
in the repo yet — `alert-dialog` has to be added from the shadcn registry.

## Detailed Findings

### 1. The roster editor (`src/components/organisms/setup/roster-editor.tsx`, 411 lines)

A `"use client"` RHF `useFieldArray` grid over `rosterSaveSchema`. Shape:

- **Props**: `{ initialMembers: ClientMember[] }` only — no wizard-specific
  chrome, no step awareness, no navigation. It already reads as a reusable
  organism; mounting it under `/settings/team` needs no prop changes
  (`roster-editor.tsx:87-91`).
- **Actions it calls**: `importRosterAction()` and `saveRosterAction()`, imported
  from `@/app/(app)/setup/team/actions` (`roster-editor.tsx:9-13`). If the tab
  gets its own actions module, this import is the seam to parameterise.
- **Auto-import on mount** fires only when `initialMembers.length === 0`
  (`roster-editor.tsx:132-140`), guarded by a `useRef`. On the Settings tab that
  guard is right for a never-imported account and harmless for a populated one.
- **Remove** (`roster-editor.tsx:351-364`): a ghost `Trash2Icon` button calling
  `remove(index)` immediately. No confirmation, no undo, no visual diff against
  the loaded roster — exactly as the roadmap reports.
- **Merge** (`roster-editor.tsx:151-177`): checkbox-select exactly two rows →
  union the identity keys into the lower-index row, `remove()` the other. The
  comment at `:161-162` claims name selection prefers the Jira `displayName`;
  the code is `a.name || b.name`, and both imported rows always carry a
  non-empty name (GitHub rows get `name: g.login` at `roster-store.ts:203`, Jira
  rows get `name: j.displayName` at `:212`), so **`a.name` always wins** and
  selecting the GitHub row first yields the bare login. Roadmap defect #5
  confirmed; the fix is either the comment or a `looksLikeLogin()` heuristic —
  the plan should pick one, not leave both.
- **Save** (`roster-editor.tsx:179-200`): coalesces blank strings to `null`,
  calls `saveRosterAction({ members })`, toasts on success. No `router.refresh()`
  — fine in the wizard, but on a Settings tab whose sibling surfaces read the
  roster it is the established pattern (`repo-selection-editor.tsx:87`,
  `jira-project-editor.tsx:166`, `sync-now-button.tsx:51` all call it).
- **Degradation banner**: a GitHub scope/auth failure during import renders an
  `Alert` and continues (`roster-editor.tsx:229-235`) — keep this on the
  Settings tab; it is the PRD graceful-degradation guarantee.

### 2. `roster-store.ts` — the service core (508 lines)

**`importRoster` (`:104-229`) is merge-by-key, not blindly additive.** The
roadmap's "additive, not reconciling" is the right verdict but the mechanism
matters for the fix. Inside the transaction it builds `existingGithub` /
`existingJira` sets from the owner's current rows (`:189-194`) and inserts only
logins/accountIds absent from them (`:197-216`). It **never updates** an existing
row — deliberately, per the S-04 plan ("auto-import seeds, manual edit persists",
`context/archive/2026-08-20-setup-team-roster-cadence/plan.md:59`).

So growth comes from **key misses**, of which there are four vectors:

1. **A member the user deleted comes back.** Import has no memory of a deletion,
   so the next re-import re-adds anyone still upstream. This is the "merges
   nothing away" half.
2. **A departed collaborator never leaves.** Nothing marks a row whose key has
   disappeared from both sources.
3. **An edited identity key duplicates the person.** Change `githubUsername`
   (typo fix, different casing — GitHub logins are case-insensitive but the set
   lookup is case-*sensitive*) and the original login no longer matches, so
   import re-inserts it.
4. **Pre-existing rows with synthetic keys never match.** The most likely
   explanation for the reported *5 → 7*: `scripts/seed-dashboard.mjs:190-204`
   inserts five members with fabricated keys (`gh: "bob-r"`,
   `jira_account_id: "acc-bob-r"`). On an account carrying that seed, a real
   re-import matches none of them and appends the real people on top. The
   `demo@sprintflow.test` / `adam.reszka85@gmail.com` account inversion recorded
   in `context/changes/dashboard-sprint-detail/plan.md:998-1006` makes this the
   probable path. Worth reproducing before designing around it — the
   reconciliation design differs if the real trigger is (1) rather than (4).

**`saveRoster` (`:265-295`) is the destructive one.** Delete-then-insert of the
whole owner-scoped set. Row ids do round-trip (`id: m.id ?? randomUUID()`,
`:279`), so the *rows* survive intact — but the FK side effects fired during the
DELETE are permanent (see §5). Note the divergence: the S-04 plan chose
merge-by-key for import "precisely to satisfy FR-006" but described the save leg
as "persists the full owner-scoped set inside a tx"
(`context/archive/2026-08-20-setup-team-roster-cadence/plan.md:141`), inheriting
the S-02/S-03 monitored-set precedent. That is the seam the defect entered
through.

**`saveRoster` has zero test coverage.** `roster-store.integration.test.ts`
covers `importRoster` (3 cases) and `importCadence` / `saveCadence` (3 cases) —
`grep saveRoster` in that file returns nothing, and it is not even imported
(`:18-22`). Any change here starts with a characterisation test.

**`importCadence` / `saveCadence` (`:346-508`)** are cadence-only and out of
S-15's path except that `/setup/team` renders `CadenceForm` next to the roster.
Decision needed: does the Settings Team tab carry cadence too? Arguments both
ways in Open Questions.

### 3. The Settings shell (`src/app/(app)/settings/layout.tsx`, 46 lines)

Built tabbed with one tab, explicitly anticipating this: the comment at `:6-14`
says a second entry "slots in here" and `:18` carries the placeholder
`// S-14 adds { label: "Anomaly rules", href: "/settings/anomalies" } here.`
Adding Team is a one-line push into `TABS` (`:16-19`) plus a route folder.

Two things the plan must handle, because with one tab they were invisible:

- **No active-tab styling.** Every `<Link>` renders identically muted
  (`:33-40`); there is no `usePathname` and the layout is a server component.
  With two tabs the user cannot tell which one they are on. Either promote the
  nav to a small client component or split an active variant.
- **`/settings` redirects to `/settings/connections`** (`settings/page.tsx:9`).
  Correct to keep — but if Team becomes the more common destination that is a
  product call, not a technical one.

Page-level precedent to copy verbatim (`settings/connections/page.tsx:31-38`):
`requireSession()` → `getCloudflareContext().env` → `getDb(env)` → one
owner-scoped read → render. Do **not** re-declare `force-dynamic` or
`requireSession`; both are inherited from `(app)/layout.tsx:9,22`.

The editor-inside-settings precedent is `repo-selection-editor.tsx`: an inline
expanding panel (`open` state, not a modal) that reuses the wizard's picker
verbatim and calls `router.refresh()` after a successful save
(`repo-selection-editor.tsx:57-91`). Its header comment states the reuse rule —
"reuses the wizard's `RepoSelector` verbatim … the picker behaves identically in
both places" — which is the pattern S-15 should follow with `RosterEditor`.

### 4. `SetupWizardShell`'s `wide` opt-in

`setup-wizard-shell.tsx:20-39` — `wide` swaps `max-w-2xl` for `max-w-6xl`, and
the doc comment records exactly why the roster needs it (eight columns, a
43-character Jira account id, controls falling off the horizontal scroll and
reading as missing). **This concern does not carry over**: `settings/layout.tsx:23`
is already `max-w-6xl`, the same measure. The Settings tab inherits the fix for
free. `wide` stays relevant only to `/setup/team`.

### 5. Schema and the two inbound FKs

`team_member` (`src/db/schema.ts:297-318`): `id`, `ownerId` (→ `user`, cascade),
`name` NOT NULL, `githubUsername`, `jiraAccountId`, `role`, `spCapacity`,
`technologyTrack`, `source` NOT NULL, **`isActive` boolean default true NOT
NULL**, `createdAt`, `updatedAt` (`$onUpdate`). One index on `ownerId`.

**There is no UNIQUE constraint on `(ownerId, githubUsername)` or
`(ownerId, jiraAccountId)`** — deliberate in S-04 ("merge-by-key is app-level",
`context/archive/2026-08-20-setup-team-roster-cadence/plan.md:43`) — and
`rosterSaveSchema` (`validations/roster.ts:47-49`) validates only
`max(100)` on the array, no cross-row uniqueness. So two rows may carry the same
GitHub login today, through the editor, with no error. That matters for
reconciliation: the anomaly rules index the roster by those keys
(`helpers.ts:84-88`, used by `pr-review-stalled.ts:19`, `pr-too-big.ts:13`,
`pr-ticket-desync.ts:17`, `ticket-status-aging.ts:46`, `sprint-at-risk.ts:33`)
and `indexBy` keeps whichever row it sees last.

Inbound FKs, verified in the migration SQL, not just the Drizzle model
(`src/db/migrations/0001_lying_human_cannonball.sql:269,273`):

```sql
absence_team_member_id_… FOREIGN KEY (team_member_id) REFERENCES team_member(id) ON DELETE cascade
anomaly_related_team_member_id_… FOREIGN KEY (related_team_member_id) REFERENCES team_member(id) ON DELETE set null
```

Neither is `DEFERRABLE`, so inside `saveRoster`'s transaction they fire on the
DELETE, before the re-INSERT — which is why same-id rows do not restore them.
Both probes above confirm it against the running local Postgres.

Consequences, ranked:

1. **Absences (FR-010) are wiped by any roster save.** Not live today only
   because S-08 has not shipped; the FK is in place, so this gets more dangerous
   with time, exactly as the roadmap warns. FR-010 feeds three downstream
   calculations (capacity, `SPRINT_AT_RISK` weighting, `DEVELOPER_INACTIVE`
   suppression), and the data is hand-entered — unrecoverable.
2. **Anomaly attribution is stripped by any roster save.** Live *today*.
   `developer-inactive.ts:50` and `sprint-at-risk.ts:66` write `teamMemberId`
   into the anomaly; `anomaly-inbox` filtering by team member and
   `roster.ts:6-14`'s deactivated-member label mapping both depend on it. After a
   save, every stored anomaly reads as team-level and escapes the member filter —
   the precise failure `roster.ts`'s comment was written to prevent. Detection
   re-runs on the next 15-min cycle and repopulates, so this self-heals within a
   sync window, which is why it has gone unnoticed.
3. **`isActive` is silently reset to `true`** because the insert at
   `roster-store.ts:277-289` omits the column and the default applies.

### 6. `main-nav.tsx`

`main-nav.tsx:10-15` — four items: Dashboard, Sprint Detail, Settings, and an
inert `#` for Refinement. The comment at `:8-9` records that Settings is what
made the wizard's connected-state pages reachable after first run. **Team does
not need a top-level nav item** — reaching it through Settings is the same
argument, and adding one would contradict `onboarding.ts:17-18`'s "must NOT add
a standalone Setup nav item". No change needed here beyond nothing.

Note there is also no active-link styling in the main nav (deferred at `:19-20`,
"until real routes exist") — same class of gap as the settings tabs, but out of
scope unless the plan is already touching nav styling.

### 7. Confirm-dialog precedent — there is none

`grep -rn "Dialog\|confirm(" src/components src/app` returns **nothing**.
`src/components/ui/` holds alert, badge, button, card, chart, checkbox, form,
input, label, scroll-area, select, sonner, table, tabs, tooltip — no dialog, no
alert-dialog. Destructive actions today just fire:

- `integration-card.tsx:98-105,188-190` — **Disconnect** runs with no
  confirmation, and it cascades the integration's synced history. A sibling of
  the same defect, adjacent to S-15's scope; worth naming in the plan even if it
  stays out of scope.

`@shadcn/alert-dialog` is available in the registry (`registry:ui`, confirmed via
the shadcn MCP), as is `@shadcn/switch` if the plan wants a toggle for
active/inactive rather than a checkbox. Per CLAUDE.md: add with
`npx shadcn add alert-dialog` — never re-run init.

## Code References

- `src/lib/integrations/roster-store.ts:274-292` — `saveRoster`'s delete-then-insert; the slice's root defect
- `src/lib/integrations/roster-store.ts:183-226` — `importRoster`'s merge-by-key transaction; where reconciliation belongs
- `src/lib/integrations/roster-store.ts:277-289` — the insert that omits `isActive`, resetting deactivation
- `src/db/schema.ts:311` — `isActive`, read everywhere, written nowhere
- `src/db/migrations/0001_lying_human_cannonball.sql:269,273` — the two inbound FKs (cascade / set null)
- `src/components/organisms/setup/roster-editor.tsx:151-177` — `mergeSelected`, with the comment that contradicts the code at `:161-162`
- `src/components/organisms/setup/roster-editor.tsx:351-364` — the unconfirmed row Remove
- `src/components/organisms/setup/roster-editor.tsx:132-140` — the empty-roster auto-import guard
- `src/app/(app)/settings/layout.tsx:16-19` — the `TABS` array Team slots into
- `src/app/(app)/settings/layout.tsx:31-41` — the tab nav with no active state
- `src/app/(app)/settings/connections/page.tsx:31-38` — the settings-page boot sequence to clone
- `src/components/organisms/settings/repo-selection-editor.tsx:57-91` — reuse-the-wizard-organism precedent + `router.refresh()`
- `src/components/templates/setup-wizard-shell.tsx:20-39` — `wide`, and why the Settings tab does not need it
- `src/lib/roster.ts:6-14` — why the roster reader returns deactivated members too
- `src/lib/anomaly/rules/developer-inactive.ts:22` — the only `isActive` consumer in the rules
- `src/lib/onboarding.ts:70-75` — "onboarding complete" requires ≥1 team member
- `src/lib/integrations/roster-store.integration.test.ts:193-283` — import coverage; `saveRoster` untested
- `scripts/seed-dashboard.mjs:190-204` — the five synthetic members behind the probable 5→7 repro

## Architecture Insights

- **Service core / action / organism split holds throughout.** `roster-store.ts`
  is request-context-free `{ db, ownerId, … }`; `actions.ts` is a thin
  `requireSession` → `getDb` → delegate shell with a token-free `toFailure`
  mapper (`setup/team/actions.ts:231-266`); the organism is a pure client
  component. S-15 should add its behaviour in the core and let both surfaces
  inherit it, rather than fixing anything in the editor.
- **Reads-before-transaction is a hard rule here** (`roster-store.ts:46-51`, and
  `lessons.md`'s pool-teardown entry): no `fetch` inside a `db.transaction`,
  because it pins a Hyperdrive-backed connection for the network duration. Any
  reconciliation that wants to compare upstream against stored rows must fetch
  first, then open one write transaction.
- **Delete-then-insert is the repo's monitored-set idiom** (`github-store.ts`,
  `jira-store.ts`) and it is safe *there* — those tables have no hand-entered
  children. `team_member` does. The idiom was copied past the boundary where it
  was valid; the plan should say so explicitly so the next slice does not copy it
  again. Candidate `lessons.md` entry.
- **Cache invalidation convention is `router.refresh()` from the client after a
  Server Action**, not `revalidatePath` — `grep revalidatePath src` returns
  nothing.
- **No routing enforcement of onboarding completeness exists.**
  `isOnboardingComplete` is defined (`onboarding.ts:28`) but called from nowhere;
  `middleware.ts:34-47` gates on the session cookie only. So emptying the roster
  from Settings does not lock the account out today — but it does make
  `isOnboardingComplete` false, so whichever slice wires that predicate up
  inherits a "Settings can un-onboard you" edge case. Worth a guard (refuse to
  save an empty roster, or warn) regardless.

## Historical Context (from prior changes)

- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:59` — S-04 chose
  merge-by-key for import *deliberately*, diverging from the delete-then-insert
  precedent, "precisely to satisfy FR-006's auto-import seeds, manual edit
  persists". The save leg (`:141`) was specified as full-set replacement, so the
  divergence stopped halfway. S-15 finishes it.
- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:43` — no UNIQUE
  natural key on `team_member`, "no new migration required". Still true; a
  reconciliation keyed on those columns may want to revisit it.
- `context/changes/dashboard-sprint-detail/plan.md:998-1006` — the two local
  accounts and their inverted credential state (`demo@sprintflow.test` holds the
  **real** tokens). Manual verification of S-15 must respect this; never seed the
  real one.
- `context/changes/dashboard-sprint-detail/plan.md:1021` — on the real account
  the merged roster row already carries both identity keys, entered by hand
  during S-10 testing. That row is exactly what a careless `saveRoster` would put
  at risk once absences exist.
- `context/foundation/manual-test-backlog.md:80-86` — S-04 manual rows **4.3**
  (auto-import / merge / edits survive re-import) and **4.6** (tablet width) are
  parked pending this slice. S-15 should either close them or hand them back
  explicitly.
- `context/foundation/lessons.md` — four entries, of which two bind here:
  request-scoped pool teardown (do not open a pool per call in the new action)
  and the NULL-in-a-UNIQUE-dedup-key rule (relevant if reconciliation adds a
  unique index over the nullable identity columns — a partial index
  `WHERE github_username IS NOT NULL` is the shape that actually dedups).

## Related Research

- `context/archive/2026-08-20-setup-team-roster-cadence/research.md` — S-04's
  original roster investigation
- `context/changes/dashboard-sprint-detail/research.md` — S-10's read-side
  conventions and the Settings-shell decision

## Open Questions

1. **Reconcile how?** Three shapes, materially different: (a) mark rows whose
   keys vanished upstream as inactive and let the user confirm; (b) show a
   diff/preview before applying an import ("2 new, 1 gone"); (c) tombstone
   deleted members so re-import never resurrects them. (a) reuses `isActive` and
   is cheapest; (c) needs a new column. Owner: plan. Blocking for the phase that
   touches `importRoster`.
2. **Delete or deactivate?** Given the cascade, the safe default is deactivate,
   with hard-delete reserved for a member who has no absences and no anomalies —
   which the service can check. Does the owner want a real delete at all, or is
   "remove from team" always deactivation? Owner: user. This decides how much the
   confirm dialog has to say.
3. **Does the Settings Team tab carry cadence too?** `/setup/team` renders
   `RosterEditor` + `CadenceForm` together. Cadence has its own lifecycle gap
   (S-16, sprint reconciliation) and its own FR (FR-007). Splitting it out keeps
   S-15 to FR-006; keeping it together avoids a second orphaned wizard step.
   Owner: user/plan.
4. **Is the 5→7 repro vector (4) — synthetic seed keys — or (1) — a re-added
   deleted member?** Reproducing it on a scratch account before designing the
   reconciliation would stop the plan solving the wrong problem. Owner: plan
   (cheap to check).
5. **Does `/setup/team` keep the roster editor once Settings owns it?** Removing
   it from the wizard would break first-run (the wizard is how the roster first
   appears, and `onboarding.ts:70` requires ≥1 member). Keeping both means one
   organism, two mount points — which the `RepoSelector` precedent already
   endorses. Recommend: keep both. Owner: plan.
