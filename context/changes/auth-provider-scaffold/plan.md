# F-01 Auth Provider Scaffold — Implementation Plan

## Overview

Land the authentication foundation for SprintFlow using **Better Auth** on Cloudflare Workers: email+password with server-issued **database sessions + cookie cache**, the `user`/`session`/`account`/`verification` schema and its first migration, a catch-all auth route handler, and a `proxy.ts` route gate that redirects unauthenticated requests to `/login`. No user-facing pages — those land in S-01. The riskiest item (password hashing under `workerd`) is de-risked first by a deployed-Worker crypto smoke test that hard-gates the rest of the work.

This satisfies FR-001 (the auth substrate) and the PRD Access Control section (gated routes, cross-account isolation via session-carried user id).

## Current State Analysis

- **No auth anything.** No auth library, no `middleware.ts`/`proxy.ts`, no `src/app/api/`, no auth tables. `src/components/providers/` and `organisms/auth/` are `.gitkeep` placeholders (`research.md` Area 1).
- **DB is Supabase Postgres over Cloudflare Hyperdrive via `drizzle-orm/node-postgres` (`pg`)** — `src/lib/db.ts:1-12` reads `env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL`. This is the real driver; `infrastructure.md`'s Neon/HTTP mandate is **stale** (`research.md` Area 2). The Better Auth Drizzle adapter targets this `pg` instance directly.
- **`src/db/schema.ts:1-2` is an empty placeholder.** Sole migration `supabase/migrations/20260524085002_remote_schema.sql` is a bare extensions/grants baseline — zero tables.
- **Workers config:** `wrangler.toml` has `nodejs_compat`, `compatibility_date = "2024-12-01"`, a `[[hyperdrive]]` binding, and `[vars]` with only public keys. `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are already set as Workers secrets (`deploy-plan.md:223-224`); the auth secret is pending (`deploy-plan.md:225-230`).
- **No test framework** (deferred by decision — course timing). Verification leans on `npm run build` (type-checks), `npm run lint`, the OpenNext bundle build, and the deployed smoke test.
- **A ready-made crypto smoke-test recipe already exists** — `deploy-plan.md:344-352` (E2).

## Desired End State

A deployed Worker where:
- Hitting any gated path without a session **redirects to `/login`**; the public allowlist (`/login`, `/signup`, `/reset`, `/api/auth/*`, static assets) is reachable unauthenticated.
- `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`, and `GET /api/auth/get-session` work end-to-end against the real DB, with password hashing resolving to **native `node:crypto` scrypt** (no `exceededCpu`, no `@noble` fallback).
- The `user`/`session`/`account`/`verification` tables exist via an applied Drizzle migration, owned by F-01.
- `BETTER_AUTH_SECRET` is a Workers secret; no secret appears in `wrangler.toml`, logs, or client payloads.

**Verification:** the Phase 3 deployed sign-up → get-session → sign-out → gated-redirect cycle passes on `*.workers.dev`, and `npm run build` + `npm run lint` are clean.

### Key Discoveries

- **The hashing fix shipped.** `@better-auth/utils` PR #16 (merged 2026-03-09) added a `./password` module selecting native `node:crypto` scrypt on Node-capable runtimes; Better Auth core PR #8685 (merged 2026-04-01, needs `@better-auth/utils@^0.4.0`) adopted it, closing the Workers CPU-limit issue. **A `better-auth` ≥ 1.6.x with `nodejs_compat` resolves native scrypt** — making "default scrypt" the correct, low-risk choice.
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (function `middleware` → `proxy`); the proxy runtime is `nodejs` and cannot be configured to edge. OpenNext/Workers is Node-only, so `proxy.ts` is correct (Next.js 16.2.2 upgrade docs).
- **Catch-all handler:** `export const { POST, GET } = toNextJsHandler(auth)` from `better-auth/next-js` at `app/api/auth/[...all]/route.ts` (Better Auth docs).
- **Middleware pattern:** optimistic `getSessionCookie(request)` from `better-auth/cookies` in `proxy.ts` (fast, no DB hit — pairs with cookie cache), **plus** full `auth.api.getSession()` validation in gated server components (defense-in-depth; middleware alone is "NOT SECURE" per Better Auth docs and CVE-2025-29927).
- **Drizzle adapter** requires `drizzle-orm ^0.45.2` — project has exactly `^0.45.2` (`package.json:14`).
- **No module-level singletons on Workers** — the Better Auth + DB instances must be constructed per-request from `getCloudflareContext().env`, or Workers throws opaque "script will never generate a response" errors (recurring theme across Better Auth issue #969). A separate static `auth` export is needed only for the schema-gen CLI.

## What We're NOT Doing

- **No UI pages** — `/login`, `/signup`, `/reset` page components and the client session provider are S-01.
- **No working reset email** — `sendResetPassword` is stubbed to log the reset link; Resend transport is S-01/S-11.
- **No email verification** — `requireEmailVerification: false` for the MVP; hardening is a later slice.
- **No token-encryption design** — GitHub PAT / Jira token encryption is F-02 + S-02/S-03. F-01 only establishes the `BETTER_AUTH_SECRET` seam.
- **No automated test framework** — deferred (course timing); to be filled later.
- **No social/OAuth login** — phase 2 per PRD.
- **No rate limiting** — Better Auth's default rate limiter is in-memory and resets across Worker invocations; doing it correctly needs a KV namespace as secondary storage. Out of scope for F-01; do not enable it here.
- **Not redefining `user` in F-02** — F-01 owns it; F-02 must reference it (coordination note below).

## Implementation Approach

Three phases, gated by risk. **Phase 1 isolates and proves the single platform risk** (Workers scrypt CPU cost) on a real deploy before any schema or handler work depends on it — this is the roadmap's explicit risk mitigation. **Phase 2** lands the schema/migration and the full Better Auth config. **Phase 3** wires the handler + `proxy.ts` gate and verifies the complete flow end-to-end on Workers. Per-request instance construction is the through-line that keeps the foundation Workers-correct.

## Critical Implementation Details

- **Per-request DB connection (the real rule).** The hazard is not "singletons" in the abstract — it's caching a *request-scoped DB connection* across Worker invocations. Our `getDb()` opens a `pg` Pool over Hyperdrive, which is a real connection bound to one request's I/O context; reusing it across requests triggers "cannot perform I/O on behalf of a different request" / "script will never generate a response" failures. So build the Drizzle `db` (and the Better Auth instance that holds it) **inside the request** from `getCloudflareContext().env.HYPERDRIVE`. **Do not copy the zpg6 `examples/opennextjs` singleton verbatim** — that example caches its instance safely only because it uses **D1** (a binding with no persistent connection); our `pg`/Hyperdrive driver is the opposite case. Provide a *separate* static `auth` export (DB from `process.env.DATABASE_URL`, or a mock per the dual-mode `createAuth(env?)` pattern) used **only** by the Better Auth schema-gen CLI, which runs in Node at build time, never in the Worker.
- **`baseURL` + `trustedOrigins` are load-bearing.** A missing/`localhost` production `baseURL` or an origin not in `trustedOrigins` surfaces as the *same* opaque CPU/timeout error as a hashing failure — set `baseURL` from an env var (the deployed `*.workers.dev` origin) before the Phase 3 smoke test, or false negatives will look like crypto failures.
- **Bump `compatibility_date` before Phase 1's deploy** — moving to a 2025 date is what enables the fully-native `node:crypto` path; the smoke test must run *after* the bump or it tests the wrong runtime.
- **Hashing contingency (only if Phase 1 fails):** override `emailAndPassword.password` with a custom `node:crypto` `scryptSync` hash/verify (`N:16384, r:16, p:1`, format `${saltHex}:${keyHex}`) — the documented community fallback, hash-format-compatible with the default. Primary path is the default scrypt; this is the escape hatch.

---

## Phase 1: Workers Crypto Smoke Gate

### Overview

Install Better Auth, bump the Workers compatibility date, and prove on a **real deployed Worker** that Better Auth's password hashing resolves to native `node:crypto` scrypt within CPU limits — before building anything that depends on it. This is a hard gate: do not proceed to Phase 2 until it passes.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add Better Auth at a version that includes the native-scrypt hashing fix, so default email+password hashing works on Workers.

**Contract**: Add `better-auth` (latest ≥ 1.6.x, which pulls `@better-auth/utils ^0.4.0`) to `dependencies`. The Drizzle adapter import path is **version-dependent** — use whichever the installed `better-auth` version ships (`better-auth/adapters/drizzle` on older versions, or the separate `@better-auth/drizzle-adapter` package on newer ones); confirm at install time rather than assuming. Confirm the installed `better-auth` resolves `@better-auth/utils@^0.4.0` (the version carrying the `node` scrypt export).

#### 2. Workers compatibility date

**File**: `wrangler.toml`

**Intent**: Move to the 2025 runtime so native `node:crypto` scrypt is available.

**Contract**: Change `compatibility_date` from `"2024-12-01"` to a 2025 date (e.g. `"2025-09-01"`); keep `compatibility_flags = ["nodejs_compat"]`.

#### 3. Throwaway crypto smoke route

**File**: `src/app/api/auth-smoke/route.ts` (deleted at end of phase)

**Intent**: Exercise the exact CPU-risk operation (Better Auth password hash + verify) on the Worker and report timing, with no DB dependency, to isolate the crypto risk per `deploy-plan.md:344-352`.

**Contract**: A `GET` handler that imports `hashPassword` and `verifyPassword` from `@better-auth/utils/password` (the exact native-scrypt code Better Auth core uses post-#8685), hashes then verifies a sample password, and returns `{ ok, ms }`. Because this is the same function the real sign-up path calls, a fast pass proves native `node:crypto` scrypt resolved (vs the slow `@noble` fallback). No DB, no full `auth` instance required.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- Production build + type-check passes: `npm run build`
- Lint passes: `npm run lint`
- OpenNext bundle builds: `npm run build:cf`

#### Manual Verification:

- Deployed to Workers: `npm run deploy` succeeds
- `curl https://sprintflow.<account>.workers.dev/api/auth-smoke` returns `ok: true` with a small `ms` (well under the CPU limit) — not a 500/timeout
- `npx wrangler tail --status error` shows **no** `exceededCpu`, no "script will never generate a response", no `@noble` fallback path
- (Optional de-risk) A trivial `proxy.ts` that redirects returns a 307/redirect on the deployed Worker — confirms OpenNext executes Next.js middleware before Phase 3's real gate depends on it
- Smoke route deleted after the gate passes

**Implementation Note**: After automated verification passes, pause for human confirmation that the deployed smoke test is green before proceeding. If it fails, apply the `node:crypto` custom-hasher contingency (Critical Implementation Details) and re-run before Phase 2.

---

## Phase 2: Auth Schema + Migration

### Overview

Configure the Better Auth instance and generate + apply the `user`/`session`/`account`/`verification` Drizzle schema and migration. F-01 owns all four tables.

### Changes Required:

#### 1. Better Auth server config

**File**: `src/lib/auth.ts`

**Intent**: Define the auth configuration — email+password with the chosen behaviors — built per-request against the Hyperdrive-backed Drizzle `db`, plus a static export for the schema-gen CLI.

**Contract**: Use the proven **dual-mode** shape (zpg6 example): a single `createAuth(env?)` that constructs `betterAuth({...})` with `drizzleAdapter(getDb(env), { provider: "pg" })` when `env` is present (runtime) and a mock/`process.env.DATABASE_URL` DB when absent (CLI schema-gen). Export `createAuth` for runtime and a static `export const auth = createAuth()` for the CLI. Config includes: `emailAndPassword: { enabled: true, requireEmailVerification: false, sendResetPassword: async (...) => { /* log reset link; real email is S-01/S-11 */ } }`; `session: { cookieCache: { enabled: true, maxAge: 300 } }`; `secret` from `BETTER_AUTH_SECRET`; `baseURL` from env; `trustedOrigins` including the deployed origin. See Critical Implementation Details for why the runtime/CLI split exists.

#### 2. Generated auth schema

**File**: `src/db/schema.ts`

**Intent**: Replace the placeholder with the Better Auth table definitions for `user`, `session`, `account`, `verification`.

**Contract**: Generated via the Better Auth CLI (`npx @better-auth/cli generate`) pointed at the static `auth` export, output to `src/db/schema.ts`. The four tables follow Better Auth's canonical Drizzle schema (`user.email` unique, `session.userId` FK, etc.). F-02 will FK into `user` rather than redefining it.

#### 3. Migration

**File**: `src/db/migrations/*` (new)

**Intent**: Produce and apply the first real migration creating the four tables on Supabase.

**Contract**: `npx drizzle-kit generate` writes the SQL migration to `src/db/migrations/`; apply it to Supabase (via `drizzle-kit migrate` / `supabase` CLI against `DATABASE_URL`). Note the two lineages (`src/db/migrations/` for Drizzle vs `supabase/migrations/`) — keep auth tables in the Drizzle lineage, consistent with `drizzle.config.ts`.

### Success Criteria:

#### Automated Verification:

- Schema generates without error: `npx @better-auth/cli generate`
- Migration generates: `npx drizzle-kit generate`
- Build + type-check passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Migration applies cleanly to Supabase; `user`/`session`/`account`/`verification` tables exist (verify in Supabase dashboard or `psql`)
- `src/db/schema.ts` exports the four tables (no placeholder remains)

**Implementation Note**: After automated verification passes, pause for human confirmation that the tables exist in Supabase before proceeding.

---

## Phase 3: Handler + Proxy Middleware + End-to-End Verify

### Overview

Mount the catch-all auth handler, add the `proxy.ts` route gate (default-deny + public allowlist), set the auth secret, and verify the full sign-up → session → sign-out → gated-redirect cycle on a deployed Worker.

### Changes Required:

#### 1. Catch-all auth route handler

**File**: `src/app/api/auth/[...all]/route.ts`

**Intent**: Expose all Better Auth endpoints under `/api/auth/*`.

**Contract**: Async `POST`/`GET` handlers that build the auth instance per request and delegate to `toNextJsHandler` (from `better-auth/next-js`). Do **not** use the top-level `export const { POST, GET } = toNextJsHandler(auth)` form — it evaluates `auth` at module load, before any request/env exists. Instead: each export awaits `createAuth(getCloudflareContext().env)` and calls `toNextJsHandler(authInstance).POST(req)` / `.GET(req)`. This is the documented OpenNext + Better Auth reconciliation (zpg6 `examples/opennextjs`).

#### 2. Route-gating proxy middleware

**File**: `proxy.ts` (repo root)

**Intent**: Redirect unauthenticated requests to `/login` using a default-deny policy, leaving the public allowlist open.

**Contract**: `export function proxy(request)` doing an optimistic `getSessionCookie(request)` check from `better-auth/cookies`. Default-deny: everything is gated **except** the public allowlist (`/login`, `/signup`, `/reset`, `/api/auth/*`, and static assets). No-session → `NextResponse.redirect('/login')`. `config.matcher` excludes static assets; the proxy runtime is `nodejs` (implicit in Next 16, not configurable). This optimistic check is explicitly not the security boundary — see #3.

#### 3. Server-side session validation seam

**File**: `src/lib/auth.ts` (helper) — consumed by a gated server layout later

**Intent**: Provide the authoritative `requireSession()` helper that does full DB validation via `auth.api.getSession({ headers })`, for use by gated server components (defense-in-depth beyond the optimistic proxy check).

**Contract**: An exported async helper that returns the validated session or redirects/throws when absent. F-01 ships the helper; S-01's gated layouts consume it. (Provides the CVE-2025-29927 mitigation so route protection never relies on the proxy cookie check alone.)

#### 4. Auth secret + env

**File**: `.env` / `.env.example` / Workers secret

**Intent**: Provide `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (baseURL) in both dev and Workers without leaking secrets.

**Contract**: Add `BETTER_AUTH_SECRET` (and `BETTER_AUTH_URL`) to `.env` (gitignored) and document them in a new `.env.example` (placeholders only). Set the Workers secret: `npx wrangler secret put BETTER_AUTH_SECRET` (generate via `openssl rand -base64 32`), per `deploy-plan.md:225-230`. Set `BETTER_AUTH_URL` for the deployed origin (as a `[vars]` entry or secret).

### Success Criteria:

#### Automated Verification:

- Build + type-check passes: `npm run build`
- Lint passes: `npm run lint`
- OpenNext bundle builds and stays within budget: `npm run build:cf` (note the 10 MiB compressed ceiling)
- Workers secret registered: `npx wrangler secret list` shows `BETTER_AUTH_SECRET`

#### Manual Verification:

- Deployed: `npm run deploy` succeeds
- `POST /api/auth/sign-up/email` creates a user (row appears in `user`/`account`) and returns a session — no `exceededCpu`/timeout
- `GET /api/auth/get-session` returns the session for the signed-up user; `POST /api/auth/sign-out` clears it
- Hitting a gated path (e.g. `/`) with no session **redirects to `/login`**; the public allowlist loads unauthenticated
- `npx wrangler tail --status error` is clean across the full cycle
- No secret value appears in `wrangler tail` output or any response body

**Implementation Note**: After automated verification passes, pause for human confirmation that the full deployed cycle works before marking F-01 done.

---

## Testing Strategy

No automated framework this slice (deferred). Verification is:

### Manual Testing Steps:

1. Deploy and run the Phase 1 smoke route — confirm native scrypt timing.
2. Confirm the four tables exist in Supabase after Phase 2.
3. Full deployed cycle (Phase 3): sign-up → get-session → sign-out → gated redirect to `/login`, with a clean `wrangler tail --status error`.
4. Confirm no secret leaks in logs or response bodies.

**Known gap:** the hasher and session create/validate/invalidate logic ship without unit tests; add Vitest coverage in a later slice once the course's testing material lands.

## Performance Considerations

- **Cookie cache** keeps the per-request proxy check off the DB; full `auth.api.getSession` (DB hit through Hyperdrive) runs only in gated server components. Bound staleness-on-revocation by the cookie `maxAge` (300s).
- **Bundle ceiling:** watch `npm run build:cf` output against the 10 MiB compressed Workers limit; avoid pulling the pure-JS `@noble/hashes` path.

## Migration Notes

- F-01 introduces the **Drizzle migration lineage** (`src/db/migrations/`) distinct from the Supabase baseline (`supabase/migrations/`). Auth tables live in the Drizzle lineage per `drizzle.config.ts`.
- **F-02 coordination:** F-02 (data-schema-baseline) must FK into the F-01-owned `user` table, not redefine it. Flag this in F-02's plan.

## References

- Research: `context/changes/auth-provider-scaffold/research.md`
- Crypto smoke-test recipe: `context/deployment/deploy-plan.md:344-352`
- Auth secret step: `context/deployment/deploy-plan.md:225-230`
- DB helper: `src/lib/db.ts:1-12`
- Roadmap F-01: `context/foundation/roadmap.md:75-87`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Workers Crypto Smoke Gate

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — 11354aa
- [x] 1.2 Production build + type-check passes: `npm run build` — 11354aa
- [x] 1.3 Lint passes: `npm run lint` — 11354aa
- [x] 1.4 OpenNext bundle builds: `npm run build:cf` — 11354aa

#### Manual

- [x] 1.5 Deployed to Workers: `npm run deploy` succeeds — 11354aa
- [x] 1.6 `/api/auth-smoke` returns `ok: true` with small `ms` (no 500/timeout) — 11354aa
- [x] 1.7 `wrangler tail --status error` shows no `exceededCpu` / no-response / `@noble` fallback — 11354aa
- [ ] 1.8 (Optional de-risk) trivial `proxy.ts` redirect fires on deployed Worker
- [x] 1.9 Smoke route deleted after gate passes — 11354aa

### Phase 2: Auth Schema + Migration

#### Automated

- [x] 2.1 Schema generates: `npx @better-auth/cli generate` — 53c62cc
- [x] 2.2 Migration generates: `npx drizzle-kit generate` — 53c62cc
- [x] 2.3 Build + type-check passes: `npm run build` — 53c62cc
- [x] 2.4 Lint passes: `npm run lint` — 53c62cc

#### Manual

- [x] 2.5 Migration applies; four auth tables exist in Supabase — 53c62cc
- [x] 2.6 `src/db/schema.ts` exports user/session/account/verification (no placeholder) — 53c62cc

### Phase 3: Handler + Proxy Middleware + End-to-End Verify

#### Automated

- [x] 3.1 Build + type-check passes: `npm run build`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 OpenNext bundle builds within budget: `npm run build:cf`
- [x] 3.4 `npx wrangler secret list` shows `BETTER_AUTH_SECRET`

#### Manual

- [x] 3.5 `npm run deploy` succeeds
- [x] 3.6 Sign-up creates user + session (no exceededCpu/timeout)
- [x] 3.7 get-session returns session; sign-out clears it
- [x] 3.8 Gated path with no session redirects to `/login`; allowlist loads unauthenticated
- [x] 3.9 `wrangler tail --status error` clean; no secret leaks in logs/responses
