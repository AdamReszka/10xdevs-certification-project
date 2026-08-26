---
date: 2026-08-26T10:29:22+02:00
researcher: Adam Reszka
git_commit: ce9173bc582d835de2181f4e4f85271b7e9437a0
branch: feat/s11-daily-recap-email
repository: AdamReszka/10xdevs-certification-project
topic: "S-11 daily-recap-email — what exists, what is missing, and what will bite"
tags: [research, codebase, daily-recap-email, s11, fr-018, resend, cron, idempotency]
status: complete
last_updated: 2026-08-26
last_updated_by: Adam Reszka
---

# Research: S-11 daily-recap-email

**Date**: 2026-08-26T10:29:22+02:00
**Researcher**: Adam Reszka
**Git Commit**: `ce9173b`
**Branch**: `feat/s11-daily-recap-email`
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

What does S-11 (FR-018, daily recap email) actually have to build? Specifically:
which data and machinery already exist and are reusable headlessly; how a
time-of-day send fits a 15-minute cron; what guarantees "one recap per owner per
day"; where the user-configured send time lives; and what conventions a new
Resend client must follow.

## Summary

**S-11 is less about new data and more about three missing guarantees.** Nearly
every input the email needs is already computed, headless-safe, and explicitly
earmarked for this slice — S-06 even wrote the S-11 contract into its own source.
What does not exist is (1) a DB-level idempotency key, (2) a home for the
configured send time, and (3) any email transport at all.

Five findings dominate the plan:

1. **The anti-divergence mechanism already exists and is already named.**
   `suggested-action.ts:6-7` says the templates are *"Reused verbatim by the Daily
   Recap email (S-11) so the dashboard and email never diverge"*, and
   `reader.ts:9-10` says `listAnomaliesForSprint` is *"the data surface S-07
   renders and S-11's recap email reuses"*. The roadmap's headline risk is
   discharged by **reading `anomaly.suggestedAction` off the row** — never by
   re-calling the builders, whose inputs (elapsed hours, day counts) are computed
   at detection time against `now` and cannot be reproduced later.

2. **Nothing prevents sending the same recap ~36 times a day.** `daily_recap`
   (`schema.ts:711-733`) has **zero unique constraints**; `recap_date` is
   nullable *and* a bare `timestamp`. With `*/15 * * * *`, a naive "local time is
   past 15:00 → send" predicate fires on every remaining tick. This is
   `lessons.md` #1 in its exact original shape, and the schema author already
   applied that lesson to `anomaly.dedupKey` (migration 0004) but not here.

3. **A pre-existing timezone gap makes "15:00 local" silently mean 15:00 UTC**
   for a between-sprints owner. Verified directly: `validateCredentials` yields
   `identity.timeZone` at `run-sync.ts:645`, the `!chosenSprint` early return is
   at `:677-687`, and the `jira_project.timeZone` write sits at `:721-728` inside
   the transaction *below* it. So an owner with no active sprint never gets a
   zone persisted. Pre-S-16 the return sat even earlier (above
   `validateCredentials`), so this is not an S-16 regression — but S-16 put
   `identity` in scope at the return, which makes the fix a one-liner.

4. **FR-001 has a latent hole that this slice's transport closes.**
   `src/lib/auth.ts:56-59` logs the password-reset link to the server console
   instead of emailing it, with the comment *"Reset email transport is S-01/S-11"*.
   The entire reset UI exists (`/reset`, `/reset/confirm`). So "reset your
   password by email" is, today, not delivered.

5. **`daily_recap` is completely unused** — zero reads, zero writes, zero
   imports across `src/`, `scripts/`, `e2e/`. S-11 is a greenfield write path
   against a table F-02 provisioned two months early.

## Detailed Findings

### Anomaly content — reusable as-is

`listAnomaliesForSprint(db, ownerId, sprintId)` (`src/lib/anomaly/reader.ts:37-65`)
returns `AnomalyView[]` in FR-015 default order (severity HIGH→MEDIUM→LOW, then
`detectedAt` desc) and is request-context-free. Its severity ordering leans on the
Postgres enum declaration order (`schema.ts:44`), documented at `reader.ts:12-15`
— **a recap that re-sorts in JS must replicate that order explicitly, never sort
alphabetically.**

At schema level only `severity`, `type`, `dedupKey`, `ownerId`, `sprintId` are
NOT NULL; `suggestedAction`, `description`, `sourceUrl`, `riskScore` are all
nullable (`schema.ts:659-664`). In practice `detect.ts:75-85` writes all of them
unconditionally and `DetectedAnomaly` (`anomaly/types.ts:59-72`) types them
non-optional, so every engine-written row has them. The one path that bypasses
the engine is `scripts/seed-dashboard.mjs:384-393`, which inserts fixtures by raw
SQL — today all ten supply an action, but a future edit could land a NULL. The
dashboard already defends with `?? ""` (`dashboard/page.tsx:82-83`); the email
should too.

**`sourceUrl` is null for 4 of the 10 emit branches** —
`developer-inactive.ts:74`, `scope-creep.ts:41`, `sprint-at-risk.ts:78/111/184`.
The template must render an anomaly with no deep-link.

### Activity, progress, capacity — reusable, with one gap

All headless (`(db, ownerId, …)`), no request context:

| What | Where |
|---|---|
| `getActivityRollup(db, ownerId, {from,to})` | `src/lib/dashboard/activity.ts:31` |
| `getBurndownSeries(db, ownerId, sprintId, now)` | `src/lib/dashboard/burndown.ts:23` |
| `getSprintCapacity(db, ownerId)` / pure `computeSprintCapacity` | `capacity.ts:147` / `:68` |
| `getActiveSprintRow(db, ownerId)` | `src/lib/sprint.ts:19` |
| `getJiraTimeZone(db, ownerId)` | `src/lib/dashboard/time-zone-reader.ts:14` |
| `dayKeyInTimeZone` / `dayRangeInTimeZone` / `enumerateDayKeys` (pure) | `day-bucket.ts:48/66/105` |
| `anomalyIdentity` / `anomalyContextChips` (pure, no React) | `anomaly/context.ts:146/183` |

**Gap — "tickets moved to Done" does not exist.** The PRD's Yesterday's Activity
wording lists it, but `ActivityCell` (`activity-grid.ts:14-28`) carries only
`commits, additions, deletions, prsOpened, prsMerged, reviews`, and a repo-wide
grep for `ticketsDone`/`movedToDone` returns nothing. The data is in
`jiraStatusHistory` (already read by `burndown.ts:82-98`) but nothing folds it
per-day per-person. Either the recap omits it, or this is new work — a plan call.

**Not reusable: the dashboard page itself.** `dashboard/page.tsx` calls
`requireSession()` (`:38` → `next/headers`) and `getDb(env)` (`:40`). Both
dashboard pages carry explicit comments that `getDbWithPool` "is the sync/cron
path only" (`page.tsx:33-34`). The anomaly→view prop mapping at `page.tsx:76-97`
is inline in the RSC — **if the email is to be provably identical to the inbox,
that mapping must be extracted to a pure `.ts` sibling**, which is the repo's
stated convention for exactly this reason (CLAUDE.md).

Efficiency notes for a 50-owner loop: `getActivityRollup` re-reads the timezone
internally (`activity.ts:36-40`) while the caller also reads it via
`getJiraTimeZone` — resolve once per owner and pass down. `getSprintCapacity`
re-resolves the sprint internally (`capacity.ts:151`). Both dashboard pages
deliberately batch all reads into one `Promise.all` on one handle (lesson #3).

### The cron seam

`wrangler.jsonc:12-14` (`*/15 * * * *`) → `src/worker.ts:38-42` → `runScheduledSync`
(`scheduled.ts:60`). The loop enumerates owners with one join
(`scheduled.ts:42-48`), caps at `MAX_OWNERS_PER_CYCLE = 50` (`:31`), isolates
per-owner failures (`:81-97`), and closes the pool in `finally` via
`ctx.waitUntil(pool.end())` (`:100-104`, lesson #3).

**A recap send belongs as a third step inside that existing per-owner try, after
`runDetect`** — not as a second pass. It reuses the same owner set, the same open
pool (`max: 1`), and must observe the anomalies detection just wrote.

**Subrequest cost is a non-issue**: one email is ≤50 subrequests per cycle
against a 10,000 ceiling. The real budget risk predates S-11 — `run-sync.ts:101-115`
quantifies ~92–460 subrequests *per owner* for GitHub, so 50 owners already
threatens the ceiling. S-11 does not move that needle.

Two things to get right in the loop: a Resend failure must **not** be counted as
a sync failure (wrap it in its own try/catch, mirroring `actions.ts:90-97`), and
error logging must be careful — `run-sync.ts:90-91` notes sync errors are
token-free *by construction*, an invariant a third-party email error does not
inherit.

Aside, unrelated to S-11 but worth filing: `MAX_OWNERS_PER_CYCLE`'s comment claims
overflow "drains on the next fire (cursor-driven)", but `scheduled.ts:77` is a
plain `slice(0, 50)` with no cursor — owners 51+ are never reached.

### Scheduling: the due-check is the wrong predicate

`acquireLease` (`run-sync.ts:210-271`) is a genuinely good pattern —
`INSERT … ON CONFLICT DO NOTHING` to guarantee the row, then `SELECT … FOR UPDATE`
inside a transaction so overlapping fires serialize, then a `claimed_until` TTL
(`LEASE_TTL_MS = 10 min`, deliberately under the 15-min cron so a crashed run
self-recovers, `run-sync.ts:80-83`).

But its **due-check is a minute interval** (`run-sync.ts:248-254`,
`freshnessWindowMinutes` default 15), and a time-of-day recap needs a different
predicate entirely. Worse, with a 15-min window against a 15-min cron, a fire
arriving a second early skips the whole slot and pushes the effective cadence to
30 minutes — acceptable for freshness, fatal for "send at 15:00".

Reusing `sync_state`/`sync_attempt` outright also costs more than it looks:
`integration` is a pgEnum `["GITHUB","JIRA"]` (`schema.ts:62`) used in five
signatures, so it needs an additive `ALTER TYPE`; `sync_state.last_error` is free
text that the dashboard renders, and a Resend error is untrusted third-party
text; and the dashboard's freshness banner reads `sync_state`, so a third row per
owner would surface as an "integration" in the UI. **Copy the lease pattern;
do not reuse the table.**

There is **no local-time-of-day helper** — `day-bucket.ts` is day-granularity
only. But `dayRangeInTimeZone(todayKey, tz).from` is the true local-midnight
instant, so `from + configuredHour` is DST-correct and needs no new primitive.

### Idempotency — the load-bearing gap

`daily_recap` (`schema.ts:711-733`, DDL `migrations/0001_…sql:56-66`) has two
non-unique indexes and **no unique constraint**. Consequences:

- `ON CONFLICT DO NOTHING` is not expressible — there is nothing to conflict on.
- A check-then-insert guard is not atomic against overlapping `scheduled()`
  invocations, which is the very hazard `claimed_until` exists for.
- Adding `unique(owner_id, recap_date)` as-is would still fail: `recap_date` is
  nullable (lesson #1 verbatim) and a `timestamp` cannot represent a *local
  calendar day*.
- **`sprint_id` must be excluded from the dedup key.** S-16's reconcile can create
  a new sprint row mid-cycle (`reconcile-sprint.ts`, one-cycle window documented
  at `run-sync.ts:654-661`), so a key including `sprint_id` would let one local
  day produce two recaps, one per sprint.
- A `FAILED` send must stay retryable, so the rule is "one *row* per owner per
  day whose status transitions in place", not "one row only if it succeeded".

**Recommended shape (a plan decision, not settled here):** add a NOT NULL
`recap_day` holding the `DayKey` (`YYYY-MM-DD` in the team's zone, matching the
existing `DayKey` convention), add `unique(owner_id, recap_day)`, and write
**claim-first**: insert with `sendStatus: 'PENDING'` … `ON CONFLICT DO NOTHING
RETURNING id`; an empty result means another invocation owns today's send. Then
send, then flip the status. This makes the database the concurrency guard, which
holds across a Worker restart mid-send in a way an in-process lease does not.

Note `sprint_id` is NOT NULL while `getActiveSprintRow` can return null — so
**S-11 must decide whether a recap is skipped entirely when no sprint row
exists**, because it cannot be stored otherwise.

### Where the send time lives

There is no per-owner preferences table anywhere (23 tables enumerated;
`anomalySettings` is keyed `(owner, anomalyType)` and has no row at all for a
fresh account per `src/db/defaults.ts:6-11`).

**A new owner-unique `recap_settings` table is the recommendation**, matching the
singleton-per-owner shape of `githubCredential`/`jiraCredential`/`jiraProject`.

**Not a column on `user`.** That table is contractually owned by Better Auth:
`auth.ts:46` wires `drizzleAdapter(db, { schema })` and `auth.ts:67-72` documents
the static export as existing for `@better-auth/cli generate`, so a hand-added
column would be dropped by a regeneration. Extra columns must be declared as
`user.additionalFields`, and a NOT NULL column without a DB default breaks the
sign-up INSERT — which fires immediately because `autoSignIn: true`
(`auth.ts:53-56`).

**Do not add a timezone column.** `jiraProject.timeZone` is already written 1:1
by every Jira cycle and read via `getJiraTimeZone`; a second zone would drift.
Which makes finding #3 above load-bearing rather than cosmetic.

Also open: the cron's enumeration inner-joins `jira_project`
(`scheduled.ts:42-48`), so **an owner without Jira is never enumerated and would
never receive a recap.** Deliberate decision required.

### The Resend client — conventions to copy

The repo has two hand-rolled `fetch` clients and no SDKs. `src/lib/github.ts:5-8`
records *why* (bundle size; Octokit crashes on Workers globals). Resend has a
fixed host, so it matches the **GitHub** shape: `baseUrl?` inside an opts object.

- Injectable transport: `type EmailClientOpts = { baseUrl?; fetchImpl? }`, opts
  always the last optional parameter, resolved at the top of each function
  (`github.ts:100`, `jira.ts:216`).
- One private POST helper mirroring `githubGet` (`github.ts:95-111`): headers
  helper + `try/catch → Unavailable`, returning the raw `Response`. The caught
  network error is deliberately **not** attached as `cause`, because its message
  could echo the request and leak the key (`github.ts:104-106`).
- Exactly two error classes — `EmailAuthError` for 401 only, `EmailUnavailableError`
  for 429/5xx/network/unreadable-JSON — each doc-comment ending *"Never carries
  the key."* Status interpolated into the message, response body never.
- Lesson #4 (pagination cap + origin check) is **N/A for a single-resource POST**
  — say so explicitly in the header, as `github.ts:646-647` and `jira.ts:706-709`
  do for their own single-resource calls, rather than leaving it implicit.
- Return the provider message id — S-12's history will want it.

**Resend specifics confirmed against the vendor docs (2026-08-26):**

- `POST https://api.resend.com/emails`, `Authorization: Bearer`, `Content-Type: application/json`.
- **A `User-Agent` header is required for direct HTTP calls** — without it Resend
  returns 403 (error 1010). The SDKs add it automatically; a raw-`fetch` client
  must set it explicitly. This is the single easiest way to get this wrong.
- **`Idempotency-Key` header** is supported for safe retries — complements the DB
  unique key rather than replacing it.
- Rate limit **10 requests/second per team**, 429 above it. A 50-owner burst can
  exceed this; the loop is serialized on one DB connection, which probably paces
  it anyway, but the plan should not rely on that accident.
- `onboarding@resend.dev` **can only send to the account owner's own address**.
  Anything else needs a verified domain — which is why `sprintflow.pl` matters.
- Test addresses `delivered@resend.dev`, `bounced@resend.dev`,
  `complained@resend.dev`, `suppressed@resend.dev` simulate outcomes without
  touching domain reputation.
- Free tier: **3,000/month, 100/day, 3 domains, 30-day retention.**

### Secrets

`RESEND_API_KEY` must be a **Workers secret**, never a `vars` entry —
`wrangler.jsonc:35-42` records that plain vars resolved to `null` in
`getCloudflareContext().env` on this OpenNext version, which is why
`BETTER_AUTH_SECRET` is a secret. Add it to `cloudflare-env.d.ts`, to
`src/worker.ts`'s `Env` type, and to `.env.example` with the standard note.
Resolve as `env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY`
(`crypto.ts:55`, `auth.ts:28-29`), fail loud in production naming both
provisioning routes (`crypto.ts:56-61` is the house style).

**Do not route it through `crypto.ts`/`credentials.ts`.** That path binds a
ciphertext to `{ownerId, provider}` via GCM AAD (`crypto.ts:32-36,73-75`) and
`provider` must match the `integration` pgEnum (`github-store.ts:32`). An
app-level secret has no owning row. `TOKEN_ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET` are the correct precedent.

A `RESEND_API_BASE_URL` test override belongs in the action/service layer behind
`if (process.env.NODE_ENV === "production") return undefined;` — copy
`setup/github/actions.ts:60-74` verbatim. The production guard is non-negotiable:
a hostile override would forward the API key to another host.

### Rendering

**No HTML-string precedent exists** — `renderToStaticMarkup`/`renderToString`
appear nowhere; every `<table>`/`<html>` in the repo is JSX. `resend`,
`react-email`, `@react-email/*` and `nodemailer` are absent from both
`package.json` and `package-lock.json`.

`react-dom@19.2.4` is installed and its `./server` export map does carry a
`workerd` condition, so `react-dom/server` is technically available with zero new
dependencies. But the hermetic unit project is `include: ["src/**/*.test.ts"]`
(`vitest.config.ts:19`) — `.ts` only — and CLAUDE.md requires decision logic in a
`.tsx` to be extracted to a pure `.ts` sibling because there is no component-test
harness. **A pure `.ts` string renderer is the shape that fits**, and email HTML
wants table-based inline-styled markup that React buys nothing for.

That makes **HTML escaping a new concern with no precedent**: ticket summaries
(`jira.ts:910`), PR titles (`github.ts:574`) and developer names all flow from
external APIs into the body. A pure `escapeHtml` with its own unit test belongs
in the plan.

### Settings surface pattern

If S-11 ships a settings UI, the pattern is fixed and well-documented. Add one
entry to `TABS` in `settings/layout.tsx:18-23` (which already carries a reserved
slot comment for S-14). Then: server page does `requireSession()` →
`getCloudflareContext()` → `getDb(env)`, one handle, no `force-dynamic`
re-declaration, dates serialized to strings across the RSC boundary; a shared zod
schema in `src/lib/validations/` imported by both the client form and the action;
a thin Server Action returning `{ ok: true } | ActionFailure` with one `toFailure`
mapper that logs only the unexpected branch; a service core taking
`{ db, ownerId }` with explicit `eq(table.ownerId, ownerId)` on every statement;
`toast` + `router.refresh()` on success (there is no `revalidatePath` anywhere).
`settings/absences/` is the reference implementation.

### Migrations

`drizzle.config.ts:3-16` loads `.env.local` with `override: true` **after**
`.env`, so `db:generate`/`db:migrate` default to local Supabase `127.0.0.1:54322`
— a deliberate safety rail. Migrations are committed (9 so far, `0000`–`0008`)
and CI applies them (`ci.yml:37-47`: supabase start → `db:migrate` → integration
suite). The convention for a backfill is **generate, then hand-edit**:
`migrations/0008_flawless_veda.sql:2-7` has an `UPDATE … WHERE IS NULL` inserted
between the generated `SET DEFAULT` and `SET NOT NULL`, with the reasoning in a
SQL comment. `--> statement-breakpoint` separators are load-bearing.

## Code References

- `src/lib/anomaly/suggested-action.ts:6-7` — the S-11 anti-divergence contract, written at S-06 time
- `src/lib/anomaly/reader.ts:9-10,37-65` — the headless inbox reader, already naming S-11 as consumer
- `src/db/schema.ts:711-733` — `daily_recap`, no unique constraint, `recap_date` nullable
- `src/db/schema.ts:62` — `integration` pgEnum `["GITHUB","JIRA"]`
- `src/lib/integrations/sync/run-sync.ts:210-271` — the lease pattern worth copying
- `src/lib/integrations/sync/run-sync.ts:645` vs `:677-687` vs `:721-728` — the timezone refresh gap
- `src/lib/integrations/sync/scheduled.ts:31,42-48,81-104` — cap, enumeration, per-owner isolation, pool teardown
- `src/lib/dashboard/day-bucket.ts:48,66,105` — DST-safe day keys and ranges
- `src/lib/auth.ts:53-59` — `autoSignIn: true`, and the password-reset console stub naming S-11
- `src/lib/github.ts:95-111,104-106` — the transport helper and the no-token-in-`cause` rule
- `wrangler.jsonc:35-42` — why secrets, not `vars`
- `vitest.config.ts:19` — `.ts`-only unit include, which shapes the renderer
- `src/app/(app)/settings/absences/` — the reference settings surface

## Architecture Insights

- **The codebase anticipated this slice.** Three separate modules
  (`suggested-action.ts`, `reader.ts`, `anomaly/context.ts:62-68`) carry comments
  written *for* S-11, and F-02 provisioned `daily_recap` long before it was
  needed. The plan's job is mostly to honour decisions already recorded, not to
  invent.
- **Request-context-free service cores are the load-bearing convention.** Almost
  everything the recap needs takes `(db, ownerId, …)` precisely so a cron can
  call it. The exceptions are the RSC pages — and the one piece of logic trapped
  inside one (the anomaly→view mapping) is exactly the piece that would cause the
  divergence the roadmap warns about.
- **Idempotency in this repo is a database concern, not an application one.**
  `anomaly` uses `unique(owner, sprint, dedupKey)`; `sync_state` uses
  `unique(owner, integration)` plus `SELECT … FOR UPDATE`; `jira_status_history`
  learned lesson #1 the hard way. `daily_recap` is the one table that never got
  its key, and it is the one about to be written by a job that runs 96 times a day.

## Historical Context (from prior changes)

- `context/archive/2026-08-26-sprint-reconciliation/` — S-16 introduced
  multiple sprint rows per owner, which is why `sprint_id` must be excluded from
  the recap dedup key, and moved `identity` into scope at the `!chosenSprint`
  return, which makes the timezone fix trivial.
- `context/foundation/lessons.md` #1 — nullable column in a UNIQUE dedup key;
  applies to `daily_recap.recap_date` verbatim.
- `context/foundation/lessons.md` #3 — request-scoped pool teardown; the cron
  path owns it via `ctx.waitUntil(pool.end())`.
- `context/foundation/lessons.md` #4 — cap and origin-check paginated loops
  carrying a secret; **N/A here** and worth saying so explicitly.
- `context/foundation/lessons.md` #6 (S-16) — a narrowing predicate turns a wrong
  value into an empty result that reads as success. Relevant: a recap that finds
  no anomalies must be distinguishable from a recap that failed to look.

## Open Questions

1. **Does S-11 ship a settings UI for the send time, or default to 15:00 with no
   surface?** The full pattern is available and cheap, but it is a whole
   page+action+schema+organism. S-19 would later move it into a Team section.
2. **Is an owner without Jira entitled to a recap?** Today's cron enumeration
   would never reach them.
3. **What happens on a day with no sprint row?** `daily_recap.sprint_id` is NOT
   NULL, so the recap cannot be stored — skip, or relax the column?
4. **Does S-11 also close FR-001's password-reset email?** The transport it
   builds is exactly what `auth.ts:56-59` is waiting for, and the code names S-11.
   Small addition, real FR gap, but formally another slice's requirement.
5. **Does the recap carry "tickets moved to Done"?** The PRD wording says yes;
   no reducer exists.
6. **Should the pre-existing timezone refresh gap be fixed here?** It is one line
   and S-11 is the first feature that visibly depends on it — but it is S-16
   territory, now archived.
7. **Fix the `MAX_OWNERS_PER_CYCLE` cursor claim?** Unrelated to S-11; file
   separately rather than widening this slice.
