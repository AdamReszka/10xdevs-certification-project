# S-12 Recap History — Implementation Plan

## Overview

Build FR-019: the owner can browse past daily recaps and open any one of them,
and recaps older than the current sprint plus the two previous ones are purged
automatically. Two things ride along because this slice is the first that can
carry them: the `daily_recap.sprint_id` reshape S-11 deferred here by name, and
the Resend bounce/complaint webhook that S-11's plan-review left open as F6.

The data to render already exists. S-11 writes a `payload` (`RecapPayload`,
`schemaVersion: 1`) and the frozen `rendered_message` bytes on every send, and
`src/lib/recap/types.ts:12-16` states the storage decision was made *for this
slice*: the payload is a denormalized snapshot rather than anomaly ids, because
pointing at ids would show a recap whose anomalies have since been resolved or
re-scored. What is missing is a reader, a surface, a retention rule, and a way
for a bounced address to stop the daily send.

## Current State Analysis

Verified against the code at `4c10a33`.

- **`daily_recap` holds everything a history view needs.** `payload` jsonb
  (`schema.ts:1029`), `rendered_message` jsonb `{subject, html, text, headers?}`
  (`schema.ts:1035`), `anomaly_ids` (`:1036`), `recap_day` NOT NULL (`:1018`),
  `send_status` (`:1020`), `sent_at` (`:1019`), `attempt_count` (`:1022`),
  `last_attempt_at` (`:1028`).
- **There is exactly one reader, and it is deliberately narrow.**
  `getLastRecap` (`src/lib/recap-settings.ts:128-151`) is `limit(1)`, selects no
  `id`, no `payload`, no `rendered_message`, and its doc comment at `:125-126`
  says verbatim that listing and drilling in is S-12. The `listRecaps` /
  `getRecap` pair is net-new.
- **`daily_recap.sprint_id` is NOT NULL with `ON DELETE CASCADE`**
  (`schema.ts:1006-1008`), and the comment above it (`:996-1005`) is addressed to
  this slice: a Jira project switch deletes the owner's sprint rows
  (`connection-service.ts:405-411`, defensive twin at `jira-store.ts:239-259`),
  which cascades away both today's claim row — producing a **second email for the
  same local day** — and every stored recap for that sprint. The prescribed fix
  is nullable `sprint_id` + `ON DELETE SET NULL` + a `recap_day`-keyed purge.
- **No retention purge exists anywhere in the repo.** The only precedent is
  `SYNC_ATTEMPT_RETENTION = 50` (`run-sync.ts:310`), pruned inline inside
  `recordAttempt` (`:325-353`) by a never-throwing `delete … where id in (select
  … offset N)`. The structural precedent for a per-owner best-effort cron step is
  the S-23 measurement sweep (`scheduled.ts:129-136`).
- **`sprint_measurement` is the only durable, ordered sprint series.** It has no
  FK to `sprint` or `jira_project` on purpose (`schema.ts:450-462`) precisely so
  it outlives a project switch and the retention bound. `listRecordedSprintsForOwner`
  (`measurement/reader.ts:177-186`) returns it newest-first (`start_date DESC
  NULLS LAST`), unfiltered by finalization — so the active sprint's own open
  record is included, which is what "current + 2 previous" needs.
- **The list→detail vocabulary already exists, once.** `/refinement` +
  `/refinement/runs/[runId]` (`refinement/page.tsx:61-88`,
  `refinement/runs/[runId]/page.tsx`), with the ownership rule stated at
  `[runId]/page.tsx:16-19`: another owner's run returns the SAME 404 a
  non-existent id gets, because distinguishing them confirms the row exists to
  someone who cannot read it. The store rules are at `refinement/store.ts:15-29`
  — every query carries `owner_id`, including redundantly on child reads.
- **Nothing in the repo verifies a signature.** A repo-wide search for
  `hmac|svix|timingSafeEqual|crypto.subtle` returns only prose. `svix` is not
  installed; the Resend SDK is not installed either — `src/lib/email.ts:1-6`
  records the decision to use a raw `fetch` client instead.
- **`/api/*` is gated.** `middleware.ts:26` lists `PUBLIC_PREFIXES` and the
  matcher at `:49-54` covers `/api`. A new webhook route without a prefix entry
  receives a 302 to `/login` and never runs.
- **`recap_settings` has no row for most owners.** `getRecapSettings`
  (`recap-settings.ts:40-58`) returns `DEFAULT_RECAP_SETTINGS` (`:34-38`,
  `enabled: true`) when none exists, so "turn this owner's recap off" is an
  upsert, never an `UPDATE`.
- **Demo seeds exactly one recap row** (`demo/fixture.ts:774-799`) — terminal
  `SENT`, `anomalyIds: []`, `renderedMessage` without `headers`.

## Desired End State

From `/settings/recap` the owner reaches a history page listing their recent
recaps newest-first — every row, not only the successful ones — each showing the
local day, what happened to it, and when. Opening a row shows the message exactly
as it was sent, rendered from the stored bytes. A recap older than the current
sprint plus the two previous ones is gone, deleted by the cron on an ordinary
cycle, and switching the monitored Jira project no longer destroys the archive.
A hard bounce or a spam complaint reported by Resend turns the daily send off for
that address and `/settings/recap` says why, so the owner does not switch it back
on into the same loop.

Verification: `npm run lint && npx tsc --noEmit && npm test && npm run test:integration && npm run test:e2e`
all green, plus `MANUAL-CHECKLIST.md`.

### Key Discoveries

- `src/lib/recap/types.ts:22-26` — `RecapSchemaVersion = 1` exists so this slice
  can read rows written before a later payload change. The detail view must not
  assume the current shape without checking it.
- `src/lib/recap/render.ts:12-18` — the stored HTML is table-based with inline
  styles, **no `<script>`, no `<style>`, no external assets**, and every
  interpolation goes through `escape-html.ts:15-22` on the write side. That is
  what makes rendering the frozen bytes in a sandboxed frame a safe default
  rather than a hazard.
- `src/lib/recap/send.ts:143-155` and `:234-249` — `payload` and
  `rendered_message` are NULL between the claim and the render-persist, and stay
  NULL forever on a row that failed at the recipient check (`:223-231`). A list
  and a detail view must both render a row with no content.
- `src/components/organisms/settings/recap-settings-view.ts:35-59` —
  `describeLastSend(row, now = new Date())` already distinguishes an in-flight
  PENDING from a stalled one and an exhausted FAILED from a retryable one, with
  `now` injected as a default parameter so it stays unit-testable. The list rows
  want exactly this judgement, so it is generalized rather than re-derived.
- `src/lib/measurement/reader.ts:177-186` — `listRecordedSprintsForOwner` is
  scoped to the **currently monitored** Jira project. After a project switch the
  new project has fewer than three records, so the cutoff resolves to nothing and
  the purge deletes nothing. That is the fail-safe direction and is stated here
  rather than discovered later.
- `src/lib/integrations/sync/scheduled.ts:58-66` — the cron enumerates owners
  holding a `jira_project` **and** a `github_credential`, demo users excluded.
  The purge therefore reaches exactly the owners the recap send reaches: an
  owner who disconnects GitHub stops accumulating recaps but keeps the ones
  they have, forever. Third fail-safe case, same direction as the two above and
  bounded — their row count cannot grow (plan-review F7).
- `src/lib/integrations/sync/scheduled.ts:80-167` — three sibling per-owner `try`
  blocks with an injectable dep per step and `ctx.waitUntil(pool.end())` in the
  `finally` (`:162-166`). A fourth step follows the same shape exactly.
- `src/app/(app)/settings/recap/page.tsx:12-15` and `:57-61` — the page inherits
  `requireSession()` and `force-dynamic` from `(app)/layout.tsx` and must not
  re-declare either, and no `Date` crosses the RSC boundary.
- `src/components/molecules/settings-tabs.tsx:26` — tab highlighting is prefix
  matching, so `/settings/recap/history` keeps the Daily recap tab active with no
  new tab entry.
- Resend's webhook contract (fetched from the live docs, 2026-08-29): Svix
  headers `svix-id` / `svix-timestamp` / `svix-signature`, a `whsec_`-prefixed
  base64 secret, and payloads whose `data.to` is an array and whose bounce object
  carries `{ type: "Permanent" | …, subType, message }`.

## What We're NOT Doing

- **No retention of anything but recaps.** The PRD's non-goal bounds raw synced
  data to the same window, but FR-019 and the roadmap's S-12 outcome name recaps
  only, and the GitHub tables have no sprint FK at all (`github_commit` and
  `github_pull_request` hang off `monitored_repo`), so purging them needs a
  date rule that is its own decision. Filed, not smuggled in.
- **No re-render of a recap from its payload.** The detail view shows the frozen
  bytes. A second renderer over the same content is exactly the divergence S-11
  spent plan-review F1 eliminating.
- **No pagination.** The retention bound is three sprints, so the list is
  bounded by construction — roughly 30–60 rows. A bounded read with an explicit
  limit, in the shape `refinement/store.ts:164-177` uses, not a pager.
- **No recap history in the Daily Recap email**, and no change to what the email
  contains.
- **No unsubscribe/preference centre and no double opt-in.** The webhook closes
  the bounce half of S-11's F6; `enabled: false` plus the existing
  `List-Unsubscribe` header remain the whole opt-out surface.
- **No bounce/complaint event log table.** The webhook writes a reason and a
  timestamp on `recap_settings` and nothing else; Resend's own dashboard is the
  event history, and a second copy of it in Postgres would fall under the same
  retention question this slice is deliberately keeping narrow.
- **No fix for `MAX_OWNERS_PER_CYCLE`** (`scheduled.ts:38`, the cursor claim
  S-11 also declined to widen into).
- **No new top-level navigation entry.**

## Implementation Approach

Four phases, ordered so that the irreversible work is provable before any of it
runs unattended, and so the phase with an external provisioning dependency is
last and severable.

Phase 1 reshapes the FK and adds the readers — after it, the archive stops being
destroyed by an ordinary product action, which is a prerequisite for a surface
that promises history. Phase 2 adds the purge, tested against a database before
it is wired into a loop that runs every fifteen minutes. Phase 3 builds the
surface, at which point the slice's FR is met. Phase 4 adds the webhook; its
migration is its own, so cutting the phase leaves no unused columns behind.

Two invariants hold throughout:

- **Every query carries `owner_id`, and a row that is not yours is a 404.** There
  is no RLS behind these tables (`recap-settings.ts:9-22`); the predicate is the
  isolation. Cross-owner specs exist to make a forgotten predicate fail loudly.
- **The stored bytes are read, never regenerated.** Nothing in this slice may
  call `renderRecapEmail`.

## Critical Implementation Details

**The purge predicate is `recap_day`, but the cutoff comes from a sprint
boundary.** These are not in tension, and the plan-level risk note in the roadmap
("keyed to sprint boundaries, not calendar days") is satisfied by the cutoff, not
by the predicate. Deleting via `sprint_id` would tie retention to rows that
cascade away on a project switch — the exact failure this slice is repairing.
So: read the three newest recorded sprints, take the third one's `start_date`,
convert it to a `DayKey` in the team's zone, and delete strictly below it. Strict
`<` is load-bearing: the boundary day belongs to the third sprint and must
survive.

**Fewer than three recorded sprints means no cutoff and no delete.** Not a
cutoff of zero, not "delete nothing older than today" — the function returns
null and the purge is skipped. The same applies when the third row has no
`start_date`. Every uncertain case must fail toward keeping data.

**A bounce must not be able to disable an owner by asserting an address.** The
webhook's only authentication is the signature; everything after it is derived
from a payload a stranger would love to forge. Verify first, on the raw body,
before parsing — and reject an absent secret before touching the database, per
`lessons.md` #6, whose corollary is that a precondition which cannot improve on
retry is checked before anything is persisted.

**Svix signs `${svix-id}.${svix-timestamp}.${rawBody}`.** Three details make a
hand-rolled verifier correct rather than approximately correct: the secret is
base64 after stripping the `whsec_` prefix and is decoded before use; the
`svix-signature` header may carry several space-separated `v1,<base64>` entries
and any one matching is a pass; and the timestamp must be checked against a
tolerance window or a captured request replays forever. Compare in constant time.
The raw body must be read as text and passed to the verifier unmodified —
`await request.json()` first and re-serializing changes the bytes and every
signature fails.

**Resend reports `data.to` as an array**, and the same webhook carries
password-reset bounces, not only recap bounces. Both are intended: a `Permanent`
bounce says the address is bad regardless of which message hit it, and the reset
email is the cheapest detector of a typo'd sign-up address. Match owners on the
address case-insensitively, and remember `user.demo_of` — a synthetic demo user
must never be disabled by a real bounce.

---

## Phase 1: Schema reshape and the history readers

### Overview

Make the archive survive a project switch, and give the app a way to read it.

### Changes Required:

#### 1. `daily_recap.sprint_id` becomes nullable with `ON DELETE SET NULL`

**File**: `src/db/schema.ts`

**Intent**: Stop a Jira project switch from cascading away the owner's recap
history and today's claim row. This is the fix the column's own comment
(`:996-1005`) assigns to this slice.

**Contract**: `sprintId` loses `.notNull()` and its FK reference becomes
`{ onDelete: "set null" }`. Rewrite the comment block above it: what is now
recorded is that the recap outlives its sprint, that `payload.sprint` already
carries the sprint's name as a denormalized snapshot so the detail view needs no
join, and that the S-11 accepted consequence is closed. Drop
`index("daily_recap_owner_sprint_idx")` (`:1041`) together with the comment
claiming S-12's purge will use it — the purge is `recap_day`-keyed and the
listing rides `daily_recap_owner_day_uq(owner_id, recap_day)`, so the index has
no remaining consumer.

#### 2. Migration

**File**: `src/db/migrations/0019_*.sql` (generated by `npm run db:generate`)

**Intent**: Apply the reshape to a table that now holds real rows — unlike
S-11's `0009`, this one must not delete anything.

**Contract**: Generate, then hand-edit following the `0008_flawless_veda.sql:2-7`
convention: a leading SQL comment stating the reasoning, and the
`--> statement-breakpoint` separators preserved. The FK cannot be altered in
place — it is dropped and recreated:

```sql
ALTER TABLE "daily_recap" DROP CONSTRAINT "daily_recap_sprint_id_sprint_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_recap" ALTER COLUMN "sprint_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "daily_recap" ADD CONSTRAINT "daily_recap_sprint_id_sprint_id_fk"
  FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE set null;
--> statement-breakpoint
DROP INDEX "daily_recap_owner_sprint_idx";
```

Verify the generated constraint name against the existing DDL before trusting
the one written here.

#### 3. The history readers

**File**: `src/lib/recap/history.ts` (new)

**Intent**: The `listRecaps` / `getRecap` pair the surface needs, following the
read-side convention `(db, ownerId, …rest) → Promise<serializable>` and the
ownership rules from `refinement/store.ts:15-29`.

**Contract**: Two exported functions and two exported row types.

- `listRecaps(db, ownerId, limit?)` — selects `id, recapDay, sendStatus, sentAt,
  attemptCount, lastAttemptAt`, plus a boolean derived in SQL for whether
  `rendered_message` is present, so the list can mark a contentless row without
  pulling kilobytes of JSONB. `WHERE owner_id`, `ORDER BY recap_day DESC`
  (lexicographic on `YYYY-MM-DD` is chronological — the reasoning is already at
  `recap-settings.ts:145-146`), with a default limit sized to the retention
  bound and stated as such in a comment.
- `getRecap(db, ownerId, id)` — the full row including `payload` and
  `rendered_message`, scoped by `and(eq(id), eq(ownerId))`, returning `null` for
  both "no such row" and "another owner's row" with the doc comment saying so.
- Dates stay `Date` here; serialization to ISO strings is the page's job, per
  `settings/recap/page.tsx:57-61`.

#### 4. Point the existing narrow reader at the new module

**File**: `src/lib/recap-settings.ts`

**Intent**: `getLastRecap` and `listRecaps` now overlap. Keep both — they select
different columns for different pages — but make the relationship explicit so a
third reader does not appear by accident.

**Contract**: Comment change only, at `:125-126`, replacing the "S-12 will do
this" note with a pointer to `recap/history.ts` and one sentence on why the
narrow select stays.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npm run db:migrate`
- New integration test: deleting an owner's `sprint` row leaves their
  `daily_recap` rows in place with `sprint_id` NULL
- New integration test: `listRecaps` returns newest-first, is owner-scoped, and
  honours its limit
- New integration test: `getRecap` returns null for another owner's recap id
- New integration test: `getRecap` returns a row whose `payload` and
  `rendered_message` are NULL without throwing
- Existing recap suites still pass unchanged: `src/lib/recap/send.integration.test.ts`,
  `src/lib/recap-settings.integration.test.ts`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit suite passes: `npm test`
- Integration suite passes: `npm run test:integration`

#### Manual Verification:

- `\d daily_recap` on local Supabase shows `sprint_id` nullable, the FK as
  `ON DELETE SET NULL`, and no `daily_recap_owner_sprint_idx`

**Implementation Note**: After completing this phase and all automated
verification passes, pause for the human's confirmation before proceeding.

---

## Phase 2: Retention cutoff and the purge

### Overview

Delete recaps older than the current sprint plus the two previous ones, on the
cron, without being able to take the cycle down with it.

### Changes Required:

#### 1. The cutoff and the delete

**File**: `src/lib/recap/retention.ts` (new)

**Intent**: Turn "current + 2 previous sprints" into one `DayKey`, then delete
below it. Two functions rather than one, so the arithmetic is unit-testable
without a database.

**Contract**:

- `RETAINED_SPRINTS = 3`, with a comment tying it to FR-019's wording.
- `resolveRetentionCutoff(sprints, timeZone): DayKey | null` — **pure**, takes
  the already-read series newest-first. Returns null when the series holds fewer
  than `RETAINED_SPRINTS` entries or when the third entry has no `start_date`;
  otherwise `dayKeyInTimeZone(third.startDate, timeZone)`
  (`dashboard/day-bucket.ts:48`).
- `purgeOldRecaps({ db, ownerId, timeZone })` — reads the series via
  `listRecordedSprintsForOwner(db, ownerId, RETAINED_SPRINTS)`
  (`measurement/reader.ts:177-186`), calls the pure resolver, and on a non-null
  cutoff runs one owner-scoped delete with a **strict** `lt(dailyRecap.recapDay,
  cutoff)`. Returns `{ cutoff, deleted }` so the cron can log a number rather
  than a boolean. It does not throw on an empty series — that is the ordinary
  state of a young team.

#### 2. Wire it into the cron

**File**: `src/lib/integrations/sync/scheduled.ts`

**Intent**: A fourth per-owner step, structurally identical to the S-23 sweep at
`:129-136`.

**Contract**: Add `purgeOldRecaps` to the injectable `deps` (`:83-90`) and
resolve it next to `runSweep`. Give it its own `try` **after** the recap send, so
a purge failure can take down neither the sync, nor the measurement sweep, nor
the email — and so a recap written this cycle is never a candidate for the delete
that follows it. The catch logs `err.message` only, following the recap block's
own rule at `:146-158`. Extend `ScheduledSyncResult` (`:68-74`) with the count.
The timezone comes from `getJiraTimeZone` on the same handle.

**The step logs its own result — the cycle's does not survive** (plan-review
F2). `worker.ts:46` is `ctx.waitUntil(runScheduledSync(env, ctx))`: the returned
`ScheduledSyncResult` is discarded, and `scheduled.ts` writes to the console only
inside its three `catch` blocks (`:117`, `:132`, `:154`). So the count on the
result type is for the tests and for a caller that may one day read it, and the
only thing an operator can see is what this step logs itself. Emit one
`console.info` **when `deleted > 0`** carrying `{ ownerId, cutoff, deleted }` —
a DayKey and an integer, no address and no payload — so `wrangler tail` can
answer "what did it delete last night?". This is the first irreversible deletion
in the repo; shipping it silent is what makes a wrong cutoff undiscoverable.

#### 3. Tests

**Files**: `src/lib/recap/retention.test.ts`,
`src/lib/recap/retention.integration.test.ts` (new)

**Intent**: Prove the arithmetic hermetically and the delete against Postgres.

**Contract**: The unit file covers the pure resolver: two sprints yields null,
three yields the third's day, a null `start_date` on the third yields null, and
the zone actually shifts the day (a `start_date` late on the 31st in UTC is the
1st in `Pacific/Auckland`). The integration file seeds four sprints' worth of
recaps for two owners and asserts the boundary day survives, everything strictly
below it is gone, and the other owner is untouched.

### Success Criteria:

#### Automated Verification:

- New unit test: fewer than three recorded sprints resolves to no cutoff
- New unit test: the cutoff is the third-newest sprint's start day in the team's
  timezone, not in UTC
- New unit test: a third sprint with no start date resolves to no cutoff
- New integration test: recaps strictly older than the cutoff are deleted and the
  boundary day survives
- New integration test: the purge is owner-scoped
- New integration test: a throwing purge does not change `synced`, `failed` or
  `recapsSent` in the cycle result
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit suite passes: `npm test`
- Integration suite passes: `npm run test:integration`

#### Manual Verification:

- On the real account, a full cron cycle logs a purge count and the dashboard,
  the recap and the measurement sweep all still complete

**Implementation Note**: After completing this phase and all automated
verification passes, pause for the human's confirmation before proceeding.

---

## Phase 3: The history surface and the demo fixture

### Overview

Make the archive readable — and make it non-empty in demo, where the product's
value is supposed to be visible without an integration.

### Changes Required:

#### 1. The list page

**File**: `src/app/(app)/settings/recap/history/page.tsx` (new)

**Intent**: The list of recent recaps, under the tab that already owns the recap
concept. Prefix matching in `settings-tabs.tsx:26` keeps Daily recap highlighted,
so no tab entry is added.

**Contract**: Server component. `resolveWorkspace()` → `getCloudflareContext()` →
`getDb(env)`, then one `Promise.all` over `listRecaps` and `getJiraTimeZone`.
Does **not** re-declare `requireSession()` or `force-dynamic`. Dates serialized
to ISO strings before crossing into the organism. Page container class copied
verbatim from the sibling pages. A back link to `/settings/recap`.

#### 2. The detail page

**File**: `src/app/(app)/settings/recap/history/[id]/page.tsx` (new)

**Intent**: One recap, shown as it was sent.

**Contract**: `{ params }: { params: Promise<{ id: string }> }`, awaited.
`getRecap(db, ownerId, id)` → `notFound()` on null, with the comment naming why
another owner's id must produce the same 404 as a missing one
(`refinement/runs/[runId]/page.tsx:16-19`). Renders the header facts from the
row, then the message. Back link to the list.

The header facts that come from `payload` — the sprint's name — are read **only
when `payload.schemaVersion === RECAP_SCHEMA_VERSION`** (`recap/types.ts:22-26`),
and otherwise fall back to the row's own columns (plan-review F6). That version
exists precisely so this slice can read a row written before a later payload
change (Key Discoveries #1); without the check the guard is decorative and a v2
row renders `undefined` into the page. The frozen `rendered_message` is
unaffected — it is bytes, not a shape, and is displayed whatever the payload
says.

#### 3. The message frame

**File**: `src/components/organisms/settings/recap-message-frame.tsx` (new)

**Intent**: Show the stored bytes without letting them act.

**Contract**: An `<iframe>` fed by `srcDoc` with the stored `html`, a title for
accessibility, and a fixed height with internal scrolling. The `sandbox`
attribute is spelled out token by token rather than left empty (plan-review F3):
`sandbox="allow-popups allow-popups-to-escape-sandbox"`, and the `srcDoc` string
is the stored html with `<base target="_blank">` injected into its head. An
empty sandbox blocks top-level navigation, and `render.ts:131` emits a plain
`<a href="…">` with no `target` — so the deep-links that are the whole point of
FR-014's fifth attribute would be silently inert, and the manual row asserting
they are clickable would fail. `allow-scripts` and `allow-same-origin` stay OFF,
and the header comment says why each token is present and each absent one is
not. The rest of the safety argument belongs there too: the bytes are already
escaped on the write side (`escape-html.ts:15-22`) and `render.ts:12-18`
guarantees no script, style or external asset — the sandbox is the second line,
not the first. When
`rendered_message` is null, render the plain-text fallback if present, and
otherwise an explicit "this recap never got as far as being rendered" block
naming the row's status.

#### 4. The list organism and its pure sibling

**Files**: `src/components/organisms/settings/recap-history-list.tsx`,
`src/components/organisms/settings/recap-history-view.ts`,
`src/components/organisms/settings/recap-history-view.test.ts` (new)

**Intent**: Rendering in the `.tsx`, every judgement in the `.ts`, per CLAUDE.md
— there is no component-test harness.

**Contract**: The `.ts` exports the row view-model: a `describeRecapRow(row, now)`
that generalizes `describeLastSend` (`recap-settings-view.ts:35-59`) — same
PENDING-in-flight vs stalled and FAILED-exhausted vs retryable distinctions, same
injected `now` default parameter — plus the empty-state text and the row's link
target. `describeLastSend` is refactored to call it rather than duplicating the
mapping, and its existing test file must stay green unchanged. The `.tsx` uses
the installed shadcn `Table` inside a `Card`, following
`organisms/settings/sync-history.tsx:8-15`, which is the same shape of surface: a
chronological, newest-first, owner-scoped log. Rows are whole-row links. The
empty state is a plain muted paragraph, never a spinner and never an error.

#### 5. The entry point

**File**: `src/components/organisms/settings/recap-settings-form.tsx`

**Intent**: The history is unreachable without a link from the page that owns
the concept.

**Contract**: A link to `/settings/recap/history` next to the existing last-send
card (`:122-129`). No new state, no change to the form's action path.

#### 6. Demo fixture

**Files**: `src/lib/demo/fixture.ts`, `src/lib/demo/load.integration.test.ts`

**Intent**: A history list with one row demonstrates nothing, and US-02 asks the
demo to show the product's value in one sitting.

**Contract**: Extend the single `daily_recap` insert (`fixture.ts:774-799`) to
roughly five rows across the demo sprint's frozen-clock window: distinct
`recap_day` values that respect `daily_recap_owner_day_uq`, mostly `SENT` with
full `payload` + `rendered_message`, and **one `FAILED`** with a non-null payload
so the failure row is legible rather than blank. Keep every row terminal — the
reasoning at `fixture.ts:782-787` (a PENDING demo row is a frozen-clock
regression) applies to all of them. Extend the load assertion to the new count.

#### 7. The manual checklist

**Files**: `context/changes/recap-history/MANUAL-CHECKLIST.md` (new),
`context/foundation/manual-test-backlog.md`

**Intent**: FR-019 is met at the end of THIS phase and Phase 4 is severable by
design, so the checklist cannot live in Phase 4 (plan-review F4) — cutting that
phase would leave the change with no checklist at all, while phases 1–3 carry
six manual rows, one of them reading a real account's history.

**Contract**: Create the checklist here with the 3–5 rows that gate phases 1–3,
each carrying route, click-by-click steps, an observable pass condition and the
defect it catches, signed off with the phase number: (1) `\d daily_recap` shows
the reshaped FK; (2) a full cron cycle logs a purge count and every other step
still completes; (3) the history list and a drill-in render for the real
account; (4) another account's recap id returns 404; (5) demo shows several
recaps including the failed one. Everything else moves to
`manual-test-backlog.md` §1 with the reason it was deprioritized. Run
`node scripts/manual-test-sweep.mjs` and act on it.

### Success Criteria:

#### Automated Verification:

- New unit tests: `describeRecapRow` covers sent, failed-retryable,
  failed-exhausted, pending-in-flight and pending-stalled
- Existing `recap-settings-view.test.ts` passes unchanged after `describeLastSend`
  is refactored onto the shared mapping
- New unit test: a payload whose `schemaVersion` is not the current one falls
  back to the row's own columns instead of rendering `undefined`
- New integration test: the demo load writes the expected number of recap rows,
  all terminal, with exactly one FAILED
- New integration test: a demo reset removes them all
- E2E suite still passes: `npm run test:e2e`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit suite passes: `npm test`
- Integration suite passes: `npm run test:integration`

#### Manual Verification:

- `/settings/recap` links to the history and the Daily recap tab stays highlighted
  on both new routes
- The list shows the real account's recaps newest-first with a readable status
- Opening a recap shows the message as it was sent, and its links are clickable
- Editing the URL to another account's recap id returns 404, not an empty page
- With demo data loaded, the list shows several recaps including the failed one

**Implementation Note**: After completing this phase and all automated
verification passes, pause for the human's confirmation before proceeding. FR-019
is met at the end of this phase; Phase 4 is severable.

---

## Phase 4: The Resend bounce and complaint webhook

### Overview

Close S-11's plan-review F6. A permanently bounced address or a spam complaint
stops the daily send, and the owner is told why.

### Changes Required:

#### 1. Schema and migration

**Files**: `src/db/schema.ts`, `src/db/migrations/0020_*.sql`

**Intent**: Record why the recap was turned off, so the owner does not switch it
straight back on into the same bounce loop.

**Contract**: Two nullable columns on `recap_settings` — `disabled_reason` text
and `disabled_at` timestamp — with a comment stating that a null reason and
`enabled: false` means the owner turned it off themselves. Its own migration,
deliberately separate from `0019`, so this phase remains severable. No backfill.

#### 2. The signature verifier

**Files**: `src/lib/recap/webhook-signature.ts`,
`src/lib/recap/webhook-signature.test.ts` (new)

**Intent**: The first signature verification in this repo. Hand-rolled on
`node:crypto`, matching the precedent set by `crypto.ts:14-17` (synchronous
`node:crypto` under `nodejs_compat`) and by `email.ts:1-6` (a raw client rather
than the vendor SDK).

**Contract**: A structural `type WebhookEnv = { RESEND_WEBHOOK_SECRET?: string }`
and a `resolveWebhookSecret(env)` that reads `env` first then `process.env` and
treats a blank string as absent, copying `anthropic.ts:56-60`. A
`WebhookConfigError` naming both provisioning routes, in the shape of
`crypto.ts:56-61`. Then `verifyResendSignature({ secret, id, timestamp, signature,
body, now, toleranceMs })` returning a discriminated result rather than throwing
on a bad signature — an invalid signature is an expected input, not an exception.
The signed content is:

```
`${svixId}.${svixTimestamp}.${rawBody}`
```

HMAC-SHA256 with the secret base64-decoded after stripping `whsec_`, compared
against each space-separated entry of the header whose scheme is `v1`, using
`timingSafeEqual` on equal-length buffers. Reject a timestamp outside the
tolerance window before comparing. Never place the secret or the body in an
error, a log line or a return value — the invariant `email.ts:19-23` states.

#### 3. Event handling and the disable path

**Files**: `src/lib/recap/webhook.ts`, `src/lib/recap/webhook.integration.test.ts` (new)

**Intent**: Turn a verified event into at most one owner-scoped upsert.

**Contract**: A narrow parser over the payload — `type`, and for a bounce
`data.bounce.type` and `data.to` — that accepts only `email.bounced` with
`bounce.type === "Permanent"` and `email.complained`, and treats everything else
as an ignorable event rather than an error. Then `disableRecapForAddress({ db,
address, reason, now })`: resolve the owner by a case-insensitive match on
`user.email` **excluding** rows where `demo_of` is not null (the exclusion
`scheduled.ts:60-67` already applies to the send path), and upsert
`recap_settings` on the owner-unique constraint setting `enabled: false`,
`disabled_reason`, `disabled_at` — an upsert, not an update, because most owners
have no row (`recap-settings.ts:14-19`). Unknown address is a no-op that still
answers 200. Returns a small result the route can log without echoing the address.

#### 4. The route

**File**: `src/app/api/webhooks/resend/route.ts` (new)

**Intent**: The public endpoint, following the only existing route handler.

**Contract**: `export async function POST(request: Request)` with no `runtime`
and no `dynamic` export. `getCloudflareContext()` **inside** the function, per
the rule at `api/auth/[...all]/route.ts:5-11`. Read the body once with
`await request.text()` and hand those exact bytes to the verifier — parsing first
and re-serializing changes the bytes and every signature fails. Order: resolve
the secret (missing → 500 without touching the database, per `lessons.md` #6),
verify (bad or missing headers → 401), parse, act, 200. Use `getDbWithPool` with
`ctx.waitUntil(pool.end())` rather than the leaking `getDb`, copying
`scheduled.ts:92` and `:165` — the request path has no after-hook (`lessons.md`
#3, roadmap S-21). **Acquire it only after the signature verifies**, NOT at the
top of the handler the way `scheduled.ts:92` does (plan-review F5): this is the
repo's only public, unauthenticated, internet-reachable route, and a handle
opened first would cost a Hyperdrive connection per forged request. The 500 and
401 paths return before there is any database work to do. A duplicate delivery
must be harmless: the upsert is idempotent by construction.

#### 5. Make the route reachable

**File**: `middleware.ts`

**Intent**: Without this the endpoint is invisible — Resend gets a 302 to
`/login` and the whole phase silently does nothing.

**Contract**: Add `"/api/webhooks"` to `PUBLIC_PREFIXES` (`:26`), with a comment
saying the boundary for this prefix is the signature check, not the session —
nothing upstream authenticates it. Deliberately narrower than `/api`.

#### 6. Env plumbing

**Files**: `cloudflare-env.d.ts`, `.env.example`, `wrangler.jsonc`

**Intent**: One new secret, declared the way the other four are.

**Contract**: `RESEND_WEBHOOK_SECRET?: string` added to `CloudflareEnv`
(`cloudflare-env.d.ts`, after the existing Resend entries); a matching block in
the Resend section of `.env.example:34-43` following the established three-part
comment (where the value comes from, the `wrangler secret put` route with the
"vars resolve null" warning, and the local-dev behaviour when absent); and the
secrets note at `wrangler.jsonc:35-40` extended to name it. It must never appear
under `vars`.

#### 7. Tell the owner

**Files**: `src/lib/recap-settings.ts`,
`src/app/(app)/settings/recap/page.tsx`,
`src/components/organisms/settings/recap-settings-form.tsx`,
`src/components/organisms/settings/recap-settings-view.ts`

**Intent**: A switch that flipped itself is indistinguishable from a decision the
owner made months ago, and the first thing they will do is flip it back.

**Contract**: `src/lib/recap-settings.ts` is the ONLY read/write path to that
table and has to change on both sides (plan-review F1) — without it the page has
nothing to read and the explanation never clears:

- `RecapSettings` (`:26-31`) gains `disabledReason: string | null` and
  `disabledAt: Date | null`, and `getRecapSettings`'s select list (`:47-52`)
  gains both columns. `DEFAULT_RECAP_SETTINGS` carries them as null, which is
  the honest no-row state. The page keeps its single `Promise.all`
  (`page.tsx:28-32`) — a second query for two columns would be the fan-out
  `lessons.md` #3 rejects.
- `saveRecapSettings`'s conflict SET (`:85-90`) clears both columns **only on a
  save that sets `enabled: true`**, and leaves them untouched otherwise. The
  distinction is load-bearing: changing the send hour while the recap is off
  must not erase why it went off, and only a deliberate re-enable is the owner
  saying they have dealt with it.
- `sendDailyRecap` consumes `RecapSettings`; widening the type must leave that
  call site compiling with its behaviour unchanged — `enabled` stays the only
  field the send path reads.

The page then passes the two fields down; the pure sibling gains a
`describeAutoDisable(settings)` returning the message or null; the form renders it
as a shadcn `Alert` above the enable switch when present. The copy names what
happened (a permanent bounce, or a spam complaint), when, and what to fix before
re-enabling. No new action — re-enabling stays the existing save path.

#### 8. Operator steps, APPENDED to the existing checklist

**Files**: `context/changes/recap-history/MANUAL-CHECKLIST.md` (created in
Phase 3), `context/foundation/manual-test-backlog.md`

**Intent**: The webhook needs two things only the owner can do in the Resend
panel, and the checklist is where they are recorded. It already exists — Phase 3
created it, because this phase is severable (plan-review F4) — so this is an
append, never a rewrite.

**Contract**: Prepend the operator steps: create the endpoint in Resend pointing
at the deployed Worker's `/api/webhooks/resend`, subscribe `email.bounced` and
`email.complained`, copy the signing secret, and `wrangler secret put
RESEND_WEBHOOK_SECRET`. Then append two rows to the existing list: (1) a Resend
test delivery is accepted and a forged one is rejected; (2) a real send to
`bounced@resend.dev` disables the recap, `/settings/recap` explains why, and
re-enabling clears the message. Keeping the file at 3–5 gating rows may mean
demoting one of Phase 3's rows to `manual-test-backlog.md` §1 with its reason —
nothing is dropped quietly. Re-run `node scripts/manual-test-sweep.mjs` and act
on it before the closing commit.

### Success Criteria:

#### Automated Verification:

- New unit test: a valid signature passes and a tampered body fails
- New unit test: a timestamp outside the tolerance window fails even with an
  otherwise valid signature
- New unit test: a header carrying several space-separated signatures passes when
  any one matches
- New unit test: `resolveWebhookSecret` through the REAL resolver with an empty
  env reports the missing configuration (`lessons.md` #6)
- New unit test: the parser ignores `email.delivered` and a transient bounce, and
  accepts a Permanent bounce and a complaint
- New integration test: a Permanent bounce disables the recap for an owner with
  no `recap_settings` row (the upsert path)
- New integration test: a complaint sets the reason and timestamp
- New integration test: an unknown address is a no-op
- New integration test: a demo owner's address is never disabled
- New integration test: a repeated delivery of the same event changes nothing
- New integration test: a save that sets `enabled: true` clears
  `disabled_reason` and `disabled_at`, and a save that only changes the send
  hour while disabled leaves both in place
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit suite passes: `npm test`
- Integration suite passes: `npm run test:integration`
- E2E suite still passes: `npm run test:e2e`
- The Worker bundle-size CI gate still passes

#### Manual Verification:

- The Resend endpoint is created, subscribed to both events, and its secret is
  set with `wrangler secret put`
- A test delivery from the Resend panel returns 200; the same body with a
  tampered signature returns 401
- A send to `bounced@resend.dev` turns the recap off and `/settings/recap`
  explains why
- Re-enabling the recap clears the explanation
- `MANUAL-CHECKLIST.md` is signed off in full

**Implementation Note**: This is the last phase. On completion, tick the
corresponding rows in `context/foundation/manual-test-backlog.md`, update the
S-12 rows in `context/foundation/roadmap.md` (both the slice section and the
tracking table), and set `change.md` `status: implemented`.

---

## Testing Strategy

### Unit Tests

- The retention cutoff arithmetic, including the timezone shift and both
  under-three-sprints cases.
- The recap row view-model, over all five status shapes.
- The Svix verifier: valid, tampered, expired, multi-signature, malformed header,
  and the missing-secret path through the real resolver.
- The webhook event parser's accept/ignore taxonomy.

### Integration Tests

- The `ON DELETE SET NULL` behaviour on a real sprint delete.
- `listRecaps` / `getRecap` ordering, scoping and cross-owner 404.
- The purge's boundary condition and owner scoping.
- The disable path's upsert-for-a-missing-row, demo exclusion, and idempotence,
  and the clear-on-re-enable semantics of `saveRecapSettings`.
- The demo fixture's recap rows and their removal on reset.

### Manual Testing Steps

1. Apply both migrations locally and inspect `daily_recap` and `recap_settings`.
2. Open `/settings/recap`, follow the link to the history, and open a recap.
3. Try another account's recap id in the URL and confirm a 404.
4. Load demo data and confirm the list shows several recaps including the failed
   one; reset and confirm they are gone.
5. After deploying, run the Resend panel's test delivery, then a real send to
   `bounced@resend.dev`.

## Performance Considerations

The listing rides `daily_recap_owner_day_uq(owner_id, recap_day)`, which already
supports both the equality on the owner and the ordering, so dropping the
sprint-scoped index costs nothing. The purge is one owner-scoped delete per cycle
against a table bounded to three sprints of daily rows — tens of rows per owner.
The webhook does at most two statements per event. `sprint` still has no
secondary index, but the retention path reads `sprint_measurement`, which has
`sprint_measurement_series_idx(owner_id, jira_project_id, start_date)`.

## Migration Notes

Two migrations, deliberately not merged. `0019` alters a table that now holds
production rows and must not delete any — the FK is dropped and recreated, which
briefly leaves the column unconstrained inside the transaction. `0020` adds two
nullable columns and exists only for Phase 4, so cutting that phase means not
running it rather than reverting it. Neither is reversible by a later migration
in this slice; a rollback is a restore.

## References

- Roadmap slice: `context/foundation/roadmap.md:345-360` and the tracking row `:541`
- PRD: FR-019 (`context/foundation/prd.md`), and the retention non-goal's S-23 amendment
- Upstream slice: `context/archive/2026-08-26-daily-recap-email/plan.md`, and its
  review's F5 (the cascade) and F6 (the bounce gap) in `reviews/plan-review.md`
- The column comment that specifies this slice: `src/db/schema.ts:996-1005`
- List→detail precedent: `src/app/(app)/refinement/runs/[runId]/page.tsx:16-19`,
  `src/lib/refinement/store.ts:15-29`
- Retention precedent: `src/lib/integrations/sync/run-sync.ts:325-353`
- Cron step precedent: `src/lib/integrations/sync/scheduled.ts:129-136`
- Resend webhook contract: verified against the live docs on 2026-08-29

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema reshape and the history readers

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase — 1855031
- [x] 1.2 Deleting a sprint row leaves the recaps with `sprint_id` NULL — 1855031
- [x] 1.3 `listRecaps` is newest-first, owner-scoped, limit-honouring — 1855031
- [x] 1.4 `getRecap` returns null for another owner's recap id — 1855031
- [x] 1.5 `getRecap` tolerates a row with NULL payload and rendered_message — 1855031
- [x] 1.6 Existing recap suites pass unchanged — 1855031
- [x] 1.7 Type checking passes — 1855031
- [x] 1.8 Linting passes — 1855031
- [x] 1.9 Unit suite passes — 1855031
- [x] 1.10 Integration suite passes — 1855031

#### Manual

- [x] 1.11 `\d daily_recap` shows nullable `sprint_id`, SET NULL, no sprint index — 1855031

### Phase 2: Retention cutoff and the purge

#### Automated

- [x] 2.1 Fewer than three recorded sprints resolves to no cutoff — ed51cf3
- [x] 2.2 The cutoff is the third-newest start day in the team's timezone — ed51cf3
- [x] 2.3 A third sprint with no start date resolves to no cutoff — ed51cf3
- [x] 2.4 Recaps strictly older than the cutoff are deleted; the boundary survives — ed51cf3
- [x] 2.5 The purge is owner-scoped — ed51cf3
- [x] 2.6 A throwing purge does not alter the cycle's other counters — ed51cf3
- [x] 2.7 Type checking passes — ed51cf3
- [x] 2.8 Linting passes — ed51cf3
- [x] 2.9 Unit suite passes — ed51cf3
- [x] 2.10 Integration suite passes — ed51cf3

#### Manual

- [ ] 2.11 A full real cron cycle logs a purge count and completes every other step

### Phase 3: The history surface and the demo fixture

#### Automated

- [x] 3.1 `describeRecapRow` covers all five status shapes
- [x] 3.2 `recap-settings-view.test.ts` passes unchanged after the refactor
- [x] 3.3 An unknown payload `schemaVersion` falls back to the row's own columns
- [x] 3.4 The demo load writes the expected recap rows, all terminal, one FAILED
- [x] 3.5 A demo reset removes them all
- [x] 3.6 E2E suite still passes
- [x] 3.7 Type checking passes
- [x] 3.8 Linting passes
- [x] 3.9 Unit suite passes
- [x] 3.10 Integration suite passes

#### Manual

- [ ] 3.11 `/settings/recap` links to the history; the tab stays highlighted
- [ ] 3.12 The list shows real recaps newest-first with a readable status
- [ ] 3.13 A recap opens and shows the message as it was sent
- [ ] 3.14 Another account's recap id returns 404
- [ ] 3.15 Demo shows several recaps including the failed one

### Phase 4: The Resend bounce and complaint webhook

#### Automated

- [ ] 4.1 A valid signature passes; a tampered body fails
- [ ] 4.2 A timestamp outside the tolerance window fails
- [ ] 4.3 A multi-signature header passes when any entry matches
- [ ] 4.4 The real resolver with an empty env reports the missing secret
- [ ] 4.5 The parser's accept/ignore taxonomy holds
- [ ] 4.6 A Permanent bounce disables an owner with no settings row
- [ ] 4.7 A complaint records the reason and timestamp
- [ ] 4.8 An unknown address is a no-op
- [ ] 4.9 A demo owner is never disabled
- [ ] 4.10 A repeated delivery changes nothing
- [ ] 4.11 Re-enabling clears the reason; an hour-only save while disabled does not
- [ ] 4.12 Type checking passes
- [ ] 4.13 Linting passes
- [ ] 4.14 Unit suite passes
- [ ] 4.15 Integration suite passes
- [ ] 4.16 E2E suite still passes
- [ ] 4.17 The Worker bundle-size CI gate still passes

#### Manual

- [ ] 4.18 The Resend endpoint exists, is subscribed to both events, secret is set
- [ ] 4.19 A panel test delivery returns 200; a tampered signature returns 401
- [ ] 4.20 A send to `bounced@resend.dev` disables the recap with an explanation
- [ ] 4.21 Re-enabling clears the explanation
- [ ] 4.22 `MANUAL-CHECKLIST.md` is signed off in full
