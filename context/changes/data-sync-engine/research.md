---
date: 2026-08-20T17:37:11+0200
researcher: Adam Reszka
git_commit: 9f8083e1202b7addb5b205a48d6ca6b126792bb1
branch: feat/s05-data-sync-engine
repository: 10xdevs-certification-project
topic: "S-05 data sync engine — client fetch methods, scheduled-context DB pool lifecycle, overlap guard"
tags: [research, codebase, data-sync, cron, workers, hyperdrive, github, jira]
status: complete
last_updated: 2026-08-20
last_updated_by: Adam Reszka
---

# Research: S-05 Data Sync Engine

**Date**: 2026-08-20T17:37:11+0200
**Researcher**: Adam Reszka
**Git Commit**: 9f8083e1202b7addb5b205a48d6ca6b126792bb1
**Branch**: feat/s05-data-sync-engine
**Repository**: 10xdevs-certification-project

## Research Question

Ground the three axes the frame brief left open before `/10x-plan`:
- **(c)** new client fetch methods on `github.ts` / `jira.ts` (commits/PRs/reviews; tickets/status-history delta) — none exist yet;
- **(e)** the DB pool lifecycle in a `scheduled()` (cron) context — no request after-hook;
- **(f)** an overlap guard so two overlapping cron fires don't race per owner.

Plus the cross-cutting concerns the frame flagged: multi-user fan-out under the Workers subrequest/CPU budget (D2), PR↔ticket correlation at ingestion (D3), and freshness from actual DB completion time (E5).

## Summary

The frame brief holds up under codebase evidence. Concretely:

- **(c) Net-new, but the pattern is fully fixed by precedent.** `github.ts` and `jira.ts` have *only* setup/validation methods; there is zero commit/PR/review or ticket/changelog fetch. Every new method mirrors an existing, battle-tested shape: a private `githubGet`/`jiraGet` helper, typed `*AuthError`/`*UnavailableError`, injectable `baseUrl`+`fetchImpl`, and a capped, cross-origin-checked pagination loop (lesson #4). The token-decrypt seam (`credentials.ts`) already hands the sync a plaintext PAT and a normalized Jira `baseUrl`.
- **(e) The real work is a new pool-lifecycle helper.** `getDb()` builds `new Pool({ max: 1 })` per call and **nothing in the codebase ever calls `pool.end()` or `ctx.waitUntil` — grep-confirmed zero occurrences.** Lesson #3 (request-scoped pool must be torn down) is a *known-but-unfixed* debt on the request path; the cron path has **no request after-hook at all**, so S-05 must own an explicit pool teardown via `ctx.waitUntil(pool.end())` after all queries. The write-path convention is firmly established: **all network I/O completes BEFORE `db.transaction` opens** (jira-store F1, github-store, roster-store), transaction body = pure DB writes with `onConflictDoUpdate`.
- **(f) There is no lock primitive today, and the fetch-before-transaction convention defeats the obvious one.** `syncState` has `unique(ownerId, integration)` but no lease/lock column, and the `sync_status` enum is only `OK | ERROR | RATE_LIMITED` (no `RUNNING`). A txn-level Postgres advisory lock is Hyperdrive-safe but would only cover the short write phase — *not* the long fetch phase where overlap actually burns rate limit. Because upserts are already idempotent (unique dedup keys), overlap threatens **wasted subrequests, not corruption**; the recommended guard is a lightweight **claim/lease row** (a short txn at sync start), not an advisory lock.
- **Biggest open architectural decision (not (c)/(e)/(f)): global-loop vs. fan-out.** Cloudflare Cron Triggers fire **once globally**; the 10k-subrequest + CPU ceilings are **per invocation**. A single `scheduled()` that loops all owners shares one budget across *every* owner — fine for a demo, doesn't scale. True per-owner fan-out needs Queues (not installed) or self-`fetch` sub-invocations. **This should be decided in `/10x-plan`.**
- **No cron is wired yet** — `wrangler.jsonc` has no `triggers.crons`; the `.open-next/worker.js` entry has no `scheduled()` export. Both are net-new and the OpenNext hook for a custom `scheduled` handler needs doc verification.

## Detailed Findings

### (c) Client fetch methods — net-new, pattern fully determined by precedent

**What exists today** (both clients are raw-`fetch`, no Octokit/no SDK):

- `src/lib/github.ts` — `validatePat`, `listRepos`, `listCollaborators`. **No** commit / PR / review fetch.
- `src/lib/jira.ts` — `validateCredentials`, `listProjects`, `listProjectStatuses`, `listBoards`, `getActiveSprint`, `listAssignableUsers`. **No** ticket / status-history / changelog fetch.

**The fixed pattern every new method must mirror:**

- Private GET helper mapping transport failure → `*UnavailableError` (`github.ts:95-111` `githubGet`; `jira.ts:177-190` `jiraGet`). Network errors are deliberately **not** attached as `cause` (token-leak guard).
- Two typed errors: `GithubAuthError`/`GithubUnavailableError` (`github.ts:34-52`), `JiraAuthError`/`JiraUnavailableError` (`jira.ts:43-61`). 401 → Auth; 403/429/5xx/network → Unavailable. Post-validation calls treat a 401 as an availability blip, not an auth verdict.
- Injectable `baseUrl` + `fetchImpl` seam (`github.ts:24-27`, `jira.ts:28-30`) so both unit tests and Playwright e2e can mock a server-side fetch.
- **Capped + cross-origin-checked pagination** (lesson #4, `lessons.md:27-31`): `MAX_*_PAGES = 20`, and every server-directed next-link is rejected unless its origin equals the base origin before refetching with the token (`github.ts:164-242`, `jira.ts:243-322`). GitHub uses `Link: rel="next"`; Jira `/search` uses `PageBean.nextPage`; Agile endpoints use offset `startAt`/`isLast`.
- Jira `baseUrl` is computed **once** as the effective base (non-prod override else normalized workspace) and reused for both the request and the origin-check (F2, `jira.ts:8-16`). `credentials.ts:106` already returns that normalized base.

**New methods S-05 needs to add:**

- **GitHub** (`github.ts`): `listCommits(repo, since)` → `GET /repos/{repo}/commits?since=`; `listPullRequests(repo, since)` → `GET /repos/{repo}/pulls?state=all&sort=updated&direction=desc`; `listReviews(repo, prNumber)` → `GET /repos/{repo}/pulls/{n}/reviews`. **Budget caveat**: the `pulls` *list* endpoint omits `additions/deletions/changed_files` (needed for `PR_TOO_BIG`) — those require a per-PR `GET /repos/{repo}/pulls/{n}`, and reviews are per-PR too, so PR count drives subrequest fan-out (D2). Verify exact fields/params against live GitHub docs in `/10x-plan`.
- **Jira** (`jira.ts`): active-sprint tickets + `expand=changelog` for status-history; incremental delta driven by `syncState.jiraHistoryCursor`. Jira Cloud is migrating `/rest/api/3/search` → `/rest/api/3/search/jql` (token pagination) — **confirm the current non-deprecated endpoint via context7 before implementing.** Story-point field is a custom field (`customfield_*`) that varies per Jira site; discovery/config of that field id is an open detail.
- Target write columns already exist and are typed: `githubCommit` (`sha`, `additions/deletions`, `branch`, `authoredAt`), `githubPullRequest` (state enum `OPEN|CLOSED|MERGED`, `additions/deletions/changedFiles`, `openedAt/mergedAt/readyForReviewAt`, `linkedTicketKey`), `githubReview` (state enum `APPROVED|CHANGES_REQUESTED|COMMENTED`, `submittedAt`), `jiraTicket` (`storyPoints`, `currentCategory`, `addedAfterSprintStart`, `lastStatusChangeAt`), `jiraStatusHistory` (`jiraChangelogId` NOT NULL). (`schema.ts:419-575`)

### (e) DB pool lifecycle in the scheduled context

- `getDb(env)` = `new Pool({ max: 1 })` per call, returns `drizzle(pool)`; the pool is **never exposed and never closed** (`db.ts:4-12`).
- **Grep across `src/` (excluding tests) found zero `pool.end(` and zero `waitUntil`.** Lesson #3 (`lessons.md:19-24`) says the request-scoped pool must be closed at request end via the request after-hook / `ctx.waitUntil` scheduled to run *after* the handler — but that fix is **not yet implemented anywhere**. The request path currently leaks; the cron path has no request lifecycle to hang teardown on.
- Env plumbing: request paths read `getCloudflareContext().env` (`auth.ts:89-93`, every `setup/*/actions.ts`, `api/auth/[...all]/route.ts`). A `scheduled(controller, env, ctx)` handler receives `env` and `ctx` as **direct arguments** — `ctx.waitUntil(pool.end())` is the correct teardown seam, run after all upserts resolve.
- **Established write convention S-05 must follow**: all network reads complete **before** `db.transaction` opens; the transaction body is pure DB writes (`jira-store.ts:100-117, 172-240`; `github-store.ts:128-140`; `roster-store.ts:183, 424-450`). A `fetch` nested in a transaction would pin the single Hyperdrive-backed connection for the network duration (the connection-exhaustion lesson). Sync is larger than onboarding, so the plan should decide transaction granularity (per-repo / per-batch upsert txns) rather than one giant transaction after a full multi-repo fetch.
- Store modules are already the right unit: pure, injectable `{ db, ownerId, env, … }` functions with **no** `getCloudflareContext`/`requireSession`/`next/headers` (`jira-store.ts:18-29`) — the sync engine's store layer should match so it is callable from both a `scheduled()` handler and an on-demand route.

### (f) Overlap guard per owner

- `syncState` (`schema.ts:349-378`): `unique(ownerId, integration)`, columns `lastSuccessfulSyncAt`, `lastAttemptAt`, `status`, `lastError`, `jiraHistoryCursor`, `freshnessWindowMinutes (default 15)`. **No lock/lease/claimedUntil column.**
- `sync_status` enum = `OK | ERROR | RATE_LIMITED` only (`schema.ts:65-69`) — **no `RUNNING`/`IN_PROGRESS`**, so a status-based "is a sync in flight?" guard needs a new enum value (migration) or a separate mechanism.
- **Advisory-lock tension**: over Hyperdrive (connection multiplexing) only **transaction-level** advisory locks (`pg_advisory_xact_lock`) are safe — but they auto-release at txn end, and the convention keeps the long fetch phase *outside* any transaction. So a txn-level lock guards only the short write window, not the fetch window where overlap wastes rate limit. Session-level advisory locks are unsafe under Hyperdrive pooling.
- **Idempotency already defends correctness**: every synced table has a unique dedup key + `onConflictDoUpdate` (`github_commit_repo_sha_uq`, `github_pr_repo_prid_uq`, `jira_ticket_owner_key_uq`, `jira_status_history_ticket_changelog_uq`), and lesson #1 guarantees the dedup columns are NOT NULL. Two overlapping fires therefore produce the *same* rows, not duplicates — the real cost of overlap is **duplicate subrequests / rate-limit burn**, not corruption.
- The infrastructure pre-mortem race (`infrastructure.md:79`) was premised on the HTTP driver lacking connection-level transactions; with Hyperdrive + `node-postgres`, `db.transaction` is available and used. That downgrades the risk from "corruption" to "waste".
- **Recommended guard** (for `/10x-plan`): a lightweight **claim/lease** — a short txn at owner-sync start that stamps `lastAttemptAt` and a `claimedUntil` (new column) or a `RUNNING` status; the next fire skips owners whose lease is fresh. Cheaper and correctly-scoped versus an advisory lock, and it doubles as the "is this owner mid-sync?" signal for the dashboard.

### Cross-cutting: fan-out & the Workers budget (D2)

- **Cron Triggers fire once globally** (`infrastructure.md:38, 57, 87`); the **10k-subrequest and CPU limits are per invocation** (`infrastructure.md:73, 75, 107`). A single `scheduled()` looping all owners shares one budget across *every* owner — the documented mitigation is to batch the Jira delta and **cap the GitHub scan to N most-recent events per cycle** (`infrastructure.md:107`).
- Per-owner cost stacks: Jira (search pages + changelog) + GitHub (per repo: commits + pulls, then per-PR review + per-PR detail). PR count is the dominant multiplier.
- **Open architectural choice**: (A) global loop over all owners in one invocation (simple; budget-bound to a handful of owners) vs. (B) global cron **enqueues per-owner jobs** so each owner syncs in its own invocation with its own budget. (B) needs Cloudflare Queues (**not installed**) or self-`fetch` sub-invocations. The frame's "multi-user from day one" decision pushes toward (B), but (A) may be acceptable for MVP scale with a hard per-cycle cap. **Decide in `/10x-plan`.**

### PR↔ticket correlation at ingestion (D3)

- `githubPullRequest.linkedTicketKey` + `github_pr_linked_ticket_idx` exist (`schema.ts:470, 481`); **no code populates them.** S-05 parses the Jira key at ingestion — a pure helper (à la `suggestCategory`) that matches `[A-Z][A-Z0-9]+-\d+` scoped to the monitored project's `projectKey` (from `jiraProject.projectKey`) against the PR branch / title / body. This makes rows correlatable for S-06 without a detection-time join.

### Freshness = actual DB completion time (E5)

- `lastSuccessfulSyncAt` is stamped at **sync completion** (`new Date()` at handler end), never the scheduled trigger time — Cron timing is not SLA'd (`infrastructure.md:87, 109`; `deploy-plan.md:369-373` E5). The dashboard reads `syncState.lastSuccessfulSyncAt` per integration.

## Code References

- `src/lib/github.ts:34-52` — typed error classes; `:95-111` `githubGet`; `:164-242` capped+origin-checked pagination (methods to mirror)
- `src/lib/jira.ts:8-16` — effective-base F2 rule; `:177-190` `jiraGet`; `:243-322` PageBean pagination; `:507-559` `getActiveSprint` (nearest sibling to ticket fetch)
- `src/lib/db.ts:4-12` — `getDb` builds `Pool({max:1})`, never closed
- `src/lib/auth.ts:26-27, 89-93` — per-request construction from `getCloudflareContext().env` (env-plumbing precedent)
- `src/lib/integrations/credentials.ts:45-110` — `loadGithubToken` / `loadJiraCredentials` decrypt seam (returns plaintext token + normalized Jira baseUrl)
- `src/lib/integrations/jira-store.ts:100-117, 172-240` — fetch-before-transaction convention + `onConflictDoUpdate` upsert with stable ids
- `src/lib/integrations/github-store.ts:128-140` — sibling upsert-in-transaction
- `src/lib/onboarding.ts:28-78` — owner-scoped derived-state query pattern (owner isolation guard)
- `src/db/schema.ts:349-378` — `syncState` (cursor, status, freshness window; no lock column)
- `src/db/schema.ts:419-575` — synced tables + dedup unique keys; `:65-79` sync/pr/review enums
- `src/db/schema.ts:235-290, 318-334` — read-source tables (monitoredRepo, jiraProject, statusMapping, sprint)
- `wrangler.jsonc` — Hyperdrive binding present; **no `triggers.crons`**
- `next.config.ts` — `serverExternalPackages: ["pg","pg-cloudflare"]`; `initOpenNextCloudflareForDev()`

## Architecture Insights

- **Two-layer split is already the norm**: pure injectable store/service functions (`{db, ownerId, env}`, no request globals) under `src/lib/integrations/`, wrapped by thin Server Actions / routes that supply `getCloudflareContext().env`. S-05's engine should live as store-style modules callable from BOTH a `scheduled()` handler and an on-demand route (the frame's "Cron + on-demand" decision).
- **Idempotency is designed-in, not bolted-on** — unique dedup keys + NOT NULL dedup columns (lesson #1) + `onConflictDoUpdate` mean re-runs and overlaps converge. This is what lets the overlap guard be a cheap lease rather than a hard lock.
- **The token never crosses a log/return boundary** — decrypt at the last moment (`credentials.ts`), pass to the client for the immediate outbound call, never persist/log. New fetch methods inherit this by construction (typed errors never carry the token).
- **DB is the single source of sync state** (`infrastructure.md:108`) — no module-level caches for correctness; cursor + timestamps live in `syncState`.

## Historical Context (from prior changes)

- `context/changes/data-sync-engine/frame.md` — the framing this research grounds; D1–D6 dimension map, three user decisions (Cron+on-demand, ingestion-time correlation, multi-user now), and the added D6 overlap risk.
- `context/foundation/lessons.md` #1 (NOT-NULL dedup columns), #3 (pool teardown after handler), #4 (capped + origin-checked pagination) — all three directly bind S-05.
- `context/foundation/infrastructure.md` — pre-mortem :79 (overlapping-cron races), :87/:109 (freshness from DB time), :107 (batch Jira / cap GitHub), :108 (DB single source of truth).
- `context/deployment/deploy-plan.md:14` (cron wiring belongs to the feature plan, i.e. S-05, not the deploy plan), E5 :369-373 (cron drift → DB completion timestamp).

## Related Research

None prior for this change (research was skipped at framing; this is the first). Sibling change `onboarding-routing` owns first-run routing and consumes `isOnboardingComplete` (`onboarding.ts`).

## Open Questions

1. **Global-loop vs. fan-out (biggest one).** One `scheduled()` iterating all owners under a shared per-invocation budget, or a cron that enqueues per-owner jobs (Queues — not installed — or self-`fetch`)? Multi-user-now argues for fan-out; MVP scale might tolerate a capped global loop. → `/10x-plan`.
2. **OpenNext `scheduled()` hook.** How to add a `scheduled()` export alongside OpenNext's generated `.open-next/worker.js` fetch handler (custom worker entry vs. supported hook). → verify against `@opennextjs/cloudflare` docs (context7) in `/10x-plan`.
3. **Overlap guard shape.** New `claimedUntil` column + short claim txn, vs. a new `RUNNING` value on the `sync_status` enum, vs. accept-overlap-because-idempotent with only a per-cycle cap. → `/10x-plan` (leaning claim/lease).
4. **Jira endpoints & story-point field.** Confirm `/rest/api/3/search/jql` (vs. deprecated `/search`) and the changelog-delta shape; discover the site-specific `customfield_*` story-point id. → context7 + implementation.
5. **GitHub per-PR fan-out.** `additions/deletions/changedFiles` + reviews are per-PR GETs → confirm the per-cycle PR cap and whether commit line-counts need per-commit GETs or can be derived from PR detail. → `/10x-plan` (D2 budget).
6. **Pool teardown, finally.** S-05 needs a `scheduled`-safe pool lifecycle (`ctx.waitUntil(pool.end())`); worth deciding whether to also retrofit lesson #3 on the request path in the same change or leave it. → `/10x-plan`.
