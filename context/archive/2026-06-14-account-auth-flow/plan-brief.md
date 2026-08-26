# Account Auth Flow (S-01) — Plan Brief

> Full plan: `context/changes/account-auth-flow/plan.md`
> Research: `context/changes/account-auth-flow/research.md`

## What & Why

Deliver roadmap slice S-01: a tech lead can sign up, sign in, sign out, and reset their password by email+password (FR-001). The Better Auth server scaffold (F-01), the auth schema (F-02), and the UI shells (F-03) are already done — this slice is the **client-side glue** that makes the inert auth pages actually work, the first real entry point into the product.

## Starting Point

Server-side auth is fully wired and Workers-safe: `emailAndPassword` enabled, all four auth tables migrated, middleware gating + a DB-backed `requireSession()` guard. The three `(auth)` pages render form organisms, but those forms are static `TODO(S-01)` placeholders with no submit, no validation, no client call. `react-hook-form`/`zod`/`sonner` and every shadcn primitive are already installed; `better-auth/react` is in node_modules. Missing entirely: a client SDK instance, any authenticated route to land on, a sign-out trigger, and a token-consuming new-password page.

## Desired End State

A visitor registers (name + email + password), is auto-signed-in, and lands on a gated `/dashboard` stub. They can sign out (→ `/login`), sign back in, and run the full reset cycle — request a link, open the tokenized `/reset/confirm` page, set a new password, sign in with it. Validation errors render inline; auth/network failures raise a toast; unauthenticated `/dashboard` access redirects to `/login`. No white screens.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Reset email transport | Log-only, defer to S-11 | F-01 explicitly scopes transport as deferrable; keeps S-01 a pure client slice with no new dep/secret | Plan |
| Post-auth landing | New `(app)` group + `/dashboard` stub | Gives redirects a real target and sign-out a home; exercises middleware + `requireSession()` end-to-end | Plan |
| Reset page shape | New `(auth)/reset/confirm` token page | Clean split: reset-form requests, confirm page completes; mirrors Better Auth's own demo | Plan |
| Signup `name` | Add a Name field | `signUp.email` needs it; real display name for later user menu/recap | Plan |
| Auto sign-in on signup | Keep `autoSignIn: true` (explicit) | Smoothest onboarding; no email-verification gate to satisfy | Plan |
| Error surfacing | Inline `FormMessage` + toast for server errors | Field issues stay by the field, system failures get a prominent toast; satisfies "no white screen" guardrail | Plan |

## Scope

**In scope:** auth client (`src/lib/auth-client.ts`), zod schemas, four wired forms (login/signup/reset-request/reset-confirm), Name field, explicit `autoSignIn`, `(app)` group + `/dashboard` stub + authenticated app-shell with sign-out, tokenized `/reset/confirm` page.

**Out of scope:** real reset email (S-11), email verification, dashboard content (S-07), setup wizard (S-02/S-03), OAuth/social login, profile editing, remember-me / rate-limiting / CAPTCHA, test framework, schema/migration changes.

## Architecture / Approach

Single browser-side `authClient` (from `better-auth/react`) is the only module the forms call; it must not import the server `auth` instance (keeps `pg` out of the client bundle). Forms use the installed shadcn `Form`/`FormField`/`FormMessage` + `zodResolver`; server failures surface through the root-mounted Sonner `Toaster`. The `(app)` layout enforces the session server-side via `requireSession()`; middleware continues to provide the cheap optimistic-cookie redirect. Build bottom-up so each phase's dependency already exists.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Client + validation foundation | `auth-client.ts`, zod schemas, explicit `autoSignIn` | Client/server import boundary — keep `pg` out of the client bundle |
| 2. Authenticated group + sign-out | `(app)` layout (`requireSession`), `/dashboard` stub, app-shell sign-out | Cookie-after-redirect timing; shell stays server-rendered |
| 3. Sign-in + sign-up forms | Both forms wired, Name field, inline + toast errors, redirect to `/dashboard` | Mapping Better Auth `{error}` codes to friendly messages |
| 4. Password reset flow | Reset-request wired + tokenized `/reset/confirm` confirm page | Reset-link URL/`redirectTo` shape; token read from query |

**Prerequisites:** F-01/F-02/F-03 (all `done`); `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` already provisioned; dev server runnable.
**Estimated effort:** ~1–2 sessions across 4 phases; mostly client wiring, no backend or schema work.

## Open Risks & Assumptions

- Reset flow is verified via the **console-logged URL**, not a real inbox (transport deferred to S-11) — acceptable per the F-01 scoping comment.
- No automated tests exist; the acceptance gate is `npm run build` + `npm run lint` + the manual walk-through.
- Assumes the optimistic session cookie is set synchronously enough that a `router.push("/dashboard")` after sign-in passes middleware (a `router.refresh()` fallback is noted if not).

## Success Criteria (Summary)

- Signup → auto-login → `/dashboard`; sign-out → `/login`; sign-in works; unauthenticated `/dashboard` redirects to `/login`.
- Full reset cycle (request → tokenized page → new password → sign in) works via the logged URL.
- All validation errors inline, all auth/network errors as toasts, no white screens — `npm run build` and `npm run lint` pass.
