# The cadence a lead chose has exactly one home in the database (S-32)

## Overview

S-30 moved the lead's chosen cadence into `sprint_cadence_override` and
deliberately left `sprint.working_days` / `sprint.cadence_overridden` in place,
written but never read, held by one hermetic reader guard. This slice removes the
second copy: the columns are dropped, the guard goes with them, and the question
the roadmap left open — "when does a cadence record stop being worth keeping" —
is answered with the answer the PRD already gave the sibling table, written down
where the next reader will find it.

The frame brief (`frame.md`) reframed both halves. Half 1 is confirmed but
relocated: the surviving reader is not a TypeScript property access, it is a SQL
constant the guard's regex could never see. Half 2 is not a decision to make but
a record to write: a prune was rejected on evidence, not deferred.

## Current State Analysis

**The columns.** `src/db/schema.ts:444-466` declares both with docblocks that say
"SUPERSEDED … written but NEVER READ" and name S-32 as the drop. That is accurate
for the resolver: `pickCadence` (`src/lib/cadence-override.ts:200-300`) reads the
record, then `sprint.length_days` / `start_day` as tier 3, and deliberately skips
working days because Jira has no such field — the constant IS the source.

**Two writers, not one.** The frame's hypothesis table listed four allowlisted
files. Verifying it against the code found a fifth writer the guard cannot see:

- `src/lib/integrations/reconcile-sprint.ts:363,366,391` — the insert values, the
  `cadenceOverridden: false` insert-only write, and the conflict SET's
  `sql`${newWorkingDays}::jsonb``, fed by a now-single-use local at `:229`.
- `src/lib/integrations/roster-store.ts:1156-1160` — `saveCadence` runs
  `update(sprint).set({ lengthDays, startDay, workingDays })` before writing the
  record. **The guard never covered this file**, and its allowlist does not name
  it: `FLAG` matches only `cadenceOverridden`, and `SPRINT_ROW_PROPERTY` matches
  a *read* of `.workingDays` off a sprint-named receiver — a `workingDays:` key
  inside a `.set({…})` object is invisible to both.

**The last live reader is SQL.** `BACKFILL_CADENCE_OVERRIDES`
(`src/lib/cadence-override.ts:524-553`) filters `where s."cadence_overridden" =
true` and reads `s."working_days"`. Four integration tests execute it live
against a migrated database (`cadence-override.integration.test.ts:542,562,580,587`)
and a fifth pins it byte-for-byte to `0023_flowery_flatman.sql:36-58` (`:529`) —
a migration that is shipped history and cannot be edited to match.

**Nothing prunes the record, and that is not an accident.** `purgeOldRecaps`
(`src/lib/recap/retention.ts`) is the only age-based delete in the repo; it
deletes recaps. No current-plus-two purge exists for `sprint`, `jira_ticket`,
`pull_request` or `commit`, so there is no regime for this table to be out of
line with. A record for a no-longer-monitored project is a promise the product
makes out loud (`disconnect-impact.ts:203-206` tells the lead the switch keeps
"the sprint cadence you set by hand"), and the resolver's `sameProject` LEFT JOIN
exists so those rows stay visible. Measured population: **one** override row
against seven `sprint` rows locally; zero on production.

## Desired End State

`sprint` carries no cadence-override state. `sprint_cadence_override` is the only
place a lead's chosen pattern lives, and the only place anything reads it from.
`src/lib/cadence-override-readers.test.ts` does not exist, because the condition
it guarded is now enforced by the database rather than by a source scan. The PRD,
the table's docblock and the roadmap all say the record is kept for the team's
lifetime and why a prune was rejected, so the next slice that notices nothing
prunes the table finds the answer instead of re-deriving the question.

Verified by: `npm run db:migrate` applies `0024`; `npm test`, `npm run typecheck`,
`npm run lint` and `npm run test:integration` all pass; `psql` shows neither
column on `sprint`; `/team/cadence` still saves and re-reads a Mon–Thu pattern.

### Key Discoveries:

- The guard cannot survive Phase 1 — its third test asserts every allowlisted
  file *still matches* the scan (`cadence-override-readers.test.ts:161-180`), so
  the moment the writes leave `reconcile-sprint.ts` / `fixture.ts` /
  `test-support.ts`, the guard fails on its own allowlist. It must be deleted in
  the same phase as the writes, not alongside the migration.
- The backfill stays correct after the drop **in the migration chain**: a fresh
  database runs `0023` (backfill, columns present) before `0024` (drop). What
  dies is only its *re-execution* after the chain completes — which is exactly
  what the four tests do.
- `sprint.length_days` / `start_day` are NOT superseded. They remain tier 3 of
  `pickCadence` and both writers keep writing them. Only working days and the
  flag go.
- DROP COLUMN is house-standard: `0009_tiresome_titanium_man.sql`,
  `0012_premium_genesis.sql`, `0018_pale_fat_cobra.sql`. Hand-named migrations
  are accepted too (`0022_unfreeze_cadence_override`).
- `src/lib/demo/fixture.test.ts:123` builds the anomaly snapshot's resolved
  working days from `fx.sprint.workingDays` — its own comment already says the
  demo owner holds no record and the resolver lands on the Mon–Fri default, so
  the fixture row is standing in for a constant it can be replaced by.

## What We're NOT Doing

- **No prune job, no cron, no retention predicate for
  `sprint_cadence_override`.** Rejected on evidence (frame hypotheses 3–5), not
  deferred. Phase 3 records the rejection so it is not rebuilt.
- **Not touching `sprint.length_days` / `start_day`** — the derived cache the
  resolver still reads.
- **Not editing `0023_flowery_flatman.sql`.** Shipped history. Its header will
  name a constant that no longer exists; the new migration's header carries the
  forward pointer instead.
- **No new guard test** for the absent delete path. S-32 exists to retire a
  guard; adding one in the same commit trades one debt for another.
- **Not applying `0024` to production inside this slice.** Production holds zero
  `sprint` rows and the drop degrades cleanly if code runs ahead of it, so the
  migration rides the next ordinary production run rather than a special one.
  `## Migration Notes` names that route and `MANUAL-CHECKLIST.md` carries it as a
  row — "no production migration" would not be a route.

## Implementation Approach

Three phases, in an order chosen so the irreversible step is the last one that
can fail informatively. Phase 1 removes every reader and writer **while the
columns still exist**, so a green full suite is direct evidence that the blast
radius is exactly what was mapped. Phase 2 drops them. Phase 3 writes down the
non-decision.

The roadmap asks for the migration and the guard deletion "in the same commit".
The guard's own self-check forces it one phase earlier; both land in the same PR,
which is what the requirement is protecting — the guard must not outlive its
cause.

## Critical Implementation Details

**The guard's second blind spot, for the record.** The frame found one
(`FLAG` is camelCase, the surviving reader is snake_case SQL). Verification found
a second: `saveCadence`'s `update(sprint).set({ workingDays })` is a *write* by
object key, which neither the flag regex nor the receiver-name regex matches. The
guard was never wrong about what it claimed — it claimed no **readers** — but
anyone reasoning about total coverage from its allowlist would have missed a
writer. This is worth one sentence in the Phase 2 migration header, because it is
the reason a source scan is being replaced by a schema constraint.

**Ordering inside Phase 2.** Removing the two fields from `schema.ts` is what
makes `drizzle-kit generate` emit the DROP. Do not hand-write `0024`; generate it
and check the diff against the three precedents.

---

## Phase 1: Cut the last readers and writers

### Overview

After this phase nothing in `src/` names either column except `schema.ts`, and
the columns still exist and still hold their values. The full suite passing here
is the proof that Phase 2 is safe.

### Changes Required:

#### 1. The backfill constant and its tests

**File**: `src/lib/cadence-override.ts`

**Intent**: Delete `BACKFILL_CADENCE_OVERRIDES` and its docblock (`:504-553`). It
describes a statement that cannot execute once the columns are gone, and keeping
it would leave a second copy of a dead fact — the thing this slice removes.

**Contract**: The module's export surface loses one named export. `0023` keeps
its verbatim copy as shipped history and remains correct in the migration chain,
which runs it before the drop.

**File**: `src/lib/cadence-override.integration.test.ts`

**Intent**: Delete the whole `describe("the 0023 backfill")` block (`:519-596`)
and the `BACKFILL_CADENCE_OVERRIDES` import (`:18`). Drop `cadenceOverridden`
and `workingDays` from the `seedSprint` helper's insert literal (`:120-122`), and
from the three seeds that set them (`:538,556,576` — deleted with their tests).

**Contract**: `seedSprint`'s `Partial<SelectSprint>` signature is unchanged; only
the default literal loses two keys. `readFileSync` and the `sql` import may
become unused — check both.

#### 2. The reader guard

**File**: `src/lib/cadence-override-readers.test.ts`

**Intent**: Delete the file. It is a bridge to this slice, and its third test
("every allowlisted file exists and still matches") fails by construction the
moment the writes below are removed — so it cannot be carried past this phase
even if we wanted to.

**Contract**: One fewer file in `npm test`. No other test imports from it.

#### 3. The two writers

**File**: `src/lib/integrations/reconcile-sprint.ts`

**Intent**: Stop writing both columns — the `workingDays` and
`cadenceOverridden` keys in the insert values (`:363,366`) and the `workingDays`
key in the conflict SET (`:391`). Remove the `newWorkingDays` local (`:229`),
which has no other use, and fold the comments that explain the columns' inertness
into a single line pointing at `sprint_cadence_override`.

**Contract**: The insert and the conflict SET both keep `lengthDays` and
`startDay` — the derived cache is still tier 3 of `pickCadence`. The `::jsonb`
cast goes with the local it existed for. **The comment at `:346` STAYS.** It
names `cadenceOverridden: true` while explaining the `carry` hole S-30 deleted —
history about a bug, not an explanation of an inert column — and this slice does
not delete the reasoning it inherits. It is one of the two matches criterion 1.5
allows through.

**File**: `src/lib/integrations/roster-store.ts`

**Intent**: Drop `workingDays` from `saveCadence`'s `update(sprint).set({…})`
(`:1160`), and correct the function's docblock (`:1090-1091`), which currently
promises "the three values are still written to `sprint` as before" — after this
phase it is two.

Two in-function comments go stale in the same edit and are corrected with it:
`:1141-1144` ("`sprint.working_days` is deliberately not consulted — see its
docblock") points at a docblock Phase 2 deletes, so it should point at
`sprint_cadence_override` instead; and `:1170` ("the `sprint` columns above still
took the values") is about three columns and after this phase is about two.

**Contract**: `saveCadence`'s return type, the `cadenceOverrideFields` /
`writeCadenceOverride` call and the transaction boundary are unchanged. The
`NoSprintRowError` guard on an empty UPDATE result stays. The `source` literal
keeps reading `row.lengthDays` / `row.startDay` as its undated fallback — those
columns are not going anywhere.

#### 4. The row literals

**File**: `src/lib/demo/fixture.ts`

**Intent**: Drop `workingDays` and `cadenceOverridden` from the demo sprint row
(`:828-829`). The demo owner holds no override record, so the resolver lands on
`DEFAULT_CADENCE` — the same Mon–Fri the literal was carrying.

**Contract**: `demo/load.ts:97` inserts `fixture.sprint` wholesale, so the insert
shape follows automatically.

**File**: `src/lib/anomaly/test-support.ts`

**Intent**: Drop both keys from the `SelectSprint` literal (`:41-42`).

**Contract**: The literal is cast `as SelectSprint`; it will keep compiling
during this phase and be exactly right after Phase 2.

#### 5. Two comment sites that are deliberately NOT edited

**File**: `src/components/organisms/settings/cadence-editor-view.test.ts` (`:11`)

**Intent**: None — listed so the implementer does not go looking. Its comment
("Every field hand-set — what the single `cadenceOverridden: true` used to mean")
explains what the per-field provenance replaced, which is more legible with the
old name in it, not less. Together with `reconcile-sprint.ts:346` these are the
two matches criterion 1.5 exempts.

**Contract**: File untouched.

#### 6. The remaining test call sites

**File**: `src/lib/demo/fixture.test.ts`

**Intent**: Build the snapshot's `workingDays` from `DEFAULT_CADENCE.workingDays`
instead of `fx.sprint.workingDays` (`:123`). The existing comment already states
this is what the resolver returns for the demo owner. The file imports no
`DEFAULT_CADENCE` today — add it from `@/lib/integrations/cadence`.

**Contract**: `snapshotOf`'s returned shape is unchanged.

**File**: `src/lib/integrations/reconcile-sprint.integration.test.ts`

**Intent**: Drop both keys from the seed helper's literal (`:243-244`). In test
(d) — "with no record at all, the cadence columns refresh from Jira" — delete the
`workingDays` argument to `seedSprint` (`:350`, the ONLY `seedSprint` call site in
the file that passes it; the other twelve `workingDays` literals are all
`seedOverride` and stay) **and** the assertion it existed for (`:358`). Its
sibling assertions on `lengthDays` / `startDay` (`:356-357`) stay and carry the
test.

**Contract**: The test's name and intent are unchanged; it loses one of three
column assertions because that column no longer exists. **Do NOT retarget `:358`
onto the resolver.** Test (d) seeds no record, so `resolveCadenceFor` returns
`DEFAULT_CADENCE.workingDays` unconditionally — tier 3 has no working-days input
by construction, which `cadence-override.test.ts:147` already pins as its own
test. A resolver assertion here would pass whatever the reconciler does: a
tautology wearing the name of a guarantee. The guarantee ends because the column
it was about ends. The retargets in `roster-store.integration.test.ts` below are
different and are sound — there a record genuinely holds `["MON","TUE","WED"]`,
so `resolvedFor` is a real witness.

**File**: `src/lib/integrations/roster-store.integration.test.ts`

**Intent**: Remove the three assertions on the dropped columns (`:464-465`,
`:600`, `:893`). At `:600` and `:893` the assertion on the record immediately
below already carries the guarantee — the comments there say so explicitly. At
`:464-465` the sprint-row read keeps its `lengthDays` / `startDay` assertions and
loses the other two.

**Contract**: No test is deleted; each keeps its `resolvedFor(...)` /
`toMatchObject` assertion as the surviving guarantee.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- No live reference survives outside `schema.ts`: `grep -rn --include='*.ts' --include='*.tsx' -E 'cadenceOverridden|BACKFILL_CADENCE_OVERRIDES' src/` returns `src/db/schema.ts` plus exactly two comment lines — `src/lib/integrations/reconcile-sprint.ts:346` and `src/components/organisms/settings/cadence-editor-view.test.ts:11`, both historical prose kept on purpose (§3, §5). No line of executable code matches.
- `src/lib/cadence-override-readers.test.ts` does not exist

---

## Phase 2: Drop the columns

### Overview

The database becomes the guarantee the source scan used to provide.

### Changes Required:

#### 1. The schema

**File**: `src/db/schema.ts`

**Intent**: Remove the `workingDays` and `cadenceOverridden` fields from the
`sprint` table (`:444-466`), with the two docblocks that exist to explain why
they were still there. Amend the `sprint_cadence_override` header's closing
sentence (`:602`) — "NO write path **in this slice** deletes a row" — to state
the permanent rule; the full reasoning lands in Phase 3.

**Contract**: `SelectSprint` and `InsertSprint` lose two fields. `lengthDays`,
`startDay` and every other `sprint` column are untouched.

#### 2. The migration

**File**: `src/db/migrations/0024_*.sql` (generated)

**Intent**: Generate with `npm run db:generate`, then apply locally with
`npm run db:migrate`. Add a header comment above the generated statements:
what is dropped, that S-30's reader guard was deleted with it, and the guard's
two blind spots (snake-case SQL, and a write by object key) as the reason a
schema constraint replaces a source scan.

**Contract**: Two `ALTER TABLE "sprint" DROP COLUMN` statements, matching the
shape of `0018_pale_fat_cobra.sql`. `meta/_journal.json` gains idx 24. Do not
hand-write the SQL — generate it and read the diff.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:migrate`
- Columns are gone: `psql "$DATABASE_URL" -c '\d sprint'` lists neither `working_days` nor `cadence_overridden`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Generated SQL contains exactly two `DROP COLUMN` statements and no other DDL

#### Manual Verification:

- `/team/cadence` on the onboarded local account: set working days to Mon–Thu, save, reload the page — the Mon–Thu pattern is still shown, and the page reports the working days as hand-set while length and start day still follow Jira. Catches a resolver or `saveCadence` path that was silently depending on the dropped column.
- `/settings/demo` → load demo data → `/dashboard` renders the demo sprint with its anomaly inbox populated. Catches the demo fixture's sprint insert going out of shape with the table.

**Implementation Note**: After Phase 2's automated verification passes, pause for
manual confirmation before Phase 3.

---

## Phase 3: Write down the non-decision

### Overview

The roadmap called the retention question "genuinely a decision, not a chore".
The evidence says the decision is already made and is the PRD's own — what is
owed is the record, in the three places the question gets re-opened from.

### Changes Required:

#### 1. The PRD's retention exception

**File**: `context/foundation/prd.md` § Non-Goals, "No retention of raw synced
data beyond current + 2 previous sprints" (`:237`)

**Intent**: Extend the existing FR-023 exception to name
`sprint_cadence_override` alongside the measurement record, with a dated
amendment in the established style. State the reason in the same shape the
original uses: an inheritance chain that resets every three sprints is not
inheritance — the resolver's tier-2 lookback is `start_date <= ?` with no floor
by construction (`cadence-override.ts:274-300`), so a record for a long-closed
sprint is what carries a Mon–Thu pattern forward.

**Contract**: One amended bullet under § Non-Goals, marked
`**Extended 2026-08-31 (S-32):**`. No FR text changes — FR-007 already states the
record outlives the sync graph.

#### 2. The table's docblock

**File**: `src/db/schema.ts`, `sprintCadenceOverride` header (`:575-603`)

**Intent**: Turn the closing "no write path **in this slice** deletes a row" into
the permanent rule, and record the two edges the roadmap named as reasons a prune
was *rejected*, not overlooked: a record for a project the account no longer
monitors is a promise made to the lead in copy
(`disconnect-impact.ts:203-206`), and the inheritance tier's lookback has no
floor, so pruning by age is the S-30 defect rebuilt on a timer.

**Contract**: Docblock prose only. No column, constraint or index changes.

#### 3. The roadmap

**File**: `context/foundation/roadmap.md`, § S-32 (`:1535-1575`) and its summary
row (`:66`)

**Intent**: Record what shipped: both leftovers closed, the second one closed by
deciding not to prune. Correct the block's own framing while it is being touched
— it describes the guard as the thing standing between the columns and a future
reader, which verification showed was true only for readers, not writers.

**Contract**: Detail block and summary row updated in place; `Change ID` gains
`cadence-single-home`; `Status` stays `proposed` until `/10x-archive` closes it,
per the repo's convention.

#### 4. The manual rows this slice owes

**File**: `context/changes/cadence-single-home/MANUAL-CHECKLIST.md` (new)

**Intent**: Write the slice's short list — the two blocking rows, 2.8 and 2.9,
each carrying the four parts CLAUDE.md requires (where, what to do, what must be
true, why it matters), signed off with their phase numbers. Prepend the
production-migration row that `lessons.md` § "A deploy that ships code but not
migrations breaks silently" requires of every migration phase: apply `0024`
before either cadence row is exercised against a deployed database.

**Contract**: Three rows, not twenty. `plan.md` `## Progress` stays canonical;
the checklist carries the descriptions.

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: Open section `## 27. S-32 `cadence-single-home` — otwarte (2026-08-31)`
with a `### Blokujące (te same, co w checkliście slice'a)` subsection carrying
rows 2.8 and 2.9, in the Polish format §26 already establishes. Without it the
second tester cannot see this slice at all, and `manual-test-sweep.mjs` exits
non-zero — which it does today, on exactly this plan.

**Contract**: Append-only; no existing section is touched. Numbering continues
from §26 (S-30).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Manual-test sweep is clean: `node scripts/manual-test-sweep.mjs`

#### Manual Verification:

- Read the amended PRD bullet and the docblock back to back: a reader who arrives
  asking "why does nothing prune this table" finds the answer and the evidence
  without opening the archive.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. The suite shrinks: the reader guard and the five backfill
  tests are deleted because the condition they asserted is enforced by the
  schema after Phase 2.
- `fixture.test.ts` keeps its full anomaly coverage — only the source of the
  snapshot's working days changes, from the fixture row to the constant the
  resolver would return.

### Integration Tests:

- `cadence-override.integration.test.ts` keeps every resolver test — the three
  tiers, the cross-owner and cross-project isolation cases, and the
  clear-fields case. Only the backfill block goes.
- `reconcile-sprint.integration.test.ts` and `roster-store.integration.test.ts`
  keep every test; three assertions move from the dropped columns onto the
  record, which is where the guarantee already lives.
- Phase 1's green integration run **with the columns still present** is the
  load-bearing check: it proves the mapped blast radius is the whole of it before
  anything irreversible happens.

### Manual Testing Steps:

1. `/team/cadence`: set Mon–Thu, save, reload — pattern persists and reads as
   hand-set for working days only.
2. `/settings/demo`: load demo, open `/dashboard` — sprint and anomaly inbox
   render.

## Migration Notes

**This is a DROP, so the deploy ordering is the reverse of every additive
migration this repo has shipped.** `lessons.md` records the additive hazard — "a
deploy that ships code but not migrations breaks silently, at the first request
that reads the new column". The mirror image applies here: the migration must
land **after** the code that writes those columns is gone, or the first reconcile
after the drop fails on a column that no longer exists. The phase order enforces
it — Phase 1 removes the writes, Phase 2 drops.

**No live data risk this time, and `0024`'s route to production is the ordinary
one.** Production holds zero `sprint` rows; local Supabase holds seven, one
override record, none flagged. A code-only deploy that runs ahead of `0024`
degrades cleanly in this direction — `working_days` is nullable and
`cadence_overridden` is `DEFAULT false NOT NULL`, so an insert that stops
supplying either still succeeds — which is why the additive hazard's usual
urgency does not apply. `0024` therefore applies on the next production migration
run, by the route `MEMORY`/`lessons.md` records for this repo, and that row leads
the `MANUAL-CHECKLIST.md`. Naming the route is the point: "no production
migration" is not a route, and this repo has already shipped one pair of
migrations that never reached production.

**Rollback** is a code revert plus a hand-written re-add migration — no longer
"just a code revert", which was S-30's stated reason for keeping the columns.
That trade is the point of S-32: the revert window closes because the thing it
was protecting has been proven unnecessary by a green suite.

## References

- Frame brief: `context/changes/cadence-single-home/frame.md`
- Roadmap: `context/foundation/roadmap.md:1535-1575` (S-32), `:66` (summary row)
- Prior art: `context/archive/2026-08-31-cadence-override-retention/` (S-30)
- The superseded columns: `src/db/schema.ts:444-466`
- The guard being retired: `src/lib/cadence-override-readers.test.ts`
- The surviving SQL reader: `src/lib/cadence-override.ts:524-553`; executed at
  `src/lib/cadence-override.integration.test.ts:542,562,580,587`; pinned at `:529`
- Writers: `src/lib/integrations/reconcile-sprint.ts:229,363,366,391`,
  `src/lib/integrations/roster-store.ts:1156-1160`
- Resolver tiers / unbounded lookback: `src/lib/cadence-override.ts:200-300`
- Project-switch promise: `src/lib/integrations/disconnect-impact.ts:203-206`
- DROP COLUMN precedents: `src/db/migrations/0009_tiresome_titanium_man.sql`,
  `0012_premium_genesis.sql`, `0018_pale_fat_cobra.sql`
- PRD retention exception: `context/foundation/prd.md:237`
- Deploy-ordering lesson: `context/foundation/lessons.md` § "A deploy that ships
  code but not migrations breaks silently"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cut the last readers and writers

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 8455a8f
- [x] 1.2 Linting passes: `npm run lint` — 8455a8f
- [x] 1.3 Unit tests pass: `npm test` — 8455a8f
- [x] 1.4 Integration tests pass: `npm run test:integration` — 8455a8f
- [x] 1.5 No live reference survives outside `schema.ts` (grep for `cadenceOverridden|BACKFILL_CADENCE_OVERRIDES` returns `schema.ts` plus only the two kept comment lines) — 8455a8f
- [x] 1.6 `src/lib/cadence-override-readers.test.ts` does not exist — 8455a8f

### Phase 2: Drop the columns

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:migrate`
- [x] 2.2 Columns are gone from `\d sprint`
- [x] 2.3 Type checking passes: `npm run typecheck`
- [x] 2.4 Linting passes: `npm run lint`
- [x] 2.5 Unit tests pass: `npm test`
- [x] 2.6 Integration tests pass: `npm run test:integration`
- [x] 2.7 Generated SQL contains exactly two `DROP COLUMN` statements and no other DDL

#### Manual

- [ ] 2.8 `/team/cadence`: Mon–Thu saves, survives reload, reads as hand-set for working days only
- [ ] 2.9 `/settings/demo`: demo loads and `/dashboard` renders its sprint and anomaly inbox

### Phase 3: Write down the non-decision

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Unit tests pass: `npm test`
- [ ] 3.3 Manual-test sweep is clean: `node scripts/manual-test-sweep.mjs`

#### Manual

- [ ] 3.4 PRD bullet and table docblock read back to back answer "why does nothing prune this table"
