# S-31 — Reconnect and Disconnect stop looking like the same decision — Implementation Plan

## Overview

The Connections card presents four controls of equal-or-lighter weight, three of
them named after mechanisms, and nothing on it says which one costs the lead
anything. This slice re-weights the row so the lossless route is the obvious
one, groups the card's controls by **job** rather than by mechanism, and moves
every string on the card into a pure, testable copy module — because the labels
themselves are staying as they are, which puts the entire job-naming burden on
the prose.

No schema change, no store change, no Server Action change. Copy, layout, and
the tests that hold both honest.

## Current State Analysis

**The card today** (`src/components/organisms/settings/integration-card.tsx`).
The connected branch renders, bottom-pinned: a `flex flex-wrap` row of
`Test connection` (`outline`) → `Reconnect` (`outline`) → `Disconnect` (`ghost`),
then the demo note, then `editSlot`. `editSlot` in its closed state is **not a
section** — it is one more `outline` button
(`jira-project-editor.tsx:102-107`, `repo-selection-editor.tsx:57-62`). So the
lead sees **four** controls, three of them visually interchangeable, and the
fourth — `Disconnect` — deliberately the lightest of all.

**The problem is narrower than "two buttons look alike", and it is not the one
the roadmap describes.** The third job is *already* named after the job:
`"Change monitored project"` (`jira-project-editor-copy.ts:37`) and
`"Change monitored repositories"` (`repo-selection-editor.tsx:59`). The defect
is that the correctly-named job is buried under three mechanism-named ones, and
that the safe route is one of three siblings rather than the obvious one.

**The lossless claim holds, but asymmetrically, and only under a condition.**

- **Jira, same project** — `storeJiraIntegration` upserts the credential with
  `id` omitted from the SET (`jira-store.ts:185-196`), and the `sprint` delete is
  gated on `projectChanged` (`jira-store.ts:205-211`, `:258-261`). Nothing is
  destroyed.
- **Jira, different project** — the same form, with a different project picked,
  deletes **a strictly smaller set than a disconnect does**, and the difference
  matters because the card is about to state it (plan-review F1). The credential
  is upserted, the `jira_project` row is upserted with `id` omitted so it
  SURVIVES (`jira-store.ts:211-235`), `status_mapping` is deleted and re-inserted
  from the submitted form so it is REPLACED rather than lost (`:262-270`), and
  only `sprint` is deleted, cascading `jira_ticket` / `jira_status_history` /
  `anomaly` (`:239-260`). That is `DISCONNECT_IMPACT.projectSwitch` exactly —
  **not** `DISCONNECT_IMPACT.jira`, which additionally destroys the project row
  and its mapping. `disconnect-impact.ts:161-169` names this conflation as the
  failure the module exists to end ("A THIRD root, not a subset of the Jira
  one"), so the card's Jira sentence reads `projectSwitch`. The promise is
  conditional and the card is the surface that will be making it.
- **GitHub** — since S-26, `disconnect(keep)` → reconnect with the same repo
  selection is *equivalent* to a resubmit: `monitored_repo.credential_id` is
  `ON DELETE SET NULL` and the repo write is a differential upsert
  (`github-store.ts:169-175`, `:177-202`). Here the two buttons genuinely are
  close to the same decision, and copy that claims otherwise would threaten a
  loss S-26 removed — the exact defect S-26 named in the dialog
  (`disconnect-confirm-copy.ts:74-78`).
- The concrete unrecoverable casualty of a Jira disconnect, which no sync
  rebuilds, is the FR-023 commitment freeze: `sprint.committedFrozenAt` /
  `committedSp` are re-frozen by the next sync at the *post-reconnect* ticket set
  (`run-sync.ts:907-917`, `sweep.ts:51-54`). Closed-sprint history is safe in
  every branch (`sweep.ts:65-67`).

**The card is the least-tested file in the area and the most about to change.**
Every string is an inline JSX literal; there is no `integration-card-copy.ts`,
unlike its two mature siblings. **No assertion anywhere covers** `"Reconnect"`,
`"Test connection"`, `"Not connected."`, the four status badges,
`"Connection is live"`, `"Connection test failed"` or `"Disconnect refused"`.
There is no component-test harness in this repo — no jsdom, no RTL — so the only
way any of this becomes assertable is a pure `.ts` sibling.

**The E2E suite runs nowhere automatically, and it does not cover this card.**
`.github/workflows/ci.yml` has `test`, `integration` and `bundle-size`;
`lefthook.yml` runs `vitest related`. **Corrected by plan-review F2**: this
paragraph claimed "about 20 assertions across five spec files touch these
surfaces and will break silently". Re-running `lessons.md` #9's grep says the
opposite — every connected-surface locator uses `{ exact: true }` on
`"Disconnect"` / `"Connect"`, so nothing this slice does breaks one, and **no
spec anywhere exercises the connected `/settings/connections` card**. The browser
layer is as blind to these strings as the unit layer is. That makes Phase 4
additive rather than a repair job; see its Overview for the per-file evidence.

## Desired End State

On `/settings/connections`, a lead whose token has just expired reads one
sentence naming the three things they might be here to do, each mapped to the
control that does it, and sees `Reconnect` as the single emphasised button with
a line underneath saying what re-submitting the form costs — unconditionally for
GitHub, and for Jira with the "same project" condition stated. That line names
`Change monitored project` as the control which **shows the cost before charging
it** — not as a cheaper route, because it is not one (plan-review F4:
`updateJiraProject` runs the same `delete(sprint)` cascade,
`connection-service.ts:444-451`, and offers a `clear` mode that additionally
deletes absences, `:453-458`; its advantage is the warning stage at
`jira-project-editor.tsx:110-145`). `Disconnect` remains the lightest control on
the card. The same `Reconnect` route now also exists on the two wizard
connection-status cards, where until now rotating a token required pressing
`Disconnect` first — carrying the `"wizard"` variant of the same promise, which
drops the clause naming a control that screen does not have.

Verification: `integration-card-copy.test.ts` passes and pins the prose against
`disconnect-impact.ts`; `npm run test:e2e` passes once, locally, with the new
connected-card assertions; the card and both wizard cards render the new row.

### Key Discoveries:

- The third job is already job-named — `jira-project-editor-copy.ts:37`,
  `repo-selection-editor.tsx:59` — and its closed state is a bare button, so
  promoting it into the action row is a wiring change, not a redesign.
- `DISCONNECT_IMPACT` (`src/lib/integrations/disconnect-impact.ts`) is held equal
  to the schema's FK graph by `disconnect-impact.test.ts`. Deriving the card's
  promise from `destroys` / `clears` means a future slice that hangs a cascading
  child under `sprint` or `monitored_repo` breaks this card's copy at build time
  instead of turning it into a lie.
- **The reconnect cost is a different root per integration, and the module is
  keyed for it** (corrected by plan-review F1). `DISCONNECT_IMPACT` is keyed
  `github | jira | projectSwitch`, so what a *reconnect* costs is
  `DISCONNECT_IMPACT.github.clears` for GitHub (deselecting a repo removes it and
  its history — `github-store.ts:176-202`) and
  `DISCONNECT_IMPACT.projectSwitch.destroys` for Jira. Both are already held
  equal to the schema's FK graph by `disconnect-impact.test.ts`, so the copy is
  still derived and still breaks at build time when the graph moves. What is NOT
  available is a single expression over `DISCONNECT_IMPACT[integration]`: the
  Jira answer lives under a key that is not an integration name, so the mapping
  is written out explicitly rather than inferred from a list's length.
- `getByRole`'s `name` is a case-insensitive **substring** match, which is why
  `disconnect-confirm-copy.test.ts:45-71` forbids any of the dialog's three
  strings being a substring of another. The action row is about to hold five
  labels on one screen; the invariant must extend across all of them.
- `<Button asChild><a>` ignores `disabled`, so in demo the trigger must be
  rendered as a real disabled `<button>` — already handled for Connect/Reconnect
  on the card (`integration-card.tsx:186-197`, `:274-289`), and the pattern the
  wizard cards must copy.

## What We're NOT Doing

- **Not renaming any button.** `Reconnect`, `Test connection` and `Disconnect`
  keep their labels (owner's decision, this session). The roadmap's "name the
  job instead of the mechanism" is delivered by the prose above and below the
  row, not by the labels. Consequence carried deliberately: the row mixes
  vocabularies — `Reconnect` (mechanism) beside `Change monitored project`
  (job) — and the intro sentence is what makes that legible. It is also what
  keeps the E2E churn to the labels that actually move.
- **Not changing the dialog.** S-24 settled consent, S-26 settled the two
  outcomes and the safe default. The dialog remains the gate; only the weight of
  the button that opens it changes — and it does not change, it stays `ghost`.
- **No schema, store, Server Action or migration change.** Forbidden here anyway
  (parallel worktree, `context/foundation/parallel-worktrees.md`).
- **Not changing what demo hides.** `editSlot` stays hidden in demo and
  `Test connection` / `Reconnect` / `Disconnect` stay disabled — S-27's rule
  ("anything that mutates or spends the REAL account"), untouched.
- **Not adding a Reconnect form to the wizard.** The wizard cards get a *link*
  to the existing settings route, which is why
  `settings/connections/github/page.tsx:22-27` says that route exists.
- **No live counts, no numbers in the copy.** S-24's decision; categories only.

## The reversal this plan makes, stated as one

S-24 recorded, in `What We're NOT Doing`
(`context/archive/2026-08-30-destructive-action-confirmation/plan.md:180-185`):

> "No visual re-weighting of the buttons. `integration-card.tsx:205` stays
> `variant="ghost"`; the wizard's Disconnect stays in the same `CardFooter` as
> Continue. **Owner's decision — the dialog is the gate.**"

**This plan reverses the first half and honours the second.** The reversal is
recorded here rather than slipped in, following the precedent of S-23 undoing
S-08's decision against an FTE column
(`context/archive/2026-08-25-absence-calendar/plan-brief.md:41`).

What makes the reversal coherent rather than contradictory: S-24's concern was
*do not make the destructive button loud*, and **Disconnect is already the
lightest control and stays that way**. What changes is that the *safe* route
stops being one of three equal-weight siblings. The dialog remains the gate —
S-24's own justification — and nothing in it is touched. S-26 then deferred this
exact question here by name (`disconnect-data-retention/plan.md:124-126`), which
is the licence this slice is spending.

The code comment at `integration-card.tsx:282-283` currently cites S-24's
decision as the reason `Disconnect` is `ghost`. It stays `ghost`, so the comment
stays — but it must now cite the *current* state of the decision, or the next
reader will find a comment that contradicts a `default`-variant sibling.

## Implementation Approach

Five phases, each independently verifiable. Phase 1 is pure and testable before
anything moves on screen; Phase 2 and 3 are the same change on two surfaces;
Phase 4 is the only thing that will ever run the E2E assertions this change
breaks; Phase 5 keeps the manual backlog equal to the plans.

## Critical Implementation Details

**The open editor panel and the wrapping row.** `editSlot` is a single node whose
closed state is a button and whose open state is a bordered block. Once it sits
inside the row's `flex flex-wrap`, the open block must carry `w-full` or it will
try to share a line with `Reconnect`. With `w-full` it wraps onto its own line
and `Disconnect` wraps below it — acceptable and arguably correct while a
project switch is in progress, but it is a real visual state and is on the
manual list rather than left to be discovered.

**Do not lift the editors' open state.** Splitting `editSlot` into a trigger prop
and a panel prop would give a cleaner row, at the cost of changing both editors'
public API and their internal `stage` machines. The `w-full` route buys the same
layout for two class names.

## Phase 1: The card's copy becomes a pure module

### Overview

Every string on `IntegrationCard` moves into a pure `.ts` sibling, joined by the
two new job-naming sentences, which are derived from `DISCONNECT_IMPACT` rather
than written by hand. Nothing changes on screen in this phase.

### Changes Required:

#### 1. The copy module

**File**: `src/components/organisms/settings/integration-card-copy.ts` (new)

**Intent**: Hold every word the card says, so the card becomes a renderer and the
new promise becomes assertable. Follows the two-layer house pattern exactly —
`disconnect-impact.ts` is the fact layer, this is the copy-assembly layer, and
`disconnect-confirm-copy.ts` is the sibling to imitate.

**Contract**: Reuses `DisconnectIntegration` and `integrationLabel` from
`disconnect-confirm-copy.ts` rather than minting a second vocabulary for the same
two integrations. Exports, grouped:

- *Labels* — `RECONNECT_LABEL`, `TEST_LABEL`, `TESTING_LABEL`,
  `DISCONNECT_LABEL`, `DISCONNECTING_LABEL`, `connectLabel(integration)`,
  `selectionEditorLabel(integration)` (`"Change monitored repositories"` /
  `"Change monitored project"`).
- *Status and identity* — `statusBadge(status: SyncStatus | null)` returning the
  existing `{ label, variant }` including the `null` → `"Not synced yet"` /
  `outline` case that today lives in JSX; `lastSyncDescription(iso)` absorbing
  `formatAt`; `NOT_CONNECTED_DESCRIPTION`.
- *Alerts* — `TEST_FAILURE_COPY`, `testSuccessDescription(integration, identity)`,
  and the three alert titles (`"Connection is live"`,
  `"Connection test failed"`, `"Disconnect refused"`).
- *Demo* — `demoNote(integration)`, the Polish sentence, unchanged in wording.
- **New** — `jobsIntro(integration)`: one sentence naming the three jobs and
  quoting the label of the control that does each one. Quoting the labels is not
  decoration: it is the same rule S-26 encoded at
  `disconnect-confirm-copy.ts:80-85`, and it lets the test hold prose and buttons
  equal so a later label edit cannot leave the sentence pointing at a control
  that no longer exists.
- **New** — `reconnectCost(integration, surface)`: what re-submitting the form
  costs, where `surface` is `"settings" | "wizard"` (plan-review F5). The
  routing clause quotes `selectionEditorLabel`, a control that exists **only**
  on `/settings/connections` — the wizard status cards' footers hold
  `Disconnect` and `Continue` and nothing else — so the `"wizard"` variant omits
  that clause and keeps the rest. This is the same rule as the label invariant
  one level up: a sentence must not name a control its reader cannot see. A
  pure-string test cannot catch a SURFACE mismatch, which is why the parameter
  exists rather than a comment.

  The body is shared by both surfaces and is **derived** from
  `DISCONNECT_IMPACT`, through an explicit per-integration
  source map rather than a branch on one entry's shape (plan-review F1). Write
  the map as a `const` beside the function with a comment naming each choice, so
  the judgement is visible instead of inferred:
  - **`jira` → `DISCONNECT_IMPACT.projectSwitch.destroys`.** Changing the project
    is what a reconnect can cost, and `projectSwitch` is the root that describes
    it — the project row and its status mapping survive a switch, so
    `DISCONNECT_IMPACT.jira` would overstate the loss. `projectSwitch.clears` is
    deliberately NOT used: the reconnect form takes no `mode`, so a switch made
    this way never deletes absences.

    **The clause naming `Change monitored project` says what that control is
    better AT, not that it is cheaper** (plan-review F4). It costs the same
    `projectSwitch` set — same root, same fragments, which is why one source
    entry serves both — and its `clear` mode can cost more. What it has is a
    warning stage that states the cost before charging it. Word the clause so it
    routes without promising a saving.
  - **`github` → `DISCONNECT_IMPACT.github.clears`.** There is no cascade loss to
    report (`github.destroys` is `[]`), so the sentence says re-submitting
    replaces the token and names the one loss that is real — caused by
    deselecting a repository, not by reconnecting.

  **One clause of the Jira sentence is NOT derived, and says so** (plan-review
  F3). The FR-023 commitment freeze is the casualty the Current State Analysis
  calls unrecoverable, and nothing derived from `DISCONNECT_IMPACT` can name it:
  it is a re-computation of `sprint.committedFrozenAt` / `committedSp` at the
  post-reconnect ticket set (`run-sync.ts:907-917`, `sweep.ts:51-54`), not a
  table in the FK graph. Add it to the Jira branch as one hand-written clause,
  declared as such in a comment above the constant that holds it, citing those
  two files. A silently hand-written clause inside a module whose header claims
  everything is derived is how the next reader stops trusting either half.

  Use `joinClauses` for every enumeration so this card reads identically to the
  dialog and the project-switch warning.

**Note on `SyncStatus`**: it is imported from `@/lib/integrations/failure-reason`,
which is already client-safe (`integration-card.tsx` imports it today). Do not
import anything from `@/db/schema` — `disconnect-impact.ts` documents why
(browser bundle).

#### 2. `"Change monitored repositories"` leaves the editor

**File**: `src/components/organisms/settings/repo-selection-editor.tsx`

**Intent**: The GitHub trigger label is an inline literal while its Jira twin is
already a module export. From Phase 2 both are action-row labels covered by the
substring invariant, so both must be reachable from one place.

**Contract**: The closed-state button renders
`selectionEditorLabel("github")`. `PROJECT_SWITCH_TRIGGER_LABEL` in
`jira-project-editor-copy.ts` stays where it is and becomes what
`selectionEditorLabel("jira")` returns — re-exported, not duplicated, so
`jira-project-editor-copy.test.ts:62` keeps passing against one string.

#### 3. The copy test

**File**: `src/components/organisms/settings/integration-card-copy.test.ts` (new)

**Intent**: This is new test writing, not test updating — nothing covers these
strings today. It has three jobs: hold the assembled prose readable, hold it
equal to the fact module, and extend the label invariant across the whole screen.

**Contract**: Hermetic (`npm test` project — no DB, no jsdom). Assertions:

1. **Label invariant, screen-wide.** Collect every label that can appear on one
   Connections screen — `RECONNECT_LABEL`, `TEST_LABEL`, `DISCONNECT_LABEL`,
   `connectLabel(x)`, `selectionEditorLabel(x)` for both integrations, plus
   `disconnectKeepLabel` / `disconnectClearLabel` / the dialog trigger — and
   assert no member is a case-insensitive substring of another, in either
   direction. Same shape as `disconnect-confirm-copy.test.ts:45-71`, widened;
   cite that test in a comment so the two are read together.
2. **`jobsIntro` quotes all three control labels verbatim**, for both
   integrations.
3. **`reconnectCost("jira")` states the condition and names the escape route** —
   contains `selectionEditorLabel("jira")`, and contains at least one
   `DISCONNECT_IMPACT.projectSwitch.destroys` fragment verbatim. It must ALSO
   contain **no** `DISCONNECT_IMPACT.jira.destroys` fragment that is absent from
   `projectSwitch.destroys` — that negative half is the assertion that catches
   the wrong-root conflation (plan-review F1), and its comment cites
   `disconnect-impact.ts:161-169`. It must ALSO not present the editor as the
   cheaper route (plan-review F4): assert the sentence carries no comparative
   framing around `selectionEditorLabel("jira")` — a fixed list of the words that
   would make it one (`instead`, `safely`, `without losing`, `avoid`) is absent.
4. **`reconnectCost("github")` threatens no loss S-26 removed** — asserts it
   names no unconditional destruction, and that the loss it does name is a
   `DISCONNECT_IMPACT.github.clears` fragment attributed to deselecting. Comment
   must cite `disconnect-confirm-copy.ts:74-78` as the reason this assertion
   exists.
5. **Fragment sync** — every clause either sentence quotes is `.includes()`
   present in **that sentence's own source entry** (`projectSwitch` for Jira,
   `github` for GitHub — the map from the contract above, not
   `DISCONNECT_IMPACT[integration]`), so editing a fragment breaks here rather
   than drifting.
6. **`statusBadge` is total** — every `SyncStatus` plus `null` yields a non-empty
   label and a valid variant.
7. **The `"wizard"` variant quotes no label absent from the wizard**
   (plan-review F5) — for both integrations,
   `reconnectCost(x, "wizard")` contains neither `selectionEditorLabel(x)` nor
   `TEST_LABEL`, while `reconnectCost(x, "settings")` still contains
   `selectionEditorLabel(x)`. Both directions, so neither variant can quietly
   become the other.
8. **`reconnectCost("jira", …)` names the commitment freeze** (plan-review F3) —
   contains the hand-written clause, asserted against the exported constant that
   holds it rather than against a literal, so the sentence and the clause cannot
   drift apart. Comment cites `run-sync.ts:907-917` as the behaviour it
   describes and states that this is the one clause the FK graph cannot guard.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- `integration-card-copy.test.ts` fails if a `DISCONNECT_IMPACT` fragment is
  edited without the card copy following (verify by hand-editing a fragment,
  observing red, reverting)

#### Manual Verification:

- None. Nothing changes on screen in this phase.

---

## Phase 2: The card becomes three jobs, one of them obvious

### Overview

`IntegrationCard` consumes the module and the connected branch is re-laid-out:
diagnostics above, one row of three jobs, the promise underneath.

### Changes Required:

#### 1. The card

**File**: `src/components/organisms/settings/integration-card.tsx`

**Intent**: Re-weight and regroup, and reduce the file to a renderer holding no
string literals.

**Contract**: `STATUS_BADGE`, `formatAt`, `TEST_FAILURE_COPY` and `DemoNote`'s
text are deleted here and imported from the copy module. The connected branch's
bottom block becomes, in DOM order:

1. `Test connection` — `variant="outline"`, unchanged behaviour, moved **above**
   the jobs row. It is not a job; it answers *"is my token valid right now"*,
   which is the question that leads to Reconnect. **It stays INSIDE the `mt-auto`
   block (`integration-card.tsx:263`), as that block's first child** — not up in
   the `flex-1` alerts region (plan-review F6). Moving it out of the bottom-pin
   is what makes the two cards' action blocks stop lining up when one has an
   alert and the other does not, which is the failure the comment at `:260-262`
   records and which criterion 2.10 checks.
2. `jobsIntro(integration)` as a `<p className="text-sm text-muted-foreground">`.
3. The jobs row, `flex flex-wrap gap-2`, in this order:
   `Reconnect` (**`variant="default"`** — the change this slice exists for,
   still a link, still a real disabled `<button>` in demo) →
   `editSlot` → `Disconnect` (**stays `variant="ghost"`**).
4. `reconnectCost(integration)` as a second muted `<p>`, directly under the row
   so it qualifies the primary control.
5. `demoNote` when `isDemo` — stays **under the buttons**, which is what backlog
   row 16.C pins.

The comment at `:282-283` is rewritten to record the reversal: `ghost` is kept
for S-24's reason, and S-31 promoted the sibling rather than demoting this one.
Point it at this plan's "The reversal this plan makes" section.

`editSlot` remains a single `ReactNode` prop and remains hidden in demo — no prop
change, no change to `connections/page.tsx`.

#### 2. The two editors' open state

**Files**: `src/components/organisms/settings/repo-selection-editor.tsx`,
`src/components/organisms/settings/jira-project-editor.tsx`

**Intent**: Inside a wrapping row, the open panel must claim its own line.

**Contract**: **Five** open-state containers gain `w-full`, enumerated because a
missed one is a panel trying to share a line with `Reconnect` — the exact defect
this item exists to prevent (plan-review F7):

- `repo-selection-editor.tsx:66` — the `rounded-lg border p-4` wrapper (`:64` is
  the `return`, not the container).
- `jira-project-editor.tsx:112` (`warning` stage), `:149` (`discarded`), `:182`
  (`project` picker), `:206` (the status-mapping stage the function falls
  through to). There is no cadence stage in this component; all four are
  `rounded-lg border p-4` blocks and all four can be the open state.

No behaviour change.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- No string literals remain in the card's render path: `npm run lint` plus a
  reviewer grep for quoted user-facing text in `integration-card.tsx`

#### Manual Verification:

- On `/settings/connections` with both integrations connected, each card shows
  one emphasised `Reconnect`, a lighter `Change monitored …`, and the lightest
  `Disconnect`; `Test connection` sits above the sentence, not in the row.
- The intro sentence names all three controls by their exact on-screen labels.
- Under the Jira row, the promise states the "same project" condition and points
  at `Change monitored project`; under the GitHub row it does **not** claim
  commits or PRs are lost by reconnecting.
- Opening `Change monitored project` / `Change monitored repositories` puts the
  panel on its own full-width line and pushes `Disconnect` below it; closing it
  restores the three-across row.
- In demo the row shows two disabled controls and the Polish note still sits
  **under the buttons**.
- The two cards still line their action blocks up with each other when one has
  an alert and the other does not.
- The Jira promise names the commitment freeze as a cost of changing the project,
  and does **not** read as though `Change monitored project` is the cheaper way
  to do it (plan-review F3 / F4).

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: The wizard stops making Disconnect the only way to rotate a token

### Overview

`/setup/github` and `/setup/jira` have no reconnect control at all; the only way
to replace a token there is `Disconnect` first, which on Jira is the destructive
path that costs the commitment freeze. They get the same route the settings card
already has.

### Changes Required:

#### 1. Both wizard status cards

**Files**: `src/components/organisms/setup/github-connection-status.tsx`,
`src/components/organisms/setup/jira-connection-status.tsx`

**Intent**: Give the wizard the lossless route, and stop `Disconnect` being the
heaviest-weight control in a footer where it is the most destructive one.

**Contract**: In `CardFooter`, the left cluster becomes `Reconnect`
(`variant="outline"`, `asChild` link to `/settings/connections/{github,jira}`,
rendered as a real disabled `<button>` when `isDemo`) followed by `Disconnect`
demoted from `outline` to **`ghost`**. `Continue` stays `variant="default"` —
the wizard's job is to move forward. Labels come from the Phase 1 module, so the
substring invariant already covers them.

`CardContent` gains `reconnectCost(integration, "wizard")` as a muted line, so
the wizard makes the same promise the settings card makes and the two cannot
drift. The `"wizard"` variant is what drops the clause quoting
`Change monitored project` — that control is not on this screen (plan-review
F5), and a promise naming a button the reader cannot see is the same defect as
one naming a button that no longer exists.

Leaving the wizard's route pointing at `/settings/connections/*` rather than
building a form here is deliberate and is the reason that route exists
(`settings/connections/github/page.tsx:22-27`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- On `/setup/github` and `/setup/jira` with the integration connected, the footer
  offers `Reconnect` and a visibly lighter `Disconnect`, with `Continue` still
  the emphasised control.
- `Reconnect` lands on the settings connect form with the heading
  `Reconnect GitHub` / `Reconnect Jira`, and `Back to connections` returns.
- In demo both `Reconnect` and `Disconnect` are disabled and not navigable.
- The wizard's promise line names **no** control that is not on that screen — in
  particular it does not mention `Change monitored project` (plan-review F5).

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: E2E coverage for the card nothing tests, and the one run that will ever happen

### Overview

**Corrected by plan-review F2.** This phase was written as a repair job on
"about 20 assertions across five spec files". Re-running `lessons.md` #9's grep
against the suite says otherwise, and the correction changes what the phase is
for rather than only its size:

- **No existing assertion breaks.** Every locator on a connected surface uses
  `{ exact: true }` on `"Disconnect"` / `"Connect"` (`e2e/disconnect.ts:54,68`,
  `setup-github.spec.ts:104,125,130,160`), and Phase 3's new control is a link
  named `Reconnect` — it matches none of them.
- **`setup-github.spec.ts`'s "three controls" is not a footer.** It is at
  `:167-183`, scoped to `dialog.getByRole(...)`, and it is S-26's mutual
  non-containment guard, written deliberately WITHOUT `exact`. It must not be
  touched. `:104` is the Cancel test clicking Disconnect and `:112-117` are
  `toContainText` assertions on S-26 dialog copy this slice does not change.
- **`demo-boundary.spec.ts` never visits `/setup/github` or `/setup/jira`.** It
  visits `/setup` (the doorstep) and then `/settings/connections` in the
  NOT-connected branch. `dashboard-sprint-detail.spec.ts:200-262` is the same.
  Neither Phase 2 nor Phase 3 touches that branch.
- **Nothing in the suite exercises the connected `/settings/connections` card
  at all** — which is why every string this slice moves was uncovered to begin
  with (Current State Analysis said so about the unit layer; it is equally true
  of the browser layer).

So this phase is **additive**. The repair list starts empty; the deliverable is
the coverage that does not exist. CI runs no E2E job and no hook runs one, so
the single local run is still the only thing that will ever execute these
assertions — old or new.

### Changes Required:

#### 1. The shared helper first

**File**: `e2e/disconnect.ts`

**Intent**: Highest leverage in the suite — four specs route through it
(`:54`, `:65`, `:68`).

**Contract**: `getByRole("button", { name: "Disconnect", exact: true })` must
still resolve uniquely now that a `Reconnect` sibling sits beside it in the
wizard footer. Verified during this review: it does — `Reconnect` renders as a
link outside demo and as a `<button>` named `Reconnect` inside it, and neither
matches `{ name: "Disconnect", exact: true }`. **The expected outcome of this
step is therefore no edit.** Re-check the file against the new DOM anyway before
the run; if a locator does move, it is the first thing to know.

#### 2. New coverage for the connected settings card

**File**: a new `e2e/connections-card.spec.ts`, or a `describe` block added to an
existing spec that already reaches a connected state — whichever costs less
fixture setup; the connected state needs `e2e/github-fixture-server.mjs`, so
extending `setup-github.spec.ts` is the cheaper of the two and is the default.

**Intent**: Pin the three things this slice exists to produce, none of which any
assertion covers today.

**Contract**: On `/settings/connections` with GitHub connected, assert:
- all three job labels are present — `Reconnect`, `Change monitored repositories`,
  `Disconnect` — each resolving to exactly one node on the GitHub card;
- `Test connection` is outside the jobs row (assert on DOM order or on the row's
  own accessible grouping, not on CSS classes — the house locator rule forbids
  selectors);
- the promise line is on screen and carries the fragment `reconnectCost` derives,
  so a copy-module regression that the hermetic test cannot see (a sentence
  assembled but never rendered) still turns something red.

Do **not** assert on `variant`/class names for the re-weighting — that is a
manual row (2.5), not a browser assertion.

#### 3. The four existing specs — read, do not edit

**Files**: `e2e/setup-github.spec.ts`, `e2e/setup-jira.spec.ts`,
`e2e/demo-boundary.spec.ts`, `e2e/dashboard-sprint-detail.spec.ts`

**Contract**: The repair list is **empty** as of this review. Leave every
assertion alone — in particular `setup-github.spec.ts:167-183`, which is S-26's
non-containment guard and whose `toHaveCount(1)` calls are deliberately
non-`exact`. If the Phase 4 run turns one of these red, that is a regression to
fix in the code, not in the spec; record which one and why before changing a
line of test.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full E2E suite passes: `npm run test:e2e` — **run once, locally, only after
  confirming the other worktree session is idle and port 3000 is free.**
  `context/foundation/parallel-worktrees.md` forbids two concurrent suites, not
  one; `context/foundation/lessons.md` #9 is why this gate exists at all.

#### Manual Verification:

- The owner confirms the other session was idle for the duration of the run.

**Implementation Note**: pause here for manual confirmation before Phase 5.

---

## Phase 5: The manual backlog is brought back to equal

### Overview

`CLAUDE.md` requires `node scripts/manual-test-sweep.mjs` at the closing phase,
and this slice both invalidates existing rows and creates new ones. Research also
turned up one stale row that contradicts another.

### Changes Required:

#### 1. The slice's own short list

**File**: `context/changes/reconnect-affordance/MANUAL-CHECKLIST.md` (new)

**Intent**: 3–5 rows, only what blocks the slice. Each carries the four things —
where, what to do, what must be true, why it matters — signed off with the phase
number.

**Contract**: Candidate rows: the re-weighted settings row and its two promises
(GitHub unconditional / Jira conditioned); the open-editor wrap; the wizard's new
`Reconnect` reaching the settings form; the demo state of the new row.

#### 2. The one list

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: A row missing here does not exist for the second tester.

**Contract**: Three edits.
- **New section** for S-31 with the deferred rows this slice does not put on its
  own short list.
- **Row 16.C** is rewritten: it pins the demo card's layout ("a Polish sentence
  *under the buttons*" plus an enumeration of what is disabled). The sentence
  stays under the buttons, but the buttons moved and the note has not enumerated
  controls since S-27 — the pass condition must match what the card now does.
- **Row 15.C is stale and contradicts 16.A**: it instructs the tester to click a
  dialog button named `"Disconnect GitHub"`, which S-26 removed and which 16.A
  now asserts must **not** exist. It moves to §6 with the reason, and its live
  half — that disconnecting from `/settings/connections/github` must not bounce
  the lead to `/setup` — is reopened as a new row under S-31, which is also the
  slice that makes that path matter more.

Nothing in `context/archive/` is edited: no *ticked* row is invalidated by this
slice, so the one licensed archive write does not apply here.

#### 3. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: S-31's row says `proposed`.

**Contract**: Flip to the status this repo uses for a shipped slice, matching how
S-26 and S-24's rows read today.

### Success Criteria:

#### Automated Verification:

- Sweep is clean: `node scripts/manual-test-sweep.mjs` exits zero
- Linting passes: `npm run lint`

#### Manual Verification:

- The owner reads the new `MANUAL-CHECKLIST.md` rows and confirms each is
  actionable without asking a question back.

---

## Testing Strategy

### Unit Tests:

- `integration-card-copy.test.ts` — the eight assertion groups in Phase 1. The
  load-bearing ones are the screen-wide substring invariant (a real, encoded
  hazard, not a style preference) and the fragment-sync assertions that keep the
  card from outliving the FK graph it describes.
- Existing `disconnect-confirm-copy.test.ts` and `disconnect-impact.test.ts` must
  keep passing untouched — if either goes red, the slice has reached into S-24 or
  S-26's decisions, which it is not licensed to do.

### Integration Tests:

- None. No store, Server Action or schema change; `connections.integration.test.ts`
  pins the `getConnectionsOverview` data contract, not rendered text, and must
  keep passing unedited.

### Manual Testing Steps:

1. `/settings/connections`, both integrations connected: confirm one emphasised
   `Reconnect` per card, `Disconnect` lightest, `Test connection` out of the row.
2. Read both promise lines; confirm the Jira one names its condition and the
   GitHub one does not threaten a loss.
3. Open and close each selection editor; confirm the panel takes its own line.
4. `/setup/jira` with Jira connected: confirm `Reconnect` exists and reaches the
   settings form without disconnecting first.
5. Load demo, revisit `/settings/connections`: confirm the controls are disabled
   and the Polish note is still under the buttons.

## Performance Considerations

None. The copy module is pure string assembly evaluated per render on data
already in the component; `disconnect-impact.ts` imports nothing from the schema
and stays out of the browser bundle's Drizzle path by construction.

## Migration Notes

None — no data is touched. The only forward-compatibility concern is the one the
Phase 1 test encodes: a future slice that changes the FK graph must update
`DISCONNECT_IMPACT`, and the card's copy now breaks the build when it does.

## References

- Research: `context/changes/reconnect-affordance/research.md`
- The finding this slice exists to fix: `context/archive/2026-08-30-disconnect-data-retention/frame.md:55`
- The explicit deferral to S-31: `context/archive/2026-08-30-disconnect-data-retention/plan.md:124-126`
- The decision this plan reverses: `context/archive/2026-08-30-destructive-action-confirmation/plan.md:180-185`
- The precedent for recording a reversal: `context/archive/2026-08-25-absence-calendar/plan-brief.md:41`
- The copy-module pattern to imitate: `src/components/molecules/disconnect-confirm-copy.ts`
- The label invariant to widen: `src/components/molecules/disconnect-confirm-copy.test.ts:45-71`
- Why one local E2E run is permitted: `context/foundation/lessons.md` #9, `context/foundation/parallel-worktrees.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The card's copy becomes a pure module

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Copy test goes red when a `DISCONNECT_IMPACT` fragment is edited alone

### Phase 2: The card becomes three jobs, one of them obvious

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Linting passes: `npm run lint`
- [ ] 2.4 No user-facing string literals remain in `integration-card.tsx`

#### Manual

- [ ] 2.5 Settings card shows one emphasised `Reconnect`, lightest `Disconnect`, `Test connection` out of the row
- [ ] 2.6 Intro sentence names all three controls by their exact on-screen labels
- [ ] 2.7 Jira promise states the "same project" condition; GitHub promise threatens no loss S-26 removed
- [ ] 2.8 Open selection editor takes its own full-width line; closing restores the row
- [ ] 2.9 In demo the row is disabled and the Polish note is still under the buttons
- [ ] 2.10 The two cards' action blocks stay aligned when only one has an alert
- [ ] 2.11 Jira promise names the commitment freeze and does not frame `Change monitored project` as cheaper

### Phase 3: The wizard stops making Disconnect the only way to rotate a token

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 Wizard footer offers `Reconnect` with a lighter `Disconnect` and `Continue` still emphasised
- [ ] 3.5 `Reconnect` lands on the settings connect form and `Back to connections` returns
- [ ] 3.6 In demo both wizard controls are disabled and not navigable
- [ ] 3.7 The wizard promise line names no control absent from that screen

### Phase 4: E2E coverage for the card nothing tests, and the one run that will ever happen

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Linting passes: `npm run lint`
- [ ] 4.4 Full E2E suite passes: `npm run test:e2e` (single local run, other session idle)

#### Manual

- [ ] 4.5 Owner confirms the other worktree session was idle for the run

### Phase 5: The manual backlog is brought back to equal

#### Automated

- [ ] 5.1 Sweep is clean: `node scripts/manual-test-sweep.mjs`
- [ ] 5.2 Linting passes: `npm run lint`

#### Manual

- [ ] 5.3 Owner confirms each new `MANUAL-CHECKLIST.md` row is actionable without a question back
