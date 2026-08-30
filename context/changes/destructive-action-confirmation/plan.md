# Confirmation before a destructive disconnect (S-24) — Implementation Plan

## Overview

Four Disconnect buttons — GitHub and Jira, in the setup wizard and in
`/settings/connections` — cascade-delete synced **and** hand-entered data on a
single click, with no confirmation. This plan puts one shared `ConfirmDialog` in
front of all four, whose copy is derived from a module that a hermetic test
holds equal to the actual foreign-key graph; and it closes the Connections tab
so that demo mode stops reaching real-account data at all.

The dialog is the visible half. The load-bearing half is that **no layer of this
codebase currently holds an accurate model of the cascade** — four docstrings
state a one-level cascade against an actual depth of four (GitHub) and five
(Jira), and the one destructive warning that exists is wrong in both directions.
An honest dialog cannot be assembled from what is written today, so the first
deliverable is the correct statement itself, machine-checked against the schema.

## Current State Analysis

**Four paths, none of them confirm.** All four fire the Server Action directly
from `onClick`:

| Path | File | Trigger |
| --- | --- | --- |
| Wizard, GitHub | `src/components/organisms/setup/github-connection-status.tsx:38-48,75-82` | `variant="outline"`, in the same `CardFooter` as *Continue to Jira* |
| Wizard, Jira | `src/components/organisms/setup/jira-connection-status.tsx:42-52,82-89` | `variant="outline"`, in the same `CardFooter` as *Continue* |
| Settings, both | `src/components/organisms/settings/integration-card.tsx:111-118,205` | `variant="ghost"` — the lightest of *Test connection / Reconnect / Disconnect*, and the only one that destroys anything |

Settings has no disconnect path of its own: `src/app/(app)/settings/connections/page.tsx:11-12`
imports the wizard's own two Server Actions.

**The cascade, derived from `src/db/schema.ts` (verified 2026-08-30 by walking
`getTableConfig(...).foreignKeys` over every exported table).** Only edges with
`onDelete: "cascade"` that point *into* the frontier are followed; the
`owner_id → user` edges never enter it, because `user` is not on the path.

```
github_credential ──▶ monitored_repo ──▶ github_commit
                                     └─▶ github_pull_request ──▶ github_review

jira_credential ──▶ jira_project ──▶ status_mapping
                                 ├─▶ jira_ticket ──▶ jira_status_history
                                 └─▶ sprint ──▶ absence
                                            ├─▶ jira_ticket ──▶ jira_status_history
                                            ├─▶ anomaly
                                            └─▶ daily_recap.sprint_id  (SET NULL — rows survive)
```

So GitHub destroys 4 tables at depth 4; Jira destroys 7 tables at depth 5 and
weakens one. **`absence` is the sharp edge**: it is hand-entered FR-010 data that
no sync can reconstruct, and it dies because `src/lib/absence-store.ts:157`
stamps `sprint_id` from the owner's active sprint at creation. On any account
past first run, effectively every recorded absence dies with a Jira disconnect.

**What survives both disconnects** (owner-scoped tables with no path from either
credential): `team_member`, `team_day_off`, `sprint_measurement` (the FR-023
capacity/velocity history), `anomaly_settings`, `recap_settings`, `daily_recap`
(rows survive; `sprint_id` is nulled), `refinement_run` + `refinement_ticket_verdict`,
`sync_state`, `sync_attempt`.

**No layer states this correctly.** `src/lib/integrations/github-store.ts:174-179`
("the monitored-repo rows cascade"), `src/lib/integrations/jira-store.ts:288-292`
("the project + status-mapping rows cascade"), `src/app/(app)/setup/github/actions.ts:161`
("Clear the credential + its repos"), `src/app/(app)/setup/jira/actions.ts:248`
("the credential + its project + mappings") and both wizard component docstrings
each describe a one-level cascade. `src/components/organisms/settings/jira-project-editor.tsx:77-84`
— the only destructive warning in the repo — names `daily_recap`, which
**survives** (`schema.ts:1037-1039`, `SET NULL`), and omits `absence`, which
**dies** and is the one thing no sync rebuilds. (Precision, plan-review F10: the
`Alert` body *does* name anomalies — *"Anomalies detected from that data go with
it"*. It is the component **docstring** at `:23-30` that omits both `absence` and
`anomaly` and asserts `daily_recap` cascades.) Its author reasoned explicitly
about cascades and got it wrong anyway.

**The convention already exists and already named this gap.**
`src/components/molecules/confirm-dialog.tsx:19-21` — *"so **every** destructive
action in the app reads the same: it NAMES what it is about to destroy"* — with
three consumers (`setup/roster-editor.tsx:860,890`, `settings/absence-editor.tsx:285`,
`settings/team-days-off-editor.tsx:181`) and an established copy shape. Its own
plan (`context/archive/2026-08-23-team-management-surface/plan.md:531-532`)
records the omission: *"the roster's three destructive actions **and the
Disconnect button whenever someone fixes it**"*.

**Demo reaches real data on this tab.** `src/lib/workspace.ts:167-170` —
`requireRealWorkspace()` returns `session.user.id` without querying the
workspace, so every Connections mutation lands on the **real** owner even while
the account is viewing demo. `integration-card.tsx:197` puts `isDemo` in *Test
connection*'s predicate and omits it at `:205` for *Disconnect*; the recorded
criterion at `:31-35` is *"only the control that would reach the live API is
disabled"* — a rule about **outbound calls**, which admits an irreversible local
DELETE because it calls nothing. Four more real-account mutations are reachable
the same way: `updateJiraProject` (destroys real sprints), `updateMonitoredRepos`
(a dropped repo cascades its commits/PRs/reviews), and both `test*Connection`
(UI-disabled, server unguarded). `src/app/(app)/settings/connections/page.tsx:34`
claims *"the server refuses them too"*; `src/app/(app)/settings/connections/actions.ts`
contains no demo check at all.

**The refusal seam already exists.** `src/lib/demo/refusal.ts` — `demoRefusal()`,
*"SERVER-SIDE FIRST, disabled control second"* — is consumed by
`setup/team/actions.ts`, `settings/recap/actions.ts`, `refinement/actions.ts`
and `lib/integrations/sync/actions.ts`, each with a `*.demo.test.ts` sibling.
`src/app/(app)/setup/team/actions.ts:51-61` states the house rule verbatim:
edits follow `resolveWorkspace()`; actions that reach the real world take
`requireRealWorkspace()` **and** refuse in demo. The four connection actions
never went through it.

**Exiting demo already does the right thing.** `exitDemoAction`
(`src/app/(app)/settings/demo/actions.ts`) only flips `user.active_workspace` to
`REAL`; the demo rows stay and `enterDemoAction` returns to them *"keeping
whatever was edited in it"*. Only the explicit `resetDemoAction` deletes. This
plan does not change that — it stops the other half of the boundary from being
violated.

**Four E2E specs encode the unconfirmed click.** `e2e/setup-jira.spec.ts:27-33,46-52`
and `e2e/setup-github.spec.ts:27-33,49-55` click Disconnect and immediately
assert the Connect button; `e2e/seed.spec.ts:34` and
`e2e/dashboard-sprint-detail.spec.ts:51` both depend on those `afterEach` hooks
having disconnected (they take their own onboarded accounts *because* the shared
account is left un-onboarded by them).

**Two documents assert a confirmation that does not exist.**
`context/archive/2026-08-26-sprint-reconciliation/MANUAL-CHECKLIST.md:129-131`
(*"celowo nie ma confirmation dialogu, który ma odpowiednik w `/settings/connections`"*)
and `context/foundation/manual-test-backlog.md:1808` row 15.C (*"kliknij
**Disconnect**, potwierdź"*).

## Desired End State

Clicking Disconnect on any of the four paths opens the house `ConfirmDialog`,
which names — correctly — what disappears and what survives, and can be
cancelled with nothing lost. The category list is not hand-maintained: it lives
in one module that a unit test holds equal to the cascade the schema actually
declares, so a future slice that hangs a new child under `sprint` or
`monitored_repo` fails the build rather than silently invalidating the copy.

On the Connections tab, demo mode reaches neither a real-account mutation nor
the real account's credentials: every one of the nine Server Actions refuses
server-side and its control is disabled with a reason.
The demo banner's promise — *"Twoje prawdziwe dane i integracje są nietknięte"* —
becomes true because the code honours it, not because the sentence was softened.

**Verification**: `npm test` covers the schema-derived guard and the demo
refusals; `npm run test:e2e` covers the confirm-then-disconnect path end to end;
the manual rows cover cancel-leaves-data-intact and the demo lockout.

### Key Discoveries:

- `fk.onDelete` is readable at runtime from `getTableConfig(table).foreignKeys[].onDelete`
  in `drizzle-orm/pg-core`, with **no database** — proven in this repo's unit
  project on 2026-08-30. This is what makes the guard test possible in `npm test`
  rather than in the integration project.
- The traversal needs no exclusion list: starting at `github_credential` /
  `jira_credential` and following only *incoming* cascade edges never reaches
  `user`, so the `owner_id` edges drop out for free.
- `ConfirmDialog` needs **no changes**: it already supports controlled `open`,
  a `ReactNode` description, `variant="destructive"`, and holds itself open
  through the async `onConfirm` so a slow Server Action cannot be double-submitted
  (`confirm-dialog.tsx:71-85`). ⚠️ **But `description` renders inside a `<p>`**
  (plan-review F2): `AlertDialogDescription` → `AlertDialogPrimitive.Description`
  → `Primitive.p` (`@radix-ui/react-dialog/dist/index.mjs:269`), so a `<ul>` or
  `<div>` there is invalid nesting — React warns and the browser breaks the list
  out of the paragraph, taking the accessible description with it. All three
  existing consumers pass a plain string; this slice does the same.
- `src/app/(app)/setup/team/page.tsx:22-27` is the precedent for reading
  `isDemo` on an always-real wizard page: `requireRealWorkspace()` for the owner,
  `resolveWorkspace()` for the flag only, with `resolveWorkspace` being `cache()`d
  so the extra read costs nothing.
- `src/components/organisms/demo/demo-panel-view.ts` is the precedent for
  extracting a decision out of a `.tsx` into a pure, unit-testable sibling —
  there is no jsdom/RTL harness in this repo.

## What We're NOT Doing

- **Not narrowing the cascade.** `absence` continues to die with a Jira
  disconnect. Fixing that is roadmap **S-26**, needs a migration, and must not be
  decided twice with S-20 (owner's decision at `/10x-frame`).
- **Not asking whether Disconnect should delete at all.** Open Roadmap Question 4.
  This slice settles *consent* only.
- **No live counts.** The dialog names categories, not "12 absences". Owner's
  decision; the pass condition is *"asked, told what will be removed, able to
  cancel"*. `getMemberHistory` stays the only counted confirmation in the app.
- **No visual re-weighting of the buttons.** `integration-card.tsx:205` stays
  `variant="ghost"`; the wizard's Disconnect stays in the same `CardFooter` as
  Continue. Owner's decision — the dialog is the gate.
- **No demo gate on `/setup/**`.** The wizard's *connect* path can still write
  real credentials while in DEMO, `/setup/**` reads no demo flag today, and the
  doorstep `push`es rather than `replace`s. That is **S-27**, and it collides
  with `demo-banner.tsx`'s "Dokończ konfiguracja" button, which deliberately
  routes from demo into the wizard. Only the wizard's two **Disconnect buttons**
  are gated here, because they are two of this slice's four paths.
- **No schema change and no migration.** The `lessons.md` rule about a migration
  needing a named route to production does not apply to this slice.
- **No `lessons.md` entry.** Considered and declined this round; the defect class
  ("a non-destructive action becomes destructive when a later slice hangs a
  cascading child beneath it") is instead enforced mechanically by Phase 1's
  guard test, which is stronger than a prose rule for this particular case.

## Implementation Approach

Four phases, ordered so that each one can land alone and the riskiest statement
— what the cascade actually is — is settled and machine-checked before any copy
depends on it.

1. State the blast radius in one module and make the schema police it.
2. Put the house confirmation in front of all four paths, feeding it from that
   module; repair the docstrings that misstate the cascade; fix the E2E hooks.
3. Close the Connections tab against demo, following the `setup/team/actions.ts`
   rule that already exists.
4. Make every remaining sentence about Disconnect true — the demo panel, the
   wrong warning in `jira-project-editor.tsx`, and the two documents that assert
   a confirmation that did not exist.

## Critical Implementation Details

**The confirm label must differ from the trigger label — and that alone is not
enough for Playwright.** Both the trigger and the dialog's action would otherwise
be a button named "Disconnect", which the tester could not tell apart. Use
`Disconnect GitHub` / `Disconnect Jira` as `confirmLabel` while the trigger stays
`Disconnect`. **The E2E side needs `exact: true` on top of that** (plan-review
F3): `getByRole`'s `name` defaults to `exact: false`, i.e. a case-insensitive
SUBSTRING match, so with the dialog open `{ name: "Disconnect" }` resolves to two
nodes and `{ name: "Connect" }` to three — *Dis**connect***, *Re**connect*** and
*Dis**connect** GitHub* — and every such locator throws a strict-mode violation.
Every `Disconnect` / `Connect` locator touched by this slice takes
`{ exact: true }`.

**`disconnectGithub` / `disconnectJira` change signature.** They return
`Promise<{ ok: true }>` today and are consumed in three components. Once they can
refuse in demo, the return type becomes a union, and every call site must handle
the failure branch rather than assume success — including
`IntegrationCard`'s `onDisconnect` prop type. This is the one contract change
that ripples, so it lands in Phase 3 as a single edit across all call sites, not
piecemeal.

**Copy language follows the surface, not the slice.** The dialog copy is
**English** — `integration-card.tsx`, both wizard cards and all three existing
`ConfirmDialog` consumers are English. The demo-refusal copy is **Polish**,
matching `DEMO_REFUSAL_MESSAGE` and the existing demo note already rendered
inside `integration-card.tsx:216-220`.

## Phase 1: Name the blast radius, and make the schema police it

### Overview

One module states what each disconnect destroys, what it keeps, and what it
weakens — in both table names and product language. One hermetic test derives the
same sets from the foreign-key graph and asserts they match. No UI in this phase.

### Changes Required:

#### 1. The blast-radius declaration

**File**: `src/lib/integrations/disconnect-impact.ts` (new)

**Intent**: Hold the single correct answer to "what does Disconnect destroy",
so the dialog, the demo panel and `jira-project-editor.tsx` all read one source
instead of three hand-written guesses. The module imports **nothing** from
`@/db/schema` — every table name is a plain string literal — so a client
component can import it without pulling `drizzle-orm/pg-core` into the bundle.
The schema is imported only by the guard test (§2).

**Contract**: Exports `type DisconnectImpact` and a
`DISCONNECT_IMPACT: Record<"github" | "jira" | "projectSwitch", DisconnectImpact>`
with, per entry: `rootTable` (the table the DELETE targets), `destroyedTables`
(every table whose rows the cascade deletes, excluding the root),
`weakenedTables` (`{ table, column }` for each `ON DELETE SET NULL` edge reached
from the cascade), and two ordered `readonly string[]` copy lists — `destroys`
and `keeps` — written in the established copy shape (consequence in product
terms; name what survives alongside what disappears).

The declared values, which Phase 1's test is what actually pins:

- **github** — root `github_credential`; destroys `monitored_repo`,
  `github_commit`, `github_pull_request`, `github_review`; weakens nothing.
- **jira** — root `jira_credential`; destroys `jira_project`, `status_mapping`,
  `sprint`, `jira_ticket`, `jira_status_history`, `absence`, `anomaly`; weakens
  `daily_recap.sprint_id`.
- **projectSwitch** — root `sprint`; destroys `jira_ticket`,
  `jira_status_history`, `absence`, `anomaly`; weakens `daily_recap.sprint_id`.
  This is a THIRD root, not a subset of the Jira one (plan-review F1):
  `updateJiraProject` **updates** the `jira_project` row in place and deletes
  only that project's `sprint` rows (`connection-service.ts:393-412`), so
  `jira_project` survives and `status_mapping` is replaced rather than lost.
  Deriving the editor's copy by subtracting "credential-level items" from the
  Jira entry would have left both of them in the list — a second hand-written
  answer, which is the exact failure this module exists to end. Its `keeps` copy
  must therefore name the token and workspace (a project change does not touch
  them) and say the status mapping is re-entered, not destroyed.

The Jira `destroys` copy must name the recorded absences explicitly and say they
cannot be re-synced — that is the only irreplaceable item in either list. The
`keeps` copy must name the team roster, team-wide days off, closed-sprint
measurements (capacity/velocity history), the other integration, and past daily
recaps (kept, but no longer linked to a sprint).

#### 2. The schema-derived guard

**File**: `src/lib/integrations/disconnect-impact.test.ts` (new)

**Intent**: Make the declaration falsifiable against the schema, so a future
slice that attaches a cascading child under `sprint` or `monitored_repo` breaks
this test instead of silently turning the dialog into a lie. This is the only
mechanism in the repo that can catch the defect class S-24 came from — ESLint
cannot see it, and a diff-scoped review is blind to a pre-existing button whose
blast radius grew elsewhere.

**Contract**: Walks every exported table in `@/db/schema` via
`getTableConfig(...)` from `drizzle-orm/pg-core`, builds the reverse
foreign-key index, and does a breadth-first closure from each `rootTable`
following only edges whose `fk.onDelete === "cascade"`; edges whose `onDelete`
is `"set null"` and whose parent is inside the closure are collected as weakened.
Asserts, for **every** entry in `DISCONNECT_IMPACT` — `projectSwitch` included —
that the derived destroyed set equals `destroyedTables` and the derived weakened
set equals `weakenedTables`. The traversal takes the root as a parameter, so
covering the third entry costs one more table-driven case, not a second walker.
Note the root itself is excluded from `destroyedTables` for `github`/`jira`
(the DELETE targets it) but `projectSwitch`'s root `sprint` **is** deleted by
`updateJiraProject`, so its copy must name sprints too even though the derived
set does not contain the root.

Three named regression assertions on top of the set equality, each pinning a
mistake already made in this repo: `absence` **is** in the Jira destroyed set
(the hand-entered data), `anomaly` **is** in it, and `daily_recap` is **not**
(it is weakened, not destroyed — the exact error in `jira-project-editor.tsx:79`).

Hermetic: no database, so it belongs to `vitest.config.ts` (`npm test`), not the
integration project.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- The new guard fails when the declaration is wrong: temporarily drop `absence`
  from `destroyedTables` and confirm `npm test` goes red, then restore
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- None. This phase has no user-visible surface.

---

## Phase 2: One confirmation on all four paths

### Overview

`ConfirmDialog` in front of every Disconnect, fed from the Phase 1 module. The
four docstrings that misstate the cascade are corrected in the same phase, since
they are the reason the copy was wrong in the first place. The E2E cleanup hooks
are taught to confirm.

### Changes Required:

#### 1. The dialog copy renderer

**File**: `src/components/molecules/disconnect-confirm.tsx` (new)

**Intent**: One component that turns a `DisconnectImpact` into the dialog, so the
wizard's two cards and the settings card cannot drift apart the way the four
docstrings did. Wraps `ConfirmDialog` rather than replacing it — the house shell
already handles the async hold-open, the destructive variant and Cancel-first
focus.

**Contract**: `DisconnectConfirmDialog({ integration, open, onOpenChange, onConfirm })`
where `integration` is `"github" | "jira"`. Renders `ConfirmDialog` with
`variant="destructive"`, `confirmLabel={"Disconnect GitHub" | "Disconnect Jira"}`,
a title naming the integration, and a `description` built by joining
`DISCONNECT_IMPACT[integration].destroys` and then `.keeps` into **prose
sentences** — a plain string, the same shape the three existing consumers use,
because the description renders inside a `<p>` (see Key Discoveries). The copy
lists therefore have to read as clause fragments that compose into two sentences,
not as bullet labels. No `secondary` action — unlike a member delete, there is no
safer alternative to offer here.

#### 2. The three call sites

**Files**: `src/components/organisms/setup/github-connection-status.tsx`,
`src/components/organisms/setup/jira-connection-status.tsx`,
`src/components/organisms/settings/integration-card.tsx`

**Intent**: Route each existing `handleDisconnect` behind the dialog instead of
firing it from `onClick`. The button keeps its current variant and position
(owner's decision); only the gate changes.

**Contract**: Each component gains a local `confirmOpen` boolean; the Disconnect
button's `onClick` sets it rather than calling the action; the existing
`handleDisconnect` becomes the dialog's `onConfirm`. The existing pending state
(`isDisconnecting` / `disconnecting`) stays as the button's post-confirm
feedback — `ConfirmDialog` owns the in-dialog pending state itself.

#### 3. The docstrings that state a one-level cascade

**Files**: `src/lib/integrations/github-store.ts:174-179`,
`src/lib/integrations/jira-store.ts:288-292`,
`src/app/(app)/setup/github/actions.ts:161`,
`src/app/(app)/setup/jira/actions.ts:248`, plus the two wizard component
docstrings (`github-connection-status.tsx:21-25`,
`jira-connection-status.tsx:21-26`)

**Intent**: Six comments currently tell the next reader that Disconnect removes
one level of children. That belief is what produced four unconfirmed buttons and
one wrong warning; leaving it in place after fixing the button would reproduce
the defect at the next slice.

**Contract**: Each docstring states the real depth and points at
`disconnect-impact.ts` as the maintained answer rather than restating the list
(a restated list is a second copy that can drift). The `jira-store.ts:245-255`
comment about the phase-4 defensive delete keeps its reasoning but drops the
clause implying the settings path has a confirmation the wizard does not — after
this phase both do.

#### 4. The E2E cleanup path

**Files**: `e2e/disconnect.ts` (new), `e2e/setup-github.spec.ts`,
`e2e/setup-jira.spec.ts`

**Intent**: Both specs disconnect in `afterEach` and again as a pre-step, in four
places total, and all four break the moment the dialog lands. One helper keeps
them from drifting, and `e2e/seed.spec.ts` and `e2e/dashboard-sprint-detail.spec.ts`
keep the un-onboarded shared account they depend on.

**Contract**: `disconnectIfConnected(page, integration: "GitHub" | "Jira")` —
returns early if no `Disconnect` button is visible; otherwise clicks it, clicks
the dialog's `Disconnect GitHub` / `Disconnect Jira` action by role+name, and
waits for the `Connect` button. **Every one of those locators passes
`{ exact: true }`** — see Critical Implementation Details; the substring default
makes `Disconnect` and `Connect` ambiguous the moment the dialog exists.
Locators stay role/label-based; no `waitForTimeout`.

#### 5. A risk-tied E2E for the confirmation itself

**File**: `e2e/setup-github.spec.ts`

**Intent**: The one thing the manual rows cannot cheaply prove on every run is
that **Cancel actually cancels**. Without it, a regression that wires Cancel to
the action would pass every other check.

**Contract**: One test on the already-connected state: open the dialog, assert it
names the destroyed categories, press Cancel, assert the connected-status card is
still rendered and the Connect form is not. The "Connect form is not there"
assertion is the one that fails without `{ exact: true }` — the visible
*Disconnect* trigger substring-matches `Connect`. Reuses the spec's existing
fixture server and `storageState`; unique-id and cleanup rules unchanged.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck` (catches every call site of the two
  wizard cards and `IntegrationCard`)
- Linting passes: `npm run lint`
- E2E passes, including the four repaired hooks and the new cancel test:
  `npm run test:e2e`

#### Manual Verification:

- On `/setup/github`, Disconnect opens a dialog that names the monitored
  repositories and the synced commit/PR/review history, and Cancel leaves the
  connected card exactly as it was.
- On `/settings/connections`, the Jira card's Disconnect dialog names the
  recorded absences explicitly and says they cannot be re-synced.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to the next phase.

---

## Phase 3: Demo stops reaching real data on Connections

### Overview

Nine Server Actions on the Connections tab mutate or spend the **real** account
while the lead is viewing demo. Each gets the refusal the house rule already
prescribes, and its control gets the disabled treatment *Test connection*
already has.

### Changes Required:

#### 1. The two disconnect actions

**Files**: `src/app/(app)/setup/github/actions.ts`,
`src/app/(app)/setup/jira/actions.ts`

**Intent**: These are the four buttons' single implementation, shared by wizard
and settings, so one refusal covers all four paths. They keep
`requireRealWorkspace()` — the target owner is deliberately real — and add the
`isDemo` check beside it, exactly as `setup/team/actions.ts:219,282` does.

**Contract**: Return type widens from `{ ok: true }` to
`{ ok: true } | { ok: false; error: "demo_mode"; message: string }`, produced by
`demoRefusal()`. The flag comes from `resolveWorkspace()`, called alongside
`requireRealWorkspace()` (both are `cache()`d). Every call site gains an
**explicit `if (!result.ok)` branch** — neither failure surface exists today
(plan-review F7). In the wizard cards `toast.error` sits in a `catch`
(`github-connection-status.tsx:38-48`), and a returned `{ ok: false }` does not
throw, so without the branch the refusal would render as `toast.success`; the
branch calls `toast.error(result.message)` and clears the pending state.
`IntegrationCard.handleDisconnect` (`integration-card.tsx:111-118`) has no error
state at all — only the `failure` and `testResult` alerts, neither about
disconnecting — so it gains a `disconnectError` state rendered in a destructive
`Alert` beside them.

#### 2. The seven settings actions

**File**: `src/app/(app)/settings/connections/actions.ts`

**Intent**: `updateJiraProject` destroys real sprints, tickets, status history
and anomalies; `updateMonitoredRepos` cascades a dropped repo's commits, PRs and
reviews; both `test*Connection` spend the real credential against the live API
with only a `disabled` attribute — *"a courtesy, not a boundary"*
(`refusal.ts:5-9`) — in the way. **The three `load*` readers do exactly the same**
(plan-review F4): `loadAvailableRepos`, `loadAvailableProjects` and
`loadProjectStatuses` each decrypt the real token and call the live API, and each
is a Server Action — its own entry point, reachable whether or not its editor
renders. Exempting them because "the editor is disabled" would be the same
`disabled`-as-a-boundary argument this phase exists to reject, so they are gated
on the same rule. They are reads, so nothing is destroyed either way; what the
gate stops is a demo screen spending the real account's rate limit.

**Contract**: `updateJiraProject` and `updateMonitoredRepos` return their
existing `{ ok: false; message }` shape carrying `DEMO_REFUSAL_MESSAGE` (their
union has no `error` discriminant to widen). `testGithubConnection` and
`testJiraConnection` gain a `"demo_mode"` member on `ConnectionTestResult`'s
`reason` union, with a matching entry in `integration-card.tsx`'s
`TEST_FAILURE_COPY`. `loadAvailableRepos`, `loadAvailableProjects` and
`loadProjectStatuses` return their existing `{ ok: false; message }` shape
carrying `DEMO_REFUSAL_MESSAGE`, like the two update actions.

#### 3. The controls

**Files**: `src/components/organisms/settings/integration-card.tsx`,
`src/app/(app)/settings/connections/page.tsx`,
`src/app/(app)/setup/github/page.tsx`, `src/app/(app)/setup/jira/page.tsx`,
`src/components/organisms/setup/{github,jira}-connection-status.tsx`

**Intent**: Disable in the UI what the server now refuses, so demo never presents
a control that can only fail. The wizard's two cards read the flag for the first
time; the settings page already has it.

**Contract**: `integration-card.tsx:205` adds `isDemo` to Disconnect's
`disabled` predicate and the `editSlot` is not rendered in demo (it holds the two
destructive editors); the existing Polish demo note is extended to say that
disconnecting and changing the monitored project/repositories are disabled too.
The two wizard pages add `const { isDemo } = await resolveWorkspace()` beside
their existing `requireRealWorkspace()` — the pattern at
`setup/team/page.tsx:22-27` — and pass it to their card, which disables
Disconnect with the same reason.

#### 4. The demo tests

**Files**: `src/app/(app)/settings/connections/actions.demo.test.ts`,
`src/app/(app)/setup/github/actions.demo.test.ts`,
`src/app/(app)/setup/jira/actions.demo.test.ts` — **all three new**. The setup
directories hold only `actions.integration.test.ts`, which is excluded from
`vitest.config.ts` and needs local Postgres, so extending those files would put
the refusals outside `npm test` and criterion 3.1 could not be met
(plan-review F5).

**Intent**: Match the established `*.demo.test.ts` convention so the refusal is
asserted at the seam that actually stops it — the Server Action — rather than at
the disabled attribute.

**Contract**: Each of the nine actions, called with `resolveWorkspace` reporting
`isDemo: true`, returns the refusal and performs no database write and no API
call. Mocking follows `setup/team/actions.demo.test.ts` exactly: `vi.mock` on
`@/lib/workspace`, and `getCloudflareContext` / `getDb` mocked to **throw** — so
"performed no write" is proven by the refusal returning at all, not asserted
afterwards.

#### 5. The comment that describes a refusal that was not implemented

**File**: `src/app/(app)/settings/connections/page.tsx:32-36`

**Intent**: It claims *"the server refuses them too"*, which was false when
written. After this phase it is true, and it should say which actions it covers
so the next reader can check it.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new demo refusals: `npm test`
- Type checking passes: `npm run typecheck` (the widened `disconnect*` return
  type is what forces every call site to be visited)
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:integration`
- E2E passes: `npm run test:e2e`

#### Manual Verification:

- In demo, on `/settings/connections`, Disconnect is disabled with a stated
  reason and the "Change monitored project" / repository editors are not offered.
- Exiting demo and re-entering it shows the same demo data, with any demo edits
  still present.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to the next phase.

---

## Phase 4: Make every statement about Disconnect true

### Overview

Five documents and one component still describe a world without this
confirmation, or a cascade that is not the real one. They are corrected in the
same commit as the fix, per the repo rule that a note outliving its repair is
actively misleading.

### Changes Required:

#### 1. The wrong destructive warning

**File**: `src/components/organisms/settings/jira-project-editor.tsx:23-30,77-84`

**Intent**: This is the repo's only other destructive warning and it is wrong in
both directions — it names `daily_recap`, which survives, and omits `absence`,
which dies. Its docstring is worse still: it omits `absence` **and** `anomaly`
and states that `daily_recap` cascades. Leaving a known lie two clicks from the
new, correct dialog is worse than either alone.

**Contract**: The `Alert` body and the component docstring are rebuilt from
**`DISCONNECT_IMPACT.projectSwitch`** — the Phase 1 entry rooted at `sprint`, not
a hand-subtracted slice of the Jira one (plan-review F1). A project switch
updates the `jira_project` row in place and replaces the status mappings, so
neither may be described as destroyed; the token and workspace survive too. The
`{ kind: "discarded" }` summary screen is corrected the same way, from the same
entry.

#### 2. The demo surfaces

**Files**: `src/components/organisms/demo/demo-panel.tsx:108-112`,
`src/components/organisms/demo/demo-banner.tsx:92-94`

**Intent**: The panel enumerates what demo disables and omits disconnecting and
selection editing; the banner promises real integrations are untouched. After
Phase 3 the banner's promise is kept by the code, so it stands as written — the
panel's list is what needs to grow.

**Contract**: `demo-panel.tsx`'s closing paragraph adds disconnecting and
changing the monitored project/repositories to the disabled list. `demo-banner.tsx`
is verified unchanged-and-now-true; if any wording still overstates, it is
tightened rather than weakened.

#### 3. The two documents that assert a confirmation

**Files**: `context/archive/2026-08-26-sprint-reconciliation/MANUAL-CHECKLIST.md:129-131`,
`context/foundation/manual-test-backlog.md:1808`

**Intent**: Both were written against an assumption nobody verified. The archived
checklist justified the wizard's missing dialog by an equivalent in settings that
did not exist; the backlog row 15.C instructs the tester to "confirm" at a step
where nothing asked.

**Contract**: The archived line is corrected in place with a dated note saying
the equivalent did not exist and that S-24 supplied one on both paths — it is a
record of what was believed, so it is annotated, not rewritten. Backlog row 15.C
now matches the shipped flow.

#### 4. The manual-test note

**File**: `context/manual-tests/S-16-4.6-brak-potwierdzenia-disconnect.md`

**Intent**: Deleted in the same commit as the fix, per the convention in
`CLAUDE.md` — its finding is now shipped, and a note that outlives its repair
misleads the next reader.

**Contract**: File removed; the roadmap's S-24 entry keeps the reference to what
was found and by whom. Two live references to it survive elsewhere and are
repointed in the same commit (plan-review F6):
`context/manual-tests/S-16-4.6-tozsamosc-sprintu-niewidoczna.md:9`
(`**Powiązane:**` — a note that outlives this slice and would be left with a dead
link) and `context/foundation/manual-test-backlog.md:295`. Both point at the
roadmap's S-24 entry instead, which is where the finding now lives.

#### 5. The slice's own manual rows

**Files**: `context/changes/destructive-action-confirmation/MANUAL-CHECKLIST.md`
(new), `context/foundation/manual-test-backlog.md`,
`context/foundation/roadmap.md:58,571,888-925`

**Intent**: Give the tester the 3–5 rows that genuinely block this slice, mirror
everything else into the one list the second person works from, and mark S-24
delivered.

**Contract**: `MANUAL-CHECKLIST.md` carries the four rows listed under *Manual
Testing Steps* below, each with where / what to do / what must be true / why it
matters, signed off with the phase number it belongs to (2 or 3 — Phase 4 has no
surface of its own). `node scripts/manual-test-sweep.mjs` exits zero. Roadmap
S-24 status moves from `proposed` to done, and its "CORRECTED 2026-08-30" note
keeps its explanation of why `jira-project-editor.tsx` was the wrong pattern to
copy. **`roadmap.md:574` (S-27) is corrected too** (plan-review F10): it still
lists `connections/page.tsx:34`'s undelivered server-side refusal as remaining
work for S-27, which Phase 3 delivers — leaving it would be the same class of
stale statement this phase exists to close. S-27 keeps its other two items
(`/setup/**` has no demo guard; the doorstep `push`es rather than `replace`s).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Backlog reconciliation is clean: `node scripts/manual-test-sweep.mjs`
- The deleted note is gone and no live document points at it:
  `grep -rl "S-16-4.6-brak-potwierdzenia" context/ src/` returns only
  `context/foundation/roadmap.md` and this change's own folder (`frame.md`,
  `plan.md`, which record what was found). In particular
  `context/manual-tests/` and `manual-test-backlog.md` no longer match

#### Manual Verification:

- None of its own. The four `MANUAL-CHECKLIST.md` rows are the checks already
  tracked as 2.5, 2.6, 3.6 and 3.7 — Phase 4 writes them down for the tester, it
  does not add a fifth thing to click (plan-review F9).

**Implementation Note**: This is the closing phase; run the sweep before the
epilogue commit.

---

## Testing Strategy

### Unit Tests:

- **`disconnect-impact.test.ts`** — the schema-derived closure equals the
  declaration, for both integrations. Named regressions: `absence` and `anomaly`
  are destroyed by a Jira disconnect; `daily_recap` is weakened, not destroyed.
- **`connections/actions.demo.test.ts`** plus the two new setup siblings — each
  of the nine actions refuses in demo and writes nothing.
- Edge case worth an explicit assertion: an integration whose declared
  `weakenedTables` is empty (GitHub) must still be checked, so a future
  `SET NULL` edge added under `monitored_repo` is caught rather than ignored.

### Integration Tests:

- No new integration test. The cascade itself is a database guarantee already
  covered by the FK definitions, and the guard test asserts against those
  definitions; re-proving the cascade against live Postgres would test Postgres,
  not this slice.

### Manual Testing Steps:

1. **Cancel leaves everything intact** (`/setup/jira`, local test account with a
   connected Jira and at least one recorded absence): click Disconnect, read the
   dialog, press Cancel; the connected card is unchanged and
   `/settings/absences` still lists the absence.
2. **The dialog names the absences** (`/settings/connections`, Jira card): open
   the dialog and confirm it says recorded absences are destroyed and cannot be
   re-synced, and that the roster and closed-sprint measurements survive.
3. **Demo cannot reach the real account** (any account with demo loaded,
   `/settings/connections`): Disconnect is disabled with a reason and the
   project/repository editors are not offered.
4. **Demo survives a round trip**: exit demo, re-enter demo, and confirm the same
   demo sprint and any demo-side roster edits are still there.

## Performance Considerations

The guard test walks every table in the schema once per run — tens of tables, no
I/O. The dialog reads a frozen constant, so opening it costs nothing; this is the
direct consequence of declining live counts. Phase 3 adds one `resolveWorkspace()`
per disconnect action and per wizard page, and it is `cache()`d per render, so it
costs at most one extra query on pages that did not already resolve the
workspace.

## Migration Notes

None. This slice adds no `src/db/migrations/*.sql` file and reads the schema only
to assert against it, so the `lessons.md` rule about a migration needing a named
route to production does not apply. Nothing to roll back beyond reverting the
commit.

## References

- Frame brief: `context/changes/destructive-action-confirmation/frame.md`
- Source finding: `context/manual-tests/S-16-4.6-brak-potwierdzenia-disconnect.md`
  (deleted in Phase 4)
- Convention: `src/components/molecules/confirm-dialog.tsx:19-21`, consumers at
  `src/components/organisms/setup/roster-editor.tsx:860,890`
- Counted-consent precedent: `src/lib/integrations/roster-store.ts:561-614`
- Demo rule, stated: `src/app/(app)/setup/team/actions.ts:51-61`;
  seam at `src/lib/demo/refusal.ts`
- Pure-sibling precedent: `src/components/organisms/demo/demo-panel-view.ts`
- Prior decisions: `context/archive/2026-08-23-team-management-surface/plan.md:530-533`,
  `context/archive/2026-08-26-sprint-reconciliation/plan.md:601-613`
- Roadmap: `context/foundation/roadmap.md:58,571,888-925`; successors S-26, S-27
  and Open Roadmap Question 4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Name the blast radius, and make the schema police it

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 The new guard fails when the declaration is wrong (drop `absence`, confirm red, restore)
- [x] 1.3 Type checking passes: `npm run typecheck`
- [x] 1.4 Linting passes: `npm run lint`

### Phase 2: One confirmation on all four paths

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Linting passes: `npm run lint`
- [ ] 2.4 E2E passes, including the four repaired hooks and the new cancel test: `npm run test:e2e`

#### Manual

- [ ] 2.5 `/setup/github` Disconnect opens a dialog naming repos and synced history; Cancel leaves the card unchanged
- [ ] 2.6 `/settings/connections` Jira dialog names the recorded absences and says they cannot be re-synced

### Phase 3: Demo stops reaching real data on Connections

#### Automated

- [ ] 3.1 Unit tests pass, including the new demo refusals: `npm test`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Integration tests pass: `npm run test:integration`
- [ ] 3.5 E2E passes: `npm run test:e2e`

#### Manual

- [ ] 3.6 In demo, Disconnect is disabled with a reason and the selection editors are not offered
- [ ] 3.7 Exiting and re-entering demo shows the same demo data, with demo edits intact

### Phase 4: Make every statement about Disconnect true

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Linting passes: `npm run lint`
- [ ] 4.4 Backlog reconciliation is clean: `node scripts/manual-test-sweep.mjs`
- [ ] 4.5 The deleted note is gone and no live document points at it
