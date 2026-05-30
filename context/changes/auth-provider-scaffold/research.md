---
date: 2026-05-30T11:25:28+0200
researcher: Adam Reszka
git_commit: b5cb9ab2dbe39aed8a9cfb4c276c812959addf3d
branch: F-01
repository: 10xdevs-certification-project
topic: "F-01 auth-provider-scaffold — auth library choice, integration points, and Workers constraints"
tags: [research, codebase, auth, better-auth, nextauth, cloudflare-workers, drizzle, middleware, sessions]
status: complete
last_updated: 2026-05-30
last_updated_by: Adam Reszka
---

# Research: F-01 auth-provider-scaffold

**Date**: 2026-05-30T11:25:28+0200
**Researcher**: Adam Reszka
**Git Commit**: b5cb9ab2dbe39aed8a9cfb4c276c812959addf3d
**Branch**: F-01
**Repository**: 10xdevs-certification-project

## Research Question

What does the codebase already have, and what constraints apply, for scaffolding the F-01 auth provider — an email+password auth library with server-issued sessions and a route-gating middleware (redirect unauthenticated → `/login`), no user-facing pages (those are S-01)? Combine internal codebase research with targeted external docs to land an evidence-backed recommendation on **NextAuth vs Better Auth**.

Scope locked with the user: (1) recommend one library, not stay neutral; (2) internal codebase research + targeted external docs.

## Summary

**Recommendation: Better Auth.** It is the better fit for this exact stack (Next.js 16 App Router + `@opennextjs/cloudflare` on Workers + Supabase Postgres over Hyperdrive via `drizzle-orm/node-postgres` + email/password + **server-issued database sessions**). The deciding factor: NextAuth/Auth.js can only do email+password through its **Credentials provider, which is JWT-session-only and does not store or hash passwords for you** — the opposite of this project's "server-issued session" requirement. Better Auth has native email+password with database sessions, a maintained Drizzle-Postgres adapter, an **official `@opennextjs/cloudflare` example**, and agent-readable `llms.txt` docs. This confirms the soft lean already recorded in `roadmap.md:85` and `deploy-plan.md:352`.

**The one real risk is password hashing on Workers** — addressed below with a concrete `node:crypto` fallback. It must be confirmed with a *deployed-Worker* prototype (not just `next dev`), exactly as the roadmap risk and `deploy-plan.md` smoke-test recipe already demand.

Three findings change the planning picture versus the foundation docs:
1. **The DB stack is Supabase + Hyperdrive + `pg` TCP driver — NOT Neon + HTTP driver.** `infrastructure.md` is stale on this point; the Workers-TCP problem is already solved by Hyperdrive.
2. **Next.js 16 renamed `middleware.ts` → `proxy.ts` and runs it on the Node runtime** (per Auth.js/Next docs surfaced in external research). This dissolves the historical "edge can't reach the DB / JWT-caching hacks" class of problem on this stack — verify exact filename during `/10x-plan`.
3. **The F-01 / F-02 `user`-table ownership boundary is unresolved in the docs** — F-02 claims to own the `user` table yet runs parallel to F-01 with no dependency edge. Must be decided at plan time.

## Detailed Findings

### Area 1 — Auth/route/session integration seams (current code)

The app is a near-bare Next.js 16.2.6 App Router scaffold. Everything auth-related must be created by F-01.

- **Root layout** `src/app/layout.tsx:20-33` — `RootLayout` wraps `{children}` in `<body>`; no client providers yet. An auth session provider (client component) would wrap `{children}` here.
- **No `middleware.ts` / `proxy.ts` exists.** Next.js middleware lives at repo root (sibling of `wrangler.toml`). **See Area 3 for the Next.js 16 `proxy.ts` rename — confirm the correct filename at plan time.**
- **No `src/app/api/**` route handlers** — auth endpoints would be created here.
- **Component tree is all `.gitkeep` placeholders**: `src/components/providers/` (auth session provider goes here), `src/components/organisms/auth/` (login/signup form *organisms* — but forms/pages are S-01, not F-01).
- **`src/app/` has no route groups** — no `(auth)`/`(dashboard)` segmentation yet.
- **Env/secrets surface**:
  - `wrangler.toml:14-16` `[vars]` holds only `NEXT_PUBLIC_*` public keys; Workers secrets are added via `wrangler secret put` (not in the toml).
  - `.env` / `.env.local` hold server secrets (incl. `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Both are gitignored (`.gitignore:36-37` `.env*`).
  - `src/lib/db.ts:4-6` reads `env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL` — the **two-tier pattern** (Workers binding in prod, `process.env` in dev). An `AUTH_SECRET` must follow the same pattern.
  - **No `.env.example` / `.dev.vars`** — F-01 should add them.
- **OpenNext / Workers runtime** (`open-next.config.ts`, `wrangler.toml`, `package.json` scripts):
  - `npm run dev` → `next dev` (Node). `npm run preview` → `opennextjs-cloudflare build && wrangler dev` (local Workers runtime). `npm run deploy` → build + `wrangler deploy`.
  - Middleware runs in the **Workers runtime** in preview/prod — must use Web-standard APIs (no `fs`, no `child_process`). `@opennextjs/cloudflare` supports **only the Node runtime** (not Next.js Edge runtime).
- **Path alias** `@/*` → `./src/*` (`tsconfig.json`). Reusable util: `src/lib/utils.ts` (`cn`).

### Area 2 — DB/schema layer for auth tables

- **`src/db/schema.ts:1-2` is an empty placeholder** (`export {};`). No `user`/`session`/`account`/`verification` tables exist anywhere.
- **`src/lib/db.ts:1-12`** uses `drizzle-orm/node-postgres` + `pg` `Pool({ max: 1 })` over `env.HYPERDRIVE.connectionString`. This is the **TCP `pg` driver**, made Workers-safe by **Cloudflare Hyperdrive** (`wrangler.toml:10-12` `[[hyperdrive]]` binding).
- **Sole migration** `supabase/migrations/20260524085002_remote_schema.sql` is a bare Supabase baseline (extensions: `pgcrypto`, `uuid-ossp`, grants) — **zero `create table`**. Two parallel migration lineages exist: Drizzle's `out: ./src/db/migrations` (does not exist yet) and `supabase/migrations/`.
- **No `db:generate`/`db:migrate` npm scripts** — migrations run via the `drizzle-kit` and `supabase` CLIs directly (both devDeps).
- **Driver contradiction with `infrastructure.md` (stale doc):** `infrastructure.md:12,19,53,84,124-128` repeatedly mandates `@neondatabase/serverless` + `drizzle-orm/neon-http` and forbids TCP `pg`. **The code took a different valid path:** Supabase + Hyperdrive + `pg`. Hyperdrive already solves the Workers-TCP problem the HTTP driver was meant to solve. `roadmap.md:102` (F-02 risk) still echoes the stale "switch to HTTP/pooler driver" note — it is effectively already addressed. **F-01's auth adapter must target `drizzle-orm/node-postgres`, not neon-http.** (Action: update `infrastructure.md`.)

### Area 3 — External: Better Auth vs NextAuth on Workers (current docs)

| Criterion | Better Auth | NextAuth (Auth.js v5) |
|---|---|---|
| Email+password with **database sessions** | Native, first-class | **Not supported** via Credentials (JWT-only) |
| Server-issued sessions (the requirement) | Yes (DB sessions, optional KV front) | JWT cookie only for email+pass |
| Password hashing built-in | Yes (scrypt) — *but see Workers bug below* | No — you bring bcryptjs/argon2 yourself |
| Official OpenNext/Workers example | **Yes** (`zpg6/better-auth-cloudflare` `examples/opennextjs`) | No first-party Workers example |
| Drizzle-Postgres adapter | `@better-auth/drizzle-adapter` (`provider:"pg"`) | `@auth/drizzle-adapter` (mature, but moot for Credentials) |
| Agent-readable docs | Strong: `llms.txt` published | Good, but email+pass story is "build it yourself" |

- **Better Auth** documents Workers support explicitly (FAQ: set `compatibility_flags=["nodejs_compat"]`), a Hyperdrive-Postgres path, and `emailAndPassword:{ enabled:true }` with built-in `sendResetPassword` (maps cleanly to FR-001). Default = **database sessions**.
- **Next.js 16 framing correction:** Auth.js docs note Next 16 renamed `middleware.ts` → **`proxy.ts`, now on the Node.js runtime**, so the old edge-compat workarounds "may no longer be necessary." Combined with OpenNext being Node-runtime-only, **the team's historical NextAuth file-system-session-caching pain largely dissolves on this stack** — but it dissolves *for both* libraries, so it is not itself the deciding factor; the DB-session vs JWT-only distinction is.
- **Password hashing — the single most likely failure point:**
  - Workers `nodejs_compat` covers `node:crypto` (scrypt, pbkdf2, HMAC) and WebCrypto — **native scrypt is available** (Cloudflare 2025 node-compat writeup).
  - **Open Better Auth bug (#9649, filed 2026-05-16, unreleased fix):** `@better-auth/utils` lacks a `workerd` export condition, so Wrangler resolves the **pure-JS `@noble/hashes` scrypt fallback**, which is slow enough to hit `exceededCpu` on Workers Free during sign-up. Mitigations: (a) gate on the upstream fix (utils PR #17) and verify the bundle resolves the native `password.node.mjs`; **or (b) supply a custom `emailAndPassword.password` hasher backed by `node:crypto` `scryptSync`/`pbkdf2`** — sidesteps the broken export entirely; or (c) `patch-package` the export map.
  - NextAuth doesn't escape this — you'd bring `bcryptjs` (also CPU-heavy pure-JS) or roll `node:crypto` yourself from the start.

**Recommended concrete config:** Better Auth + `@better-auth/drizzle-adapter` (`provider:"pg"`) over the existing `drizzle-orm/node-postgres`+Hyperdrive; **database sessions**; **`node:crypto` scrypt/pbkdf2 hashing** (custom hasher now, native once #9649 ships); keep `nodejs_compat` and consider bumping `compatibility_date` (currently `2024-12-01`) to a 2025 date for the fully-native crypto path; async `initAuth()` singleton + static `auth` export for the Better Auth CLI (the documented OpenNext gotcha). Defense-in-depth: validate session in server components/route handlers too, not middleware alone (CVE-2025-29927).

### Area 4 — Prior decisions & constraints F-01 must honor

**Hard requirements:**
- **Email+password only**, OAuth is phase-2 — `prd.md:91-93` (FR-001), `shape-notes.md:16-17`.
- **Gated routes** — everything beyond `/login`/`/signup`/`/reset` requires a session; unauthenticated → sign-in — `prd.md:195-196`, `roadmap.md:77`.
- **Cross-account isolation** — every data row scoped to owning account; session must carry user id — `prd.md:196`.
- **Token encryption at rest, never logged** — `prd.md:49-51`. (Applies mainly to S-02/S-03 credentials, but F-01 sets the crypto-helper / `AUTH_SECRET` pattern.) Encryption design (AES-256 column vs app-layer) still TBD — `roadmap.md:101`.
- **Workers crypto must be proven before building gated routes** — prototype session create→validate→invalidate on a deployed Worker — `infrastructure.md:64-65`, `roadmap.md:86`. **A ready-made smoke-test recipe already exists:** `deploy-plan.md:344-352` (a `src/app/api/auth-smoke/route.ts` route, build+deploy, `curl` + `wrangler tail --status error` for `crypto.xxx is not a function`; "If NextAuth fails: switch to Better Auth").
- **No module-level session/state caches** — in-memory state resets between Worker invocations; all session state to DB — `infrastructure.md:67`.
- **10 MiB compressed bundle ceiling** — measure the Worker; avoid bundling pure-JS `@noble/hashes` — `infrastructure.md:54`.

**Soft leans:**
- **Better Auth preferred for Workers** — `roadmap.md:85`, `deploy-plan.md:352` (now confirmed by Area 3).

**No `context/foundation/lessons.md` exists.**

## Code References

- `src/app/layout.tsx:20-33` — RootLayout; provider wrap point
- `src/lib/db.ts:1-12` — Drizzle `node-postgres` over Hyperdrive; two-tier env pattern
- `src/db/schema.ts:1-2` — empty placeholder; no auth tables
- `drizzle.config.ts:1-10` — `out: ./src/db/migrations`, dialect postgresql
- `wrangler.toml:10-12` — `[[hyperdrive]]` binding; `:1-5` `nodejs_compat`, `compatibility_date 2024-12-01`
- `open-next.config.ts:1-6` — minimal OpenNext config
- `package.json:5-13` — dev/build/build:cf/deploy/preview scripts; no db:* scripts
- `supabase/migrations/20260524085002_remote_schema.sql` — bare baseline, no tables
- `tsconfig.json` — `@/*` → `./src/*`
- `src/lib/utils.ts:1-6` — `cn()` util

## Architecture Insights

- **The whole auth surface is greenfield** — schema, migration, middleware/proxy, providers, API routes, session lib all created fresh in F-01. The seams (layout provider slot, `@/*` alias, `getDb()` env pattern) already exist to attach to.
- **Hyperdrive is the load-bearing decision that makes the "ordinary" Drizzle+pg path valid on Workers** — this is why Better Auth's Drizzle-Postgres adapter works unchanged, and why the Neon/HTTP mandate in `infrastructure.md` is obsolete.
- **The real engineering risk is narrow and known: password hashing under `workerd`.** Everything else (DB sessions, middleware on Node runtime, Drizzle adapter) is well-trodden. The mitigation (`node:crypto` custom hasher) is concrete and low-risk.
- **Standalone-functional foundation:** because F-01 has no dependency edge to F-02 (`roadmap.md:81-82`), F-01 should own the full auth table set (`user`/`session`/`account`/`verification`) so it works alone — see Open Questions.

## Historical Context (from prior changes)

- `context/foundation/deploy-plan.md:344-352` — pre-written auth-crypto smoke-test procedure on Workers; explicitly names Better Auth as the NextAuth fallback.
- `context/foundation/infrastructure.md:60` (lessons narrative) — documents the original NextAuth file-system JWT-session-caching failure on Workers that motivated the Better-Auth lean; note Area 3 shows Next 16's Node-runtime `proxy.ts` reduces this risk class for both libs.
- `context/foundation/roadmap.md:75-87` (F-01), `:91-103` (F-02) — outcomes, the open library choice, and the `user`-table ownership wording.
- No prior `context/changes/**` or `context/archive/**` folders touch auth (this is the first).

## Related Research

- None yet — this is the first research artifact under `context/changes/`.

## Open Questions

1. **F-01 / F-02 `user`-table ownership (must resolve at `/10x-plan`).** F-02 claims to own the `user` table (`roadmap.md:96`) but runs **parallel to F-01 with no dependency** (`roadmap.md:81-82`), and no `user` table exists yet. **Recommended: Option A — F-01 owns the full auth table set** (`user`/`session`/`account`/`verification`, Better Auth's generated schema) so it is standalone-functional; F-02 then *references* (FKs into) `user` rather than redefining it. Option B (F-02 owns `user`) gives F-01 a hidden dependency contradicting its "Prerequisites: —".
2. **`middleware.ts` vs `proxy.ts` on Next.js 16.2.6.** External docs indicate Next 16 renamed the file to `proxy.ts` (Node runtime). Confirm the exact supported filename for 16.2.6 + `@opennextjs/cloudflare` during plan/prototype before writing the gating logic.
3. **Password-hashing path.** Decide between (a) waiting on Better Auth `#9649`/utils `#17` to ship the `workerd` export, or (b) shipping a `node:crypto` custom `emailAndPassword.password` hasher now. Recommendation: **(b)** for determinism; revisit (a) later. Must be proven with a **deployed-Worker** prototype, not `next dev`.
4. **`compatibility_date` bump.** Currently `2024-12-01`; consider a 2025 date for the fully-native `node:crypto` path, then re-run the smoke test.
5. **Encryption pattern for stored 3rd-party tokens** (AES-256 column vs app-layer) — TBD (`roadmap.md:101`); F-01 should at least establish the `AUTH_SECRET`/crypto-helper seam so S-02/S-03 plug in without redesign.
6. **Security note (not a blocker):** `.env`/`.env.local` hold live credentials (Supabase service-role key, DB password, a GitHub PAT, an Exa key). They are gitignored (not committed), but their values were printed into this session's agent transcript. No rotation strictly required since uncommitted; flagging for awareness. Do **not** echo these into any committed artifact.

## Next step

Run `/10x-plan auth-provider-scaffold` — feed this research in. The plan must resolve Open Questions 1–4 explicitly and begin with the deployed-Worker crypto smoke test (`deploy-plan.md:344-352`) before any gated-route work.
