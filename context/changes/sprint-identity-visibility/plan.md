# Sprint Identity Visibility (S-25) Implementation Plan

## Overview

Every surface that renders sprint data states which sprint it is — the sprint's
name together with its date range, in the team's Jira time zone — computed once
in a pure module and rendered on four surfaces. Where the identity is genuinely
unknown, the surface says so instead of substituting a confident generality.

## Current State Analysis

Lifted from `context/changes/sprint-identity-visibility/frame.md` (Confidence:
HIGH); the hypothesis table there is the evidence, not repeated here.

The three surfaces are in **three different states of absence**, which is why a
single instruction ("make the name more prominent") is not executable:

| Surface | State today | Reference |
| --- | --- | --- |
| Wizard, cadence step | Name inside a `CardDescription` sentence | `cadence-form.tsx:180-181` |
| Dashboard "Today" | No identity element at all; `sprintName` reaches one panel, in a non-default tab | `dashboard/page.tsx:186,227` |
| Dashboard "Sprint Detail" | `<Badge variant="secondary">` beside the heading | `sprint-detail/page.tsx:308` |
| Daily Recap email | Subject only, and only on the ≥ 1-anomaly branch | `recap/render.ts:59-61` |

Two further facts settled during planning, both of which change the work:

- **The roadmap's UTC instruction rests on a misread.** S-25 says *"the UI renders
  UTC deliberately (backlog §5); do not 'fix' that here."* Backlog §5 lines
  236-244 is about `sync_state.*_at` in `sync-status-bar.tsx:34` and
  `integration-card.tsx:45`, and its reason is SSR/hydration determinism (a string
  slice instead of `toLocaleString`) — not a product decision about sprint dates,
  which render nowhere today. The real constraint is determinism, and
  `dayKeyInTimeZone` satisfies it by pinning both the locale (`en-CA`) and an
  explicit zone (`day-bucket.ts:33-49`). This plan therefore renders in the team's
  zone, deliberately departing from the letter of the roadmap entry.
- **The cadence step already interprets the sprint start in the team's zone.**
  `cadence.ts:7,63` derives `startDay` as the weekday of `startDate` *after*
  converting UTC → `timeZone`. Rendering the same date in UTC beside a weekday
  derived in the team's zone would make one screen disagree with itself.

Concretely, on the tester's own account the sprint stored as `2026-08-29 22:46`
is **30.08** in Warsaw — the date the roadmap's own example line uses for the
start, while using the UTC reading for the end (`12.09`; Warsaw is `13.09`). The
example is internally inconsistent, which is precisely why the zone has to be
chosen explicitly rather than inherited.

## Desired End State

On every one of the four surfaces, a lead who asks "which sprint is this?" reads
the answer without hunting: `PT Sprint 1 · 30.08 – 12.09`. On an account with no
sprint at all, each surface says that in words. No copy anywhere claims "the
active sprint" or "your sprint" when it does not know which one.

Verified by: `npm test` (the pure modules carry the whole decision surface),
`npm run typecheck`, `npm run lint`, plus the manual rows in
`MANUAL-CHECKLIST.md`.

### Key Discoveries

- **The identity bar must live BESIDE the heading, never inside it.**
  `e2e/dashboard-sprint-detail.spec.ts:82,161` pin both `<h1>` strings via
  `getByRole("heading", { name })`, which matches the full accessible name.
- **The same spec pins an exact TEXT string too** (plan review F1).
  `:163` asserts `getByText("No active sprint", { exact: true })` on the
  no-sprint account — so the identity element's empty copy is as
  E2E-constrained as its position. See Phase 3 §1.
- **`dayKeyInTimeZone` is the deterministic formatter** — locale `en-CA` plus an
  explicit zone (`day-bucket.ts:33-49`), degrading to UTC through `safeZone`
  without throwing (`time-zone.ts:33-45`). Safe on the server and in a client
  component alike; `YYYY-MM-DD` slices cleanly into `DD.MM`.
- **Today already resolves the zone** (`dashboard/page.tsx:79`). Sprint Detail
  does not and must add `getJiraTimeZone`.
- **Sprint Detail's page already holds both date sources** — `sprintRow`
  (`page.tsx:110-115`) and `measurement` (`page.tsx:108-109`). Extending
  `sprint-selection.ts` is therefore NOT about data availability; it is about the
  three-way branch decision being testable, which is the stated reason that file
  exists (`sprint-selection.ts:5-11`).
- **`sprint_measurement` carries the dates a deleted `sprint` row no longer can**
  (`schema.ts:482-483`), which is what makes the `measurement-only` branch
  renderable at all.
- **A nameless sprint already has a convention**: `labelFor` renders
  `Sprint <jiraSprintId>` (`sprint-selection.ts:170-172`). Reuse it; do not invent
  a second spelling — but it is module-PRIVATE today, so "reuse" needs a move
  rather than a copy (plan review F7). See Phase 1 §1.
- **Dates do not cross the RSC/action boundary as `Date`** — the stated convention
  (`organisms/anomaly/types.ts`, applied at `settings/absences/page.tsx:75-77`).
  The formatted view crosses as plain strings instead.

## What We're NOT Doing

- **No migration, and none is needed** — `sprint.start_date` / `end_date` and
  `sprint_measurement.start_date` / `end_date` are already populated. This is a
  hard constraint of the parallel worktree, not merely a convenience
  (`context/foundation/parallel-worktrees.md`).
- **Not naming the sprint on Settings → Absences.** Doing so states which sprint
  an absence belongs to, and that is the question **S-20**
  (`absence-sprint-scoping`) exists to settle. Deferred with reason.
- **Not changing how `sync_state.*_at` renders.** The UTC string-slice there stays
  exactly as it is; this plan's zone decision is scoped to sprint dates.
- **Not touching sprint resolution.** `getActiveSprintRow`'s two-tier fallback,
  `resolveSprintSelection`'s three-way branch, and the switcher's ordering all
  keep their current behaviour — only the fields they carry grow.
- **Not adding a time-of-day.** The identity line is a date range; the sprint's
  stored instants are Jira's, and a `22:46` on screen invites the exact timezone
  confusion this slice exists to remove.
- **No E2E and no integration run from this worktree.** New assertions may be
  written; they are executed after the branches merge.

## Implementation Approach

One pure module owns every formatting decision. Each surface asks it for a view
object of plain strings and renders that. The three-way branch on Sprint Detail is
pushed down into the pure module that already owns that decision, so the "where do
the dates come from when the `sprint` row is gone" question is answered by a test
rather than by a server component nobody can test.

Phase order is bottom-up: the two pure modules first (1, 2), then the surfaces
that consume them (3, 4), then the email (5) which is deliberately last and
separable.

## Critical Implementation Details

**State sequencing on Sprint Detail.** The `measurement-only` branch must take its
dates from the measurement record, never from `activeSprint` — the failure mode
`sprint-selection.ts:12-20` was written to prevent is showing the ACTIVE sprint's
data under a switcher entry naming an old one. Dates are one more field that can
silently come from the wrong sprint, and the test must assert the branch, not just
the presence of a date.

**Formatting happens on the server, always.** `cadence-form.tsx` is a client
component; it receives a formatted `SprintIdentityView` (plain strings) rather than
`Date`s plus a zone. This keeps every `Intl` call on one side of the boundary and
matches the no-`Date`-across-RSC convention.

---

## Phase 1: The pure identity module

### Overview

One place that knows what a sprint's identity looks like as text, so the four
surfaces cannot drift into four spellings — which is how today's three different
renderings came about.

### Changes Required:

#### 1. Sprint identity formatter

**File**: `src/lib/sprint-identity.ts` (new)

**Intent**: Turn a sprint's raw identity fields into the strings a surface
renders, and decide what to say when a field — or the whole sprint — is missing.
Pure: no DB, no React, no ambient clock (the current year arrives as an argument).

**Contract**: Exports `SprintIdentityView` and
`toSprintIdentity(input): SprintIdentityView`, where the input carries
`name: string | null`, `jiraSprintId: string | null`, `startDate: Date | null`,
`endDate: Date | null`, `timeZone: string | null | undefined`, and `now: Date`.

The view is a discriminated union on a `kind` field so callers branch on the
reducer's decision rather than re-deriving it (the `velocity-estimate.tsx`
impl-review F2 rule):

- `{ kind: "identified", label, range: string | null }` — `label` is the name, or
  `Sprint <jiraSprintId>` when nameless; `range` is `null` when either date is
  absent.

**`labelFor` MOVES HERE; IT IS NOT COPIED** (plan review F7). The nameless-sprint
spelling exists already at `sprint-selection.ts:170-172`, but it is not exported,
and exporting it in place would make this `src/lib/` module import from a
`src/app/` route folder — the wrong dependency direction. So `labelFor` is moved
INTO `sprint-identity.ts`, exported, and `sprint-selection.ts` imports it for
`toSprintOptions` (`:152`, `:162`). One definition, and the switcher entry and the
identity bar cannot drift into two spellings for the same nameless sprint — which
is the whole reason this phase says "do not invent a second spelling".
- `{ kind: "none" }` — no sprint at all.

Range formatting: both endpoints through `dayKeyInTimeZone`, then sliced to
`DD.MM` and joined with an en dash and hair spaces (`30.08 – 12.09`). The year is
appended to an endpoint only when that endpoint's year differs from `now`'s year
in the same zone — so the current sprint stays short and a two-year-old sprint in
the switcher stays unambiguous. A range whose endpoints fall on the same day
renders once, not twice.

#### 2. Its test

**File**: `src/lib/sprint-identity.test.ts` (new)

**Intent**: Hold the formatting decisions that four surfaces now depend on.

**Contract**: Covers, at minimum — the Warsaw boundary case (`2026-08-29T22:46Z`
renders `30.08` under `Europe/Warsaw` and `29.08` under `UTC`, which is the whole
reason the zone was chosen); an unknown/absent zone degrading to UTC without
throwing; a nameless sprint yielding `Sprint <id>`; a sprint with one or both
dates absent yielding `range: null` with the label intact; `kind: "none"`; the
year appearing only across a year boundary; and a single-day range.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

---

## Phase 2: Sprint Detail's selection carries dates

### Overview

Extend the pure module that already decides *which* sprint Sprint Detail shows so
it also decides *where that sprint's dates come from* — a decision with a real
wrong answer in the `measurement-only` branch.

### Changes Required:

#### 1. The selection contract

**File**: `src/app/(app)/dashboard/sprint-detail/sprint-selection.ts`

**Intent**: Carry `startDate` / `endDate` alongside `name` through all three
resolution branches, taking them from the `sprint` row where one exists and from
the measurement record where it does not.

**Contract**: `SprintRowRef` gains `startDate: Date | null` and
`endDate: Date | null`; `MeasurementRef` gains `endDate: Date | null` (it already
carries `startDate`); `SprintSelection` gains both. `fromActive` reads the row;
the `measurement-only` branch reads the record.
`toSprintOptions` and `resolveAdjustmentAvailability` are unchanged.

**The `selected` branch FALLS BACK to the record, mirroring the name** (plan
review F5). That branch already writes `name: requestedSprint.name ?? requested.sprintName`
(`:99`) — the row is preferred, the record fills a gap — and dates take the same
shape: `requestedSprint.startDate ?? requested.startDate`, likewise for the end.
Leaving it at "prefers the row's dates" would have left the null case to the
implementer's judgment in the one file that exists so branch decisions are not
left to judgment. `sprint.start_date` is nullable in the schema, so the case is
reachable rather than theoretical.

#### 2. Its test

**File**: `src/app/(app)/dashboard/sprint-detail/sprint-selection.test.ts`

**Intent**: Assert the branch, not merely the presence of a date.

**Contract**: Adds cases proving the `measurement-only` branch returns the
MEASUREMENT's dates and specifically not the active sprint's — the existing
helpers at `:23-24` already construct a `MeasurementRef` with a distinct
`startDate`, so give the active sprint different dates and assert they do not
leak. Also: `kind: "none"` carries null dates; the `selected` branch prefers the
row's dates over the record's, AND falls back to the record's when the row's are
null (plan review F5) — two cases, not one.

#### 3. The reader that feeds it — VERIFY ONLY, no query change expected

**File**: `src/app/(app)/dashboard/sprint-detail/page.tsx`

**Intent**: Confirm the three inputs to `resolveSprintSelection` already carry the
date fields, so the extended refs are populated with no reader change.

**Contract**: All three sources were checked and already supply them (plan review
F5) — this step exists to notice if that stops being true, not to add columns:

| Input | Source | Why the dates are already there |
| --- | --- | --- |
| `activeSprint` | `getActiveSprintRow` | bare `.select()` ⇒ full `SelectSprint` (`sprint.ts:23-24`) |
| `requestedSprint` | `getSprintRowByJiraId` | bare `.select()` ⇒ full `SelectSprint` (`sprint.ts:63-67`) |
| `measurements` | `listRecordedSprintsForOwner` | returns `SprintMeasurement[]`, which declares `startDate` / `endDate` (`measurement/reader.ts:31-33`) |

This matches Key Discoveries ("Sprint Detail's page already holds both date
sources"); the earlier wording contradicted it by asking for columns that are
already selected. If `npm run typecheck` passes after Phase 2 §1, this step is
done.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new branch assertions: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

---

## Phase 3: The identity bar on both dashboards

### Overview

Give Today an identity element it does not have, replace Sprint Detail's muted
badge with the same element, and stop the velocity panel from naming a sprint it
cannot see.

### Changes Required:

#### 1. The shared bar

**File**: `src/components/molecules/sprint-identity-bar.tsx` (new)

**Why `molecules/`, not `organisms/dashboard/`** (plan review F8): Phase 4 renders
this same element inside `organisms/setup/cadence-form.tsx`. CLAUDE.md's atomic
layout reserves `organisms/{anomaly,dashboard,auth,setup}/` for feature sections,
so a component shared across two of them would either cross-import
organism → organism or be duplicated — and duplication is what the "one
implementation, one shape" decision exists to prevent. `molecules/` is where a
composite widget with no feature ownership belongs.

**Intent**: Render a `SprintIdentityView` as the page's answer to "which sprint?",
sitting in the page header — beside the heading, deliberately outside it.

**PLACEMENT IS THE HEADER ROW ON BOTH DASHBOARDS, NOT ABOVE `SyncStatusBar`**
(plan review F2). The earlier wording said both at once — "a shared bar above
`SyncStatusBar`" for Today, "in place of the `<Badge>` at `:308`" for Sprint
Detail — and those are two different slots, one of them two elements above the
other. The header row wins for a reason that is about meaning, not layout: the
`stateLabel` badge ("Sprint closed") and the `SprintSwitcher` already live in
that row (`sprint-detail/page.tsx:300-322`), and moving the sprint's NAME below
the description paragraph would separate a closed sprint from the marker saying
so. Today grows the same row; Sprint Detail keeps the one it has.

**Contract**: Takes `view: SprintIdentityView` and nothing else (the decision is
the reducer's). The `identified` case renders the label prominently enough to be
the second thing read after the `<h1>` — not `text-xs text-muted-foreground`, the
styling the tester's complaint was about — with the range as a quieter sibling.
The `none` case renders **`Sprint: none active`** as visible text, not an absent
element: an empty region cannot be distinguished from a failed render, which is
the class of silent mistake this slice closes.

**THE `none` COPY MUST NOT REUSE AN EXISTING EMPTY-STATE TITLE** (plan review F1).
`No active sprint` — the obvious wording, and the one this plan first specified —
is already rendered verbatim on all three surfaces this slice touches:

| Where | Line |
| --- | --- |
| Sprint Detail's `EmptyState` | `sprint-detail/page.tsx:338` |
| Today's inbox, on the DEFAULT tab | `anomaly-inbox.tsx:85` |
| The cadence step's alert | `cadence-form.tsx:213` |

On Sprint Detail that is not merely duplicate copy, it is a failing test:
`e2e/dashboard-sprint-detail.spec.ts:163` asserts
`getByText("No active sprint", { exact: true })`, and a second node carrying the
same text resolves to two elements — a Playwright strict-mode violation. This
worktree cannot run E2E, so the STRING is the mitigation, the same way the bar
being a sibling of the `<h1>` is the mitigation for the heading assertions.
Before Phase 3 is done, `grep -rn "Sprint: none active" src/ e2e/` must match only
the new component, and the chosen wording must not equal any existing
empty-state title. Phase 4 reuses the same string, so the wizard's alert at
`:213` and the identity slot do not say one sentence twice.

#### 2. Today

**File**: `src/app/(app)/dashboard/page.tsx`

**Intent**: Compute the view and render the bar in the page header, beside the
`<h1>`; leave the `<h1>` string untouched.

**Contract**: Calls `toSprintIdentity` with the active sprint's fields and the
`timeZone` already resolved at `:79`. Today's header block (`:185-192`) is a
plain `flex-col`, so it gains a `flex flex-wrap items-center gap-3` row wrapping
the `<h1>` and `<SprintIdentityBar>` as SIBLINGS — the same row shape Sprint
Detail's `PageShell` already has (`:300-322`), which is what makes the two
surfaces one shape rather than two. `<SyncStatusBar>` (`:194`) is untouched.

#### 3. Sprint Detail

**File**: `src/app/(app)/dashboard/sprint-detail/page.tsx`

**Intent**: Render the same bar from the Phase-2 selection, and remove the badge
it replaces.

**Contract**: Adds a `getJiraTimeZone` read (this page has none today); passes the
computed view into `PageShell`, which renders `<SprintIdentityBar>` in place of
the `<Badge variant="secondary">` at `:308`. The `stateLabel` badge and the
`SprintSwitcher` stay exactly as they are — a closed sprint must remain
unmistakable, and the switcher is the only route to sprints whose rows are gone.

#### 4. The fallback that fabricates identity

**File**: `src/components/organisms/dashboard/velocity-estimate.tsx`

**Intent**: Stop asserting "the active sprint" on an account that has none.

**Contract**: `sprintLabel` at `:42` no longer substitutes a generality. Where the
name is unknown the copy is rephrased to make no identity claim.

**THREE READ SITES, AND THE PLAN NAMED THE WRONG ONES** (plan review F4). The
earlier list — "the three `emptyCopy` branches (`:87`, `:89`, `:91`)" — is
inaccurate: `:87` and `:91` never touch `sprintLabel`. The sites that do are:

| Line | Where | Renders on |
| --- | --- | --- |
| `:50` | `CardDescription` — "scaled to what {label} actually has" | EVERY render, including the happy path |
| `:69` | the ratio sentence — "{label}'s capacity against its full capacity" | the has-estimate branch |
| `:89` | `emptyCopy`'s `no-capacity` branch | that branch only |

`:50` is the one that matters most and was the one missing: it is where a lead on
an ordinary account actually meets "the active sprint". All three must still read
as complete sentences with the name both known and unknown. The panel's own
decision-branching rule (all branching on `view.reason`) is preserved.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- On Dashboard "Today" with an active sprint, the sprint's name and date range are
  readable without opening any tab, and the dates match the sprint's dates in Jira
  when read in the team's own time zone.
- On Dashboard "Sprint Detail", switching to a closed sprint in the switcher
  changes the identity line to that sprint, and the "Sprint closed" marker is
  still present.
- On an account with no active sprint, both dashboards say so in words, and the
  Estimated velocity panel no longer refers to "the active sprint".

---

## Phase 4: The wizard's cadence step

### Overview

Lift the sprint's identity out of the middle of a helper sentence — on the one
screen that asks the lead to confirm settings pulled from a specific sprint.

### Changes Required:

#### 1. Dates out of the service

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Return the active sprint's dates and the team's zone alongside its
name, so the caller can render an identity rather than only a word.

**Contract**: `ImportCadenceResult` (`:772-785`) gains the sprint's `startDate`
and `endDate` and the resolved `timeZone` (already in hand as `identity.timeZone`
at `:857`). The `reconciled` branch (`:862-870`) populates them from
`result.sprint`; every other branch returns nulls, matching how it already treats
`sprintName`.

#### 2. Across the action boundary

**File**: `src/app/(app)/setup/team/actions.ts`

**Intent**: Hand the client a ready identity view instead of raw dates.

**Contract**: `ImportCadenceResult` (`:139-149`) carries a
`sprintIdentity: SprintIdentityView` — computed server-side via
`toSprintIdentity` — in place of the bare `sprintName` string. Plain strings only;
no `Date` crosses the boundary.

#### 3. First render

**File**: `src/app/(app)/setup/team/page.tsx`

**Intent**: The identity must be present on first paint, not only after a re-pull.

**Contract**: The `activeSprint` read (`:36-46`) is **replaced by
`getActiveSprintRow(db, ownerId)`**; the page resolves the zone via
`getJiraTimeZone` and builds the same `SprintIdentityView` into `initialCadence`
(`:48-62`) in place of `sprintName`.

**TWO RESOLVERS WOULD MAKE THE TWO SURFACES DISAGREE** (plan review F6). This page
hand-rolls `WHERE state = 'ACTIVE' … LIMIT 1`; Today uses `getActiveSprintRow`,
whose second tier falls back to the most-recently-started sprint. On a
between-sprints account that is Today naming a sprint while the wizard says there
is none — two surfaces contradicting each other about identity, inside a slice
whose entire premise is that identity is a fact the lead can check. The hand-rolled
query also carries the defect `sprint.ts:27-31` documents: no `ORDER BY`, so with
two ACTIVE rows (which `importCadence` can create, conflicting on `jiraSprintId`)
Postgres may return either.

This does NOT contradict "Not touching sprint resolution" under
**What We're NOT Doing**: `getActiveSprintRow`'s own behaviour is unchanged: what
changes is that one more surface now asks it, instead of asking a private copy of
half of it. The cadence VALUES read off the returned row are the same columns as
before (`lengthDays`, `startDay`, `workingDays`, `cadenceOverridden`, `name`) —
the query returns a superset, not a different sprint, whenever an ACTIVE one
exists.

#### 4. The form

**File**: `src/components/organisms/setup/cadence-form.tsx`

**Intent**: Show the identity as its own element in the card header, and let the
description go back to being about overriding.

**Contract**: The `sprintName` state (`:91-92`) becomes the identity view, set
from the pull result at `:117`. The header renders **the same
`<SprintIdentityBar>` component** (from `molecules/`, per Phase 3 §1) beside
`<CardTitle>` — not a re-creation of its styling (plan review F8), so the lead
meets one shape and not two that nearly agree. Its `none` case yields
`Sprint: none active`, the string Phase 3 §1 fixes; the existing
`<AlertTitle>No active sprint</AlertTitle>` at `:213` stays, and the two do not
say the same sentence twice.
The `CardDescription` (`:180-181`) keeps only the override sentence; when there is
no sprint it keeps its existing "Confirm your sprint cadence…" copy, which already
makes no identity claim.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- In the wizard's cadence step on an account with an active sprint, the sprint's
  name and dates are visible in the card header before any interaction, and
  "Pull from Jira" leaves them correct.
- On a Jira project with no active sprint, the step shows no fabricated identity
  and the cadence fields are still editable.

---

## Phase 5: The Daily Recap email (separable)

### Overview

The email is the one surface a lead reads without the app in front of them. It
currently names the sprint only in the subject, and only when there is at least
one anomaly. Kept last so it can be dropped without disturbing Phases 1-4.

### Changes Required:

#### 1. The payload

**File**: `src/lib/recap/types.ts`

**Intent**: Let a recap record which sprint it was about, durably — recap history
is read back long after the sprint moved on.

**Contract**: `RecapSprint` (`:64-73`) gains the sprint's start and end as ISO
strings alongside its existing `name`, declared **OPTIONAL** —
`startDate?: string | null`, `endDate?: string | null`.

**DO NOT BUMP `RECAP_SCHEMA_VERSION`** (plan review F3). The plan previously said
only that "`schemaVersion` handling is followed", which is not a decision, and
both answers carry a cost that has to be named:

- **Bumping to 2 is the wrong one.** `readRecapHeaderFacts` gates EVERY payload
  read on exact equality (`components/organisms/settings/recap-history-view.ts:211`
  — note the path: this file is under `organisms/settings/`, not `lib/recap/`).
  A bump turns every recap already stored into `payloadReadable: false`, so its
  history detail loses the sprint name and the anomaly count. That is a visible
  regression in the one surface Phase 5's manual row exists to protect, caused by
  a change that takes nothing away from any existing reader.
- **Not bumping is only honest if the fields are optional.** `RecapSchemaVersion`
  is the literal `1` (`types.ts:26`) and `daily_recap.payload` is
  `.$type<RecapPayload>()`, so declaring the fields REQUIRED makes the compiler
  believe every stored row carries them. An old v1 payload passes the gate and
  hands `undefined` — not `null` — to §3's formatter. Optional declarations put
  that case back in the type system where a test can reach it.

`demo/fixture.ts:602` writes `schemaVersion: 1 as const` and is unaffected for the
same reason: optional fields need no fixture change.

#### 2. Filling it

**File**: `src/lib/recap/build.ts`

**Intent**: Populate the new fields from the sprint row already in hand.

**Contract**: `sprintSummary` (`:104-106`) carries the dates from `sprint`, which
`:99-100` already reads for the day-number computation.

#### 3. Rendering it

**File**: `src/lib/recap/render.ts`

**Intent**: Name the sprint where the reader actually is, and stop dropping it on
the quiet days.

**Contract**: The `count === 0` subject (`:59`) names the sprint like its sibling
branch does. Both bodies gain the identity line next to the existing "Sprint day N
of M" (`:78-79`, `:215`). The `?? "your sprint"` fallback (`:58`) makes no
identity claim when the name is unknown. Dates are formatted through the Phase-1
module using the payload's own `timeZone` (`types.ts:113`), so the email and the
dashboards agree.

**An ABSENT date field is "no range", exactly as a `null` one is** — the two
arrive from different eras of the payload (§1) and must not be distinguished
downstream. Renders the label alone, never a partial or malformed range.

#### 4. Its test

**File**: `src/lib/recap/render.test.ts`

**Intent**: Pin the branch that was silently dropping the name.

**Contract**: Asserts the sprint is named in the zero-anomaly subject, in the HTML
body and in the text body; and that a payload with no sprint name produces no
"your sprint" claim. Plus the backward-compatibility case (plan review F3): a
payload whose `sprint` carries NEITHER date field — the shape every recap written
before this change has — renders the label with no range and does not emit
`undefined` or `Invalid Date` into either body.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new render assertions: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Recap history detail (`/settings/recap/history/<id>`) still renders for a recap
  stored before this change — the added payload fields are absent there.

---

## Testing Strategy

### Unit Tests

- `src/lib/sprint-identity.test.ts` — the whole formatting surface (Phase 1).
- `sprint-selection.test.ts` — the `measurement-only` branch takes the
  measurement's dates and not the active sprint's (Phase 2).
- `render.test.ts` — the zero-anomaly subject and both bodies name the sprint
  (Phase 5).

There is no component-test harness in this repo (both vitest projects run
`environment: "node"`), which is why every decision above lives in a `.ts` the
tests can reach and the `.tsx` files only render what they are handed.

### Integration Tests

None. This slice adds no query, no write and no migration.

### E2E

None executed from this worktree — forbidden while a second session runs
(`parallel-worktrees.md`). The `<h1>` assertions at
`e2e/dashboard-sprint-detail.spec.ts:82,161` must keep passing, which is why the
identity bar is a sibling of the heading rather than part of it; verify after
merge.

### Manual Testing Steps

Full rows, with pass conditions, land in `MANUAL-CHECKLIST.md`. The blocking ones
are the Manual Verification bullets under Phases 3 and 4 — the two surfaces a lead
cannot avoid.

## Performance Considerations

None material. `toSprintIdentity` runs a handful of times per render and reuses
`day-bucket.ts`'s per-zone formatter cache (`:26-45`), which exists precisely
because constructing an `Intl.DateTimeFormat` dominates formatting it.

## Migration Notes

**No database migration.** One data-shape change does need care: `RecapSprint`
gains fields inside a stored JSON payload (Phase 5). Recaps written before this
change do not have them, and
`src/components/organisms/settings/recap-history-view.ts` reads those payloads
back. The decision, settled in Phase 5 §1 rather than left to the implementer:
**`RECAP_SCHEMA_VERSION` stays `1`** and the two fields are declared optional on
`RecapSprint`. The addition takes nothing away from any existing reader, so the
version gate has nothing to protect against here — whereas bumping it would blank
the sprint name and anomaly count on every recap already sent. No backfill.

## References

- Frame brief: `context/changes/sprint-identity-visibility/frame.md`
- Tester's note: `context/manual-tests/S-16-4.6-tozsamosc-sprintu-niewidoczna.md`
- Roadmap: `context/foundation/roadmap.md` § S-25
- Parallel-work constraints: `context/foundation/parallel-worktrees.md`
- Pure-sibling precedent: `sprint-selection.ts:5-11`,
  `capacity-adjustments-view.ts`, `reliability-kpi-view.ts`
- Deterministic formatting: `src/lib/dashboard/day-bucket.ts:20-49`,
  `src/lib/time-zone.ts:33-45`
- Zone precedent in the cadence path: `src/lib/integrations/cadence.ts:7,63`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The pure identity module

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`

### Phase 2: Sprint Detail's selection carries dates

#### Automated

- [ ] 2.1 Unit tests pass, including the new branch assertions: `npm test`
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Linting passes: `npm run lint`

### Phase 3: The identity bar on both dashboards

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Production build passes: `npm run build`

#### Manual

- [ ] 3.5 Today shows the sprint's name and date range without opening a tab, and the dates match Jira read in the team's zone
- [ ] 3.6 Sprint Detail's switcher changes the identity line to the selected closed sprint, with the "Sprint closed" marker still present
- [ ] 3.7 An account with no active sprint says so on both dashboards, and the Estimated velocity panel no longer refers to "the active sprint"

### Phase 4: The wizard's cadence step

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Linting passes: `npm run lint`
- [ ] 4.4 Production build passes: `npm run build`

#### Manual

- [ ] 4.5 The cadence step shows the sprint's name and dates in the card header before any interaction, and "Pull from Jira" leaves them correct
- [ ] 4.6 A Jira project with no active sprint shows no fabricated identity and keeps the cadence fields editable

### Phase 5: The Daily Recap email (separable)

#### Automated

- [ ] 5.1 Unit tests pass, including the new render assertions: `npm test`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Production build passes: `npm run build`

#### Manual

- [ ] 5.5 Recap history detail still renders a recap stored before this change
