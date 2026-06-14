# Account Auth Flow (S-01) Implementation Plan

## Overview

Wire the **client-side email+password auth experience** onto the already-complete Better Auth server scaffold (F-01) so a tech lead can sign up, sign in, sign out, and reset their password. The server instance, all four auth tables, middleware gating, and every shadcn primitive already exist — this slice fills the client glue: an auth client, four validated forms, an authenticated landing surface that hosts sign-out, and the token-consuming new-password page.

## Current State Analysis

From `context/changes/account-auth-flow/research.md` (git 16c1e72):

- **Server is done and Workers-safe**: `createAuth(env)` has `emailAndPassword.enabled: true`, drizzle adapter, per-request instancing, cookie cache, and a DB-backed `requireSession()` guard that fails closed to `/login` (`src/lib/auth.ts:25-107`). API handler is per-request (`src/app/api/auth/[...all]/route.ts:13-21`).
- **Schema is migrated**: `user`/`session`/`account`/`verification` exist with `user.email` UNIQUE and `account.password` present (`src/db/schema.ts:112-182`). No schema change needed.
- **Middleware gates everything** not in `["/", "/login", "/signup", "/reset", "/api/auth"]`, redirecting to `/login` on a missing optimistic session cookie (`middleware.ts:26-46`). Any new route under a non-public path is gated automatically.
- **UI shells exist but are inert**: the three `(auth)` pages render organisms that are static `TODO(S-01)` placeholders — no `'use client'`, no `useForm`, no submit, no auth-client call.
- **Primitives are all installed**: `button/input/label/card/form (react-hook-form wrapper w/ FormMessage)/sonner`, plus `react-hook-form ^7.77`, `@hookform/resolvers ^5.4`, `zod ^4.4`. Toaster is mounted at root (`src/app/layout.tsx`).
- **`better-auth/react` is in node_modules** — the auth client needs creating, not installing.

### Key Discoveries:

- Per-request instance discipline is load-bearing: never cache a Hyperdrive-backed `createAuth`/`getDb` at module scope (`src/lib/db.ts:4-12`, `src/app/api/auth/[...all]/route.ts:7-11`).
- Two-tier gate: middleware = optimistic cookie (UX redirect, explicitly *not* the security boundary, cites CVE-2025-29927); `requireSession()` = authoritative DB check for server components (`src/lib/auth.ts:81-107`).
- v1.6 client API: `createAuthClient` from `better-auth/react`; methods `signUp.email({email,password,name})`, `signIn.email({email,password})`, `signOut()`, `requestPasswordReset({email,redirectTo})`, `resetPassword({newPassword,token})`; `useSession()` hook.
- `sendResetPassword` is log-only today and self-flagged as "S-01/S-11" deferrable (`src/lib/auth.ts:51-54`).
- No `(app)`/`(dashboard)` route group exists — sign-in success currently has nowhere to land, and sign-out has no home.

## Desired End State

A new visitor can register (email + name + password), is auto-signed-in, and lands on a gated `/dashboard`. They can sign out (returns to `/login`), sign back in, and run the full reset cycle: request a link → open the tokenized `/reset/confirm` page → set a new password → sign in with it. All validation errors render inline at the field; all auth/network failures raise a toast — never a white screen. Unauthenticated access to `/dashboard` redirects to `/login`; an authenticated `requireSession()` confirms the session server-side.

**Verification**: `npm run lint` and `npm run build` pass; manual walk-through of signup → dashboard → signout → signin → reset (via console-logged URL) succeeds end-to-end against the dev server.

## What We're NOT Doing

- **No real reset email** — `sendResetPassword` stays log-only; Resend/transport is deferred to S-11.
- **No email verification** — `requireEmailVerification` stays `false` (FR-001 MVP).
- **No real dashboard content** — `/dashboard` is a stub; the Anomaly Inbox and panels are S-07.
- **No setup wizard** — `/setup` and integration connection are S-02/S-03.
- **No schema or migration changes** — all auth tables already exist.
- **No OAuth / social / GitHub login** — phase 2 product scope.
- **No user-profile editing surface** (name change, avatar) — out of scope for S-01.
- **No "remember me", rate-limiting, or CAPTCHA** — not required by FR-001 for the MVP.

## Implementation Approach

Build bottom-up so each phase is independently testable and the next phase's dependency already exists: foundation (client + schemas) → authenticated target (so redirects resolve) → the sign-in/sign-up forms → the reset flow. Forms follow the installed shadcn `Form`/`FormField`/`FormMessage` + `zodResolver` pattern; server failures surface through the already-mounted Sonner `Toaster`. All client auth calls go through a single `src/lib/auth-client.ts`.

## Critical Implementation Details

- **Reset-link URL shape**: `requestPasswordReset({ email, redirectTo })` makes Better Auth send a link of the form `<BETTER_AUTH_URL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>`, which 302-redirects to `<redirectTo>?token=<token>`. So `redirectTo` must be `/reset/confirm`, and that page reads `token` from its own query string. Because transport is log-only, the implementer copies the logged URL from the dev console to exercise the flow.
- **Reset-confirm page MUST be middleware-public**: gating is path-based, not route-group-based — `(auth)` does not change the URL. `isPublic()` (`middleware.ts:28-32`) matches `pathname === p` OR `pathname.startsWith(p + "/")` against `PUBLIC_PREFIXES = ["/", "/login", "/signup", "/reset", "/api/auth"]`. The route is named **`/reset/confirm`** precisely so it matches the existing `/reset` prefix and stays public with **no middleware change**. Do NOT name it `/reset-password` — that string is neither equal to nor a child of `/reset`, so middleware would redirect the unauthenticated user to `/login` and the reset link would dead-end.
- **Client/server instance separation**: `auth-client.ts` is the ONLY client-side auth module; it must not import `src/lib/auth.ts` (server instance, pulls in `pg`). Keep the boundary clean or the client bundle breaks.

## Phase 1: Auth client + validation foundation

### Overview

Create the client SDK instance and the shared zod schemas the forms will use, and make the existing sign-up auto-login behavior explicit. No UI changes yet — this is pure foundation that Phases 2–4 import.

### Changes Required:

#### 1. Better Auth client

**File**: `src/lib/auth-client.ts` (new)

**Intent**: Expose a single browser-side auth client the form components call, so no component talks to the server `auth` instance directly.

**Contract**: `export const authClient = createAuthClient({ baseURL })` from `better-auth/react`, where `baseURL` is the public app URL (env-driven, falling back to same-origin in the browser). Re-export the methods/hooks the UI needs (`signIn`, `signUp`, `signOut`, `requestPasswordReset`, `resetPassword`, `useSession`). Must NOT import `src/lib/auth.ts`.

#### 2. Shared auth validation schemas

**File**: `src/lib/validations/auth.ts` (new)

**Intent**: Centralize zod schemas so forms validate consistently and types are inferred for `useForm`.

**Contract**: Four exported schemas + inferred types:
- `loginSchema` — `email` (email), `password` (min 1, "required").
- `signupSchema` — `name` (min 1), `email` (email), `password` (min 8), `confirmPassword`; `.refine` that `password === confirmPassword` with the error attached to `confirmPassword`.
- `resetRequestSchema` — `email` (email).
- `resetConfirmSchema` — `password` (min 8), `confirmPassword` with the same match refine.

Password min length must match Better Auth's default (8) so client and server agree.

#### 3. Explicit auto sign-in

**File**: `src/lib/auth.ts`

**Intent**: Make the relied-upon auto-login-on-signup behavior explicit and auditable rather than depending on the library default.

**Contract**: Add `autoSignIn: true` to the `emailAndPassword` config block (alongside `enabled`/`requireEmailVerification`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (Next build runs `tsc`)
- Linting passes: `npm run lint`
- `src/lib/auth-client.ts` and `src/lib/validations/auth.ts` exist and export the named symbols

#### Manual Verification:

- Importing `authClient` in a throwaway client component does not pull `pg`/server code into the bundle (no build error about node built-ins)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Authenticated route group + sign-out home

### Overview

Create the gated `(app)` route group with a `requireSession()`-guarded layout, a `/dashboard` stub, and an authenticated app-shell header that hosts the sign-out control. This gives Phase 3's redirects a real target and sign-out a natural home, and exercises the full gating stack (middleware + `requireSession()`).

### Changes Required:

#### 1. Authenticated layout (server guard)

**File**: `src/app/(app)/layout.tsx` (new)

**Intent**: Wrap all authenticated routes, enforce the session server-side, and render the authenticated shell.

**Contract**: Server component that calls `await requireSession()` (from `src/lib/auth.ts`) before rendering; passes the session/user into the authenticated app-shell which wraps `children`. No `'use client'`.

#### 2. Sign-out control composed via AppShell's existing `actions` slot

**File**: `src/components/molecules/sign-out-button.tsx` (new) — and `(app)/layout.tsx` from #1 composes it.

**Intent**: Give the authenticated header a sign-out trigger **without modifying AppShell**. `AppShell` already exposes an `actions?: ReactNode` slot (`app-shell.tsx:19,27-29`) that the public landing already uses (`src/app/page.tsx`) — the authenticated layout just renders `<AppShell actions={<SignOutButton />}>`.

**Contract**: New `SignOutButton` is a `'use client'` component calling `authClient.signOut()` then redirecting to `/login` (`router.push` / `router.refresh` as needed for the cleared cookie to take). `(app)/layout.tsx` passes it (optionally alongside the signed-in user's name) into AppShell's `actions` slot. Do **not** edit `app-shell.tsx` internals (avoids blast radius on the shared landing header); the stale "authenticated variant added in S-01" comment there may simply be removed.

#### 3. Dashboard stub page

**File**: `src/app/(app)/dashboard/page.tsx` (new)

**Intent**: Provide the post-auth landing target; real content is S-07.

**Contract**: Minimal server component rendering a placeholder heading (e.g. "Dashboard — coming in S-07") and the signed-in user's name. Lives under the gated `(app)` group so middleware + layout guard apply.

#### 4. Redirect-if-authenticated guard on the `(auth)` layout

**File**: `src/app/(auth)/layout.tsx`

**Intent**: Stop a signed-in user from landing back on `/login`, `/signup`, `/reset`, or `/reset/confirm` — the inverse of the `(app)` guard.

**Contract**: Make the existing `(auth)` layout a server component that checks the session (per-request `createAuth(env).api.getSession({ headers })`, mirroring `requireSession()` but non-fatal) and, if a session exists, `redirect("/dashboard")` before rendering `children`. No DB-error fail-closed needed here — on error, fall through to rendering the public auth page (don't trap users out of login). Keep it server-only; the redirect target exists as of Phase 2 #3.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Route `/dashboard` is emitted in the build output

#### Manual Verification:

- Visiting `/dashboard` while unauthenticated redirects to `/login` (middleware)
- With a session cookie present, `/dashboard` renders the stub and the authenticated header
- The sign-out button is visible in the authenticated header (full sign-out loop verified in Phase 3 once sign-in works)
- While signed in, visiting `/login` / `/signup` / `/reset` redirects to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Sign-in + sign-up forms

### Overview

Make the login and signup organisms functional client components using react-hook-form + the Phase 1 zod schemas, calling the auth client, surfacing errors inline + via toast, and redirecting to `/dashboard` on success.

### Changes Required:

#### 1. Login form

**File**: `src/components/organisms/auth/login-form.tsx`

**Intent**: Wire the inert login form to `signIn.email` with validation, loading, error handling, and post-success redirect.

**Contract**: `'use client'`; `useForm` with `zodResolver(loginSchema)`; rebuild fields with shadcn `Form`/`FormField`/`FormControl`/`FormMessage`. On submit call `authClient.signIn.email({ email, password })`; on `{ error }` (or `onError`) raise `toast.error` with a human message (invalid credentials / network); on success `router.push("/dashboard")` (or `router.refresh()` as needed for the cookie to take). Disable the submit button + show loading state while pending. Keep the existing "Forgot password?" → `/reset` and "Sign up" → `/signup` links.

#### 2. Signup form

**File**: `src/components/organisms/auth/signup-form.tsx`

**Intent**: Add the Name field, enforce password-match, and wire to `signUp.email`.

**Contract**: `'use client'`; add a required **Name** input above email; `useForm` with `zodResolver(signupSchema)` (includes confirm-password match); on submit call `authClient.signUp.email({ name, email, password })`; map `{ error }` to `toast.error` (notably the "email already exists" case) and inline `FormMessage` for field errors; on success, because `autoSignIn` is true, `router.push("/dashboard")`. Loading state on the submit button. Keep the "Sign in" → `/login` link.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- New signup (name + email + password + matching confirm) creates a user, auto-signs-in, and lands on `/dashboard`
- Mismatched confirm-password shows an inline error and blocks submit
- Duplicate-email signup shows a toast error, no crash
- Sign-in with correct credentials lands on `/dashboard`; wrong password shows a toast error
- Sign-out from the dashboard header returns to `/login` and `/dashboard` is no longer accessible (completes the Phase 2 sign-out loop)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Password reset flow

### Overview

Wire the reset-request form to `requestPasswordReset`, and add the tokenized new-password page that consumes the reset token and calls `resetPassword`. Transport stays log-only — the flow is exercised via the console-logged URL.

### Changes Required:

#### 1. Reset-request form

**File**: `src/components/organisms/auth/reset-form.tsx`

**Intent**: Wire the inert email-only form to trigger the reset email (logged) and confirm to the user.

**Contract**: `'use client'`; `useForm` with `zodResolver(resetRequestSchema)`; on submit call `authClient.requestPasswordReset({ email, redirectTo: "/reset/confirm" })`; always show a neutral success confirmation (toast or inline) regardless of whether the email exists (avoid account enumeration); `toast.error` only on network/unexpected failure. Keep the "Back to sign in" → `/login` link.

#### 2. Reset-confirm page (token surface)

**File**: `src/app/(auth)/reset/confirm/page.tsx` (new)

**Intent**: Landing page for the reset link; provides the token to the new-password form.

**Contract**: Reads `token` from `searchParams` and renders the new-password form (Phase 4 #3). If `token` is absent, render an "invalid or expired link" state with a link back to `/reset`. Lives in the `(auth)` group and reuses the `(auth)` centered layout. **Route path is `/reset/confirm`** so it's matched by middleware's existing `/reset` public prefix (see Critical Implementation Details — do not rename to `/reset-password`). Path must match the `redirectTo` used in #1.

#### 3. New-password form

**File**: `src/components/organisms/auth/reset-password-form.tsx` (new)

**Intent**: Collect and submit the new password against the reset token.

**Contract**: `'use client'`; props include the `token`; `useForm` with `zodResolver(resetConfirmSchema)` (password + confirm match); on submit call `authClient.resetPassword({ newPassword, token })`; on success `toast.success` + `router.push("/login")`; on `{ error }` (expired/invalid token) `toast.error` and inline message. Loading state on submit.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Route `/reset/confirm` is emitted in the build output

#### Manual Verification:

- Submitting a known email on `/reset` logs a reset URL to the dev console and shows the neutral confirmation
- Opening the logged URL lands on `/reset/confirm` (reachable unauthenticated — not redirected to `/login`) with the token present and renders the new-password form
- Setting a new (matching) password succeeds, redirects to `/login`, and signing in with the new password works
- Visiting `/reset/confirm` with no/invalid token shows the invalid-link state (and an expired/used token surfaces a toast error, not a crash)
- Submitting a non-existent email still shows the neutral confirmation (no enumeration)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This completes S-01.

---

## Testing Strategy

No test framework is installed yet (CLAUDE.md: "No test framework installed yet"), so S-01 verification is build/lint + structured manual testing. Establishing a test framework is out of scope here; the manual steps below are the acceptance gate.

### Manual Testing Steps:

1. **Signup happy path**: `/signup` → name + new email + password + matching confirm → auto-signed-in → `/dashboard` renders with the name.
2. **Validation**: mismatched confirm (inline error), short password (<8, inline error), invalid email (inline error) — submit stays blocked.
3. **Duplicate email**: signup with an existing email → toast error, no crash.
4. **Signin**: `/login` with correct creds → `/dashboard`; wrong password → toast error.
5. **Gating**: while signed out, hit `/dashboard` → redirect `/login`.
6. **Signout**: from dashboard header → `/login`; `/dashboard` no longer accessible.
7. **Reset**: `/reset` with a known email → console logs URL + neutral confirmation → open URL → `/reset/confirm` with token → set new matching password → `/login` → sign in with new password.
8. **Reset edge**: `/reset/confirm` with no token → invalid-link state; reused/expired token → toast error.

## Performance Considerations

Negligible. Auth calls are user-initiated and infrequent. Keep the auth client out of the server bundle (Phase 1 boundary) and the sign-out interactivity isolated to a small client component so the `(app)` shell stays server-rendered.

## Migration Notes

None — no schema or data migration. `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` already provisioned for F-01 (set as Workers secrets for deploy; `process.env` fallback locally). The first real `user` rows created here are what every product table's `ownerId` FK will later scope to.

## References

- Research: `context/changes/account-auth-flow/research.md`
- Server scaffold: `src/lib/auth.ts:25-107`; API route: `src/app/api/auth/[...all]/route.ts:13-21`
- Middleware gate: `middleware.ts:26-46`
- Schema: `src/db/schema.ts:112-182`
- Form/toast primitives: `src/components/ui/form.tsx`, `src/components/ui/sonner.tsx`
- App-shell anticipation comment: `src/components/templates/app-shell.tsx`
- Better Auth v1.6 client API (Context7 `/better-auth/better-auth/v1.6.11`): `createAuthClient`, `signUp.email`, `signIn.email`, `signOut`, `requestPasswordReset`, `resetPassword`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth client + validation foundation

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — cb71f45
- [x] 1.2 Linting passes: `npm run lint` — cb71f45
- [x] 1.3 `auth-client.ts` and `validations/auth.ts` exist and export named symbols — cb71f45

#### Manual

- [x] 1.4 Importing `authClient` in a client component pulls no server/`pg` code into the bundle — cb71f45

### Phase 2: Authenticated route group + sign-out home

#### Automated

- [x] 2.1 Build passes: `npm run build` — f029e00
- [x] 2.2 Linting passes: `npm run lint` — f029e00
- [x] 2.3 Route `/dashboard` is emitted in the build output — f029e00

#### Manual

- [x] 2.4 Unauthenticated `/dashboard` redirects to `/login` — f029e00
- [x] 2.5 With a session, `/dashboard` renders the stub + authenticated header — f029e00
- [x] 2.6 Sign-out button visible in the authenticated header — f029e00
- [x] 2.7 While signed in, `/login` / `/signup` / `/reset` redirect to `/dashboard` — f029e00

### Phase 3: Sign-in + sign-up forms

#### Automated

- [x] 3.1 Build passes: `npm run build` — e1cdf8b
- [x] 3.2 Linting passes: `npm run lint` — e1cdf8b

#### Manual

- [x] 3.3 Signup (name+email+password+match) creates user, auto-signs-in, lands `/dashboard` — e1cdf8b
- [x] 3.4 Mismatched confirm shows inline error and blocks submit — e1cdf8b
- [x] 3.5 Duplicate-email signup shows a toast error, no crash — e1cdf8b
- [x] 3.6 Sign-in with correct creds lands `/dashboard`; wrong password shows toast error — e1cdf8b
- [x] 3.7 Sign-out returns to `/login` and `/dashboard` is no longer accessible — e1cdf8b

### Phase 4: Password reset flow

#### Automated

- [x] 4.1 Build passes: `npm run build`
- [x] 4.2 Linting passes: `npm run lint`
- [x] 4.3 Route `/reset/confirm` is emitted in the build output

#### Manual

- [x] 4.4 `/reset` with a known email logs a reset URL + shows neutral confirmation
- [x] 4.5 Opening the logged URL lands `/reset/confirm` (unauthenticated, no redirect) with token + new-password form
- [x] 4.6 Setting a new matching password succeeds, redirects `/login`, sign-in with new password works
- [x] 4.7 `/reset/confirm` with no/invalid token shows invalid-link state; expired token shows toast error, no crash
- [x] 4.8 Non-existent email still shows neutral confirmation (no enumeration)
