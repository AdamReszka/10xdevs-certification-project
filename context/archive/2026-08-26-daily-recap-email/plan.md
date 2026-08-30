# S-11 Daily Recap Email — Implementation Plan

## Overview

Build FR-018: a daily recap email carrying the day's anomalies, a team activity
summary, sprint progress, and the *same* one-line suggested action the Anomaly
Inbox shows. The send runs as a third step inside the existing 15-minute cron,
fires on the first tick at-or-after the owner's configured local send time, and
is made exactly-once by a database unique key rather than by application logic.

Two fold-ins ride along because this slice is the first thing that depends on
them: the `jira_project.timeZone` refresh gap (without it "15:00 local" silently
means 15:00 UTC for a between-sprints owner), and FR-001's password-reset email,
which has been a `console.log` stub since S-01 waiting for exactly this transport.

## Current State Analysis

Research (`research.md`) established that S-11 is less about new data than about
three missing guarantees. Verified independently against the code at `9986bc1`:

- **Every content input already exists and is headless.** `listAnomaliesForSprint`
  (`reader.ts:37-65`), `getActivityRollup` (`activity.ts:31`), `getBurndownSeries`
  (`burndown.ts:23`), `getSprintCapacity` (`capacity.ts:147`), `getActiveSprintRow`
  (`sprint.ts:19`), `getJiraTimeZone` (`time-zone-reader.ts:14`) all take
  `(db, ownerId, …)` with no request context — precisely so a cron can call them.
- **`daily_recap` is provisioned but completely unused** — zero reads, zero
  writes, zero imports anywhere in `src/`, `scripts/`, `e2e/`. The
  `recap_send_status` enum (`PENDING`/`SENT`/`FAILED`, `schema.ts:92-97`) is
  already declared.
- **`daily_recap` cannot express "one per owner per day".** It has two non-unique
  indexes and no unique constraint; `recap_date` is a *nullable* bare `timestamp`
  (`schema.ts:723`). Nullable-in-a-dedup-key is `lessons.md` #1 verbatim, and a
  `timestamp` cannot represent a local calendar day at all.
- **`sprint_id` is `NOT NULL`** (`schema.ts:718-720`) with a comment tying it to
  S-12's sprint-keyed purge, while `getActiveSprintRow` can legitimately return
  null between sprints.
- **The timezone gap is real.** `identity` is in scope at `run-sync.ts:645`, the
  `!chosenSprint` early return is at `:677-687`, and the `jiraProject.timeZone`
  write sits at `:721-728` *inside the transaction below it*. An owner with no
  active sprint never gets a zone persisted.
- **The divergence risk has a specific address.** The anomaly→view mapping is
  inline in the RSC at `dashboard/page.tsx:76-97`. Duplicating it in the email is
  how the two surfaces drift.
- **There is no outbound email of any kind.** `resend`, `nodemailer`,
  `react-email` are absent from `package.json` and the lockfile;
  `renderToStaticMarkup` appears nowhere.
- **`auth.ts:56-59` logs the password-reset link to the console** with a comment
  naming S-11 as the slice that replaces it, while `/reset` and `/reset/confirm`
  are fully built.

## Desired End State

An owner with Jira connected and an active sprint receives one email per local
day, at or shortly after the time they set on `/settings/recap`. The email lists
each ACTIVE anomaly with severity, description, context, the suggested action
read *verbatim off the row*, and a deep link where one exists; plus yesterday's
team activity and sprint progress. When there are no anomalies the email still
arrives and says so explicitly. The send survives a missed cron tick, a Worker
restart mid-send, and two overlapping `scheduled()` invocations without ever
producing a second email for the same day. `/settings/recap` shows when the last
recap went out and whether it succeeded. Requesting a password reset delivers a
real email instead of a server log line.

Verification: `npm run lint && npx tsc --noEmit && npm test && npm run test:integration`
all green, plus the manual checklist in `MANUAL-CHECKLIST.md`.

### Key Discoveries

- `src/lib/anomaly/suggested-action.ts:6-7` — the anti-divergence contract was
  written at S-06 time: the templates are *"Reused verbatim by the Daily Recap
  email (S-11) so the dashboard and email never diverge"*. The action string is
  **read off `anomaly.suggestedAction`**, never re-generated: the builders'
  inputs (elapsed hours, day counts) were computed against detection-time `now`
  and cannot be reproduced later.
- `src/lib/integrations/sync/scheduled.ts:81-97` — the per-owner try that
  isolates failures, with `runDetect` already running after `runOwner`. The recap
  belongs as a third step *inside* that try, reusing the same owner set and the
  same open pool.
- `src/lib/integrations/sync/run-sync.ts:210-271` — the lease pattern
  (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, then a
  `claimed_until` TTL deliberately under the cron interval). Research's verdict
  stands: **copy the pattern, do not reuse `sync_state`** — its `integration`
  pgEnum is used in five signatures, its `last_error` is rendered by the
  dashboard, and a third row per owner would surface in the UI as an
  "integration".
- `src/lib/github.ts:77-111` — the transport shape to copy: a headers helper, one
  private verb helper wrapping `fetch` in `try/catch → Unavailable`, and the rule
  that the caught network error is **not** attached as `cause` because its
  message could echo the request and leak the secret.
- `src/db/schema.ts:23-29` — `status_category` includes `DONE`, which is what the
  new "tickets moved to Done" reducer folds over in `jira_status_history`.
- `src/app/(app)/settings/absences/` — the reference settings surface: server page
  → one `getDb` handle → shared zod schema in `src/lib/validations/` → thin server
  action returning `{ ok: true } | ActionFailure` → service core taking
  `{ db, ownerId }`.

## What We're NOT Doing

- **No recap history UI.** Listing and drilling into past recaps is S-12
  (FR-019). This slice only writes rows shaped so S-12's sprint-scoped purge is a
  simple delete. The one exception is the single "last send" line on
  `/settings/recap`, which exists to answer "did it work at all".
- **No retention/purge.** Also S-12.
- **No per-developer activity matrix in the email.** Team rollup only — the PRD
  Guardrail forbids per-developer performance framing, and a "who did how much"
  table in an email is exactly that.
- **No recap for an owner without Jira.** The cron enumerates via
  `jira_project ⋈ github_credential` (`scheduled.ts:42-48`); without Jira there is
  no sprint, no anomalies and no timezone. Approved as a recorded decision in
  `change.md`, not left as an accident.
- **No recap on a day with no sprint row.** Skipped entirely; `sprint_id` stays
  `NOT NULL`.
- **No Slack/Teams/push.** PRD Non-Goals: the recap is email-only.
- **No change to the cron interval** and no second cron trigger.
- **No fix for the `MAX_OWNERS_PER_CYCLE` cursor claim** (`scheduled.ts:29-31`
  promises cursor-driven drain; `:77` is a plain `slice`). Unrelated to S-11 —
  file separately rather than widening this slice.
- **No email-verification gate, no unsubscribe/preference-centre.** `enabled: false`
  on `/settings/recap` is the off switch, and a `List-Unsubscribe` header points
  at it — but no preference page, and no double-opt-in.
- **No bounce or complaint handling** (plan-review F6). A 200 from Resend means
  *accepted*, not *delivered*, so a row marked `SENT` proves nothing about
  arrival. With `requireEmailVerification: false` (`auth.ts:52`) and
  `enabled` defaulting to true, a typo'd sign-up address gets mailed daily and
  hard-bounces daily, which is how a fresh domain's reputation dies and a Resend
  account gets suspended. Closing it means the Resend webhook endpoint plus a
  bounce→`enabled: false` path — a surface of its own, filed for S-12 alongside
  the recap history that would render it, not smuggled in here.

## Implementation Approach

Six phases, ordered so the riskiest external dependency is proven earliest with
the smallest possible surface.

Phases 1–2 build the storage and the transport. Phase 3 wires the transport to
password reset — the cheapest real consumer — so domain verification, DKIM and
the API key are proven to deliver an actual message before anything harder
depends on them. Phase 4 builds the content path, including the extraction that
makes email and inbox provably identical. Phase 5 adds scheduling and the
exactly-once guarantee. Phase 6 gives the owner the controls.

Two invariants hold throughout:

- **The database is the concurrency guard**, not the application. `unique(owner_id,
  recap_day)` plus a claim-first `INSERT … ON CONFLICT DO NOTHING RETURNING id`
  holds across a Worker restart mid-send in a way an in-process lease does not.
  This is how the rest of the repo does idempotency (`anomaly.dedupKey`,
  `sync_state`, `jira_status_history`).
- **The suggested action is copied, never recomputed.** Any code path that would
  call a `suggested-action.ts` builder from the recap is a bug.

## Critical Implementation Details

**The send-time predicate must read wall-clock time, not do arithmetic on
midnight.** The obvious implementation — `dayRangeInTimeZone(today, tz).from +
hour*3_600_000` — is wrong on DST-transition days, where local midnight + 15h is
14:00 or 16:00 local rather than 15:00. The correct primitive is to format `now`
into the team's zone and compare the wall-clock `(hour, minute)` directly. That
is a new helper next to `dayKeyInTimeZone`, using the same cached-`Intl.DateTimeFormat`
pattern (`day-bucket.ts:30-46`).

**`Idempotency-Key` must NOT include the attempt number, and every attempt must
send byte-identical content.** Resend's idempotency returns the original result
for a repeated key. If attempt 1 failed at the network layer *after* Resend
accepted the message, replaying `ownerId:recapDay` is what prevents a duplicate
email; adding an attempt suffix would send a second one. The DB unique key and
the Resend key guard different failure modes and both are needed.

The trap (plan-review F1): Resend rejects a repeated key carrying a **different
payload** with `409 invalid_idempotent_request`, and a key whose first request is
still in flight with `409 concurrent_idempotent_requests`. Keys expire after 24h,
which is comfortably longer than one day's retry window. A naive retry rebuilds
the payload from live DB state — and since `runDetect` runs on every 15-minute
tick immediately before the recap, the anomaly set, risk scores and activity
counts routinely change between attempts. The rendered HTML would differ, and
every retry would take a 409 instead of a send, in exactly the case retries exist
for. Therefore: **render once, store the bytes, and re-send the stored bytes on
every subsequent attempt.** Nothing on a retry path may call `renderRecapEmail`
again.

**The recap gets its own per-owner `try`, a sibling of the sync's — not a third
step inside it.** It must still run *after* `runDetect` so it observes the
anomalies detection just wrote, but nesting it inside the sync's `try` (as the
obvious reading of "a third step" suggests) means a throw from `runOwner` or
`runDetect` jumps straight to that catch and the recap is never reached at all —
its own inner `try/catch` never runs. Verified at `scheduled.ts:81-97`.

That failure mode points the wrong way (plan-review F3): an expired PAT, a Jira
401 or a Hyperdrive blip would silence the email for the whole day, and FR-018
exists precisely for the lead who is *not* at the dashboard to see the error
banner. The recap depends on none of it — every reader it calls is DB-only — so
the structure is two sequential per-owner `try` blocks: `try { runOwner;
runDetect } catch {…}` then `try { sendDailyRecap } catch {…}`. A Resend failure
is still not counted as a sync failure, and a sync failure no longer cancels the
recap. Note also that `run-sync.ts:90-91` records that sync errors are token-free
*by construction* — an invariant a third-party email error does not inherit, so
recap error logging must log `err.message` only, never the error object.

**A recap sent off a failed sync must say so.** The corollary of the above: when
the recap rides on stale cached data, the email carries the same signal the
dashboard does — last successful sync timestamp per integration, and a line
naming any integration currently in error. Silently mailing yesterday's picture
as today's is the PRD's graceful-degradation guardrail inverted.

**`lessons.md` #4 (cap and origin-check paginated loops carrying a secret) is
N/A** for a single-resource POST. Say so explicitly in the client's header
comment, the way `github.ts:646-647` and `jira.ts:706-709` do for their own
single-resource calls, rather than leaving it implicit.

---

## Phase 1: Schema, send-time storage, and the timezone fix

### Overview

Make the database capable of expressing "one recap per owner per local day" and
"this owner sends at this time", and close the timezone refresh gap that would
otherwise make every configured send time wrong for a between-sprints owner.

### Changes Required:

#### 1. Close the timezone refresh gap

**File**: `src/lib/integrations/sync/run-sync.ts`

**Intent**: Persist `jira_project.timeZone` for every successful Jira cycle, not
only for cycles that find a sprint. Today the write sits inside the transaction
below the `!chosenSprint` early return, so an owner between sprints never gets a
zone — and their "15:00 local" becomes 15:00 UTC.

**Contract**: Move the `jiraProject.timeZone` update out of the transaction at
`:721-728` and up to immediately after `validateCredentials` yields `identity`
(`:645`), before the reconcile. Keep the `and(eq(ownerId), eq(id))` predicate
verbatim — `ownerId` is asserted, not inherited (impl-review F9). Remove the now
duplicate write from the transaction body. A single-statement update outside a
transaction does not violate the reads-before-txn rule; it is not a network call.

#### 2. New `recap_settings` table

**File**: `src/db/schema.ts`

**Intent**: Give the configured send time a home. Deliberately **not** a column
on `user`: that table is contractually Better Auth's (`auth.ts:46,67-72`), a
hand-added column would be dropped by `@better-auth/cli generate`, and a NOT NULL
column without a DB default breaks the sign-up INSERT because `autoSignIn: true`
(`auth.ts:53-56`).

**Contract**: `recap_settings` — `id` text pk; `owner_id` text NOT NULL
references `user.id` on delete cascade; `send_hour` integer NOT NULL default 15;
`send_minute` integer NOT NULL default 0; `enabled` boolean NOT NULL default
true; `created_at`/`updated_at` timestamps following the `anomaly_settings`
shape. One `unique("recap_settings_owner_uq").on(ownerId)` — the singleton-per-owner
shape of `githubCredential`/`jiraCredential`/`jiraProject`. **No timezone column**:
`jiraProject.timeZone` is written 1:1 by every Jira cycle and read via
`getJiraTimeZone`; a second zone would drift.

#### 3. Reshape `daily_recap` into something dedupable

**File**: `src/db/schema.ts`

**Intent**: Replace the unusable nullable `recap_date` with a NOT NULL local day
key, add the unique constraint that makes the send exactly-once, and add the two
columns the retry/reclaim logic needs.

**Contract**:
- Add `recap_day` text NOT NULL — a `DayKey` (`YYYY-MM-DD` in the team's zone),
  matching the existing convention in `day-bucket.ts:17`.
- Drop `recap_date` and its index `daily_recap_date_idx`. Keeping both a
  nullable instant and a day key invites exactly the drift this slice exists to
  prevent.
- `send_status` becomes NOT NULL with default `'PENDING'`.
- Add `attempt_count` integer NOT NULL default 0.
- Add `last_attempt_at` timestamp (nullable) — the TTL that lets a PENDING row
  orphaned by a crashed invocation be reclaimed, mirroring `claimed_until`
  (`run-sync.ts:80-83`).
- Add `rendered_message` jsonb (nullable), `.$type<RenderedEmail>()` — the
  `{ subject, html, text }` actually handed to the transport, written *before*
  the first send and re-sent verbatim by every retry. This is what keeps the
  `Idempotency-Key` payload byte-identical across attempts (plan-review F1);
  without it Resend answers a retry with `409 invalid_idempotent_request`. Its
  type comes from `src/lib/recap/types.ts` alongside `RecapPayload`, by the same
  `import type`.
- Add `unique("daily_recap_owner_day_uq").on(ownerId, recapDay)`. **`sprint_id`
  is excluded from the key on purpose**: S-16's reconcile can create a new sprint
  row mid-cycle (`run-sync.ts:654-661`), so a key including it would let one local
  day produce two recaps.
- **Accepted consequence of keeping `sprint_id` NOT NULL + `ON DELETE CASCADE`**
  (plan-review F5): a Jira **project switch** deletes the owner's sprint rows
  (`connection-service.ts:405-411`, and the defensive twin at
  `jira-store.ts:257`), which cascades today's claim row away. The next tick
  re-claims and sends a **second email for the same local day**, and every stored
  recap for that sprint — the history S-12 exists to render — goes with it. Both
  are accepted here rather than fixed: the alternative is a nullable `sprint_id`
  with `ON DELETE SET NULL` and a purge keyed on `recap_day`, which reverses a
  decision `change.md` already records and belongs to S-12, where the retention
  logic actually lives. It is bounded to a deliberate, confirmed, destructive
  action, not to any ordinary cycle. What this slice owes it is honesty in the
  confirmation copy — see Phase 6, change #6.
- `payload` gains `.$type<RecapPayload>()` via an `import type` from
  `src/lib/recap/types.ts` (type-only — erased at compile time, so no runtime
  cycle through the schema module).
- Keep `daily_recap_owner_sprint_idx` — it is what S-12's sprint-scoped purge
  will use.

#### 4. Migration

**File**: `src/db/migrations/0009_*.sql` (generated by `npm run db:generate`)

**Intent**: Apply the two schema changes. `daily_recap` has never been written by
any code path, so the NOT NULL additions have no backfill to do — but the plan
should not *assume* an empty table on a developer machine.

**Contract**: Generate, then hand-edit following the `0008_flawless_veda.sql:2-7`
convention — a SQL comment stating the reasoning, and a `DELETE FROM daily_recap;`
guard statement placed before the NOT NULL adds, safe because no product code has
ever inserted into this table (verified: zero writes across `src/`, `scripts/`,
`e2e/`). Keep the `--> statement-breakpoint` separators — they are load-bearing.
`drizzle.config.ts:3-16` loads `.env.local` with `override: true`, so
`db:generate`/`db:migrate` default to local Supabase `127.0.0.1:54322`.

#### 5. Recap settings service core

**File**: `src/lib/recap-settings.ts`

**Intent**: Owner-scoped read/upsert of the send time, with defaults for an owner
who has never visited the settings page — the same "no row means defaults" shape
as `src/db/defaults.ts:6-11` for anomaly settings.

**Contract**: `getRecapSettings({ db, ownerId }): Promise<RecapSettings>` returns
`{ sendHour: 15, sendMinute: 0, enabled: true }` when no row exists.
`saveRecapSettings({ db, ownerId, input })` upserts on the owner-unique
constraint. Explicit `eq(recapSettings.ownerId, ownerId)` on every statement —
there is no RLS behind this.

#### 6. Shared validation schema

**File**: `src/lib/validations/recap.ts`

**Intent**: One source of truth for the send-time shape, imported by both the
client form and the server action, following `validations/absence.ts`.

**Contract**: `recapSettingsSchema` — `sendHour` int 0–23, `sendMinute` int 0–59,
`enabled` boolean. No server-only imports, so the client form can pull it without
dragging Node globals into the browser bundle.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npm run db:migrate`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Integration suite passes: `npm run test:integration`
- New integration test: a second `INSERT` into `daily_recap` with the same
  `(owner_id, recap_day)` is rejected by the unique constraint
- New integration test: `getRecapSettings` returns the 15:00 defaults for an
  owner with no row, and the stored values after `saveRecapSettings`
- New integration test: a Jira cycle that finds **no active sprint** still
  persists `jira_project.time_zone`

#### Manual Verification:

- `select * from recap_settings` and `\d daily_recap` on local Supabase show the
  intended shape (no `recap_date`, `recap_day` NOT NULL, unique on owner+day)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Email transport

### Overview

A Workers-native Resend client following the repo's two existing hand-rolled
`fetch` clients, plus a thin adapter so local development renders and logs the
recap without any API key at all. The key becomes configuration, not a
prerequisite.

### Changes Required:

#### 1. Env plumbing for `RESEND_API_KEY`

**Files**: `cloudflare-env.d.ts`, `src/worker.ts`, `.env.example`, `wrangler.jsonc`
(comment only)

**Intent**: Declare the secret at every point the codebase declares
`TOKEN_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`, so it resolves in both Workers
and Node.

**Contract**: Add `RESEND_API_KEY?: string` and `RESEND_FROM_ADDRESS?: string` to
`CloudflareEnv` and to `src/worker.ts`'s `Env` type; add both to `.env.example`
with the standard "Workers *secret*, never a `var`" note explaining
`wrangler.jsonc:35-42` (plain vars resolved to `null` in
`getCloudflareContext().env` on this OpenNext version). **`RESEND_FROM_ADDRESS`
is also a secret, not a var**, for that same resolution reason — not because it
is sensitive. Resolve as `env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY`,
the `crypto.ts:55` / `auth.ts:28-29` pattern.

#### 2. The Resend client

**File**: `src/lib/email.ts`

**Intent**: Send one message via `POST https://api.resend.com/emails` using raw
`fetch`, mapping transport and status failures onto two typed errors that never
carry the key.

**Contract**: `sendEmail(apiKey, message, opts?): Promise<{ id: string }>` where
`message = { from, to, subject, html, text, idempotencyKey? }` and
`EmailClientOpts = { baseUrl?; fetchImpl? }` — opts last and optional, mirroring
`GithubClientOpts` (`github.ts:23-27`). **Three** error classes, each with a
doc-comment ending *"Never carries the key."*; status interpolated into the
message, response body never. One private headers helper.

- `EmailAuthError` — 401 only.
- `EmailUnavailableError` — 429 / 5xx / network / unreadable JSON. **Retryable.**
- `EmailRequestError` — every other non-2xx, carrying `status` as a field.
  **Not retryable.** Resend's documented set for this endpoint reaches well past
  401/429/5xx: `400 invalid_idempotency_key`, `403` (the missing-`User-Agent`
  case named below), `409 invalid_idempotent_request` / `409
  concurrent_idempotent_requests`, `422`. Without this branch they would either
  fall through unmapped or, worse, be mistaken for transient and burn all three
  of the day's attempts against a misconfiguration that can never succeed.

`sendDailyRecap` reads the distinction: `EmailUnavailableError` leaves the row
retryable, `EmailRequestError` marks it `FAILED` with `attempt_count` set
straight to the cap, and a `409 concurrent_idempotent_requests` is the one 409
that means "in flight, come back later" rather than "give up".

The one non-obvious detail, and the easiest way to get this wrong:

```
// Resend returns 403 (error 1010) for requests with no User-Agent. The official
// SDKs set it automatically; a raw-fetch client must do it explicitly.
"User-Agent": "SprintFlow",
```

The `Idempotency-Key` header is set from `message.idempotencyKey` when present.
`message.headers?: Record<string, string>` passes caller-supplied headers through
(the recap uses it for `List-Unsubscribe`); the helper must never let a passed
header overwrite `Authorization`.
Header comment states that `lessons.md` #4 is N/A for a single-resource POST, and
that the caught network error is deliberately not attached as `cause`
(`github.ts:104-106`). Returns the provider message id — S-12's history wants it.

#### 3. Transport adapter

**File**: `src/lib/email-transport.ts`

**Intent**: Make the provider one implementation of a small interface so the
build never blocks on domain verification: production uses Resend, local
development without a key logs the rendered message instead.

**Contract**: `type EmailTransport = { send(message): Promise<{ id: string }> }`
and `resolveEmailTransport(env): EmailTransport`. With a key present → the Resend
transport. Without a key → in production, throw naming both provisioning routes
(`wrangler secret put RESEND_API_KEY` / `.env`), the `crypto.ts:56-61` house
style; outside production, a console transport that logs subject + recipient (and
never the body, which carries ticket titles). The `RESEND_API_BASE_URL` test
override lives here behind `if (process.env.NODE_ENV === "production") return
undefined;` — copy `setup/github/actions.ts:60-74` verbatim. That guard is
non-negotiable: a hostile override would forward the API key to another host.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- New unit tests: 401 → `EmailAuthError`; 429 and 500 → `EmailUnavailableError`;
  a throwing `fetchImpl` → `EmailUnavailableError` with no `cause`
- New unit tests: 400, 403, 409 and 422 → `EmailRequestError` carrying the
  status, and none of them classified as retryable
- New unit test: the outgoing request carries `User-Agent`, `Authorization:
  Bearer`, `Content-Type: application/json`, `Idempotency-Key` when supplied, and
  any caller-supplied `headers` — and a caller-supplied `Authorization` is ignored
- New unit test: **the API key appears in no thrown error's `message`, `stack`, or
  `cause`** for every failure branch
- New unit test: `resolveEmailTransport` throws in production with no key, and
  returns the console transport outside it
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- None — this phase has no user-visible surface. Delivery is proven in Phase 3.

**Implementation Note**: Pause for confirmation after automated verification.

---

## Phase 3: Password-reset email (closes FR-001)

### Overview

Replace the `console.log` stub at `auth.ts:56-59` with a real send. Placed here
deliberately: it is the cheapest possible consumer of the new transport, so the
Resend account, the `sprintflow.pl` domain verification, the DKIM records and the
API key are all proven to deliver an actual message before the recap's much
larger surface depends on them.

### Changes Required:

#### 1. Owner-provisioned Resend account and domain

**File**: none — a one-time operator task, recorded in `MANUAL-CHECKLIST.md`

**Intent**: `sprintflow.pl` is owned by the user with DNS already on Cloudflare
and no MX records set, so this is a dashboard task, not a registrar migration.

**Contract**: Create the Resend account, add `sprintflow.pl`, paste the
SPF/DKIM/DMARC records into Cloudflare DNS, then `wrangler secret put
RESEND_API_KEY` and `wrangler secret put RESEND_FROM_ADDRESS`. Until that is
done, local development uses the console transport and the phase's automated
criteria still pass.

#### 2. Wire `sendResetPassword` to the transport

**File**: `src/lib/auth.ts`

**Intent**: Deliver the reset link by email, closing the gap where FR-001's
"reset your password by email" is currently undelivered despite the whole UI
existing at `/reset` and `/reset/confirm`.

**Contract**: `AuthEnv` gains `RESEND_API_KEY?` / `RESEND_FROM_ADDRESS?`.
`sendResetPassword` resolves the transport and sends a minimal HTML + plain-text
message containing `url`. **The reset URL is a bearer secret**: keep the existing
`console.log` only on the no-key development path, and on a send failure log
`err.message` and the recipient only — never the URL, never the error object.

**Do not await the dispatch, and do not let a send failure propagate**
(plan-review F4). Better Auth's email-password documentation is explicit: *"To
prevent timing attacks, avoid awaiting the email dispatch directly, using
mechanisms like `waitUntil` on serverless platforms."* The reason bites here
specifically — `/request-password-reset` invokes `sendResetPassword` **only when
the user exists**, so a propagated failure turns the endpoint into an
account-enumeration oracle: an unknown address returns 200 instantly, a known one
returns an error, or simply takes a full Resend round-trip longer. It also puts a
third-party network call on the auth request path.

So: hand the send to `ctx.waitUntil(...)` from `getCloudflareContext()` — the
same idiom `scheduled.ts:100` already uses for pool teardown — with a
`.catch()` that logs recipient + `err.message` and swallows. The endpoint's
response and timing are then identical for every address. **Verify first that
`ctx` is reachable inside the `sendResetPassword` closure** from
`api/auth/[...all]/route.ts:15`; if it is not, fall back to a
fire-and-forget promise with the same `.catch()` rather than reintroducing the
await. The accepted cost, worth a comment: a failed reset email is invisible to
the user, so the server log is the only place it surfaces.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- New unit test: `sendResetPassword` calls the injected transport with the reset
  URL in the body and does not log it
- New unit test: a transport rejection inside `sendResetPassword` does **not**
  propagate — the handler resolves normally and the failure reaches the log only
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Full suite: `npm run test:integration`

#### Manual Verification:

- Resend dashboard shows `sprintflow.pl` verified (SPF, DKIM, DMARC green)
- On the deployed Worker, requesting a reset at `/reset` for a real address
  delivers an email from the `sprintflow.pl` sender, and its link signs the user
  in at `/reset/confirm`
- The Worker log for that request contains **no reset URL**

**Implementation Note**: Pause for confirmation. Do not start Phase 5 without a
verified domain — Phase 4 does not need it, but the recap's manual verification
does.

---

## Phase 4: Recap content — the divergence guard, the builder, the renderer

### Overview

Assemble the recap payload from the readers that already exist, extract the one
piece of logic trapped inside an RSC that would otherwise cause email/inbox
drift, add the one missing reducer, and render to HTML + plain text with a pure
`.ts` builder.

### Changes Required:

#### 1. Extract the anomaly→view mapping out of the RSC

**File**: `src/lib/anomaly/inbox-view.ts` (new), `src/app/(app)/dashboard/page.tsx`

**Intent**: This is the mechanism that discharges the roadmap's headline risk. The
mapping at `page.tsx:76-97` — including the `?? ""` defenses on the nullable
`suggestedAction`/`description` columns and the `anomalyIdentity` /
`anomalyContextChips` calls — becomes one pure function both surfaces call. Two
copies of this mapping would diverge invisibly, because both strings look
plausible.

**Contract**: `toInboxAnomalies(rows: AnomalyView[], memberNameById: Map<string,
string>): InboxAnomaly[]` — pure, DB-free, no React. `InboxAnomaly` is pulled in
with `import type` from `@/components/organisms/anomaly/types` (type-only, so the
lib module stays free of any component runtime). `dashboard/page.tsx` replaces
its inline `rows.map(...)` with a call to it; its behavior must not change. This
is CLAUDE.md's stated convention for decision logic inside a `.tsx` — there is no
component-test harness, so it has to live in a `.ts` sibling to be unit-testable.

#### 2. "Tickets moved to Done" — the one missing reducer

**File**: `src/lib/dashboard/activity-done.ts`

**Intent**: The PRD's activity summary lists tickets moved to Done, but
`ActivityCell` (`activity-grid.ts:14-28`) carries only commits, churn, PRs and
reviews, and nothing folds Done transitions. Built at **team** granularity only —
the PRD Guardrail forbids per-developer performance framing, and this ships in an
email where such a table would read as exactly that.

**Contract**: A pure `countTicketsMovedToDone(transitions, { from, to }): number`
over `{ ticketId, toCategory, changedAt }`, counting **distinct tickets** whose
`to_category` is `'DONE'` within the range (a ticket bounced out of and back into
Done on the same day counts once), plus a thin owner-scoped reader
`getTicketsMovedToDone(db, ownerId, { from, to })` over `jira_status_history`,
shaped to the existing `(ticket_id, changed_at)` index and joined to
`jira_ticket` for the owner scope. Same table `burndown.ts:82-98` already reads.

#### 3. Recap payload types

**File**: `src/lib/recap/types.ts`

**Intent**: The stored snapshot's shape, defined once. S-12 renders its
drill-down from this, so it must carry everything the email showed rather than
pointing at rows that may later be RESOLVED or purged with their sprint.

**Contract**: `RecapPayload` — `{ schemaVersion: 1; generatedAt: string; dayKey:
string; timeZone: string | null; sprint: { name, dayNumber, totalDays,
committedSp, remainingSp, byCategory }; activity: { commits, additions,
deletions, prsOpened, prsMerged, reviews, ticketsMovedToDone }; syncState: {
GITHUB: { lastSuccessfulSyncAt: string | null; status }; JIRA: { same } };
anomalies: Array<{ id, type, severity, description, suggestedAction, sourceUrl,
identityLabel, memberName, riskScore }> }`. Type-only module (no runtime imports) so
`src/db/schema.ts` can apply `.$type<RecapPayload>()` to the `payload` column.
`schemaVersion` is cheap now and is what lets S-12 read old rows after this shape
changes.

The same module also exports `RenderedEmail = { subject: string; html: string;
text: string }` — the frozen bytes stored on the claim row and re-sent verbatim by
every retry (plan-review F1), and the return type of `renderRecapEmail`.

#### 4. Payload builder

**File**: `src/lib/recap/build.ts`

**Intent**: One owner-scoped read pass producing the payload, reusing every
existing reader.

**Contract**: `buildRecapPayload({ db, ownerId, now, timeZone, sprint }):
Promise<RecapPayload>`. Resolves the zone and the sprint **once in the caller and
passes them down** — `getActivityRollup` re-reads the zone internally
(`activity.ts:36-40`) and `getSprintCapacity` re-resolves the sprint
(`capacity.ts:151`), so a naive composition does the same work three times per
owner. Batches its reads into one `Promise.all` on one handle (lesson #3), the way
both dashboard pages do. `suggestedAction` is copied off the row; nothing in this
module may import `suggested-action.ts`. Activity covers the previous local day,
built with `dayRangeInTimeZone`, matching Today's "Yesterday's Activity".

`syncState` comes from `getSyncState(db, ownerId)` — the same reader
`dashboard/page.tsx:61` already uses — folded into the same `Promise.all`. It is
in the payload because the recap now runs even when this tick's sync failed
(plan-review F3), so the email must be able to say which integration is stale.
Only `lastSuccessfulSyncAt` and `status` cross over; **`lastError` must not**, for
the same reason `InboxIntegrationState` withholds it from the client
(`dashboard/page.tsx:100-102`).

#### 5. HTML escaping

**File**: `src/lib/recap/escape-html.ts`

**Intent**: Ticket summaries (`jira.ts:910`), PR titles (`github.ts:574`) and
developer names flow from external APIs straight into the email body. There is no
escaping precedent in the repo because there is no HTML-string precedent.

**Contract**: `escapeHtml(value: string): string` covering `& < > " '`, ampersand
first. Its own unit test.

#### 6. The renderer

**File**: `src/lib/recap/render.ts`

**Intent**: Produce the email. A pure `.ts` string builder rather than
`react-dom/server`: the hermetic unit project is `include: ["src/**/*.test.ts"]`
(`vitest.config.ts:19`) — `.ts` only — and email HTML wants table-based,
inline-styled markup that React buys nothing for.

**Contract**: `renderRecapEmail(payload: RecapPayload): { subject: string; html:
string; text: string }`. Table-based layout with inline styles, no external
assets, no `<script>`. Every interpolated external string passes through
`escapeHtml`. Three branches the template must handle from day one:

- **An anomaly with `sourceUrl === null`** — renders as plain text, not a dead
  link. Not theoretical: this project's own live account currently has a
  `DEVELOPER_INACTIVE` anomaly with `source_url` NULL, so it is in the very first
  email this system will ever send. (4 of the 10 emit branches produce null:
  `developer-inactive.ts:74`, `scope-creep.ts:41`, `sprint-at-risk.ts:78/111/184`.)
- **Zero anomalies** — an explicit "no anomalies detected today" block, never an
  empty section. `lessons.md` #6: an empty result that reads as success is the
  failure mode; the reader must be able to tell "nothing found" from "failed to
  look".
- **Null line churn** — rendered as `—`, never `0`. Null is not zero: an
  over-cap commit keeps NULL churn permanently (`activity-grid.ts:18-24`), and a
  `0` would claim we measured an empty commit.
- **A stale or failing integration** — a footer line carrying each integration's
  last successful sync time, and, when `status` is not OK, an explicit banner
  naming which one is failing. Since the recap now sends even on a tick where the
  sync threw (plan-review F3), an email with no such line would present cached
  data as current — the PRD's graceful-degradation guardrail run backwards. Never
  render `lastError`.

Severity ordering in the email must **preserve the reader's order**
(`reader.ts:12-15`, which leans on the Postgres enum declaration order) — never
re-sort alphabetically, which would put HIGH after `LOW`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- New unit test: `toInboxAnomalies` maps null `suggestedAction`/`description` to
  `""` and preserves input order
- New unit test: the recap's anomaly action strings are **identical** to the
  `AnomalyView` rows' `suggestedAction` — the anti-divergence guard
- New unit tests: `escapeHtml` neutralizes `<script>`, quotes and ampersands; a
  ticket title containing markup renders escaped in the HTML body
- New unit tests: renderer covers the four branches — null `sourceUrl`, zero
  anomalies, null churn, a non-OK integration status
- New unit test: the renderer never emits `lastError` anywhere in the HTML or
  text body
- New unit test: renderer output preserves HIGH → MEDIUM → LOW order
- New unit tests: `countTicketsMovedToDone` counts distinct tickets and respects
  the range boundaries
- New integration test: `getTicketsMovedToDone` is owner-scoped (a second owner's
  transitions are not counted)
- New integration test: `buildRecapPayload` against seeded data produces a
  payload whose anomaly list matches `listAnomaliesForSprint`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Dashboard "Today" renders identically to before the extraction (same anomalies,
  same order, same context chips)

**Implementation Note**: Pause for confirmation after automated verification.

---

## Phase 5: Scheduling, exactly-once send, cron wiring

### Overview

Decide when to send, guarantee one email per owner per local day across restarts
and overlapping invocations, retry a transient failure within the day, and hang
the whole thing off the cron that already runs.

### Changes Required:

#### 1. Local wall-clock helper

**File**: `src/lib/dashboard/day-bucket.ts`

**Intent**: The send predicate needs the team's local hour and minute. There is no
local-time-of-day helper — `day-bucket.ts` is day-granularity only — and the
tempting alternative (local midnight + `hour × 3_600_000`) is wrong on DST
transition days.

**Contract**: `localTimeOfDay(date, timeZone?): { hour: number; minute: number }`,
formatting through a cached `Intl.DateTimeFormat` with `hourCycle: "h23"`, reusing
the existing formatter-cache pattern at `:30-46` and the same `safeZone` fallback.

#### 2. The due predicate

**File**: `src/lib/recap/due.ts`

**Intent**: Answer "should this owner get a recap on this tick?", pure and
therefore exhaustively unit-testable against DST, disabled settings, and an
already-sent day.

**Contract**: `isRecapDue({ now, timeZone, sendHour, sendMinute, enabled }):
{ due: boolean; dayKey: DayKey; reason }`. Due when `enabled` and the local
wall-clock `(hour, minute) >= (sendHour, sendMinute)`. **"At or after", not
"crosses"** — approved decision: a missed tick, a Worker restart, or a settings
change at noon must still produce that day's recap rather than silently losing
it. Whether it was *already* sent is not this function's business; that is the
claim's job, which is what makes the predicate safe to be this permissive.

Accepted consequence, worth a comment: an owner who sets 08:00 and connects Jira
at 14:00 receives a recap immediately rather than the next morning.

#### 3. Claim-first send

**File**: `src/lib/recap/send.ts`

**Intent**: The database is the concurrency guard. Claim the day's slot before
doing any work, so a Worker restart mid-send cannot produce a second email.

**Contract**: `sendDailyRecap({ db, ownerId, env, now, deps? }): Promise<
{ status: "SENT" | "SKIPPED" | "FAILED"; reason?: string }>`, deps injectable
(`transport`, `buildRecapPayload`, `now`) so it is testable without a Workers
runtime — the `runScheduledSync` convention.

Sequence:
1. Read settings, timezone, sprint. **No sprint → `SKIPPED("no_sprint")`** —
   approved decision; `sprint_id` is NOT NULL and cannot store the row.
2. `isRecapDue` → not due → `SKIPPED("not_due")`.
3. **Claim**: `INSERT INTO daily_recap (…, send_status='PENDING', attempt_count=1,
   last_attempt_at=now) … ON CONFLICT (owner_id, recap_day) DO NOTHING RETURNING
   id`. A returned id means this invocation owns today's send.
4. **Empty result** → a row exists; re-read it and branch:
   - `SENT` → `SKIPPED("already_sent")`.
   - `PENDING` with `last_attempt_at` within the 10-minute TTL → another
     invocation owns it → `SKIPPED("in_flight")`.
   - `FAILED`, or a `PENDING` older than the TTL, **and** `attempt_count < 3` →
     reclaim with a guarded update: `UPDATE … SET send_status='PENDING',
     attempt_count = attempt_count + 1, last_attempt_at = now WHERE id = ? AND
     attempt_count < 3 AND send_status = <the status just read> RETURNING id`.
     An empty result means another invocation won the race — `SKIPPED`.
   - `attempt_count >= 3` → `SKIPPED("attempts_exhausted")`. Three tries, then
     silence until tomorrow: enough to ride out a 429 or a restart, few enough
     that a permanent misconfiguration does not generate ~96 failed calls a day
     per owner.
   The TTL is 10 minutes, deliberately under the 15-minute cron so a crashed run
   self-recovers on the next fire — the `LEASE_TTL_MS` reasoning at
   `run-sync.ts:80-83`.
5. **Render once, then freeze.** If the claimed row already carries a
   `rendered_message` (this is a retry), skip `buildRecapPayload` and
   `renderRecapEmail` entirely and re-send those stored bytes. Otherwise build,
   render, and persist `payload` + `rendered_message` + `anomaly_ids` in a single
   `UPDATE` **before** calling the transport. Recipient is the owner's
   `user.email`; `idempotencyKey` is `${ownerId}:${recapDay}` with **no attempt
   suffix** (see Critical Implementation Details).

   The send carries `List-Unsubscribe: <${BETTER_AUTH_URL}/settings/recap>` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (plan-review F6). One
   header pair, no new surface, and it does not reopen the preference-centre
   scope this slice excluded — but it is what keeps a recipient reaching for
   "spam" instead of an off switch from burning a two-week-old domain's
   reputation. Both headers are part of the frozen bytes, so they are identical
   across retries.

   The persist-before-send ordering is load-bearing, not tidiness: it is what
   makes attempt 2 and attempt 3 byte-identical to attempt 1, which is the only
   thing that keeps the `Idempotency-Key` usable instead of 409-ing. Accepted
   consequence, worth a comment: a retry reports the picture as of the first
   attempt, not the current one — correct for a document titled "your recap for
   <day>".
6. Success → `UPDATE … SET send_status='SENT', sent_at=now`. Failure → `UPDATE …
   SET send_status='FAILED'`; `attempt_count` was already incremented at claim
   time, so a crash between the send and this update still counts against the
   cap. A `409 concurrent_idempotent_requests` means another attempt is mid-flight
   at Resend — treat it as `SKIPPED("in_flight")`, never as a failure to retry.

#### 4. Cron wiring

**File**: `src/lib/integrations/sync/scheduled.ts`, `src/worker.ts`

**Intent**: Run the recap once per owner after `runDetect`, so it observes the
anomalies detection just wrote and reuses the same owner set and the same open
pool — but in a `try` of its own, so a sync failure cannot cancel it.

**Contract**: Add `sendDailyRecap` to the injectable `deps`. Inside the per-owner
loop, split the existing single `try` into two sequential ones:

```
for (const ownerId of batch) {
  try { await runOwner(…); await runDetect(…); synced += 1; }
  catch (err) { failed += 1; console.error(…, err.message); }

  // Sibling, not nested (plan-review F3): the recap reads only cached DB state,
  // so a sync or detect throw must not silence the day's email — that is exactly
  // the case the off-hours lead cannot see any other way.
  try { if (await sendDailyRecap(…) === "SENT") recapsSent += 1; }
  catch (err) { console.error(…, err.message); }
}
```

A Resend failure is still not counted as a sync failure (`actions.ts:90-97` is
the mirror). `ScheduledSyncResult` gains `recapsSent: number`. Error logging must
use `err.message` only — never the error object: `run-sync.ts:90-91` records that
sync errors are token-free *by construction*, and a third-party email error does
not inherit that invariant. `ScheduledEnv` and `src/worker.ts`'s `Env` gain the
two Resend fields.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- New unit tests: `localTimeOfDay` is correct across a DST spring-forward and
  fall-back day in `Europe/Warsaw`, and for a half-hour zone (`Asia/Kolkata`)
- New unit tests: `isRecapDue` — before the time, exactly at it, after it,
  `enabled: false`, and a null timezone falling back to the `safeZone` default
- New integration test: two concurrent `sendDailyRecap` calls for the same owner
  and day produce **exactly one** transport call and one `SENT` row
- New integration test: a `FAILED` row is retried on the next call, and stops
  after the third attempt with `attempt_count = 3`
- New integration test: a `PENDING` row with a stale `last_attempt_at` is
  reclaimed; a fresh one is not
- New integration test: an owner with no sprint row gets `SKIPPED("no_sprint")`
  and no `daily_recap` row
- New integration test: an owner with `enabled: false` is skipped
- New integration test: a retry after a failed send re-sends the **stored**
  `rendered_message` byte-for-byte and does not call `renderRecapEmail` again,
  even when the anomaly set changed between attempts
- New unit test: a transport throw inside `runScheduledSync` leaves `failed` at 0
  and does not abort the batch
- New unit test: a `runOwner` throw still reaches `sendDailyRecap` for that owner
  — the sibling-try guarantee, and the one that stops a broken integration from
  silencing the email
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Integration suite passes: `npm run test:integration`

#### Manual Verification:

- On the deployed Worker, a real recap arrives for the project's own account and
  its anomaly list + suggested actions match `/dashboard` exactly, including the
  `DEVELOPER_INACTIVE` row rendering with no deep link
- The next cron tick after a delivered recap sends **no second email**

**Implementation Note**: Pause for confirmation after automated verification.

---

## Phase 6: `/settings/recap` surface

### Overview

Give the owner the send-time controls FR-018 requires, plus the one line that
answers "did it actually work". Follows `settings/absences/` exactly.

### Changes Required:

#### 1. Tab entry

**File**: `src/app/(app)/settings/layout.tsx`

**Intent**: Reach the new page from the settings shell.

**Contract**: Add `{ label: "Daily recap", href: "/settings/recap" }` to `TABS`
(`:18-23`), before the reserved S-14 slot comment.

#### 2. Server page

**File**: `src/app/(app)/settings/recap/page.tsx`

**Intent**: Load the settings, the team timezone, and the last send in one pass
and hand plain data to the client organism.

**Contract**: `requireSession()` → `getCloudflareContext()` → `getDb(env)`; one
`Promise.all` over `getRecapSettings`, `getJiraTimeZone`, `getLastRecap`. Dates
serialized to strings across the RSC boundary. Inherits `requireSession()` +
`force-dynamic` from `(app)/layout.tsx` — do **not** re-declare either.

#### 3. Last-send reader

**File**: `src/lib/recap-settings.ts` (extend)

**Intent**: The single "did it work" signal, deliberately a pull surface on the
page the owner is already on rather than a dashboard banner — a recap failure
must not dilute the US-01 integration-error banner, which has a specific meaning.

**Contract**: `getLastRecap({ db, ownerId }): Promise<{ recapDay, sendStatus,
sentAt, attemptCount } | null>` — newest `recap_day` first, owner-scoped, no
payload column (it is kilobytes and the page does not render it).

#### 4. Server action

**File**: `src/app/(app)/settings/recap/actions.ts`

**Intent**: Persist the settings. Thin, mirroring `settings/absences/actions.ts`.

**Contract**: `saveRecapSettingsAction(input: unknown)` → `requireSession()` →
`recapSettingsSchema.safeParse` → service core → `{ ok: true } | ActionFailure`
with the shared `{ ok: false, error, message }` shape. One `toFailure` mapper
that logs only the unexpected branch. **No detection re-run** — unlike the
absence actions, the send time affects nothing already computed.

#### 5. Client organism + its pure sibling

**Files**: `src/components/organisms/settings/recap-settings-form.tsx`,
`src/components/organisms/settings/recap-settings-view.ts`

**Intent**: The form, plus the display logic extracted so it can be unit-tested —
there is no component-test harness (CLAUDE.md).

**Contract**: The `.tsx` is built from shadcn/ui primitives (look them up via the
`@shadcn` MCP server before implementing; add with `npx shadcn add <name>`),
`toast` + `router.refresh()` on success (there is no `revalidatePath` anywhere in
this repo). The `.ts` sibling holds `describeLastSend(row, timeZone)` and the
send-time hint string.

**The hint is load-bearing, not decoration.** The cron resolution is 15 minutes
(`wrangler.jsonc:12-14`), so the system cannot honour a minute exactly. The field
is labelled as the **earliest** send time, with helper text stating that
SprintFlow checks every 15 minutes and the recap arrives at or shortly after the
chosen time. Shipping a minute picker that silently rounds would be a defect;
saying so makes it a documented bound.

The timezone is displayed **read-only** from `jira_project.timeZone`, with a note
when it is null that the recap uses UTC until the next Jira sync — never an
editable second zone, which would drift.

#### 6. Widen the project-switch confirmation copy

**File**: `src/components/organisms/settings/jira-project-editor.tsx`

**Intent**: The destructive confirmation at `:78-82` (and the post-switch notice
at `:109`) enumerates what a project switch destroys — "the sprints, tickets, and
status history synced from …". As of this slice that list is incomplete:
`daily_recap` cascades off `sprint`, so the owner's recap archive goes too
(plan-review F5). A confirmation that undersells what it deletes is the defect.

**Contract**: Add "daily recaps" to both strings. Copy change only — no logic, no
new state. Update the module's header comment at `:25-27`, which enumerates the
same FK chain, so the next reader sees `daily_recap` in it.

#### 7. Manual checklist

**File**: `context/changes/daily-recap-email/MANUAL-CHECKLIST.md`

**Intent**: The short list of what genuinely blocks the slice — 3–5 rows, each
with route, click-by-click steps, an observable pass condition, and the defect it
catches (CLAUDE.md). Everything else goes to
`context/foundation/manual-test-backlog.md` §1 with the reason it was
deprioritized.

**Contract**: Five rows — (1) Resend domain verified and password reset delivers
a real email; (2) the first real recap arrives and its actions match the
dashboard **including the null-`source_url` anomaly**; (3) the next tick sends no
duplicate; (4) changing the send time on `/settings/recap` persists and the last-send
line updates; (5) `enabled: false` stops the send.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- New unit tests: `recapSettingsSchema` rejects hour 24, minute 60, and negatives
- New unit tests: `describeLastSend` covers never-sent, sent-today, and failed
- New integration test: `saveRecapSettingsAction`'s service core is owner-scoped
  (owner A's save does not touch owner B's row)
- New integration test: `getLastRecap` returns the newest row and null for an
  owner with none
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Integration suite passes: `npm run test:integration`
- E2E suite still passes: `npm run test:e2e`

#### Manual Verification:

- The Jira project-switch confirmation names daily recaps among what it destroys
- `/settings/recap` is reachable from the settings tabs and renders the current
  values
- Changing the time and saving shows a toast, and the value survives a reload
- The last-send line reflects the most recent recap (or says none has been sent)
- Turning the recap off stops the next day's send
- The full `MANUAL-CHECKLIST.md` is signed off

**Implementation Note**: This is the last phase. On completion, tick the
corresponding rows in `context/foundation/manual-test-backlog.md` and set
`change.md` `status: implemented`.

---

## Testing Strategy

### Unit Tests

- `escapeHtml` — the five entities, ampersand-first ordering
- `renderRecapEmail` — null `sourceUrl`, zero anomalies, null churn, a non-OK
  integration status, severity order preserved, external strings escaped,
  `lastError` never emitted
- `toInboxAnomalies` — null coalescing, order preservation
- `localTimeOfDay` — DST both directions, half-hour zone, null zone fallback
- `isRecapDue` — boundary at exactly the configured minute, disabled, null zone
- `countTicketsMovedToDone` — distinct-ticket counting, range boundaries
- `sendEmail` — status→error mapping across all three classes (401, 429/5xx,
  400/403/409/422), required headers, **key absent from every error surface**
- `resolveEmailTransport` — production-without-key throws, base-URL override
  refused in production
- `recapSettingsSchema`, `describeLastSend`

### Integration Tests

Against real local Postgres (`vitest.integration.config.ts`, which refuses any
`DATABASE_URL` that is not `127.0.0.1:54322`):

- The unique constraint rejects a duplicate `(owner_id, recap_day)`
- Concurrent `sendDailyRecap` → exactly one transport call, one `SENT` row
- Retry cap: FAILED → retried → stops at `attempt_count = 3`
- A retry re-sends the stored `rendered_message` unchanged even when the anomaly
  set moved between attempts (the `Idempotency-Key` 409 guard)
- Stale-PENDING reclaim vs. fresh-PENDING skip
- `no_sprint`, `enabled: false`, `already_sent` skip paths
- `buildRecapPayload` matches `listAnomaliesForSprint`
- Owner-scoping on `getTicketsMovedToDone`, `getLastRecap`, `saveRecapSettings`
- A Jira cycle with no active sprint still persists `jira_project.time_zone`

### Mutation Testing

No change. `stryker.conf.json` is scoped to the anomaly rules with `break: 70`
and wins by filename precedence over the stale `stryker.config.json`. Do not
rename either file — that silently changes what is mutated.

### Manual Testing Steps

Live in `MANUAL-CHECKLIST.md` (Phase 6, change #7). The one that cannot be
skipped is the first real send: it is the only proof that domain verification,
DKIM and the API key line up, and this project's live account already carries a
`DEVELOPER_INACTIVE` anomaly with a NULL `source_url`, so the no-deep-link branch
is exercised by the very first email.

## Performance Considerations

- **Subrequests are a non-issue for this slice.** One email per owner is ≤50
  subrequests per cycle against a 10,000 ceiling. The real budget pressure
  predates S-11 — `run-sync.ts:101-115` quantifies ~92–460 subrequests *per owner*
  for GitHub — and this slice does not move that needle.
- **Resend rate-limits at 10 requests/second per team.** A 50-owner burst can
  exceed it. The loop is serialized on one DB connection (`max: 1`), which
  probably paces it, but that is an accident rather than a guarantee — hence the
  retry path, which turns a 429 into a delayed recap rather than a lost one.
- **Resolve the zone and the sprint once per owner and pass them down.**
  `getActivityRollup` re-reads the zone internally (`activity.ts:36-40`) and
  `getSprintCapacity` re-resolves the sprint (`capacity.ts:151`); a naive
  composition triples that work per owner per cycle.
- **The payload snapshot costs a few KB of JSONB per owner per day.** Bounded by
  S-12's retention (current + 2 previous sprints) once that lands.

## Migration Notes

- One migration (`0009_*`) covering both the new table and the `daily_recap`
  reshape. `daily_recap` has never been written by product code, so the NOT NULL
  additions have no real backfill; the hand-edited `DELETE FROM daily_recap;`
  guard exists only to keep a developer's stale row from failing the migration.
- CI applies migrations on every PR (`ci.yml:37-47`: supabase start → `db:migrate`
  → integration suite), so a broken migration fails the `integration` job rather
  than reaching production.
- Rollback: the change is additive apart from dropping the never-written
  `recap_date` column and its index. Reverting means dropping `recap_settings`
  and the added `daily_recap` columns; no data is at risk because no data exists.

## References

- Research: `context/changes/daily-recap-email/research.md`
- Scope decisions: `context/changes/daily-recap-email/change.md`
- Roadmap: `context/foundation/roadmap.md` (S-11), PRD FR-018 (+ FR-001 fold-in)
- Reference settings surface: `src/app/(app)/settings/absences/`
- Reference transport: `src/lib/github.ts:77-111`
- Reference lease: `src/lib/integrations/sync/run-sync.ts:210-271`
- Lessons: `context/foundation/lessons.md` #1 (nullable dedup key), #3 (pool
  teardown), #4 (N/A here — single-resource POST), #6 (empty result reads as
  success)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, send-time storage, and the timezone fix

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase: `npm run db:migrate` — 1478a80
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 1478a80
- [x] 1.3 Linting passes: `npm run lint` — 1478a80
- [x] 1.4 Unit tests pass: `npm test` — 1478a80
- [x] 1.5 Integration suite passes: `npm run test:integration` — 1478a80
- [x] 1.6 Integration test: duplicate `(owner_id, recap_day)` insert is rejected — 1478a80
- [x] 1.7 Integration test: `getRecapSettings` defaults + `saveRecapSettings` round-trip — 1478a80
- [x] 1.8 Integration test: a no-active-sprint Jira cycle still persists `jira_project.time_zone` — 1478a80

#### Manual

- [x] 1.9 `\d daily_recap` and `recap_settings` show the intended shape on local Supabase — manual 2026-08-30

### Phase 2: Email transport

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 3b43323
- [x] 2.2 Unit tests: 401 → `EmailAuthError`; 429/500/network → `EmailUnavailableError`, no `cause` — 3b43323
- [x] 2.3 Unit tests: 400/403/409/422 → non-retryable `EmailRequestError` carrying the status — 3b43323
- [x] 2.4 Unit test: request carries `User-Agent`, `Authorization`, `Content-Type`, `Idempotency-Key`, caller headers; a caller `Authorization` is ignored — 3b43323
- [x] 2.5 Unit test: the API key appears in no error `message`, `stack`, or `cause` — 3b43323
- [x] 2.6 Unit test: `resolveEmailTransport` throws in production without a key, console transport otherwise — 3b43323
- [x] 2.7 Type checking passes: `npx tsc --noEmit` — 3b43323
- [x] 2.8 Linting passes: `npm run lint` — 3b43323

### Phase 3: Password-reset email (closes FR-001)

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — f32aea7
- [x] 3.2 Unit test: `sendResetPassword` sends the URL via the transport and does not log it — f32aea7
- [x] 3.3 Unit test: a transport rejection does not propagate out of `sendResetPassword` — f32aea7
- [x] 3.4 Type checking passes: `npx tsc --noEmit` — f32aea7
- [x] 3.5 Linting passes: `npm run lint` — f32aea7
- [x] 3.6 Integration suite passes: `npm run test:integration` — f32aea7

#### Manual

- [ ] 3.7 Resend dashboard shows `sprintflow.pl` verified (SPF, DKIM, DMARC)
- [ ] 3.8 A real reset request delivers an email whose link signs the user in at `/reset/confirm`
- [ ] 3.9 The Worker log for that request contains no reset URL

### Phase 4: Recap content — the divergence guard, the builder, the renderer

#### Automated

- [x] 4.1 Unit tests pass: `npm test` — c51fe6b
- [x] 4.2 Unit test: `toInboxAnomalies` null-coalesces and preserves order — c51fe6b
- [x] 4.3 Unit test: recap action strings are identical to the `AnomalyView` rows' — c51fe6b
- [x] 4.4 Unit tests: `escapeHtml` neutralizes markup, quotes and ampersands — c51fe6b
- [x] 4.5 Unit tests: renderer covers null `sourceUrl`, zero anomalies, null churn, non-OK integration status — c51fe6b
- [x] 4.6 Unit test: the renderer never emits `lastError` in the HTML or text body — c51fe6b
- [x] 4.7 Unit test: renderer preserves HIGH → MEDIUM → LOW order — c51fe6b
- [x] 4.8 Unit tests: `countTicketsMovedToDone` distinct-ticket counting and range bounds — c51fe6b
- [x] 4.9 Integration test: `getTicketsMovedToDone` is owner-scoped — c51fe6b
- [x] 4.10 Integration test: `buildRecapPayload` matches `listAnomaliesForSprint` — c51fe6b
- [x] 4.11 Type checking passes: `npx tsc --noEmit` — c51fe6b
- [x] 4.12 Linting passes: `npm run lint` — c51fe6b

#### Manual

- [x] 4.13 Dashboard "Today" renders identically after the mapping extraction — manual 2026-08-30

### Phase 5: Scheduling, exactly-once send, cron wiring

#### Automated

- [x] 5.1 Unit tests pass: `npm test` — 6adcb2d
- [x] 5.2 Unit tests: `localTimeOfDay` across DST both directions and a half-hour zone — 6adcb2d
- [x] 5.3 Unit tests: `isRecapDue` boundaries, disabled, null zone — 6adcb2d
- [x] 5.4 Integration test: concurrent sends produce exactly one transport call and one `SENT` row — 6adcb2d
- [x] 5.5 Integration test: FAILED retries and stops at `attempt_count = 3` — 6adcb2d
- [x] 5.6 Integration test: stale PENDING reclaimed, fresh PENDING skipped — 6adcb2d
- [x] 5.7 Integration test: an owner with no sprint row is `SKIPPED("no_sprint")` and no row is written — 6adcb2d
- [x] 5.8 Integration test: an owner with `enabled: false` is skipped — 6adcb2d
- [x] 5.9 Integration test: a retry re-sends the stored `rendered_message` byte-for-byte and does not re-render — 6adcb2d
- [x] 5.10 Unit test: a transport throw leaves `runScheduledSync`'s `failed` at 0 — 6adcb2d
- [x] 5.11 Unit test: a `runOwner` throw still reaches `sendDailyRecap` for that owner — 6adcb2d
- [x] 5.12 Type checking passes: `npx tsc --noEmit` — 6adcb2d
- [x] 5.13 Linting passes: `npm run lint` — 6adcb2d
- [x] 5.14 Integration suite passes: `npm run test:integration` — 6adcb2d

#### Manual

- [ ] 5.15 A real recap arrives and matches `/dashboard`, including the null-`source_url` anomaly
- [ ] 5.16 The next cron tick sends no second email

### Phase 6: `/settings/recap` surface

#### Automated

- [x] 6.1 Unit tests pass: `npm test` — 38f049d
- [x] 6.2 Unit tests: `recapSettingsSchema` rejects hour 24, minute 60, negatives — 38f049d
- [x] 6.3 Unit tests: `describeLastSend` covers never-sent, sent, failed — 38f049d
- [x] 6.4 Integration test: `saveRecapSettings` is owner-scoped — 38f049d
- [x] 6.5 Integration test: `getLastRecap` newest-first and null when none — 38f049d
- [x] 6.6 Type checking passes: `npx tsc --noEmit` — 38f049d
- [x] 6.7 Linting passes: `npm run lint` — 38f049d
- [x] 6.8 Integration suite passes: `npm run test:integration` — 38f049d
- [x] 6.9 E2E suite passes: `npm run test:e2e` — 38f049d

#### Manual

- [ ] 6.10 The Jira project-switch confirmation names daily recaps among what it destroys
- [ ] 6.11 `/settings/recap` reachable from the tabs and renders current values
- [ ] 6.12 Changing the time saves, toasts, and survives a reload
- [ ] 6.13 The last-send line reflects the most recent recap
- [ ] 6.14 Turning the recap off stops the next day's send
- [ ] 6.15 `MANUAL-CHECKLIST.md` fully signed off
