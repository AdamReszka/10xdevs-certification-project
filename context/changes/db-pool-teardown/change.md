---
change_id: db-pool-teardown
title: Close the request-scoped pg.Pool at request end (fix per-invocation connection leak)
status: preparing
created: 2026-08-19
updated: 2026-08-30
archived_at: null
---

## Notes

Spun out of the S-02 (`setup-github-integration`) impl-review as finding F3. `getDb(env)` (`src/lib/db.ts:7-11`) builds `new Pool({ max: 1 })` per call and never `.end()`s it; every request/action/render (auth.ts createAuth/getOptionalSession, the S-02 Server Actions, gated page components) opens a Hyperdrive-backed connection that lives for the isolate's lifetime → under sustained traffic, connection exhaustion.

Systemic, pre-existing (not an S-02 regression). The naive fix is **wrong**: `ctx.waitUntil(pool.end())` inside `getDb` fires `pool.end()` immediately and closes the pool before the caller's queries run. Correct direction: reuse one pool per request (cached on request context) and tear it down exactly at request end via the Worker after-hook — without exposing the pool to call sites for manual closing (createAuth holds it for the instance's lifetime). Needs its own plan + test.

See `context/foundation/lessons.md` → "Request-scoped pg.Pool must be closed at request end, not leaked per invocation" and `context/archive/2026-06-14-setup-github-integration/reviews/impl-review.md` F3. (Path corrected 2026-08-30 — that slice was archived, and the old `context/changes/...` path had stopped resolving.)

## The leak stopped being theoretical — 2026-08-30, during S-24

Two things happened while shipping S-24 (`destructive-action-confirmation`) that
this slice should start from rather than re-derive.

**1. It now breaks the test suite, reproducibly.** Adding a 15th Playwright test
pushed the E2E run past Postgres's 100 connection slots mid-run; specs failed
with `error: remaining connection slots are reserved for roles with the SUPERUSER
attribute`, surfacing as unrelated-looking UI assertion failures ("Jira
connected" never appears, a save reports "Couldn't save"). The 14-test baseline
on `main` was *already* failing this way intermittently at
`e2e/setup-doorstep.spec.ts:133` — it was read as flake, not as this leak.

Diagnosis worth keeping: pools are released when the dev server exits, so
`pg_stat_activity` looks healthy (~4 connections) between runs and only climbs
*within* a run. `pg.Pool`'s default `idleTimeoutMillis` is 10s, so the failure is
driven by request BURST RATE, not by a permanent leak — which is why serialising
the run fixes it and why the count looks fine afterwards.

**Workaround in place, with a named expiry:** `playwright.config.ts` now pins
`workers: 1` unconditionally (CI already did). All 15 specs pass in ~21s. The
comment there names this slice as the condition to revisit it. **Reverting that
line to `process.env.CI ? 1 : undefined` is a good acceptance test for S-21.**

**2. S-24 added nine more leaked pools.** Its Phase 3 put a `resolveWorkspace()`
demo guard in front of nine Server Actions on the Connections tab. That resolver
calls `getDb(env)` — i.e. the pool constructor — and React `cache()` is
per-REQUEST, so a Server Action shares nothing with the page render's cache.
Each gated action therefore opens one additional never-closed pool. The guard is
correct and follows the house pattern (`setup/team/actions.ts:181-187`); it just
lands squarely on this defect. Full write-up: S-24 impl-review **F2**,
`context/archive/2026-08-30-destructive-action-confirmation/reviews/impl-review.md`.

Consequence for planning: a fix that only covers the page-render path leaves the
Server Action path — now the bigger consumer — still leaking.
