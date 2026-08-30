# S-21 — connection measurements (Phase 1 baseline)

Phase 1's success criteria ask for the before-numbers to be "written into this
plan's phase notes". They live here rather than inside `plan.md`, because
`plan.md`'s phase blocks are read-only during `/10x-implement` (only `## Progress`
is mutated). **Phase 3 appends its after-numbers to this same file**, directly
under the baseline table, so the delta reads in one place.

## Instrument

Throwaway snippet, session scratchpad, **not committed** (plan Phase 1 §1):
`scratchpad/measure-connections.mjs`. It refuses any `DATABASE_URL` that is not
local Supabase `127.0.0.1:54322` before opening a connection, mirroring
`test/integration/setup.ts:33-40`.

Method: settle until `pg_stat_activity` is stable (pg's 10 s idle timer reclaims
the previous run's pools), snapshot the **idle baseline** partitioned by
`usename` / `application_name`, fire K concurrent authenticated requests, sample
every 60 ms for 5 s, take the peak, and subtract the baseline. The sampler's own
connection is excluded by `application_name = 'sprintflow-measure'`.

The app's own connections are unambiguous in the partition: they are the only
ones under `postgres/(none)`. Everything else — `authenticator/PostgREST`,
`supabase_admin/*`, `supabase_storage_admin` — is local Supabase's own idle set
(11 connections on a quiet stack) and is subtracted, not counted.

## Setup

- **Measurement account**: `s21-measure-1788087040@sprintflow.test`, created
  through the real sign-up endpoint (`POST /api/auth/sign-up/email`), **not**
  through `e2e/accounts.ts` — that harness issues `delete from "user"`. Disposable,
  local only, holds no real tokens.
- Only the `better-auth.session_token` cookie is sent. The `session_data` cookie
  cache is deliberately **omitted** so every request does the real DB-backed
  session lookup rather than the 5-minute short-circuit.
- `GET /dashboard` is measured with the **demo dataset loaded** (`loadDemoAction`).
  Without it a fresh account is un-onboarded and `dashboard/page.tsx:71` redirects
  to `/setup` before any panel reads — which would measure a redirect, not a
  render. In demo the page renders fully, 8-way `Promise.all` included.
- The Server Action measured is `testGithubConnection` on `/settings/connections`:
  zero-arg, mutates nothing, and calls no external API on an account with no
  stored credential. Invoked over HTTP with the `Next-Action` header (the id is
  read out of the page's own flight payload, which carries the action `name`).

## Baseline — before the fix (2026-08-30, `next dev`, local Supabase)

| Target | Workspace | K | idle baseline | peak | peak − base | **per request** |
| ------ | --------- | - | ------------- | ---- | ----------- | --------------- |
| `GET /dashboard` | DEMO | 8 | 11 | 35 | 24 | **3.00** |
| `GET /dashboard` | DEMO | 12 | 19 | 55 | 36 | **3.00** |
| Server Action `testGithubConnection` | REAL | 8 | 20 | 52 | 32 | **4.00** |
| Server Action `testGithubConnection` | REAL | 12 | 11 | 59 | 48 | **4.00** |
| Server Action `testGithubConnection` | DEMO | 8 | 11 | 35 | 24 | 3.00 |

(The two runs whose idle baseline reads 19–20 were taken while the previous run's
pools were still inside pg's 10 s idle window; the plateau is stable for the whole
5 s sampling window, so the *delta* is unaffected — and both landed on the same
whole number as their clean-baseline twin.)

## What the numbers settle

1. **`research.md` Open Question 1 is closed by measurement, not by source
   reading.** An authenticated Server Action costs **exactly 4** connections;
   an authenticated `GET` costs **exactly 3**. Both were derived from the three
   constructing seams in `plan.md`'s table; both now have a number.

2. **React `cache()` is inert in a Server Action — arithmetically confirmed.**
   `testGithubConnection` builds: `requireRealWorkspace()` → `requireSession()` →
   `getOptionalSession()` → `createAuth(env)` → pool 1; `resolveWorkspace()` →
   `requireSession()` again → a **second** `createAuth(env)` → pool 2; plus
   `resolveWorkspace`'s own `getDb` → pool 3; plus the action body's `getDb` →
   pool 4. If `cache()` memoized, the two session lookups would collapse and the
   count would be 3. It is 4.

3. **The DEMO variant costs 3, and that is the same finding from the other side.**
   The demo refusal returns before the action body's `getDb`, removing exactly one
   pool — 4 → 3. The two session pools survive the short-circuit, so the
   duplication is in the resolvers, not in the body.

4. **The 8-way `Promise.all` in `dashboard/page.tsx:87-105` adds *zero*
   connections.** A full demo render costs the same 3 as the redirect-shaped one
   would: `max: 1` serialises all eight reads through a single connection. This is
   the latency defect `plan.md` → Performance Considerations names, measured.

5. **Cost scales strictly linearly with concurrency** — 3.00 and 4.00 hold at both
   K=8 and K=12, with no plateau. Against Postgres's 100 slots and ~11 taken by
   local Supabase, **~22 concurrent authenticated Server Actions exhaust the
   database**, which is what the 15-spec Playwright run hit in S-24.

## Reproducing this for Phase 3

Same account, same snippet, same K. Order matters, because the two targets need
different workspaces:

1. dev server up; sign in as the measurement account (or re-create one).
2. `loadDemoAction` / `enterDemoAction` → measure `--target=dashboard`.
3. `exitDemoAction` → measure `--target=action`.

Expected after the fix: the per-request figure stops being a constant multiple of
concurrency and the peak settles at the dev server's single `POOL_MAX` ceiling.
Note the unit — per-request connections do **not** fall to 1: with one shared
pool the dashboard's 8-way fan-out is free to draw up to `POOL_MAX = 5` where it
previously drew 1. The win is the ceiling, not the per-request number.
