---
date: 2026-06-14T17:51:37+0200
researcher: Adam Reszka
git_commit: 00e3b60
branch: feat/setup-github-integration
repository: 10xdevs-certification-project
topic: "S-02 Setup wizard — GitHub integration (PAT connect + repo selection) + reusable wizard shell"
tags: [research, codebase, setup-wizard, github, credentials, server-mutation]
status: complete
last_updated: 2026-06-14
last_updated_by: Adam Reszka
---

# Research: S-02 Setup wizard — GitHub integration

**Date**: 2026-06-14T17:51:37+0200
**Researcher**: Adam Reszka
**Git Commit**: 00e3b60
**Branch**: feat/setup-github-integration
**Repository**: 10xdevs-certification-project

## Research Question

How should S-02 (`setup-github-integration`, FR-002 + FR-004) be implemented: connect a GitHub PAT, validate it against the GitHub API before storing it encrypted, and let the user select repositories to monitor — including a reusable `/setup` wizard shell that S-03/S-04 will extend?

## Summary

The slice sits on top of a **fully-prepared foundation**: F-02 already landed the `github_credential` + `monitored_repo` tables and the AES-256-GCM `crypto.ts` (whose own comment says "Call sites land in S-02"), and S-01 established the form/route/session patterns to copy. Net-new work is glue, not foundations.

Key decisions surfaced by the research:

1. **GitHub client → raw `fetch`, not Octokit.** Octokit has recurring Workers footguns (global-scope construction crash via `bottleneck`, unmaintained throttling, ~88 KiB gzip) for what is only two GET calls. Build a small `src/lib/github.ts` on Workers-native `fetch`.
2. **Mutation mechanism → Next.js Server Action (first in the repo).** No `"use server"` and no product route handler exists yet (only the better-auth catch-all). A co-located Server Action honors the `requireSession()` guard and the client/server import boundary cleanly. Route handlers under `/api/github/*` are the fallback if a Server Action proves awkward on OpenNext.
3. **`/setup` route → under the gated `(app)` group**, with a reusable wizard-shell template; `organisms/setup/` already exists (empty) for the step forms.
4. **PAT scope answer (roadmap Unknown):** classic PAT, read `x-oauth-scopes` from the `GET /user` response; `repo` is the scope that matters for private-repo sync — warn if absent. Fine-grained PATs don't return that header (MVP locks classic per FR-002).
5. **Two blockers before implementation:** (a) provision `TOKEN_ENCRYPTION_KEY` (only a placeholder in `.env.example` today); (b) add shadcn `checkbox` + `scroll-area` primitives for the repo picker.

## Detailed Findings

### Area 1 — Route structure, gating, and the reusable wizard shell

Route tree today (`src/app/`):
- `(app)/` — gated group: `layout.tsx` calls `requireSession()` + renders `AppShell`; contains `dashboard/page.tsx` (the stub template to mirror). `export const dynamic = "force-dynamic"` is set on the layout.
- `(auth)/` — public group, redirects authed users to `/dashboard`.
- `api/auth/[...all]/route.ts` — better-auth catch-all (the only route handler).

Gating chain (defense-in-depth):
1. `middleware.ts:26-43` — optimistic cookie check (`PUBLIC_PREFIXES = ["/", "/login", "/signup", "/reset", "/api/auth"]`, `isPublic()`); **explicitly not the security boundary** (CVE-2025-29927).
2. `src/app/(app)/layout.tsx:22` — authoritative `await requireSession()` (DB-backed).
3. `src/lib/auth.ts:88-123` — `getOptionalSession()` (React `cache()`-wrapped) + `requireSession()` (redirects to `/login`).

**`/setup` does not exist.** It should live under `(app)` so it inherits the exact `requireSession()` gate as `/dashboard` (no new gating layer; `session.user.id` becomes `ownerId`).

Component structure (atomic design): `ui/` has only **button, card, form, input, label, sonner**. `atoms/brand`, `molecules/{main-nav, sign-out-button}`, `templates/app-shell`. **`organisms/setup/` exists but is empty (`.gitkeep`)** — purpose-built for this slice. **No wizard/stepper component exists.**

Recommended layout (for S-02 + S-03/S-04 extension):
```
src/app/(app)/setup/
  layout.tsx          # wizard chrome (step indicator + progress) — wraps AppShell children
  page.tsx            # redirect → /setup/github (step 1)
  github/page.tsx     # S-02
  jira/page.tsx       # S-03 (later)
  team/page.tsx       # S-04 (later)
src/components/templates/setup-wizard-shell.tsx   # reusable step shell (parallels app-shell.tsx)
src/components/organisms/setup/github-connect-form.tsx
src/components/organisms/setup/repo-selector.tsx
src/components/organisms/setup/github-connection-status.tsx
```
The 4 setup steps are S-02 (GitHub), S-03 (Jira + status mapping), S-04 (roster + cadence, possibly two sub-steps). The wizard shell should be step-agnostic (title + "Step N of 4" + progress + content slot); the 5-category status mapping is an S-03 detail, not shell concern.

### Area 2 — Server mutation + DB write pattern

- **Per-request DB rule** (`src/lib/db.ts:4-12`): `getDb(env)` builds a fresh `pg.Pool({max:1})` + `drizzle()` every call; nothing memoized. The Hyperdrive-backed pool must NOT be cached at module scope (`auth.ts:18-25`). Call `getDb(env)` **inside the request**.
- **env at request time**: `getCloudflareContext().env` from `@opennextjs/cloudflare` (used in `api/auth/route.ts:14` and `auth.ts:90-93`).
- **No Server Actions and no product route handler exist** — grep for `"use server"` is empty; only `api/auth/[...all]/route.ts`. S-02 establishes the first product mutation. Both mechanisms can reach `env` via `getCloudflareContext()`.
  - **Recommended: Server Action** (`"use server"` co-located `actions.ts`). It keeps `requireSession()` + zod validation + `encryptToken` + DB upsert together and is the idiomatic Next 16 choice. Caveat: call `getCloudflareContext()` / `getDb(env)` **inside** the action body.
  - **Fallback: Route handlers** under `src/app/api/github/{validate,save}/route.ts` (consistent with the lone existing handler precedent) if Server Actions misbehave on this OpenNext version.
- **ID generation**: product PKs are app-supplied `text` with no DB default. No `uuid`/`nanoid` dep; `src/lib/utils.ts` has only `cn()`. **Use `crypto.randomUUID()`** (`node:crypto`, `nodejs_compat` on) for `githubCredential.id` and each `monitoredRepo.id`. Zero new deps.
- **Drizzle write API has no in-repo precedent** (all persistence so far is via the better-auth adapter). S-02 introduces the first `db.insert(...).onConflictDoUpdate(...)`. Verify exact `onConflictDoUpdate` signature against `drizzle-orm@0.45.2` (Context7) at plan time.

### Area 3 — GitHub API client (decision: raw fetch)

- **No HTTP client installed** (`package.json` — no octokit/axios). `wrangler.jsonc` flags: `nodejs_compat`, `global_fetch_strictly_public`. `next.config.ts` `serverExternalPackages: ["pg","pg-cloudflare"]`.
- **Why fetch over Octokit**: `new Octokit()` at module/global scope throws "Disallowed operation … within global scope" on Workers (bundled `bottleneck` schedules IO at construction — cloudflare/workers-sdk#2975, octokit/plugin-throttling.js#794); `bottleneck` is unmaintained; sibling packages hit `setTimeout(...).unref is not a function`; ~468 KiB upload / ~88 KiB gzip for a trivial worker. S-02 needs two GETs — fetch is a few KB and Workers-native.
- **Validate PAT** — `GET https://api.github.com/user` with headers `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, **`User-Agent: SprintFlow` (required or 403)**. 200 → valid (`login` → `githubLogin`, set `validatedAt`); 401 → reject before storing (satisfies FR-002). Read granted scopes from the **`x-oauth-scopes`** response header → `githubCredential.scopes`.
- **List repos** — `GET /user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=full_name`. Paginate via the **`Link` header** `rel="next"` (GitHub's OpenAPI omits it for this route even though the API returns it — read the real header). Capture `id` → `monitoredRepo.githubRepoId` (number), `full_name` → `fullName`.
- **Scope answer (roadmap Unknown)**: classic PAT — `repo` is needed to read **private** repos' commits/PRs/reviews (S-05); `public_repo` covers public only. Recommend: read `x-oauth-scopes`, **warn if `repo` absent** (private repos won't sync), store scopes so S-05 can degrade gracefully.
- **Classic vs fine-grained**: fine-grained PATs do NOT return `x-oauth-scopes`. FR-002 (prd.md:98 Socratic) locks **classic PAT** for MVP. If a 200 returns no `x-oauth-scopes`, surface "MVP expects a classic PAT".
- **Rate limit**: classic PAT = 5000 req/h (prd.md:219). S-02 spends ≈1-2 requests. Capture `x-ratelimit-remaining`/`reset` headers for S-05's freshness budget (Open Question #3).

### Area 4 — Reusable S-01 form / validation / UI patterns

- **Form skeleton to copy verbatim** (`organisms/auth/login-form.tsx`): `"use client"` → imports order (`zodResolver`, `useRouter`, `useForm`, `toast`, ui, then `authClient`/schema) → `useForm<T>({resolver: zodResolver(schema), defaultValues})` → `async onSubmit` **wrapped in try/catch** (added in S-01 impl-review): `const { error } = await <mutation>; if (error) { toast.error(error.message ?? "…"); return; } …router.push/refresh; catch { toast.error("Something went wrong. Please try again."); }` → `isSubmitting = form.formState.isSubmitting` → `<Card><CardHeader/><Form {...form}><form className="flex flex-col gap-6"><CardContent className="flex flex-col gap-4">{FormField…}</CardContent><CardFooter>{submit}</CardFooter></form></Form></Card>`.
- **Two-stage flow** can reuse `reset-form.tsx`'s `useState` success-swap (validate token → render repo selector).
- **Validation**: centralize in a **new `src/lib/validations/github.ts`** (don't bloat `auth.ts`). zod v4. Suggested: `githubTokenSchema` (`token` min 1 + `/^gh[ps]_/` regex), `repoSelectionSchema` (`selectedRepoIds: z.array(z.string()).min(1)`) + inferred types. Note `githubRepoId` is `bigint({mode:"number"})` — form holds strings, server coerces.
- **Client/server boundary** (`auth-client.ts:1-15`): client form modules must NOT import `auth.ts`/`crypto.ts`/`db` (pull in `pg`/`node:crypto`). The form holds only a reference to the Server Action (or `fetch`es the route); server-only imports live inside the action/handler.
- **shadcn primitives needed**: only button/card/form/input/label/sonner exist. **`npx shadcn add checkbox scroll-area`** (required/recommended) for a scrollable checkbox repo list; `command popover` only if search is needed. Consult the `@shadcn` MCP first (CLAUDE.md). `radix-ui ^1.4.3` peers already satisfied.
- **Credential read-back**: no existing pattern. Render a read-only "Connected as {githubLogin} (ghp_••••{tokenLast4})" Card **without decrypting** — `tokenLast4`/`githubLogin` columns + `redactToken()` exist precisely for this. Deleting `githubCredential` cascades to `monitoredRepo` (schema.ts:244) — relevant for a "Disconnect" action.

## Code References

- `src/db/schema.ts:196-213` — `githubCredential` (ownerId **unique**, encryptedToken, tokenLast4, githubLogin, scopes, validatedAt)
- `src/db/schema.ts:235-253` — `monitoredRepo` (githubRepoId bigint number, fullName, credentialId, ownerId; unique `monitored_repo_owner_repo_uq` on (ownerId, githubRepoId))
- `src/db/schema.ts:62` — `integration` pgEnum `["GITHUB","JIRA"]` (provider-string convention)
- `src/lib/crypto.ts:81-97,105-142,148-150` — `encryptToken` / `decryptToken` / `redactToken`; `TokenAad {ownerId, provider}`; needs `TOKEN_ENCRYPTION_KEY` (32-byte base64)
- `src/lib/db.ts:4-12` — per-request `getDb(env)`
- `src/lib/auth.ts:88-123` — `getOptionalSession()` / `requireSession()`
- `src/app/api/auth/[...all]/route.ts:14` — `getCloudflareContext().env` per-request pattern
- `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx` — gated layout + server-component page template
- `src/components/organisms/auth/login-form.tsx`, `signup-form.tsx`, `reset-form.tsx` — form template (incl. try/catch)
- `src/lib/validations/auth.ts` — centralized zod schema pattern
- `src/lib/auth-client.ts:1-15` — client/server import-boundary rule
- `src/components/templates/app-shell.tsx` — shell with `actions` slot (parallel for wizard shell)
- `.env.example:22-23` — `TOKEN_ENCRYPTION_KEY` placeholder (NOT in `.env`/`.env.local`/`wrangler.jsonc`)

## Architecture Insights

- **Foundations are genuinely ready**: schema + crypto + session guards all landed; S-02 is the first *consumer* of `crypto.ts` and the first *product mutation* + first *Drizzle write* + first *external API client* in the app. Treat it as the template-setting slice for all later integration work (S-03 Jira mirrors it almost exactly).
- **Minimal-deps, Workers-native posture** is consistent across the repo (no HTTP client, no id lib, node:crypto over Web Crypto). The fetch-over-Octokit and randomUUID-over-nanoid recommendations preserve that.
- **Security guardrail is load-bearing** (PRD: tokens never logged, never in client payloads). The whole validate→encrypt→store path must keep the plaintext PAT server-side only; the form posts it to the action/handler, which returns only non-secret meta (login, last4, repo names). Audit log/response paths before merge (roadmap S-02 Risk).
- **Per-request instance discipline** (getDb/getCloudflareContext inside the request) must be honored in the new mutation, same as auth.

## Historical Context (from prior changes)

- `context/changes/account-auth-flow/research.md` + `plan.md` — S-01: established route groups, `requireSession`/`getOptionalSession`, the form/zod/toast pattern, and (impl-review) the try/catch-around-auth-calls rule and `getOptionalSession` + React `cache()` extraction. Also surfaced the **local-dev prerequisites**: `initOpenNextCloudflareForDev()` in `next.config.ts` and applying migrations to the local Supabase DB (54322) — both now in place.
- `context/foundation/roadmap.md:139-153` — S-02 detail: outcome, prereqs (S-01, F-02), the PAT-scope Unknown (answered here), and the credential-encryption Risk.
- F-02 (`data-schema-baseline`) — landed `github_credential`/`monitored_repo` + `crypto.ts`; roadmap.md:101 notes the encrypted-storage design with call sites deferred to S-02/S-03.

## Open Questions / Decisions to pin in the plan

1. **AAD provider string**: agents suggested both `"github"` and `"GITHUB"`. Recommend **`"GITHUB"`** to match the `integration` pgEnum convention (schema.ts:62). Must be identical on encrypt and any later decrypt (S-05).
2. **Mutation mechanism**: Server Action (recommended) vs route handlers — confirm Server Actions work cleanly on this OpenNext/Workers version during Phase 1 spike; fall back to `/api/github/*` if not.
3. **Flow ordering**: validate-then-show-repos in one action returning `{login, scopes, repos[]}` (no write), then a second action to store credential + selected repos — vs. store credential on validate-success then store repo selections. FR-002 only requires "validate before store"; recommend validate→return repos (no write) → user selects → single store action (credential upsert + repos). Pin in plan.
4. **`TOKEN_ENCRYPTION_KEY` provisioning** (blocker): add to local `.env`/`.env.local` (`openssl rand -base64 32`) and as a Workers **secret** (not `var` — vars resolve null on this OpenNext version per F-02 / wrangler.jsonc:29-32) before the action can run.
5. **shadcn additions**: `checkbox` + `scroll-area` (confirm via `@shadcn` MCP before adding).
6. **Scope-warning UX**: how to present "no `repo` scope → private repos won't sync" and "looks like a fine-grained PAT" — inline warning vs toast; decide in plan.
7. **Wizard shell scope**: build the reusable `setup-wizard-shell` now (S-02 uses step 1/4) vs. minimal page now + shell in S-04. Scope decision was "build the shell now" — confirm step count/labels in the plan.

## Related Research

- `context/changes/account-auth-flow/research.md` — sibling S-01 research (auth, sessions, forms).
