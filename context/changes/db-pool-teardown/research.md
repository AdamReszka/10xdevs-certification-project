---
date: 2026-08-30T11:44:53+02:00
researcher: Adam Reszka
git_commit: 1f2b668ff09beec3941ff99ebb8f0cd697a0d1c9
branch: fix/db-pool-teardown
repository: 10xdevs-certification-project
topic: "Request-scoped identity for the db handle (S-21): where pools are built, what mechanism can share one, and what proves it"
tags: [research, codebase, db-pool, hyperdrive, workers, opennext, react-cache, server-actions, S-21]
status: complete
last_updated: 2026-08-30
last_updated_by: Adam Reszka
---

# Research: Request-scoped identity for the `db` handle (S-21)

**Date**: 2026-08-30T11:44:53+02:00
**Researcher**: Adam Reszka
**Git Commit**: `1f2b668ff09beec3941ff99ebb8f0cd697a0d1c9`
**Branch**: `fix/db-pool-teardown`
**Repository**: `10xdevs-certification-project`

## Research Question

`frame.md` reframed S-21 from "the pool is never closed" to "one request builds
three pools". This research answers what the plan needs next:

1. **Where** are pools actually built — the complete, classified call-site inventory?
2. **What mechanism** can give the `db` handle a per-request identity in *this*
   runtime (Next 16 App Router + `@opennextjs/cloudflare` + Workers, with
   `next dev` as the runtime where the symptom reproduces)?
3. **What proves** the fix, given the acceptance test already named
   (`playwright.config.ts` back to parallel workers)?
4. **Where** has the wrong `lessons.md` #3 mechanism propagated, so it can be
   corrected in one pass?

Scope, as agreed before the sub-agents ran: survey mechanisms rather than assume
one; inventory the non-request paths (cron, scripts, seed) **without changing
them**.

## Summary

**The mechanism question has a clear answer, and it is not the obvious one.**
React `cache()` — the thing already used at both resolvers — is *provably inert
inside a Server Action*. It memoizes only under an active React Flight render,
and a Server Action body runs under Next's `workUnitAsyncStorage`, not React's.
Since **36 of the 59 call sites are Server Actions**, `cache()` cannot be the
fix. The viable mechanism is memoizing the handle on the object returned by
`getCloudflareContext()` — per-invocation on Workers, process-global in dev —
which requires **no edit at any of the three seams and none at the other ~57
call sites**; the whole change lands inside `src/lib/db.ts`.

**Two corrections to `frame.md`, both verified in this session:**

- **`next dev` DOES use the Hyperdrive binding.** `frame.md`'s Hypothesis 3 says
  `getDb` "falls through to `process.env.DATABASE_URL`, the binding's
  `localConnectionString` being a dummy". It does not: both `.env` and
  `.env.local` define `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`,
  which wrangler's platform proxy uses *in preference to* `wrangler.jsonc`'s
  dummy, so `env.HYPERDRIVE.connectionString` is populated in dev and the `??`
  fallback at `src/lib/db.ts:13` never fires. The frame's *conclusion* (dev talks
  to local Supabase, no real Hyperdrive in the path) stands; its stated mechanism
  does not. **Planner impact:** any step that branches on `env.HYPERDRIVE == null`
  to detect "dev" takes the wrong branch.
- **The cost of a Server Action is higher than three.** `frame.md` measured
  **3** pools for an authenticated `GET`. That number is right, and it is right
  *because* `cache()` works on the render path. On the action path it does not,
  so `settings/connections/actions.ts:49-55` — which awaits
  `requireRealWorkspace()` and `resolveWorkspace()` in one `Promise.all`, each
  reaching `getOptionalSession` → `createAuth` → `getDb` — builds **4** pools,
  before the post-action re-render opens its own ~3. This is derived from source,
  not measured (see Open Questions).

**The acceptance test has no automated home.** CI runs lint, typecheck, unit,
integration and a bundle-size dry-run — it **never runs Playwright**. Restoring
`playwright.config.ts` to parallel workers is verifiable only by a human running
`npm run test:e2e` locally.

**The wrong lesson's blast radius is far wider than `frame.md` assumed.** It
named four sites; the sweep found the claim or a decision derived from it in
`lessons.md` itself, the roadmap (twice), ~15 source-code comments, the entire
`getDb`/`getDbWithPool` split, seven archived plans/researches, and one unticked
row in the manual-test backlog (13.2).

## Detailed Findings

### 1. The call-site inventory — 59 real invocations

Counted two ways (per-file trace and `rg -c` sum) against `src/lib/db.ts:11-28`.
Type-only imports, `type Db = …` aliases, comments and `vi.mock` stubs excluded.

| Class | Count | Notes |
| --- | --- | --- |
| `REQUEST/action` | **36** | the largest consumer, and the one `cache()` cannot reach |
| `REQUEST/render` | 18 | page/layout server components |
| `RESOLVER` | 2 | `auth.ts:72` (`createAuth`), `workspace.ts:117` (`resolveWorkspace`) |
| `REQUEST/route` | 1 | `api/webhooks/resend/route.ts:88` — already uses `getDbWithPool` + `pool.end()` |
| `NON-REQUEST/cron` | 1 | `sync/scheduled.ts:97` — owns its teardown |
| `NON-REQUEST/script` | 1 | `scripts/jira-refinement.eval.ts:125` — the only site that omits `env` |
| `REQUEST/middleware` | **0** | `middleware.ts:41-54` is a cookie-presence check; no DB |
| `TEST` | 0 direct | tests either `vi.mock` the module or build their own `Pool` |

Every site passes `env` from `getCloudflareContext()` except the eval script and
the module-scope `export const auth = createAuth()` (`src/lib/auth.ts:167`),
which runs at import time with no `env` for the Better Auth schema-gen CLI.

**`middleware.ts` matters as a negative result**: it short-circuits
unauthenticated requests before any DB access, which is why an unauthenticated
burst measures zero connections — the detail `frame.md` already recorded.

### 2. What one request actually costs

**`GET /dashboard`, authenticated — 3 pools:**

1. `(app)/layout.tsx:29` → `requireSession()` → `getOptionalSession()`
   (`auth.ts:182`, `cache()`d) → `createAuth(env)` → **`getDb` at `auth.ts:72`**
2. `(app)/layout.tsx:30` → `resolveWorkspace()` (`workspace.ts:110`, `cache()`d)
   → **`getDb` at `workspace.ts:117`**
3. `dashboard/page.tsx:47` calls `resolveWorkspace()` again — **memoized, no new
   pool** — then `dashboard/page.tsx:51` builds **its own `getDb`** for the
   9-reader `Promise.all` fan-out

The page cannot reuse either resolver's handle: both build one internally and
**neither exposes it**. That is the whole defect in one sentence.

**A Server Action — 4 pools, plus the re-render's own:**

`settings/connections/actions.ts:49-55` awaits `requireRealWorkspace()` and
`resolveWorkspace()` in one `Promise.all`. In a render these collapse to one
`getOptionalSession` call. In an action body they do not (§3A), so:
`createAuth` ×2 + `resolveWorkspace`'s own `getDb` + the action body's `getDb`
at `actions.ts:86` = **4**. Next then performs a fresh Flight render, which is a
**separate** cache scope and repeats the GET shape.

Nine actions in `setup/team/actions.ts` alone each build their own handle
(`222, 259, 285, 323, 381, 407, 430, 452, 479`) — the S-24 F2 finding, now
quantified.

### 3. Mechanism comparison

| | Renders | Server Actions | `route.ts` | `next dev` | Workers | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **A** React `cache()` | ✅ already | ❌ | ❌ | same | same | **RULED OUT** |
| **B** memo on `getCloudflareContext()` | ✅ | ✅ | ✅ | process-global pool | true per-request | **VIABLE** |
| **C** own `AsyncLocalStorage` | — | — | — | no entry point | duplicates adapter's ALS | **RULED OUT** |
| **C′** `WeakMap` on `await headers()` | ✅ | ✅ | ⚠️ | works | works | **VIABLE-WITH-CAVEAT** |
| **D** explicit threading | ❌ | ❌ | ✅ | — | — | **RULED OUT** alone |
| **E** module-scope singleton | ✅ | ✅ | ✅ | correct | **hard error** | **RULED OUT** on Workers |

#### A. React `cache()` — ruled out, and this is the load-bearing finding

Verified directly in `node_modules` this session:

```js
// react/cjs/react.react-server.development.js:575-578
exports.cache = function (fn) {
  return function () {
    var dispatcher = ReactSharedInternals.A;
    if (!dispatcher) return fn.apply(null, arguments);   // ← passthrough
```

`ReactSharedInternals.A` is set **only** by the Flight server, in the `Request`
constructor (`react-server-dom-turbopack-server.node.development.js:1104`), and
`getCacheForType` allocates a **fresh `Map`** when `resolveRequest()` finds no
active request — so with no Flight render, `fn` re-executes every time whether
`A` is null or stale. `grep -rln getCacheForType node_modules/next/dist/server/`
returns **nothing**: Next establishes no cache scope of its own.

A Server Action body is invoked at
`next/dist/server/app-render/action-handler.js:888`:

```js
await workUnitAsyncStorage.run(requestStore, () => action.apply(null, args));
```

— Next's storage, with no React dispatcher setup. In `middleware.ts` the *client*
React build resolves, whose `cache` is an unconditional passthrough
(`react/cjs/react.development.js:917-921`).

Next's own docs corroborate the boundary in the fetch-memoization language:
*"Memoization does not apply inside Route Handlers since they are outside the
React component tree"*; *"memoized during a single server render pass"*.

**Consequence:** `cache()` keeps doing useful work on the render path — it is why
the GET number is 3 and not 5 — but it must stop being load-bearing.

#### B. Memoize on `getCloudflareContext()` — viable, and lands in one file

**Production (workerd).** `@opennextjs/cloudflare/dist/cli/templates/init.js:11-24`
holds an `AsyncLocalStorage` whose store is `{ env, ctx, cf }`, entered by
`runWithCloudflareRequestContext(request, env, ctx, handler)`; `.open-next/worker.js`
wraps the **entire** request in it. So the object is **fresh per invocation** and
stable for the whole request — render, action, route handler, and `waitUntil`
continuations, since ALS propagates through the promise chain.

**Dev.** `initOpenNextCloudflareForDev()` (called at `next.config.ts:8`) runs
`getPlatformProxy()` **once** and assigns `global[cloudflareContextSymbol]` as a
plain data property — a **process-global singleton**, mutable and extensible
(replicated in-process this session).

Sketch — no call site changes:

```ts
const DB = Symbol.for("sprintflow.requestDb");
export function getDb(env?) {
  const cf = tryGetCloudflareContext();          // undefined outside a request
  if (!cf) return getDbWithPool(env).db;         // cron, CLI, tests, eval script
  return (cf[DB] ??= getDbWithPool(env ?? cf.env)).db;
}
```

Three constraints the plan must carry:

- **The `tryGetCloudflareContext()` fallback is mandatory, not defensive.**
  `src/worker.ts:43-47` calls `runScheduledSync(env, ctx)` **outside**
  `runWithCloudflareRequestContext`, so `getCloudflareContext()` throws on the
  cron path. It also throws in SSG and at module top level — which is why
  `export const auth = createAuth()` (`auth.ts:167`) and the eval script need it.
- **`max: 1` (`src/lib/db.ts:16`) stops being defensible.** It is sized for a
  per-call pool. Under B it becomes per-request on Workers (keep 1 — Hyperdrive
  pools upstream) and **per-process in dev**, where 1 would serialise every
  concurrent request through a single connection. The value should come from
  wherever the connection string is resolved.
- **Nobody may `.end()` the shared handle.** A `pool.end()` on it poisons the
  dev server for its remaining lifetime (`"Cannot use a pool after calling end on
  the pool"` — named in Cloudflare's own troubleshooting page). `getDb` and
  `getDbWithPool` must stay strictly separate, as they are today.

#### C / C′. Own `AsyncLocalStorage`

Availability is not the issue — the adapter itself runs on ALS in workerd. The
**entry point** is: on Workers one already exists (rolling our own collapses into
B), and in `next dev` there is nothing to wrap — `open-next.config.ts` declares no
middleware/wrapper override, `next.config.ts` runs once at startup, and
`middleware.ts` returns before the render.

**C′ is worth recording as the fallback if B is rejected.** Both the render
(`app-render`) and the action (`action-handler.js:888`) run under the *same*
`requestStore`, and `headers()` results are WeakMap-cached on it
(`next/dist/server/request/headers.js:135,146,151`) — so `await headers()` has
stable object identity across render *and* action within one HTTP request,
making `WeakMap<Headers, PoolHandle>` a real per-request key. It is
**undocumented internal behaviour**, it makes `getDb` async, and it still needs
the Workers path for `route.ts`. Strictly worse than B.

#### D. Explicit threading — ruled out by a structural fact

`(app)/layout.tsx:32-33` calls `requireSession()` **and** `resolveWorkspace()`;
the page it wraps (`dashboard/page.tsx:51`) does the same plus its own `getDb`.
**The layout and the page are separate React entry points in one request with no
lexical parent** where a single handle could be constructed and handed to both.
There is nowhere to thread *from* without a request-scoped holder underneath.
Threading a per-call `db` into `resolveWorkspace(db)` would also defeat its own
`cache()` key.

The house pattern is already correct *below* the seams — 39 files declare a local
`type Db` (35 verbatim `ReturnType<typeof getDb>`) and 91 function signatures
accept `db: Db`. The gap is only *at* the three seams, and B closes it without
touching a single signature.

#### E. Driver-level / singleton — ruled out on Workers by documentation

Cloudflare, verbatim (Hyperdrive → *Connection lifecycle*, fetched 2026-08-30):

> *"You should always create database clients inside your request handlers
> (`fetch`, `queue`, and similar), not in the global scope. … Using a
> driver-level pool (such as `new Pool()` or `createPool()`) in the global script
> scope will leave you with stale connections that result in failed queries and
> hard errors."*

> *"No need to call `client.end()` — Hyperdrive automatically cleans up the client
> connection when the request ends."*

A dev-only singleton is not a separate option: **B degrades to exactly that in
dev**, without a runtime branch. An explicit two-runtime split would need a
discriminator plus two code paths in `db.ts` of which **only one is ever
exercised by CI** (there is no Workers job; `Workers Builds` comes from the
Cloudflare app and runs no suite) — an untested branch guarding production.

### 4. Test surface

- **Projects.** `vitest.config.ts` (unit, hermetic, excludes `*.integration.test.ts`);
  `vitest.integration.config.ts` (`fileParallelism: false`, setup guard at
  `test/integration/setup.ts:33-40` refusing any non-`127.0.0.1:54322` DSN);
  `playwright.config.ts` (`workers: 1` unconditionally, `fullyParallel: true`,
  `webServer` boots the GitHub fixture, the Jira fixture and `npm run dev`);
  `stryker.conf.json` mutates only the anomaly rules — **`db.ts` is invisible to
  mutation testing**.
- **Nothing tests `db.ts`.** There is no `db.test.ts`. `workspace.test.ts` mocks
  `requireSession` to throw before `resolveWorkspace` ever reaches `getDb`.
- **Highest blast radius: six `*.demo.test.ts` files** (`setup/{github,jira,team}`,
  `settings/{connections,recap}`, plus `sync/actions.test.ts`) `vi.mock("@/lib/db")`
  with a `getDb` that **throws**, encoding "a demo-refused action must never open
  a DB handle". That assertion is coupled to today's per-seam call shape.
- **`src/lib/auth.test.ts:15-17`** rests on an explicit premise: *"`getDb`
  constructs a `pg.Pool` lazily and opens no connection until a query runs"*. Any
  fix that connects eagerly at construction breaks this file.
- **`sync/actions.test.ts`** is the only test exercising the pool-teardown
  contract (`getDbWithPool` not called when refused; `pool.end()` called after
  use) — it must move in lockstep with any change to `getDbWithPool`.
- **30 `*.integration.test.ts` files build their own `Pool` directly** and close
  it in `afterAll`; none import `@/lib/db`, so none constrain its signature.
- **No test anywhere counts connections** — zero `pg_stat_activity` hits in the
  test tree. The 3-pools finding was measured by hand.
- **CI never runs E2E.** `.github/workflows/ci.yml` has three jobs (`test`,
  `integration`, `bundle-size`); no workflow invokes Playwright.

### 5. The wrong lesson's blast radius

`frame.md` named four propagation sites. The sweep found the claim, or a design
decision derived from it, in:

- **Source of the error**: `context/foundation/lessons.md:19-24`, originating in
  `context/archive/2026-06-14-setup-github-integration/reviews/impl-review.md:56-58`
  (S-02 F3, "ACCEPTED-AS-RULE").
- **Roadmap, twice**: `context/foundation/roadmap.md:568` and the S-21 entry at
  `:691-720`, whose entire *Outcome* and *"the naive fix is wrong"* rationale is
  written against the unbounded-leak mechanism.
- **The `getDb` / `getDbWithPool` split itself** — `src/lib/db.ts:4-25` justifies
  it by lesson #3, and S-05's plan (`archive/2026-08-20-data-sync-engine/plan.md:93`)
  explicitly scoped the fix to the cron path for that reason.
- **~15 source comments** citing "lessons.md #3" as an architectural constraint:
  `dashboard/page.tsx:68,85,108,117`, `recap/build.ts:37-38`, `recap-settings.ts:66-68`,
  `measurement/reader.ts:155`, `sync/scheduled.ts:18,202-204`, `sync/actions.ts:28`,
  `api/webhooks/resend/route.ts:33,102`, and `workspace.ts:146-149`.
- **`playwright.config.ts:42-49`** — the `workers: 1` pin, whose comment states the
  wrong mechanism ("still leaks its `pg.Pool` per invocation").
- **One unticked manual-test row**: `context/foundation/manual-test-backlog.md:1517-1524`
  (row 13.2), whose rationale is written against "pule per-request, które nigdy nie
  są zamykane".
- **`change.md:12` is now stale against its own sibling `frame.md`** and still
  states the old framing as fact.

**Two clusters must NOT be swept up in the correction** — they are different,
still-valid rules that merely share vocabulary:

1. **Reads-before-transaction (F1)** — `roster-store.ts:51-52`,
   `reconcile-sprint.ts:29-30`, `absence-store.ts:139-140`: a `fetch` nested in a
   live transaction pins a connection *for the network duration*. True, and
   unrelated to the isolate-lifetime claim.
2. **Never cache one auth instance across invocations** —
   `api/auth/[...all]/route.ts:10`. Also true, also distinct.

**A prescient find:** `context/archive/2026-08-19-onboarding-routing/research.md:91`
already wrote *"a `/dashboard` request already opens three pools that are never
closed"* — the correct **number**, wrapped in the wrong **noun**. The multiplicity
was visible a slice before it was understood.

## Code References

- `src/lib/db.ts:11-28` — `getDbWithPool` / `getDb`; `max: 1` at `:16`; the
  `?? process.env.DATABASE_URL` fallback at `:13` that dev never reaches
- `src/lib/auth.ts:72` — seam 1, inside `createAuth`; `:167` module-scope
  `auth = createAuth()`; `:182-194` `getOptionalSession` (`cache()`d, fail-closed)
- `src/lib/workspace.ts:110-167` — seam 2; `:117` the `getDb` call; `:146-149` the
  comment shaped by the wrong mechanism
- `src/app/(app)/dashboard/page.tsx:51` — seam 3, representative render
- `src/app/(app)/settings/connections/actions.ts:49-55,86` — the 4-pool action
- `src/app/(app)/setup/team/actions.ts:222,259,285,323,381,407,430,452,479` — nine
  independent handles in one file
- `src/lib/integrations/sync/scheduled.ts:97,200-204` and `sync/actions.ts:99,138-142`
  and `api/webhooks/resend/route.ts:88,102` — the only three `pool.end()` sites
- `src/worker.ts:38-48` — `scheduled` runs **outside** the request context wrapper
- `middleware.ts:41-54` — cookie-only gate, no DB
- `next.config.ts:8,24` — `initOpenNextCloudflareForDev()`; `serverExternalPackages`
- `wrangler.jsonc:6-33` — `compatibility_date: 2026-05-23`, `nodejs_compat`,
  dummy `localConnectionString`
- `playwright.config.ts:42-50` — the `workers: 1` pin and its comment
- `.github/workflows/ci.yml` — three jobs, no Playwright
- `node_modules/react/cjs/react.react-server.development.js:575-578` — `cache()` passthrough
- `node_modules/next/dist/server/app-render/action-handler.js:888` — action body invocation
- `node_modules/@opennextjs/cloudflare/dist/cli/templates/init.js:11-24` — the request ALS

## Architecture Insights

- **`cache()` was doing a job nobody knew it was doing.** The GET cost is 3 rather
  than 5 purely because `getOptionalSession` and `resolveWorkspace` are memoized.
  That masked the action path, where the same code costs 4. Any reasoning about
  "how many pools per request" that does not name the surface is unsound.
- **The seam is one level too low.** The house pattern (`type Db` threaded into
  stores) is right and used in 91 signatures; it simply stops at the three places
  that *construct*. The fix is to give the constructor an identity, not to change
  the pattern.
- **Two runtimes, one correct answer.** Cloudflare's convention (fresh client per
  invocation, never a global pool, no manual close) and Node's convention (one
  long-lived pool, idle-reclaimed) look opposed — but memoizing on the adapter's
  own context object satisfies both *without a runtime branch*, because that
  object is per-invocation on Workers and per-process in dev.
- **Fail-closed hides resource exhaustion as a security event.** `getOptionalSession`
  catches the `53300` error and returns `null`, so a valid session becomes "not
  signed in" → redirect to `/login`. That is why this read as flake for weeks, and
  under the PRD's graceful-degradation guardrail it is the wrong degradation.
- **An untested branch guarding production is worse than an asymmetry.** CI has no
  Workers job, so any `if (workers) … else …` in `db.ts` would ship unexercised.

## Historical Context (from prior changes)

- `context/archive/2026-06-14-setup-github-integration/reviews/impl-review.md:56-58`
  — S-02 F3, where the wrong mechanism was accepted as a rule
- `context/archive/2026-08-20-data-sync-engine/plan.md:93` — S-05 deliberately fixed
  only the cron path, creating the `getDbWithPool` split
- `context/archive/2026-08-19-onboarding-routing/research.md:91` — "three pools"
  named correctly, framed as a leak
- `context/archive/2026-08-30-destructive-action-confirmation/reviews/impl-review.md:76-98`
  — S-24 F2, nine more gated actions; its own blind spot ("have not measured the
  real per-request pool count") is now closed
- `context/deployment/deploy-plan.md:55` — the Hyperdrive counter-argument the repo
  held all along without joining it up
- `context/foundation/roadmap.md:568,691-720` — the S-21 entry to be rewritten

## Related Research

- `context/changes/db-pool-teardown/frame.md` — the reframing this builds on
- `context/archive/2026-08-20-setup-team-roster-cadence/research.md:55` — cites
  `lessons.md:19-24` as the source of the *reads-before-transaction* rule,
  conflating two distinct concerns
- `context/archive/2026-08-21-dashboard-today/research.md:184` — established the
  `getDb`-on-render / `getDbWithPool`-on-cron rule

## Decisions Taken (2026-08-30, post-research)

### D1 — `max` has one home, not two. The question was mis-posed.

`pg-pool` calls `newClient` **only** from `connect()`, when a query is pending and
no idle client exists (`node_modules/pg-pool/index.js:167,235`); the constructor
opens nothing. **`max` is a ceiling, not an allocation**, so one value is correct
on both runtimes and no runtime branch is needed. Two consequences:

- **`max: 1` is already a latency defect today**, independent of S-21: the
  dashboard's 8-way `Promise.all` (`dashboard/page.tsx:87-105`) serialises through
  a single connection on every render.
- **The multiplier does not shrink — it disappears.** In dev the memoised pool is
  process-global, so a fixed ceiling (~10–20) bounds the *entire dev server*
  regardless of request rate. `frame.md` framed the win as 3× headroom; it is
  stronger than that — the acceptance test stops depending on burst rate at all,
  and the measured ~68-connection budget stops being the binding constraint.

Choosing the exact number is throughput tuning, not architecture.

### D2 — Distinguishing "no session" from "could not tell" ships in S-21, as its own phase.

**The defect is sharper than `frame.md`'s "fail-closed hides exhaustion".**
`getOptionalSession` returns `null` for two different facts, and its two consumers
read that `null` in **opposite** directions, each documented as correct:

- `src/lib/auth.ts:173-176` — *"fail-closed"* → `requireSession` redirects to
  `/login`. All **31** `requireSession()` call sites funnel through here.
- `src/app/(auth)/layout.tsx:18` — *"fail-open: on a DB error it returns null and
  we render the auth page rather than trapping the user out of login"* → renders
  `/login`.

Under a DB error **both** fire: the signed-in user is bounced to `/login`, and
`/login` renders happily. One `null`, two meanings, and the silent sign-out sits
in the gap between them.

**This is an already-accepted house rule, not a new product decision.**
`lessons.md` — *"A narrowing predicate turns 'wrong value' into 'empty result',
which reads as success"* — states that an error must never be reported as an
ordinary negative result. This code predates the lesson.

**Scope is small and bounded**: `getOptionalSession` has exactly **two** real
consumers, and there is **no `error.tsx` anywhere in `src/app`** — a gated render
that throws currently has no boundary at all. The phase is: give the error case a
distinct return, route it at the two consumers, add the missing boundary. **No new
UX design.**

**Recorded caveat**: the PRD's graceful-degradation guardrail is written about
Jira/GitHub being unreachable, not about the app's own database, so the PRD does
not compel this. The argument is the house lesson plus the fact that this is why
the defect stayed invisible for weeks — without it, S-21's acceptance test can go
green while the diagnostic stays broken.

## Open Questions

1. **The Server Action pool count (4 + re-render) is derived from source, not
   measured.** The reading is solid — `action-handler.js:888` and React's
   `cache()` passthrough were both read at the cited lines this session — but
   `frame.md` set a standard of measuring, and this number has not met it.
   Measuring it needs a live authenticated session; the E2E harness cannot be used
   casually because `e2e/accounts.ts` issues `delete from "user"` against local
   Supabase.
2. **All Workers-runtime behaviour rests on adapter source + Cloudflare docs, never
   on observation.** Unchanged from `frame.md`'s own note, and consistent with the
   user having never seen this deployed.
3. **How is the fix proven, given CI never runs E2E?** The named acceptance test
   is human-run only. Whether a hermetic regression test (spy on the factory,
   assert the three seams receive one handle) is worth building — and whether it
   can be written without the eager-connect that `auth.test.ts:15-17` forbids — is
   a plan decision.
4. **Does the `getDb` / `getDbWithPool` split survive?** It exists because of the
   wrong lesson. Under mechanism B, `getDb` becomes the request-scoped handle and
   `getDbWithPool` the explicitly-owned one — the same two names for genuinely
   different reasons. Whether to rename rather than re-document is open.
5. **What exact `max`?** Settled as a single value (D1); the number itself
   (~10–20) is a throughput judgment for the plan.
