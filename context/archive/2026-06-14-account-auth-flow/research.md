---
date: 2026-06-14T12:30:00+02:00
researcher: Adam Reszka
git_commit: 16c1e72084312315add107583bd9fffa6e17221c
branch: feat/account-auth-flow
repository: AdamReszka/10xdevs-certification-project
topic: "account-auth-flow (S-01): wire email+password sign up / sign in / sign out / reset on the existing Better Auth scaffold"
tags: [research, codebase, auth, better-auth, drizzle, cloudflare-workers, s-01]
status: complete
last_updated: 2026-06-14
last_updated_by: Adam Reszka
---

# Research: account-auth-flow (S-01) — wire email+password auth on the existing Better Auth scaffold

**Date**: 2026-06-14T12:30:00+02:00
**Researcher**: Adam Reszka
**Git Commit**: 16c1e72084312315add107583bd9fffa6e17221c (pushed to origin/main)
**Branch**: feat/account-auth-flow
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

For roadmap slice **S-01 (account-auth-flow)** — "sign up, sign in, sign out, and reset password by email+password" — what does the codebase already provide (via foundations F-01 auth scaffold, F-02 schema, F-03 UI), and what are the exact remaining gaps to plan and implement?

## Summary

**The server-side and data-layer work is essentially done; S-01 is a client-side glue slice.** F-01 shipped a correctly Workers-wired Better Auth server instance (email+password enabled), a per-request API handler, gated middleware, and a DB-backed `requireSession()` guard. F-02 shipped all four Better Auth tables (`user`/`session`/`account`/`verification`) — migrated, with `user.email` UNIQUE and `account.password` present. F-03 shipped the three auth route shells, three **inert** form organisms, and every shadcn primitive needed (button, input, label, card, form, sonner), with `react-hook-form` + `zod` + `@hookform/resolvers` already installed.

**What is missing for S-01 is narrow and well-defined:**

1. **No Better Auth client** — `src/lib/auth-client.ts` (with `createAuthClient`) does not exist. `better-auth/react` is in `node_modules`, so no new dependency.
2. **Three forms are inert placeholders** — marked `TODO(S-01)`; no `'use client'`, no `useForm`, no zod schema, no submit handler, no auth-client call.
3. **No sign-out trigger** anywhere — needs a home (the authenticated app shell / header).
4. **No new-password page** — `reset-form.tsx` only *requests* the link; there is no surface to consume the token and call `resetPassword`.
5. **No real email transport** — `sendResetPassword` only `console.log`s the URL; Resend/nodemailer not installed. **Decision needed:** wire real email now vs. ship log-only and defer delivery to S-11.
6. **No post-auth landing route** — sign-in/sign-up success has nowhere to redirect (no `(app)`/`(dashboard)` group yet); PRD wants sign-up → setup wizard.

No schema changes and no server-config rebuild are required.

## Detailed Findings

### Area 1 — Better Auth server scaffold (F-01): DONE, Workers-safe

- Server instance factory `createAuth(env)` — [src/lib/auth.ts:25-61](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L25-L61):
  - `emailAndPassword.enabled: true`, `requireEmailVerification: false` (MVP, matches FR-001) — [auth.ts:47-50](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L47-L50).
  - `sendResetPassword` exists but **logs only** — [auth.ts:51-54](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L51-L54). Comment self-flags: "Reset email transport is S-01/S-11; for now log the link so the flow is exercisable."
  - `drizzleAdapter(db, { provider: "pg", schema })` — [auth.ts:46](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L46).
  - `session.cookieCache: { enabled: true, maxAge: 300 }` — pairs with the optimistic middleware cookie check — [auth.ts:56-60](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L56-L60).
  - `secret`/`baseURL` from env with hard runtime fail if secret missing — [auth.ts:27-39](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L27-L39); `trustedOrigins: baseURL ? [baseURL] : []` — [auth.ts:45](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L45).
  - **No `autoSignIn` set** → Better Auth default `autoSignIn: true` applies (sign-up creates a session). Make explicit in the plan if a specific behavior is wanted.
- API handler is **per-request** (Workers-correct) — [src/app/api/auth/[...all]/route.ts:13-21](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/api/auth/%5B...all%5D/route.ts#L13-L21): `const { env } = getCloudflareContext(); return toNextJsHandler(createAuth(env)).POST(request);`. An explicit comment warns against the `export const { POST, GET } = toNextJsHandler(auth)` form (would cache a request-scoped Hyperdrive connection).
- Request-scoped DB: `getDb(env)` builds a fresh `pg` `Pool({ connectionString, max: 1 })` from `env.HYPERDRIVE.connectionString` per call — [src/lib/db.ts:4-12](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/db.ts#L4-L12). No module-level caching on the request path.
- Authoritative gated-route guard `requireSession()` — [auth.ts:81-107](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L81-L107): calls `createAuth(env).api.getSession(...)`, **fails closed** to `/login` on DB error, redirects to `/login` when no session. This is the real security boundary (server components), not middleware.
- The static `export const auth = createAuth()` is **schema-gen CLI only** — [auth.ts:64-69](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/lib/auth.ts#L64-L69) — never used by the Worker.

### Area 2 — Middleware gating (F-01): DONE

- File is `middleware.ts` (not Next 16's `proxy.ts`) — intentional; `@opennextjs/cloudflare@1.19.11` doesn't yet understand the rename. Runtime is **nodejs**, not Edge.
- Public prefixes: `["/", "/login", "/signup", "/reset", "/api/auth"]`; `"/"` matches the landing page exactly, child routes stay gated — [middleware.ts](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/middleware.ts#L26-L32).
- Detection = **optimistic cookie presence only** via `getSessionCookie(request)` from `better-auth/cookies` — explicitly *not* the security boundary (cites CVE-2025-29927) — [middleware.ts:37-46](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/middleware.ts#L37-L46). No-cookie → redirect to `/login`.

### Area 3 — Auth DB schema (F-02): DONE, migrated

All four Better Auth v1.6 tables exist in [src/db/schema.ts:112-182](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L112-L182), migrated in `src/db/migrations/0000_light_rawhide_kid.sql`. TS is camelCase → SQL snake_case (Drizzle default; no `casing` configured in `drizzle.config.ts`).

- `user` ([schema.ts:112-123](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L112-L123)): `id, name, email (UNIQUE → user_email_unique), emailVerified (default false), image, createdAt, updatedAt ($onUpdate)`.
- `session` ([schema.ts:125-142](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L125-L142)): `id, expiresAt, token (UNIQUE), ipAddress, userAgent, userId → user.id CASCADE`, index on `user_id`.
- `account` ([schema.ts:144-166](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L144-L166)): provider fields + **`password` (nullable, [schema.ts:159](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L159)) — hashed password for email+password**; `userId → user.id CASCADE`.
- `verification` ([schema.ts:168-182](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/db/schema.ts#L168-L182)): `identifier, value, expiresAt` — used by the reset-token flow.
- Every product table carries `ownerId → user.id ON DELETE CASCADE` (cross-account isolation per Access Control) — this is the unified F-02 schema.

### Area 4 — Auth UI (F-03): shells DONE, logic INERT

- Three route shells render their organisms (real routing, static forms): [(auth)/login/page.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/(auth)/login/page.tsx), [signup/page.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/(auth)/signup/page.tsx), [reset/page.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/(auth)/reset/page.tsx); centered card layout in [(auth)/layout.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/(auth)/layout.tsx).
- The three organisms are **inert placeholders** — no `'use client'`, no state, no submit, marked `TODO(S-01): wire to Better Auth (onSubmit + validation)`:
  - [login-form.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/components/organisms/auth/login-form.tsx) — email + password + "Forgot password?" → `/reset`; link to `/signup`.
  - [signup-form.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/components/organisms/auth/signup-form.tsx) — email + password + **confirm-password (no match check yet)**; link to `/login`.
  - [reset-form.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/components/organisms/auth/reset-form.tsx) — email only ("Send reset link"); **no token-consuming new-password surface**.
- shadcn primitives installed in `src/components/ui/`: `button, input, label, card, form (react-hook-form wrapper w/ FormMessage error display), sonner`. **All auth-form primitives present — no `npx shadcn add` needed.**
- Toaster wired at root — [src/app/layout.tsx](https://github.com/AdamReszka/10xdevs-certification-project/blob/16c1e72084312315add107583bd9fffa6e17221c/src/app/layout.tsx) renders `<Toaster />`; `toast.error()/.success()` available immediately for the "no white screen" guardrail.
- Validation libs installed (no zod schema authored yet): `react-hook-form ^7.77.0`, `@hookform/resolvers ^5.4.0`, `zod ^4.4.3`.
- Root layout wraps only `<Toaster />` — **no session/auth provider**. **No `(app)`/`(dashboard)` protected group yet** — `src/components/templates/app-shell.tsx` comment notes "the authenticated sign-out/user-menu variant is added in S-01."

### Area 5 — External: Better Auth v1.6 client API (Context7, `/better-auth/better-auth/v1.6.11`)

- **Client setup**: `createAuthClient` from `better-auth/react`, configured with `baseURL` (and `plugins: []`). This is the missing `src/lib/auth-client.ts`.
- **Methods to call from the forms**:
  - Sign up: `authClient.signUp.email({ email, password, name, callbackURL? }, { onRequest, onSuccess, onError })` — also returns `{ data, error }`. **Note: `name` is required by `signUp.email`; the current signup form has no name field.**
  - Sign in: `authClient.signIn.email({ email, password }, callbacks)` → `{ data, error }`.
  - Sign out: `authClient.signOut()`.
  - Request reset: `authClient.requestPasswordReset({ email, redirectTo })` (v1.6 name; `forgetPassword` is the older alias). `redirectTo` is the page the email link lands on.
  - Complete reset: `authClient.resetPassword({ newPassword, token })`, where `token` is read from the reset-link query string on the redirect page.
  - `authClient.useSession()` hook available for client-side session state (user menu / conditional nav).
- **Server reset signature**: `sendResetPassword: async ({ user, url, token }, request) => { ... }` — the current code uses `{ user, url }` and logs `url`. Real delivery (S-11 or now) sends `url` to `user.email`. Docs advise **not awaiting** the send to avoid timing attacks; an optional `onPasswordReset` hook runs after a successful reset.

## Code References

- `src/lib/auth.ts:25-61` — Better Auth instance (email+password enabled, drizzle adapter, cookie cache).
- `src/lib/auth.ts:51-54` — `sendResetPassword` log-only stub (the email-transport decision point).
- `src/lib/auth.ts:81-107` — `requireSession()` DB-backed gated-route guard (fails closed).
- `src/app/api/auth/[...all]/route.ts:13-21` — per-request `toNextJsHandler(createAuth(env))`.
- `src/lib/db.ts:4-12` — per-request Hyperdrive `pg` Pool.
- `middleware.ts:26-46` — optimistic cookie gate + redirect to `/login`.
- `src/db/schema.ts:112-182` — `user`/`session`/`account`/`verification` (email UNIQUE, `account.password`).
- `src/components/organisms/auth/{login,signup,reset}-form.tsx` — the three inert forms to wire.
- `src/components/ui/{form,sonner}.tsx` — react-hook-form wrapper + toaster, ready to use.
- `wrangler.jsonc:5-32` — `nodejs_compat` (Better Auth scrypt), HYPERDRIVE binding, secrets note.
- `next.config.ts:18` — `serverExternalPackages: ["pg", "pg-cloudflare"]`.

## Architecture Insights

- **Per-request instance discipline is the load-bearing Workers pattern**: `createAuth(env)` + `getDb(env)` are constructed inside request handlers; never cache a Hyperdrive-backed instance at module scope. Any S-01 server code touching auth must follow this.
- **Two-tier auth gate**: middleware = cheap optimistic cookie check (UX redirect); `requireSession()` = authoritative DB validation in server components. New protected routes get the `(app)` group + a `requireSession()` call, not just middleware.
- **Workers crypto risk (roadmap F-01) is resolved**: `nodejs_compat` + `global_fetch_strictly_public` flags cover Better Auth's `node:crypto` scrypt path; `pg`/`pg-cloudflare` kept whole via `serverExternalPackages`.
- **Secrets, not vars**: `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` must be set via `wrangler secret put` for deployed auth (plain vars resolve to null in `getCloudflareContext().env` on this OpenNext version); locally they fall back to `process.env`.
- **Error-handling guardrail**: PRD forbids white screens. Forms must surface `{ error }` / `onError` via the wired Sonner toaster and inline `FormMessage`, never throw uncaught.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md` — S-01 depends on F-01/F-02/F-03 (all `done`); F-01 risk note pre-resolved the Workers crypto concern; F-02 resolved encrypted-token storage (`src/lib/crypto.ts`, AES-256-GCM) — relevant to later S-02/S-03, not S-01.
- `context/foundation/lessons.md` — two standing rules: (1) NOT NULL on any UNIQUE dedup column used by upsert (S-05 concern, not S-01); (2) pin `turbopack.root` + Node memory cap to avoid OOM during dev/build (applies to running this change locally).
- Memory `project_supabase_isolation_model` — cross-account isolation relies on the Data API (PostgREST) being OFF; app reaches DB only via Hyperdrive. S-01 introduces the first real `user` rows that every `ownerId` FK will later scope to.

## Related Research

- None prior for this change. This is the first `research.md` under `context/changes/account-auth-flow/`.

## Open Questions

1. **Password-reset email transport — now or S-11?** `sendResetPassword` is log-only and Resend/nodemailer is not installed. Options: (a) ship S-01 with log-only delivery (flow fully exercisable via console, real email in S-11), or (b) pull Resend forward into S-01. Roadmap text ("reset password by email+password") implies the *flow*, and the F-01 comment explicitly tags transport as "S-01/S-11" — i.e., deferrable. **Recommend (a)** unless the success-criteria demo needs real inbox delivery.
2. **New-password page route + token handling.** Need a route (e.g., `(auth)/reset/confirm` or a token-aware `/reset` branch) that reads `token` from the query and calls `resetPassword`. `requestPasswordReset({ redirectTo })` must point at it. Pin the exact path in the plan.
3. **Post-auth landing destination.** Sign-in/sign-up success has nowhere to go — no `(app)`/`(dashboard)` group exists. PRD says sign-up → setup wizard (S-02+). For S-01, define a minimal authenticated landing (placeholder dashboard or a `/setup` stub) so the redirect target exists and middleware/`requireSession()` can be exercised end-to-end.
4. **`signUp.email` requires `name`.** The signup form collects email + password + confirm only. Either add a name field or pass a derived/placeholder `name`. Decide in the plan.
5. **`autoSignIn` behavior on sign-up.** Default is `true` (session created on sign-up). Confirm we want auto-login → redirect, vs. forcing an explicit sign-in.
6. **Sign-out placement.** No authenticated shell/header exists yet. Decide where the sign-out control lives (likely the `(app)` shell added alongside the landing route in Q3).
