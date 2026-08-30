# First-run destination: the setup wizard's doorstep — Implementation Plan

## Overview

A newly signed-up SprintFlow account has nowhere to land. Sign-up, sign-in and
the `(auth)` layout all push to `/dashboard`, which renders the full S-07/S-10
surface against an empty account — a dashboard of zeros. Meanwhile `/setup`
itself is reachable only by hand-typing the URL — nothing links to the wizard's
entrance, only to steps *inside* it (see Current State) — and
`isOnboardingComplete`, built and tested in S-04, has zero production callers.

This change builds the **doorstep**: a first screen at `/setup` that tells a new
account what SprintFlow needs and offers two doors — connect real data, or load
the demo — and a server-side gate on `/dashboard` that sends an un-onboarded real
account there. It is not "wire a redirect": a redirect can name only one
destination, and the PRD promises two entrances (Access Control's *"on success,
the user lands in the setup wizard"* and US-02's demo path).

## Current State Analysis

**The wizard is orphaned but structurally ready.** `/setup` is a 9-line
unconditional `redirect("/setup/github")`
(`src/app/(app)/setup/page.tsx:8`) that nothing links to and no test asserts —
replacing it breaks nothing by itself. `SetupWizardShell`
(`src/components/templates/setup-wizard-shell.tsx`) takes `step` / `totalSteps`
as plain props with `totalSteps = 3` defaulted inline at `:17`, computes
`pct = step/totalSteps` at `:41`, and renders `Step {step} of {totalSteps}` at
`:52`. The step count is hard-coded in four places and has already been
renumbered once (4→3 in S-04).

**But the wizard's *steps* are linked to, from three places — one of them in
Settings.** Only the entrance `/setup` is unlinked. `github-connection-status.tsx:84`
sends the lead to `/setup/jira` and `jira-connection-status.tsx:93` to
`/setup/team`; both are wizard-internal and expected. The third is not:
`settings/jira-project-editor.tsx:118` renders
`<Link href="/setup/team">Import sprint cadence</Link>`, and that editor is
mounted by `/settings/connections` (`connections/page.tsx:4`) after a Jira project
switch. So Settings *does* hold one route into the wizard, and Phase 2 changes
what it lands on.

**The predicate exists and is correct.** `isOnboardingComplete({ db, ownerId })`
(`src/lib/onboarding.ts:28`) is six sequential `SELECT … LIMIT 1` with early
`return false` — a brand-new account exits after one. It takes `db` as a
parameter, so it can thread an existing handle rather than opening a pool.
Cadence is deliberately excluded (S-04 finding F1).

**Demo is tenancy, not a flag.** `resolveWorkspace()`
(`src/lib/workspace.ts:86`) returns `{ ownerId, realOwnerId, isDemo, now }` and
is `cache()`d. The demo fixture writes rows satisfying **all six** predicate
conditions under the *demo* owner, so a gate reading `resolveWorkspace().ownerId`
would pass a demo visitor holding zero real credentials, and one reading
`requireRealWorkspace().ownerId` would lock that visitor out permanently.

**Demo is undiscoverable.** `loadDemoAction()`
(`src/app/(app)/settings/demo/actions.ts:53`) needs only a session — no
credentials at all — but reaching it is four unsignposted steps: nav → Settings →
the sixth tab → the button. The landing page never mentions demo.

**Every gated surface already degrades honestly on an empty account.** The frame
falsified the "letting someone leave setup breaks the system" hypothesis:
`anomaly-inbox.tsx:85` renders "No active sprint", `sync-status-bar.tsx:35`
prints "never synced", `sprint-detail/page.tsx:94` renders a null-sprint shape.
Un-onboarded the app is *useless*, not *broken* — which makes the gate a UX
decision, not a correctness one.

**The e2e blast radius is a shared, deliberately-mutated account.**
`e2e/auth.setup.ts:31` signs up a fresh account through the UI and waits for
`**/dashboard`; it is the `setup` project the entire `chromium` project depends
on. But that account cannot simply be onboarded once, because two specs
un-onboard it on purpose: `setup-github.spec.ts:25-34` and
`setup-jira.spec.ts:25-31` each click *Disconnect* in `afterEach` to leave the
connect form reachable on a re-run. Under `fullyParallel: true`
(`playwright.config.ts:39`) that lands in an unpredictable order relative to the
four specs that enter `/dashboard`. The suite already learned this the hard way —
`dashboard-sprint-detail.spec.ts:143-148` records a test that "passed alone and
failed in the full suite" until it was given its own account.

## Desired End State

A brand-new account that signs up lands on `/setup` — a Polish welcome screen
inside the wizard shell reading "Krok 1 z 4", with the navigation header hidden,
stating what SprintFlow needs and offering exactly two buttons: continue
configuring — GitHub for a fresh account, or the first step still missing for one
that stopped part-way — or load the demo. There is no third way off that screen.

An account that chooses the demo door is switched into demo mode and lands on the
dashboard with the demo banner above it; while its *real* account is still
un-onboarded, that banner carries an explicit link back to the wizard.

An account whose real onboarding is complete lands on `/dashboard` as today. A
lead who disconnects GitHub to rotate a PAT stays inside `/settings/**` and is
never ejected — nothing *redirects* out of Settings. (One Settings button still
links into the wizard by the lead's own click: "Import sprint cadence" after a
Jira project switch. That hop is accepted and recorded — Phase 2 §4.)

**Verification:** signing up on a clean database lands on the doorstep, not the
dashboard; `npm test`, `npm run test:integration`, `npm run lint` and the
Playwright suite all pass; a demo visitor is never sent to the wizard.

### Key Discoveries

- `src/app/(app)/dashboard/page.tsx:44-47` already calls `resolveWorkspace()` and
  builds one `getDb(env)` handle — the gate slots in immediately after, adding
  **no** new pool (`src/lib/db.ts:21-25` documents the unfixed per-request leak).
- `resolveWorkspace()` already returns `isDemo`, so the frame's rule ("the gate
  must not fire in demo") is satisfiable **without the predicate ever seeing a
  demo id**.
- `settings/**` never imports `SetupWizardShell` — a change confined to the shell
  and `setup/**` pages cannot leak into Settings.
- The two-doors card layout already exists at
  `src/app/(app)/settings/connections/page.tsx:48` (a `lg:grid-cols-2` of
  `IntegrationCard`s), and its thesis is written at
  `integration-card.tsx:121-122`: *"Not connected is a normal state for a fresh
  account, not a failure — so it gets a route forward, not an error treatment."*
- `DemoBanner` is rendered by `(app)/layout.tsx:46` above every gated route and
  already owns the way out of demo — it is the natural home for the return link.
- `WORKSPACE_SCOPED_PATHS` (`settings/demo/actions.ts:31-39`) omits `/setup/*`, so
  the demo door needs the path added or its own revalidation.
- There is **no data-driven redirect anywhere in this app today**; all four
  `redirect()` calls under `src/app/` are unconditional index or auth redirects.
  A first-run gate is a new pattern here, not an instance of an existing one.

## What We're NOT Doing

- **Not adding "Setup" as a nav item.** Recorded across the change folder, the
  roadmap and FR-009. The wizard is first-run; Settings is ongoing management.
- **Not gating `/settings/**`.** A lead disconnecting GitHub to rotate a token
  must stay on the page holding the reconnect button.
- **Not gating `/dashboard/sprint-detail`, `/refinement` or
  `/refinement/runs/[runId]`.** The gate is per-page on `/dashboard` only; the
  nav is hidden on the doorstep instead, so these are not reachable *from* it.
- **Not touching middleware.** `middleware.ts:13-17` is an optimistic cookie
  check with no DB access, deliberately not the security boundary.
- **Not translating the shared setup organisms.** Polish stops at the wizard's
  chrome — the shell, the doorstep, and the three wizard pages' titles and
  descriptions. `github-connect-form.tsx`, `jira-connect-form.tsx` and the roster
  editor stay English, because `/settings/connections/**` and `/settings/team`
  mount the same components.
- **Not adding a "seen the doorstep" column.** The predicate is derived; a stored
  boolean would drift, and a new column would need a migration route.
- **Not testing the 2-second demo budget.** US-02's budget has no test today
  (only a comment at `src/lib/demo/load.ts:79`); adding one is out of scope.
- **Not advertising demo on the landing page.** `loadDemoAction` requires a
  session, so a pre-signup button would mislead.
- **Not fixing the `pg.Pool` leak** — that is the `db-pool-teardown` change.

## Implementation Approach

Five phases, ordered so the suite is green at every boundary.

The doorstep is built first while nothing routes to it, so Phase 1 is
additive and cannot break a passing test. The wizard renumbering and
polonisation follow as a self-contained mechanical sweep. Only then does the gate
land — together with the e2e fixture rewrite in the *same* phase, because
separating them leaves the suite red in between. The demo return link comes
after, since it depends on the gate existing to be meaningful. Documentation
closes.

The gate reads `isDemo` from the already-cached `resolveWorkspace()` and
short-circuits; only for a real workspace does it run `isOnboardingComplete` on
`realOwnerId`, threading the request's existing `db` handle. The predicate never
sees a demo owner id.

### Critical Implementation Details

**Ordering inside the gate.** The `isDemo` short-circuit must come *before* the
predicate call, not after — the demo fixture satisfies all six conditions under
the demo owner, so a predicate-first ordering would produce the right answer by
accident in demo and the wrong one the moment the fixture changes.

**The demo door does not redirect itself.** `loadDemoAction()` returns
`{ok:true} | {ok:false, …}` and performs no navigation — nothing in the URL
changes when the workspace does. The door must navigate (and refresh) on its own,
exactly as `demo-panel.tsx:47-68` already does.

**Hiding the nav.** `AppShell` renders `MainNav` unconditionally
(`app-shell.tsx:29`). The doorstep needs a variant, and the `(app)` layout is a
server component that cannot read the child route — so the suppression has to be
driven by something the layout can see, or the doorstep must opt out of
`AppShell` rather than the layout opting in. Phase 1 owns that call; the
constraint is that **steps 2–4 keep their navigation** (a returning user mid-
wizard has a legitimate need for Settings), so whatever mechanism ships must be
per-route, not per-route-group.

---

## Phase 1: The doorstep at `/setup`

### Overview

Replace the 9-line redirect with the first-run screen: Polish copy, two doors,
no navigation, no exit. Nothing routes here yet, so this phase is purely
additive.

### Changes Required

#### 1. The doorstep page

**File**: `src/app/(app)/setup/page.tsx`

**Intent**: Replace the unconditional `redirect("/setup/github")` with a thin
async server component that reads the real owner, resolves which doors to offer,
and renders the doorstep organism inside `SetupWizardShell` at `step={1}`.
Follows the three existing wizard pages' shape exactly (`setup/github/page.tsx:17-56`):
auth + DB reads in the page, every pixel in an organism.

**Contract**: Default export, async server component. Inherits `force-dynamic`
and `requireSession()` from `(app)/layout.tsx` — must NOT re-declare either.
Calls `requireRealWorkspace()` like every other `/setup/**` page, then reads
per-step completion (below) and hands it to `setup-doorstep-view.ts`.

**Its one data read** (plan review F7): the doorstep is not only the first-run
screen — it is also where a *partially* configured account is sent back to, since
the gate redirects on the whole predicate rather than on a step. An account that
connected GitHub and then abandoned Jira must not be handed a door that re-offers
GitHub. Add `getOnboardingSteps({ db, ownerId })` beside `isOnboardingComplete`
in `src/lib/onboarding.ts` — the SAME six `SELECT … LIMIT 1`, returning which are
satisfied instead of collapsing them to a boolean, so the two functions cannot
drift on what "complete" means. It runs on the request's own `db` handle; no new
pool.

#### 2. The doorstep organism

**File**: `src/components/organisms/setup/setup-doorstep.tsx` (new)

**Intent**: The two-doors screen. Polish copy naming what SprintFlow needs before
it can show anything — a GitHub PAT and a Jira API token + workspace URL — and
two cards: "Podłącz GitHuba" (link to `/setup/github`) and "Zobacz demo" (calls
`loadDemoAction`, then navigates). The demo card must state plainly that demo
data is fictional and that real integrations stay untouched. No third
affordance — no "skip", no dashboard link.

**Contract**: Client component (the demo door needs `useTransition`). It
**imports `loadDemoAction` directly**, matching `demo-banner.tsx:10`. The house
has two conventions, not one (plan review F8): `demo-panel.tsx:32-34` receives
the action as a prop because a settings page renders it with other props already
threaded; `demo-banner.tsx` imports it because it is rendered bare by a server
layout. The doorstep is the second shape — the page passes it only door state, so
threading four actions through would be ceremony. Mirrors the two-column card layout of
`settings/connections/page.tsx:48` and the pending/disabled/`Loader2`/destructive-
`Alert` handling of `demo-panel.tsx:47-68,93-106`.

#### 3. Door-selection logic

**File**: `src/components/organisms/setup/setup-doorstep-view.ts` (new)

**Intent**: The pure decision — which doors are offered and in what state — split
out of the `.tsx` so it is unit-testable. There is no component-test harness
(no jsdom, no RTL), so this split is mandatory, not stylistic. Precedents:
`demo-panel-view.ts:11-46`, `roster-merge.ts`, `inbox-controls.ts`.

**Contract**: Pure functions over plain inputs, no DB and no React imports. Takes
the per-step completion from §1 and returns the configure door's **href and
label**: `/setup/github` and "Podłącz GitHuba" for a genuinely fresh account,
otherwise the first incomplete step (`/setup/jira`, `/setup/team`) with matching
copy. The demo door's state does not depend on it. This is what the unit tests
under criterion 1.3 cover: fresh, GitHub-only, GitHub+Jira, and the
already-complete case.

#### 4. Navigation suppression on the doorstep

**File**: `src/components/molecules/main-nav.tsx`

**Intent**: Give the doorstep a header without `MainNav`, while steps 2–4 and
every other gated route keep theirs. The doorstep is the forced landing, so its
four header links would be four exits the design does not want; the later wizard
steps are reached by choice and must stay escapable to Settings.

**Mechanism (decided — plan review F2)**: `MainNav` becomes a client component
that reads `usePathname()` and returns `null` on exactly `/setup`. The three
alternatives are all closed by this plan's own constraints: `AppShell` renders
`MainNav` unconditionally from the `(app)` layout (`app-shell.tsx:26`,
`layout.tsx:36-45`), and that layout is a **server component that cannot read the
child route**; a pathname header would require middleware, which is a stated
non-goal; and a route-group split would move `/setup/github|jira|team` too, which
must keep their nav. The precedent is in-repo — `settings-tabs.tsx:4,21` already
does client-side `usePathname` routing logic — and `main-nav.tsx:19` records
`usePathname` as this component's own planned next step.

**Contract**: `"use client"`, `usePathname()`, exact-match on `/setup` only (a
`startsWith` would strip the nav from steps 2–4). `AppShell` is **unchanged** —
the brand, the `actions` slot (user name + sign-out) and the footer all stay as
they are, and the landing page's `AppShell` usage (`src/app/page.tsx:4`) is
untouched. Sign-out lives in the `actions` slot, so it remains reachable from the
doorstep — hiding navigation must not trap a user in their own account.

#### 5. Demo revalidation covers the doorstep

**File**: `src/app/(app)/settings/demo/actions.ts`

**Intent**: `WORKSPACE_SCOPED_PATHS` (`:31-39`) lists seven paths and omits
`/setup`. Loading the demo from the doorstep must invalidate the doorstep's own
cache entry, or a returning render can show stale content.

**Contract**: Add `/setup` to the array. No signature change.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass, including new coverage of `setup-doorstep-view.ts`: `npm test`
- Existing Playwright suite still green (nothing routes to the doorstep yet):
  `npm run test:e2e`

#### Manual Verification

- Typing `/setup` on a fresh account shows the Polish doorstep, both doors, and
  no navigation links in the header — while `/setup/github` still shows its
  navigation.
- On an account that has connected GitHub only, the configure door points at
  `/setup/jira`, not back at `/setup/github`.
- Clicking "Zobacz demo" loads the demo and lands on a populated dashboard under
  the demo banner, with real credentials untouched.
- Sign-out is reachable from the doorstep.

**Implementation Note**: Pause here for manual confirmation before Phase 2.

---

## Phase 2: Renumber the wizard to four steps and polonise its chrome

### Overview

The doorstep is step 1, so GitHub/Jira/Team become 2/3/4. Separately, the
wizard's chrome speaks Polish — the shell label, and the three pages' titles and
descriptions. The forms inside stay English because Settings mounts them.

### Changes Required

#### 1. The shell

**File**: `src/components/templates/setup-wizard-shell.tsx`

**Intent**: Default `totalSteps` becomes 4, and the step label plus the
progressbar's `aria-label` are rendered in Polish ("Krok 1 z 4"). Update the
docblock, which currently asserts the wizard has exactly three steps and that
step 3 reaches 100% (`:5,12-13`).

**Contract**: Props unchanged (`step`, `totalSteps = 4`, `title`, `description?`,
`wide?`, `children`). `pct = step/totalSteps` arithmetic unchanged — step 4 now
reaches 100%.

#### 2. The three wizard pages

**Files**: `src/app/(app)/setup/github/page.tsx`,
`src/app/(app)/setup/jira/page.tsx`, `src/app/(app)/setup/team/page.tsx`

**Intent**: Bump `step` to 2/3/4 respectively, and translate the `title` and
`description` passed to the shell. Only the props handed to `SetupWizardShell`
change — the organisms rendered beneath keep their English copy.

**Contract**: `step={2}` / `step={3}` / `step={4}`; `wide` on the team page
unchanged.

#### 3. Prose referencing the step count — all seven sites

**Files** (verified by `grep -rniE "of 3|3-step|three-step|step [1-3]\b" src e2e`):

- `src/app/(app)/settings/connections/github/page.tsx:15-16` — "step 1 of the
  3-step" rationale for why the Settings route is distinct from the wizard.
- `src/app/(app)/setup/github/page.tsx:12` — "Setup step 1 — GitHub" → step 2.
- `src/app/(app)/setup/jira/page.tsx:12` — "Setup step 2 — Jira" → step 3.
- `src/app/(app)/setup/team/page.tsx:14` — "Setup step 3 — team roster" → step 4.
- `src/components/organisms/setup/github-connect-form.tsx:65` — "a 3-step flow".
- `src/components/organisms/setup/jira-connect-form.tsx:76` — "a 3-step flow".
- `src/components/organisms/setup/jira-connection-status.tsx:90` — "Forward to
  step 3 … the final wizard step" → step 4.

**Intent**: Every one of these asserts the old numbering; leaving any of them
misleads the next reader about which numbering is current. The plan originally
named only the first — the other six were found by plan review F4, along with the
fact that the old `"of 3"` grep matches none of them.

**Contract**: Comment text only; no behavioural change. The user-visible strings
inside these components are untouched — this phase's translation scope is the
shell and the three pages' `title`/`description` props (§1, §2), nothing else.

#### 4. Record the accepted Settings→wizard hop

**File**: `src/components/organisms/settings/jira-project-editor.tsx:116-119`

**Intent**: After this phase, the "Import sprint cadence" button on
`/settings/connections` lands the lead on a Polish `Krok 4 z 4` stepper reached
from an English Settings page — a seam worth naming rather than discovering. It
is **accepted, not fixed**, for two reasons: cadence import genuinely lives on
`/setup/team` and has no Settings-local surface, and it fires only after a Jira
project switch, which is a re-configuration and not the PAT rotation the end
state protects. Building a Settings-local cadence surface is a separate slice.

**Contract**: A comment at the link naming the seam and the reason, so the next
reader does not re-open the decision. No behavioural change, no new route. This
does **not** narrow the "never ejected from Settings" end state, which is about
the *gate*: nothing redirects the lead here — they click a button.

#### 5. The e2e step assertion

**File**: `e2e/dashboard-sprint-detail.spec.ts:222`

**Intent**: The assertion matches `/Step 1 of 3/` on `/setup/github` to prove the
Settings connect page is single-step while the wizard is not. Retarget it to the
new Polish label and the new number.

**Contract**: The test's purpose — Settings is not the wizard — is preserved; only
the expected string changes.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass: `npm test`
- Playwright suite green, including the retargeted step assertion:
  `npm run test:e2e`
- No stale step-count prose remains:
  `grep -rniE "of 3|3-step|three-step|step [1-3]\b" src e2e` returns nothing
  about the setup wizard

#### Manual Verification

- Walking `/setup` → GitHub → Jira → Team shows "Krok 1 z 4" through
  "Krok 4 z 4", with the bar reaching 100% on the last step.
- `/settings/connections/github` still shows no step indicator at all.

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: The gate on `/dashboard`, and the e2e fixture

### Overview

The one phase that changes where users land. The gate and the fixture rewrite
must land together — separating them leaves the entire Playwright suite red in
between.

### Changes Required

#### 1. The gate

**File**: `src/app/(app)/dashboard/page.tsx`

**Intent**: Before rendering, send an un-onboarded real account to `/setup`. The
page already calls `resolveWorkspace()` and builds a `getDb(env)` handle at
`:44-47`; the check slots in immediately after, adding no new pool. Read `isDemo`
first and short-circuit — a demo visitor is never sent to the wizard, and the
predicate never sees a demo owner id. Only for a real workspace, run
`isOnboardingComplete` on `realOwnerId` with the existing `db` handle and
`redirect("/setup")` when false.

**Contract**: `redirect()` from `next/navigation`, before any data reads. The
`isDemo` short-circuit **must precede** the predicate call. No change to the
page's props or exports.

#### 2. An onboarded-account helper, NOT a seeded shared fixture

**File**: `e2e/dashboard-sprint-detail.spec.ts` (helper), consumed by the specs in §3

**Intent**: The obvious move — onboard the shared `storageState` account once in
`auth.setup.ts` — does not work, and this is the phase's load-bearing constraint.
The shared account is **mutated mid-run by design**: `setup-github.spec.ts:25-34`
and `setup-jira.spec.ts:25-31` each click *Disconnect* in `afterEach`, which drops
the credential `isOnboardingComplete` checks first (`onboarding.ts:35-40`) and
un-onboards the account for whatever runs next. With
`fullyParallel: true` (`playwright.config.ts:39`) the ordering is a coin flip, so
a seeded fixture would produce an intermittently-redirecting `/dashboard`. This
suite has already been bitten by exactly this and already chose the fix — see the
isolation note at `dashboard-sprint-detail.spec.ts:143-148`, where a test that
"passed alone and failed in the full suite" was given its own account.

So: promote `signUpFreshAccount()` (`:49-59`) into a sibling
`signUpOnboardedAccount()` that signs up via the API and then writes the six
predicate rows directly over `pg`. `seedSprint()` (`:253-330`) is the working
template — it already inserts five of them (`jira_credential`, `jira_project`,
`github_credential`, `monitored_repo`, `team_member`); the helper adds
`status_mapping` and drops the sprint/ticket/commit rows the predicate does not
read.

**Contract**: Export both helpers from one place so §3's specs share them.
The helper is coupled to the predicate's shape — say so in its docblock, so a
future seventh condition fails as a seeding bug and not as a routing bug.

#### 3. The `/dashboard` entry points

**Files**: `e2e/auth.setup.ts`, `e2e/seed.spec.ts:36-42`,
`e2e/dashboard-sprint-detail.spec.ts:73-110,121-138,169-191`

**Intent**: Four tests enter `/dashboard` on an account that does not reliably
satisfy the predicate. Each moves onto its own onboarded account from §2, rather
than trusting the shared one:

- `auth.setup.ts:31` — stops waiting on `**/dashboard`. The setup project's job
  is a session, not a destination: sign up, then wait for whichever gated surface
  the doorstep shows, and save `STORAGE_STATE` from there. The shared account
  stays deliberately **un-onboarded**, which is what `setup-github.spec.ts` and
  `setup-jira.spec.ts` need it to be.
- `seed.spec.ts:35-51` and `dashboard-sprint-detail.spec.ts:73-110` — assert the
  real dashboard, so they take an onboarded account of their own.
- `dashboard-sprint-detail.spec.ts:121-138` (Sprint Detail from the nav) and
  `:169-191` (Settings from the nav) reach their target *through* `/dashboard`.
  Both break twice over: the gate redirects them, and the doorstep has no
  `MainNav` to click. Give them an onboarded account, or enter the route
  directly.

**Contract**: Test-only changes. `STORAGE_STATE` still holds a valid session, so
no dependent test loses its auth. `e2e/setup-github.spec.ts`,
`e2e/setup-jira.spec.ts` and `e2e/login-invalid-credentials.spec.ts` need no edit
— the first two only touch `/setup/**`, which is not gated, and the third's
`/dashboard` visit (`:49`) is unauthenticated and still bounces to `/login`.

#### 4. A dedicated doorstep spec

**File**: `e2e/setup-doorstep.spec.ts` (new)

**Intent**: The behaviour this whole change exists for, tested through the real
routing path on a genuinely empty account — not through a mocked predicate.
`lessons.md` names this exactly: *"Test the no-configuration path through the
real resolver, not through an injected dependency."* Cover: a fresh sign-up lands
on the doorstep; `/dashboard` typed directly redirects there; the header shows no
navigation links; and the demo door lands on a populated dashboard from which
`/dashboard` no longer redirects.

**Contract**: Independent test with its own fresh account (timestamp-suffixed
email) and its own cleanup, per the repo's e2e rules. Role/label locators only —
no CSS selectors, no `waitForTimeout`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Full Playwright suite green, including the new doorstep spec:
  `npm run test:e2e`

#### Manual Verification

- A brand-new account signing up through the UI lands on the doorstep, and typing
  `/dashboard` bounces back to it.
- A fully configured account signs in and lands on `/dashboard` with no
  detour.
- Disconnecting GitHub from `/settings/connections` leaves the lead on the
  Settings page — not ejected to the wizard — and reconnecting restores the
  dashboard.
- A demo account reaches `/dashboard` without ever being sent to the wizard.

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: The way back from demo

### Overview

Once someone enters through the demo door, the route back to configuration must
be visible at all times — not buried in Settings. The demo banner already renders
above every gated route and already owns the exit from demo; it gains one more
affordance, and only while the real account is still un-onboarded.

### Changes Required

#### 1. `resolveWorkspace()` reports whether the real account still needs setup

**File**: `src/lib/workspace.ts`, then `src/app/(app)/layout.tsx`

**Intent**: The banner needs one boolean: is the *real* account still
un-onboarded? Compute it **inside `resolveWorkspace()`'s DEMO branch**, not in the
layout.

The layout is the wrong place, and this is not a style preference (plan review
F5). `(app)/layout.tsx` imports neither `getDb` nor `getCloudflareContext`, so
"thread a `db` handle" there is not available — getting a handle means calling
`getDb(env)`, and `getDb` **is** the pool constructor (`db.ts:14,26-28` builds a
fresh `new Pool({ max: 1 })` per call, closed by nobody on the request path). The
layout runs on *every* gated route, so that would leak one extra
Hyperdrive-backed connection per render in demo — dashboard, sprint-detail,
refinement and all seven settings tabs — which is `lessons.md` rule #3 verbatim,
on the platform the lesson names.

`resolveWorkspace()` already has everything needed: it is `cache()`d (`:86`), it
already builds exactly one `db` (`:93`), and it already branches on DEMO
(`:104-117`). Adding the six predicate reads to that branch costs **no new pool**
and **nothing at all** in real mode, where the function returns at `:104-111`
before the demo path is entered.

**Contract**: `Workspace` gains one field — `realOnboarded: boolean` — set from
`isOnboardingComplete({ db, ownerId: realOwnerId })` in the DEMO branch only, and
`false` is never inferred: outside demo the field is not consulted. `decideWorkspace`
stays a pure function (pass the computed boolean in, as `demoOwner` already is),
so its existing unit fixtures extend rather than break. `(app)/layout.tsx` then
just widens its destructure at `:33` and passes the flag down — no new import, no
new query, no new pool.

#### 2. The banner's return link

**File**: `src/components/organisms/demo/demo-banner.tsx`

**Intent**: When the real account is not yet configured, the banner carries an
explicit link back to the wizard ("Dokończ konfigurację" → `/setup`) alongside
today's "Wyjdź z demo" and "Ustawienia demo". When the real account *is*
configured, the banner renders exactly as it does today — the ongoing
management path stays in Settings, unchanged.

**Contract**: New optional prop for the real account's onboarding state; absent
or false-y preserves today's rendering exactly. The existing `exitDemoAction`
handling and the frozen-anchor copy are untouched.

#### 3. Finishing the wizard from inside demo exits demo

**File**: `src/components/organisms/setup/cadence-form.tsx:142`

**Intent**: Close the journey §2 opens. Save & finish does
`router.push("/dashboard")`; if the lead reached the wizard through the banner's
"Dokończ konfigurację" link, `active_workspace` is still `DEMO`, so the gate
short-circuits on `isDemo` and returns them to *fictional* data under the demo
banner — no signal that the real setup they just completed worked (plan review
F6). Exit demo first, so the wizard's last step lands on the real dashboard the
lead was configuring.

**Contract**: `await exitDemoAction()` before the push, and **only when already in
demo** — pass the flag in rather than calling blind, so the ordinary real-account
finish is byte-for-byte unchanged and pays no extra action round-trip. The demo
world is kept, not reset: `exitDemoAction` only flips `active_workspace`
(`settings/demo/actions.ts:106-121`), so the lead can re-enter demo from Settings
afterwards.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Playwright suite green: `npm run test:e2e`

#### Manual Verification

- Entering demo from the doorstep on a fresh account shows the banner with
  "Dokończ konfigurację" on every gated screen; clicking it reaches `/setup`.
- Completing the wizard on the real account and re-entering demo shows the
  banner **without** that link — the pre-change shape.
- Exiting demo on an un-onboarded real account lands back on the doorstep rather
  than a dashboard of zeros.
- The whole journey end to end: from a fresh account, take the demo door, click
  "Dokończ konfigurację", complete GitHub + Jira + Team, press Save & finish —
  and land on the REAL dashboard with no demo banner.

**Implementation Note**: Pause here for manual confirmation before Phase 5.

---

## Phase 5: Reconcile the written record

### Overview

The doorstep contradicts three documents that describe the pre-doorstep world.
Leaving them is how the next slice re-derives a decision this one already made.

### Changes Required

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: US-02's **When** clause says *"they navigate to settings and click
'Load demo team'"* (`:77`) — the doorstep replaces that path with a door on the
first screen. Amend the clause and record the Access-Control/US-02 tension and
its resolution as a `> Socratic:` note on FR-008, in the established format:
both promises are honoured because the landing destination is a doorstep with two
doors rather than a credential form.

**Contract**: US-02 **When** clause; a dated Socratic blockquote under FR-008.
Access Control's *"on success, the user lands in the setup wizard"* stays true and
is **not** edited.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md` (S-22)

**Intent**: S-22 prescribes *"post-sign-up routing plus a prompt on the dashboard
until onboarding completes"* — a different shape from what shipped, and it does
not mention demo at all. Restate the outcome as the doorstep, keep the "do NOT add
a Setup nav item" rule, and keep the cost warning about the six-query predicate.
Scope changes start in the roadmap (`task-tracking.md`), so this is the canonical
record.

**Contract**: S-22's Outcome and body; ID, change-id and prerequisites unchanged.

#### 3. Manual test rows

**Files**: `context/foundation/manual-test-backlog.md`,
`context/changes/onboarding-routing/MANUAL-CHECKLIST.md` (new)

**Intent**: Backlog row 13.7 records that a post-registration account went
straight to `/dashboard` and states it *"zamknie się sam wraz z S-22"* — this
change closes it. Write the slice's short checklist (3–5 blocking rows only) and
mirror the open rows into the backlog, which is the one list a second,
non-technical person works from.

**Contract**: Each row carries the four required things — where (exact route and
which account), what to click in order, the observable pass condition with no
judgment left, and which defect it catches — signed off with the phase number.
Run `node scripts/manual-test-sweep.mjs` and act on a non-zero exit.

### Success Criteria

#### Automated Verification

- Manual-test sweep passes: `node scripts/manual-test-sweep.mjs`
- Lint passes: `npm run lint`

#### Manual Verification

- Backlog row 13.7 is ticked or moved with a reason, and the new rows read as
  actionable to someone who has not read this plan.

---

## Testing Strategy

### Unit Tests

- `setup-doorstep-view.ts` — which doors are offered and their states, including
  the failure state after a demo load error. Pure, no DB.
- No component tests exist by design (no jsdom, no RTL) — decision logic lives in
  the `.ts` sibling precisely so it is testable.

### Integration Tests

- `src/lib/onboarding.integration.test.ts` already covers the predicate against
  real Postgres, including progressive completion and owner-scoped isolation. No
  new integration test is needed for the predicate itself; the gate's behaviour is
  routing and belongs in Playwright.

### E2E Tests

- `e2e/setup-doorstep.spec.ts` (new) — the real no-configuration path: fresh
  sign-up lands on the doorstep; direct `/dashboard` redirects there; no nav links
  in the header; the demo door produces a dashboard that no longer redirects.
- `e2e/auth.setup.ts` — rewritten to complete onboarding before waiting for
  `**/dashboard`.
- Five existing `/dashboard` entry points adjusted (Phase 3).

### Manual Testing Steps

1. On a clean database, sign up a new account — confirm the doorstep appears with
   two doors, Polish copy, and no navigation links.
2. Click "Zobacz demo" — confirm a populated dashboard under the banner, and that
   the banner offers "Dokończ konfigurację".
3. Click that link, complete GitHub + Jira + Team — confirm "Krok 1 z 4" through
   "Krok 4 z 4" and a landing on `/dashboard`.
4. Sign out, sign back in — confirm a direct landing on `/dashboard`.
5. From `/settings/connections`, disconnect GitHub — confirm you stay on the
   Settings page and are not thrown into the wizard.

## Performance Considerations

The gate adds at most six `SELECT … LIMIT 1` to a `/dashboard` render, and a
brand-new account exits after the first. It threads the request's existing `db`
handle, so it opens **no** additional `pg.Pool` — which matters because
`src/lib/db.ts:21-25` documents that a `/dashboard` request already leaks three.
The roadmap's standing warning (`roadmap.md:736-738`) is that this predicate must
never drift into a per-owner loop; a single request path is what it was scoped
for. In demo the gate costs nothing — `isDemo` short-circuits before any query.

Phase 4 is the one place the predicate runs outside a request the user explicitly
made to `/dashboard`. It lives inside `resolveWorkspace()`'s DEMO branch, which
means two things: a real-workspace render never reaches it (the function returns
at `workspace.ts:104-111` first), and a demo render pays six `SELECT … LIMIT 1`
on the pool that call **already** opened — no additional `pg.Pool`. Putting it in
the layout instead would have leaked one connection per gated render in demo,
across all ten gated routes (plan review F5, `lessons.md` #3).

## Migration Notes

None. No schema change, no new column, no migration — the onboarding signal stays
derived. This deploys as code only, which matters given that code and migrations
ship on different tracks in this project.

## References

- Frame brief: `context/changes/onboarding-routing/frame.md`
- Research: `context/changes/onboarding-routing/research.md`
- Predicate and its pinned contract: `src/lib/onboarding.ts:28`,
  `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:277`
- Demo tenancy model and the Connections/Setup non-goal:
  `context/archive/2026-08-28-demo-mode/plan.md:90-104,456-458`
- The un-onboarding edge case:
  `context/archive/2026-08-23-team-management-surface/research.md:324-328`
- Two-doors card layout: `src/app/(app)/settings/connections/page.tsx:48`,
  `src/components/organisms/settings/integration-card.tsx:120-140`
- Server-action-as-prop and pure-view-sibling patterns:
  `src/components/organisms/demo/demo-panel.tsx:32-34`,
  `src/components/organisms/demo/demo-panel-view.ts:11-46`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The doorstep at `/setup`

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — a6a0f13
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — a6a0f13
- [x] 1.3 Unit tests pass, including new coverage of `setup-doorstep-view.ts`: `npm test` — a6a0f13
- [x] 1.4 Existing Playwright suite still green: `npm run test:e2e` — no regression (10 passed, 1 failed identically on the pre-change baseline; that row is `dashboard-sprint-detail.spec.ts:73`, which Phase 3 §3 already owns) — a6a0f13

#### Manual

- [x] 1.5 `/setup` on a fresh account shows the Polish doorstep, both doors, and no navigation links — while `/setup/github` still shows its navigation — a6a0f13
- [x] 1.6 On a GitHub-only account, the configure door points at `/setup/jira`, not back at `/setup/github` — a6a0f13
- [x] 1.7 "Zobacz demo" loads the demo and lands on a populated dashboard under the demo banner, real credentials untouched — a6a0f13
- [x] 1.8 Sign-out is reachable from the doorstep — a6a0f13

### Phase 2: Renumber the wizard to four steps and polonise its chrome

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — dddce35
- [x] 2.2 Type checking passes: `npx tsc --noEmit` — dddce35
- [x] 2.3 Unit tests pass: `npm test` — dddce35
- [x] 2.4 Playwright suite green, including the retargeted step assertion: `npm run test:e2e` — the retargeted assertion (`dashboard-sprint-detail.spec.ts:202`) passes; the same single pre-existing failure at `:73` persists unchanged — dddce35
- [x] 2.5 No stale step-count prose remains: `grep -rniE "of 3|3-step|three-step|step [1-3]\b" src e2e` — dddce35

#### Manual

- [ ] 2.6 Walking `/setup` → GitHub → Jira → Team shows "Krok 1 z 4" through "Krok 4 z 4", bar at 100% on the last step
- [ ] 2.7 `/settings/connections/github` still shows no step indicator

### Phase 3: The gate on `/dashboard`, and the e2e fixture

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — b6755a8
- [x] 3.2 Type checking passes: `npx tsc --noEmit` — b6755a8
- [x] 3.3 Unit tests pass: `npm test` — b6755a8
- [x] 3.4 Integration tests pass: `npm run test:integration` — b6755a8
- [x] 3.5 Full Playwright suite green, including the new doorstep spec: `npm run test:e2e` — 14/14, the first fully green run of this change; the long-standing failure at `dashboard-sprint-detail.spec.ts` was a stale Reliability assertion, repaired in place — b6755a8

#### Manual

- [ ] 3.6 A brand-new account signing up through the UI lands on the doorstep, and typing `/dashboard` bounces back to it
- [ ] 3.7 A fully configured account signs in and lands on `/dashboard` with no detour
- [ ] 3.8 Disconnecting GitHub from `/settings/connections` leaves the lead on Settings — not ejected — and reconnecting restores the dashboard
- [ ] 3.9 A demo account reaches `/dashboard` without ever being sent to the wizard

### Phase 4: The way back from demo

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 0785d21
- [x] 4.2 Type checking passes: `npx tsc --noEmit` — 0785d21
- [x] 4.3 Unit tests pass: `npm test` — 0785d21
- [x] 4.4 Integration tests pass: `npm run test:integration` — 0785d21
- [x] 4.5 Playwright suite green: `npm run test:e2e` — 0785d21

#### Manual

- [ ] 4.6 Demo entered from the doorstep on a fresh account shows "Dokończ konfigurację" on every gated screen, and it reaches `/setup`
- [ ] 4.7 With the real account configured, the banner renders without that link
- [ ] 4.8 Exiting demo on an un-onboarded real account lands back on the doorstep
- [ ] 4.9 End to end: fresh account → demo door → "Dokończ konfigurację" → GitHub + Jira + Team → Save & finish lands on the REAL dashboard with no demo banner

### Phase 5: Reconcile the written record

#### Automated

- [x] 5.1 Manual-test sweep passes: `node scripts/manual-test-sweep.mjs` — 79d18f3
- [x] 5.2 Lint passes: `npm run lint` — 79d18f3

#### Manual

- [ ] 5.3 Backlog row 13.7 is ticked or moved with a reason, and the new rows read as actionable to someone who has not read this plan
