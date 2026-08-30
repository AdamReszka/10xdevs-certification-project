---
date: 2026-08-29T21:43:45Z
researcher: Adam Reszka
git_commit: a9b3ce254b3dbbae357d229d7415287384822bf9
branch: feat/onboarding-routing
repository: 10xdevs-certification-project
topic: "First-run destination: wiring the onboarding predicate and building the wizard's doorstep"
tags: [research, codebase, onboarding, setup-wizard, demo-mode, routing, workspace, e2e]
status: complete
last_updated: 2026-08-29
last_updated_by: Adam Reszka
---

# Research: First-run destination for a new SprintFlow account

**Date**: 2026-08-29 21:43 UTC
**Researcher**: Adam Reszka
**Git Commit**: `a9b3ce254b3dbbae357d229d7415287384822bf9`
**Branch**: `feat/onboarding-routing`
**Repository**: 10xdevs-certification-project

## Research Question

`frame.md` reframed this change from "wire post-signup routing to `/setup`" to
"build the first-run **destination**" — a wizard step 0 that states what
SprintFlow needs and offers two doors (connect real data, or load the demo).
This research answers what `/10x-plan` needs before it can design that: how the
wizard is actually assembled, how demo/workspace machinery works and what it does
to the onboarding predicate, where a gate can physically live and what it costs,
what tests pin today's behaviour, and which prior decisions the doorstep would
touch or reverse.

Research was deliberately skipped when the change folder was opened (surface was
five files). The frame widened the surface past that point, so it was run now.

## Summary

**Seven findings change what the plan has to decide.**

1. **The wizard side is nearly free.** `/setup` is a 9-line unconditional
   `redirect()` that **nothing links to and no test asserts**
   (`src/app/(app)/setup/page.tsx:8`). Turning it into the doorstep breaks
   nothing by itself. The shell takes `step`/`totalSteps` as plain props with a
   `= 3` default inline in the destructuring
   (`src/components/templates/setup-wizard-shell.tsx:17`) — the step numbers are
   three literals at three call sites, nothing else derives them.

2. **The decisive fact for the gate: the demo fixture satisfies all six
   conditions of `isOnboardingComplete` — under the DEMO owner.** So a gate
   reading `resolveWorkspace().ownerId` lets a demo visitor through with zero real
   credentials, and a gate reading `requireRealWorkspace().ownerId` locks that same
   visitor out of `/dashboard` **forever**. The frame's rule ("the gate must not
   fire on `active_workspace = 'DEMO'`") turns out to be satisfiable without the
   predicate at all — `resolveWorkspace()` already returns `isDemo`, and the
   layout already calls it.

3. **A contract collision the frame did not have.** S-09 recorded
   *"No demo for Connections or Setup"* as an explicit non-goal
   (`context/archive/2026-08-28-demo-mode/plan.md:90-104`), and every page and
   action under `/setup/**` calls `requireRealWorkspace()` by contract. A "load the
   demo" door **on `/setup`** sits on the one route family declared always-real.
   The precise reading matters and the plan must state it (see Open Questions).

4. **The e2e blast radius is concentrated in one line.** `e2e/auth.setup.ts:31`
   signs up a fresh account through the UI and `waitForURL("**/dashboard")`. It is
   the `setup` project that the **entire** `chromium` project depends on
   (`playwright.config.ts:52,58`), so changing the post-signup destination fails
   every e2e test at once. A *server-side* gate breaks five more `/dashboard`
   entry points — including a **seeded** owner that does not satisfy the predicate.

5. **There is no data-driven redirect anywhere in this app today.** All four
   `redirect()` calls under `src/app/` are unconditional index redirects or
   auth-only. The established house idiom for "data is missing" is **conditional
   rendering of an honest empty state**, with the thesis already written down at
   `src/components/organisms/settings/integration-card.tsx:121-122`: *"Not
   connected is a normal state for a fresh account, not a failure — so it gets a
   route forward, not an error treatment."* A first-run gate is a new pattern for
   this codebase, not an instance of an existing one.

6. **The PRD contains the tension the doorstep resolves, and it is not recorded
   as an Open Question.** Access Control says *"Sign-up: on success, the user lands
   in the setup wizard"* (`prd.md:213`); US-02's **When** says *"they navigate to
   settings and click 'Load demo team'"* (`prd.md:77`). A doorstep honours both but
   **rewrites US-02's When clause**. Note also that the PRD says nothing at all
   about where **sign-in** lands.

7. **Cost is real but bounded and already diagnosed.** `isOnboardingComplete` is
   6 sequential `SELECT … LIMIT 1` with early exit (a brand-new account exits
   after 1), and the roadmap already warns against letting it drift into a loop
   (`roadmap.md:736-738`). The sharper cost is the **known, unfixed `pg.Pool`
   leak**: a `/dashboard` request already opens three pools that are never closed
   (`src/lib/db.ts:21-25`, deferred to the `db-pool-teardown` change). The
   predicate already takes `db` as a parameter, so it can thread an existing
   handle rather than adding a fourth.

**Two corrections to premises carried in `change.md` / `frame.md`:**

- The middleware is at the **repo root** `middleware.ts`, not `src/middleware.ts`
  (deliberately outside `src/`; see its `proxy.ts` comment at `middleware.ts:5-11`).
- There are **four** post-auth destinations, not three. The fourth is the wizard's
  own exit, `src/components/organisms/setup/cadence-form.tsx:142`.

## Detailed Findings

### 1. The setup wizard as it stands

**Route tree** — no `layout.tsx`, `loading.tsx` or `error.tsx` exists anywhere
under `src/app`:

| Route | File | Shape |
| --- | --- | --- |
| `/setup` | `src/app/(app)/setup/page.tsx:8` | 9 lines, `redirect("/setup/github")`, nothing else |
| `/setup/github` | `src/app/(app)/setup/github/page.tsx:41-45` | `<SetupWizardShell step={1}>` + status-or-form ternary |
| `/setup/jira` | `src/app/(app)/setup/jira/page.tsx:51-55` | `step={2}` |
| `/setup/team` | `src/app/(app)/setup/team/page.tsx:60-67` | `step={3} wide`, final |

`/setup/page.tsx:4-6` documents itself: *"Kept as a dedicated redirect so `/setup`
is a stable URL as later steps are added."* The comment anticipates growth; S-02's
plan pinned the redirect (`context/archive/2026-06-14-setup-github-integration/plan.md:145-147`).

None of the setup pages declares `force-dynamic` — it is declared once at
`src/app/(app)/layout.tsx:12` alongside `requireSession()` at `:32`, and every
setup page's header comment says not to re-declare it. A new `/setup` page
inherits both.

**Intra-wizard navigation (already shipped, do not redo):**
`src/components/organisms/setup/github-connection-status.tsx:84` → `/setup/jira`;
`jira-connection-status.tsx:93` → `/setup/team` (with the comment at `:90-91`:
*"The returning-user routing (skip a completed wizard) is onboarding-routing's."*);
`cadence-form.tsx:142` → `router.push("/dashboard")` on finish. One cross-link
inbound from Settings: `src/components/organisms/settings/jira-project-editor.tsx:118`
→ `/setup/team` ("Import sprint cadence").

**Nothing routes a user INTO the wizard.** `main-nav.tsx:10-15` carries Dashboard /
Sprint Detail / Settings / Refinement and no Setup item; `middleware.ts:33` does
not special-case `/setup`; no `href` anywhere targets `/setup` or `/setup/github`.

**The shell** (`src/components/templates/setup-wizard-shell.tsx`, 79 lines, server
component): props `step` (required), `totalSteps = 3` (default inline at `:17`),
`title`, `description?`, `wide?`, `children`. It computes
`pct = Math.round((step / totalSteps) * 100)` at `:41`, renders `Step {step} of
{totalSteps}` at `:52` and a hand-rolled `role="progressbar"` at `:56-68` (the
shadcn `progress` primitive is **not installed**).

The step count is hard-coded in **four** places: the shell default `:17`, the
shell docblock `:5,12-13`, the e2e assertion `e2e/dashboard-sprint-detail.spec.ts:222`,
and prose at `src/app/(app)/settings/connections/github/page.tsx:15-16`. It has
already been renumbered once — S-04 reconciled `4 → 3`
(`context/archive/2026-08-20-setup-team-roster-cadence/plan.md:5`).

A `step={0}` renders "Step 0 of 3" at 0%. Alternatively the doorstep can render
**without** the shell, which is the established alternative: the Settings connect
pages deliberately do not use it and carry their own chrome
(`src/app/(app)/settings/connections/github/page.tsx:44-61`, rationale at `:12-30`).

### 2. The `redirectTo` house pattern for dual-context surfaces

Not a mode enum — **one optional `redirectTo?: string` prop; absent = wizard, set
= Settings**. `src/components/organisms/setup/github-connect-form.tsx:58-71`
carries the docblock; the branch is one line at `:121-122`
(`if (redirectTo) router.push(redirectTo); else router.refresh();`). The only
other instance is `jira-connect-form.tsx:69-82` + `:189-190`.

The other half of the convention: **the page carries the chrome, the organism
carries none.** `src/app/(app)/settings/team/page.tsx:18-19` states it — *"Same
organism as the wizard, different chrome and different framing copy: the wizard
says 'review what we imported', Settings says 'this is your team'."*

**Settings → setup import surface** (the leak path): `settings/connections/page.tsx:11-12`
(both disconnect actions), `settings/connections/github/page.tsx:6`,
`settings/connections/jira/page.tsx:6`, `settings/team/page.tsx:3`, plus
`components/organisms/settings/repo-selection-editor.tsx:8` and
`jira-project-editor.tsx:10-11`. **Nothing under `settings/**` imports
`SetupWizardShell`** — so a change confined to `setup/page.tsx` +
`setup-wizard-shell.tsx` cannot leak into Settings.

### 3. Workspace, demo, and what they do to the predicate

**`resolveWorkspace()`** (`src/lib/workspace.ts:86-125`, `cache()`d, no args)
returns `{ ownerId, realOwnerId, isDemo, now }`. One query in REAL mode; two in
DEMO. DEMO is honoured only when a demo owner exists **and** `demoAnchorAt` is
non-null — otherwise it silently falls back to REAL (`:63-76`).
**`requireRealWorkspace()`** (`:132-135`) does no DB work at all — session only.

**`user.active_workspace`** is `NOT NULL DEFAULT 'REAL'` (`src/db/schema.ts:158-177`),
written by nothing at signup — Better Auth's `drizzleAdapter` inserts the row
(`src/lib/auth.ts:87-99`), so a fresh account is REAL by column default.
`autoSignIn: true` (`auth.ts:98`) means sign-up lands authenticated.

**`loadDemoAction()`** (`src/app/(app)/settings/demo/actions.ts:53-69`) is a
zero-argument, module-level `"use server"` export. It requires **only a session —
no credentials of any kind**, calls `loadDemo(...)`, flips `active_workspace` to
`'DEMO'`, revalidates, and returns `{ok:true} | {ok:false, error, message}`. It
**does not redirect**, so any caller must navigate itself.

It is already imported cross-tree — `src/components/organisms/demo/demo-banner.tsx:10`
imports `exitDemoAction` and that banner is rendered from `(app)/layout.tsx:46`.
So **a doorstep can call it with no new server code.** One caveat:
`WORKSPACE_SCOPED_PATHS` (`actions.ts:31-39`) lists seven paths and omits
`/setup/*`, `/settings/connections` and `/settings/anomalies` — a doorstep route
would need adding there, or its own `revalidatePath`.

**The fixture writes 20 tables under the demo owner** (`src/lib/demo/load.ts:82-120`,
~99 rows in one transaction), and it covers **every** condition of the predicate:

| `isOnboardingComplete` check | fixture source |
| --- | --- |
| `github_credential` | `src/lib/demo/fixture.ts:789-799` (real AES-GCM envelope over a fake token) |
| `monitored_repo` ≥1 | `fixture.ts:800-807` |
| `jira_credential` | `fixture.ts:714-730` |
| `jira_project` | `fixture.ts:731-740` |
| `status_mapping` ≥1 | `fixture.ts:741-748` (5 rows) |
| `team_member` ≥1 | `fixture.ts:159-172` (6 rows) |

`loadDemo` writes **nothing** under `realOwnerId` (asserted at
`src/lib/demo/load.integration.test.ts:293` — real credentials byte-identical
across load and reset). Hence:

- gate reads `resolveWorkspace().ownerId` → **passes** in demo, on zero real credentials;
- gate reads `requireRealWorkspace().ownerId` → **blocks a demo visitor permanently**.

The house precedent is to call **both** resolvers, each for its own concern, in
one render: `src/app/(app)/settings/connections/page.tsx:35-36` and
`src/app/(app)/setup/team/actions.ts:178-179`. Applied here, the natural shape is
*read `isDemo` from the already-cached `resolveWorkspace()` and short-circuit;
otherwise run the predicate on the real owner* — which satisfies the frame's rule
without the predicate ever seeing a demo id. The plan owns the decision.

Related: `enumerateOnboardedOwners` (`src/lib/integrations/sync/scheduled.ts:60-68`)
already filters `isNull(user.demoOf)` for exactly this reason — a demo owner
necessarily holds a `github_credential`.

**Demo discoverability today is three clicks with nothing signposting them**:
Settings nav → `/settings` (server redirect to `/settings/connections`,
`settings/page.tsx:9`) → "Demo" tab (`settings/layout.tsx:28`, the 6th and last)
→ "Zobacz demo" (`demo-panel-view.ts:72`). The landing page `src/app/page.tsx`
(85 lines) does not mention demo at all; `DemoBanner` links to `/settings/demo`
but renders only once you are already in demo (`(app)/layout.tsx:46`).

**The 2-second budget (US-02) has no test.** The only reference is a comment at
`src/lib/demo/load.ts:79`. The cost risk is `detectAnomalies` after the commit
(`load.ts:130`), which inserts anomalies **row-at-a-time inside a transaction**
(`src/lib/anomaly/detect.ts:62-104`) across ~10 tuned rules. `DemoPanel` already
handles the wait correctly (`useTransition`, disabled buttons, `Loader2`,
destructive `Alert` on failure, `router.refresh()` on success —
`demo-panel.tsx:47-68,93-106`), so the doorstep has a pattern to copy.

### 4. Where a gate can live, and what it costs

**Middleware is out, on the record.** `middleware.ts:13-17` (verbatim): *"getSessionCookie()
is an *optimistic* presence check (no DB hit — pairs with the cookie cache). It is
deliberately NOT the security boundary… Relying on a middleware cookie check alone
is 'NOT SECURE' per Better Auth docs (cf. CVE-2025-29927)."* It imports only
`getSessionCookie`; its matcher covers everything but Next internals and static
assets (`:56-61`); public prefixes are `["/", "/login", "/signup", "/reset",
"/api/auth", "/api/webhooks"]` (`:33`).

**`src/app/(app)/layout.tsx` is the natural site and already does the work**: 50
lines, `force-dynamic` at `:12`, `requireSession()` at `:32`, **`resolveWorkspace()`
at `:33`** (destructuring `{isDemo, now}`), `DemoBanner` at `:46`. Its docblock
(`:20-25`) sets the precedent verbatim — the banner lives there because *"the
active workspace is a database column, not a route segment"*, and `resolveWorkspace()`
is `cache()`d so *"it shares its query with the page below."*

**But a gate there sweeps all 19 `(app)` routes**, which produces both forbidden
outcomes at once:

| Route family | Routes | Effect of a naive layout gate |
| --- | --- | --- |
| wizard | `/setup`, `/setup/github`, `/setup/jira`, `/setup/team` | **infinite redirect loop** |
| settings | `/settings` + 9 sub-routes incl. `/settings/connections/**` | **the PAT-rotation ejection the frame rules out** |
| settings | `/settings/demo` | **traps the demo visitor** — the exact trap the frame named |
| product | `/dashboard`, `/dashboard/sprint-detail`, `/refinement`, `/refinement/runs/[runId]` | the intended target |

Once `/setup/**` and `/settings/**` are allowlisted, a layout gate covers only the
four product routes — at which point a per-page check in `/dashboard/page.tsx` is
a live alternative worth weighing in the plan.

**Cost.** `isOnboardingComplete` is 6 sequential `SELECT … LIMIT 1` with early
`return false` (`src/lib/onboarding.ts:35-77`) — a brand-new account exits after
one. The pool is the real cost: `getDb` builds `new Pool({max:1})` and **discards
the handle** (`src/lib/db.ts:14-17`), a leak documented as out of scope at
`db.ts:21-25`. A `/dashboard` request already opens **three** unclosed pools
(`requireSession`, `resolveWorkspace`, the page itself). React `cache()` dedupes
the call, not the pool count across distinct call sites. Mitigations available
with no new infrastructure: wrap the gate in `cache()` (precedent at `auth.ts:182`,
`workspace.ts:86`) and thread the existing `db` handle — the predicate already
takes `db` as a parameter.

**Un-onboarding is a live edge case, already recorded.**
`context/archive/2026-08-23-team-management-surface/research.md:324-328`:
*"whichever slice wires that predicate up inherits a 'Settings can un-onboard you'
edge case."* The reversibility paths are `disconnectGithub`
(`setup/github/actions.ts:163`, wired into Settings) and roster deletion
(`roster-store.ts:671,723`).

### 5. What the tests pin

**No unit or integration test asserts routing.** Grepping all 112
`src/**/*.test.ts(x)` for `middleware`, `main-nav`, `signup-form`, `login-form`,
`auth/layout` returns zero hits. `src/lib/onboarding.integration.test.ts` tests the
predicate directly against Postgres and is routing-agnostic (`:48` progressive
completion with no sprint required; `:112` owner-scoped isolation).

All the risk is in Playwright:

| `path:line` | Asserts | Breaks on a client-push change? | On a server gate? |
| --- | --- | --- | --- |
| `e2e/auth.setup.ts:31-34` | fresh UI signup → `**/dashboard` + Dashboard heading | **YES — cascades to the entire chromium project** | YES |
| `e2e/seed.spec.ts:36-42,50` | `goto("/dashboard")` → heading, sign-out visible | no | **YES** (unonboarded shared account) |
| `e2e/dashboard-sprint-detail.spec.ts:76-109` | `/dashboard` tabs reveal panels | no | **YES** |
| `…:124-137` | `/dashboard` → nav → Sprint Detail empty state | no | **YES** |
| `…:171-188` | fresh API-signup account → `/dashboard` → `/settings/connections` | no | **YES** |
| `…:204-222` | Settings is single-step; `/setup/github` shows `/Step 1 of 3/` | no | only if the gate sweeps `/settings/**` — i.e. **a useful regression guard for the no-ejection rule**; the `Step 1 of 3` half breaks on **renumbering** |
| `…:356` | seeded owner → `/dashboard/sprint-detail` | no | **YES** — the seed inserts `jira_credential`, `jira_project`, `sprint`, `team_member`, `jira_ticket` but **no `github_credential`, no `monitored_repo`, no `status_mapping`**, so `isOnboardingComplete` is **false** for it |
| `e2e/setup-github.spec.ts:26,45`, `e2e/setup-jira.spec.ts:26,43` | wizard step flows | no | no, **provided `/setup/**` is exempt** (mandatory anyway) |
| `e2e/seed.spec.ts:71-79`, `e2e/login-invalid-credentials.spec.ts:43,49-53` | signed-out redirects to `/login`; failed login stays put | no | no |

Two fixtures matter: `e2e/auth.setup.ts` signs up **through the UI** and is the
whole suite's dependency; `e2e/dashboard-sprint-detail.spec.ts:49-59`
`signUpFreshAccount()` signs up via `POST /api/auth/sign-up/email` with an explicit
`origin` header, **bypassing the UI** — unaffected by a client-push change,
affected by a server gate.

### 6. UI vocabulary the doorstep should inherit

Installed shadcn primitives (`src/components/ui/*`, 21): `alert`, `alert-dialog`,
`badge`, `button`, `calendar`, `card`, `chart`, `checkbox`, `collapsible`,
`dialog`, `form`, `input`, `label`, `scroll-area`, `select`, `sonner`, `switch`,
`table`, `tabs`, `textarea`, `tooltip`. **Absent** (would need `npx shadcn add`):
`separator`, `progress`, `skeleton`, `empty`.

- **The two-doors layout already exists**: `src/app/(app)/settings/connections/page.tsx:48`
  is a `grid gap-6 lg:grid-cols-2` of two `IntegrationCard`s, whose not-connected
  branch (`src/components/organisms/settings/integration-card.tsx:120-140`) is
  `Card` + title + *"Not connected."* + a bottom-pinned `mt-auto` CTA. Its comment
  at `:121-122` is effectively the doorstep's design thesis, already written.
- **The empty-state idiom** is a tiny, per-surface, non-exported local component:
  `src/components/organisms/anomaly/anomaly-inbox.tsx:201-207`
  (`rounded-lg border border-dashed p-10 text-center`). Its copy at `:84-95` names
  the cause and then names the route forward — and points at *"setup"* as plain
  prose with **no link**, which is the dangling reference this change closes.
- **The value-proposition layout** exists once, on the unauthenticated landing
  page `src/app/page.tsx:21-69` (eyebrow / `h1` / muted lede / two-button row).
- **The demo control pattern**: `src/components/organisms/demo/demo-panel.tsx`
  takes its server actions **as props**, not imports (`:32-34`), and its
  "which buttons are offered" logic lives in a pure sibling
  `demo-panel-view.ts` (state machine at `:11-46`) — because there is no
  component-test harness.

**Language is split**: English on every real-data surface (`setup/**`,
`settings/connections/**`, the landing page); **Polish on every demo surface**
(`demo-banner.tsx:41-46`, `demo-panel.tsx`, `settings/demo/page.tsx:38-45`). A
doorstep offering both doors straddles that line — a decision, not a detail.

**Atomic-design placement** follows three identical precedents (`setup/github/page.tsx:17-56`,
`setup/jira/page.tsx:17-68`, `setup/team/page.tsx:59-73`): the `page.tsx` is a thin
async server component doing auth + DB reads and picking an organism; every pixel
lives in `src/components/organisms/setup/*`. Any "which door is offered" decision
extracts to a pure `.ts` sibling (precedents: `demo-panel-view.ts`,
`roster-merge.ts`, `repo-selection.ts`, `inbox-controls.ts`).

## Code References

- `src/app/(app)/setup/page.tsx:8` — the 9-line unconditional redirect the doorstep replaces
- `src/components/templates/setup-wizard-shell.tsx:17,41,52` — `totalSteps = 3` default, `pct` arithmetic, the step label
- `src/components/organisms/setup/github-connect-form.tsx:58-71,121-122` — the `redirectTo` dual-context pattern
- `src/lib/onboarding.ts:28,35-77` — the predicate; `:16-18` names this change as its consumer
- `src/lib/workspace.ts:55-77,86-125,132-135` — `decideWorkspace`, `resolveWorkspace`, `requireRealWorkspace`
- `src/db/schema.ts:126-131,158-177` — `workspace_mode` enum, `demo_of`, `active_workspace NOT NULL DEFAULT 'REAL'`
- `src/app/(app)/settings/demo/actions.ts:31-39,53-69` — `WORKSPACE_SCOPED_PATHS`, `loadDemoAction`
- `src/lib/demo/load.ts:61-137` — the fixture transaction; `:130` post-commit `detectAnomalies`
- `src/lib/demo/fixture.ts:714-748,789-807,159-172` — the six rows that satisfy the predicate under the demo owner
- `src/app/(app)/layout.tsx:12,32,33,46` — `force-dynamic`, `requireSession`, `resolveWorkspace`, `DemoBanner`
- `middleware.ts:13-17,33,50,56-61` — the SECURITY NOTE, public prefixes, matcher
- `src/lib/db.ts:14-17,21-25` — the per-request pool and its documented leak
- `src/components/organisms/auth/signup-form.tsx:60`, `login-form.tsx:56`, `src/app/(auth)/layout.tsx:31`, `src/components/organisms/setup/cadence-form.tsx:142` — the four post-auth destinations
- `src/components/molecules/main-nav.tsx:8-9,10-15` — the nav, and its comment on why Settings is what made the wizard's pages reachable
- `src/components/organisms/settings/integration-card.tsx:120-140` — the two-doors card shape and its "not a failure" thesis
- `e2e/auth.setup.ts:14-15,31-34` — the suite-wide fixture that pins `**/dashboard`
- `e2e/dashboard-sprint-detail.spec.ts:222,356` — the `Step 1 of 3` assertion and the seeded owner that fails the predicate

## Architecture Insights

- **Demo is tenancy, not a flag** — three product tables are `UNIQUE(owner_id)`, so
  a per-row flag was impossible; all 25 owner FKs cascade, which makes reset exact
  by construction. The consequence for this change is that *every* owner-scoped
  question, including "is this account onboarded", now has two possible answers
  depending on which id it is asked about.
- **Mode lives in a column, not in the URL** — recorded at
  `context/archive/2026-08-28-demo-mode/plan.md:456-458`. That is why the demo
  banner is load-bearing, and why a doorstep's demo door must `router.refresh()`
  or navigate itself: nothing in the URL changes when the mode does.
- **Conditional rendering over redirects** is this codebase's answer to missing
  data, three times over (`setup/github/page.tsx:46`, `setup/jira/page.tsx:56`,
  `settings/connections/page.tsx:58`), plus the deliberate "No active sprint"
  empty state on Sprint Detail. Introducing a redirect gate is a genuinely new
  pattern here.
- **Wizard = first run; Settings = ongoing management; the wizard is not a nav
  item.** Settled across S-10, S-14, S-15 and restated in FR-009. Both mount the
  same organisms with different chrome and different framing copy.
- **Resolver-per-concern**: surfaces that need both the real account and the
  active workspace call both resolvers in one render rather than deriving one from
  the other.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:712-738` — **S-22, status `proposed`**, is this
  slice. It records that the predicate is *"BUILT AND UNUSED… zero production
  callers"*, that half the original change shipped via S-10's Settings tab, the
  hard *"Do NOT add 'Setup' as a standalone nav item"* rule, and the cost warning.
  ⚠️ Its prescribed shape is **"post-sign-up routing plus a prompt on the dashboard
  until onboarding completes"** — a *different* shape from the frame's doorstep.
  The roadmap entry will need amending, and it does not mention demo at all.
- `context/archive/2026-08-28-demo-mode/plan.md:90-104` — non-goals, including
  **"No demo for Connections or Setup. Those always show the real account;
  connecting an integration is not a thing to simulate."** Also
  `plan-brief.md:44`. The demo slice **never considered first-run entry** — it
  noted the missing gate as a convenience (`plan.md:47-49`: *"the dashboards are
  not gated on setup completion, so a demo owner needs no routing work to
  render"*). The gap is inherited, not decided.
- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:277` — the pinned
  `isOnboardingComplete` contract, including the F1 finding that forced cadence out
  of it (a team onboarding between sprints would otherwise never finish the wizard,
  `reviews/plan-review.md:32`). `plan.md:46-47` assigns all routing/gate wiring to
  this change.
- `context/archive/2026-08-19-setup-jira-integration/plan.md:120-130` — the
  "Continue →" links were excluded from S-03, then shipped anyway on the owner's
  request; `reviews/impl-review.md:33` flags the silent overlap with this change.
  Build on them, do not redo them.
- `context/archive/2026-08-23-team-management-surface/research.md:324-328` — the
  inherited *"Settings can un-onboard you"* edge case.
- `context/archive/2026-08-20-data-sync-engine/plan.md:403` — the predicate is
  6 queries per owner; reserved for a single request path, never loop enumeration.
- `context/archive/2026-08-21-dashboard-sprint-detail/MANUAL-CHECKLIST.md:63` —
  a **ticked** promise that *"a fresh sign-up (no setup at all) reaching this route
  from the nav gets the empty state, not an error page."* A doorstep redirect must
  be checked against it.
- **Nothing anywhere in `context/` proposes a welcome screen, a doorstep, or a
  step 0.** Grepping for `welcome`, `doorstep`, `step 0`, `ekran powitalny`,
  `pierwsze uruchomienie` returns no relevant hits outside this change's own
  folder. The only prior framing of first-run is "route them into the wizard".

**PRD, verbatim, for the plan to check against:**

- `prd.md:213` — *"**Sign-up:** email + password. On success, the user lands in the
  setup wizard."* (Nothing is said about where **sign-in** lands.)
- `prd.md:77` (US-02 **When**) — *"they navigate to settings and click 'Load demo
  team'"*.
- `prd.md:39-40` — both primary Success Criteria begin at sign-up: one completes
  the wizard with real credentials, the other *"signs up, clicks 'Load demo team'"*.

**Manual testing:** `context/foundation/manual-test-backlog.md:1464-1489` row
**13.7** is untickable today and says so explicitly — the tester verified that
*"konto tuż po rejestracji, z zerem integracji, weszło prosto na `/dashboard`: nic
nie skierowało go do kreatora"*, and the row *"zamknie się sam wraz z S-22"*. All
eight demo rows (§12) are open; `context/manual-tests/` holds **no** failed-test
note for setup, signup or demo.

**Lessons that bite here** (`context/foundation/lessons.md`):

- *"Test the no-configuration path through the real resolver, not through an
  injected dependency"* — the sharpest match. This change's entire subject is the
  no-configuration path, and its central artifact is a predicate tested in
  isolation and never wired. Any test of the doorstep must go through the real
  routing path with an empty account, not a mocked predicate.
- *"A narrowing predicate turns 'wrong value' into 'empty result', which reads as
  success"* — a 6-query predicate deciding what to render will fail by showing an
  ordinary-looking screen, not an error.
- *"Request-scoped `pg.Pool` must be closed at request end"* — the roadmap's own
  S-22 cost warning is a variant of it; the leak is unfixed (`db-pool-teardown`).
- *"A deploy that ships code but not migrations breaks silently"* — applies only
  if the doorstep adds a column (e.g. a "seen it" flag). If it does, it needs a
  named production route in `## Migration Notes` plus a first-running checklist row.

## Related Research

- `context/archive/2026-08-28-demo-mode/plan.md` — the tenancy model and the
  Connections/Setup non-goal
- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md`,
  `research.md` — the predicate's contract and its coordination note with this change
- `context/archive/2026-08-23-team-management-surface/research.md` — the
  un-onboarding edge case and the wizard-vs-Settings split
- `context/changes/onboarding-routing/frame.md` — the reframe this research serves

## Open Questions

1. **Does the demo door belong on `/setup`?** S-09's *"No demo for Connections or
   Setup"* means those surfaces always **render the real account**; it does not
   obviously forbid a **button that initiates** a demo load (`loadDemoAction` itself
   calls `requireRealWorkspace()` internally). The two readings differ, and the plan
   must state which one it takes rather than leaving the non-goal ambiguous. The
   alternative placements — the landing page `src/app/page.tsx`, or a distinct
   `/welcome` route outside `(app)` conventions — carry their own costs.
2. **Which id does the gate ask about, and does it need the predicate at all in
   demo?** Evidence points at: short-circuit on `isDemo` from the already-cached
   `resolveWorkspace()`, and run the predicate on the real owner otherwise. Not
   decided here.
3. **Where does the gate live** — `(app)/layout.tsx` with an allowlist that must
   cover `/setup/**` (loop) and `/settings/**` (ejection), leaving only four product
   routes; or a per-page check in `/dashboard/page.tsx`? The second is closer to the
   house idiom and has a far smaller e2e blast radius.
4. **Does the wizard renumber?** Step 0 of 3 at 0%, four steps (touching three
   pages, the shell default, one e2e assertion and two prose strings), or a doorstep
   that renders without the shell entirely (Settings-connect-page precedent).
5. **What language is the doorstep?** It is the first surface that must speak to
   both the English real-data path and the Polish demo path.
6. **How is `e2e/auth.setup.ts` rewritten** — wait for the new destination, or seed
   onboarding via API before waiting? It gates the entire suite, so this is a phase-1
   decision, not cleanup. The seeded owner at `dashboard-sprint-detail.spec.ts:29-54`
   also needs `github_credential` + `monitored_repo` + `status_mapping` added if a
   server gate sweeps `/dashboard/**`.
7. **Does sign-in route too, or only sign-up?** The PRD constrains only sign-up.
   The frame's pre-dispatch notes include the returning incomplete user; the
   reversibility break (a lead who disconnects to rotate a PAT) argues for treating
   the two differently.
8. **Is the 2-second demo budget actually met over Hyperdrive?** No test asserts
   it, and `detectAnomalies` inserts row-at-a-time. If the doorstep advertises the
   demo door, this becomes user-visible on the first click.
9. **Does the PRD get amended?** US-02's *When* clause and the roadmap's S-22
   shape both describe the pre-doorstep world. Neither the Access-Control/US-02
   tension nor the demo-as-first-run-door question is currently recorded as an Open
   Question in the PRD.
