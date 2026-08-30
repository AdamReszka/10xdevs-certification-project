# S-27 — The demo boundary is a gate, not a convention — Implementation Plan

## Overview

Close the demo↔real boundary as something the code enforces rather than something
a comment asserts. Five Server Actions that pin the REAL owner carry no `isDemo`
check, so a lead viewing demo can overwrite their real GitHub or Jira credential
in three clicks. Above them, no route refuses to render; below them, three copy
surfaces tell the lead a guarantee that is not yet true. This plan lands the
refusals, the route guards, the one-time-only demo lifecycle, honest copy, and a
CI-checked rule so the sixth omission fails the build instead of shipping.

## Current State Analysis

Demo is **tenancy, not a flag**: a second synthetic `user` row (`demo_of` →
the real row) owns the demo world, `user.active_workspace` selects the mode, and
`user.demo_anchor_at` freezes the clock. Because demo is a second owner, most
write actions need no guard at all — they resolve through `resolveWorkspace()`,
land under the demo owner, and die with it. Only actions that deliberately break
tenancy to reach the real account need a gate.

- `requireRealWorkspace()` (`src/lib/workspace.ts:177-180`) is four lines:
  `requireSession()` + return `{ ownerId }`. It never consults
  `active_workspace`. Its doc comment states the intent — "integration
  configuration is never simulated" — and that intent is correct. The bug is that
  it was read as "therefore safe": whether the wizard targets the real account
  and whether a demo screen may reach it are independent properties.
- **`requireRealWorkspace()` without `isDemo` is therefore the signature of the
  defect, and it is a grep.** Five actions match and are unguarded:
  `storeGithubIntegration` (`setup/github/actions.ts:136`), `validateGithubToken`
  (`:96`), `storeJiraIntegration` (`setup/jira/actions.ts:215`),
  `validateJiraCredentials` (`:131`), `fetchProjectStatuses` (`:170`). Twelve
  other actions already refuse; the four demo-lifecycle actions
  (`settings/demo/actions.ts:58,81,111,136`) pin the real owner deliberately and
  are correct exceptions.
- **The shortest attack path is not the wizard.** Nav → Settings → Connections →
  **Reconnect** is three clicks and lands on
  `settings/connections/github/page.tsx`, which imports only
  `requireRealWorkspace` (`:9,32`) and renders the connect form unconditionally
  by design (`:21-26`). Its `/setup/github` sibling *does* read `isDemo`
  (`setup/github/page.tsx:25`). The Reconnect control itself
  (`integration-card.tsx:230-232`) is the one control on the card without
  `isDemo` in its predicate, between Test (`:225`) and Disconnect (`:238`), which
  both have it.
- **The doorstep rebuilds the demo world.** `setup-doorstep.tsx:47` calls
  `loadDemoAction()` unconditionally, and `loadDemo` starts with `resetDemo`
  (`load.ts:66-68`) to stay idempotent. The `/settings/demo` panel is protected
  from this by `allowedTransitions` (`demo-panel-view.ts:36-45`), which offers
  `load` only from `no_demo`; the doorstep got the action without that guard. So
  enter demo → Back to `/setup` → press the demo door again = a fresh world and
  the visitor's demo edits gone.
- **Three copy surfaces are false or misleading**: `demo-panel-view.ts:65-67`
  still carries "Twoje prawdziwe dane są nietknięte" — verbatim the sentence S-24
  retracted from the banner in `f714911`; `demo-banner.tsx:101-105` was narrowed
  by S-24, its own comment (`:90-100`) naming S-27 as the restore condition;
  `demo-panel.tsx:113-118` opens "Demo nie dotyka Twoich integracji" over an
  enumeration that omits connecting a credential, under a comment claiming the
  list is "exhaustive on purpose".
- **Reset fires without confirmation.** `resetDemoAction` removes the demo owner
  row and 25 cascading FKs take the subtree; `demo-panel.tsx:85-98` fires it from
  a bare click, while every other irreversible action in the app goes through
  `molecules/confirm-dialog.tsx`.
- Not broken, do not touch: `exitDemoAction` (`settings/demo/actions.ts:110-125`)
  is one `UPDATE` and deletes nothing; the banner's exit-then-navigate ordering
  (`demo-banner.tsx:71-82`) is correct; cron already excludes demo owners
  (`sync/scheduled.ts:66-73`).

## Desired End State

A lead viewing demo cannot reach a mutation of the real account by any route:
the five actions refuse server-side, the five pages that host them redirect, and
the Reconnect control is disabled like its neighbours. Closing the wizard from
demo does not strand the visitor in it: the doorstep's configure door leaves demo
and then opens the wizard, so the way back that FR-008 requires still works. The demo world is built
once and survives every exit and re-entry; the only thing that destroys it is the
explicitly-labelled "Usuń dane demo", behind a confirmation naming what goes and
what stays. Every demo copy surface carries one general sentence that stays true
when a sixth action is added. A hermetic test fails the build when an action
calls `requireRealWorkspace()` without an `isDemo` guard and without an entry on
an explicit exception list.

Verified by: `npm test` (unit + the new `*.demo.test.ts` files + the inventory
test), `npm run test:integration` (demo world survives exit/re-entry),
`npm run test:e2e` (the connect route redirects in demo), and the five blocking
rows in `MANUAL-CHECKLIST.md` (1.5, 2.5, 2.6, 3.4, 4.4).

### Key Discoveries

- The fix shape already exists in the repo five times:
  `Promise.all([requireRealWorkspace(), resolveWorkspace()])`, `ownerId` from the
  first, `isDemo` from the second, then `demoRefusal()`. See
  `settings/connections/actions.ts:49-55`, `setup/github/actions.ts:189-192`,
  `setup/jira/actions.ts:271-274`, `setup/team/actions.ts:181-187`,
  `sync/actions.ts:96-99`.
- **The second resolver call is free.** `resolveWorkspace` is `cache()`-wrapped
  (`workspace.ts:110`) and, since S-21, `getDb` memoizes one handle per request
  context. The S-24 impl-review F2 concern (a `pg.Pool` per `resolveWorkspace()`)
  does not apply — the comment at `workspace.ts:150-157` records the supersession.
- All five unguarded actions already return a `... | ActionFailure` union, so
  each takes `demoRefusal<TheirErrorType>()` and adds `"demo_mode"` to its own
  error union — the same widening S-24 did, not the standalone `DemoRefusal` type.
- **A `/setup` segment layout would swallow the doorstep.** `/setup` must stay
  reachable in demo — after D1 its demo door is how a visitor re-enters, and
  `demo-banner.tsx:71-82` sends the un-onboarded lead there. So the guard belongs
  on the three wizard STEP pages, which already hold `isDemo` in hand
  (`setup/{github,jira,team}/page.tsx`), plus the two Connections pages, which
  do not. Same coverage as a layout guard, one line per page, no route-structure
  refactor. The "easy to miss the fifth page" cost of that shape is paid off by
  Phase 5, which extends the inventory rule to pages.
- `ConfirmDialog` (`molecules/confirm-dialog.tsx`) takes `title`, `description`
  (React node — "say what disappears and what survives"), `confirmLabel`,
  `variant`, async `onConfirm`, and either a `trigger` or controlled
  `open`/`onOpenChange`. `integration-card.tsx:243-248` is the controlled
  precedent.
- The `*.demo.test.ts` idiom is settled and its richest form is
  `settings/connections/actions.demo.test.ts:65-73`: `vi.hoisted()` mocks, both
  resolvers replaced, `@opennextjs/cloudflare` and `@/lib/db` mocked to **throw**,
  an `it.each` table, and a **negative control** (`inDemo(false)` →
  `rejects.toThrow`) so an always-refusing guard fails the test.

## What We're NOT Doing

- **Not touching the ~20 actions that resolve through `resolveWorkspace()` alone**
  (dashboard, absences, anomalies, roster/cadence CRUD). Their writes are
  demo-scoped by construction; "fixing" them would break demo editing.
- **Not changing `exitDemoAction`.** It already deletes nothing. D2 is a property
  to lock in with a test, not code to write.
- **Not removing the reset control.** US-02's acceptance criterion
  (`prd.md:83`) requires it, and it is the only way back to `no_demo`.
- **Not making `resetDemo` reload.** Reset returns the account to "no demo"; the
  next entry builds a fresh world with a new `demo_anchor_at`.
- **No middleware changes.** `middleware.ts:13-17` states it is not the security
  boundary; keeping demo out of it preserves that.
- **No new demo fixture content, no changes to `buildDemoFixture`.**
- **Not renaming the "Usuń dane demo" label.** The label is accurate; the
  confirmation is what was missing.

## Implementation Approach

Bottom-up, so each phase is independently shippable and the load-bearing half
lands first. Phase 1 is the boundary — server refusals, which hold even with
every UI control removed. Phase 2 is the courtesy layer above it: pages that
refuse to render and a control that refuses to invite. Phase 3 fixes the demo
lifecycle so entering demo twice stops destroying the world. Phase 4 makes the
sentences true, which is only possible once 1–3 have landed. Phase 5 turns the
rule from a comment into a CI check, last, so its exception list is final.

## Phase 1: Server-side refusals in the five unguarded actions

### Overview

The boundary itself. Each of the five actions gains the established
two-resolver guard and returns `demoRefusal()` in demo, with a `*.demo.test.ts`
sibling carrying the negative control.

### Changes Required

#### 1. GitHub setup actions

**File**: `src/app/(app)/setup/github/actions.ts`

**Intent**: `validateGithubToken` (`:93-96`) and `storeGithubIntegration`
(`:132-136`) must refuse in demo. The first spends the real session against the
live GitHub API with a pasted token; the second writes `github_credential` and
the `monitored_repo` set for the REAL owner, replacing whatever was connected.

**Contract**: Replace the bare `requireRealWorkspace()` with the two-resolver
pattern already used by `disconnectGithub` in the same file (`:188-193`); widen
`ValidateResult` and `StoreResult`'s `ActionFailure` error union with
`"demo_mode"` and return `demoRefusal<…>()`. `ownerId` still comes from
`requireRealWorkspace()` — the target owner is unchanged, only reachability is.

#### 2. Jira setup actions

**File**: `src/app/(app)/setup/jira/actions.ts`

**Intent**: `validateJiraCredentials` (`:126-131`), `fetchProjectStatuses`
(`:164-170`) and `storeJiraIntegration` (`:210-215`) must refuse in demo. The
store is the widest blast radius in the slice: changing the monitored project
cascades into real sprints, tickets, status history and anomalies — the same
radius `updateJiraProject` and `disconnectJira` are already guarded against.

**Contract**: Same pattern, mirroring `disconnectJira` (`:270-275`). Three error
unions widened with `"demo_mode"`.

#### 3. Refusal tests

**File**: `src/app/(app)/setup/github/actions.demo.test.ts` (extend),
`src/app/(app)/setup/jira/actions.demo.test.ts` (extend)

**Intent**: Both files exist (S-24, covering the disconnects). Add the new
actions to their `it.each` tables so the demo dimension covers every action in
the module, keeping the `inDemo(false)` negative control.

**Contract**: Follow `settings/connections/actions.demo.test.ts:65-73`. The
Cloudflare-context and `@/lib/db` mocks must throw, so "no side effect happened"
is proven by the call returning at all. Also assert the delegate service was not
called (`expect(service).not.toHaveBeenCalled()`).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass, including the extended demo suites: `npm test`
- Each of the five actions returns `error: "demo_mode"` in demo and reaches the
  service when not in demo (negative control green)

#### Manual Verification

- In demo, every route to a connect form is closed — `/setup/github`,
  `/setup/jira` and `/settings/connections/github` all land back on their parent
  — and the real credential's last4 on `/settings/connections` is unchanged
  afterwards. (Checked WHILE Phase 1 is the only thing landed, the form is still
  reachable and shows the refusal in place; the row is worded for the state the
  tester will actually meet, after the whole slice.)

---

## Phase 2: Route guards and the Reconnect control

### Overview

Above the refusals: the five pages that host the refused actions redirect in
demo, and the Reconnect control stops inviting a click that cannot succeed.
Redirects land on the nearest parent, which already explains why.

### Changes Required

#### 1. Connections connect/reconnect pages

**File**: `src/app/(app)/settings/connections/github/page.tsx`,
`src/app/(app)/settings/connections/jira/page.tsx`

**Intent**: These are paths A and B — the shortest route to overwriting a real
credential from a demo screen. Neither reads `isDemo` today.

**Contract**: Add `resolveWorkspace()` alongside the existing
`requireRealWorkspace()` and `redirect("/settings/connections")` when `isDemo`.
The Connections card already renders disabled controls plus the explanation, so
the redirect answers "why can't I" without new copy. Keep the existing
`requireRealWorkspace()` read for `ownerId`.

#### 2. Wizard step pages

**File**: `src/app/(app)/setup/github/page.tsx`,
`src/app/(app)/setup/jira/page.tsx`, `src/app/(app)/setup/team/page.tsx`

**Intent**: Path C — Back to `/setup` from demo, then the configure door. All
three already call `resolveWorkspace()` and hold `isDemo`; they use it to disable
controls but still render.

**Contract**: `redirect("/setup")` when `isDemo`. The doorstep itself
(`setup/page.tsx`) is deliberately NOT guarded — it must stay reachable in demo,
which is why this is a per-page guard and not a `setup/layout.tsx`.

#### 3. The doorstep's configure door leaves demo before it navigates

**File**: `src/components/organisms/setup/setup-doorstep.tsx`

**Intent**: The redirect above closes the wizard from demo — and the configure
door is the way IN to the wizard, so on its own it becomes a silent loop. The
door is a plain `<a href={door.href}>` (`:88-90`) pointing at whichever step
`configureDoor()` chose (`setup-doorstep-view.ts:57-91`), so a demo visitor
presses "Podłącz GitHuba" and lands back on the doorstep with no explanation.
FR-008's Socratic note makes the way back to the wizard a requirement while the
REAL account is un-onboarded, not a nicety — "otherwise the doorstep is a screen
the visitor can never return to".

**Contract**: Mirror `demo-banner.tsx:71-82` — `exitDemoAction()` first, then
`router.push(door.href)` + `router.refresh()`, in a `useTransition` with the
existing failure `Alert` as the error surface. The banner's docstring (`:57-70`)
is the rationale and applies verbatim: walking into the wizard while still in
DEMO would save the roster under the demo owner. In REAL the exit is a no-op
`UPDATE`, so one path serves both modes and the door needs no `isDemo` prop.
This is what keeps the Phase 2 redirects unconditional — the wizard is closed
from demo AND still reachable, because the door opens it by leaving demo.

#### 4. The Reconnect control — and the Connect control above it

**File**: `src/components/organisms/settings/integration-card.tsx`

**Intent**: Make `connections/page.tsx:32-44`'s "every control" claim true as
written, and satisfy the corrected criterion at `:37-43` ("anything that mutates
or spends the REAL account"). Reconnect is a link, not a button, so it needs
different handling from `:225`/`:238`.

**Both branches, not one.** The card returns EARLY when `!connected`
(`:140-160`) and that branch renders its own `<Button asChild><a
href={reconnectHref}>Connect {name}</a></Button>` — with no `isDemo` in its
predicate and no demo explanation, because the paragraph at `:249-255` sits in
the connected branch and is never reached. That early return is precisely the
state of the persona this slice is about: a visitor who took the demo door off
the doorstep holds zero credentials, so `/settings/connections` renders two
not-connected cards with two live links into the routes §1 now bounces. Guarding
only Reconnect would leave the likelier control live.

**Contract**: When `isDemo`, render the trigger as a disabled button rather than
a `<Button asChild><a>` — an `<a>` ignores `disabled` — in **both** branches, and
surface the demo explanation in the not-connected branch too (it has none today).
Update the page comment's enumeration to include Connect/Reconnect.

#### 5. E2E for the shortest path

**File**: `e2e/demo-boundary.spec.ts` (new)

**Intent**: `e2e/setup-doorstep.spec.ts:109-156` is the only demo e2e and covers
routing only; no e2e clicks a mutating control in demo.

**Account shape decides the assertion.** `setup-doorstep.spec.ts:114-155` gets
into demo with `signUpFreshAccount` + the demo door — an account holding ZERO
credentials, which is the demo persona this slice is about. Under it the card
renders the not-connected branch, so the control is labelled "Connect GitHub",
not "Reconnect", and a Reconnect locator would find nothing. Reaching the
Reconnect state would mean connecting GitHub against
`e2e/github-fixture-server.mjs` first (the `setup-github.spec.ts` path) and then
loading demo — a second fixture-server consumer under parallel workers, for a
control the unit and manual layers already cover. The e2e takes the persona's own
account.

**Contract**: Sign up fresh, take the demo door, then: navigating to
`/settings/connections/github` lands on `/settings/connections`, and the
"Connect GitHub" control on the not-connected card is disabled and carries the
demo explanation. Role/label locators only, `waitForURL` not timeouts, unique ids
per run — per the `/10x-e2e` rules in CLAUDE.md.

### Success Criteria

#### Automated Verification

- Lint + typecheck pass: `npm run lint`, `npx tsc --noEmit`
- Unit tests pass: `npm test`
- E2E passes: `npm run test:e2e` (this checkout only — S-25 runs in a worktree):
  in demo, `/settings/connections/github` redirects and the not-connected card's
  Connect control is disabled

#### Manual Verification

- In demo, the Reconnect button on both Connections cards is visibly disabled and
  carries the demo explanation; on an account with nothing connected, the
  "Connect GitHub" / "Connect Jira" button is disabled and explained the same way
- Typing `/settings/connections/github` into the address bar while in demo lands
  on `/settings/connections`, not on a connect form
- In demo on `/setup`, the configure door opens the wizard step it names and the
  demo banner is gone — it does not bounce back to the doorstep

---

## Phase 3: The demo world is built once (D1)

### Overview

The doorstep stops rebuilding the demo world. Its demo door dispatches on state
— re-enter an existing world, build one only when none exists — the guard the
`/settings/demo` panel has had since S-09.

### Changes Required

#### 1. A state-aware entry point

**File**: `src/app/(app)/settings/demo/actions.ts`

**Intent**: The doorstep needs one action meaning "show me the demo" that does
not destroy an existing world. `loadDemoAction` cannot be that action — it is
also the panel's explicit "give me a fresh demo" path, and `loadDemo` resets
first by design (`load.ts:66-68`).

**Contract**: A new exported action (e.g. `openDemoAction`) that is a DISPATCHER,
not a third implementation — it CALLS the two existing exported actions rather
than copying their bodies:

```
const { ownerId } = await requireRealWorkspace();
const db = getDb(getCloudflareContext().env);
const demoOwner = await findDemoOwner(db, ownerId);   // (db, realOwnerId) — workspace.ts:186
return demoOwner ? enterDemoAction() : loadDemoAction();
```

They are plain async functions in the same `"use server"` module, so a direct
call is ordinary; the repeated `requireRealWorkspace()` / `getDb` are memoized
per request context. Copying the bodies is what the plan-brief names as this
phase's risk — "if it drifts from the panel's state machine, the two entrances
disagree again", which is the exact defect D1 fixes — so the third entrance is
deliberately given no semantics of its own. `loadDemoAction` and
`enterDemoAction` keep their current meaning for the panel.

#### 2. The doorstep calls it

**File**: `src/components/organisms/setup/setup-doorstep.tsx`

**Intent**: Swap the unconditional `loadDemoAction()` at `:47` for the new
action. Navigation and `router.refresh()` at `:52-56` are unchanged and correct.

**Contract**: Import swap plus the call site; the doc comment at `:29-33`
explaining the direct-import convention stays accurate and gains a sentence on
why the doorstep must not reset. The door's LABEL follows in Phase 4 §7 — once
the door re-enters rather than rebuilds, "Zobacz demo" stops being what it does
on a revisit.

#### 3. Tests

**File**: `src/lib/demo/load.integration.test.ts` (extend) and a unit test for
the new action

**Intent**: Lock D1 and D2 as properties rather than as a comment.

**Contract**: Integration — load demo, edit one demo-owned row, exit, open demo
again through the new action, assert the demo owner id is unchanged and the edit
survives. Also assert the real account's credentials are byte-identical across
the cycle (the `:286-319` pattern). Unit — the action delegates to enter when a
demo owner exists and to load when it does not.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration` (local Supabase only)
- The demo owner id is stable across exit → re-enter; a demo-side edit survives

#### Manual Verification

- Enter demo from `/setup`, change something in the demo roster, press Back to
  `/setup`, take the demo door again — the change is still there and the sprint
  shows the same frozen moment

---

## Phase 4: Honest copy and consent on reset

### Overview

Once 1–3 have landed, one general sentence is true and stays true when a sixth
action is added — on all six surfaces that make it. The enumeration goes: it is a
maintenance promise that has now broken three times, and Phase 2 would have
broken a fourth on its own.

### Changes Required

#### 1. The demo panel's state copy

**File**: `src/components/organisms/demo/demo-panel-view.ts`

**Intent**: `DEMO_STATE_COPY.demo_active` (`:65-67`) carries "Twoje prawdziwe
dane są nietknięte" — verbatim the sentence S-24 retracted from the banner. After
Phase 1 it is defensible, but it should say what is actually guaranteed.

**Contract**: Rewrite `demo_active` (and `demo_idle`, which promises deletion in
passing) around the general guarantee: no action taken in demo changes the real
account. No enumeration.

#### 2. The panel's explanatory paragraph

**File**: `src/components/organisms/demo/demo-panel.tsx`

**Intent**: Replace the `:113-118` list and its "exhaustive on purpose" comment
(`:108-112`) with the general sentence. The comment is replaced by one recording
WHY there is no list: the promise was made twice and broken twice, and Phase 5
now enforces the general claim.

**Contract**: One paragraph, no list. The comment names the Phase 5 test as the
thing that keeps the sentence true.

#### 3. The demo banner

**File**: `src/components/organisms/demo/demo-banner.tsx`

**Intent**: `:101-105` was narrowed by S-24 and its comment (`:90-100`) states
the restore condition — "Widen this sentence again when S-27 closes". This slice
is that closure.

**Contract**: Widen to the same general guarantee used by the panel; delete the
now-satisfied restore-condition comment rather than leaving a stale instruction.
The exit-then-navigate handler (`:71-82`) is untouched.

#### 4. The Connections page comment

**File**: `src/app/(app)/settings/connections/page.tsx`

**Intent**: `:32-44` enumerates nine actions and claims every control that
mutates the real account is disabled. Phase 2 makes it true; the enumeration is
the same trap as the panel's.

**Contract**: Replace the enumeration with the criterion plus a pointer to the
Phase 5 test.

#### 5. The integration card's demo note

**File**: `src/components/organisms/settings/integration-card.tsx`

**Intent**: `:249-255` is a fifth enumeration — "test połączenia, odłączenie
integracji oraz zmiana monitorowanego projektu i repozytoriów" — and Phase 2 is
what makes it short: it adds Connect/Reconnect to the disabled set without adding
them to this sentence. It is also the note the not-connected branch must now
surface (Phase 2 §4), so it is written once and shown in both branches.

**Contract**: Same general guarantee as the panel and the banner, plus the one
thing this card uniquely needs to say — the state shown above is the REAL
integration, and leaving demo is how to change it. No list. Stays Polish inside
the English card, per the deliberate decision recorded at `:66-69`.

#### 6. The doorstep's demo card

**File**: `src/components/organisms/setup/setup-doorstep.tsx`

**Intent**: `:97-99` carries "Twoje prawdziwe integracje pozostają nietknięte" —
a sixth surface making the same promise, in the same shape, and the one a new
visitor reads FIRST. Phase 1 makes it defensible; it should still say what is
actually guaranteed rather than a near-variant of the retracted sentence. Its
second half — "Do konfiguracji wrócisz w każdej chwili" — is made true by Phase 2
§3 rather than by copy, and stays.

**Contract**: Rewrite the first half around the general guarantee. Leave the
return-to-configuration promise standing; Phase 2 §3 is what keeps it.

#### 7. The doorstep's demo door label

**File**: `src/components/organisms/setup/setup-doorstep.tsx`

**Intent**: After Phase 3 the door re-enters an existing world instead of
building one, so on a revisit "Zobacz demo" describes the wrong act. The panel
already draws exactly this distinction — `DEMO_TRANSITION_LABEL`
(`demo-panel-view.ts:70-75`), `load` → "Zobacz demo", `enter` → "Wróć do demo" —
for the reason `allowedTransitions`' docstring gives.

**Contract**: The page computes the demo state it already needs and passes the
label down, reusing `DEMO_TRANSITION_LABEL` rather than a new string. The
doorstep stays a renderer of a decision made in the pure `.ts` sibling, per its
own docstring at `:34-38`.

#### 8. Confirmation on reset

**File**: `src/components/organisms/demo/demo-panel.tsx`

**Intent**: `resetDemoAction` destroys a whole owner subtree and is fired from a
bare click (`:85-98`). It is the only control in the panel that destroys anything
and it sits next to "Wyjdź z demo", which destroys nothing — the confirmation is
also what tells them apart.

**Contract**: Route the `reset` transition through `ConfirmDialog` (controlled
`open`/`onOpenChange`, as `integration-card.tsx:243-248` does), `variant`
destructive, `confirmLabel` matching the button. The `description` must name both
sides: the demo world disappears, the real account and its credentials are
untouched, and demo can be loaded again. Only `reset` is wrapped — `load`,
`enter` and `exit` keep firing directly.

### Success Criteria

#### Automated Verification

- Lint + typecheck pass
- Unit tests pass: `npm test`; `demo-panel-view` copy assertions updated
- No source file still contains the retracted sentence, and no demo copy surface
  enumerates actions: `grep -rn "nietknięt" src` returns only the banner's
  historical comment (`demo-banner.tsx:91`), and none of the six surfaces above
  lists individual actions

#### Manual Verification

- `/settings/demo` in demo mode: "Usuń dane demo" opens a dialog naming what
  disappears and what survives; Cancel leaves the demo world intact
- Confirming reset returns the panel to the "no demo" state and "Zobacz demo"
  reappears
- The banner, the panel, the Connections cards and the doorstep say the same
  thing, and none of them lists actions

---

## Phase 5: The rule as a test, not a comment

### Overview

S-09 wrote the rule and enumerated short; S-24 corrected the rule and enumerated
short again; D1 was a third instance of the same shape. A hermetic test over the
action inventory makes the next omission fail the build.

### Changes Required

#### 1. The inventory test

**File**: `src/lib/demo/boundary-inventory.test.ts` (new)

**Intent**: Assert that every exported Server Action calling
`requireRealWorkspace()` either reads `isDemo` in the same function or appears on
an explicit exception list carrying a reason. Extend the same check to server
components under `(app)/setup/**` and `(app)/settings/connections/**`, which is
what pays off Phase 2's per-page guards.

**Contract**: Hermetic — reads source files off disk, no DB, no network, so it
runs in `npm test`. The exception list is data in the test file, one entry per
allowed site with a one-line reason: the four demo-lifecycle actions
(`settings/demo/actions.ts:58,81,111,136`, plus the new Phase 3 action) and
`setup/page.tsx` (the doorstep must stay reachable in demo). Failure messages
name the file, the symbol, and the two ways to satisfy the rule.

**Contract note**: Scan by file + exported-function boundaries, and assert the
inventory is non-empty before checking it — a scanner that silently matches
nothing reports success, which is `lessons.md`'s "a narrowing predicate turns
'wrong value' into 'empty result'".

#### 2. The manual rows reach the person who runs them

**File**: `context/changes/demo-boundary-enforcement/MANUAL-CHECKLIST.md`
(written at plan-review), `context/foundation/manual-test-backlog.md`

**Intent**: A second, non-technical person works from the backlog alone — a row
missing there does not exist for them (CLAUDE.md). This slice's five blocking
rows are 1.5, 2.5, 2.6, 3.4 and 4.4; 4.4 is the one that guards an irreversible
delete.

**Contract**: Run `node scripts/manual-test-sweep.mjs` and act on a non-zero
exit — add S-27's open rows to `manual-test-backlog.md` §1 in the established
Polish format, each carrying where / what to do / what must be true / why it
matters. Presence is all the script checks; writing the row is still ours.

#### 3. Point the comments at it

**File**: `src/lib/workspace.ts`, `src/lib/demo/refusal.ts`

**Intent**: The doc comments that state the rule should name the test that
enforces it, so the next reader knows the rule is checked.

**Contract**: One sentence each, referencing the test path.

### Success Criteria

#### Automated Verification

- `npm test` passes with the inventory test included
- Deleting the `isDemo` guard from any one of the five Phase 1 actions makes the
  inventory test fail (verify by hand once, do not commit)
- The inventory test asserts it found a non-empty set of call sites
- `node scripts/manual-test-sweep.mjs` exits zero

#### Manual Verification

- None — this phase is CI-only

---

## Testing Strategy

### Unit Tests

- Five refusals with the `it.each` + negative-control idiom
  (`settings/connections/actions.demo.test.ts:65-73`)
- The Phase 3 action delegates to enter vs load by demo-owner presence
- `demo-panel-view` copy: no enumeration, no retracted sentence
- The inventory test, including its own non-empty assertion

### Integration Tests

- Demo world survives exit → re-enter through the doorstep, with a demo-side edit
  intact and a stable demo owner id
- Real credentials byte-identical across a full load → exit → enter → reset cycle

### E2E

- In demo, on the doorstep persona's own account (no credentials):
  `/settings/connections/github` redirects to `/settings/connections`, and the
  not-connected card's Connect control is disabled

### Manual Testing Steps

1. In demo, open `/settings/connections` — Test, Reconnect and Disconnect are all
   disabled on both cards
2. In demo, type `/settings/connections/github` into the address bar — you land
   back on `/settings/connections`, no connect form
3. Enter demo, edit the demo roster, Back to `/setup`, take the demo door again —
   the edit is there, the frozen moment is the same
4. `/settings/demo` → "Usuń dane demo" → the dialog names what goes and what
   stays; Cancel keeps the demo world

## Migration Notes

No schema change, no migration. This matters for the parallel S-25 worktree,
which shares one local Postgres: nothing in this slice writes to the shared
database outside of tests, and `test:integration` / `test:e2e` are owned by this
main checkout.

## References

- Research: `context/changes/demo-boundary-enforcement/research.md`
- Roadmap S-27: `context/foundation/roadmap.md:1099-1160`
- The fix shape: `src/app/(app)/settings/connections/actions.ts:49-55`
- The test idiom: `src/app/(app)/settings/connections/actions.demo.test.ts:65-73`
- Prior slice that handed this over:
  `context/archive/2026-08-30-destructive-action-confirmation/plan.md:186-191`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server-side refusals in the five unguarded actions

#### Automated

- [x] 1.1 Lint passes — 338ae0d
- [x] 1.2 Type checking passes — 338ae0d
- [x] 1.3 Unit tests pass, including the extended demo suites — 338ae0d
- [x] 1.4 Each of the five actions refuses in demo and reaches the service when not in demo — 338ae0d

#### Manual

- [ ] 1.5 In demo no route reaches a connect form; real credential last4 unchanged

### Phase 2: Route guards and the Reconnect control

#### Automated

- [x] 2.1 Lint + typecheck pass — 4524f94
- [x] 2.2 Unit tests pass — 4524f94
- [x] 2.3 E2E passes — 4524f94

#### Manual

- [ ] 2.4 Reconnect disabled in demo on both cards; Connect disabled on a not-connected card
- [ ] 2.5 Direct URL to /settings/connections/github in demo lands on /settings/connections
- [ ] 2.6 In demo, the doorstep's configure door opens the wizard and leaves demo

### Phase 3: The demo world is built once (D1)

#### Automated

- [x] 3.1 Unit tests pass — 0c8fad2
- [x] 3.2 Integration tests pass — 0c8fad2
- [x] 3.3 Demo owner id stable across exit → re-enter; demo-side edit survives — 0c8fad2

#### Manual

- [ ] 3.4 Demo edit survives Back to /setup and re-entering through the demo door

### Phase 4: Honest copy and consent on reset

#### Automated

- [x] 4.1 Lint + typecheck pass — 887e708
- [x] 4.2 Unit tests pass with updated copy assertions — 887e708
- [x] 4.3 No source file contains the retracted sentence; no demo surface enumerates actions — 887e708

#### Manual

- [ ] 4.4 Reset opens a dialog naming what disappears and what survives; Cancel is safe
- [ ] 4.5 Confirming reset returns the panel to the "no demo" state
- [ ] 4.6 Banner, panel, integration card and doorstep carry the same general guarantee, no action list

### Phase 5: The rule as a test, not a comment

#### Automated

- [x] 5.1 npm test passes with the inventory test included
- [x] 5.2 Removing one Phase 1 guard makes the inventory test fail
- [x] 5.3 The inventory test asserts a non-empty set of call sites
- [x] 5.4 manual-test-sweep exits zero; S-27's open rows are in the backlog
