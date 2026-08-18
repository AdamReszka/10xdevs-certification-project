# Setup Wizard — GitHub Integration (S-02) — Plan Brief

> Full plan: `context/changes/setup-github-integration/plan.md`
> Research: `context/changes/setup-github-integration/research.md`

## What & Why

Setup-wizard **step 1 of 4**: let a signed-in tech lead connect a GitHub classic PAT, validate it against the GitHub API *before* storing, choose which repos to monitor, and persist the encrypted credential + repo selection scoped to their account (FR-002, FR-004). It's the **template-setting slice** — first product mutation, first Drizzle write, first external-API client, first integration tests, and the reusable `/setup` shell S-03/S-04 extend.

## Starting Point

The foundation is ready: `githubCredential` + `monitoredRepo` tables and `crypto.ts` (AES-256-GCM, "call sites land in S-02") landed in F-02; S-01 established the session guards, gated `(app)` group, and the form/zod/toast pattern; Vitest + Playwright harnesses exist. Net-new work is glue: the GitHub client, the Server Actions, the wizard UI, and the first integration-test harness.

## Desired End State

A user visits `/setup`, lands on the GitHub step, pastes a classic PAT, and sees it validated (invalid tokens rejected before any write). On success they pick from a scrollable list of their repos — with an inline warning if the PAT can't reach private repos — and save. Reloading shows "Connected as {login} (ghp_••••{last4})" with a Disconnect action. No plaintext token ever appears in a response body, log line, or client payload.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| GitHub client | Raw `fetch`, not Octokit | Octokit crashes at Workers global scope; ~88 KiB for two GETs | Research |
| Mutation mechanism | Server Action (route-handler fallback) | Idiomatic Next 16; keeps session/zod/crypto/DB in one server-only module | Plan |
| Flow ordering | validate→return repos (no write)→select→single store | Satisfies "validate before store" without persisting on validation | Research |
| AAD provider string | `"GITHUB"` | Matches `integration` pgEnum + `crypto.test.ts`; must match S-05 decrypt | Research |
| ID generation | `crypto.randomUUID()` | App-supplied text PKs, no DB default; zero new deps | Research |
| Disconnect | Full disconnect + re-connect | Complete credential lifecycle (delete cascades repos) | Plan |
| Scope warning | Inline non-blocking alert on repo step | Stays visible while picking; doesn't block valid public-only setup | Plan |
| Wizard shell | Full step-agnostic shell now | S-03/S-04 just drop in their step | Plan |
| Test depth | Integration #3/#4 + `github.ts` unit + happy-path e2e | Each risk at its cheapest layer; #3/#4 are mandated sub-phases | Plan |
| Action/service seam | Thin action over injectable service core (`github-store.ts`) | Makes #3/#4 tests runnable in Vitest node; template for S-03 | Plan-review |
| Test split | Separate `test:integration` project (unit stays DB-free) | `npm test` can't be both hermetic and require Postgres | Plan-review |
| Server-side GitHub mock | Injectable base URL + globalSetup fixture server | `page.route()` can't intercept a server-side fetch | Plan |

## Scope

**In scope:** GitHub PAT connect + validate; repo picker + store (encrypted, owner-scoped); disconnect; reusable 4-step wizard shell; inline scope warning; `github.ts` client; integration harness + #3/#4/disconnect-IDOR tests; happy-path e2e; `TOKEN_ENCRYPTION_KEY` provisioning.

**Out of scope:** actual data sync (S-05); Jira/roster/status-mapping (S-03/S-04); fine-grained PAT / GitHub App / Enterprise; repo search box; settings/thresholds (S-14).

## Architecture / Approach

`/setup/github` (server component under gated `(app)`) → `SetupWizardShell` chrome → client connect form calls a `"use server"` action → **thin action wrappers** (`requireSession()` + `getDb(env)`) delegate to an **injectable service core** `src/lib/integrations/github-store.ts` (`{ db, ownerId, … }`, no request context) which does `github.ts` → `GET /user` + `/user/repos`, `encryptToken`, and the Drizzle upsert (`.returning({ id })` for repo FKs). Connected-status card + `disconnectGithub`. Token stays server-side throughout; actions return only non-secret meta. The service seam is what makes the credential-security tests runnable in Vitest node and is the template S-03 copies.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Client, validations, primitives, key | `github.ts` (+unit tests), zod, shadcn primitives, `TOKEN_ENCRYPTION_KEY`, Server Action spike | Server Actions unproven on this OpenNext version — spike gates the mechanism |
| 2. Wizard shell + connect step | `/setup` shell, connect/repo/status UI, validate/store/disconnect actions | First Drizzle write + first product mutation; token must never leak into return/logs |
| 3. Security test surface | Integration harness + #3/#4/disconnect IDOR (real Postgres) + happy-path e2e | Ownership enforced only by `where eq(ownerId,…)` — IDOR test must hit real query layer |

**Prerequisites:** S-01 + F-02 done (both are); local Supabase up on `:54322` for integration/e2e; `TOKEN_ENCRYPTION_KEY` provisioned (Phase 1).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- **Server Actions on OpenNext/Workers** is unproven here — Phase 1 spike decides Server Action vs route-handler fallback before UI is built on it.
- `TOKEN_ENCRYPTION_KEY` must be a Workers **secret**, not a `var` (vars resolve null on this OpenNext version — F-02 finding).
- `onConflictDoUpdate` signature is first-use in the repo — verify against `drizzle-orm@0.45.2` (Context7) at implementation.
- Fine-grained PATs return no `x-oauth-scopes` — surfaced as a warning; MVP assumes classic PAT (FR-002).

## Success Criteria (Summary)

- A real classic PAT connects, lists repos, stores encrypted + owner-scoped, and disconnects cleanly — verified manually and by the happy-path e2e.
- The mandated security tests pass against real Postgres and go **red** when their guarded behavior is deliberately broken (#3 token leak, #4 ownership predicate).
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck` all green.
