# S-27 — The demo boundary is a gate, not a convention — Plan Brief

> Full plan: `context/changes/demo-boundary-enforcement/plan.md`
> Research: `context/changes/demo-boundary-enforcement/research.md`

## What & Why

No screen rendered in demo mode may reach a mutation of the real account, and
every sentence the demo surfaces show the lead must be true. Today a lead viewing
demo can overwrite their real GitHub or Jira credential in three clicks, and
three copy surfaces promise a guarantee the code does not yet keep. S-24 settled
consent; this settles the gate.

## Starting Point

Demo is tenancy, not a flag — a second synthetic `user` row owns the demo world —
so most write actions need no guard at all: they land under the demo owner and
die with it. Only actions that deliberately pin the REAL owner need a gate, and
exactly five of them lack one: `storeGithubIntegration`, `storeJiraIntegration`,
`validateGithubToken`, `validateJiraCredentials`, `fetchProjectStatuses`. The
research also found two things the roadmap did not describe: the shortest path is
Settings → Connections → **Reconnect** (three clicks), not the setup wizard; and
the `/setup` doorstep calls `loadDemoAction()` unconditionally, so re-entering
demo from it silently rebuilds the world and discards the visitor's demo edits.

## Desired End State

A lead in demo cannot reach a real-account mutation by any route — actions
refuse, pages redirect, the Reconnect control is disabled like its neighbours.
The demo world is built once and survives every exit and re-entry; the only thing
that destroys it is the explicitly-labelled "Usuń dane demo", now behind a
confirmation naming what goes and what stays. The demo copy carries one general
sentence that remains true when a sixth action is added, and a CI-checked rule
fails the build on the next omission.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Boundary scope | Server refusals **and** route guards over both prefixes | Refusals are the boundary (`refusal.ts:5-9`); a `/setup/**` guard alone closes only one of three live click-paths | Plan |
| Guard mechanism | Per-page `isDemo` redirect, not a segment layout | A `/setup` layout would swallow the doorstep, which must stay reachable in demo; the three step pages already hold `isDemo` | Plan (research finding) |
| Redirect target | Nearest parent — `/settings/connections`, `/setup` | The Connections card already renders disabled controls plus the explanation, so it answers "why can't I" with no new copy | Plan |
| Reconnect control | Disabled in demo, like Test and Disconnect | Makes `connections/page.tsx:32-44`'s "every control" claim true and satisfies the corrected criterion at `integration-card.tsx:37-43` | Plan |
| Demo lifecycle (D1) | Built once; doorstep dispatches enter vs load by state | The panel has had this guard since S-09; the doorstep got the action without it. Entering demo must never destroy the world | Plan |
| Exit semantics (D2) | Unchanged — one `UPDATE`, deletes nothing | Already correct; locked in by test and copy rather than code | Research |
| Deletion (D3) | Only the explicit "Usuń dane demo", now with a confirm dialog | US-02 (`prd.md:83`) requires the reset path; every other irreversible action already goes through `confirm-dialog.tsx` | Plan |
| Copy shape | One general guarantee, no enumeration | The "exhaustive on purpose" promise has broken three times (S-09, S-24, D1); a general sentence stays true when a sixth action lands | Plan |
| Regression guard | Hermetic inventory test with an explicit exception list | Both prior slices wrote the rule correctly and enumerated short — a rule in a comment is checked by a person, a rule in a test by CI | Plan |

## Scope

**In scope:** five server-side refusals + their `.demo.test.ts` coverage; `isDemo`
redirects on two Connections pages and three wizard step pages; Reconnect
disabled; a state-aware demo entry action for the doorstep; copy rewritten on the
banner, the panel and the panel's state machine; a confirm dialog on reset; a
hermetic inventory test over actions and pages; one e2e for the shortest path.

**Out of scope:** the ~20 actions that resolve through `resolveWorkspace()` alone
(demo-scoped by construction); `exitDemoAction`; removing or renaming the reset
control; making reset reload; middleware; demo fixture content; any schema change.

## Architecture / Approach

Bottom-up in five layers. The server refusals are the boundary and hold even with
every UI control removed; the route guards and the disabled control are the
courtesy above them; the lifecycle fix stops demo entry from being destructive;
the copy can only become true once those three have landed; and the inventory
test freezes the rule last, when its exception list is final. Every refusal
reuses the pattern already in the repo five times —
`Promise.all([requireRealWorkspace(), resolveWorkspace()])`, `ownerId` from the
first, `isDemo` from the second — which since S-21's `getDb` memoization costs no
extra query and no extra pool.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server refusals | Five actions refuse in demo, with negative-control tests | Widening five error unions touches the forms that consume them |
| 2. Route guards + Reconnect | Five pages redirect; Reconnect disabled; one e2e | Reconnect is a link — `disabled` on an `<a>` is inert |
| 3. Demo built once (D1) | Doorstep re-enters instead of rebuilding | A new lifecycle action must not become a fourth way to reach `loadDemo` |
| 4. Copy + consent | True sentences on three surfaces; confirm dialog on reset | A general claim is only as good as Phase 5's test |
| 5. Inventory test | The rule enforced by CI, with an exception list | A source-text scanner is brittle and can silently match nothing |

**Prerequisites:** none — no migration, no new dependency. `npm ci` in this
checkout; `test:integration` and `test:e2e` are owned by this main checkout, not
the parallel S-25 worktree.
**Estimated effort:** ~2 sessions across five phases; Phase 1 is the largest,
Phase 3 the most subtle.

## Open Risks & Assumptions

- The inventory test scans source text, so it is sensitive to formatting and to
  an action moving file. Mitigated by asserting the scanned set is non-empty —
  otherwise a scanner that matches nothing reports success.
- Widening the five error unions reaches the client forms that render them; the
  demo refusal must surface as a message, not as an unhandled branch.
- The new doorstep action adds a third caller of the demo lifecycle. If it drifts
  from the panel's state machine, the two entrances disagree again — which is the
  exact defect D1 fixes.

## Success Criteria (Summary)

- From demo, no route, control or pasted URL reaches a write to the real account;
  the credential's last4 on `/settings/connections` never changes.
- Entering demo twice keeps the same world, the same frozen moment, and any edits
  made inside it; only the confirmed "Usuń dane demo" clears it.
- Every sentence the demo shows is true, and removing any one guard turns the
  build red.
