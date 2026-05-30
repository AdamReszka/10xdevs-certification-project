# F-01 Auth Provider Scaffold — Plan Brief

> Full plan: `context/changes/auth-provider-scaffold/plan.md`
> Research: `context/changes/auth-provider-scaffold/research.md`

## What & Why

Land SprintFlow's authentication foundation (FR-001, Access Control): a configured auth library with email+password, server-issued sessions, and a route gate that redirects unauthenticated users to `/login`. This is the substrate every gated route and the whole product sits on — it must work on the Cloudflare Workers runtime before any downstream slice depends on it.

## Starting Point

A near-bare Next.js 16.2.6 App Router scaffold: no auth library, no `proxy.ts`/`middleware.ts`, no `src/app/api/`, an empty `src/db/schema.ts`, and only a Supabase baseline migration with zero tables. The DB layer already works — `drizzle-orm/node-postgres` (`pg`) over a Cloudflare Hyperdrive binding to Supabase (`src/lib/db.ts`). `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are already Workers secrets; the auth secret is not yet set.

## Desired End State

A deployed Worker where sign-up/sign-in/sign-out/get-session work end-to-end against the real DB with native `node:crypto` scrypt hashing, the `user`/`session`/`account`/`verification` tables exist via an applied migration, and any gated path without a session redirects to `/login` while the public allowlist stays open. No UI pages yet — that's S-01.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Auth library | **Better Auth** | Native email+password with DB sessions; NextAuth's Credentials provider is JWT-only and won't hash passwords for you. | Research |
| DB driver target | `drizzle-orm/node-postgres` + Hyperdrive | The real stack is Supabase+Hyperdrive+`pg`; `infrastructure.md`'s Neon/HTTP mandate is stale. | Research |
| Table ownership | **F-01 owns all four** auth tables | Keeps F-01 standalone-functional (no prerequisite on F-02); F-02 FKs into `user`. | Plan |
| API surface | **Full** catch-all `/api/auth/[...all]` handler | Foundation is end-to-end exercisable and the smoke test runs the real sign-up path; S-01 just adds UI. | Plan |
| Password reset | Config the flow, **stub** the sender | Avoids pulling Resend into a foundation slice while the config seam exists. | Plan |
| Email verification | **Not required** (`requireEmailVerification: false`) | No email transport yet; fine for a single-tenant lead tool, harden later. | Plan |
| Password hashing | **Default Better Auth scrypt** | The native-scrypt fix shipped (utils PR#16 / core PR#8685); resolves native under `nodejs_compat`. | Plan |
| Session strategy | **DB sessions + cookie cache** | Fast middleware gating without a DB hit per request; full session still in DB. | Plan |
| `compatibility_date` | **Bump to 2025** | Enables the fully-native `node:crypto` path that de-risks hashing. | Plan |
| Middleware | **`proxy.ts`**, default-deny + allowlist | Next.js 16 renamed `middleware.ts`→`proxy.ts` (Node runtime); secure-by-default gating. | Plan |
| Testing | **Skip for now** | Course timing — testing material lands next week; flagged as a known gap. | Plan |

## Scope

**In scope:** Better Auth install + config; `user`/`session`/`account`/`verification` schema + migration; catch-all auth handler; `proxy.ts` route gate; server-side `requireSession()` helper; `BETTER_AUTH_SECRET`; deployed crypto smoke gate.

**Out of scope:** UI pages + client session provider (S-01); working reset email / Resend (S-01/S-11); email verification; token-encryption design (F-02); OAuth; automated tests.

## Architecture / Approach

Better Auth instance + Drizzle `db` built **per-request** from `getCloudflareContext().env` — because the `pg` Pool over Hyperdrive is a request-scoped connection that can't be reused across Worker invocations (this is the real rule, not "no singletons"; do not copy the zpg6 D1 singleton, whose driver differs). `proxy.ts` does a fast optimistic cookie check; gated server components do full DB session validation (defense-in-depth). A separate static `auth` export (dual-mode `createAuth(env?)`) exists only for the schema-gen CLI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Crypto smoke gate | Better Auth installed, compat-date bumped, hashing proven native on a real Worker | scrypt hitting the Workers CPU limit (mitigated; `node:crypto` custom-hasher fallback documented) |
| 2. Schema + migration | Four auth tables generated + applied; full Better Auth config | per-request vs static `auth` split for the CLI |
| 3. Handler + proxy + verify | `/api/auth/[...all]`, `proxy.ts` gate, secret set, full deployed cycle verified | `baseURL`/`trustedOrigins` misconfig masquerading as a crypto failure |

**Prerequisites:** Cloudflare account + `wrangler` auth (already set up); Supabase DB reachable; ability to deploy to `*.workers.dev`.
**Estimated effort:** ~2–3 focused sessions across the 3 phases.

## Open Risks & Assumptions

- Default scrypt resolving native on *this* OpenNext/Workers bundle is assumed from the shipped fix but **proven only by the Phase 1 deployed smoke test** — the `node:crypto` custom hasher is the documented fallback if it regresses to the `@noble` path.
- No automated tests this slice — the hasher + session logic ship verified by deploy only.
- F-02 must be coordinated to reference (not redefine) the F-01-owned `user` table.

## Success Criteria (Summary)

- A user can sign up, get a session, and sign out against the deployed Worker with no `exceededCpu`/timeout.
- An unauthenticated request to a gated path redirects to `/login`; the public allowlist stays reachable.
- The four auth tables exist via an applied migration; `BETTER_AUTH_SECRET` is a Workers secret and never leaks.
