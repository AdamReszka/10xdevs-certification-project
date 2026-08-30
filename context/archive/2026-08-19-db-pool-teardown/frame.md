# Frame Brief: Request-path DB pool teardown (S-21)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Under parallel Playwright workers the local Postgres runs out of connection
slots mid-run — `error: remaining connection slots are reserved for roles with
the SUPERUSER attribute` (SQLSTATE `53300`) — and the failures surface as
unrelated-looking UI assertions ("Jira connected" never appears; a save reports
"Couldn't save"). `playwright.config.ts:50` pins `workers: 1` unconditionally as
a workaround, naming this slice as the condition to revisit it.

## Initial Framing (preserved)

- **User's stated cause**: every `getDb(env)` builds `new Pool({ max: 1 })`
  (`src/lib/db.ts:14-18`) and nothing ever closes it, so each request / Server
  Action / gated render pins a Hyperdrive-backed connection **for the isolate's
  lifetime** → connection exhaustion under sustained traffic
  (`context/foundation/lessons.md:19-24`, S-02 impl-review F3).
- **User's proposed direction**: one pool per request, cached on request
  context, torn down exactly at request end via the Worker after-hook — without
  exposing the pool to call sites, because `createAuth` holds its handle for the
  instance's lifetime.
- **Pre-dispatch narrowing**: the E2E symptom and the Workers-production symptom
  are "**oba — to jedna wada**" (one defect seen twice); **no** connection
  pressure has ever been observed on the deployed side (no Hyperdrive metrics,
  no hosted-Supabase counts, no failed production request); scope is "**tylko
  ścieżki, które realnie bolą**".

## Dimension Map

1. **Pool lifetime** — the pool is never `.end()`ed, so connections accumulate
   without bound.  ← initial framing
2. **Pool multiplicity per request** — `getDb` is called several times inside
   one request, so N pools exist *simultaneously* regardless of teardown.
3. **Runtime mismatch** — the measured symptom is a Node/`next dev` phenomenon
   with no Hyperdrive in the path; the Workers claim is inherited, not verified.
4. **Failure presentation** — how exhaustion reaches the tester, i.e. why this
   was read as flake for weeks rather than as this defect.
5. **Test-harness connections** — the E2E helpers open their own `pg` clients
   and could be the real consumer.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Unbounded leak** (initial framing) | Measured against local Supabase with a real session cookie: one authenticated `GET /setup` → **3** app connections; **12 s later → 0**. A 20-request burst → 60 app connections; **~14 s later → 0**. `pg.Pool`'s default `idleTimeoutMillis` (10 s) reclaims every pool without any `.end()`. Nothing accumulates. | **WEAK** — real, but self-healing; not the mechanism |
| **2. Three pools per request** | `getOptionalSession` → `createAuth` → `getDb` (`src/lib/auth.ts:72,187`) = pool 1; `resolveWorkspace` → `getDb` (`src/lib/workspace.ts:117`) = pool 2; the page or action body → `getDb` (e.g. `dashboard/page.tsx:51`, `settings/connections/actions.ts:86`) = pool 3. Both resolvers are React-`cache()`d, but each still builds its **own** pool. Measured exactly: 1 req = 3 conns, 20 req = 60 conns, all held concurrently. | **STRONG** |
| **3. Runtime mismatch** | Hyperdrive docs (`concepts/connection-lifecycle`, fetched 2026-08-30): *"No need to call `client.end()` — Hyperdrive automatically cleans up the client connection when the request ends"*; cleanup fires *"when the request, invocation, Workflow, or Queue consumer completes"*; and *"Avoid using a global Pool instance, as Hyperdrive manages connection pooling internally."* Workers' own six-connection cap counts only sockets **awaiting response headers** and **queues** the excess rather than erroring (`workers/platform/limits`). In `next dev` there is no Hyperdrive at all — `getDb` falls through to `process.env.DATABASE_URL` (`db.ts:12-13`), the binding's `localConnectionString` being a dummy (`wrangler.jsonc:31`). The project already recorded the counter-argument and never joined it up: `context/deployment/deploy-plan.md:55` — *"Hyperdrive maintains a warm TCP connection pool … risking connection exhaustion"* **without** it. | **STRONG** |
| **4. Failure presentation** | Reproduced 22× in one run: the `53300` error is thrown inside `getSession`, caught by `getOptionalSession`'s fail-closed handler (`src/lib/auth.ts:189-192`), which returns `null`. A valid session becomes "not signed in" → redirect to `/login`. That is precisely why the E2E failures read as product bugs. | **STRONG** |
| **5. Test-harness connections** | `e2e/accounts.ts:122,173 / 185,190 / 200,205` and `e2e/dashboard-sprint-detail.spec.ts:366,376` each `connect()` one `pg.Client` and `end()` it in `finally`. The harness is not the consumer. | **NONE** — ruled out |

## Narrowing Signals

- **Direct reproduction, not inference.** 35 concurrent authenticated requests
  against `npm run dev` produced the exact E2E error 22 times. The S-24
  impl-review F2 recorded its blind spot as *"Have not measured the real
  per-request pool count"* — it is now measured: **three**.
- **The pools do get released.** 63 → 3 connections in ~14 s with no code
  change. "Leak" is the wrong noun; the quantity that breaks the suite is
  *concurrent* connections, and its multiplier is 3, not ∞.
- **The budget is ~68, not 100.** Local Supabase holds ~29 connections of its
  own at idle (PostgREST, realtime, storage, pg_cron, analytics) plus
  `superuser_reserved_connections`. At 3 per request the wall is ~22 concurrent
  requests; measured, 20 concurrent fit and 35 did not.
- **The user has never seen this deployed** — and per Hyperdrive's documented
  lifecycle they would not, which is consistent rather than lucky.

## Cross-System Convention

Cloudflare's convention for Hyperdrive is a **fresh client per invocation, not
closed by hand, and never a shared pool** — the platform owns the lifecycle.
The initial framing's convention (own the pool, tear it down in an after-hook)
is the convention for a *long-lived Node server*, which is what `next dev`
actually is. Neither convention asks for the same seam to build three handles
per request; the house pattern of threading one `db` handle down
(`Db = ReturnType<typeof getDb>` passed into stores — `github-store.ts:7,47`) is
already the right shape and simply stops at the three top-level resolvers.

## Reframed Problem Statement

> **The actual problem to plan around is**: one authenticated request builds
> **three independent `pg.Pool`s** — `createAuth`, `resolveWorkspace`, and the
> page/action body each call `getDb` — and holds all three open at once, so
> concurrency costs 3× what it should. `getDb` has no per-request identity;
> teardown is not what is missing.

Two consequences change the shape of the work. **First, the teardown half of
the proposed direction is unnecessary on both runtimes**: in Node, `pg.Pool`'s
10-second idle timer already reclaims every pool (measured, 63 → 3); on Workers
+ Hyperdrive, the platform cleans up the client when the invocation completes
(documented). The request-end after-hook — the element that made this "not a
one-liner", because `pool.end()` must not fire before the caller's queries run —
can come off the table, and with it the risk that made the naive fix wrong.
**Second, `lessons.md` #3 is wrong as written** and is actively steering design:
its Workers failure mode ("pins a Hyperdrive-backed connection for the isolate's
lifetime → connection exhaustion") predates Hyperdrive being provisioned and is
contradicted by both Cloudflare's docs and this repo's own
`deploy-plan.md:55`. It was cited by S-02 F3, S-04's research, S-24 F2 and the
`playwright.config.ts` comment; leaving it in place means the next slice
re-derives the same wrong constraint.

A third finding is not the problem but is why it stayed hidden: exhaustion
reaches the user as a **silent sign-out**, because `getOptionalSession` fails
closed. Under the PRD's graceful-degradation guardrail that is the wrong
degradation — worth a decision in planning, even if the answer is "leave it".

## Confidence

**HIGH.**

- The Node half is measured in this repo today: per-request pool count, the
  idle-timer reclaim, the 22 reproductions of the exact `53300` error, and the
  fail-closed path that hides it. Nothing here rests on inference.
- The Workers half rests on Cloudflare's **current** documentation rather than
  on observation — consistent with the user's answer that nothing has ever been
  seen on the deployed side, but worth stating as the one unmeasured claim.

## What Changes for /10x-plan

Plan **request-scoped identity for the `db` handle**, not pool teardown: one
handle per request, shared by the three seams that currently each build their
own (`auth.ts:createAuth`, `workspace.ts:resolveWorkspace`, and the page/action
body). The user's "only the paths that really hurt" scope resolves to those
three seams rather than to a sweep of 68 call sites — every gated path hurts
through the same three. Two items ride along: correct `lessons.md` #3 (and the
S-21 roadmap entry, which repeats it) so the isolate-lifetime claim stops
propagating, and decide what exhaustion should look like to a user given
`getOptionalSession`'s fail-closed catch. The acceptance test is already
written: restore `playwright.config.ts:50` to `process.env.CI ? 1 : undefined`
and have the suite pass.

## References

- Source: `src/lib/db.ts:11-28`, `src/lib/auth.ts:71-72,182-194`,
  `src/lib/workspace.ts:110-167`, `playwright.config.ts:42-50`,
  `wrangler.jsonc:19-33`, `middleware.ts` (short-circuits unauthenticated
  requests before any DB access — why an unauthenticated burst measures zero)
- Prior decisions: `context/foundation/lessons.md:19-24`;
  `context/archive/2026-06-14-setup-github-integration/reviews/impl-review.md` F3;
  `context/archive/2026-08-30-destructive-action-confirmation/reviews/impl-review.md` F2;
  `context/archive/2026-08-20-setup-team-roster-cadence/research.md:60`;
  `context/deployment/deploy-plan.md:55`; `context/foundation/roadmap.md:691-720`
- External: Cloudflare Hyperdrive — *Connection lifecycle* and *node-postgres
  troubleshooting*; Cloudflare Workers — *Platform limits § Simultaneous open
  connections* (both fetched 2026-08-30 via Context7)
- Investigation: run inline (measurement + reads), not via sub-agents — the
  evidence needed a live server and `pg_stat_activity`, not a code sweep. No
  TaskCreate ids.
