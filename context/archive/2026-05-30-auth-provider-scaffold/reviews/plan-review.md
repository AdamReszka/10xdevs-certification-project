<!-- PLAN-REVIEW-REPORT -->
# Plan Review: F-01 Auth Provider Scaffold

- **Plan**: context/changes/auth-provider-scaffold/plan.md
- **Mode**: Deep
- **Date**: 2026-05-30
- **Verdict**: REVISE → SOUND after fixes (all 6 findings fixed)
- **Findings**: 1 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F2) → fixed |
| Blind Spots | WARNING (F5, F6) → fixed |
| Plan Completeness | FAIL (F1, F3, F4) → fixed |

## Grounding
6/6 paths ✓ (package.json, wrangler.toml, src/lib/db.ts, src/db/schema.ts, drizzle.config.ts, next.config.ts), created paths correctly absent (proxy.ts, src/lib/auth.ts, route handler, .env.example), symbols ✓ (getDb/HYPERDRIVE, drizzle-orm ^0.45.2), compat date 2024-12-01, brief↔plan ✓. Progress format valid (1 section, 3 phases matched, no stray checkboxes). No contract-surfaces.md or lessons.md.

## Findings

### F1 — Static handler contract contradicts per-request async instance

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Change #1 (catch-all handler)
- **Detail**: `export const { POST, GET } = toNextJsHandler(auth)` evaluates `auth` at module load, before any request/env exists — contradicts "build per-request from getCloudflareContext().env". Documented OpenNext+Better Auth pattern is async: build per request inside the handler, then delegate to toNextJsHandler.
- **Fix**: Rewrite Phase 3 #1 to async POST/GET that await `createAuth(getCloudflareContext().env)` and delegate; drop the top-level destructure.
- **Decision**: FIXED (Fix in plan)

### F2 — "No singletons" stated absolutely; the real rule is connection-scoped

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details — "Per-request instances"
- **Detail**: Plan cites Better Auth #969 to forbid all singletons, but zpg6's canonical example caches one safely — because it uses D1 (no persistent connection). Our hazard is caching a request-scoped `pg` Pool over Hyperdrive across invocations. Per-request `db` is right for us, but for the connection reason, not "no singletons".
- **Fix**: Reframe rule around the request-scoped DB connection; warn not to copy zpg6's D1 singleton (different driver).
- **Decision**: FIXED (Fix in plan)

### F3 — Drizzle-adapter import path asserted without confirming

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #1 / Phase 2 #1
- **Detail**: Plan asserts `better-auth/adapters/drizzle`, but the current ecosystem (zpg6 + adapter package.json) uses `@better-auth/drizzle-adapter`; path is version-dependent. Also adopt the proven single dual-mode `createAuth(env?)` shape.
- **Fix**: Don't assert path — use whichever matches installed version; adopt dual-mode createAuth(env?).
- **Decision**: FIXED (Fix in plan)

### F4 — Phase 1 smoke-test hashing import is vague

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Change #3 (smoke route)
- **Detail**: "Import the hashing the same way Better Auth does internally" is under-specified — the real function is hashPassword/verifyPassword from @better-auth/utils/password (post-#8685, native scrypt), DB-free.
- **Fix**: Name @better-auth/utils/password hashPassword + verifyPassword explicitly in the smoke route.
- **Decision**: FIXED (Fix in plan)

### F5 — Rate limiting / KV secondary storage not scoped out

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing
- **Detail**: Better Auth's default rate limiting is in-memory and resets across Worker invocations (needs KV). F-01 doesn't enable it, but nothing said so.
- **Fix**: Add "rate limiting (needs a KV namespace) — out of scope" to What We're NOT Doing.
- **Decision**: FIXED (Fix in plan)

### F6 — proxy.ts gating only verified at Phase 3

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 / Phase 3
- **Detail**: OpenNext docs confirm middleware runs in the worker and can return redirects (low risk), but it's only exercised in Phase 3. A trivial proxy-redirect check on Phase 1's already-deployed gate confirms the mechanism early.
- **Fix**: Add an optional "deployed proxy redirect fires" check to Phase 1 manual verification (+ Progress 1.8).
- **Decision**: FIXED (Fix in plan)
