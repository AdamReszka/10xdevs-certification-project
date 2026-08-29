---
date: 2026-08-29T12:05:07+02:00
researcher: Adam Reszka
git_commit: f398f4bbece0d0b75fa2510023113f43e6895584
branch: feat/anomaly-settings-page
repository: 10xdevs-certification-project
topic: "S-14 — anomaly threshold + severity settings page"
tags: [research, codebase, anomaly-settings, thresholds, severity, settings-tab, FR-009, FR-014]
status: complete
last_updated: 2026-08-29
last_updated_by: Adam Reszka
---

# Research: S-14 — anomaly threshold + severity settings page

**Date**: 2026-08-29T12:05:07+02:00
**Researcher**: Adam Reszka
**Git Commit**: `f398f4bbece0d0b75fa2510023113f43e6895584`
**Branch**: `feat/anomaly-settings-page`
**Repository**: 10xdevs-certification-project

## Research Question

What does S-14 (`anomaly-settings-page`, FR-009 + FR-014) actually have to
build? Specifically: what the threshold/severity domain layer already provides,
what each of the eight detectors really reads out of the open `thresholds`
jsonb, how the `/settings` shell and the repo's form conventions expect a new
tab to be assembled, what the owner-scoped write path must look like, and which
prior decisions constrain the design.

## Summary

**The structural half of S-14 is done and live.** `anomaly_settings` exists with
per-owner scoping baked into a `unique(owner_id, anomaly_type)` constraint, its
migration is applied, `resolveEffectiveThresholds` layers overrides over
`DEFAULT_THRESHOLDS`, and the detection path really calls it. The `/settings`
shell has a reserved one-line slot for the tab. `zod`, `react-hook-form` and
every needed shadcn primitive except `slider`/`separator` are already present.

**What S-14 owns is everything between the form and the jsonb column** — and
that turns out to be more load-bearing than "a form plus a save button", for
four reasons the research made concrete:

1. **There are zero writers to `anomaly_settings` today** and **zero runtime
   guards on read.** Every detector does an unchecked `as` cast on the jsonb
   body. A bad override does not throw at the write; it misbehaves at detection
   time, and it does so in two distinct ways — a silent false-positive storm, or
   a `NaN` `risk_score` that aborts the whole detection transaction against an
   `integer` column. Validation at the write path is not hygiene here, it is the
   only defence that exists.
2. **The merge is shallow** (`thresholds.ts:45-48`). The two rules with nested
   bodies — `TICKET_STATUS_AGING.inProgressHoursBySp` and
   `SPRINT_AT_RISK.maxParallelByCategory` — are *replaced wholesale* by an
   override, not merged into. A form that submits one changed SP bucket silently
   deletes the other six, and `inProgressBudget` then falls back to the nearest
   remaining bucket without complaint. The payload must carry the complete
   nested object.
3. **The roadmap's "changes take effect on the next detection cycle" conflicts
   with S-08's decision D1** (`context/archive/2026-08-25-absence-calendar/research.md:557-570`),
   which the owner generalised at the time to name S-14 explicitly: any save of
   a factor feeding anomaly detection re-runs detection. `/settings/absences`
   already implements it. The plan must pick one and say so; it cannot inherit
   both.
4. **Severity can only ever move down.** `SPRINT_AT_RISK` already defaults to
   `HIGH` and `risk_score = WEIGHT[severity] × magnitude × 100/3` has no tier
   above it — a documented finding from S-08
   (`context/archive/2026-08-25-absence-calendar/research.md:55-59`).

One correction to the pre-plan note in `change.md`: the settings shell is
**route-segment based**, not a shadcn `Tabs` widget, and there are already
**five** tabs (Connections, Team, Absences, Daily recap, Demo) — S-14 is the
sixth, not the second.

## Detailed Findings

### 1. The persistence seam — built, live, and never written to

`anomaly_settings` — `src/db/schema.ts:924-947`, DDL in
`src/db/migrations/0001_lying_human_cannonball.sql:44-54`, FK at `:274`.
**Verified applied on the local DB**; no new migration is needed.

| column | type | null | notes |
|---|---|---|---|
| `id` | text | PK | app-generated `randomUUID()` |
| `owner_id` | text | NOT NULL | FK → `user.id`, `ON DELETE CASCADE` |
| `anomaly_type` | `anomaly_type` | NOT NULL | |
| `severity_override` | `severity` | **nullable** | NULL ⇒ use the rule default |
| `thresholds` | jsonb | **nullable** | NULL merges as `{}` |
| `is_default` | boolean | nullable | **dead column** — written nowhere, read nowhere |
| `created_at` / `updated_at` | timestamp | NOT NULL | `updated_at` has `$onUpdate` (`schema.ts:936-939`) |

Constraint `anomaly_settings_owner_type_uq` on `(owner_id, anomaly_type)`.
**Account scoping is therefore structural** — the roadmap's stated framing risk
("a missing account-scope constraint would leak one user's changes to all
users") is closed in the schema, which is why this slice skipped `/10x-frame`.

`resolveEffectiveThresholds(db, ownerId)` — `src/lib/anomaly/thresholds.ts:24-52`:

- selects the owner's rows, builds a `Map`, then loops `anomalyType.enumValues`
  so the result is **always exhaustive over all 8 types** — detectors index
  unconditionally;
- severity: `override?.severityOverride ?? base.severity` (`:44`);
- thresholds: **shallow spread** `{ ...base.thresholds, ...(override?.thresholds ?? {}) }` (`:45-48`);
- **no validation, no coercion, no runtime type check.** The jsonb returns as
  `unknown` and is cast at `:47`. A stored `"24"`, `null`, `-5` or `0` reaches
  the arithmetic unmodified.
- **It has no test file at all** — there is no `src/lib/anomaly/thresholds.test.ts`.
  The merge semantics are entirely unguarded.

**Writers: none.** An exhaustive grep across `*.ts`, `*.tsx`, `*.sql`,
`scripts/` and `context/` finds only the SELECT at `thresholds.ts:30-35`, the
schema declaration, and the DDL. `src/lib/demo/fixture.ts:42-44` is a comment
recording that the demo owner deliberately has **no** `anomaly_settings` rows.
S-14 owns the entire write path.

### 2. `DEFAULT_THRESHOLDS` — the eight bodies S-14 must be able to express

`src/db/defaults.ts:43-86`, typed `Record<AnomalyTypeValue, AnomalyDefault>`
where `AnomalyDefault = { severity: SeverityValue; thresholds: Record<string, unknown> }`
— the open shape, with the comment "open shape; owning slice refines"
(`defaults.ts:25`). **S-14 is that owning slice.**

| type | default severity | thresholds body | unit |
|---|---|---|---|
| `PR_REVIEW_STALLED` | MEDIUM | `{ hours: 24 }` | hours |
| `TICKET_STATUS_AGING` | MEDIUM | `{ inProgressHoursBySp: {…}, codeReviewHours: 24, testingHours: 48 }` | hours |
| `DEVELOPER_INACTIVE` | MEDIUM | `{ noCommitDays: 2 }` | **calendar** days |
| `TICKET_NO_COMMIT_LINK` | MEDIUM | `{ noCommitDays: 2 }` | **calendar** days |
| `SPRINT_AT_RISK` | **HIGH** | `{ maxParallelByCategory: { IN_PROGRESS: 2, CODE_REVIEW: 2, TESTING: 3 }, toDoBeforeSprintEndLeadTimeHours: 48 }` | counts; hours |
| `PR_TOO_BIG` | **LOW** | `{ maxLines: 500 }` | additions + deletions |
| `SCOPE_CREEP` | MEDIUM | `{ percent: 20 }` | % of committed SP |
| `PR_TICKET_DESYNC` | **LOW** | `{}` | **no tunable field at all** |

The hard case, `defaults.ts:28-41`:

```ts
const IN_PROGRESS_HOURS_BY_SP: Record<number, number | "8_WORKING_DAYS"> = {
  1: 24, 2: 24, 3: 48, 5: 72,
  8: 120,  // 5 days
  13: 120, // 5 days
  21: "8_WORKING_DAYS",
};
```

Three traps in one constant:

- **The key type drifts across the jsonb boundary.** Declared `Record<number, …>`
  here, consumed as `Record<string, …>` at `ticket-status-aging.ts:14` — correct,
  because JSON object keys are strings. The zod schema must accept string keys.
- **The sentinel carries no number.** `"8_WORKING_DAYS"` is matched literally at
  `ticket-status-aging.ts:63`, and the comparison then hard-codes `8`
  (`triggered = elapsed >= 8`, `:74`). A form cannot express "10 working days"
  without a new sentinel or a schema change — the 21-SP bucket is effectively a
  boolean toggle between "120 h" and "8 working days", not a free number.
- **An empty map silently disables In-Progress aging.** `inProgressBudget`
  (`ticket-status-aging.ts:22-35`) does `Object.keys(map).map(Number)` and
  returns `null` when the map is empty — the rule then skips every ticket and
  reports nothing, which reads exactly like a healthy sprint. This is
  `lessons.md:40-45` ("a narrowing predicate turns 'wrong value' into 'empty
  result', which reads as success") arriving through the settings form.

`DEFAULT_THRESHOLDS` is **never seeded into the DB** — a decision taken at F-02
(`context/archive/2026-05-31-data-schema-baseline/plan.md:34`) and restated by
S-06 (`plan-brief.md:37`: "no seeding; no stale-seed drift; S-14 writes rows
lazily on override"). This is what makes "reset to defaults" naturally a
**DELETE of the row**, not a write of the default values.

### 3. What each detector actually reads — and what a bad value does

No helper mediates threshold access. `rules/helpers.ts:14-18` supplies only the
`Detector` signature (`(snapshot, effective, now) => DetectedAnomaly[]`); every
rule destructures `effective.<TYPE>` and casts the body itself.

| Rule | Reads | Behaviour on a missing / bad value |
|---|---|---|
| `PR_REVIEW_STALLED` (`rules/pr-review-stalled.ts:17-18`) | `hours` | missing ⇒ every eligible PR fires, `magnitude = clamp01(x/NaN)` ⇒ **NaN `riskScore` ⇒ integer-column insert error** |
| `TICKET_STATUS_AGING` (`rules/ticket-status-aging.ts:44-45,61-86`) | `inProgressHoursBySp`, `codeReviewHours`, `testingHours` | empty map ⇒ **silently skips everything**; missing hour fields ⇒ rule never fires for that category (silent) |
| `DEVELOPER_INACTIVE` (`rules/developer-inactive.ts:29-31`) | `noCommitDays` | missing ⇒ Invalid Date window ⇒ **everyone with In-Progress work is flagged**; magnitude is literal `1`, so it persists cleanly — a silent false-positive storm |
| `TICKET_NO_COMMIT_LINK` (`rules/ticket-no-commit-link.ts:26-28`) | `noCommitDays` | missing ⇒ fires broadly **and** NaN riskScore ⇒ insert error |
| `SPRINT_AT_RISK` (`rules/sprint-at-risk.ts:41-42`) | `maxParallelByCategory[…]`, `toDoBeforeSprintEndLeadTimeHours` | **has explicit guards** — `if (limit == null) continue` (`:50-51`), divide-by-zero guards at `:95`, `:167-168`. Missing lead-time ⇒ condition 2 silently never fires. Condition 3 (unplanned absence, `:124-195`) reads **no threshold** and is not tunable |
| `PR_TOO_BIG` (`rules/pr-too-big.ts:11-12`) | `maxLines` | missing ⇒ every PR fires + NaN ⇒ insert error |
| `SCOPE_CREEP` (`rules/scope-creep.ts:11-12`) | `percent` | guards `committed <= 0` and `addedSp <= 0`; missing `percent` ⇒ always fires + NaN ⇒ insert error |
| `PR_TICKET_DESYNC` (`rules/pr-ticket-desync.ts:16`) | **severity only** | nothing to misconfigure — the form should expose severity alone for this rule |

Two failure classes, both invisible at save time: **a NaN risk score aborts the
detection transaction** (four rules), and **a silently inverted predicate**
produces either a storm or an empty inbox (three rules). Neither is
distinguishable from a healthy run without validation at the write.

### 4. Severity — stamped, refreshed on re-detect, one-directional

- `severity` = `pgEnum("severity", ["HIGH","MEDIUM","LOW"])` — `schema.ts:54`.
  **Declaration order is load-bearing**: `reader.ts:64` sorts
  `asc(anomaly.severity)` on the Postgres enum ordinal, guarded by
  `reader.integration.test.ts`.
- `anomaly.severity` is **NOT NULL** (`schema.ts:897`) and stamped **by the
  detector**, not the orchestrator — each rule copies `effective.<TYPE>.severity`
  into its emitted anomaly; `detect.ts:79` merely carries it. (The comment at
  `types.ts:75-77` claiming "the orchestrator may still apply an override" is
  stale — it applies nothing.)
- `riskScore = riskScore(d.severity, d.magnitude)` — `detect.ts:82`, formula
  `clamp(round(WEIGHT × magnitude × 100/3), 0, 100)` at `risk-score.ts:14-20`
  (`HIGH:3, MEDIUM:2, LOW:1` ⇒ 100 / 67 / 33 at full magnitude). There is **no
  separate S-07 aggregate** — this per-anomaly column *is* the severity-weighted
  sprint-risk score.
- **A still-detected anomaly DOES pick up a new severity on the next cycle.**
  `detect.ts:75-85` builds a `mutable` set including `severity` and `riskScore`,
  applied on both the `onConflictDoUpdate` path (`:102-105`) and the update path
  (`:108-118`); `id` and `detectedAt` are preserved. What never re-tiers is a row
  whose condition has cleared (flipped `RESOLVED` at `:121-129`) — those keep
  their old tier forever.
- **Re-tiering is one-directional in practice.** `SPRINT_AT_RISK` already
  defaults to `HIGH`, and there is no tier above it
  (`context/archive/2026-08-25-absence-calendar/research.md:55-59`). The UI can
  only ever move a rule down.

Downstream consumers all read the **stored row**, none re-resolves against
`anomaly_settings`: `reader.ts:45,50,64` · `inbox-view.ts:45,50` ·
`inbox-controls.ts:26-30,74-88` (note: filters by type + member only — **no
severity filter**) · `anomaly-row.tsx:37,45-47` · `recap/build.ts:82-93` ·
`recap/render.ts:30,138,231`.

One consequence worth surfacing in the UI: `src/lib/anomaly/context.ts:190,207,212,224,230`
**snapshots the threshold numbers into `anomaly.context` at detection time**
("threshold 24h", "2/2", "max 500"). After a threshold change, existing rows
display the *old* number until re-detection.

### 5. The `/settings` shell — route segments, five existing tabs, slot reserved

Not a shadcn `Tabs` widget. `SettingsTabs`
(`src/components/molecules/settings-tabs.tsx`) is a `"use client"` list of
`Link`s, active by `usePathname()` prefix match (`:26`). The shadcn `Tabs`
primitive exists (`src/components/ui/tabs.tsx`) but is used only on the
dashboards.

The registry — `src/app/(app)/settings/layout.tsx:19-29`:

```tsx
const TABS = [
  { label: "Connections", href: "/settings/connections" },
  { label: "Team",        href: "/settings/team" },
  { label: "Absences",    href: "/settings/absences" },
  { label: "Daily recap", href: "/settings/recap" },
  { label: "Demo",        href: "/settings/demo" },   // last on purpose
  // S-14 adds { label: "Anomaly rules", href: "/settings/anomalies" } here.
];
```

The slot is literally reserved at `:28`. Gating is inherited — `layout.tsx:15-16`
says outright: *"Inherits `requireSession()` + `force-dynamic` from
`(app)/layout.tsx` — do NOT re-declare either."*

The canonical page preamble (`settings/team/page.tsx:26-30`):

```ts
const { ownerId } = await resolveWorkspace();
const { env } = getCloudflareContext();
const db = getDb(env);
```

Two resolvers, and the choice is deliberate: `resolveWorkspace()`
(`src/lib/workspace.ts:86`) returns the **demo** owner when in demo mode;
`requireRealWorkspace()` (`:132`) always the real one, used only by Connections
because "integration configuration is never simulated". Anomaly thresholds are
per-workspace data with no outbound call ⇒ **`resolveWorkspace()`**, matching
`/settings/absences`.

**Files a sixth tab touches:** edit `settings/layout.tsx:28`; add
`settings/anomalies/page.tsx` + `actions.ts`; add the client organism under
`src/components/organisms/settings/` plus its pure `.ts` sibling and test; add
`src/lib/validations/anomaly-settings.ts`; optionally a reader in
`src/lib/settings/`. The nav entry already exists (`main-nav.tsx:13`).

### 6. Form and action conventions

**`react-hook-form` + `zod` + `zodResolver`** is standard across every real form
(`auth/login-form.tsx:38`, `setup/roster-editor.tsx:190`,
`settings/absence-editor.tsx:140`, …). The lone exception is the 2-field
`recap-settings-form.tsx`, which uses plain `useState` — an 8-rule threshold
form should take the RHF path. `useWatch`, not `form.watch`, so the React
Compiler can still memoize (`absence-editor.tsx:137-138`).

`src/components/ui/form.tsx` exists but **is imported by nothing**; every
organism wires `<Label htmlFor>` + `<Input>` + a manual
`<p className="text-sm text-destructive">` (`absence-editor.tsx:410-413`). Match
the organisms, not the unused wrapper.

**Schemas live in `src/lib/validations/<domain>.ts`**, never colocated with the
action, with two hard rules stated in their headers (`recap.ts:1-20`,
`team-day-off.ts:1-14`): no server-only imports (the client form pulls the same
module), and no cross-row/DB questions in zod (uniqueness belongs to a
constraint, which a crafted payload cannot bypass). Messages are written as
user-facing sentences (`measurement.ts:56-59`).

**Action body order** — `recap/actions.ts:31-62` is the template:

1. `resolveWorkspace()` → `{ ownerId, isDemo, now }`
2. optional `if (isDemo) return demoRefusal();`
3. `schema.safeParse(input)` → on failure
   `{ ok:false, error:"invalid_input", message: parsed.error.issues[0]?.message ?? "…" }`
4. **then** `getCloudflareContext()` + `getDb(env)` — inside the body, never at
   module scope; `sync/actions.ts:94` states the rule that a refused action must
   not open a connection it then tears down
5. delegate to a request-context-free store
6. return `{ ok: true } | ActionFailure`

`ActionFailure = { ok:false; error:"invalid_input"|"integration_unavailable"|"demo_mode"; message:string }`,
re-declared per file (`recap/actions.ts:23-27`, `absences/actions.ts:61-65`).
Domain errors map to `invalid_input` and **do not log**; only the unexpected
branch `console.error`s (`absences/actions.ts:243-261`). Error text is never
raw — see §9 on the F2 constraint.

**Client feedback:** `useTransition` + `sonner` `toast` + `router.refresh()`
(`recap-settings-form.tsx:53-79`). **No `useActionState`, no `useFormStatus`, no
`revalidatePath` anywhere in `src/`** — the sole exception is
`settings/demo/actions.ts:41-43`, which revalidates seven paths because
switching workspace changes what every gated route reads.

**Pool teardown:** the `db-pool-teardown` change is still `status: new` and
`src/lib/db.ts` still carries the documented leak. Request-path actions call
plain `getDb(env)` and do nothing about teardown; only the request-less sync
paths use `getDbWithPool` + `ctx.waitUntil(pool.end())`
(`sync/actions.ts:99,133-140`). A new settings action should use plain
`getDb(env)` — diverging here would be the anomaly.

**The pure-`.ts`-sibling seam** (CLAUDE.md convention; there is no jsdom/RTL
harness). Examples: `recap-settings-view.ts`, `absence-calendar-view.ts`,
`inbox-controls.ts`, `roster-merge.ts`. Every judgement, comparator, predicate,
format string and copy sentence moves to the `.ts`; the `.tsx` keeps rendering
and hooks only. Clocks are injected (`now: Date = new Date()`) for determinism.
The `.tsx` imports its sibling **relatively**; the test imports it via `@/`
(`inbox-controls.test.ts:1-8`).

**shadcn inventory** (`src/components/ui/`, 21 files): `alert-dialog`, `alert`,
`badge`, `button`, `calendar`, `card`, `chart`, `checkbox`, `collapsible`,
`dialog`, `form`, `input`, `label`, `scroll-area`, `select`, `sonner`, `switch`,
`table`, `tabs`, `textarea`, `tooltip`.
**Absent:** `slider`, `separator`, `accordion`, `radio-group`. There is no
shadcn NumberInput — use `<Input type="number">` with RHF `valueAsNumber`; the
only numeric-ish precedent is `<Input type="time">` (`recap-settings-form.tsx:107-114`).

### 7. The write path S-14 must follow

The closest structural precedent is `src/lib/measurement/overrides.ts:156-178` —
partial `set`, owner in the conflict target, `.returning()`:

```ts
.onConflictDoUpdate({
  target: [sprintMeasurement.ownerId, sprintMeasurement.jiraSprintId],
  set: { ...patch, updatedAt: now },
})
```

`src/lib/recap-settings.ts:76-98` is the singleton-per-owner variant and the
other file that models "no row means defaults".

Three concrete obligations:

- **Never delete-then-insert.** `lessons.md:33-38` names this slice by hand:
  *"applies to … future settings/threshold sets"*. Use `onConflictDoUpdate` on
  `(ownerId, anomalyType)`.
- **`updatedAt` must be set explicitly.** Drizzle's `$onUpdate`
  (`schema.ts:936-939`) does **not** fire inside an `onConflictDoUpdate` `set`;
  both precedents set it by hand.
- **Owner predicate on every UPDATE/DELETE, kept even when redundant** —
  "defence in depth on the isolation guarantee" (`roster-store.ts:452-453`,
  `absence-store.ts:211`). A submitted id outside the caller's set **throws**
  (`UnknownMemberError`, `UnknownAbsenceError`, `UnknownTeamDayOffError`,
  `UnknownSprintError`) rather than being treated as new. There is **no RLS** —
  `dashboard/readers.integration.test.ts:33-35` says so explicitly; isolation is
  app-enforced only.

"Reset to defaults" falls out of the no-seed model as a **DELETE with
`and(eq(type,…), eq(ownerId, ownerId))`** — no row means the defaults show
through `resolveEffectiveThresholds` again.

**Testing.** No `withDb`, no factory module, no truncation helper — every
integration spec builds its own and the boilerplate is copy-pasted.
`src/lib/team-day-off-store.integration.test.ts` is the simplest owner-only
template (`newOwner()` inserting a `user`, `afterEach` cascade-delete from
`user`). `anomaly_settings` hangs off `user` alone, so it needs no credential or
sprint seed. Constraint assertions go through the driver error, not the message
(`recap-settings.integration.test.ts:183-198`):
`err?.cause?.code === "23505"`, `err?.cause?.constraint === "anomaly_settings_owner_type_uq"`.

Existing isolation tests to mirror: `recap-settings.integration.test.ts:149`,
`team-day-off-store.integration.test.ts:185` (asserts the victim row is
byte-identical afterwards), `overrides.integration.test.ts:300`,
`setup/github/actions.integration.test.ts:258` (`#4 cross-account IDOR`).

### 8. Existing test coverage — and the gap that matters

Unit (`vitest.config.ts`, DB-free): `risk-score.test.ts`, eight per-rule tests,
`rules/index.test.ts`, `rules/helpers.test.ts`, `inbox-controls.test.ts:62-68,108-111`,
`inbox-view.test.ts`, `context.test.ts`, `suggested-action.test.ts`,
`recap/render.test.ts:247-256`.

**Every rule test uses the same fixture, which is literally `DEFAULT_THRESHOLDS`
cast to `EffectiveThresholds`** (`src/lib/anomaly/test-support.ts:22`). A grep
for a modified threshold body or an overridden severity across all rule tests
returns **nothing**. Boundary tests exist, but only against the defaults.

Integration: `detect.integration.test.ts` never inserts an `anomaly_settings`
row — the override path is untested end to end.
`resolveEffectiveThresholds` has **no test file at all**.

This is `lessons.md:47-52` in advance: S-14 needs a test that runs the **real**
resolver with **zero** rows (the state every account is in today), not only one
that injects a ready-made config.

Stryker: `stryker.conf.json` (the one that wins by filename precedence) mutates
`src/lib/anomaly/rules/**/*.ts`, `risk-score.ts`, `suggested-action.ts`, `break: 70`.
It does **not** cover `thresholds.ts`, `detect.ts` or `defaults.ts`.
`test-support.ts` sits outside `rules/` deliberately to stay out of the glob.

### 9. Prior decisions that constrain this slice

**S-06 deferred the surface, not the mechanism.**
`context/archive/2026-08-20-anomaly-detection-engine/plan.md:101-103`:
*"**No settings-page UI** to edit thresholds/severity — S-14. S-06 reads
`DEFAULT_THRESHOLDS` and honors any `anomaly_settings` override rows if present,
but does not create the editing surface."* Also `plan-brief.md:51`, and the
fallback-merge decision at `plan.md:66-68` / `plan-brief.md:37`.

**S-10 built the shell for this slice by name.**
`context/archive/2026-08-21-dashboard-sprint-detail/plan.md:648-653`: the tabbed
shell was chosen over a standalone route *"because S-14 (anomaly thresholds) is
already on the roadmap … building the shell now makes S-14 a second tab instead
of a second route plus a migration"*, and `:660-667`: *"with one tab today it
must still read as a shell S-14 can extend."*

**S-07's F2 constrains what any settings surface may return.**
`context/archive/2026-08-21-dashboard-today/reviews/impl-review.md:37-45` —
raw `lastError` was removed from the client payload entirely because
`classifyError`'s catch-all is an uncontrolled `err.message`, against the
guardrail "tokens never in client-facing payloads". Restated in
`roadmap.md:323` and S-10 `change.md:35-37`. **Rule for S-14: no raw error
strings in any client-facing payload — classify into a typed status/message**,
which is exactly what `ActionFailure` already does.

**S-10's F9 makes the owner predicate non-negotiable.**
`impl-review.md:156`: an update scoped on the primary key alone was flagged even
though it was safe, because *"the project's rule is that every table carries its
own `ownerId` predicate and never inherits scoping."* F8 (`:42-50`) is the
delete-then-insert cascade disaster, fixed by upserting on the existing unique
constraint.

**Decision D1 (S-08) contradicts the roadmap wording — the plan must resolve it.**
`context/archive/2026-08-25-absence-calendar/research.md:557-570`:

> *"Saving an absence must refresh the anomalies, and the owner generalised the
> rule: **any save of a factor that feeds anomaly detection triggers a
> re-detect**, not just absences. Surfaces in scope: absences (S-08), roster
> edits (S-15, already shipped), **thresholds and severity overrides (S-14, not
> built)**, cadence override (S-04), status mapping (S-03).*
> *Shape: best-effort, following the precedent `syncNow` already sets — 
> `detectAnomalies` runs in a `try/catch` after the write commits, and a failed
> re-detect **must not fail the save**. Note the cost: `loadSprintSnapshot`
> issues five selects, so this is not a free call inside a Server Action."*

The roadmap outcome (`roadmap.md:380`) still says *"changes take effect on the
next detection cycle"*. The implementation already exists to copy —
`settings/absences/actions.ts:222-232`:

```ts
async function redetect(db, ownerId, now) {
  try { await detectAnomalies({ db, ownerId, now }); }
  catch (err) { console.error("[settings/absences] re-detect after save failed:", err); }
}
```

Note it uses the **workspace clock** `now` from `resolveWorkspace()`, never
`new Date()` — critical in demo. Note also the counter-precedent:
`recap/actions.ts:17-20` deliberately does *not* re-detect, because "the send
TIME affects nothing already computed". Thresholds land on the absences side of
that line.

**The demo fixture is tuned against the defaults.**
`context/archive/2026-08-28-demo-mode/plan.md:269` and its `MANUAL-CHECKLIST.md`
row A: *"Jeśli fixture przestanie przekraczać domyślne progi (`src/db/defaults.ts`),
inbox będzie pusty przy wciąż zielonych testach jednostkowych."* If S-14 changes
any default **value** (as opposed to adding a schema over the existing ones),
demo mode breaks silently. The safe move is to leave `DEFAULT_THRESHOLDS`
numerically untouched.

**Nav ambiguity already filed as S-19** — `roadmap.md:610-613`: Settings now
mixes "how SprintFlow reaches your data" with "who your team is", and S-14 adds
a third kind. Out of scope here; recorded so the plan does not re-litigate it.

### 10. Manual-test and task-tracking context

`context/foundation/manual-test-backlog.md` (621 lines, Polish) has **no
existing row about thresholds, severity tuning or an anomaly-settings page** —
S-14 adds a new section. The nearest templates:

- `:575-580` (6.11–6.13) — the `/settings/recap` rows: *"osiągalne z zakładek i
  pokazuje bieżące wartości"*, *"Zmiana godziny zapisuje się, toastuje i
  przeżywa reload"*. This is the exact shape for a tab's smoke rows.
- `:418-428` (8.5) — the closest analogue by *meaning*: *"Absencja gasi
  `DEVELOPER_INACTIVE` bez czekania na sync … wiersz zniknął **od razu**, bez
  czekania na cykl cron (15 min) i bez «Sync now». **Dlaczego:** to decyzja D1."*
  S-14's equivalent row is the D1 proof for thresholds.
- `:361-369` (7.5) — the 1024 px tablet-width NFR row, which S-14's form
  inherits (it is a PRD NFR, so formally in MVP scope).

Still-open S-07 rows that a threshold change could disturb: 1.5, 2.5, 3.5, 3.6,
4.7, 5.2, 5.3, 5.4, 5.5 (`:172`), with 5.2 flagged 🔴 as *"najważniejsza pozycja
w całym tym pliku"* (`:174-181`).

`MANUAL-CHECKLIST.md` spec is `CLAUDE.md:87-113` — 3–5 rows, each carrying
Where / What to do / What must be true / Why it matters, signed off with the
phase number. Best template to copy by size and shape:
`context/archive/2026-08-28-demo-mode/MANUAL-CHECKLIST.md` (4 rows, Polish,
`## A.`–`## D.` with bolded **Gdzie / Co zrobić / Co musi być prawdą / Dlaczego
to łapie**).

**GitHub issue: `#24`, OPEN** — `[S-14] anomaly-settings-page — Anomaly
threshold + severity settings page`, labels `roadmap, slice, status:proposed,
stream:B`. Parent tracker `#25`. PR convention: `closes #24`. Nearest peers for
body format: `#47` (S-15), `#48` (S-16), both closed.

## Code References

- `src/db/schema.ts:42-51` — `anomaly_type` pgEnum, the 8 values
- `src/db/schema.ts:54` — `severity` pgEnum; declaration order is the sort order
- `src/db/schema.ts:881-922` — `anomaly` table; `:897` `severity` NOT NULL
- `src/db/schema.ts:924-947` — `anomaly_settings`; `:936-939` `$onUpdate`
- `src/db/migrations/0001_lying_human_cannonball.sql:44-54,274` — DDL, applied
- `src/db/defaults.ts:25` — "open shape; owning slice refines"
- `src/db/defaults.ts:28-41` — `IN_PROGRESS_HOURS_BY_SP` + the sentinel
- `src/db/defaults.ts:43-86` — `DEFAULT_THRESHOLDS`, all 8 bodies
- `src/lib/anomaly/thresholds.ts:24-52` — the resolver; `:44` severity, `:45-48` shallow spread
- `src/lib/anomaly/detect.ts:51` — resolver call; `:75-85` mutable set; `:82` riskScore; `:102-118` upsert/update; `:121-129` resolve
- `src/lib/anomaly/risk-score.ts:14-20` — `WEIGHT × magnitude × 100/3`
- `src/lib/anomaly/rules/helpers.ts:14-18` — the `Detector` signature
- `src/lib/anomaly/rules/ticket-status-aging.ts:22-35` — `inProgressBudget`, empty-map ⇒ `null`
- `src/lib/anomaly/rules/ticket-status-aging.ts:63,74` — sentinel branch, hard-coded `8`
- `src/lib/anomaly/rules/sprint-at-risk.ts:50-51,95,167-168` — the only per-field guards in the engine
- `src/lib/anomaly/context.ts:190,207,212,224,230` — thresholds snapshotted into `anomaly.context`
- `src/lib/anomaly/reader.ts:64` — `asc(anomaly.severity)`
- `src/components/organisms/anomaly/inbox-controls.ts:26-43,74-88` — sort/filter; no severity filter
- `src/lib/anomaly/test-support.ts:22` — the fixture that is just `DEFAULT_THRESHOLDS`
- `src/app/(app)/settings/layout.tsx:15-16,19-29` — inherited gating; TABS; `:28` the reserved slot
- `src/app/(app)/settings/page.tsx:8-10` — redirect to `/settings/connections`
- `src/components/molecules/settings-tabs.tsx:26` — prefix-match active state
- `src/components/molecules/main-nav.tsx:13` — the nav entry (already present)
- `src/app/(app)/settings/team/page.tsx:26-30` — the canonical page preamble
- `src/app/(app)/settings/recap/actions.ts:23-27,31-62` — the action template
- `src/app/(app)/settings/absences/actions.ts:61-65,222-232,243-261` — ActionFailure, `redetect`, error mapping
- `src/app/(app)/settings/connections/actions.ts:238-245` — "generic on purpose" error text
- `src/components/organisms/settings/recap-settings-form.tsx:24-31,53-79` — the `.tsx`/`.ts` split, toast + `router.refresh()`
- `src/components/organisms/settings/recap-settings-view.ts:61-74` — a load-bearing hint, and why
- `src/lib/workspace.ts:86,132` — `resolveWorkspace` vs `requireRealWorkspace`
- `src/lib/db.ts` — `getDb` / `getDbWithPool`; the leak is still open
- `src/lib/measurement/overrides.ts:156-178` — the upsert to copy
- `src/lib/recap-settings.ts:76-98` — the no-row-means-defaults precedent
- `src/lib/team-day-off-store.integration.test.ts` — the integration-test template
- `src/lib/demo/fixture.ts:42-44` — demo owner deliberately has no settings rows

## Architecture Insights

- **"No row means defaults" is the project's settled model for this table**, set
  at F-02 and re-affirmed by S-06. It makes the write lazy, makes reset a
  DELETE, and means a fresh account is the *un*tested path — which is precisely
  what `lessons.md:47-52` says must be tested through the real resolver.
- **The type system stops at the jsonb boundary and nothing picks it up on the
  other side.** Eight `as` casts, one open `Record<string, unknown>`, no runtime
  guard. The value of S-14's zod schema is not form ergonomics; it is that it is
  the *only* place the shape is ever checked.
- **Shallow merge plus nested bodies is a data-loss shape.** It is the same
  class as `lessons.md:33-38` (delete-then-insert) — an operation that looks
  like a partial edit but is a whole-object replacement. The mitigation is the
  same too: submit the complete set, never a fragment.
- **Settings actions are deliberately thin.** `resolveWorkspace` → validate →
  `getDb` → delegate → typed union. Business logic lives in a
  request-context-free store taking `{ db, ownerId, … }`, which is what makes
  the integration tests possible at all.
- **Isolation is app-enforced, defence-in-depth, and asserted per store.** No
  RLS; owner in the conflict target, owner in every predicate even when
  redundant, foreign ids throw rather than insert.
- **Severity has a ceiling and a latency.** It cannot go above HIGH, and a
  change is invisible until re-detection — permanently invisible on RESOLVED
  rows. Both facts need to reach the user as copy, for which
  `recap-settings-view.ts:61-74` is the house model of a hint that is
  "LOAD-BEARING, not decoration".

## Historical Context (from prior changes)

- `context/archive/2026-05-31-data-schema-baseline/plan.md:34` — no seeding of `anomaly_settings`; defaults as a typed constant
- `context/archive/2026-05-31-data-schema-baseline/research.md:107` — the table's original one-line spec, naming S-06 + S-14
- `context/archive/2026-08-20-anomaly-detection-engine/plan.md:66-68,101-103,186-197,392-397` — fallback-merge, the S-14 deferral, the resolver contract, severity stamping
- `context/archive/2026-08-20-anomaly-detection-engine/plan-brief.md:37,51` — "S-14 writes rows lazily on override"; out-of-scope list
- `context/archive/2026-08-21-dashboard-today/plan.md:41` — re-tiering explicitly deferred to a separate settings surface
- `context/archive/2026-08-21-dashboard-today/reviews/impl-review.md:37-45` — F2, raw error text off the client
- `context/archive/2026-08-21-dashboard-sprint-detail/plan.md:648-673` — the settings shell built for S-14
- `context/archive/2026-08-21-dashboard-sprint-detail/reviews/impl-review.md:42-50,156,172-173` — F8 upsert-not-delete, F9 owner predicate, action authz
- `context/archive/2026-08-25-absence-calendar/research.md:55-59,210-212,557-570` — severity ceiling, the shallow-merge caveat, **decision D1**
- `context/archive/2026-08-28-demo-mode/plan.md:269` + `MANUAL-CHECKLIST.md` — the fixture is tuned against the defaults
- `context/foundation/roadmap.md:378-390` — the S-14 entry; `:323` the S-10 scope extension; `:610-613` the S-19 nav ambiguity
- `context/foundation/prd.md:127` (FR-009, incl. the SP buckets verbatim), `:147` (FR-014 configurability)
- `context/foundation/lessons.md:33-38,40-45,47-52` — the three rules that bind here

## Related Research

- `context/archive/2026-08-25-absence-calendar/research.md` — the richest prior read of the anomaly engine from a settings surface's point of view; source of D1 and the severity-ceiling finding
- `context/archive/2026-05-31-data-schema-baseline/research.md` — where `anomaly_settings` was specified
- `context/archive/2026-08-21-dashboard-sprint-detail/` — the `/settings` shell's own plan and review
- `context/changes/db-pool-teardown/change.md` — still open; explains why a new action uses plain `getDb`

## Open Questions

1. **D1 vs the roadmap wording — re-detect on save, or "next cycle"?** The
   owner's generalised rule names S-14 explicitly and `/settings/absences`
   already implements it; the roadmap outcome still says next cycle. Re-detect
   costs five selects inside a Server Action. **Recommendation: follow D1**
   (best-effort, post-commit, workspace clock), and correct `roadmap.md:380` in
   the same change rather than leaving the two in conflict. Needs an owner
   decision at `/10x-plan`.
2. **How far does the form expose `TICKET_STATUS_AGING`?** Seven SP buckets plus
   a sentinel that cannot carry a number. Options: edit all seven as numbers and
   render the 21-SP bucket as a "120 h ↔ 8 working days" toggle; or expose only
   `codeReviewHours`/`testingHours` and treat the SP map as read-only in v1.
   Either way the payload must submit the **whole** map.
3. **Is the tab allowed in demo mode?** `/settings/recap` refuses,
   `/settings/absences` allows (demo edits land under the demo owner and are
   undone by reset). Anomaly settings have no outbound call, so allowing is the
   defensible default — but it must be stated, not defaulted into.
4. **Does `is_default` get dropped?** It is written nowhere and read nowhere.
   Removing it is a one-line migration; leaving it is a permanent trap for the
   next reader. Cheap either way, but it should be a decision.
5. **Does the 21-SP sentinel need to become data?** Making "8 working days"
   tunable means replacing the string literal with something like
   `{ workingDays: 8 }` — a change to `defaults.ts`, `ticket-status-aging.ts:63-74`
   and the demo fixture's assumptions. Probably out of scope for S-14, but the
   plan should say so rather than discover it mid-implementation.
6. **Should the settings page show which rules currently have overrides?** The
   no-row model means "modified" is knowable cheaply, and without it the lead
   cannot tell a tuned rule from a default one. Not in the roadmap outcome;
   worth a paragraph.
