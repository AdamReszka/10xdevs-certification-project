<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Setup Wizard — GitHub Integration (S-02)

- **Plan**: context/changes/setup-github-integration/plan.md
- **Scope**: All phases (1–3), full plan
- **Date**: 2026-08-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run 2026-08-19: `npm run typecheck` clean, `npm run lint` clean, `npm test` 31 green (unit, DB-free), `npm run test:integration` 4 green against real Postgres (#3 no-leak success+failure, F4 re-connect FK, #4 IDOR). E2E (3.3) verified at implementation (50f8423), not re-run.

Positives verified firsthand: no token-leak path in return values / thrown errors / logs (zero `console.*` in changed source); ownership `eq(ownerId, session.user.id)` on every read/write; `requireSession()` before every mutation; F4 FK integrity correct (`id` omitted from `set`, persisted id via `.returning({ id })`, used inside one `db.transaction`); no XSS/SQL-injection (React-escaped JSX, Drizzle-parameterized, numeric repo id). Drift review: PASS (no scope creep; Server Action spike confirmed removed).

## Findings

### F1 — `encryptToken` called without threading `env`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/lib/integrations/github-store.ts:109 (+ store call path in actions.ts:141-152)
- **Detail**: `encryptToken(token, { ownerId, provider: PROVIDER })` omits the optional third `env` arg, so `getKey()` falls back to ambient `process.env.TOKEN_ENCRYPTION_KEY` (crypto.ts:55). This diverges from the codebase's env-injection pattern — `auth.ts` threads `env` into `createAuth`, and `getDb(env)` is threaded correctly in this very change (actions.ts:141-142). `crypto.ts` added the `env?` param explicitly ("Call sites land in S-02") precisely so callers would thread it.
- **Failure scenario**: if the OpenNext Cloudflare adapter does not mirror the `TOKEN_ENCRYPTION_KEY` Worker secret into `process.env` in production, `getKey()` throws `TokenCryptoError` on every store → `toFailure` maps it to a generic "Something went wrong" → no credential is ever saved. Fail-closed (no plaintext stored, no leak) but a silent, hard-to-diagnose break of the core feature. Works today locally because `.env.local` populates `process.env`.
- **Fix**: add an `env` param to `storeGithubIntegration` (and the service seam) and pass `getCloudflareContext().env` from the action through to `encryptToken(token, aad, env)`, matching the `getDb(env)` threading already present.
- **Decision**: FIXED — threaded `env?: StoreEnv` (HYPERDRIVE+TOKEN_ENCRYPTION_KEY, mirroring `auth.ts` AuthEnv) into `storeGithubIntegration` → `encryptToken(token, aad, env)`; action passes `getCloudflareContext().env`. typecheck green, integration suite still green (env optional).

### F2 — `GITHUB_API_BASE_URL` override honored in production (no guard)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security)
- **Location**: src/app/(app)/setup/github/actions.ts:68-71 (`githubOptsFromEnv`)
- **Detail**: `GITHUB_API_BASE_URL` is read in all environments with no `NODE_ENV`/production guard. Whatever host it names receives the user's PAT in the `Authorization: Bearer` header (github.ts:66-73). The doc comment says it is test-only, but nothing enforces that.
- **Failure scenario**: a stray or malicious `GITHUB_API_BASE_URL` set on the production Worker silently redirects every user's PAT to an attacker-controlled host — the code path is live, not gated. Defense-in-depth gap: requires the env var to be set, but there is no guardrail.
- **Fix**: only honor the override off-production — e.g. `if (process.env.NODE_ENV === "production") return undefined;` before reading the var, or allow-list it to `https://api.github.com` in prod.
- **Decision**: FIXED — added `if (process.env.NODE_ENV === "production") return undefined;` guard in `githubOptsFromEnv`. E2E unaffected (fixture runs under `npm run dev`, non-production).

### F3 — `getDb` builds a per-request `Pool({ max: 1 })` that is never closed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/db.ts:7-11 (consumed at actions.ts:141-163, page.tsx:20)
- **Detail**: Each request/action/page render opens a Hyperdrive-backed `pg.Pool` that is never `.end()`ed. **Pre-existing and systemic** — the established sibling pattern (also `auth.ts`), NOT introduced by S-02. Flagged because S-02 adds new call sites.
- **Failure scenario**: under sustained traffic, connections trend toward exhaustion within the isolate lifetime.
- **Fix (systemic, out of S-02 scope)**: close the pool via `ctx.waitUntil(pool.end())` (`getCloudflareContext().ctx`) or refactor `getDb` to a request-scoped singleton torn down at request end. Track as a cross-cutting fix / lesson rather than blocking S-02.
- **Decision**: ACCEPTED-AS-RULE — recorded as a lesson (`lessons.md`: "Request-scoped pg.Pool must be closed at request end") + spun out as a separate change `db-pool-teardown` (naive inline fix is unsafe — pool.end() at construction closes before queries run). Not fixed in S-02.

### F4 — Repo pagination loop has no page cap and no same-origin check

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security/performance)
- **Location**: src/lib/github.ts:183-207 (+ `nextLink` 151-158)
- **Detail**: The `Link: rel="next"` loop follows the next URL verbatim, re-fetching with the token attached, with no iteration cap and no origin check against `baseUrl`. Negligible against real `api.github.com`; compounds F2 if the base host is attacker-controlled (unbounded loop / PAT forwarded onward).
- **Fix**: cap iterations (e.g. ≤ 20 pages) and verify each `next` URL's origin matches `baseUrl` before re-fetching.
- **Decision**: FIXED + ACCEPTED-AS-RULE — added `MAX_REPO_PAGES = 20` cap + a base-origin check on each `next` link in `listRepos` (github.ts); recorded as lesson ("Cap and origin-check server-directed pagination loops that carry a secret"). typecheck + 31 unit tests green.

### F5 — Unexpected errors collapse to a generic message with no server logging

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability/observability)
- **Location**: src/app/(app)/setup/github/actions.ts:197-201 (`toFailure` default branch)
- **Detail**: DB failures, `TokenCryptoError`, etc. collapse to a token-free "Something went wrong" with no `console.error`. Good for the no-leak guardrail, but production failures are invisible.
- **Fix**: `console.error` the non-Github error (never contains the token — token is out of scope of DB/crypto error messages) before returning the generic failure.
- **Decision**: FIXED — added `console.error("[setup/github] unexpected integration error:", err)` in `toFailure`'s default branch. Integration #3 (targets the service core, not the action) unaffected.

### F6 — `githubTokenSchema` has no max length

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security, minor)
- **Location**: src/lib/validations/github.ts:19-24
- **Detail**: `token` validates only `min(1)` + `^gh[ps]_` prefix (no `.max()`). A multi-megabyte string passes and is sent to GitHub / into `encryptToken`. Trivial DoS surface only.
- **Fix**: add `.max(255)` (classic PATs are ~40 chars; 255 is safe headroom).
- **Decision**: FIXED — added `.max(255)` to `githubTokenSchema.token`.

## Notes (drift review — all benign, no action)

- `src/app/(app)/setup/layout.tsx` named in the plan but not created — gating comes from the existing `(app)/layout.tsx` and chrome from `SetupWizardShell`; the extra file was unnecessary. Intent met.
- `test:integration` loads `DATABASE_URL` from `.env.local` (with a hard `:54322`-only guard in `test/integration/setup.ts`) instead of an inline env prefix — a safer realization of the same intent.
- `storeGithubIntegration` re-validates the token + wraps writes in a transaction (not spelled out in the plan) — defensible: re-listing resolves authoritative `full_name`, and the transaction strengthens F4.
