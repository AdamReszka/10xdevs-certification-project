<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Request-Scoped Identity for the `db` Handle (S-21)

- **Plan**: `context/changes/db-pool-teardown/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed)
- **Findings**: 2 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict | After triage |
|-----------|---------|--------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

15/15 existing paths ✓ (the 3 new-file paths correctly absent); symbols ✓
(`getDb`/`getDbWithPool` in `db.ts`, `createAuth` at `auth.ts:72`,
`resolveWorkspace` at `workspace.ts:117`, `runScheduledSync` outside
`runWithCloudflareRequestContext` at `worker.ts:43-47`, `workers: 1` at
`playwright.config.ts:50`); Progress 39/39 rows ↔ 39 criteria bullets, 5/5 phases
matched, no stray checkboxes; brief↔plan ✓. No `docs/reference/contract-surfaces.md`
in this repo, so the contract-surface sweep was skipped.

Claims re-verified and **confirmed** (no finding raised): no `*.integration.test.ts`
imports `@/lib/db`; nothing in `src/`, `e2e/` or `test/` touches
`Symbol.for("__cloudflare-context__")`, so `db.test.ts` can own that global;
`getOptionalSession` has exactly two consumers (`auth.ts:205`, `(auth)/layout.tsx:28`);
client forms wrap Server Action calls in `try/catch`
(`github-connect-form.tsx:96` and eight siblings), so Phase 4's "the form reports
a failure" holds.

## Findings

### F1 — "One connection per request" is not what POOL_MAX = 10 delivers

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 2 §1; Phase 3 §2; Performance Considerations
- **Detail**: The plan counts *pools* while its success criterion, its instrument
  (`pg_stat_activity`) and its failure mode are all about *connections*. Today 3
  pools × `max: 1` = 3 connections per authenticated GET. After: 1 pool ×
  `max: 10`, and `dashboard/page.tsx:87-105` fans out 8-way on that one handle, so
  a render draws up to 8 connections. Phase 3's "GET 3 → 1 per request" therefore
  cannot be observed, and on Workers (per-invocation ceiling) the per-request
  count rises. In `next dev` the process-global cap still saves the E2E run — so
  Phase 3 could go green while the headline claim was false.
- **Fix A ⭐ Recommended**: Restate the end state and Phase 3's expectation in the
  units the instrument measures.
  - Strength: Keeps the well-evidenced mechanism; makes the proof honest — the win
    is that connections stop scaling with pool multiplicity and are bounded by one
    ceiling.
  - Tradeoff: Less dramatic headline; the dev-vs-Workers asymmetry must be stated.
  - Confidence: HIGH — verified against `dashboard/page.tsx:87-105` and `pg-pool`'s
    connect-on-demand semantics.
  - Blind spot: The Server Action path fans out less; its real after-count is still
    underived.
- **Fix B**: Keep the "one connection" goal and size `POOL_MAX` to 1–2.
  - Strength: The criterion survives verbatim.
  - Tradeoff: Re-introduces the `max: 1` latency defect the plan wants removed.
  - Confidence: MEDIUM — the render's latency at 1 vs. 10 is unmeasured.
- **Decision**: FIXED via Fix A — Desired End State and Phase 3 §2 rewritten in
  connections; `plan-brief.md` end state and success-criteria bullet updated.

### F2 — `error.tsx` prop `retry` does not exist in the installed Next 16.2.6

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries; Phase 4 §3
- **Detail**: The plan recorded as a Key Discovery that the props are
  `{ error, retry }` — "`retry`, not `reset`, in Next 16". The installed version
  is 16.2.6, whose own type is `{ error, reset, unstable_retry }`
  (`next/dist/client/components/error-boundary.d.ts:3-7`). Next's docs explain the
  mismatch: `retry` was added as *unstable* in 16.2.0 and became stable only in
  16.3.0 — the plan read canary docs. An implementer following it ships a button
  wired to `undefined`, which Progress row 4.6 would not catch since the surface
  still renders.
- **Fix**: Phase 4 §3 uses `{ error, reset }` and wires the control to `reset()`;
  Key Discoveries records that `retry` arrives in 16.3.
- **Decision**: FIXED

### F3 — One POOL_MAX serves two incompatible ceilings, and 10 exceeds Cloudflare's guidance

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 contract; Performance Considerations
- **Detail**: The plan asserted "on Workers the ceiling is per-invocation and
  Hyperdrive pools upstream, so 10 costs nothing there." Cloudflare's own
  Hyperdrive + node-postgres example sets `max: 5`, commented *"due to Workers'
  limits on concurrent external connections"*; platform limits allow six
  simultaneous connections per invocation before the seventh queues. Research D1
  correctly killed the *allocation* argument for a runtime branch but never
  settled the *ceiling* argument — which is exactly where the runtimes diverge: on
  Workers a per-invocation budget capped near 5–6, in `next dev` the entire dev
  server's budget across all parallel Playwright workers. `POOL_MAX` is also
  inherited by `getDbWithPool`, so `runScheduledSync` (`scheduled.ts:97`) picks it
  up on the cron path.
- **Fix A ⭐ Recommended**: `POOL_MAX = 5`, and Phase 3 verifies dev headroom
  explicitly.
  - Strength: Matches vendor guidance for the runtime that ships to production and
    is never exercised in CI; keeps the no-runtime-branch decision intact.
  - Tradeoff: 5 is the whole dev server's budget under parallel workers with an
    8-way fan-out per render; Playwright's 30 s timeout is the failure surface.
  - Confidence: HIGH on the Workers number; MEDIUM on the dev side, which nobody
    has run.
  - Blind spot: Whether 5 is enough for parallel workers is unmeasured — which is
    what new Progress row 3.7 now tests.
- **Fix B**: Two constants, one per runtime role.
  - Strength: Each role gets a defensible number.
  - Tradeoff: Reverses the plan's own "no runtime branch" decision, whose reasoning
    still stands.
  - Confidence: MEDIUM.
- **Decision**: FIXED via Fix A — `POOL_MAX` 10 → 5 in the contract and the
  snippet; Performance Considerations rewritten around the two roles; new Phase 3
  criterion + Progress row 3.7 for dev headroom, with the escalation path (split
  the constant, don't raise the shared value above 5).

### F4 — First-construction-wins invariant omits the one caller that constructs first

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details → "Debug & observability"; plan-brief Open Risks
- **Detail**: The stated invariant was "every request-path caller passes
  `getCloudflareContext().env`, so first-construction wins is safe."
  `src/lib/auth.ts:167` — `export const auth = createAuth()` — is not a
  request-path caller and passes no env; `createAuth` calls `getDb(env)` at
  `auth.ts:72`. On Workers this is harmless (module scope has no ALS store → the
  accessor throws → fallback). In `next dev` it is the opposite:
  `initOpenNextCloudflareForDev` has already installed the global context, so the
  schema-gen export becomes the process-global pool for the whole dev server and
  every later `getDb(env)` silently ignores its own `env`. Benign today only
  because `wrangler.jsonc:32`'s `localConnectionString` is a placeholder and both
  paths fall through to `DATABASE_URL`; not benign under `npm run preview`.
- **Fix**: The static `auth` export builds its handle with `getDbWithPool().db` so
  it never populates the memo; the invariant is restated to name the module-scope
  caller instead of claiming all callers are request-path.
- **Decision**: FIXED — new Phase 2 §3 (the test moves to §4), an added
  `db.test.ts` case asserting the static export leaves `ctx[REQUEST_DB]` unset,
  and the brief's Open Risks bullet rewritten.

### F5 — Phase 1's committed measurement script is heavy for what it proves

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 (whole phase); plan-brief "Phases at a Glance"
- **Detail**: Phase 1 shipped a committed CLI — argument parsing,
  `pg_stat_activity` sampling partitioned by `application_name`/`usename`, a
  local-DSN guard mirroring `test/integration/setup.ts:33-40` — plus a
  deliberately created disposable account, and the brief said Phases 1 and 5 carry
  most of the wall-clock. Its whole output is two numbers in a markdown file. The
  binding acceptance tests are elsewhere and cheaper: `db.test.ts` (the only part
  that runs in CI) and Phase 3's `npm run test:e2e` with `workers` unpinned and no
  `53300`. After F1, the script's headline output is also no longer the number the
  plan predicted.
- **Fix**: Keep the measurement, drop the artifact — a throwaway scratchpad snippet
  recorded in the phase notes, nothing committed under `scripts/`; the local-DSN
  guard stays, as the first thing written.
- **Decision**: FIXED — Phase 1 §1 rewritten as a procedure, its success criteria
  and Progress rows renumbered (1.1–1.5), Phase 3 §2 and the Testing Strategy step
  updated to reference the snippet.
