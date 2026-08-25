---
date: 2026-08-25T21:19:32+02:00
researcher: Adam Reszka
git_commit: 4697775871c6af5f2d498f335fd1c066d459aaa6
branch: feat/s08-absence-calendar
repository: 10xdevs-certification-project
topic: "S-08 absence calendar (FR-010) — recording absences and wiring them into DEVELOPER_INACTIVE suppression, SPRINT_AT_RISK weighting, and sprint capacity"
tags: [research, codebase, absence, FR-010, S-08, anomaly-detection, capacity, roster]
status: complete
last_updated: 2026-08-25
last_updated_note: "Added owner decisions D1 (re-detect on save) and D2 (is_planned is temporal)"
last_updated_by: Adam Reszka
---

# Research: S-08 Absence calendar (FR-010)

**Date**: 2026-08-25T21:19:32+02:00
**Researcher**: Adam Reszka
**Git Commit**: `4697775871c6af5f2d498f335fd1c066d459aaa6`
**Branch**: `feat/s08-absence-calendar` (not pushed — references below are local paths, not GitHub permalinks)
**Repository**: 10xdevs-certification-project

## Research Question

Record per-sprint team-member absences (vacation, sickness, training) on a simple
calendar, and wire recorded absences into three downstream calculations:

1. suppress `DEVELOPER_INACTIVE` for the absent developer during the window,
2. raise the `SPRINT_AT_RISK` score for an unplanned mid-sprint absence,
3. feed sprint-capacity calculation.

Investigated: the existing `absence` table; the S-06 detection engine and its hook
points; whether any capacity calculation exists; the S-15 roster surface patterns;
installed shadcn primitives; existing unit/integration test patterns.

## Summary

**The slice is not three equal thirds.** Two of the three FR-010 effects have seams
that S-06 cut deliberately; the third has no seam because the thing it plugs into
does not exist.

| FR-010 effect | State today | Shape of the work |
|---|---|---|
| `DEVELOPER_INACTIVE` suppression | Seam pre-cut. `SprintSnapshot.absences` is typed and always `[]`; the rule's docstring reserves the slot | Wiring: one producer line + one guard + a helper |
| `SPRINT_AT_RISK` weighting | **No absence handling at all** in the rule, and — critically — **no headroom** to "raise" anything (see below) | Design decision, then a new detection condition |
| Sprint capacity | **Does not exist anywhere.** `sp_capacity` is written by the roster editor and read by nothing | Build from scratch |

Four findings that should shape the plan more than anything else:

1. **`src/lib/anomaly/load-snapshot.ts:78` is literally `absences: []`.** That one line
   is the entire load-side change. Verified directly. Everything downstream is typed
   for real data already (`src/lib/anomaly/types.ts:45`).

2. **"Raise the SPRINT_AT_RISK score" cannot be done by raising anything.** The rule's
   default severity is already `HIGH` (`src/db/defaults.ts:64-65`, verified) — there is
   no tier above it. And the per-anomaly risk score is `WEIGHT[severity] × magnitude ×
   (100/3)` (`src/lib/anomaly/risk-score.ts:14-20`), where the `todo_near_end` condition
   already reaches `magnitude: 1` whenever `committedSp` is 0 or scope is all-ToDo. So
   bumping severity is impossible and bumping magnitude is often a no-op. The only way an
   unplanned mid-sprint absence reliably raises the risk the lead *sees* is to **emit an
   additional `SPRINT_AT_RISK` anomaly** with its own `dedupKey`, not to reweight an
   existing one. This reframes the FR wording — worth stating explicitly in the plan.

3. **The only working-day counter in the codebase is timezone-wrong**, and an absence is
   the second consumer that would need it. `countWorkingDays`
   (`src/lib/anomaly/rules/helpers.ts:60-79`, verified) uses `cursor.setHours(0,0,0,0)`
   and `cursor.getDay()` — **server-local time, no zone parameter**. Every dashboard day
   axis instead goes through the zone-aware `day-bucket.ts` family keyed on
   `jira_project.time_zone`. On Workers the server zone is UTC so the two happen to agree
   *today*, but a Warsaw absence booked "Monday to Friday" will silently mis-count.
   S-08 either inherits the bug or diverges from the only existing counter.

4. **S-08 is the first producer of `absence` rows in production** — which means it is also
   the first slice that makes the S-15 delete gate fire for real. The moment an owner
   records one absence, the "Delete permanently" button disappears for that member
   (`src/lib/integrations/roster-store.ts:557-575`). That is correct behaviour, but it is
   a user-visible change caused by this slice, and it belongs on the manual checklist.

The `absence` table needs **no migration** — it shipped in F-02 and is marked `STABLE`
(`context/changes/data-schema-baseline/research.md:108`). Two of its columns nonetheless
carry unpinned semantics (`is_planned` tri-state, `timestamp` vs whole-day) — see
[Open Questions](#open-questions).

## Detailed Findings

### 1. The `absence` table — exists, stable, unused

`src/db/schema.ts:439-465`:

| column | type | note |
|---|---|---|
| `id` | text PK | |
| `owner_id` | text → `user.id` **CASCADE** | cross-account scope key |
| `team_member_id` | text → `team_member.id` **CASCADE** | the FK that shaped S-15 |
| `sprint_id` | text → `sprint.id` CASCADE | **nullable** — do not scope a sprint query on this alone |
| `type` | `absence_type` enum | `VACATION \| SICKNESS \| TRAINING` (`schema.ts:54-59`) |
| `start_date` | `timestamp` NOT NULL | not `date` — whole-day semantics unpinned |
| `end_date` | `timestamp` NOT NULL | inclusive or exclusive? unpinned |
| `is_planned` | `boolean` **nullable, no default** | verified `schema.ts:455` — tri-state |
| `created_at` | timestamp | no `updated_at` |

Only index: `absence_member_window_idx` on `(team_member_id, start_date, end_date)`
(`schema.ts:459-464`). **There is no `(owner_id, …)` index** — an owner-wide absence
query for the snapshot loader will not be index-supported on `owner_id`; the supported
shape is member-keyed.

Types `SelectAbsence` / `InsertAbsence` at `schema.ts:908-909`; relations at `:877-885`.

**Nothing in `src/` writes to this table.** Current readers: the always-empty snapshot
slot, and the roster delete gate's `count()`.

### 2. Anomaly engine — shape and hook points

**Rules are pure functions.** `Detector = (snapshot, effective, now) => DetectedAnomaly[]`
(`src/lib/anomaly/rules/helpers.ts:13-17`). No rule imports `db`. Registered as a flat
array `ALL_DETECTORS` (`src/lib/anomaly/rules/index.ts:16-25`), run in one `flatMap`
(`src/lib/anomaly/detect.ts:54-56`).

**The context object** is `SprintSnapshot` (`src/lib/anomaly/types.ts:39-46`), six fields:
`sprint`, `tickets`, `pullRequests`, `commits`, `teamMembers`, **`absences`**. Assembled by
`loadSprintSnapshot(db, ownerId, now)` (`src/lib/anomaly/load-snapshot.ts:29-79`) with five
parallel selects — and `absences: []` hardcoded at `:78`.

Callers of `detectAnomalies`: the cron cycle (`src/lib/integrations/sync/scheduled.ts:84`)
and on-demand `syncNow` (`src/lib/integrations/sync/actions.ts:77`).

#### 2a. `DEVELOPER_INACTIVE` — where suppression goes

`src/lib/anomaly/rules/developer-inactive.ts:15-61`. Threshold `noCommitDays` default `2`
(`src/db/defaults.ts:56-59`), severity `MEDIUM`. The rule is a chain of `continue` guards:
skip inactive members (`:22`), skip members missing either identity key (`:23`), skip
members with no `IN_PROGRESS` ticket (`:25-30`), skip members who committed inside
`[now − noCommitDays, now]` (`:32-38`), else emit (`:40-58`) with
`dedupKey: DEVELOPER_INACTIVE:member:${member.id}` and `magnitude: 1`.

**Insertion point: between `:30` and `:32`** — after the `hasActiveWork` guard, before the
commit scan. Matches the file's existing guard-chain style and keeps the cheap ticket
filter first.

**Suppress inside the rule, not by pre-filtering the roster.** `snapshot.teamMembers` is
shared by five other detectors, which `indexBy` it to attach `relatedTeamMemberId`;
dropping an absent member from that array would silently strip attribution from unrelated
anomalies. A post-detection filter in `detect.ts` would also work against the DB but would
put the rule's own condition outside the rule, where its 4-test unit suite cannot reach it.
The rule's own docstring (`:11-13`) already claims this slot for S-08.

The suppression predicate is **window ∩ window**: the absence range against the rule's own
evaluation window `[now − noCommitDays, now]` — and only the rule knows that window
(computed at `:17-18` from its own threshold). The helper belongs in `rules/helpers.ts`
beside `countWorkingDays`.

#### 2b. `SPRINT_AT_RISK` — no absence handling, and no headroom

`src/lib/anomaly/rules/sprint-at-risk.ts:30-110`. Emits **one anomaly per triggering
condition**, discriminated by `context.condition`. Two conditions exist:

| condition | fires when | magnitude | line |
|---|---|---|---|
| `max_parallel` | a member holds more than the per-category limit | `(count − limit) / limit`, clamped to [0,1] | `:70` |
| `todo_near_end` | `hoursLeft ≤ 48` and ≥1 ToDo ticket | `todoSp / committedSp`, clamped; **`1` when `committedSp` is 0** | `:84-85` |

There is **no aggregate score** in this rule and **no notion of capacity or working days**.
Severity is destructured once at `:31` and used verbatim for both emissions — it is never
derived from `magnitude`.

Combined with the risk-score formula (§2d) and the `HIGH` default, this is why "raise the
score" has to become "emit an additional anomaly": see Summary finding 2. A third condition
appended before `return out` at `:109` needs its own `dedupKey`, a new variant in the
`SprintAtRiskContext` union (`src/lib/anomaly/context.ts:49-64`), a chip branch
(`context.ts:194-200`), and a suggested-action template. The rule's docstring at `:28`
already reserves the slot.

"Unplanned mid-sprint" is expressible today as `is_planned === false` plus
`start_date > sprint.start_date` — but `is_planned` is nullable (§1), so the tri-state
needs a decision before this condition can be written.

#### 2c. Persistence — suppression resolves cleanly, but not instantly

`detectAnomalies` (`src/lib/anomaly/detect.ts:44-133`) is a **reconcile**, not upsert-only,
inside one transaction: it loads existing `(id, dedupKey, status)` rows for the
`(owner, sprint)`, inserts/updates detected ones, and then at `:121-129` flips every
`ACTIVE` row whose `dedupKey` is absent from this run to `RESOLVED`. The reader only
returns `ACTIVE` (`src/lib/anomaly/reader.ts:61`).

**So a suppressed `DEVELOPER_INACTIVE` disappears from the inbox on the next detection run —
no stale row.** Two consequences to carry into the plan:

- Rows are flipped, never deleted. The roster delete gate counts anomalies **without
  filtering `status`** (`roster-store.ts:557-575`), so a resolved anomaly still blocks a
  permanent delete. Pre-existing behaviour, but S-08 makes it more visible.
- Detection runs only on the cron cycle or `syncNow`. **Recording an absence does not itself
  trigger detection**, so without an explicit call the anomaly lingers up to the 15-minute
  freshness window. That is a product decision, not an implementation detail — see
  [Open Questions](#open-questions).

#### 2d. The FR-015 risk score is a different thing

`src/lib/anomaly/risk-score.ts:14-20`: `WEIGHT = {HIGH: 3, MEDIUM: 2, LOW: 1}`,
`riskScore(sev, mag) = clamp(round(WEIGHT[sev] × clamp01(mag) × 100/3), 0, 100)`. Computed
per anomaly in the orchestrator (`detect.ts:82`) for **every** type, not just
`SPRINT_AT_RISK`. It is explicitly non-driving: the reader sorts by raw severity then
recency (`reader.ts:64`). Do not conflate this 0-100 per-anomaly number with the
`SPRINT_AT_RISK` rule.

#### 2e. Thresholds and severity config

Defaults: `src/db/defaults.ts:43-86`, exhaustive over the 8 enum values. Overrides:
`anomaly_settings` table (`schema.ts:681-704`), unique `(ownerId, anomalyType)` — **no rows
seeded**, the S-14 settings page that writes them is not built. Resolution:
`resolveEffectiveThresholds` (`src/lib/anomaly/thresholds.ts:24-52`), called once per run at
`detect.ts:51`; severity = `override ?? base`, thresholds = **shallow** spread (a nested
object like `maxParallelByCategory` is replaced wholesale, not deep-merged).

Adding an absence threshold means extending `DEFAULT_THRESHOLDS.SPRINT_AT_RISK.thresholds`
(`defaults.ts:66-72`) plus the rule's local cast type — nothing else.

### 3. Capacity — does not exist

Grepped repo-wide for `capacity` / `spCapacity` / `forecast` / `velocity`. **Every hit is
storage, plumbing, or a UI label. There is no arithmetic anywhere.**

- `src/db/schema.ts:308` — `spCapacity: integer("sp_capacity")`, nullable, no default.
- `src/lib/validations/roster.ts:42` — zod `int().min(0).max(1000).nullish()`.
- `src/components/organisms/setup/roster-editor.tsx:602-606` — the number input.
- `src/lib/integrations/roster-store.ts:247,476,490` — carried through save + diff.
- `src/lib/roster.ts:66,83` — on `EditorRosterMember` only; the dashboard reader `listRoster`
  does not even select the column.
- `src/lib/integrations/roster-store.ts:583` — a comment describing intended future
  behaviour ("member stops counting toward capacity"). Not code.

**`sp_capacity` is write-only.** The third FR-010 effect has no consumer to wire into.

**Natural home:** `src/lib/dashboard/`, which already enforces a consistent split stated at
`src/lib/dashboard/aging.ts:14-18` — a pure DB-free reducer with `now` injected
(`burndown-series.ts`, `activity-grid.ts`, `time-in-status.ts`, `day-bucket.ts`) plus a thin
owner-scoped reader (`burndown.ts`, `activity.ts`, `aging.ts`).

**Cheapest plug-in point:** `getBurndownSeries` (`src/lib/dashboard/burndown.ts:23-109`)
already selects the sprint row, the project timezone, and the full roster. Extending its
roster select (`:49-54`) with `spCapacity` + `id`, adding one member-keyed `absence` query,
and returning a third per-day array from `buildBurndownSeries`
(`src/lib/dashboard/burndown-series.ts:79-205`) means the capacity line shares the day axis
**by construction** — which is exactly the precedent `byCategory` set
(`burndown-series.ts:5-8`, "costs no extra query"). Render as a third `<Line>` beside the
client-computed `idealSp` in `src/components/organisms/dashboard/sprint-pulse.tsx:45-48`,
with a new key in `chart-theme.ts`'s `PULSE_CHART_CONFIG`.

### 4. Sprint window and date/time conventions

**One canonical resolver:** `getActiveSprintRow(db, ownerId)` (`src/lib/sprint.ts:19-43`) —
prefer `state = 'ACTIVE'` ordered by `desc(startDate)`, else most-recently-started, else
`null`. Used by both dashboards and the snapshot loader. Two ad-hoc variants exist and
should **not** be copied: `src/app/(app)/setup/team/page.tsx:32-42` (no `ORDER BY`) and
`saveCadence` (`roster-store.ts:897-908`, updates *all* ACTIVE sprints unqualified).

**Which cadence columns are real:**

| column | consumed by production code? |
|---|---|
| `workingDays` | **Yes, exactly once** — `ticket-status-aging.ts:64` → `countWorkingDays` |
| `startDay` | No. Written by import/override, echoed into the setup form, never calculated with |
| `lengthDays` | No. Same |

So the sprint window is `sprint.startDate … sprint.endDate` (both nullable). **Do not derive
it from `lengthDays`/`startDay`.** `workingDays` is populated (Mon–Fri default from
`src/lib/integrations/cadence.ts:20-26`, since Jira exposes no working-days field) and is
safe to build on.

**Timezone convention: the team's IANA zone from `jira_project.time_zone`**, resolved
through `safeZone` (`src/lib/time-zone.ts:33`, never throws, falls back to UTC), read via
`getJiraTimeZone` (`src/lib/dashboard/time-zone-reader.ts:14-24`). The zone-aware helpers,
all pure and hand-rolled on `Intl` (**there is no date library — `date-fns` verified
absent**):

- `dayKeyInTimeZone(date, tz) → "YYYY-MM-DD"` — `src/lib/dashboard/day-bucket.ts:49`
- `dayRangeInTimeZone(dayKey, tz) → {from, to}` — `:66` (binary search, handles :30/:45 offsets)
- `enumerateDayKeys(start, end, tz) → DayKey[]` — `:98` (DST-safe, 400-day guard)

The rationale block at `day-bucket.ts:1-12` is explicit: "Bucketing in UTC would put a 22:30
Warsaw commit on the following day." Precedent: Yesterday's Activity resolves the zone
*first*, then derives the instant range (`src/app/(app)/dashboard/page.tsx:44-51`).

**The divergence to decide on:** `countWorkingDays`
(`src/lib/anomaly/rules/helpers.ts:60-79`, verified above) takes no zone and uses
`setHours`/`getDay` — server-local. It is the only working-day math that exists, and
absence-adjusted capacity is the natural second caller.

**What does not exist:** no window-overlap helper, no "days since" helper, no zone-aware
working-day counter. All three are new.

### 5. Roster surface patterns to copy (S-15)

**Route shell.** `/settings/*` is a tabbed shell. `export const dynamic = "force-dynamic"`
and `requireSession()` live **only** in `src/app/(app)/layout.tsx:9,22` — pages must not
re-declare either. The tab registry is `src/app/(app)/settings/layout.tsx:18-22` and already
reserves the next slot with a comment for S-14's `/settings/anomalies`. Adding a tab is a
one-line edit; active styling is prefix-matched in
`src/components/molecules/settings-tabs.tsx:26`.

**Owner resolution — copy verbatim** (`src/app/(app)/settings/team/page.tsx:25-30`):

```ts
const session = await requireSession();
const { env } = getCloudflareContext();
const db = getDb(env);
const initialMembers = await listRosterForEditor(db, session.user.id);
```

One `getDb(env)` per page, one owner-scoped read, plain data handed to a client organism.

**Server Actions.** All `team_member` mutations live in **one** module,
`src/app/(app)/setup/team/actions.ts`, which `/settings/team` imports — the convention is
stated at `:277-280`. Contract: `"use server"` at file top; input typed `unknown` and
`safeParse`d inside; result is a discriminated union on `ok` with a shared
`ActionFailure` (`:64-69`); error mapping centralised in `toFailure(err, tag)` (`:391-451`),
where **only the unexpected branch logs, and never a token**.

**After a successful mutation: `router.refresh()`.** There is **no `revalidatePath`
anywhere in `src/`** (`roster-editor.tsx:474-477`).

**`saveRoster` differential upsert** (`src/lib/integrations/roster-store.ts:388-445`) — the
pattern to copy, with its 30-line rationale at `:355-387`. One transaction, one owner-scoped
SELECT, then classify: no `id` → insert with a fresh `randomUUID()`; `id` present but not in
the owner's set → **`throw new UnknownMemberError()`** (`:423`, never "insert it anyway");
otherwise update, skipping writes when `isUnchanged`. Every write carries
`AND owner_id = ?` as documented defence in depth (`:436`). `ids` is built **positionally**
so the client can zip it back onto its submitted array (`roster-editor.tsx:465-469`) —
commit `646facf`.

Note the asymmetry: `team_member` needs the differential upsert because it has hand-entered
children. **`absence` has no children**, so an absence-set save *could* use the simpler
idiom — but the reject-foreign-id and `AND owner_id` rules still apply
(`context/foundation/lessons.md`, "Delete-then-insert is only safe for tables with no
hand-entered children").

**Hard ordering rule** (`roster-store.ts:49-52`): every credentialed network read completes
*before* any `db.transaction` opens — a `fetch` nested in a transaction pins a
Hyperdrive-backed `pg` connection for the network duration. S-08 has no outbound calls, so
this is free, but transaction bodies stay DB-writes-only.

**The delete gate S-08 arms.** `getMemberHistory` (`roster-store.ts:542-579`) counts
absences and attributed anomalies, both **owner-scoped as well as member-scoped** so a
foreign id reads as "not found". The dialog branches three ways
(`roster-editor.tsx:761-789`): clean + not last → Deactivate **and** Delete permanently;
clean + last → Deactivate only; **any history → Deactivate only**. `deleteMember`
(`:618-641`) re-runs the check inside the transaction because "the dialog's earlier check is
advisory" (`:614-616`).

**Validation.** `src/lib/validations/roster.ts` is deliberately free of server-only imports
so client and server share one source of truth. The cross-row uniqueness `superRefine`
(`:59-94`) exists because **there is no DB unique index** on the identity keys — the
rationale at `:49-58` explains that duplicates corrupt anomaly attribution silently rather
than erroring. **For S-08: any cross-row absence constraint (e.g. overlapping windows for
one member) belongs in the same place — a `superRefine` on the save schema, not a DB index.**

**Grid UI.** `roster-editor.tsx` (812 lines) is mounted by *both* `/setup/team` and
`/settings/team`. `react-hook-form` + `zodResolver` + `useFieldArray`; `useWatch` rather than
`form.watch` "so React Compiler can memoize the row" (`:179`); rows keyed by RHF's stable
`field.id`, never array index; every cell has an `aria-label` (`:575-602`) — which is what
makes the project's `getByLabel` Playwright rule workable. Dialogs render **outside** the
`<Table>` (`:758-760`) so a row unmounting cannot take its own dialog down mid-transition.

### 6. UI primitives — three are missing

`src/components/ui/` holds 16 primitives (verified): `alert-dialog`, `alert`, `badge`,
`button`, `card`, `chart`, `checkbox`, `form`, `input`, `label`, `scroll-area`, `select`,
`sonner`, `table`, `tabs`, `tooltip`.

**Absent and needed:**

- `calendar` — not installed
- `popover` — not installed (shadcn's date-picker is a *recipe*: popover + calendar + button)
- `dialog` — not installed. Only `alert-dialog` exists, which is for destructive confirms
  and has no close button or scrollable body — wrong shell for a "record absence" form.

**Dependencies (verified against `package.json`):** `date-fns` **ABSENT**,
`react-day-picker` **ABSENT**, `radix-ui` `^1.4.3` present as the umbrella package. Every
existing primitive imports from `radix-ui`, not `@radix-ui/react-*` — so the Radix side of
popover/dialog costs nothing new. **`react-day-picker` is the one genuinely new runtime
dependency**, pulled in by `npx shadcn add calendar`.

`components.json`: new-york, zinc, `rsc: true`, cssVariables, lucide icons, no extra
registries. Per memory and `tech-stack.md`: **never re-run `shadcn init`**, only
`npx shadcn add <name>`.

`tech-stack.md` binds two things here: all UI must be shadcn primitives (**no hand-rolled
month grid, no `react-calendar`/FullCalendar/MUI, and a bare `<input type="date">` counts as
"a raw HTML component for a surface shadcn covers"** — there are zero `type="date"` inputs in
`src/` today), and **the `@shadcn` MCP server must be queried before implementing any new UI
surface**. The registry carries several calendar variants (range, multi-month, with-presets);
FR-010 records a *window*, so the range variant deserves a deliberate look.

Reusable as-is: `confirm-dialog.tsx` (the destructive-confirm shell that names what it
destroys), `settings-tabs.tsx`, `table`/`badge`/`select`/`form`/`sonner`, and `day-bucket.ts`
for timezone-correct day keys.

### 7. Test infrastructure and what it forbids

**Two Vitest projects, both `environment: "node"`, separated by filename only:**

- `vitest.config.ts` — `src/**/*.test.ts`, excludes `*.integration.test.ts`. Hermetic,
  DB-free. `npm test`.
- `vitest.integration.config.ts` — `src/**/*.integration.test.ts`,
  `setupFiles: ["./test/integration/setup.ts"]`, **`fileParallelism: false`**.
  `npm run test:integration`. **Requires local Postgres** — `test/integration/setup.ts:33-46`
  hard-refuses any `DATABASE_URL` that is not `127.0.0.1|localhost:54322` and requires
  `TOKEN_ENCRYPTION_KEY`.

**There are no component tests.** `@testing-library/*` and `jsdom` are not installed; there
are zero `.test.tsx` files repo-wide. This is policy, not an accident:
`context/foundation/test-plan.md:126-128` excludes shadcn primitives and "mid-layer
presentational organisms". The house workaround is to **extract pure logic out of the `.tsx`
into a sibling `.ts`** — live examples: `inbox-controls.ts`, `activity-matrix-view.ts`,
`aging-report-controls.ts`, `repo-selection.ts`, `roster-merge.ts`, each with a `.test.ts`.

**Consequence for S-08:** the calendar's rendering and interaction cannot be unit-tested
without adopting jsdom + RTL, which the test plan does not currently sanction. The realistic
split is pure date/overlap/suppression logic → unit; absence CRUD + owner scoping →
integration; calendar interaction → Playwright or the manual checklist.

**Playwright is installed and configured** (`@playwright/test@^1.61.1`,
`playwright.config.ts`, specs in `e2e/*.spec.ts`, two fixture servers on `:3099`/`:3098`).
Gotcha at `playwright.config.ts:66-69`: with `reuseExistingServer` a manually-running
`npm run dev` is reused without the fixture env.

**Fixtures.** `src/lib/anomaly/test-support.ts` is the unit fixture factory, deliberately
outside `rules/` so Stryker does not mutate it. `NOW = 2026-08-10T12:00:00Z` (`:24`),
`effective = DEFAULT_THRESHOLDS` (`:21`), builders `makeSprint/makeMember/makeTicket/...`
— and `makeSnapshot` hardcodes `absences: []` at `:156`. **S-08 adds `makeAbsence` here.**

**Integration teardown pattern** (each file defines its own, by copy):
module-scope `new Pool({max: 1})` + `drizzle`, `afterAll(() => pool.end())`, a module-level
`owners: string[]`, and `afterEach` deleting each `user` row — everything else disappears via
`ON DELETE CASCADE`. `absence.owner_id` cascades from `user`, so **S-08 needs nothing extra**.
`roster-store.integration.test.ts:860-872` already has an **`addAbsence` helper** that is
directly reusable, and the file already imports `absence` from `@/db/schema`.

**Mutation testing covers the rules:** `stryker.conf.json` mutates
`src/lib/anomaly/rules/**/*.ts`, `risk-score.ts`, `suggested-action.ts`, break threshold 70.
A new suppression branch that no test kills lowers the score.

**Coverage convention to mirror:** every lifecycle operation in
`roster-store.integration.test.ts` has a **cross-owner sibling test** (stated as policy at
`:825-826`). `test-plan.md:58-59` names IDOR as Risk #4 with the anti-pattern "testing only
the resource owner's happy path".

**The oracle rule** (`test-plan.md:65`): expected anomaly output must be hand-derived from
the FR spec, never lifted from the engine's own output. Directly binding on "absence
suppresses `DEVELOPER_INACTIVE`". `test-plan.md:102` prescribes the per-rule shape: a
positive fixture that must fire, a healthy fixture that must stay silent, and boundary cases
— here, the absence-window edges (first day, last day, adjacent-but-not-overlapping).

### 8. Demo seed

`scripts/seed-dashboard.mjs`, run by `npm run db:seed:demo`. **Destructive — deletes the
target owner's credential tables.**

- **Seeds zero `absence` rows.** `absence` does not appear in the file, and is not in the
  idempotent cleanup list (`:133-152`) — but `team_member` is (`:146`), so a re-seed wipes
  absences transitively via CASCADE. If S-08 seeds absences it should insert **after** the
  roster loop (`:186-207`) and add `"absence"` explicitly to the cleanup list, matching the
  file's stated "children before parents, explicit over cascade" convention (`:130-132`).
- Sprint cadence **is** seeded (`:176-184`): 14-day ACTIVE sprint, day −8 → +6, Mon–Fri,
  `committed_sp = 40`, `completed_sp = 18`, `cadence_overridden = false`.
- `sp_capacity` **is** seeded — flat `10` for all five members (`:186-207`), i.e. 50 team SP
  against 40 committed.
- Timezone is deliberately non-UTC: `jira_project.time_zone = "Europe/Warsaw"` (`:172-174`),
  so day bucketing is exercised.
- The seeded `DEVELOPER_INACTIVE` anomaly for Erik Lund (`:239-242`) is a **hand-written
  static row**, not regenerated by the engine — an absence overlapping it will not suppress
  it unless detection is re-run.

## Code References

- `src/lib/anomaly/load-snapshot.ts:78` — `absences: []`, the single producer line to implement
- `src/lib/anomaly/types.ts:39-46` — `SprintSnapshot`, already typed for real absences
- `src/lib/anomaly/rules/developer-inactive.ts:15-61` — suppression guard goes between `:30` and `:32`
- `src/lib/anomaly/rules/sprint-at-risk.ts:30-110` — no absence handling; new condition before `return out` at `:109`
- `src/lib/anomaly/rules/helpers.ts:60-79` — `countWorkingDays`, **server-local, not zone-aware**
- `src/lib/anomaly/detect.ts:44-133` — reconcile loop; `:121-129` is what resolves a suppressed anomaly
- `src/lib/anomaly/risk-score.ts:14-20` — `WEIGHT[sev] × magnitude × 100/3`
- `src/db/defaults.ts:64-73` — `SPRINT_AT_RISK` default severity `HIGH`, its thresholds
- `src/db/schema.ts:439-465` — the `absence` table; `:455` nullable `is_planned`; `:459-464` the only index
- `src/lib/sprint.ts:19-43` — `getActiveSprintRow`, the one canonical sprint resolver
- `src/lib/dashboard/day-bucket.ts:49,66,98` — the zone-aware day helpers
- `src/lib/dashboard/burndown.ts:23-109` + `burndown-series.ts:79-205` — where a capacity line plugs in
- `src/lib/integrations/roster-store.ts:388-445` — `saveRoster` differential upsert
- `src/lib/integrations/roster-store.ts:542-579` — `getMemberHistory`, the delete gate S-08 arms
- `src/app/(app)/setup/team/actions.ts:181-207` — the Server Action template
- `src/app/(app)/settings/layout.tsx:18-22` — the tab registry
- `src/lib/anomaly/test-support.ts:156` — `makeSnapshot` hardcodes `absences: []`; add `makeAbsence` here
- `src/lib/integrations/roster-store.integration.test.ts:860-872` — reusable `addAbsence` helper

## Architecture Insights

- **Detectors are pure and take a snapshot; the snapshot is the only seam.** Adding data to
  the engine means adding it to `loadSprintSnapshot` and reading it in a rule — never
  querying inside a rule.
- **One module owns every mutation of a table.** All `team_member` writes live in
  `setup/team/actions.ts` regardless of which surface calls them. S-08 should give `absence`
  the same treatment rather than scattering actions per route.
- **Owner scoping is defence in depth, twice.** Reject ids outside the caller's set *and*
  carry `AND owner_id = ?` on the write, even when the first check makes the second
  redundant.
- **Pure logic is extracted from `.tsx` so it can be tested** — the project has chosen this
  over installing a component-test harness.
- **Anything with a day axis goes through the team's timezone.** UTC bucketing is treated as
  a bug, documented at `day-bucket.ts:1-12`.
- **Reconcile-not-upsert** means "stop emitting X" is a complete removal story, provided
  detection re-runs.

## Historical Context (from prior changes)

- `context/archive/2026-08-20-anomaly-detection-engine/plan-brief.md:83-84` — "Absence =
  empty this slice"; "Detectors take an `absences: []` input now so S-08 wires suppression
  **without reshaping them**." The seam was cut on purpose.
- `context/archive/2026-08-20-anomaly-detection-engine/plan.md:97-99` — records the gap:
  `DEVELOPER_INACTIVE` fires without suppression, `SPRINT_AT_RISK` carries no absence factor.
- `context/foundation/roadmap.md:212` — same gap at roadmap level, "graceful default; S-08
  adds the suppression logic on top", Block: no.
- `context/foundation/lessons.md` (delete-then-insert entry) — `absence.team_member_id`
  CASCADE + `anomaly.related_team_member_id` SET NULL, neither `DEFERRABLE`; a no-op
  `saveRoster` took absences 1 → 0 against local Postgres. **This is why S-08 must not
  regress `saveRoster` and must not touch the FK.**
- `context/changes/team-management-surface/plan.md:78` — "CASCADE on absences is the **right
  rule** for a *real* deletion — the bug is that a save was performing one."
- `context/changes/team-management-surface/research.md:235-238` — "Absences (FR-010) are
  wiped by any roster save… not live today only because S-08 has not shipped, so this gets
  more dangerous with time." S-08 is what makes it live.
- `context/changes/team-management-surface/plan.md:99` and `plan-brief.md:68` — absence
  calendar explicitly out of scope for S-15.
- `context/changes/data-schema-baseline/research.md:108` — `absence` marked **STABLE**:
  no migration expected in S-08.
- `context/foundation/task-tracking.md:217` — S-08 is GitHub issue **#18**, priority B.
- `context/foundation/manual-test-backlog.md` — **zero absence rows**; nothing deferred here
  to pick up.
- No prior slice contradicts S-08 — earlier slices only ever pushed absences forward to it
  (`archive/2026-08-20-setup-team-roster-cadence/plan.md:45`,
  `archive/2026-08-20-data-sync-engine/plan.md:100`).

## Related Research

- `context/changes/team-management-surface/research.md` — the roster surface, the CASCADE
  blast radius, and the differential-upsert rationale
- `context/changes/data-schema-baseline/research.md` — the F-02 table map, including the
  `absence` row
- `context/archive/2026-08-20-anomaly-detection-engine/plan.md` — the engine's own plan and
  its recorded S-08 hand-off points
- `context/foundation/test-plan.md` — the oracle rule (`:65`), the per-rule test shape
  (`:102`), and the component-testing exclusion (`:126-128`). Note the file is stale
  (last updated 2026-06-16; §4 still claims no test runner exists).

## Decisions taken (owner, 2026-08-25)

Recorded here so they reach `plan.md` intact. These close Open Questions 1 and 2.

### D1. Every save of an anomaly-affecting factor re-runs detection

Saving an absence must refresh the anomalies, and the owner generalised the rule: **any
save of a factor that feeds anomaly detection triggers a re-detect**, not just absences.
Surfaces in scope: absences (S-08), roster edits (S-15, already shipped), thresholds and
severity overrides (S-14, not built), cadence override (S-04), status mapping (S-03).

Shape: best-effort, following the precedent `syncNow` already sets
(`src/lib/integrations/sync/actions.ts:77`) — `detectAnomalies` runs in a `try/catch` after
the write commits, and a failed re-detect **must not fail the save**. Note the cost:
`loadSprintSnapshot` issues five selects, so this is not a free call inside a Server Action.

### D2. `is_planned` means "was the sprint already running?" — it is temporal, not a property of the absence type

The owner's definition:

> **Planned** — known before the sprint started. The team committed *knowing* the person
> would be away, so the commitment already prices it in. Consequence: lower capacity, and
> the sprint was planned smaller. Nothing else.
>
> **Unplanned** — arises while the sprint is already running ("I need tomorrow off"). The
> commitment was computed assuming that person would be working. Consequence: lower
> capacity **and** a real increase in the risk of missing the sprint — they now have fewer
> days for the tickets already assigned to them.

Three consequences for implementation:

1. **The default is derived from timing, not from `type`.** An earlier suggestion in this
   document (default `is_planned` from the absence type — `SICKNESS` → unplanned) is
   **withdrawn**: type is at best a weak proxy, and a known surgery booked before sprint
   start is planned. The signal is whether the absence was recorded before the sprint
   started (`absence.created_at` vs `sprint.start_date`), mirroring how
   `added_after_sprint_start` is derived (`src/lib/integrations/sync/run-sync.ts:670-671`).
2. **The user-facing flag survives only as an override** for the data-entry-lag case: an
   owner who onboards mid-sprint and enters a long-known holiday would otherwise have every
   absence read as unplanned, flooding the inbox on first run — i.e. during the PRD's first
   success criterion.
3. **Planned and unplanned take different paths.** Planned → capacity only. Unplanned →
   capacity **and** a `SPRINT_AT_RISK` emission. So the rule is a branch, not a single
   "absence reduces capacity" term.

**Magnitude for the unplanned case is measurable rather than a flat weight:** working days
lost between now and sprint end, against what that member still has assigned. This also
resolves the headroom problem in Summary finding 2 — a new anomaly with its own scale,
rather than reweighting an emission that is already `HIGH` at `magnitude: 1`.

Still open under D2: whether to close the column with a `NOT NULL DEFAULT` migration while
the table holds **zero rows** (verified 2026-08-25, local DB and never written by `src/`),
or to normalise at the edge and leave the Drizzle type as `boolean | null`. Consumption is
strict either way — `=== false`, following `src/lib/anomaly/rules/scope-creep.ts:17`.

## Open Questions

Questions 1 and 2 are **resolved** — see Decisions above. The rest need answers before or
during planning; each one changes the work.

1. ~~**Does saving an absence trigger immediate re-detection?**~~ — **RESOLVED, see D1.** Detection runs only on the
   cron cycle or `syncNow` (`detect.ts` callers). Without an explicit call, a suppressed
   `DEVELOPER_INACTIVE` lingers in the inbox for up to the 15-minute freshness window after
   the user records the absence that should silence it. Calling `detectAnomalies` from the
   absence-save action fixes it but couples a settings mutation to the engine. **Product
   decision.**

2. ~~**`is_planned` semantics**~~ — **RESOLVED, see D2**; only the NOT NULL migration remains open. Original note: **`is_planned` is nullable with no default, but FR-010 keys `SPRINT_AT_RISK` off
   "unplanned".** What does `NULL` mean — unknown, or planned? Options: default it in the
   form, make it non-null via a migration (the table is marked STABLE, so a migration is a
   deviation), or treat `NULL` as planned and document it. **Decide before writing the
   SPRINT_AT_RISK condition.**

3. **Whole-day semantics.** `start_date`/`end_date` are `timestamp`, not `date`. Is
   `end_date` inclusive? Which instant does a picked calendar day map to? The house
   convention says convert to a `DayKey` in the team's zone (`dayKeyInTimeZone`) and compare
   day keys lexicographically rather than comparing raw instants — but that has to be pinned
   explicitly, since the calendar UI will hand back local dates.

4. **The `countWorkingDays` timezone bug — fix, fork, or inherit?** It is the only
   working-day counter, it is server-local, and absence-adjusted capacity is its natural
   second caller. Fixing it changes `TICKET_STATUS_AGING` behaviour (and its 10 tests);
   forking creates two counters that disagree; inheriting bakes the bug into capacity.

5. **Adopt `date-fns` or extend `day-bucket.ts`?** `npx shadcn add calendar` pulls
   `react-day-picker` regardless; the current registry recipe may also pull `date-fns`. If it
   lands as a dependency anyway, the "no date library" stance is worth revisiting
   deliberately rather than by accident.

6. **Where does the surface live** — a fourth `/settings/*` tab (one-line edit to
   `settings/layout.tsx:18-22`), a sub-surface of `/settings/team`, or a dashboard-adjacent
   route? FR-010 says "per-sprint", which argues for proximity to the sprint, not to settings.

7. **What is the capacity formula?** Nothing exists to copy. Minimum viable:
   `Σ(member.spCapacity)` over active members, minus a per-member deduction for absence days
   as a fraction of the sprint's working days. Every term in that sentence is a choice —
   whether unestimated capacity (`NULL`) counts as zero, whether a QA-track member counts
   toward a frontend sub-burndown, and whether the deduction is by working days or calendar
   days.

8. **Does the demo seed grow absence rows?** Without them the demo cannot show suppression or
   the capacity line, and S-09 (demo mode) will inherit the gap. The seeded
   `DEVELOPER_INACTIVE` row is static and will not self-suppress.
