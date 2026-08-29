# S-14 — Anomaly threshold + severity settings page — Implementation Plan

## Overview

Ship `/settings/anomalies` as the sixth tab of the existing settings shell: eight
per-rule cards where the lead re-tiers severity (FR-014) and overrides detection
thresholds (FR-009), each card saving and resetting independently against the
already-live `anomaly_settings` table.

The structural half of this slice was built by F-02 and S-06 and is in
production use. What S-14 owns is everything between the form and the `jsonb`
column: the **only** runtime validation the threshold bodies will ever have, an
owner-scoped write path, and the copy that tells the lead what a change does and
when.

## Current State Analysis

**Built, live, and correct** (see `research.md` §1–§5):

- `anomaly_settings` — `src/db/schema.ts:924-947`, DDL applied
  (`0001_lying_human_cannonball.sql:44-54`). `unique(owner_id, anomaly_type)`,
  `owner_id` FK → `user` `ON DELETE CASCADE`. **Account scoping is structural**,
  which is why this slice skipped `/10x-frame`.
- `resolveEffectiveThresholds(db, ownerId)` — `src/lib/anomaly/thresholds.ts:24-52`.
  `stored ?? default` for severity, `{ ...default, ...override }` for the body;
  always exhaustive over the 8 types. Really called at `detect.ts:51`.
- `DEFAULT_THRESHOLDS` — `src/db/defaults.ts:43-86`. A typed constant,
  deliberately **never seeded**; "no row means defaults" is the settled model.
- The settings shell — `src/app/(app)/settings/layout.tsx`, five tabs, with the
  sixth slot literally reserved at `:28`. Gating is inherited from
  `(app)/layout.tsx`; nav entry already exists (`main-nav.tsx:13`).

**Missing, and the reason this slice is more than a form:**

- **Zero writers to `anomaly_settings`, zero runtime guards on read.** Every
  detector does an unchecked `as` cast on the jsonb body. A bad override does not
  throw at the write — it misbehaves at detection, in two ways: a `NaN`
  `riskScore` against an `integer` column **aborts the whole detection
  transaction** (`PR_REVIEW_STALLED`, `TICKET_NO_COMMIT_LINK`, `PR_TOO_BIG`,
  `SCOPE_CREEP`), or a silently inverted predicate produces a false-positive
  storm / an empty inbox (`DEVELOPER_INACTIVE`, `TICKET_STATUS_AGING`).
- **The merge is shallow** (`thresholds.ts:45-48`). `inProgressHoursBySp` and
  `maxParallelByCategory` are *replaced wholesale*. A payload carrying one
  changed SP bucket deletes the other six, and `inProgressBudget`
  (`ticket-status-aging.ts:22-35`) then silently falls back to the nearest
  remaining bucket — or returns `null` for an empty map, which skips every
  In-Progress ticket and reads exactly like a healthy sprint
  (`lessons.md` "a narrowing predicate turns 'wrong value' into 'empty result'").
- **`resolveEffectiveThresholds` has no test file at all**, and no integration
  test ever inserts an `anomaly_settings` row. Every rule unit test uses
  `test-support.ts:22`, which is `DEFAULT_THRESHOLDS` cast to
  `EffectiveThresholds` — so the override path is untested end to end.
- **`anomaly_settings.is_default`** is written nowhere and read nowhere. It also
  contradicts the no-row model.

## Desired End State

The lead opens **Settings → Anomaly rules** and sees eight cards, one per
detection rule, each showing the rule's current severity tier and its tunable
numbers. Cards whose values differ from the shipped defaults carry a
**"Modified"** badge and an enabled **Reset to defaults**. Changing a value and
pressing **Save** on that card persists it, re-runs detection immediately, and
toasts; reloading shows the saved values. **Reset** removes the override row and
the card returns to the defaults.

Verification: `/settings/anomalies` renders for a fresh account with zero
`anomaly_settings` rows; a save writes exactly one row for that rule and none
for the others; a second account's rows are untouched; a save whose values equal
the defaults leaves no row behind; the anomaly inbox reflects the new threshold
without waiting for the cron cycle.

### Key Discoveries

- The write path to copy is `src/lib/measurement/overrides.ts:156-178` /
  `src/lib/recap-settings.ts:76-98` — `onConflictDoUpdate` on the existing unique
  constraint, `updatedAt` set **by hand** (Drizzle's `$onUpdate` at
  `schema.ts:936-939` does **not** fire inside a conflict `set`).
- The action template is `settings/recap/actions.ts:31-62`: `resolveWorkspace()`
  → validate → `getCloudflareContext()` + `getDb(env)` **in the body** → delegate
  to a request-context-free store → typed union. Plain `getDb`, not
  `getDbWithPool` — `db-pool-teardown` is still open and diverging here would be
  the anomaly.
- The re-detect shape to copy is `settings/absences/actions.ts:222-232` —
  best-effort, post-commit, `try/catch`, and the **workspace clock** `now` from
  `resolveWorkspace()`, never `new Date()`.
- `src/components/ui/form.tsx` exists but is imported by nothing. Every organism
  wires `<Label htmlFor>` + `<Input>` + a manual
  `<p className="text-sm text-destructive">` (`absence-editor.tsx:410-413`).
  Match the organisms, not the unused wrapper.
- No jsdom/RTL harness exists. Decision logic goes in a pure `.ts` sibling
  (`recap-settings-view.ts`, `absence-calendar-view.ts`); the `.tsx` keeps
  rendering and hooks only.
- Severity has a ceiling: `SPRINT_AT_RISK` already defaults to `HIGH` and
  `riskScore = WEIGHT × magnitude × 100/3` has no tier above it. The UI can only
  ever move a rule **down**.
- `src/components/ui/` has no `slider` and no `separator`. `card`, `badge`,
  `select`, `input`, `button`, `alert`, `tooltip` are all present — enough.

## What We're NOT Doing

- **Not changing any default value** in `src/db/defaults.ts`. The demo fixture is
  tuned against those numbers (`context/archive/2026-08-28-demo-mode/plan.md:269`);
  a changed default empties the demo inbox with unit tests still green. S-14 adds
  a schema *over* the existing numbers.
- **Not turning the `"8_WORKING_DAYS"` sentinel into data.** Making "10 working
  days" expressible means touching `defaults.ts`,
  `ticket-status-aging.ts:63-74` and the demo fixture's assumptions. The 21-SP
  bucket stays a two-position choice: `120 h` or `8 working days`. Recorded here
  so it is not rediscovered mid-implementation.
- **Not adding a severity filter to the inbox.** `inbox-controls.ts:26-43` filters
  by type + member only; that is S-07's surface, not this one.
- **Not re-tiering anomalies already stored.** `anomaly.severity` is stamped at
  detection (`schema.ts:897`, NOT NULL). A still-detected row picks up the new
  tier on the next detect (`detect.ts:75-85`) — which, under D1, is the save
  itself; a `RESOLVED` row keeps its old tier permanently, but is rendered
  nowhere (`reader.ts:61` filters `status = ACTIVE`, and the recap uses the same
  reader), so no copy is spent on it.
- **Not re-litigating the Settings nav taxonomy** — filed as S-19
  (`roadmap.md:610-613`).
- **No E2E test.** The slice is a CRUD form over an owner-scoped table; the
  integration suite covers the write path and the manual checklist covers the
  surface.

## Implementation Approach

Four phases, bottom-up, each independently verifiable:

1. **Contract layer** — drop the dead column, then write the zod schema that is
   the only thing standing between a form field and eight unchecked `as` casts,
   apply it on **both** sides of the column, plus a settings-side reader that
   reports *which* rules are overridden.
2. **Write path** — a request-context-free store (upsert / delete) and the thin
   Server Action over it, with D1 re-detect.
3. **Surface** — the page, the client organism, its pure view sibling, and the
   tab registration.
4. **Closure** — correct the roadmap's conflicting wording, write the manual
   checklist and the backlog section.

Two cross-cutting decisions taken at planning and applied throughout:

- **Per-rule save.** The action takes one `anomalyType` plus that rule's
  **complete** body. This is what makes the shallow merge harmless: a whole-body
  payload cannot lose a nested key. It also maps one-to-one onto the
  `(owner_id, anomaly_type)` unique constraint and fires exactly one re-detect.
- **A row exists if and only if the rule differs from its defaults.** The store
  normalises: a save whose values deep-equal `DEFAULT_THRESHOLDS[type]` **deletes**
  the row instead of writing it. That keeps one concept — "modified" — driving
  both the badge and the Reset button, and keeps the no-seed model honest.

## Critical Implementation Details

**The payload is always the complete rule body.** `thresholds.ts:45-48` spreads
one level deep, so an override's `inProgressHoursBySp` replaces the default map
rather than merging into it. The zod schema therefore requires the SP map to
carry **exactly** the seven default keys and `maxParallelByCategory` to carry
**exactly** its three, and the form always submits every field it rendered — not
just the changed ones. An empty or partial SP map is the failure this slice
exists to prevent: `inProgressBudget` returns `null` and In-Progress aging goes
silent while the run reports OK.

**`updatedAt` must be set explicitly** inside the `onConflictDoUpdate` `set` —
Drizzle's `$onUpdate` does not fire on the conflict path. Both existing
precedents (`overrides.ts:171`, `recap-settings.ts:88`) set it by hand.

**The re-detect uses the workspace clock.** `resolveWorkspace()` returns `now`,
which in demo mode is *not* wall-clock time. Passing `new Date()` to
`detectAnomalies` would silently produce a wrong picture for exactly the visitors
demo mode exists to serve.

**The D1 re-detect resolves the staleness `change.md` warned about; do not
carry that warning into the UI.** Threshold numbers and severity are stamped onto
the `anomaly` row at detection time (`schema.ts:897`; `context.ts:190,207,212,224,230`
— "threshold 24h", "2/2", "max 500"), which is why the pre-plan notes said a
re-tier would only land on the next cycle. Under D1 the save IS that cycle:
`detect.ts:75-85` refreshes `severity` and `context` for every still-true row, so
the inbox shows the new tier and the new chip on the next view. `RESOLVED` rows
do keep their old numbers, but they are rendered nowhere — `reader.ts:61` filters
`status = ACTIVE`, and `recap/build.ts:3` consumes that same reader, so the
Daily Recap inherits the filter. The card copy must therefore state the D1 fact,
NOT a caveat about a state the lead cannot see.

---

## Phase 1: Contract layer — schema hygiene, validation, and the settings reader

### Overview

Remove the dead column, then build the two pure modules the rest of the slice
sits on: the zod schema that guards the jsonb boundary, and a reader that tells
the surface which rules are overridden.

### Changes Required:

#### 1. Drop the dead `is_default` column

**File**: `src/db/schema.ts` (the `anomalySettings` table), plus a generated
migration under `src/db/migrations/`.

**Intent**: `is_default` is written nowhere and read nowhere, and it contradicts
the settled "no row means defaults" model — leaving it is a permanent trap for
the next reader.

**Contract**: remove the `isDefault` column from the `anomalySettings` table
definition, then `npm run db:generate` (produces `0018_*.sql` with a
`DROP COLUMN`) and `npm run db:migrate`. `drizzle.config.ts` loads `.env.local`
with `override: true`, so migrate targets the **local** Supabase by default.
No other column changes; `severity_override` and `thresholds` stay nullable.

#### 2. The per-rule validation schema

**File**: `src/lib/validations/anomaly-settings.ts` (new)

**Intent**: define, for the first time, what each of the eight `thresholds`
bodies may contain. This module is the only runtime type check that will ever run
against the jsonb column, on either side of it.

**Contract**: a `zod` discriminated union on `anomalyType`, one member per rule,
each carrying `severity` (`z.enum(["HIGH","MEDIUM","LOW"])`) plus that rule's
complete body. **Each member is exported under its own name as well as through
the union** — Phase 3's eight per-card `zodResolver`s each need exactly one
member, and Phase 1 §3's read guard picks a member by anomaly type. Field shapes
follow `DEFAULT_THRESHOLDS` exactly:

- `PR_REVIEW_STALLED` — `hours`
- `TICKET_STATUS_AGING` — `inProgressHoursBySp`, `codeReviewHours`, `testingHours`
- `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK` — `noCommitDays`
- `SPRINT_AT_RISK` — `maxParallelByCategory`, `toDoBeforeSprintEndLeadTimeHours`
- `PR_TOO_BIG` — `maxLines`
- `SCOPE_CREEP` — `percent`
- `PR_TICKET_DESYNC` — severity only; its body is `{}`

Hard requirements, each defending a named failure from `research.md` §3:

- every numeric field is a **positive integer** with an explicit upper bound —
  `0`, negatives, `NaN` and strings are rejected. A missing or non-numeric field
  is what produces a `NaN` `riskScore` and aborts the detection transaction.
- `inProgressHoursBySp` keys are **strings** (JSON object keys always are;
  `ticket-status-aging.ts:14` consumes `Record<string, …>`) and the map must
  carry **exactly** the seven default keys `1,2,3,5,8,13,21` — no more, no fewer.
  Values are `positive integer | "8_WORKING_DAYS"`; the sentinel is permitted on
  any key because the detector branches on the value, not the key
  (`ticket-status-aging.ts:63`).
- `maxParallelByCategory` must carry **exactly** `IN_PROGRESS`, `CODE_REVIEW`,
  `TESTING`, each a positive integer.
- `percent` is bounded `1..100`.

Two house rules from the schema headers (`recap.ts:1-20`, `team-day-off.ts:1-14`):
**no server-only imports** — the client form pulls this same module — and **no
cross-row or DB questions**; uniqueness belongs to the constraint. Messages are
user-facing sentences, as in `measurement.ts:56-59`.

#### 3. Extract the merge, and guard the READ side of the jsonb boundary

**File**: `src/lib/anomaly/thresholds.ts`

**Intent**: the settings surface needs the same `stored ?? default` layering the
detector uses, plus one extra fact — whether a row exists. Duplicating the merge
would let the two drift; changing `resolveEffectiveThresholds`'s signature would
touch the detection hot path.

**Contract**: export a pure `mergeRule(base: AnomalyDefault, override)` helper
holding the existing `severity ?? base.severity` +
`{ ...base.thresholds, ...override }` logic, and have
`resolveEffectiveThresholds` call it. Its signature and return type are
unchanged — `detect.ts:51` must not need editing.

**`mergeRule` parses the stored body before it merges.** §2's schema is a write
guard only if it is also read here; a validated write is not the same as a
validated column, and the column outlives this slice. `mergeRule` runs the rule's
union member over `override.thresholds`, and on failure **ignores the override
entirely** — that rule falls back to `DEFAULT_THRESHOLDS[type]`, severity
included — and logs once, naming the anomaly type and the zod issue. Falling back
to a *partial* merge is the one thing it must not do: a half-applied body is the
`lessons.md` "narrowing predicate → empty result reads as success" shape, and the
log is that lesson's obligation (a), so a rule silently reverting to defaults is
never reported as an ordinary run.

Two failures this closes, neither reachable through the form:

- A body written under an older or newer shape. Concretely: the day a later slice
  adds a story-point bucket to `DEFAULT_THRESHOLDS`, every account that ever
  saved `TICKET_STATUS_AGING` holds a seven-key map that *replaces* the new
  eight-key default (the merge is one level deep), so the new bucket vanishes and
  `inProgressBudget` quietly falls to the nearest lower one. The write schema
  would by then also reject the stored shape, so the lead cannot re-save their
  way out. With the parse, that row is discarded and the rule runs on the current
  defaults instead.
- A hand-edited or otherwise out-of-band row reaching the eight unchecked `as`
  casts in the detectors.

`resolveEffectiveThresholds` stays exhaustive over the eight types and still
never throws — a bad row degrades one rule to its defaults, it does not fail the
detection run.

#### 4. The settings reader

**File**: `src/lib/anomaly-settings.ts` (new — top-level module holding reader
and writers, mirroring `src/lib/recap-settings.ts`)

**Intent**: give the page one serialisable list describing all eight rules: what
is in force now, and whether the lead has overridden it.

**Contract**: `readAnomalyRules({ db, ownerId })` selects the owner's rows once
and returns an array, in a fixed display order, of
`{ anomalyType, severity, thresholds, isOverridden }` — `isOverridden` is simply
whether a row exists for that type, which the Phase 2 normalisation makes
equivalent to "differs from the defaults". Exhaustive over all eight types, so a
fresh account with zero rows returns eight un-overridden entries.

#### 5. Tests

**File**: `src/lib/validations/anomaly-settings.test.ts` (new),
`src/lib/anomaly/thresholds.test.ts` (new — the file that has never existed)

**Intent**: assert the guard actually rejects the payloads that break detection,
and close the resolver's total absence of coverage.

**Contract**: schema tests cover, per rule, an accepted default-shaped payload
and rejection of: `0`, a negative, a non-integer, a string number, a missing
field, an SP map missing a key, an SP map with an extra key, an empty SP map, a
`maxParallelByCategory` missing a category, and `percent` at `0` / `101`.
Resolver tests cover `mergeRule` directly plus — per
`lessons.md` "test the no-configuration path through the real resolver" — the
**zero-row** path, which is the state every account is in today. They also cover
the read guard: a stored body that fails the schema yields that rule's defaults
(severity included) and leaves the other seven rules untouched, and a stored
`inProgressHoursBySp` missing a bucket is rejected wholesale rather than merged
in part.

### Success Criteria:

#### Automated Verification:

- Migration generates and applies: `npm run db:generate` then `npm run db:migrate`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- `src/lib/anomaly/thresholds.test.ts` exists and covers the zero-row path
- A stored body that fails the schema degrades that rule to its defaults and logs
- Detection is untouched: `detect.ts` has no diff

#### Manual Verification:

- `\d anomaly_settings` on the local DB no longer lists `is_default`

**Implementation Note**: after this phase's automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: Write path — store, Server Action, and D1 re-detect

### Overview

The owner-scoped persistence and the thin action over it. This is where the
project's isolation rules and the delete-then-insert lesson bind hardest.

### Changes Required:

#### 1. The store

**File**: `src/lib/anomaly-settings.ts` (extends Phase 1's reader)

**Intent**: persist one rule's complete configuration, or remove its override.

**Contract**: two request-context-free functions taking `{ db, ownerId, … }`:

- `saveAnomalyRule({ db, ownerId, input })` where `input` is a parsed union
  member. **Normalisation first**: if the submitted severity and body deep-equal
  `DEFAULT_THRESHOLDS[type]`, delegate to `resetAnomalyRule` and return — no row
  is written. The comparison is a small recursive `equalsDefaults(type, input)`
  helper exported from `anomaly-rules-view.ts` (pure, so it is unit-testable and
  the card can use the same predicate the store does) — the repo has no
  deep-equal utility and no dependency that supplies one, so this must not be
  left to `JSON.stringify`. It has to survive the key-form mismatch:
  `IN_PROGRESS_HOURS_BY_SP` is declared `Record<number, …>` (`defaults.ts:33`)
  but is a string-keyed object at runtime, and the parsed payload is string-keyed
  too, so compare over sorted `Object.keys` rather than on literal order or type. Otherwise `insert(...).onConflictDoUpdate({ target: [ownerId,
  anomalyType], set: { severityOverride, thresholds, updatedAt: new Date() } })`,
  following `measurement/overrides.ts:156-178`. Never delete-then-insert
  (`lessons.md` names "future settings/threshold sets" by hand). `updatedAt`
  explicitly, because `$onUpdate` does not fire on the conflict path.
- `resetAnomalyRule({ db, ownerId, anomalyType })` — `DELETE` with
  `and(eq(ownerId), eq(anomalyType))`. The owner predicate stays even where it
  looks redundant: "every table carries its own `ownerId` predicate and never
  inherits scoping" (S-10 F9, `impl-review.md:156`). There is no RLS.

Deleting a row that does not exist is a no-op, not an error — resetting an
already-default rule is a legitimate no-op, not a stale-payload attack. There is
no id to forge here: the key is `(ownerId, anomalyType)` and both come from the
session and the enum.

#### 2. The Server Action

**File**: `src/app/(app)/settings/anomalies/actions.ts` (new)

**Intent**: the request-path wrapper — resolve, validate, delegate, re-detect.

**Contract**: body order exactly as `settings/recap/actions.ts:31-62`:
`resolveWorkspace()` → `schema.safeParse(input)` → `getCloudflareContext()` +
`getDb(env)` **inside the body** → store call → `{ ok: true } | ActionFailure`,
with `ActionFailure` re-declared locally per house style. **No demo refusal** —
decided at planning: anomaly settings make no outbound call, demo writes land
under the demo owner and are undone by "Reset demo data", so the tab behaves like
`/settings/absences`, not like `/settings/recap`.

Two exported actions, `saveAnomalyRuleAction` and `resetAnomalyRuleAction`, each
followed by a shared `redetect(db, ownerId, now)` copied in shape from
`settings/absences/actions.ts:222-232`: post-commit, `try/catch`, logs and
swallows, **never fails the save**, and uses the workspace `now`.

Error text is never raw (S-07 F2): validation failures map to `invalid_input`
with the zod message; anything unexpected logs server-side and returns the
generic `integration_unavailable` sentence.

#### 3. Integration tests

**File**: `src/lib/anomaly-settings.integration.test.ts` (new)

**Intent**: prove persistence, normalisation and cross-account isolation against
real Postgres.

**Contract**: template is `src/lib/team-day-off-store.integration.test.ts` —
`newOwner()` inserting a `user`, `afterEach` cascade-delete from `user`;
`anomaly_settings` hangs off `user` alone, so no credential or sprint seed is
needed. Cases: fresh owner reads eight un-overridden rules; a save writes exactly
one row and leaves the other seven absent; a second save on the same rule updates
in place (one row, `updatedAt` advanced); a save equal to the defaults leaves no
row; reset removes the row and the reader returns defaults; **owner B's row is
byte-identical after owner A saves and resets** (mirroring
`team-day-off-store.integration.test.ts:185`); and an override really reaches the
detector — insert a row, run `resolveEffectiveThresholds`, assert the merged body,
including that a full `inProgressHoursBySp` override keeps all seven buckets.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Cross-account isolation case is present and passing

#### Manual Verification:

- None — no surface exists yet.

---

## Phase 3: The surface — `/settings/anomalies`

### Overview

The sixth tab: a server page, a client organism of eight independently-saving
cards, and the pure sibling holding every judgement, label and copy sentence.

### Changes Required:

#### 1. Register the tab

**File**: `src/app/(app)/settings/layout.tsx`

**Intent**: fill the slot reserved at `:28`.

**Contract**: add `{ label: "Anomaly rules", href: "/settings/anomalies" }`.
Place it **before** the Demo tab, which is last on purpose. Update the header
comment's "S-14 … slots in as a sixth entry" to record that it landed.

#### 2. The page

**File**: `src/app/(app)/settings/anomalies/page.tsx` (new)

**Intent**: resolve the workspace, read the eight rule states, hand them to the
client organism.

**Contract**: the canonical preamble from `settings/team/page.tsx:26-30` —
`resolveWorkspace()` (not `requireRealWorkspace()`; these are per-workspace data
with no outbound call, matching `/settings/absences`), then
`getCloudflareContext()` + `getDb(env)`, then `readAnomalyRules`. Does **not**
re-declare `requireSession()` or `force-dynamic` — both are inherited
(`settings/layout.tsx:15-16`).

#### 3. The pure view module

**File**: `src/components/organisms/settings/anomaly-rules-view.ts` (new)

**Intent**: hold everything testable without a DOM — there is no jsdom/RTL
harness, so this is where the slice's UI logic has to live.

**Contract**: exports (a) `RULE_DESCRIPTORS` — display order, human label, what
the rule detects, and per-field descriptors (key, label, unit suffix, min/max,
help text) for all eight rules, with `PR_TICKET_DESYNC` declaring **no** numeric
fields; (b) `toFormValues(state)` / `toPayload(values)` — the mapping between
form state and the action payload, where `toPayload` always emits the
**complete** body including every SP bucket and every parallel category; (c) the
21-SP bucket mapping between the two-position control and
`120 | "8_WORKING_DAYS"`; (d) the copy constants for the two facts the lead
cannot otherwise know: severity has no tier above `HIGH` (`SPRINT_AT_RISK`
already sits there, so that one rule can only move down), and saving re-runs
detection immediately, so the inbox reflects the change on the next view rather
than at the next cron tick. These are load-bearing hints in the sense
`recap-settings-view.ts:61-74` means it, not decoration.

**Deliberately NOT copy**: anything about `RESOLVED` rows keeping their old tier
or threshold number. `reader.ts:61` filters `status = ACTIVE` and the recap
consumes the same reader, so a resolved row is rendered on no surface — a warning
about it would spend the card's scarce copy budget on an invisible state.

#### 4. The client organism

**File**: `src/components/organisms/settings/anomaly-rules-editor.tsx` (new)

**Intent**: render the eight cards and own the hooks — nothing else.

**Two components, not one.** `AnomalyRulesEditor` maps `RULE_DESCRIPTORS` over
the server-supplied states and renders `<AnomalyRuleCard>` per rule; the CARD
owns `useForm` / `useTransition`. Calling either hook inside the parent's `.map()`
is a rules-of-hooks violation that fails `npm run lint` (criterion 3.2), and the
repo has no precedent to fall back on: every existing multi-row form
(`roster-editor.tsx:189-200`) is ONE `useForm` + `useFieldArray`, which the
per-rule-save decision rules out here. Both components live in this file.

**Contract**: `"use client"`. Each card renders: title + description, a
`Select` for severity, an `<Input type="number">` per numeric field
(`valueAsNumber`; there is no shadcn NumberInput and no `slider` in the
inventory), a `Badge` reading "Modified" when `isOverridden`, and **Save** +
**Reset to defaults** buttons — Reset disabled when the rule is not overridden.
`TICKET_STATUS_AGING`'s card additionally renders the seven SP buckets, with the
21-SP row as a two-position control (`120 h` / `8 working days`) rather than a
free number. `PR_TICKET_DESYNC`'s card renders severity alone and says so.

Each card is its own `react-hook-form` + `zodResolver` form over **its own
exported union member** (Phase 1 §2), with its own `useTransition`, its own
`sonner` toast and `router.refresh()` on success. The RHF pattern to copy is
`absence-editor.tsx:139-146` / `roster-editor.tsx:189-200` — NOT
`recap-settings-form.tsx`, which is `useState` + manual validation and uses no
`react-hook-form` at all; only its `startTransition` → toast → `router.refresh()`
tail (`:53-79`) is the shared idiom. `useWatch`, not `form.watch`, so the React
Compiler can still memoize (`absence-editor.tsx:144-146`). Errors render as
`<p className="text-sm text-destructive">` beside the field; do **not** import
`ui/form.tsx`, which nothing in the project uses. Layout must hold at 1024 px
(tablet floor, a PRD NFR).

#### 5. View tests

**File**: `src/components/organisms/settings/anomaly-rules-view.test.ts` (new)

**Contract**: `toPayload` round-trips every rule; the SP map always leaves with
seven keys even when one bucket changed; the 21-SP control maps both ways; every
one of the eight types has a descriptor and every descriptor field exists in
`DEFAULT_THRESHOLDS` for that type (the assertion that catches a field renamed on
one side only).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Settings shows a sixth tab "Anomaly rules", before Demo, and it opens
- All eight rules render; `PR_TICKET_DESYNC` shows severity only
- Changing `PR_TOO_BIG` → `maxLines` and saving toasts, and the value survives a
  reload with a "Modified" badge on that card alone
- After that save, the Anomaly Inbox reflects the new threshold **immediately**,
  without "Sync now" and without waiting for the cron cycle (the D1 proof).
  **Run this in the demo workspace** — `detectAnomalies` returns
  `{status:"skipped", reason:"no_sprint"}` when there is no active sprint
  (`detect.ts:48`) and the action swallows the result, so on an account without
  one the save toasts success and the inbox never moves, which is indistinguish-
  able from the D1 wiring being broken. The demo fixture guarantees an active
  sprint with PRs, and the tab is deliberately allowed in demo
- "Reset to defaults" clears the badge and restores the shipped number
- Entering `0` or a negative is refused inline and nothing is written
- The form is usable at 1024 px width

**Implementation Note**: after this phase's automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 4: Closure — roadmap correction and manual-test documentation

### Overview

Resolve the contradiction this slice inherited, and hand the tester rows they can
act on without asking questions.

### Changes Required:

#### 1. Correct the roadmap's S-14 outcome

**File**: `context/foundation/roadmap.md`

**Intent**: `:380` says changes "take effect on the next detection cycle", while
S-08's decision D1 — which the owner generalised, naming S-14 explicitly — says
any save of a factor feeding detection re-runs detection. The implementation
follows D1; leaving both statements in the repo leaves two versions of the truth.

**Contract**: rewrite the S-14 outcome to state the D1 behaviour, add a dated
note recording the correction and its source
(`context/archive/2026-08-25-absence-calendar/research.md:557-570`), and flip the
slice's status to `done` in both the table row (`:48`) and the detail entry.

#### 2. Manual checklist

**File**: `context/changes/anomaly-settings-page/MANUAL-CHECKLIST.md` (new)

**Intent**: the short list — only what blocks the slice.

**Contract**: 4 rows, Polish, following
`context/archive/2026-08-28-demo-mode/MANUAL-CHECKLIST.md` in shape (`## A.`–`## D.`
with bolded **Gdzie / Co zrobić / Co musi być prawdą / Dlaczego to łapie**),
signed off with Phase 3. The four that genuinely block: the tab is reachable and
shows current values; a save survives reload and badges exactly one card; the D1
proof (inbox changes without a sync); a rejected `0` writes nothing. The D1 row
must name the **demo workspace** as its account, and say why: without an active
sprint `detectAnomalies` skips silently, so the row would otherwise be
unfalsifiable — exactly the missing "which account" CLAUDE.md's manual-test
convention requires.

#### 3. Backlog section

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: everything else, with the reason it was deferred.

**Contract**: a new numbered section for anomaly settings, Polish, matching the
established format. Rows: the 1024 px tablet-width check (§7.5's shape); reset
restoring defaults; each of the eight cards rendering its real fields; the
`TICKET_STATUS_AGING` SP map keeping all seven buckets after editing one; the
21-SP two-position control; demo-mode writes landing under the demo owner and
being undone by "Reset demo data"; and a note that a threshold change can disturb
the still-open S-07 rows 1.5, 2.5, 3.5, 3.6, 4.7, 5.2–5.5.

### Success Criteria:

#### Automated Verification:

- Both files exist and the checklist has 4 rows: `ls context/changes/anomaly-settings-page/MANUAL-CHECKLIST.md`
- `roadmap.md` no longer contains "next detection cycle" in the S-14 entry

#### Manual Verification:

- The checklist rows can be executed without asking a follow-up question

---

## Testing Strategy

### Unit Tests

- `src/lib/validations/anomaly-settings.test.ts` — per rule: the default-shaped
  payload accepted; `0`, negative, non-integer, string, missing field rejected;
  SP map with a missing / extra key and an empty SP map rejected;
  `maxParallelByCategory` missing a category rejected; `percent` bounds.
- `src/lib/anomaly/thresholds.test.ts` — `mergeRule` layering, and the real
  resolver on the **zero-row** path.
- `src/components/organisms/settings/anomaly-rules-view.test.ts` — payload
  round-trip, seven-bucket invariant, 21-SP control mapping, descriptor/defaults
  agreement.

### Integration Tests

- `src/lib/anomaly-settings.integration.test.ts` — save / update-in-place /
  reset / normalise-to-no-row, exhaustive fresh-account read, cross-account
  isolation, and an override actually reaching `resolveEffectiveThresholds`.

### Manual Testing Steps

1. Settings → **Anomaly rules** opens and shows eight cards with current values.
2. Set `PR_TOO_BIG` → max lines to `50`, Save. Toast appears; only that card
   badges "Modified"; the value survives a reload.
3. Open the dashboard inbox — new `PR_TOO_BIG` anomalies are present
   immediately, with no "Sync now" and no waiting for the cron cycle.
4. Back on the tab, **Reset to defaults** — badge clears, `500` returns, and the
   inbox drops back on the next view.
5. Enter `0` in any numeric field and Save — refused inline, nothing persisted.
6. Repeat step 2 at 1024 px browser width.

## Performance Considerations

The D1 re-detect is the only real cost on this path: `detectAnomalies` runs
`loadSprintSnapshot`, which issues five selects, inside the Server Action. Per-rule
save keeps that to exactly one re-detect per user action; a whole-form save would
have been one re-detect for up to eight changes, which is cheaper, but at the cost
of the whole-body payload guarantee that makes the shallow merge safe. Reads are
one indexed select on `(owner_id)` returning at most eight rows.

## Migration Notes

One generated migration, `DROP COLUMN is_default` — a column no code reads or
writes, so it is backward-compatible with any running instance. `db:generate` and
`db:migrate` default to the local Supabase via `.env.local`
(`drizzle.config.ts`); applying to production needs the deliberate
`DATABASE_URL_OVERRIDE` escape hatch. No data migration: existing accounts have
zero `anomaly_settings` rows, and "no row means defaults" means there is nothing
to backfill.

## References

- Research: `context/changes/anomaly-settings-page/research.md`
- Change identity + pre-plan findings: `context/changes/anomaly-settings-page/change.md`
- Roadmap entry: `context/foundation/roadmap.md:378-390`
- PRD: FR-009 (`prd.md:127`), FR-014 (`prd.md:147`)
- Decision D1: `context/archive/2026-08-25-absence-calendar/research.md:557-570`
- Upsert precedent: `src/lib/measurement/overrides.ts:156-178`
- Action template: `src/app/(app)/settings/recap/actions.ts:31-62`
- Re-detect precedent: `src/app/(app)/settings/absences/actions.ts:222-232`
- Form precedent: `src/components/organisms/settings/recap-settings-form.tsx:24-31,53-79`
- Integration-test template: `src/lib/team-day-off-store.integration.test.ts`
- Lessons that bind: `context/foundation/lessons.md` (delete-then-insert;
  narrowing predicate; test the no-configuration path)
- GitHub issue: `#24` (parent tracker `#25`) — PR closes with `closes #24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract layer — schema hygiene, validation, and the settings reader

#### Automated

- [x] 1.1 Migration generates and applies: `npm run db:generate` then `npm run db:migrate` — cd73548
- [x] 1.2 Type checking passes: `npm run typecheck` — cd73548
- [x] 1.3 Linting passes: `npm run lint` — cd73548
- [x] 1.4 Unit tests pass: `npm test` — cd73548
- [x] 1.5 `src/lib/anomaly/thresholds.test.ts` exists and covers the zero-row path — cd73548
- [x] 1.6 A stored body that fails the schema degrades that rule to its defaults and logs — cd73548
- [x] 1.7 Detection is untouched: `detect.ts` has no diff — cd73548

#### Manual

- [x] 1.8 `\d anomaly_settings` on the local DB no longer lists `is_default` — cd73548

### Phase 2: Write path — store, Server Action, and D1 re-detect

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 688d9c6
- [x] 2.2 Linting passes: `npm run lint` — 688d9c6
- [x] 2.3 Unit tests pass: `npm test` — 688d9c6
- [x] 2.4 Integration tests pass: `npm run test:integration` — 688d9c6
- [x] 2.5 Cross-account isolation case is present and passing — 688d9c6

### Phase 3: The surface — `/settings/anomalies`

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Unit tests pass: `npm test`
- [x] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Settings shows a sixth tab "Anomaly rules", before Demo, and it opens
- [ ] 3.6 All eight rules render; `PR_TICKET_DESYNC` shows severity only
- [ ] 3.7 Changing `PR_TOO_BIG` → `maxLines` and saving toasts, and the value survives a reload with a "Modified" badge on that card alone
- [ ] 3.8 In the DEMO workspace (no active sprint ⇒ detect skips silently): after that save, the Anomaly Inbox reflects the new threshold immediately, without "Sync now" and without waiting for the cron cycle (the D1 proof)
- [ ] 3.9 "Reset to defaults" clears the badge and restores the shipped number
- [ ] 3.10 Entering `0` or a negative is refused inline and nothing is written
- [ ] 3.11 The form is usable at 1024 px width

### Phase 4: Closure — roadmap correction and manual-test documentation

#### Automated

- [ ] 4.1 Both files exist and the checklist has 4 rows
- [ ] 4.2 `roadmap.md` no longer contains "next detection cycle" in the S-14 entry

#### Manual

- [ ] 4.3 The checklist rows can be executed without asking a follow-up question
