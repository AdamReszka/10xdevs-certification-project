# Setup Wizard — GitHub Integration (S-02) Implementation Plan

## Overview

Build setup-wizard **step 1 of 4**: connect a GitHub classic Personal Access Token, validate it against the GitHub API *before* storing it, let the user pick which repositories to monitor, and persist the encrypted credential + selected repos scoped to the signed-in account. This is the **template-setting slice** — the first product mutation, the first Drizzle write, the first external-API client, the first integration tests, and the reusable `/setup` wizard shell that S-03 (Jira) and S-04 (roster/cadence) will extend. It also lands the two credential-security test surfaces that `test-plan.md` §3 Phase 1 could not ground because no target code existed (#3 leakage, #4 IDOR).

PRD refs: FR-002 (validate-before-store), FR-004 (choose repos). Roadmap: S-02.

## Current State Analysis

The foundation is genuinely ready — S-02 is glue, not foundations:

- **Schema landed** (`src/db/schema.ts:196-253`): `githubCredential` (`ownerId` **unique**, `encryptedToken`, `tokenLast4`, `githubLogin`, `scopes`, `validatedAt`) and `monitoredRepo` (`githubRepoId` bigint/number, `fullName`, `credentialId`, `ownerId`; unique `(ownerId, githubRepoId)`; `credentialId` FK cascades on credential delete).
- **Crypto landed** (`src/lib/crypto.ts`): `encryptToken(plaintext, {ownerId, provider}, env?)` → versioned AES-256-GCM envelope; `redactToken()` for `tokenLast4`; needs `TOKEN_ENCRYPTION_KEY` (32-byte base64). Own comment says "Call sites land in S-02." Covered by `src/lib/crypto.test.ts`.
- **Session guards landed** (`src/lib/auth.ts:88-123`): `requireSession()` (redirects to `/login`), `getOptionalSession()` (React `cache()`-wrapped). Gated `(app)` group layout (`src/app/(app)/layout.tsx`) already calls `requireSession()` + `export const dynamic = "force-dynamic"`.
- **Form pattern landed** (S-01, `src/components/organisms/auth/*`): `"use client"` → `zodResolver` + `useForm` → `onSubmit` wrapped in try/catch → `<Card><Form><form>…`. Centralized zod in `src/lib/validations/auth.ts`.
- **Per-request DB rule** (`src/lib/db.ts:4-12`): `getDb(env)` builds a fresh `pg.Pool({max:1})` per call — never cache at module scope; call **inside** the request. `env` via `getCloudflareContext().env` (`@opennextjs/cloudflare`).
- **Test harnesses landed**: Vitest (node env, `src/**/*.test.ts`, `npm test`) and Playwright (`e2e/`, `npm run test:e2e`, auth via `e2e/auth.setup.ts` storageState). `e2e/seed.spec.ts` is the reference spec.

What's missing (this slice): the `/setup` route + wizard shell, `src/lib/github.ts`, `src/lib/validations/github.ts`, the connect/store/disconnect Server Actions, the repo-picker UI, shadcn `checkbox`/`scroll-area`/`alert`, a provisioned `TOKEN_ENCRYPTION_KEY`, and the first integration-test harness.

## Desired End State

A signed-in user visits `/setup`, is taken to step 1 (GitHub), pastes a classic PAT, and on **Connect** the token is validated against `GET /user`; an invalid token is rejected before anything is stored. On success the user sees their GitHub login and a scrollable checklist of their repositories (with an inline warning if the PAT lacks `repo` scope or looks fine-grained), selects one or more, and **Save**s. The encrypted credential + selected repos are persisted scoped to their account; re-visiting shows a "Connected as {login} (ghp_••••{last4})" card with a **Disconnect** action that clears the credential and its repos. No plaintext token ever appears in a response body, a log line, or a client payload.

Verify:
- `npm test` green (crypto + `github.ts` unit + integration #3/#4/disconnect-IDOR).
- `npm run test:e2e` green (happy-path connect→pick→store).
- `npm run lint` + `npm run typecheck` clean.
- Manual: connect a real classic PAT against a real GitHub account, pick repos, reload, disconnect.

### Key Discoveries

- GitHub client → **raw `fetch`, not Octokit** (`new Octokit()` crashes at Workers global scope via bundled `bottleneck`; ~88 KiB gzip for two GETs). Research §Area 3.
- `GET /user` requires `User-Agent` header or returns **403**. Granted scopes come from the **`x-oauth-scopes`** response header; fine-grained PATs omit it (MVP locks classic per FR-002).
- `GET /user/repos` paginates via the **`Link` header** `rel="next"` (GitHub's OpenAPI omits it but the API sends it — read the real header).
- Product PKs are app-supplied `text` with no DB default → use `crypto.randomUUID()` (`node:crypto`, `nodejs_compat` on). Zero new deps.
- AAD provider string **must be `"GITHUB"`** (matches `integration` pgEnum `src/db/schema.ts:62` and `crypto.test.ts`) — identical on encrypt and any later decrypt (S-05).
- Ownership is enforced **only** by `where eq(table.ownerId, session.user.id)` (Data API off, no RLS) → the IDOR test must hit the real query layer against real Postgres.
- `TOKEN_ENCRYPTION_KEY` and other secrets must be a Workers **secret**, not a `var` (vars resolve null on this OpenNext version — F-02 finding).

## What We're NOT Doing

- No fine-grained PAT / GitHub App / OAuth support (FR-002 locks classic PAT; phase 2).
- No multi-project / GitHub Enterprise support.
- No actual data sync — pulling commits/PRs/reviews is **S-05**. S-02 only stores *which* repos and the credential.
- No Jira step, no roster, no status mapping (S-03/S-04) — but the wizard shell is built step-agnostic so they slot in.
- No threshold/settings UI (S-14).
- No repo **search** box (only checkbox list in a scroll area); `command`/`popover` deferred unless the list proves unwieldy.

## Implementation Approach

Three phases, in dependency order. Phase 1 builds the pure, unit-testable pieces (the GitHub client, zod schemas, UI primitives) and de-risks the Server Action mechanism with a throwaway spike. Phase 2 assembles the wizard shell + UI + the three Server Actions (validate, store, disconnect), keeping all token-touching code server-only. Phase 3 lands the mandated security test surface (integration #3/#4 + disconnect IDOR against real Postgres) and the happy-path e2e.

The mutation flow is **validate → return `{login, scopes, repos[]}` (no write)** → user selects → **single store action** (credential upsert + repos insert). This satisfies FR-002 ("validate before store") without persisting anything on a mere validation.

## Critical Implementation Details

- **Server Action env access**: call `getCloudflareContext().env` and `getDb(env)` **inside** the action body, never at module scope — same discipline as `src/lib/auth.ts:90-93`. If Server Actions misbehave on this OpenNext version (Phase 1 spike is the gate), fall back to route handlers under `src/app/api/github/{validate,save,disconnect}/route.ts`.
- **Token never leaves the server**: the store action accepts the plaintext PAT, encrypts it, and returns **only** non-secret meta (`login`, `tokenLast4`, repo names). No action return type or `console.*` / thrown-error message may include the raw token — this is the assertion #3 pins. The validate action returns repos + scopes but **not** the token.
- **`github.ts` injectable base URL**: signature takes an optional `baseUrl` (default `https://api.github.com`) and optional `fetchImpl`. This is what makes the server-side GitHub call mockable from both the unit tests and the Playwright e2e (`page.route()` cannot intercept a server-side fetch — test-plan §6.3).
- **AAD constant**: pass `{ ownerId: session.user.id, provider: "GITHUB" }` to `encryptToken`. Drift here silently breaks S-05 decrypt.
- **Drizzle upsert**: credential write is `insert(...).onConflictDoUpdate({ target: githubCredential.ownerId, set: {...} })` (ownerId is unique). Verify the exact `onConflictDoUpdate` signature against `drizzle-orm@0.45.2` via Context7 at implementation time — first Drizzle write in the repo, no in-repo precedent.
- **Re-connect FK integrity (F4)**: on re-connect the existing credential row is kept, so its `id` is unchanged and the freshly generated `randomUUID` is discarded. The `set` clause must **not** include `id`, and `monitoredRepo.credentialId` must come from the upsert's **`.returning({ id })`** (the persisted id), never the generated one — otherwise the repo FK points at a non-existent credential. The re-connect integration test guards this.

## Phase 1: GitHub client, validations, primitives & key provisioning

### Overview

Build and unit-test the pure logic (GitHub `fetch` client, zod schemas), add the UI primitives, provision the encryption key, and prove the Server Action mechanism works on OpenNext before building UI on top of it.

### Changes Required:

#### 1. GitHub API client

**File**: `src/lib/github.ts` (new)

**Intent**: A tiny Workers-native GitHub client — validate a PAT and list repos — with no third-party HTTP dependency. Injectable base URL + fetch so it's testable and e2e-mockable server-side.

**Contract**:
- `validatePat(token, opts?) → { login: string; scopes: string[]; likelyFineGrained: boolean }` — `GET {baseUrl}/user` with headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: SprintFlow`. 200 → parse `login` + `x-oauth-scopes` (comma-split; absent header ⇒ `likelyFineGrained: true`). 401 → throw a typed `GithubAuthError` ("invalid token"). **Non-401 failures (403 rate-limit/UA, 5xx, network/timeout) → throw a distinct `GithubUnavailableError`** so the form can show "couldn't reach GitHub, try again" rather than mislabeling a valid token as invalid (F5, PRD graceful-degradation). Never log the token.
- `listRepos(token, opts?) → { githubRepoId: number; fullName: string }[]` — `GET {baseUrl}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=full_name`, following `Link` `rel="next"` until exhausted. Capture `id` → `githubRepoId`, `full_name` → `fullName`.
- `opts`: `{ baseUrl?: string; fetchImpl?: typeof fetch }`, defaults `https://api.github.com` + global `fetch`.

#### 2. GitHub zod validations

**File**: `src/lib/validations/github.ts` (new)

**Intent**: Centralize input schemas (mirror `src/lib/validations/auth.ts`), keep them importable by client form modules without pulling server-only code.

**Contract**: `githubTokenSchema` (`token`: min 1 + `/^gh[ps]_/` regex), `repoSelectionSchema` (`selectedRepoIds: z.array(z.string()).min(1)`), plus inferred types. Note `githubRepoId` is number-mode; the form holds strings, the server coerces.

#### 3. UI primitives

**File**: `src/components/ui/{checkbox,scroll-area,alert}.tsx` (generated)

**Intent**: Add the shadcn primitives the repo picker + scope warning need. Consult the `@shadcn` MCP first (per CLAUDE.md), then `npx shadcn add checkbox scroll-area alert`.

**Contract**: standard shadcn new-york generated components; `radix-ui ^1.4.3` peers already satisfied.

#### 4. Encryption key provisioning

**File**: `.env` / `.env.local` (local) + Workers secret (deploy)

**Intent**: `crypto.ts` needs a real `TOKEN_ENCRYPTION_KEY` (only a placeholder in `.env.example` today). Without it every store fails.

**Contract**: `openssl rand -base64 32` → add to local `.env.local`; register as a Workers **secret** (`wrangler secret put TOKEN_ENCRYPTION_KEY`), **not** a `var` (vars resolve null on this OpenNext version). Document in `.env.example` comment.

#### 5. Server Action mechanism spike

**File**: throwaway (e.g. a temporary action in `src/app/(app)/setup/`), removed before phase end

**Intent**: De-risk the "first Server Action on this OpenNext version" unknown before building real UI on it — confirm a `"use server"` action can `requireSession()`, reach `getCloudflareContext().env`, and `getDb(env)` inside the request. If it fails, switch Phase 2 to the route-handler fallback.

**Contract**: a trivial action that reads the session id and does a no-op DB `select`; verified working in `npm run dev`, then deleted.

### Success Criteria:

#### Automated Verification:
- `github.ts` unit tests pass (`npm test`): validate 200 parses login+scopes; missing `x-oauth-scopes` ⇒ `likelyFineGrained`; 401 ⇒ `GithubAuthError`; **403/5xx/network ⇒ `GithubUnavailableError` (F5)**; `Link`-header pagination assembles multi-page repo lists; token never appears in thrown errors.
- Type checking passes: `npm run typecheck`.
- Linting passes: `npm run lint`.

#### Manual Verification:
- Server Action spike runs in `npm run dev` (session read + DB select) with no OpenNext error; spike then removed.
- `TOKEN_ENCRYPTION_KEY` present locally; `encryptToken`/`decryptToken` round-trip works against it in a scratch check.
- shadcn `checkbox`/`scroll-area`/`alert` render without style regression.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual items (esp. the Server Action spike verdict — it decides Phase 2's mechanism) before proceeding.

---

## Phase 2: Setup wizard shell + GitHub connect step

### Overview

Build the reusable `/setup` wizard shell (step-agnostic), the GitHub connect + repo-picker UI, and the three Server Actions (validate, store, disconnect). All token-touching logic stays server-only.

### Changes Required:

#### 1. Setup route group + wizard shell

**File**: `src/app/(app)/setup/{layout.tsx,page.tsx,github/page.tsx}` (new); `src/components/templates/setup-wizard-shell.tsx` (new)

**Intent**: A step-agnostic wizard chrome (title + "Step N of 4" + progress + content slot) under the gated `(app)` group so it inherits `requireSession()` with no new gating layer. `page.tsx` redirects to `/setup/github`. Parallels `src/components/templates/app-shell.tsx`.

**Contract**: `SetupWizardShell({ step, totalSteps: 4, title, children })`. `github/page.tsx` is a server component that loads any existing credential (owner-scoped) to decide connect-form vs connected-status view.

#### 2. GitHub connect form + repo selector + status

**File**: `src/components/organisms/setup/{github-connect-form,repo-selector,github-connection-status}.tsx` (new)

**Intent**: Copy the S-01 form pattern verbatim (`zodResolver`, try/catch `onSubmit`, `isSubmitting`, Card/Form layout). Two-stage flow via `useState`: validate → render repo selector. Repo selector = checkbox list inside `scroll-area`; inline `alert` warns when `likelyFineGrained` or `repo` scope absent (non-blocking — user can proceed with public repos). Status card renders "Connected as {login} (ghp_••••{last4})" from stored non-secret columns (no decryption) + a Disconnect button.

**Contract**: client components; must **not** import `auth.ts`/`crypto.ts`/`db`. They hold references to the Server Actions only. Selected repo ids validated via `repoSelectionSchema`.

#### 3. Integration service core (injectable, request-context-free)

**File**: `src/lib/integrations/github-store.ts` (new)

**Intent**: The token-touching + DB logic as **pure, injectable functions taking `{ db, ownerId, … }`** — no `getCloudflareContext()`, no `requireSession()`, no `next/headers`. This is the seam that makes the credential-security logic testable against real Postgres in Vitest node (mirrors how `crypto.ts` is pure + env-injected and `getOptionalSession` is the thin request wrapper). **It is the template S-03 (Jira) copies.**

**Contract**:
- `validateAndListRepos({ token, opts? }) → { login, scopes[], likelyFineGrained, repos[] }` — calls `github.ts`; on 401 throws `GithubAuthError`. No DB, no session.
- `storeGithubIntegration({ db, ownerId, token, selectedRepoIds }) → { login, tokenLast4, repoCount }` — `encryptToken(token, { ownerId, provider: "GITHUB" })`; upsert credential; **read the persisted id via `.returning({ id })`** and use THAT for the repo rows (see F4); delete-then-insert `monitoredRepo`. Returns non-secret meta only; never logs the token.
- `disconnectGithub({ db, ownerId }) → { ok: true }` — `delete(githubCredential).where(eq(ownerId, ownerId))` (cascades repos). Ownership is the *only* guard — this is what the #4 IDOR test exercises directly.

#### 4. Server Actions: thin wrappers over the service core

**File**: `src/app/(app)/setup/github/actions.ts` (new, `"use server"`)

**Intent**: The first product mutations — but thin. Each action does only `requireSession()` + `getCloudflareContext().env` + `getDb(env)`, then delegates to the service core with `ownerId = session.user.id`. No business logic here.

**Contract**:
- `validateGithubToken(token)` — `requireSession()`, zod-parse, delegate to `validateAndListRepos`; map `GithubAuthError` (and non-401 failures per F5) to a typed error result the form renders. **No DB write. No token in the return.**
- `storeGithubIntegration(token, selectedRepoIds)` — `requireSession()`, zod-parse, `getDb(env)`, delegate to service `storeGithubIntegration({ db, ownerId: session.user.id, … })`.
- `disconnectGithub()` — `requireSession()`, `getDb(env)`, delegate to service `disconnectGithub({ db, ownerId: session.user.id })`.
- Every action: `getCloudflareContext().env` + `getDb(env)` inside the body; no `console.*` of the token; errors carry no plaintext.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `npm run typecheck`.
- Linting passes: `npm run lint`.
- `npm test` still green (no regressions).

#### Manual Verification:
- `/setup` (signed-in) redirects to `/setup/github` and shows the wizard chrome "Step 1 of 4".
- A **valid** classic PAT validates and lists real repos; an **invalid** token shows a form error and stores nothing.
- Missing-`repo`-scope or fine-grained PAT shows the inline non-blocking warning; user can still save public repos.
- Saving persists credential + repos; reload shows the "Connected as …" card.
- **Disconnect** clears the credential and its repos; the connect form returns.
- Unauthenticated `/setup/github` redirects to `/login`.

**Implementation Note**: Pause for human confirmation of the manual flow (real PAT round-trip + disconnect) before Phase 3.

---

## Phase 3: Security test surface (integration + e2e)

### Overview

Land the first integration-test harness in the repo (real Postgres) and the mandated credential-security assertions #3/#4 + disconnect IDOR, plus the happy-path Playwright e2e. These are **required sub-phases** — S-02 is not complete without them (change.md; test-plan §5, §6.2, §6.4).

### Changes Required:

#### 1. Integration-test harness

**File**: `vitest.config.ts` (+ a `*.integration.test.ts` glob / project) and any `test/integration/` setup

**Intent**: Run integration specs against **real Postgres** (local Supabase `:54322` via `getDb`/`DATABASE_URL` in Node — **not** `vitest-pool-workers`, never a mocked DB), while keeping the existing unit suite hermetic and DB-free.

**Contract**: split into two Vitest projects (or two configs). The **unit** project keeps `include: ["src/**/*.test.ts"]` but **excludes `**/*.integration.test.ts`** so `npm test` stays hermetic (passes with no DB and `TOKEN_ENCRYPTION_KEY` unset). A new **integration** project includes only `**/*.integration.test.ts`, run via a new `test:integration` script that sets `DATABASE_URL` at `:54322`. Document the `npx supabase start` prerequisite (mirror the e2e note in test-plan §6.3). `npm test` (unit) and `npm run test:integration` are distinct commands — no phase's criteria conflate them.

#### 2. Credential-leakage integration test (#3)

**File**: `src/app/(app)/setup/github/actions.integration.test.ts` (new)

**Intent**: Prove the store/validate path never emits the plaintext token in its return value or any log line — on **both** the success and validation-failure paths. Necessary complement to `crypto.test.ts` (which only covers the envelope round-trip, not the payload/log surface).

**Contract**: target the **service core** (`github-store.ts`), not the Server Action — the service is request-context-free, so it runs in Vitest node with a real `getDb()` (`DATABASE_URL=:54322`) + explicit `ownerId` and no `getCloudflareContext`/`requireSession`. Spy on `console.*`; call `validateAndListRepos`/`storeGithubIntegration` with the GitHub edge mocked (injectable base URL); assert no captured log arg and no returned field contains the raw token; assert the DB row's `encryptedToken` ≠ plaintext and `tokenLast4` = last 4. Include a **re-connect** case (F4): store twice for the same owner and assert `monitored_repo.credential_id` still references the live credential.

#### 3. Cross-account IDOR integration test (#4)

**File**: `src/app/(app)/setup/github/actions.integration.test.ts` (same file or sibling)

**Intent**: Prove Account B cannot read or affect Account A's credential / monitored-repo rows — exercised against the real query layer (ownership is enforced only by the `where eq(ownerId, …)` predicate; Data API off, no RLS).

**Contract**: target the **service core** with an explicit `ownerId` (no session stack). Seed two accounts + Account A credential/repos in real Postgres; calling the service with Account B's `ownerId` returns empty/404 and `disconnectGithub({ db, ownerId: B })` does **not** delete A's rows. Assert A's rows intact afterward.

#### 4. Happy-path e2e

**File**: `e2e/setup-github.spec.ts` (new)

**Intent**: Drive connect→pick→store in a real browser against the real app, with GitHub mocked **server-side** via the injectable base URL (`page.route()` cannot intercept the server-side fetch).

**Contract**: pin the mock seam across three links —
1. **Server reads env**: the Server Action passes `process.env.GITHUB_API_BASE_URL` (default `https://api.github.com`) into `github.ts` `opts.baseUrl`.
2. **webServer injects it**: `playwright.config.ts` `webServer.command` becomes `GITHUB_API_BASE_URL=http://localhost:<port> npm run dev` (the only launch change).
3. **Fixture server serves it**: a tiny local server started in Playwright `globalSetup` (or a second `webServer` entry) answers `GET /user` + `GET /user/repos` with canned fixtures (incl. `x-oauth-scopes` and a `Link` next page to exercise pagination). No MSW dep needed.

Model the spec on `e2e/seed.spec.ts` (role/label/text locators, wait-for-state, unique ids, test independence). Authenticated via existing `storageState`. Steps: go to `/setup/github` → fill token → Connect → wait for repo list → check a repo → Save → assert the "Connected as …" state. Clean up created rows in `afterEach`.

### Success Criteria:

#### Automated Verification:
- Integration suite passes against real Postgres: `npm run test:integration` (with `:54322` up) — #3 no-leak (success + failure), re-connect FK integrity (F4), #4 IDOR read + disconnect isolation.
- Unit suite (`npm test`) stays green and DB-free (integration specs excluded from its glob).
- E2E passes: `npm run test:e2e` — happy-path connect→pick→store.
- `npm run lint` + `npm run typecheck` clean.

#### Manual Verification:
- **Deliberate-break signal check (#3)**: temporarily add the raw token to the store return / a log line → the #3 test goes red → revert.
- **Deliberate-break signal check (#4)**: temporarily drop the `where eq(ownerId, …)` predicate → the #4 test goes red → revert.
- **E2E signal check**: temporarily weaken token validation → the e2e (or a negative variant) reflects it → revert.
- Integration + e2e runs documented as requiring `npx supabase start` first.

**Implementation Note**: The three deliberate-break checks are the acceptance gate for this phase — a test that stays green after its guarded behavior is broken protects nothing (test-plan §6.1/§6.3). Revert every break immediately; never commit one.

---

## Testing Strategy

### Unit Tests (`src/**/*.test.ts`, Vitest node):
- `github.ts`: 200 parse (login + scopes), missing `x-oauth-scopes` ⇒ `likelyFineGrained`, 401 ⇒ `GithubAuthError`, `Link` pagination assembly, token absent from thrown errors.
- Hermetic — HTTP edge mocked via injectable `fetchImpl`/`baseUrl`; no network, no real secret.

### Integration Tests (`*.integration.test.ts`, own Vitest project, `npm run test:integration`, real Postgres `:54322`):
- Target the injectable service core (`github-store.ts`), not the Server Action — no request context needed.
- #3 credential never in response body or logs (success + validation-failure paths).
- Re-connect FK integrity (F4): storing twice for one owner keeps `monitored_repo.credential_id` valid.
- #4 cross-account IDOR: B cannot read A's rows; B's disconnect leaves A intact.

### E2E (`e2e/setup-github.spec.ts`, Playwright):
- Happy path connect→pick→store, GitHub mocked server-side via base-URL override.

### Manual Testing Steps:
1. Real classic PAT → validate → pick repos → save → reload shows connected card.
2. Invalid token → form error, nothing stored.
3. PAT without `repo` scope → inline warning, public repos still savable.
4. Disconnect → credential + repos cleared, connect form returns.
5. Unauthenticated `/setup/github` → redirect to `/login`.

## Performance Considerations

S-02 spends ≈1–2 GitHub requests (classic PAT budget = 5000 req/h) — negligible. Capture `x-ratelimit-remaining`/`reset` headers now so S-05 can reuse them for its freshness budget (PRD Open Question #3). Repo list capped at `per_page=100` with `Link` pagination; a very large account paginates but stays well under budget.

## Migration Notes

No schema migration — `githubCredential`/`monitoredRepo` already exist (F-02). The only environment change is provisioning `TOKEN_ENCRYPTION_KEY` (local `.env.local` + Workers secret) — a prerequisite, not a data migration.

## References

- Research: `context/changes/setup-github-integration/research.md`
- Test sub-phases mandate: `context/changes/setup-github-integration/change.md` §"Required test sub-phases"; `context/foundation/test-plan.md` §5, §6.2, §6.4
- Schema: `src/db/schema.ts:196-253` (tables), `:62` (`integration` pgEnum)
- Crypto: `src/lib/crypto.ts:81-150`; suite `src/lib/crypto.test.ts`
- Session/DB patterns: `src/lib/auth.ts:88-123`, `src/lib/db.ts:4-12`, `src/app/api/auth/[...all]/route.ts:14`
- Form pattern: `src/components/organisms/auth/login-form.tsx`; zod `src/lib/validations/auth.ts`
- Shell parallel: `src/components/templates/app-shell.tsx`
- E2E reference: `e2e/seed.spec.ts`, `e2e/README.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: GitHub client, validations, primitives & key provisioning

#### Automated
- [x] 1.1 `github.ts` unit tests pass (validate parse, likelyFineGrained, 401 GithubAuthError, non-401 GithubUnavailableError, Link pagination, token absent from errors)
- [x] 1.2 Type checking passes (`npm run typecheck`)
- [x] 1.3 Linting passes (`npm run lint`)

#### Manual
- [x] 1.4 Server Action spike runs in `npm run dev` (session + DB select), then removed
- [x] 1.5 `TOKEN_ENCRYPTION_KEY` provisioned; encrypt/decrypt round-trip verified
- [x] 1.6 shadcn `checkbox`/`scroll-area`/`alert` render with no style regression

### Phase 2: Setup wizard shell + GitHub connect step

#### Automated
- [ ] 2.1 Type checking passes (`npm run typecheck`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 `npm test` still green (no regressions)

#### Manual
- [ ] 2.4 `/setup` redirects to `/setup/github`, wizard chrome shows "Step 1 of 4"
- [ ] 2.5 Valid PAT lists real repos; invalid PAT errors and stores nothing
- [ ] 2.6 Missing-`repo`/fine-grained PAT shows inline non-blocking warning; public repos still savable
- [ ] 2.7 Save persists credential + repos; reload shows "Connected as …" card
- [ ] 2.8 Disconnect clears credential + repos; connect form returns
- [ ] 2.9 Unauthenticated `/setup/github` redirects to `/login`

### Phase 3: Security test surface (integration + e2e)

#### Automated
- [ ] 3.1 Integration #3 no-leak (success + failure paths) + re-connect FK integrity pass via `npm run test:integration` against real Postgres
- [ ] 3.2 Integration #4 cross-account IDOR (read + disconnect isolation) passes; unit `npm test` stays green + DB-free
- [ ] 3.3 Happy-path e2e passes (`npm run test:e2e`)
- [ ] 3.4 Lint + typecheck clean

#### Manual
- [ ] 3.5 Deliberate-break check #3 (leak token → test red) → reverted
- [ ] 3.6 Deliberate-break check #4 (drop ownerId predicate → test red) → reverted
- [ ] 3.7 E2E signal check (weaken validation → reflected) → reverted
