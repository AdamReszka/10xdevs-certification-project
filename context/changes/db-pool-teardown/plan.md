# Request-Scoped Identity for the `db` Handle (S-21) — Implementation Plan

## Overview

One authenticated request currently builds **three independent `pg.Pool`s** — one
inside `createAuth`, one inside `resolveWorkspace`, one in the page or action body
— and an authenticated Server Action builds **four**. Nothing shares a handle
because the two resolvers each construct one internally and neither exposes it.
Concurrency therefore costs 3–4× what it should, and the local Playwright suite
hits Postgres's connection ceiling mid-run.

This plan gives `getDb` a per-request identity by memoizing the constructed handle
on the object returned by `getCloudflareContext()` — per-invocation on Workers,
process-global in `next dev`. The change lands inside `src/lib/db.ts`; **no call
site moves**. It then proves the fix by measurement and by restoring parallel
Playwright workers, repairs the diagnostic that hid the defect for weeks, and
corrects the wrong mechanism wherever it has propagated.

Teardown — the thing this slice was originally named for — is **not** part of the
fix. See `frame.md`: `pg.Pool`'s 10-second idle timer already reclaims every pool
in Node (measured, 63 → 3 connections in ~14 s), and Cloudflare's documented
Hyperdrive lifecycle cleans the client up when the invocation completes.

## Current State Analysis

**The three constructing seams** (`research.md` §2):

| # | Seam | Line | Why it cannot reuse another handle |
| - | ---- | ---- | ---------------------------------- |
| 1 | `createAuth(env)` | `src/lib/auth.ts:72` | Builds `getDb(env)` internally; the Better Auth instance holds it for its own lifetime and never exposes it |
| 2 | `resolveWorkspace()` | `src/lib/workspace.ts:117` | Same shape; `cache()`d, but the memoized value is the `Workspace`, not the handle |
| 3 | page / action body | e.g. `dashboard/page.tsx:51`, `settings/connections/actions.ts:86` | Has no handle to receive — `(app)/layout.tsx` and the page it wraps are separate React entry points with no lexical parent |

**What the numbers actually are.** `GET /dashboard` authenticated = 3 pools, held
concurrently (measured in framing). A Server Action = 4, because React `cache()`
is **provably inert** inside an action body — it memoizes only under an active
Flight render (`react.react-server.development.js:575-578`), and Next invokes the
action under `workUnitAsyncStorage`, not React's
(`action-handler.js:888`). 36 of 59 `getDb` call sites are Server Actions.

**Why this reads as a product bug.** `getOptionalSession` catches the `53300`
error and returns `null` (`src/lib/auth.ts:189-192`). A valid session becomes
"not signed in" → `requireSession` redirects to `/login`. Reproduced 22× in one
run. That is why the suite failures looked like "Jira connected never appears".

**What holds the line today.** `playwright.config.ts:50` pins `workers: 1`
unconditionally, with a comment naming this slice as the condition to revisit it.

**Constraints discovered while planning** (beyond `research.md`):

- **The adapter exports no non-throwing context accessor.**
  `getCloudflareContext()` in sync mode **throws** when the global is unset — for
  SSG, for module top level, and on the cron path
  (`node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.js:31-46`).
  `research.md`'s sketch names a `tryGetCloudflareContext()`; **it does not
  exist**. The fallback must be our own `try`/`catch`.
- **The context object is a plain, extensible object on both runtimes.** On
  workerd `globalThis[Symbol.for("__cloudflare-context__")]` is a **getter**
  returning `cloudflareContextALS.getStore()` — the literal `{ env, ctx, cf }`
  created fresh per `runWithCloudflareRequestContext`
  (`dist/cli/templates/init.js:11-24`). In dev the same cell holds one object
  installed once by `initOpenNextCloudflareForDev`. Neither is frozen.
- **The test coupling is smaller than research feared.** The six `*.demo.test.ts`
  files `vi.mock` the **whole** `@/lib/db` module (`getDb: () => { throw }`), and
  this change alters no call shape — they pass untouched. `auth.test.ts:15-17`'s
  premise also survives: with no context on the global the accessor throws, we
  fall back, and construction stays lazy.
- **`getOptionalSession` has exactly two consumers**: `requireSession`
  (`auth.ts:205`, behind 31 call sites) and `(auth)/layout.tsx:28`. They read the
  same `null` in **opposite** directions, each documented as correct.
- **There is no `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere in
  `src/app`.** A gated render that throws has no boundary at all.

## Desired End State

An authenticated `GET` and an authenticated Server Action each build **one**
pool for the app, not three or four, so connection count stops scaling with pool
multiplicity and is bounded by a single ceiling instead. Note the unit: the
measured *connection* count does not fall to one — `dashboard/page.tsx:87-105`
fans out 8-way on the shared handle, so a render draws as many connections as
that fan-out demands, up to `POOL_MAX`, where three `max: 1` pools drew three.
In `next dev` the memoised pool is process-global, so `POOL_MAX` bounds the whole
dev server; on Workers it bounds each invocation. `playwright.config.ts` runs
parallel workers locally again and the full suite passes. A database failure
during a gated render reaches the user as an error surface, not as a silent
sign-out. `lessons.md` #3 describes the mechanism that actually exists.

Verified by: the before/after measurement recorded in Phase 1 and Phase 3, a
green `npm run test:e2e` with `workers` unpinned, and `npm test` covering the
new invariant.

### Key Discoveries:

- `src/lib/db.ts:14-18` — `new Pool({ max: 1 })` per call; `max` is a **ceiling,
  not an allocation** (`pg-pool/index.js:167,235` — the constructor opens
  nothing), so one value is correct on both runtimes and no runtime branch is
  needed (`research.md` D1).
- `src/lib/db.ts:16` — `max: 1` is already a latency defect independent of this
  slice: the dashboard's 8-way `Promise.all` (`dashboard/page.tsx:87-105`)
  serialises through a single connection on every render.
- `node_modules/@opennextjs/cloudflare/dist/cli/templates/init.js:11-24` — the
  per-invocation ALS store that gives the memo its identity.
- `src/worker.ts:43-47` — `runScheduledSync` is called **outside**
  `runWithCloudflareRequestContext`, so the cron path has no context object and
  must keep owning its pool.
- Next.js docs (Context7, 2026-08-30): *"error.js … does not catch errors thrown
  in layout.js or template.js within the same segment"*. On the boundary's props,
  the docs describe **canary**, not what is installed: `retry` was added as an
  unstable feature in 16.2.0 and became stable only in **16.3.0**. This repo is
  pinned to **16.2.6**, whose own type is
  `{ error, reset, unstable_retry }` (`next/dist/client/components/error-boundary.d.ts:3-7`)
  — there is no `retry` prop. Use `reset`.
- `research.md` §5 — the wrong lesson reached `lessons.md`, the roadmap twice,
  ~14 source comments in 10 files, the `getDb`/`getDbWithPool` split's own
  justification, `playwright.config.ts`, and manual-test row 13.2.

## What We're NOT Doing

- **No pool teardown on the request path.** Not an after-hook, not
  `ctx.waitUntil(pool.end())`, not a manual close. Both runtimes reclaim.
- **No call-site changes.** All 59 `getDb` / `getDbWithPool` invocations, the 39
  local `type Db` aliases and the 91 signatures taking `db: Db` stay byte-for-byte
  as they are. That zero-churn property is the whole argument for this mechanism.
- **No rename.** `getDb` and `getDbWithPool` keep their names and get new
  docblocks (decided this session).
- **No runtime branch in `db.ts`.** CI has no Workers job, so an
  `if (workers) … else …` would ship an unexercised branch guarding production.
- **Not switching the three `pool.end()` owners to the shared handle.**
  `sync/scheduled.ts`, `sync/actions.ts` and `api/webhooks/resend/route.ts` keep
  `getDbWithPool` + their explicit close. Their comments get corrected; their code
  does not.
- **No `global-error.tsx`.** Phase 4 adds the boundary for the segment that
  actually throws. A failure inside `src/app/layout.tsx` remains uncovered and is
  out of scope.
- **No new UX design** for the error surface — a plain shadcn card with a retry
  control, consistent with the existing app shell.
- **Not touching the two valid clusters that share this vocabulary**:
  reads-before-transaction (`roster-store.ts:51-52`, `reconcile-sprint.ts:29-30`,
  `absence-store.ts:139-140`) and never-cache-auth-across-invocations
  (`api/auth/[...all]/route.ts:10`).
- **No connection-counting test in CI.** Rejected this session: no test in the
  repo counts connections, and the result would depend on local Supabase's own
  ~29 idle connections and on `idleTimeoutMillis` — exactly the kind of noise that
  hid this defect.

## Implementation Approach

Mechanism **B** from `research.md` §3: memoize the handle on the adapter's own
request-context object, under a `Symbol.for` key.

The object is per-invocation on Workers and per-process in `next dev`, so **one
line of code satisfies both conventions** — Cloudflare's (fresh client per
invocation, never a global pool, no manual close) and Node's (one long-lived
pool, idle-reclaimed) — without a discriminator. In dev the consequence is
stronger than the 3× headroom `frame.md` predicted: a single process-global pool
with a fixed ceiling bounds the **entire dev server** regardless of request rate,
so the acceptance test stops depending on burst rate at all.

`Symbol.for` (global registry) rather than `Symbol()` so the memo survives a
module re-evaluation under dev HMR.

## Critical Implementation Details

**Timing & lifecycle.** `getCloudflareContext()` throws rather than returning
`undefined` when no context is installed, and it throws on three real paths this
codebase uses: the cron entry (`src/worker.ts:43-47`, outside the ALS wrapper),
SSG, and module top level (`src/lib/auth.ts:167`, `export const auth =
createAuth()` for the schema-gen CLI). The `try`/`catch` fallback is therefore
load-bearing, not defensive — without it, `npm run build` and the scheduled
handler break.

**State sequencing.** Nobody may call `.end()` on the handle `getDb` returns. In
dev that pool is process-global, and `"Cannot use a pool after calling end on the
pool"` would poison the dev server for the rest of its life. The structural
guard is that `getDb` returns only `.db` and `getDbWithPool` always constructs a
fresh, unmemoized pool — the two functions must stay separate, which is why the
rename option was rejected.

**Debug & observability.** The memo key is the **context object**, not `env`, so
**first construction wins** and every later caller in that context inherits the
first caller's `env`. Every *request-path* caller passes
`getCloudflareContext().env`, so among those the rule is harmless. The exception
is the one caller that is not on the request path and constructs first:
`src/lib/auth.ts:167` — `export const auth = createAuth()` — passes **no** env,
and `createAuth` calls `getDb(env)` at `auth.ts:72`. On Workers that line is
harmless (module scope has no ALS store, the accessor throws, the fallback builds
a throwaway). In `next dev` it is the opposite: `initOpenNextCloudflareForDev`
has already installed the global context by the time `auth.ts` is evaluated, so
the schema-gen export would become the process-global pool for the whole dev
server and every later `getDb(env)` would silently ignore its own `env`. It is
benign only by accident today — `wrangler.jsonc:32`'s `localConnectionString` is
a placeholder, so both paths fall through to `DATABASE_URL` — and stops being
benign under `npm run preview`, where the Hyperdrive binding is real. Phase 2
takes that caller out of the memo rather than relying on the accident.

---

## Phase 1: Baseline measurement

### Overview

Record what a request costs **before** the fix, with an instrument that Phase 3
can re-run unchanged. This closes `research.md` Open Question 1 — the Server
Action count (4 + the re-render's own) is currently derived from source, not
measured — and gives the delta a denominator.

### Changes Required:

#### 1. Measurement procedure — a throwaway, not a committed instrument

**File**: none committed. The snippet lives in the session scratchpad and is
discarded; **nothing is added under `scripts/`.**

**Intent**: Get the before-numbers, not a tool. The committed proof of this slice
is elsewhere and cheaper: `db.test.ts` (the only part that runs in CI) and Phase
3's `npm run test:e2e` with `workers` unpinned and no `53300` in the output. A
committed CLI — argument parsing, a DSN guard, `application_name` partitioning —
is a phase of work whose whole output is two numbers in a markdown file, and no
later slice has been identified that needs to re-measure. If one is, promote the
snippet then.

**Procedure**: fire K concurrent authenticated requests at the running dev server
against one target (a gated `GET` path, then a Server Action endpoint) while
sampling `select count(*) from pg_stat_activity where datname = current_database()`
partitioned by `application_name` / `usename`, so local Supabase's own ~29 idle
connections are subtracted rather than counted. Record: idle baseline, peak
in-flight, peak minus baseline, and peak ÷ concurrency.

**Safety guard** — the snippet still refuses to run against any `DATABASE_URL`
that is not local Supabase `127.0.0.1:54322`, mirroring
`test/integration/setup.ts:33-40`. It opens connections against whatever it is
pointed at, and it must never be pointable at hosted Supabase. Being throwaway is
not a reason to skip this check; it is a reason the check must be the first thing
written.

#### 2. Measurement account

**File**: none — an operational step, recorded in the phase notes.

**Intent**: Create a dedicated, disposable account for measurement.

**Contract**: Do **not** reuse the E2E harness to obtain a session —
`e2e/accounts.ts` issues `delete from "user"` against local Supabase. Sign up
through the UI, note the session cookie, and record which account was used.
Per the standing rule, never point any of this at the account holding real
tokens.

### Success Criteria:

#### Automated Verification:

- The snippet runs from the scratchpad and prints a report, and `git status` shows nothing new under `scripts/`
- The snippet refuses a non-local DSN: pointed at a non-`127.0.0.1:54322` `DATABASE_URL` it exits without connecting

#### Manual Verification:

- Baseline for an authenticated `GET /dashboard` recorded — expected ≈3 connections per request
- Baseline for an authenticated Server Action on `/settings/connections` recorded — expected ≈4 per action, plus the post-action re-render's own
- Both numbers written into this plan's phase notes, with the concurrency and the idle baseline they were taken at

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the measurement was successful before proceeding to the next phase.

---

## Phase 2: Request-scoped identity for the `db` handle

### Overview

The fix. One file, no call-site changes, plus the hermetic test that keeps the
invariant true after this slice ends.

### Changes Required:

#### 1. The memo

**File**: `src/lib/db.ts`

**Intent**: Give `getDb` a per-request identity by caching the constructed handle
on the adapter's request-context object, so the three seams that each build their
own handle receive the same one; keep `getDbWithPool` as the explicitly-owned
constructor for paths that have no request context or that must close their own
pool.

**Contract**:

- `getDb(env?)` and `getDbWithPool(env?)` keep their **exact current
  signatures and return types**. `ReturnType<typeof getDb>` is aliased in 39
  files and threaded through 91 signatures; it must not move.
- `POOL_MAX` becomes a single module constant set to **5**, consumed by
  `getDbWithPool`, so both paths inherit it — including `runScheduledSync`
  (`scheduled.ts:97`) on the cron path. **5 is Cloudflare's own number**, not a
  throughput guess: their Hyperdrive + node-postgres example sets `max: 5`
  *"due to Workers' limits on concurrent external connections"*, and Workers
  allows six simultaneous connections per invocation before the seventh queues.
  The ceiling is the one quantity that genuinely differs between the runtimes
  (research D1 settled only that `max` is not an *allocation*), so the
  production runtime — the one CI never exercises — sets it. The dashboard's
  8-way `Promise.all` therefore runs 5-wide rather than 8-wide, which is still
  five times today's `max: 1`.
- A module-private accessor returns the context or `undefined`, wrapping the
  throwing `getCloudflareContext()`.
- A `Symbol.for("sprintflow.requestDb")` key holds the memoized
  `{ db, pool }` on the context object.
- `getDbWithPool` never reads or writes the memo — it always constructs fresh.
- The memo's documented invariant is **first construction wins**: every later
  caller under one context inherits the first caller's `env`. That is safe only
  while every participant is a request-path caller passing
  `getCloudflareContext().env` — which is why the one module-scope constructor is
  removed from the memo below.

Snippet, because the throwing accessor and the memo placement are the two things
that are wrong if guessed:

```ts
const POOL_MAX = 5;
const REQUEST_DB = Symbol.for("sprintflow.requestDb");

// The adapter exports no non-throwing accessor: getCloudflareContext() throws
// for SSG, at module top level, and on the cron path (worker.ts runs
// runScheduledSync OUTSIDE runWithCloudflareRequestContext). This catch is
// load-bearing, not defensive.
function currentContext() {
  try {
    return getCloudflareContext() as Record<symbol, unknown> & { env: CloudflareEnv };
  } catch {
    return undefined;
  }
}

export function getDb(env?: DbEnv) {
  const ctx = currentContext();
  if (!ctx) return getDbWithPool(env).db;
  return ((ctx[REQUEST_DB] ??= getDbWithPool(env ?? ctx.env)) as DbHandle).db;
}
```

#### 2. The docblocks that justified the split

**File**: `src/lib/db.ts` (lines 4-25 today)

**Intent**: Replace both docblocks. They currently cite the isolate-lifetime
mechanism (`lesson #3`) that this slice is disproving, and the `getDb` block
still describes itself as the leaking one whose fix "stays a separate ticket".

**Contract**: `getDb` documents the request-scoped shared handle, the fallback
paths, the memo-key-is-the-context invariant, and the prohibition on `.end()`.
`getDbWithPool` documents the explicitly-owned pool and names the three call
sites that legitimately use it. Neither mentions "leak" or "isolate's lifetime".

#### 3. The one caller that constructs outside a request

**File**: `src/lib/auth.ts` (line 167)

**Intent**: Keep the static schema-gen export out of the memo. It is the only
`getDb` caller that supplies no `env`, and in `next dev` it evaluates *after* the
global context is installed — so under the memo it would become the process-global
pool for the entire dev server and every later `getDb(env)` would silently inherit
its `env` (see Critical Implementation Details → Debug & observability).

**Contract**: `export const auth = createAuth()` builds its handle with
`getDbWithPool().db` instead of going through `getDb`. Nothing else about
`createAuth` changes — request-path callers keep passing
`getCloudflareContext().env` and keep sharing the memoized handle. The existing
docblock at `auth.ts:62-70` already says this export "is never used by the
Worker"; extend it to say it is also never the memo's first constructor, and why.
`src/lib/auth.test.ts` must still pass unchanged — `getDbWithPool` is equally lazy.

#### 4. The invariant's guard

**File**: `src/lib/db.test.ts` (new)

**Intent**: Hermetic unit test asserting the identity contract, so a future slice
adding a fourth constructing seam breaks the build instead of quietly costing a
connection. `db.ts` has no test today.

**Contract**: Sets and deletes `globalThis[Symbol.for("__cloudflare-context__")]`
around each case (nothing defines it in a Vitest process, so plain assignment
works). Cases:

- two `getDb(env)` calls under the **same** context object return the same
  instance (`toBe`)
- a **fresh** context object yields a different instance
- with **no** context installed, `getDb` still returns a working handle and two
  calls do **not** share — the fallback path
- `getDbWithPool` never returns the memoized handle, so `.end()` cannot reach it
- **no connection is opened at construction** — preserves the premise
  `src/lib/auth.test.ts:15-17` rests on
- the static `auth` export does **not** populate the memo: with a context
  installed, importing `@/lib/auth` leaves `ctx[REQUEST_DB]` unset, so the first
  request-path `getDb(env)` is what constructs it

### Success Criteria:

#### Automated Verification:

- New test passes and the suite is green: `npm test`
- The six `*.demo.test.ts` files and `src/lib/auth.test.ts` pass unchanged
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:integration`
- Production build succeeds — proves the module-top-level and SSG fallbacks: `npm run build`

#### Manual Verification:

- Dev server boots and an authenticated `/dashboard` renders
- A Server Action on `/settings/connections` still saves and reports success
- Sign-out and sign-in still work (the `createAuth` seam is the one most changed by sharing)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Prove it

### Overview

Re-measure with the same instrument, then remove the workaround that this slice
exists to remove. This is the acceptance test named in `frame.md` and in
`playwright.config.ts`'s own comment.

### Changes Required:

#### 1. Restore parallel workers

**File**: `playwright.config.ts`

**Intent**: Return local runs to parallel workers, and replace the comment, which
states the wrong mechanism ("the request path still leaks its `pg.Pool` per
invocation").

**Contract**: `workers: process.env.CI ? 1 : undefined`. The replacement comment
records why CI stays at 1 (determinism and runner size, not connections) and
drops the leak claim entirely.

#### 2. After-measurement

**File**: none — re-run the Phase 1 scratchpad snippet with identical arguments,
against the same target and concurrency.

**Intent**: Produce the delta in **connections** — the unit `pg_stat_activity`
reports, and not the unit the pool count is in. Expected: the peak stops scaling
with concurrency and settles at the dev server's single `POOL_MAX` ceiling,
instead of ~3 per in-flight `GET` and ~4 per in-flight action. Per-request
connection count does **not** drop to one: the dashboard's 8-way fan-out draws up
to `POOL_MAX` connections from the one shared pool, where three `max: 1` pools
drew three. The win is the ceiling, not the per-request number.

### Success Criteria:

#### Automated Verification:

- Full suite passes with parallel workers: `npm run test:e2e`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- After-measurement recorded next to the Phase 1 baseline, same concurrency, same instrument
- Peak connections no longer scale with concurrency in dev — a higher `--concurrency` does not raise the peak past `POOL_MAX`
- No occurrence of `53300` / "remaining connection slots" anywhere in the E2E run output
- **Dev headroom holds at `POOL_MAX = 5`**: the parallel run shows no test failing
  on Playwright's own timeout while waiting on a query, and the suite's wall-clock
  is not worse than the serial 15-spec baseline (~21 s). If it is, that is pool
  contention in dev — raise the dev-side ceiling (which forces the two-constant
  split rejected in Phase 2) rather than raising the shared value above 5

**Failure-triage rule for this phase** — record it rather than improvising: if
the parallel suite fails for a reason that is **not** connection exhaustion
(`53300`), that is a test-isolation defect (specs sharing an account; `e2e/accounts.ts`
issues `delete from "user"`), **not** a failure of this fix. In that case log it
as a separate finding and re-pin `workers: 1` with the **new** reason written in
the comment — never leave the old, disproved reason in place.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: "No session" stops meaning "could not tell"

### Overview

`getOptionalSession` returns `null` for two different facts, and its two consumers
read that `null` in opposite directions — each documented as correct. Under a
database error both fire: the signed-in user is bounced to `/login`, and `/login`
renders happily. That gap is why this defect read as flake for weeks, and it is
the reason Phase 3 can go green while the diagnostic stays broken.

This is an already-accepted house rule, not a new product decision:
`lessons.md` — *"A narrowing predicate turns 'wrong value' into 'empty result',
which reads as success"*. This code predates the lesson.

### Changes Required:

#### 1. Three outcomes instead of two

**File**: `src/lib/auth.ts`

**Intent**: Make `getOptionalSession` distinguish "there is a session", "there is
no session" and "the lookup failed", and route each at `requireSession` so a
database failure stops impersonating a signed-out user.

**Contract**: `getOptionalSession()` returns a discriminated result with three
outcomes — active (carrying the session), anonymous, unavailable (carrying the
cause). Still wrapped in `cache()`; still logs on the failure branch.

`requireSession()`'s **public contract is unchanged** — it returns a guaranteed
session or does not return. Anonymous → `redirect("/login")` exactly as today;
unavailable → `throw` an Error carrying the cause. All 31 call sites and the seven
test files that mock `requireSession` stay untouched.

Note the behavioural consequence in Server Actions, and treat it as the point:
today a database blip inside an action redirects the user to `/login`; afterwards
the action rejects and the form reports a failure. "Couldn't save" is true;
"you have been signed out" was not.

#### 2. The fail-open consumer says what it is open about

**File**: `src/app/(auth)/layout.tsx`

**Intent**: Keep the current behaviour — never trap a user out of the login page —
but express it against the new outcomes so the intent is legible.

**Contract**: Redirect to `/dashboard` only on the active outcome; render the auth
page on both anonymous and unavailable. The existing fail-open comment is updated
to name which case it is open about.

#### 3. The missing boundary

**File**: `src/app/error.tsx` (new)

**Intent**: Give a throwing gated render somewhere to land. There is no error
boundary anywhere in `src/app` today.

**Contract**: **Root-level, not `(app)`-level.** Next's documented rule: *"error.js
… does not catch errors thrown in layout.js or template.js within the same
segment"* — and `requireSession()` is called in `(app)/layout.tsx:32`, so a
boundary at `src/app/(app)/error.tsx` would never fire for the case this phase
exists to handle.

Client Component (`"use client"`), props `{ error, reset }` — **`reset`, not
`retry`**: the installed Next is 16.2.6, whose boundary type is
`{ error, reset, unstable_retry }`; the stable `retry` prop only lands in 16.3.
Wire the control to `reset()`. Renders a shadcn card with a short
human-readable message and a retry control. Must not render `error.message` or
any DSN/token material (Guardrails). Must not call `getOptionalSession`.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:integration`
- E2E suite still passes: `npm run test:e2e`

#### Manual Verification:

- With Postgres stopped, opening `/dashboard` while holding a valid session cookie shows the error surface — **not** a redirect to `/login`
- With Postgres stopped, `/login` still renders (fail-open preserved)
- With Postgres stopped, a Server Action reports a failure rather than bouncing to `/login`
- With Postgres running, signed-out access to `/dashboard` still redirects to `/login` as before
- The error surface exposes no connection string, token or raw driver message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Retire the wrong mechanism everywhere it propagated

### Overview

`lessons.md` #3 is wrong as written and has been steering design since S-02: it
was cited by S-02 F3, S-04's research, S-05's decision to fix only the cron path,
S-24 F2, and `playwright.config.ts`. Leaving it in place means the next slice
re-derives the same wrong constraint.

Where a comment's **advice** survives (share one handle per request; the cron path
owns its teardown), the advice stays and only the **reason** is replaced.

### Changes Required:

#### 1. The lesson itself

**File**: `context/foundation/lessons.md` (entry at :19-24)

**Intent**: Rewrite lesson #3 end to end — title, context, problem, rule,
applies-to.

**Contract**: The new rule is *identity*, not teardown: give the request-scoped DB
handle one identity per request by memoizing on the platform's own request-context
object; do not tear it down. It records the two facts that disprove the old
version — `pg.Pool`'s idle timer reclaims in Node (measured 63 → 3 in ~14 s), and
Hyperdrive cleans the client up when the invocation completes — and the fact that
React `cache()` cannot be the sharing mechanism because it is inert in a Server
Action. Append-only register: rewrite the entry in place and date the correction.

#### 2. The roadmap

**File**: `context/foundation/roadmap.md` (row at :568, entry at :691-720)

**Intent**: The S-21 entry's Outcome and its entire *"the naive fix is wrong"*
rationale are written against the unbounded-leak mechanism.

**Contract**: Outcome restated as multiplicity, not lifetime. The
after-hook/`ctx.waitUntil` paragraph is replaced by why teardown came off the
table. Status moves to done with the PR reference, matching the format of the
S-23/S-24 rows.

#### 3. Source comments — advice kept, reason replaced

**Files**: `src/app/(app)/dashboard/page.tsx:68,85,108,117`;
`src/lib/recap/build.ts:37-38`; `src/lib/recap-settings.ts:66-68`;
`src/lib/measurement/reader.ts:155`; `src/lib/workspace.ts:146-149`

**Intent**: These all say "one handle, one fan-out, because lesson #3". The
guidance is good and stays; the citation is to a mechanism that no longer exists.

**Contract**: Each keeps its instruction and swaps the justification. Two carry
extra nuance: `workspace.ts:146-149` claims computing the predicate one level up
"would leak a Hyperdrive-backed connection on every gated render" — no longer
true under the memo, while the impl-review F6 reason (a wasted round trip on an
answer that is then discarded) survives and becomes the whole justification.
`dashboard/page.tsx` keeps the single-fan-out advice on latency grounds
(`POOL_MAX` is a ceiling, not a licence to fan out serially).

#### 4. Source comments on the three owned-pool sites

**Files**: `src/lib/integrations/sync/scheduled.ts:18,202-204`;
`src/lib/integrations/sync/actions.ts:28`;
`src/app/api/webhooks/resend/route.ts:33,100-102`

**Intent**: These three legitimately own a pool and close it. **No code changes** —
only the reason, which is currently "a pool left open pins a connection for the
isolate's lifetime".

**Contract**: `scheduled.ts` — the honest reason is that `src/worker.ts:43-47`
runs `runScheduledSync` **outside** `runWithCloudflareRequestContext`, so there is
no context object to memoize on and `getDb` would fall back to an unowned
per-call pool. `sync/actions.ts` and the Resend webhook both **do** run inside a
request context: they take a deliberately separate, self-closed pool for a
long-running fan-out, and each comment must state the prohibition explicitly —
never call `.end()` on a handle from `getDb`.

#### 5. The change's own record

**File**: `context/changes/db-pool-teardown/change.md`

**Intent**: `change.md:12` still states the old framing as fact and now contradicts
its own sibling `frame.md`.

**Contract**: The frontmatter `title` still reads *"Close the request-scoped
pg.Pool at request end (fix per-invocation connection leak)"* — it names the fix
this slice decided **not** to make, so it is corrected to the multiplicity
framing. Add a dated correction note in the body pointing at `frame.md`'s
reframing and this plan; leave the S-24 section, which is still accurate.

#### 6. The manual-test backlog row

**File**: `context/foundation/manual-test-backlog.md` (row 13.2, :1517-1524)

**Intent**: Row 13.2 tests *reads before a transaction* under real Hyperdrive —
a still-valid concern — but its *Dlaczego to łapie* is written against "pule
per-request, które nigdy nie są zamykane".

**Contract**: Keep the row and its steps. Rewrite only the rationale to cite the
reads-before-transaction rule it actually exercises. Row stays unticked — it is a
deployed-Hyperdrive check this slice does not perform.

#### 7. The slice's own manual checklist

**File**: `context/changes/db-pool-teardown/MANUAL-CHECKLIST.md` (new)

**Intent**: Per house convention, the short list of what genuinely blocks this
slice, sized 3-5 rows, each carrying where / what to do / what must be true / why
it matters.

**Contract**: Three rows — the stopped-Postgres error surface on a gated route
(Phase 4), `/login` still rendering with Postgres down (fail-open preserved), and
a normal signed-out redirect still working with Postgres up. Then run
`node scripts/manual-test-sweep.mjs` and reconcile
`context/foundation/manual-test-backlog.md` §1 so no open row exists only here.

### Success Criteria:

#### Automated Verification:

- Manual-test sweep exits zero: `node scripts/manual-test-sweep.mjs`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit suite passes: `npm test`
- No source file still cites the isolate-lifetime mechanism: `grep -rn "isolate's lifetime" src/ context/foundation/` returns nothing

#### Manual Verification:

- `lessons.md` #3 reads correctly to someone who has not read this plan — the rule is actionable without the backstory
- The four excluded sites are confirmed untouched: `roster-store.ts:51-52`, `reconcile-sprint.ts:29-30`, `absence-store.ts:139-140`, `api/auth/[...all]/route.ts:10`
- The roadmap S-21 entry matches what actually shipped

---

## Testing Strategy

### Unit Tests:

- `src/lib/db.test.ts` (new) — handle identity under one context; distinctness across contexts; the no-context fallback; `getDbWithPool` never returning the memo; no connection at construction
- Existing `src/lib/auth.test.ts` must pass **unchanged** — it is the standing guard on lazy construction
- The six `*.demo.test.ts` files must pass **unchanged** — they encode "a refused action must never open a DB handle" and are the canary for an accidental call-shape change

### Integration Tests:

- The existing 30 `*.integration.test.ts` files build their own `Pool` and never import `@/lib/db`, so they constrain nothing here — they run as a regression net, not as coverage of this change
- `src/lib/integrations/sync/actions.test.ts` is the only test on the teardown contract; it must stay green, which it will, because that path is untouched

### Manual Testing Steps:

1. Phase 1 — with a throwaway scratchpad snippet, measure `GET /dashboard` and a `/settings/connections` Server Action at fixed concurrency; record peak connections and the idle baseline
2. Phase 3 — re-run identically; confirm per-request cost drops to 1 and that raising concurrency no longer raises the peak past `POOL_MAX`
3. Phase 3 — `npm run test:e2e` with parallel workers; confirm no `53300` in the output
4. Phase 4 — stop Postgres; with a valid session cookie open `/dashboard` (expect the error surface, not `/login`), then open `/login` (expect it to render), then trigger a Server Action (expect a reported failure)
5. Phase 4 — restart Postgres; confirm a signed-out visit to `/dashboard` still redirects to `/login`

## Performance Considerations

`max: 1` is a latency defect today: the dashboard's 8-way `Promise.all`
(`dashboard/page.tsx:87-105`) serialises through one connection on every render.
Raising the ceiling to 5 removes most of that serialisation as a side effect of
this slice — the fan-out runs 5-wide instead of 1-wide.

`POOL_MAX` plays two different roles and the smaller one wins. On Workers it is a
**per-invocation** budget, and Cloudflare caps that near 5–6 (their own
Hyperdrive + `pg` example uses `max: 5`; a seventh simultaneous connection
queues). In `next dev` the memoised pool is process-global, so the same 5 is the
**whole dev server's** budget across every parallel Playwright worker. Under
`workers: undefined` locally, several concurrent dashboard renders contend for
those five connections; `pg.Pool` queues rather than failing (`connectionTimeoutMillis`
defaults to 0), so the risk is Playwright's own 30 s test timeout, not `53300`.
That contention is a **new** Phase 3 acceptance question, not a settled one — see
Phase 3's success criteria.

## Migration Notes

No schema change, no data migration, no deployment ordering constraint. The
change is source-only and reversible by reverting `src/lib/db.ts`; the
`playwright.config.ts` pin can be restored independently if Phase 3's triage rule
fires.

## References

- Frame brief: `context/changes/db-pool-teardown/frame.md`
- Research: `context/changes/db-pool-teardown/research.md`
- Prior findings: `context/archive/2026-06-14-setup-github-integration/reviews/impl-review.md` F3;
  `context/archive/2026-08-30-destructive-action-confirmation/reviews/impl-review.md` F2;
  `context/archive/2026-08-20-data-sync-engine/plan.md:93`;
  `context/archive/2026-08-19-onboarding-routing/research.md:91`
- Counter-argument the repo already held: `context/deployment/deploy-plan.md:55`
- Adapter internals: `node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.js:31-46`,
  `dist/cli/templates/init.js:11-24`
- External: Cloudflare Hyperdrive — *Connection lifecycle*; Cloudflare Workers —
  *Platform limits § Simultaneous open connections*; Next.js — *File conventions:
  error.js* (all fetched 2026-08-30)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline measurement

#### Automated

- [x] 1.1 The scratchpad snippet runs and prints a report; nothing new under `scripts/` — a73388a
- [x] 1.2 The snippet refuses a non-local DSN — a73388a

#### Manual

- [x] 1.3 Baseline recorded for authenticated `GET /dashboard` — a73388a
- [x] 1.4 Baseline recorded for an authenticated Server Action — a73388a
- [x] 1.5 Both numbers written into the phase notes with concurrency and idle baseline — a73388a

### Phase 2: Request-scoped identity for the `db` handle

#### Automated

- [x] 2.1 New test passes and the unit suite is green
- [x] 2.2 The six demo tests and `auth.test.ts` pass unchanged
- [x] 2.3 Type checking passes
- [x] 2.4 Linting passes
- [x] 2.5 Integration tests pass
- [x] 2.6 Production build succeeds

#### Manual

- [ ] 2.7 Dev server boots and authenticated `/dashboard` renders
- [ ] 2.8 A Server Action on `/settings/connections` still saves
- [ ] 2.9 Sign-out and sign-in still work

### Phase 3: Prove it

#### Automated

- [ ] 3.1 Full E2E suite passes with parallel workers
- [ ] 3.2 Type checking passes
- [ ] 3.3 Linting passes

#### Manual

- [ ] 3.4 After-measurement recorded next to the Phase 1 baseline
- [ ] 3.5 Peak connections no longer scale with concurrency past `POOL_MAX`
- [ ] 3.6 No `53300` / "remaining connection slots" in the E2E output
- [ ] 3.7 Dev headroom holds at `POOL_MAX = 5` — no timeout failures, wall-clock not worse than the serial baseline

### Phase 4: "No session" stops meaning "could not tell"

#### Automated

- [ ] 4.1 Unit suite passes
- [ ] 4.2 Type checking passes
- [ ] 4.3 Linting passes
- [ ] 4.4 Integration tests pass
- [ ] 4.5 E2E suite still passes

#### Manual

- [ ] 4.6 Postgres down + valid session on `/dashboard` shows the error surface, not `/login`
- [ ] 4.7 Postgres down, `/login` still renders
- [ ] 4.8 Postgres down, a Server Action reports a failure rather than bouncing to `/login`
- [ ] 4.9 Postgres up, signed-out `/dashboard` still redirects to `/login`
- [ ] 4.10 The error surface exposes no connection string, token or raw driver message

### Phase 5: Retire the wrong mechanism everywhere it propagated

#### Automated

- [ ] 5.1 Manual-test sweep exits zero
- [ ] 5.2 Type checking passes
- [ ] 5.3 Linting passes
- [ ] 5.4 Unit suite passes
- [ ] 5.5 No source file still cites the isolate-lifetime mechanism

#### Manual

- [ ] 5.6 `lessons.md` #3 is actionable without the backstory
- [ ] 5.7 The four excluded sites confirmed untouched
- [ ] 5.8 The roadmap S-21 entry matches what shipped
