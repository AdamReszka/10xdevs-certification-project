---
change_id: db-pool-teardown
title: Close the request-scoped pg.Pool at request end (fix per-invocation connection leak)
status: new
created: 2026-08-19
updated: 2026-08-19
archived_at: null
---

## Notes

Spun out of the S-02 (`setup-github-integration`) impl-review as finding F3. `getDb(env)` (`src/lib/db.ts:7-11`) builds `new Pool({ max: 1 })` per call and never `.end()`s it; every request/action/render (auth.ts createAuth/getOptionalSession, the S-02 Server Actions, gated page components) opens a Hyperdrive-backed connection that lives for the isolate's lifetime → under sustained traffic, connection exhaustion.

Systemic, pre-existing (not an S-02 regression). The naive fix is **wrong**: `ctx.waitUntil(pool.end())` inside `getDb` fires `pool.end()` immediately and closes the pool before the caller's queries run. Correct direction: reuse one pool per request (cached on request context) and tear it down exactly at request end via the Worker after-hook — without exposing the pool to call sites for manual closing (createAuth holds it for the instance's lifetime). Needs its own plan + test.

See `context/foundation/lessons.md` → "Request-scoped pg.Pool must be closed at request end, not leaked per invocation" and `context/changes/setup-github-integration/reviews/impl-review.md` F3.
