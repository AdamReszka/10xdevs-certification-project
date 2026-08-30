# Request-Scoped Identity for the `db` Handle (S-21) — Plan Brief

> Full plan: `context/changes/db-pool-teardown/plan.md`
> Frame brief: `context/changes/db-pool-teardown/frame.md`
> Research: `context/changes/db-pool-teardown/research.md`

## What & Why

One authenticated request builds **three independent `pg.Pool`s** — `createAuth`,
`resolveWorkspace` and the page/action body each call `getDb` — and holds all
three open at once, so concurrency costs 3× what it should. A Server Action costs
**four**, because React `cache()` is inert outside a Flight render. `getDb` has no
per-request identity; teardown is not what is missing.

## Starting Point

`src/lib/db.ts` builds `new Pool({ max: 1 })` on every call. The two resolvers
each construct a handle internally and neither exposes it, so the page that calls
both still has to build a third. The local Playwright suite hits Postgres's
connection ceiling mid-run and `playwright.config.ts:50` pins `workers: 1` as a
workaround. The failure is invisible as itself: `getOptionalSession` catches the
`53300` error and returns `null`, so a valid session silently becomes a redirect
to `/login` — which is why this read as flake for weeks.

## Desired End State

An authenticated `GET` and an authenticated Server Action each build **one**
pool for the app instead of three or four, so connections stop scaling with pool
multiplicity and are bounded by one ceiling. The per-request *connection* count
does not fall to one — the dashboard's 8-way fan-out draws up to `POOL_MAX` from
the shared handle. Playwright runs parallel workers
locally again and the suite passes. When the database really is unreachable, a
gated route shows an error surface instead of pretending the user signed out. And
`lessons.md` #3 describes the mechanism that actually exists, so the next slice
stops inheriting the wrong constraint.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the defect is | Pool **multiplicity**, not lifetime | Measured: 63 → 3 connections in ~14 s with no code change, so `pg.Pool`'s idle timer already reclaims — the quantity that breaks the suite is *concurrent* pools | Frame |
| Teardown | Dropped entirely | Node reclaims on the idle timer; Hyperdrive cleans the client up when the invocation completes — the after-hook that made the naive fix wrong comes off the table | Frame |
| Sharing mechanism | Memoize on `getCloudflareContext()` | Per-invocation on Workers, process-global in dev — one line satisfies both conventions with no runtime branch, and touches zero call sites | Research |
| React `cache()` | Ruled out | Provably inert in a Server Action, and 36 of 59 call sites are Server Actions | Research |
| Runtime branch in `db.ts` | None | CI has no Workers job, so `if (workers) … else …` would ship an unexercised branch guarding production | Research |
| `max` | One constant, **5** | Cloudflare's own Hyperdrive + `pg` number (Workers allows six simultaneous connections per invocation); the ceiling is the one quantity that differs between the runtimes, so the runtime CI never exercises sets it | Plan review |
| Regression test | Hermetic `src/lib/db.test.ts` | The only thing that runs in CI and guards the new invariant; a connection-counting test would depend on Supabase's idle count and `idleTimeoutMillis` | Plan |
| `getDb` / `getDbWithPool` | Names kept, docblocks rewritten | Zero call-site churn is the mechanism's whole argument, and six demo tests mock `getDb` by name | Plan |
| Wrong-lesson correction | Full sweep in this slice | ~14 source comments citing lesson #3 are what the next implementer reads at the moment of decision | Plan |
| Proof | Measured before **and** after | The Server Action count was derived from source, not measured, and `frame.md` set the standard of measuring | Plan |

## Scope

**In scope:** the memo in `src/lib/db.ts`; a hermetic `db.test.ts`; a before/after
measurement (throwaway snippet, nothing committed under `scripts/`); restoring
parallel Playwright workers; distinguishing "no
session" from "could not tell" plus the app's first error boundary; correcting
`lessons.md` #3 and every place it propagated.

**Out of scope:** any request-path teardown; any call-site change (all 59 stay);
renaming either function; a runtime branch; switching the three legitimate
`pool.end()` owners to the shared handle; `global-error.tsx`; new UX design; a
connection-counting test in CI; the two valid rules that merely share this
vocabulary (reads-before-transaction, never-cache-auth).

## Architecture / Approach

`getDb` asks the OpenNext adapter for the current request context and caches the
constructed handle on that object under a `Symbol.for` key. On Workers the object
is the per-invocation ALS store `{ env, ctx, cf }`, so the memo is genuinely
per-request; in `next dev` it is the single object installed at startup, so the
memo is one process-global pool bounded by `POOL_MAX`. When no context exists —
the cron entry, SSG, module top level, unit tests — a `try`/`catch` falls back to
today's per-call construction. `getDbWithPool` is untouched and never reads the
memo, which is the structural guarantee that nobody can `.end()` the shared pool.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baseline measurement | The before-numbers for a GET and a Server Action, taken with a throwaway snippet — no committed instrument | Needs a live authenticated session; the E2E harness `delete from "user"`s, so the account must be made deliberately |
| 2. Request-scoped handle | The memo, `POOL_MAX = 5`, rewritten docblocks, `auth.ts:167` out of the memo, `db.test.ts` | The fallback must cover cron/SSG/module-top-level or the build and the scheduled handler break |
| 3. Prove it | After-measurement + `workers: process.env.CI ? 1 : undefined` | Two distinct non-failures to triage: a *test-isolation* defect (explicit rule in the plan), and dev-side pool contention at `POOL_MAX = 5`, which shows as a Playwright timeout rather than `53300` |
| 4. Session diagnostic | Three outcomes from `getOptionalSession`, routed at both consumers, plus `src/app/error.tsx` | The boundary must be root-level: Next's `error.js` does not catch throws from `layout.js` in the same segment, and the throw is in `(app)/layout.tsx`. Props are `{ error, reset }` on the pinned 16.2.6 — `retry` is 16.3+ |
| 5. Retire the wrong lesson | `lessons.md` #3, roadmap ×2, ~14 comments in 10 files, backlog row 13.2, `MANUAL-CHECKLIST.md` | Sweeping up the two valid clusters that share the vocabulary |

**Prerequisites:** F-02 (done). Local Supabase running; a disposable measurement
account that is not the one holding real tokens.
**Estimated effort:** ~2 sessions across five phases; Phase 2 is small, Phase 5
carries most of the wall-clock now that Phase 1 ships no artifact.

## Open Risks & Assumptions

- **All Workers-runtime behaviour rests on adapter source plus Cloudflare docs,
  never on observation.** Unchanged from `frame.md`; consistent with nothing ever
  having been seen on the deployed side. The dev half is measured.
- **CI never runs Playwright**, so the named acceptance test is human-run only.
  `db.test.ts` is the only part of the proof that runs on every PR.
- **In dev the pool becomes process-global**, so a stray `.end()` anywhere would
  poison the dev server for its remaining lifetime. Guarded structurally and by a
  unit-test case, but it is the one way this change can fail loudly.
- **First construction wins**, so every later caller under one context inherits
  the first caller's `env`. True and safe for all 59 request-path sites, which
  pass `getCloudflareContext().env`. The one exception — `auth.ts:167`'s
  module-scope `createAuth()`, which passes none and in `next dev` runs first — is
  taken out of the memo in Phase 2. A *future* request-path caller passing a
  different `env` mid-request would still silently receive the first pool.

## Success Criteria (Summary)

- An authenticated request and an authenticated Server Action each cost one
  **pool**, and measured peak connections stop scaling with concurrency — same
  instrument before and after, reported in connections.
- `npm run test:e2e` passes with parallel workers and no `53300` in the output.
- With the database down, a gated route shows an error surface and `/login` still
  renders — the failure stops impersonating a signed-out user.
