# Demo mode (S-09 / FR-008) Implementation Plan

## Overview

Give SprintFlow a first-class concept of **demo data** by expressing it as a
second, synthetic *owner* on the same account — same tables, different
`owner_id` — and build the FR-008 "Load demo team" / "Reset demo data" surface
on top of it. Demo anomalies are produced by the **real detection engine**
against fixture rows, evaluated at a **frozen clock**, so the demo reads as one
coherent moment however long after loading it is viewed, and survives every
reconcile the engine performs.

## Current State Analysis

FR-008 has no implementation. The only demo path is `scripts/seed-dashboard.mjs`
(`npm run db:seed:demo`), a Node CLI outside the app that writes fixture
literals into the same owner-scoped tables the real sync owns. Three properties
of the current code decide this plan's shape:

- **Nothing marks a row as demo.** Demo is impersonated by fake-but-validly-
  encrypted credentials plus hand-written rows (`seed-dashboard.mjs:1-38`).
- **`owner_id` is UNIQUE on three tables** — `github_credential:210`,
  `jira_credential:229`, `jira_project:269`. One owner therefore *cannot* hold a
  real and a demo Jira project at once, which rules out an `is_demo` column
  without relaxing three constraints and touching every consumer.
- **All 25 owner foreign keys are `ON DELETE CASCADE`** (25/25 in
  `src/db/schema.ts`). Deleting one owner row deletes exactly that owner's
  world.

The load path today is destructive: the script `DELETE`s 14 tables by
`owner_id`, `github_credential` and `jira_credential` among them
(`seed-dashboard.mjs:196-226`). Under the settled scope — any account may load
demo, including one holding real tokens — that contract is actively dangerous.

Demo anomalies are also not durable: the script inserts `anomaly` rows directly
(`seed-dashboard.mjs:354+`), while `detectAnomalies` is a full reconcile per
`(owner, sprint)` that flips every ACTIVE row whose `dedupKey` is not re-detected
to RESOLVED (`detect.ts:119-128`). It is reachable from cron
(`scheduled.ts:100`), "Sync now" (`sync/actions.ts:92`) and — with no
credentials involved at all — saving an absence
(`settings/absences/actions.ts:223`).

### Key Discoveries

- **`ownerId` is resolved inline as `session.user.id` at ~22 source files**
  (pages + server actions). There is no existing seam; this plan introduces one.
- **`isOnboardingComplete` has no caller in routing** (`src/lib/onboarding.ts:28`
  is referenced only by comments and tests). The dashboards are not gated on
  setup completion, so a demo owner needs no routing work to render.
- **The frozen clock is a narrow change, not an audit.** Each dashboard page
  holds exactly one `new Date()` (`dashboard/page.tsx:48`,
  `sprint-detail/page.tsx:53`) and threads it down. Anomaly ages are baked at
  detection time (`inbox-view.ts:28`), so a frozen detection `now` freezes the
  inbox copy permanently. There is exactly **one** browser clock in the tree, and
  it needs stating precisely (plan-review F5): `describeLastSend(row, now: Date =
  new Date())` (`recap-settings-view.ts:35`) is called with one argument from
  `recap-settings-form.tsx:120`, which is `"use client"` — so that default IS
  evaluated in the browser, and it feeds a real comparison
  (`now.getTime() - claimedAt >= CLAIM_TTL_MS`, `:47-49`). The comparison sits on
  the `PENDING` branch only, which is why the demo's terminal `send_status`
  (Phase 5 §1) keeps it unreachable — a coupling that must be deliberate, not
  incidental.
- **A demo owner MUST have a `github_credential` row.** `github_commit.repo_id →
  monitored_repo.credential_id → github_credential.id` is NOT NULL the whole way
  (`schema.ts:677-690`, `247-258`). Therefore the demo owner *will* match
  `enumerateOnboardedOwners`, which inner-joins `jira_project × github_credential`
  (`scheduled.ts:49-55`) and drives both sync **and** Daily Recap sending. The
  exclusion is mandatory, not defensive.
- **Prior art for the failure class.** `jira_sprint_id=1001` and the
  `alice-kim` roster keys were both fixed per-table at the consumer
  (`lessons.md` § narrowing predicate; `roster-store.ts:118-126`). Neither
  introduced the missing concept, which is why anomalies are the third instance.

## Desired End State

A signed-in user finds a **"Zobacz demo"** control in Settings. Clicking it
creates a demo owner for their account, loads a realistic mixed-state sprint,
runs detection, and switches the app to demo. Every screen except Connections
and Setup now reads the demo team; a persistent banner says they are in demo
mode and offers a way out. Dashboard "Today" shows at least four distinct
anomaly types **produced by the detection engine**, alongside healthy-flow
signals; Dashboard "Sprint Detail" renders the aging report, activity matrix and
sub-burndowns. Absences and roster edits work and take effect. "Reset demo data"
removes the demo world exactly, with no possible reach into real data.

Verified by: the integration suite (load produces ≥4 anomaly types via the
engine; reset leaves zero demo rows; loading demo on an account with real
credentials leaves those credentials byte-identical), plus manual walkthrough.

## What We're NOT Doing

- **No `is_demo` column and no duplicated tables.** Rejected during planning —
  see Key Decisions in the brief.
- **No demo for Connections or Setup.** Those always show the real account;
  connecting an integration is not a thing to simulate.
- **No live AI or outbound email in demo.** Refinement and Daily Recap show
  pre-made fixture results with their action buttons disabled.
- **No second fixture, and no second entry point.** `seed-dashboard.mjs` is
  deleted outright (plan-review F4); the fixture lives once, in
  `src/lib/demo/fixture.ts`, reached only through `loadDemo()`.
- **No demo login.** The demo owner has no `account` row and cannot be signed
  into; it is a data scope, not a user.
- **No re-anchoring of demo timestamps over time.** The clock is frozen, not
  refreshed.

## Implementation Approach

Demo is modelled as tenancy, not as a flag. The account's real `user` row gains
`demo_of` (pointing the other way, from demo row to real row),
`active_workspace`, and `demo_anchor_at`. Every read and write in the app then
goes through one resolver that answers "which owner, and what time is it for
them" — so the isolation guarantee for demo is the *same mechanism already
trusted to isolate two real customers*, and there is one place to get it right
instead of twenty-five.

Anomalies come from `detectAnomalies` run on fixture rows at the anchor instant.
Because both the data and the clock are fixed, re-detection is idempotent: the
reconcile that today would resolve away hand-written rows now re-derives exactly
the same set. The frame's dimension-4 defect stops being contained and starts
being absent.

## Critical Implementation Details

**Ordering at load.** The demo `user` row must exist before any owner-scoped
insert (25 FKs point at it), and `detectAnomalies` must run **after** the whole
fixture is committed — it reads a snapshot, so a partial write yields a partial
anomaly set that then looks authoritative. Load is therefore: create owner →
insert fixture in one transaction → commit → detect at anchor.

**The reset guard is a compound predicate, not a comment.** `resetDemo` deletes
`WHERE id = <demoOwnerId> AND demo_of = <realOwnerId>`. The second term is what
makes it impossible for a stale or forged id to delete a real account, and it
must be in the SQL, not checked beforehand in TypeScript.

**Cron exclusion cannot rely on absent credentials.** As established above the
demo owner necessarily holds a `github_credential`, so `enumerateOnboardedOwners`
needs an explicit `demo_of IS NULL` filter. Without it the cycle attempts a real
GitHub/Jira sync with a fake token every 15 minutes and — worse — hands the demo
owner to `sendDailyRecap`.

---

## Phase 1: Demo tenancy in the data model

### Overview

Add the three columns and the single resolver that every later phase depends on.
Nothing calls the resolver yet, so this phase is inert by design and can land
without touching behaviour.

### Changes Required

#### 1. Schema + migration

**File**: `src/db/schema.ts`, `src/db/migrations/0017_*.sql`

**Intent**: Express "this user row is a demo scope belonging to that user row",
"which scope is this account currently viewing", and "what instant is frozen for
the demo". Keeping all three on `user` means demo lifecycle is one row's
lifecycle.

**Contract**: New `workspace_mode` pgEnum (`REAL`, `DEMO`). On `user`:
`demoOf: text("demo_of").references(() => user.id, { onDelete: "cascade" })`
(nullable — NULL means "this is a real account"; self-referential, so deleting
the real user takes its demo with it); `activeWorkspace: workspaceMode("active_workspace").notNull().default("REAL")`;
`demoAnchorAt: timestamp("demo_anchor_at")` (nullable; set only on demo rows).
Partial unique index on `demo_of` so an account can have at most one demo owner.
Generate via `npm run db:generate`; do not hand-write the SQL.

#### 2. Workspace resolver

**File**: `src/lib/workspace.ts` (new)

**Intent**: The one seam that answers "which owner am I reading, and what is
`now` for them". Everything downstream consumes this instead of
`session.user.id`.

**Contract**: `resolveWorkspace()` → `{ ownerId, realOwnerId, isDemo, now }`.

**It is built on `requireSession()`, NOT `getOptionalSession()`** (plan-review
F2). This resolver REPLACES the `session.user.id` read at ~22 call sites, and in
this codebase that read is load-bearing for authorization, not just for identity:
the `(app)` layout guards *pages*, but a Server Action is its own entry point and
guards itself — all 25 of them call `requireSession()` directly
(`dashboard/actions.ts:56,89`, `settings/absences/actions.ts:65…187`,
`connections/actions.ts:58…259`, `setup/**`, `refinement/actions.ts:75`). A
resolver built on the non-throwing `getOptionalSession()` — which returns `null`
for a missing session AND for a Hyperdrive blip (`auth.ts:181-193`) — would let
an implementer delete the guard along with the id and run actions with
`ownerId: undefined`. So: no session ⇒ redirect to `/login`, exactly as today.

Given a session, it reads the user row's `activeWorkspace`; when `DEMO`, looks up
the demo owner (`demo_of = realOwnerId`) and returns its id plus
`now = demoAnchorAt`. Falls back to REAL whenever the demo owner is missing or
`demoAnchorAt` is NULL — a half-created demo must never render as demo. Wrapped
in React `cache()`, mirroring `getOptionalSession` (`auth.ts:181`), so the layout
guard and the page share one query per render. Also export
`requireRealWorkspace()` — same session guard — returning
`{ ownerId: realOwnerId }` for Connections/Setup, so those call sites read as a
deliberate choice rather than an omission.

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npm run db:migrate`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- New unit tests cover the resolver's fallbacks: DEMO with no demo owner → REAL; DEMO with NULL anchor → REAL; REAL → real id and live clock
- New unit test: with no session, `resolveWorkspace()` and `requireRealWorkspace()` redirect and never return an `ownerId` (the F2 guard)

#### Manual Verification

- App builds and every existing screen behaves exactly as before (this phase changes no behaviour)

---

## Phase 2: Demo owner lifecycle and the fixture

### Overview

Build `loadDemo()` and `resetDemo()` server-side, port the fixture out of the
`.mjs` script into a typed module, and make the demo owner invisible to cron.
Still no UI — this phase is proven by integration tests.

### Changes Required

#### 1. Fixture data module

**File**: `src/lib/demo/fixture.ts` (new)

**Intent**: The dataset from `scripts/seed-dashboard.mjs`, ported to TypeScript
and expressed as **offsets from an anchor** rather than absolute dates, so one
description serves any load instant.

**Contract**: Exports a pure `buildDemoFixture(anchor: Date, ownerId: string)`
returning the full row set — `jira_credential`, `jira_project`, `sprint`,
`status_mapping`, `team_member`, `absence`, `team_day_off`, `sync_state`,
`github_credential`, `monitored_repo`, `github_commit`, `github_pull_request`,
`github_review`, `jira_ticket`, `jira_status_history`, `sprint_measurement`.
**No `anomaly` rows** — those are the engine's output now.

The last two are additions the seed script never had (plan-review F3), and they
are not optional decoration: Dashboard "Today" renders `ReliabilityKpi` and
`VelocityEstimatePanel` off `getSprintMeasurement` /
`listSprintMeasurementsForOwner` (`dashboard/page.tsx:6,9,22-24`), and the
Availability headline reads `team_day_off`. Nothing else can fill them — the
sweep that writes measurements is the cron path this phase deliberately excludes
— so without fixture rows two of the four FR-016 panels open on their empty
state in a demo whose whole purpose is to show the product working. Include at
least **two finalized `sprint_measurement` rows** (FR-024 withholds the estimate
below two closed sprints), one of them with an absence-reduced adjusted capacity
so the normalisation FR-023 performs is visible rather than theoretical, and a
`team_day_off` row or two consistent with the sprint window. Offsets keep the existing `h(n)` semantics
(`seed-dashboard.mjs:130`) and the `Europe/Warsaw` project zone, and the
whole-day helpers for absences (`seed-dashboard.mjs:140-192`) are replaced by the
real `src/lib/absence-dates.ts`, which the script could only mirror.

#### 2. Fixture must trigger the engine

**File**: `src/lib/demo/fixture.ts`

**Intent**: With anomalies no longer hand-written, the fixture's dates and sizes
are what produce them. Tune the rows so `detectAnomalies` at the anchor yields at
least four distinct types plus visible healthy-flow signals (US-02 / S-09 risk).

**Contract**: Row shapes must cross the **default** thresholds in
`src/lib/anomaly/thresholds.ts` — the demo owner has no `anomaly_settings`
overrides, so defaults are what apply. Target set: `PR_REVIEW_STALLED`,
`TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`,
`PR_TOO_BIG`, `PR_TICKET_DESYNC`, `SCOPE_CREEP`, `SPRINT_AT_RISK`. Healthy-flow
counter-examples (merged PRs reviewed inside the window, tickets moved to Done
with linked commits) must remain untouched by any rule.

#### 3. Load and reset

**File**: `src/lib/demo/load.ts` (new)

**Intent**: Create the demo owner, write the fixture, run detection at the
anchor; and remove it all again, exactly.

**Contract**: `loadDemo({ db, realOwnerId, now })` — inserts a `user` row
(`id: randomUUID()`, `name: "Demo team"`, `email: \`demo+${realOwnerId}@sprintflow.invalid\``,
`demoOf: realOwnerId`, `demoAnchorAt: now`) and **no `account` row**, so it
cannot be signed into; writes the fixture inside one transaction; commits; then
calls `detectAnomalies({ db, ownerId: demoOwnerId, now: anchor })`. Idempotent:
an existing demo owner is reset first. `resetDemo({ db, realOwnerId })` —
`DELETE FROM "user" WHERE demo_of = $realOwnerId`, relying on the 25 cascades;
returns whether a row was removed. Tokens written for the demo credentials keep
the real AES-GCM envelope via `src/lib/crypto.ts` (the script's duplicated
`encryptSeedToken` is dropped — the app can import the real one).

#### 4. Hide the demo owner from the scheduler

**File**: `src/lib/integrations/sync/scheduled.ts`

**Intent**: Stop the 15-minute cycle from syncing a fictional account and, more
importantly, from handing it to `sendDailyRecap`.

**Contract**: `enumerateOnboardedOwners` joins `user` and adds
`isNull(user.demoOf)` to its `where`. Keep it one set-based query — the existing
comment at `:43-48` about not going per-owner still governs.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- New integration test: `loadDemo` produces ACTIVE anomalies of **≥4 distinct types**, all written by `detectAnomalies` (no direct `anomaly` insert exists in `src/lib/demo/`)
- New integration test: re-running `detectAnomalies` at the same anchor after `loadDemo` resolves **zero** anomalies (idempotence — the frame's dimension-4 regression guard)
- New integration test: `resetDemo` leaves zero rows for the demo owner across every owner-scoped table, and the `user` row is gone
- New integration test (the safety property): with real GitHub + Jira credential rows present for the real owner, `loadDemo` then `resetDemo` leaves both rows byte-identical
- New unit test: `enumerateOnboardedOwners` excludes an owner whose `demo_of` is set even though it has both `jira_project` and `github_credential`

#### Manual Verification

- `npm run db:seed:demo` still populates a local account (script untouched in this phase; it is deleted in Phase 5)

---

## Phase 3: Thread the effective owner and the frozen clock

### Overview

Replace inline `session.user.id` with the resolver across the app, and make the
demo's `now` reach detection and the dashboards. This is the phase where demo
becomes visible — via the DB column only; the controls arrive in Phase 4.

### Changes Required

#### 1. Demo-aware surfaces

**File**: `src/app/(app)/dashboard/page.tsx`, `dashboard/sprint-detail/page.tsx`,
`dashboard/actions.ts`, `settings/team/page.tsx`, `settings/absences/page.tsx`,
`settings/absences/actions.ts`, `settings/recap/page.tsx`,
`settings/recap/actions.ts`, `refinement/page.tsx`, `refinement/actions.ts`,
`refinement/runs/[runId]/page.tsx`

**Intent**: These follow the active workspace. Each replaces its own
`session.user.id` and, on the two dashboards, its own `new Date()`.

**Contract**: `const { ownerId, isDemo, now } = await resolveWorkspace()`. The
dashboards drop their local `const now = new Date()` and use the resolved `now`
— it is already threaded to every reader below them, so nothing else changes.

#### 1b. The roster editor's actions follow the page, not their directory
(plan-review F1)

**File**: `src/app/(app)/setup/team/actions.ts`

**Intent**: **Classification is per action, not per directory.** `/settings/team`
is a demo-aware page, but the organism it renders
(`src/components/organisms/setup/roster-editor.tsx:27`) imports NINE server
actions from `setup/team/actions.ts`. Left under the §2 blanket rule, demo would
READ the demo roster and WRITE against the real owner — `saveRoster` refuses
outright (`roster-store.ts:327-341`, `UnknownMemberError` rejects a submitted id
outside the caller's set), `importRosterAction` calls the REAL GitHub/Jira APIs
from the demo surface, and `confirmAvailabilityAction` mutates the real team
while the banner says "demo". The plan's own end state — "roster edits work and
take effect" — requires this split.

**Contract**: The roster-mutating and roster-reading actions —
`saveRosterAction`, `setMemberActiveAction`, `deleteMemberAction`,
`mergeMembersAction`, `getMemberHistoryAction`, `confirmAvailabilityAction` —
resolve their owner with `resolveWorkspace()`. The two that reach outside the
app — `importRosterAction`, `importCadenceAction` — keep
`requireRealWorkspace()` **and** return a typed demo refusal, the same shape as
`syncNow()` in §2; Phase 4 disables their controls. `saveCadenceAction` follows
the workspace (cadence is demo-editable). The wizard's own pages
(`setup/team/page.tsx`) stay always-real per §2, so the pinning must be explicit
at each action rather than inherited from the file.

#### 2. Always-real surfaces

**File**: `src/app/(app)/settings/connections/**`, `src/app/(app)/setup/**`
(pages; for `setup/team/actions.ts` see §1b),
`src/lib/integrations/sync/actions.ts`

**Intent**: Integration configuration is never simulated. Make that explicit at
each call site rather than leaving it to whoever reads the diff.

**Contract**: `const { ownerId } = await requireRealWorkspace()`. Additionally
`syncNow()` refuses while the account is in demo mode, returning a typed failure
the UI renders as an explanation (Phase 4 disables the button; this is the
server-side half, and it is the one that matters).

#### 3. Detection at the demo clock

**File**: `src/app/(app)/settings/absences/actions.ts`

**Intent**: An absence saved in demo must re-detect at the frozen anchor, not at
the live clock — otherwise one absence save ages the whole demo by however long
it has existed.

**Contract**: `redetect()` (`:220`) takes `now` and passes it through to
`detectAnomalies`; callers supply the resolved workspace `now`. Its
never-throws contract is unchanged.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- New integration test: with `active_workspace = DEMO`, the dashboard readers return demo rows and the real owner's rows are absent from the result
- New integration test: saving an absence in demo re-detects at the anchor — the anomaly set is unchanged apart from the absence's own documented effects (FR-010 suppression + SPRINT_AT_RISK)
- New unit test: `syncNow()` in demo mode returns the typed refusal and never calls `syncOwner`
- New integration test: in demo, `saveRosterAction` writes the edited member under the DEMO owner and the real owner's `team_member` set is byte-identical afterwards
- New unit test: `importRosterAction` and `importCadenceAction` in demo return the typed refusal and never construct a GitHub or Jira client
- `grep -rn "session.user.id" src/app src/lib` returns only the resolver's own use and the always-real call sites
- Every `"use server"` file still reaches an auth guard on every exported action — the resolver replaces the ID read, never the guard (`grep -c "requireSession\|resolveWorkspace\|requireRealWorkspace"` per action file is ≥ its exported-action count)

#### Manual Verification

- With `active_workspace` flipped to `DEMO` by hand in the DB, both dashboards render the demo team; Connections still shows the real (or absent) integrations

---

## Phase 4: The FR-008 surface

### Overview

The controls and the banner — the part the user actually asked for.

### Changes Required

#### 1. Demo settings section

**File**: `src/app/(app)/settings/demo/page.tsx` (new),
`src/app/(app)/settings/demo/actions.ts` (new),
`src/components/molecules/settings-tabs.tsx` consumer at
`src/app/(app)/settings/layout.tsx`

**Intent**: Give demo a home in the existing tabbed settings shell, which was
built to absorb exactly this (`settings/layout.tsx:6-25`).

**Contract**: New tab `{ label: "Demo", href: "/settings/demo" }`. Three server
actions: `loadDemoAction` (calls `loadDemo`, then sets
`active_workspace = DEMO`), `exitDemoAction` (sets `REAL`; **keeps** the data so
the user can return), `resetDemoAction` (sets `REAL`, then `resetDemo`). Each
`revalidatePath`s the app routes. The page renders current state — no demo /
demo loaded, viewing real / demo loaded, viewing demo — and offers only the
transitions valid from it.

#### 2. Demo-mode banner

**File**: `src/components/organisms/demo/demo-banner.tsx` (new),
`src/app/(app)/layout.tsx`

**Intent**: Because the mode lives in the DB and not in the URL, the banner is
the only thing telling the user what they are looking at. It is load-bearing, not
decorative.

**Contract**: Rendered by the `(app)` layout above `{children}` whenever
`resolveWorkspace().isDemo`. States "Jesteś w trybie demonstracyjnym", names the
frozen date the data depicts, and carries an "Wyjdź z demo" button posting
`exitDemoAction`. Use shadcn `Alert` (already present at
`src/components/ui/alert.tsx`); check `@shadcn` MCP before adding anything new.

#### 3. Disable integration actions in demo

**File**: `src/app/(app)/settings/connections/page.tsx` and its client organisms

**Intent**: "Sync now" and "Test connection" are meaningless against a fake
token; the server already refuses them (Phase 3), so the UI should say why
rather than let the user discover it.

**Contract**: Both controls render disabled with an explanatory line while
`isDemo`. Connections still shows the **real** account's integration state
throughout.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- New integration test: `loadDemoAction` → `active_workspace = DEMO` and a demo owner exists; `exitDemoAction` → `REAL` with demo rows intact; `resetDemoAction` → `REAL` with the demo owner gone
- New unit test: the settings-demo view function offers only the transitions valid for each of the three states

#### Manual Verification

- `/settings/demo` → "Zobacz demo" completes in under 2 seconds (US-02) and lands on a populated Dashboard "Today"
- The Reliability KPI and the velocity-estimate panel both show numbers (not their no-data state), and the capacity headline names the demo's days off
- The Anomaly Inbox shows at least four distinct anomaly types, each with severity, description, context, suggested action and a source link
- Sprint Detail renders the aging report, the activity matrix and the per-technology sub-burndowns with realistic numbers
- The banner is visible on every screen in demo; "Wyjdź z demo" returns to the real account with real data intact
- On an account holding real GitHub + Jira credentials: load demo, then reset demo, then open Connections — both integrations are still connected and still show their original `token_last4`

---

## Phase 5: No external effects, and one fixture

### Overview

Close the two screens that can reach outside the app, and retire the CLI script
so there is one dataset reached through one entry point.

### Changes Required

#### 1. Refinement and recap fixture rows

**File**: `src/lib/demo/fixture.ts`

**Intent**: Both screens are in demo scope, so both must have something to show;
neither may call out.

**Contract**: Add one `refinement_run` with several `refinement_ticket_verdict`
children — including at least one `DOR_MET` verdict and one with gaps, per
FR-020's both-halves requirement — and one `daily_recap` row with a populated
`payload` / `rendered_message` and `send_status` set to a terminal value so no
sender ever claims it. **The terminal status is load-bearing twice** (plan-review
F5): besides keeping the row out of the sender's reach, it is what keeps the one
browser clock in the tree out of the demo — `describeLastSend` compares
`Date.now()` against `last_attempt_at` on the `PENDING` branch alone
(`recap-settings-view.ts:47-49`, called client-side from
`recap-settings-form.tsx:120`). A `PENDING` demo recap row would therefore be a
frozen-clock regression, not a cosmetic choice. `refinement_run.model` records the pinned
`claude-sonnet-5` for legibility.

#### 2. Disable the outbound actions

**File**: `src/app/(app)/refinement/actions.ts`,
`src/app/(app)/settings/recap/actions.ts` and their organisms

**Intent**: Server-side refusal first, disabled control second — the same order
as `syncNow` in Phase 3.

**Contract**: Both actions return a typed refusal while `isDemo`; the "Uruchom
analizę" and any send/test-send control render disabled with a one-line
explanation. No Anthropic client is constructed and no transport is reached on
the demo path.

#### 3. The seed script goes away entirely

**File**: `scripts/seed-dashboard.mjs` (deleted), `package.json`

**Intent**: One dataset, and one entry point to it. Phase 2 already moved the
dataset into `src/lib/demo/fixture.ts`, which is what actually closes the
parallel-fixture class `frame.md` names — the script's remaining job, "seed a
demo without an in-app path", is precisely what Phase 4 builds. Rewriting it as a
thin CLI over `loadDemo()` (plan-review F4) would buy a second entry point and a
new `tsx` devDependency — required, because Node 24's native type stripping does
not resolve the `@/*` alias `load.ts` and `crypto.ts` depend on — for a
capability the product surface now duplicates.

**Contract**: Delete `scripts/seed-dashboard.mjs` and the `db:seed:demo` entry in
`package.json`. Nothing else references either: `grep -rn "db:seed:demo"` outside
`package.json` and this change's own documents returns nothing — not CI, not
Playwright, not `docs/`. The duplicated `encryptSeedToken`, the destructive
14-table header comment, and the "never seed the user's account" hazard go with
the file rather than being carried forward in a new spelling. Local seeding is
now sign in → Settings → "Zobacz demo", which is the walkthrough Phase 4's manual
checklist asks for anyway; a future Playwright fixture calls `loadDemo({ db, … })`
directly, since the loader already takes an injected `db`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- New unit test: the refinement action in demo returns the refusal and never constructs the Anthropic client
- New unit test: the recap send action in demo returns the refusal and never reaches the transport
- `git ls-files scripts/seed-dashboard.mjs` returns nothing, and `grep -rn "db:seed:demo" package.json scripts` returns nothing
- `npm test` and `npm run test:integration` still pass with no seed script on disk (nothing depended on it)

#### Manual Verification

- In demo, `/refinement` shows a saved run with both a `DOR_MET` verdict and one with gaps; the analyse button is disabled with an explanation
- In demo, `/settings/recap` shows a recap preview; no send control is active
- Leaving demo restores full function on both screens for the real account

---

## Testing Strategy

### Unit Tests

- `resolveWorkspace()` fallbacks — DEMO without a demo owner, DEMO with a NULL anchor, REAL
- Demo-mode refusals — `syncNow`, refinement analyse, recap send
- `enumerateOnboardedOwners` demo exclusion
- The settings-demo view function's state → allowed-transitions mapping (extracted to a `.ts` sibling; there is no component-test harness)

### Integration Tests

- Load → ≥4 anomaly types, all engine-produced
- Re-detect at the anchor → zero resolved (idempotence)
- Reset → demo owner and all its rows gone
- **Load + reset on an account with real credentials → credentials byte-identical**
- Demo-scoped reads return demo rows only
- Absence saved in demo re-detects at the anchor

### Manual Testing Steps

Kept to the 3–5 rows that genuinely gate the slice, written into
`context/changes/demo-mode/MANUAL-CHECKLIST.md` at Phase 4 with the four
required elements (where / what to do / what must be true / why it matters). The
irreversible one is the credential-safety walkthrough in Phase 4's manual list;
the unreachable-if-broken ones are the two dashboards in demo.

## Performance Considerations

`loadDemo` must complete under the 2-second US-02 budget. It is a bounded set of
inserts in one transaction plus one detection pass over a small snapshot, with no
external call — comfortably inside budget, but the transaction should be a
batched multi-row insert per table rather than a row-at-a-time loop over
Hyperdrive.

The resolver adds one query per request render, `cache()`d the way
`getOptionalSession` is (`auth.ts:181`). If it ever shows up, the follow-up is to
surface `active_workspace` as a Better Auth session additional field and drop the
query entirely — noted, not done.

## Migration Notes

Existing rows need nothing: `demo_of` and `demo_anchor_at` are nullable and
`active_workspace` defaults to `REAL`, so every current account is a real
workspace by construction. There is no data to convert — the CLI-seeded demo
accounts in local databases stay exactly as they are (real-looking accounts with
fake tokens); a developer wanting the new shape resets and re-loads.

## References

- Frame brief: `context/changes/demo-mode/frame.md`
- Roadmap: `context/foundation/roadmap.md:263-272` (S-09); PRD FR-008, US-02
- Prior incidents of this class: `context/foundation/lessons.md` § narrowing predicate; `context/archive/2026-08-21-dashboard-sprint-detail/plan.md:1020-1052`
- Fixture head start: `scripts/seed-dashboard.mjs`
- Reconcile to keep idempotent: `src/lib/anomaly/detect.ts:60-128`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Demo tenancy in the data model

#### Automated

- [x] 1.1 Migration applies cleanly — bff4be7
- [x] 1.2 Type checking passes — bff4be7
- [x] 1.3 Linting passes — bff4be7
- [x] 1.4 Unit tests pass — bff4be7
- [x] 1.5 Resolver fallback unit tests (DEMO without owner, DEMO with NULL anchor, REAL) — bff4be7
- [x] 1.7 Resolver redirects with no session and never returns an ownerId — bff4be7

#### Manual

- [ ] 1.6 Every existing screen behaves exactly as before

### Phase 2: Demo owner lifecycle and the fixture

#### Automated

- [x] 2.1 Type checking passes — b4559cc
- [x] 2.2 Linting passes — b4559cc
- [x] 2.3 Unit tests pass — b4559cc
- [x] 2.4 Integration tests pass — b4559cc
- [x] 2.5 loadDemo produces ≥4 distinct engine-written anomaly types — b4559cc
- [x] 2.6 Re-detect at the anchor resolves zero anomalies (idempotence) — b4559cc
- [x] 2.7 resetDemo leaves zero demo rows and no demo user row — b4559cc
- [x] 2.8 Load+reset on an account with real credentials leaves them byte-identical — b4559cc
- [x] 2.9 enumerateOnboardedOwners excludes demo owners — b4559cc

#### Manual

- [ ] 2.10 `npm run db:seed:demo` still populates a local account (deleted in Phase 5)

### Phase 3: Thread the effective owner and the frozen clock

#### Automated

- [x] 3.1 Type checking passes — d25fcce
- [x] 3.2 Linting passes — d25fcce
- [x] 3.3 Unit tests pass — d25fcce
- [x] 3.4 Integration tests pass — d25fcce
- [x] 3.5 Demo-scoped dashboard reads return demo rows only — d25fcce
- [x] 3.6 Absence saved in demo re-detects at the anchor — d25fcce
- [x] 3.7 syncNow in demo returns the typed refusal and never calls syncOwner — d25fcce
- [x] 3.8 No stray `session.user.id` outside the resolver and always-real call sites — d25fcce
- [x] 3.10 Demo roster save writes under the demo owner; real roster byte-identical — d25fcce
- [x] 3.11 importRoster/importCadence in demo refuse and construct no GitHub/Jira client — d25fcce
- [x] 3.12 Every exported server action still reaches an auth guard — d25fcce

#### Manual

- [ ] 3.9 With active_workspace=DEMO set by hand, both dashboards render the demo team and Connections stays real

### Phase 4: The FR-008 surface

#### Automated

- [x] 4.1 Type checking passes
- [x] 4.2 Linting passes
- [x] 4.3 Unit tests pass
- [x] 4.4 Integration tests pass
- [x] 4.5 load/exit/reset actions drive active_workspace and demo rows correctly
- [x] 4.6 Settings-demo view offers only valid transitions per state

#### Manual

- [ ] 4.7 "Zobacz demo" completes under 2s and lands on a populated Today
- [ ] 4.12 Reliability KPI and velocity estimate show numbers; capacity headline names the days off
- [ ] 4.8 Anomaly Inbox shows ≥4 distinct types with all five attributes
- [ ] 4.9 Sprint Detail renders aging report, activity matrix and sub-burndowns
- [ ] 4.10 Banner visible everywhere in demo; "Wyjdź z demo" restores the real account
- [ ] 4.11 On an account with real credentials: load then reset demo leaves both integrations connected with their original token_last4

### Phase 5: No external effects, and one fixture

#### Automated

- [ ] 5.1 Type checking passes
- [ ] 5.2 Linting passes
- [ ] 5.3 Unit tests pass
- [ ] 5.4 Integration tests pass
- [ ] 5.5 Refinement action in demo refuses and never constructs the Anthropic client
- [ ] 5.6 Recap send action in demo refuses and never reaches the transport
- [ ] 5.7 No `db:seed:demo` script and no `scripts/seed-dashboard.mjs` remain tracked
- [ ] 5.8 Unit and integration suites pass with the seed script removed

#### Manual

- [ ] 5.9 Demo refinement shows a saved run with both a DOR_MET verdict and one with gaps; analyse disabled
- [ ] 5.10 Demo recap shows a preview with no active send control
- [ ] 5.11 Leaving demo restores full function on both screens
