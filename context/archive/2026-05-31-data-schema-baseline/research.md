---
date: 2026-05-31T00:00:00Z
researcher: Adam Reszka
git_commit: f631392f3c8e9deba08ee6c522cef573524ef11a
branch: F-02
repository: 10xdevs-certification-project
topic: "F-02 data-schema-baseline — what already exists, the full product entity model, token encryption-at-rest, and the DB driver decision"
tags: [research, codebase, schema, drizzle, better-auth, hyperdrive, encryption]
status: complete
last_updated: 2026-05-31
last_updated_by: Adam Reszka
---

# Research: F-02 data-schema-baseline

**Date**: 2026-05-31
**Researcher**: Adam Reszka
**Git Commit**: f631392f3c8e9deba08ee6c522cef573524ef11a
**Branch**: F-02
**Repository**: 10xdevs-certification-project

## Research Question

Start research on `data-schema-baseline` (roadmap F-02). What has already been built that affects this slice, and what is the full shape of the work? Two scope decisions were locked before research: (1) design the **full entity model now** for every FR F-02 touches, and (2) **research token encryption-at-rest options** (a flagged unknown).

## Summary

F-02 is in better shape than the roadmap suggests — two of its three stated risks/unknowns are effectively already resolved by F-01:

1. **`src/db/schema.ts` is no longer a placeholder.** F-01 (auth-provider-scaffold) landed four real Better Auth tables (`user`, `session`, `account`, `verification`), a working migration (`0000_light_rawhide_kid.sql`), a Drizzle config, and a per-request `getDb(env)` helper. F-02 **extends** this file — it does not start it. All product tables FK to `user.id` (text PK, `onDelete: cascade`).

2. **The DB driver risk in the roadmap is STALE.** The roadmap F-02 risk says "switch `src/lib/db.ts` to the HTTP/pooler driver (neon-http) before writing DB access code." That is obsolete. F-01 deliberately chose **Supabase Postgres over Cloudflare Hyperdrive via `drizzle-orm/node-postgres` (`pg` TCP)** — Hyperdrive is exactly what makes a TCP `pg` pool Workers-safe. `CLAUDE.md`, `infrastructure.md`, and the roadmap risk note all still echo the old Neon/HTTP mandate and are documented-stale. **F-02 needs no driver change.**

3. **The full entity model is ~18 new tables** mapped across FR-002–FR-007, FR-009–FR-013, FR-018–FR-020. The encryption-at-rest unknown resolves cleanly to **app-layer AES-256-GCM via a Drizzle `customType`** (synchronous `node:crypto`, key from a Workers Secret) — `nodejs_compat` is already enabled and load-bearing for Better Auth, so the native sync crypto path is free.

**Net impact on plan scope:** F-02 stays a pure schema+migration slice. No driver migration. The two genuine design decisions to make at `/10x-plan` time are (a) the encryption envelope/columns and (b) which high-churn tables to land minimal-now vs. defer detail to their owning slice. A side cleanup (3 stale docs) is worth folding in.

## Detailed Findings

### Area 1 — What F-01 already built (the foundation F-02 extends)

**Schema** — `src/db/schema.ts:1-93` — four Better Auth tables, immutable for F-02:
- `user` (`:4-15`): `id text PK`, `name`, `email unique`, `emailVerified bool`, `image`, `createdAt`/`updatedAt`.
- `session` (`:17-34`): FK `userId → user.id` cascade, `token unique`, index `session_userId_idx`.
- `account` (`:36-58`): FK `userId` cascade, has `password text` (email+password), plus plaintext `accessToken`/`refreshToken`/`idToken` (OAuth, unused in MVP — latent leak surface noted below), index `account_userId_idx`.
- `verification` (`:60-74`): `identifier`/`value`/`expiresAt`, index `verification_identifier_idx`, no FK.
- Relations declared at `:76-93`.

**Conventions to follow** (extracted from the above): table names lowercase **singular**; DB columns **snake_case**, TS fields **camelCase**; IDs are **`text`** (app-generated, not serial/uuid); dual timestamp pattern `defaultNow()` + `$onUpdate(() => new Date())`; FKs `references(() => user.id, { onDelete: "cascade" })`; indexes declared via the table-callback array form `(table) => [index("name_idx").on(table.col)]`.

**DB helper** — `src/lib/db.ts:1-12` — `getDb(env?)` builds a fresh `new Pool({ connectionString, max: 1 })` from `env.HYPERDRIVE.connectionString ?? process.env.DATABASE_URL` and returns `drizzle(pool)`. **Per-request, never cached** (Workers correctness rule; cf. `src/lib/auth.ts` factory pattern and the route handler comment in `src/app/api/auth/[...all]/route.ts`).

**Migration workflow** — `drizzle.config.ts` points schema→`src/db/schema.ts`, out→`src/db/migrations`, dialect `postgresql`, creds from `DATABASE_URL`. Migrations live in `src/db/migrations/` (`0000_light_rawhide_kid.sql` + `meta/_journal.json` + `meta/0000_snapshot.json`). No `db:generate`/`db:migrate` npm scripts yet — run `npx drizzle-kit generate` then `npx drizzle-kit migrate`. A separate `supabase/migrations/` lineage exists (extensions/grants baseline only) — keep the two lineages separate.

**Better Auth coupling** — `src/lib/auth.ts` wires `drizzleAdapter(db, { provider: "pg", schema })`, which pins the four table names/columns. F-02 must **not** rename or redefine them; only FK to `user.id`.

**Workers bindings** — `wrangler.jsonc`: `hyperdrive` binding `HYPERDRIVE` (id `86417a117a96464e947d5005e56f2a21`), `compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]`, `compatibility_date: "2026-05-23"`. Secrets (`BETTER_AUTH_SECRET`, `DATABASE_URL`) are set via `wrangler secret put` — plain `vars` resolved to `null` in `getCloudflareContext().env` on this OpenNext version, so a new encryption key must also be a **Secret**, not a var. Note: a `wrangler.toml` exists but is inert; `.jsonc` is canonical.

### Area 2 — DB driver decision (roadmap F-02 risk is STALE)

The authoritative choice is **Supabase + Hyperdrive + `drizzle-orm/node-postgres` (`pg` TCP)** — proven in shipped code and explicitly documented in F-01:
- Code: `src/lib/db.ts:1-12` (`drizzle-orm/node-postgres` + `pg` Pool over Hyperdrive). `package.json` has `pg`, `pg-cloudflare`, `drizzle-orm` — **no `@neondatabase/serverless` installed.**
- Rationale: `context/changes/auth-provider-scaffold/research.md:61-67` and `plan.md:12` — "Hyperdrive already solves the Workers-TCP problem the HTTP driver was meant to solve… `infrastructure.md`'s Neon/HTTP mandate is stale."

**Stale documents that contradict the code** (cleanup candidates for F-02):
- `CLAUDE.md:42` — still mandates `@neondatabase/serverless` + `drizzle-orm/neon-http`.
- `context/foundation/infrastructure.md` (≈ lines 12, 19, 53, 84, 124-128) — same Neon/HTTP mandate, forbids TCP `pg`.
- `context/foundation/roadmap.md` F-02 Risk — "switch `src/lib/db.ts` to HTTP/pooler driver." Replace with a RESOLVED note (verify Hyperdrive binding id during migration).

**F-02 action on driver: none** beyond confirming the Hyperdrive binding stays valid during migration.

### Area 3 — Token encryption-at-rest (recommendation)

PRD guardrail: GitHub PAT + Jira token encrypted at rest, never logged, never in client payloads — a leak is project-killing.

**Recommended: app-layer AES-256-GCM inside a Drizzle `customType`, backed by synchronous `node:crypto`, key from a Workers Secret.**

Why this fits *this* codebase specifically:
- `nodejs_compat` is already on and load-bearing (Better Auth uses `node:crypto` scrypt). Drizzle's `customType` `toDriver`/`fromDriver` are **synchronous** (drizzle-orm #2285 — async custom types unsupported), so Web Crypto `SubtleCrypto` (async) can't live inside a `customType`; the **synchronous** `node:crypto` `createCipheriv('aes-256-gcm')` can. So the transparent-column ergonomic is available at zero added platform cost.
- Key as a Workers Secret (`TOKEN_ENCRYPTION_KEY`) via `getCloudflareContext().env`, mirroring the proven `BETTER_AUTH_SECRET` pattern. Key lives outside Postgres (unlike pgcrypto/Vault).
- Avoids Supabase Vault's documented footgun: `INSERT` statement logging captures **plaintext** unless statement logging is disabled — a direct collision with the guardrail.

Rejected alternatives: **SubtleCrypto** (async → breaks `customType`; viable as fallback with explicit encrypt/decrypt in the DAL); **pgcrypto/Vault** (key DB-side, weak "never logged", poor Drizzle fit, Supabase recommends against new pgsodium/TCE use); **Secrets Store/KV** (app-level config, not per-account dynamic user data).

**Columns implied** (single-envelope form, recommended): one `encryptedToken` column holding `v1:base64(iv):base64(ciphertext||gcmTag)` + a `keyVersion smallint` for rotation. Operational notes: bind `userId`+`provider` as GCM **AAD**; use `autoDecrypt:false` semantics so a broad `SELECT` can never serialize plaintext; `fromDriver` must not throw; decrypt only at the sync-engine call site that actually calls GitHub/Jira. Better Auth's existing plaintext `account.accessToken/refreshToken/idToken` are a separate latent surface (unused in email+password MVP; encrypt if OAuth lands in phase 2).

### Area 4 — Full entity model (~18 new tables)

Every table is account-scoped via `ownerId text NOT NULL → user.id ON DELETE CASCADE` + an index on `ownerId` (hard PRD cross-account-isolation guarantee). Five central `pgEnum`s recommended: `anomaly_type` (8), `status_category` (5, reserve phase-2 `BLOCKED`), `severity` (3), `technology_track` (4), `absence_type` (3).

| # | Table | FR / Slice | Purpose | Stability |
|---|---|---|---|---|
| 1 | `github_credential` | FR-002 / S-02 | GitHub PAT (🔒 encrypted), one per account; `githubLogin`, `scopes`, `tokenLast4`, `validatedAt` | STABLE |
| 2 | `jira_credential` | FR-003 / S-03 | Jira token (🔒 encrypted) + `workspaceUrl` + `jiraEmail`, one per account | STABLE |
| 3 | `monitored_repo` | FR-004 / S-02 | Repos to monitor (many); `githubRepoId`, `fullName`, `isActive` | STABLE |
| 4 | `jira_project` | FR-004 / S-03 | The single monitored Jira project (unique per account); `projectKey`, `boardId` | STABLE |
| 5 | `status_mapping` | FR-005 / S-03 | One row per Jira status → 5-category enum (per-row, **not** a blob — needed for aging joins + phase-2 BLOCKED) | STABLE |
| 6 | `team_member` | FR-006 / S-04 | Roster (data entities, no login); `githubUsername`↔`jiraAccountId`, `role`, `spCapacity`, `technologyTrack`, `source` | STABLE |
| 7 | `sprint` | FR-007, FR-012 / S-04,S-05 | Cadence + sprint metadata; `endDate` is the **retention purge key** (S-12) | STABLE |
| 8 | `sync_state` | FR-011, FR-012 / S-05 | One row per (account, integration); `lastSuccessfulSyncAt`, `status`, `jiraHistoryCursor`, `freshnessWindowMinutes` | STABLE |
| 9 | `github_commit` | FR-011,013 / S-05 | High-volume; `sha`, `authorGithubUsername`, `authoredAt`, `additions/deletions`, `branch` | HIGH-CHURN |
| 10 | `github_pull_request` | FR-011,013 / S-05 | High-volume; size, `readyForReviewAt`, `linkedTicketKey`, `state`, `sourceUrl` | HIGH-CHURN |
| 11 | `github_review` | FR-011,013 / S-05 | High-volume; `reviewerGithubUsername`, `state`, `submittedAt` | HIGH-CHURN |
| 12 | `jira_ticket` | FR-012,013 / S-05 | High-volume; `jiraKey`, `storyPoints`, `currentCategory`, `lastStatusChangeAt`, `addedAfterSprintStart`, `sourceUrl` | HIGH-CHURN |
| 13 | `jira_status_history` | FR-012,013 / S-05,S-10 | Append-only transitions for cumulative time-in-status (S-10 aging); `jiraChangelogId` dedup | HIGH-CHURN |
| 14 | `anomaly` | FR-013,014,015 / S-06 | 8-typed record, 5 attributes (severity/description/`context jsonb`/suggestedAction/sourceUrl) + `riskScore`, `relatedTeamMemberId`, `detectedAt` | HIGH-CHURN (cols stable, `context` open) |
| 15 | `anomaly_settings` | FR-009,014 / S-06,S-14 | One row per (account, anomalyType); `severityOverride` + `thresholds jsonb` (SP-aware timeout map) | HIGH-CHURN (blob) |
| 16 | `absence` | FR-010 / S-08 | `type`, window `start/end`, `isPlanned` → capacity + SPRINT_AT_RISK + DEVELOPER_INACTIVE suppression | STABLE |
| 17 | `daily_recap` | FR-018,019 / S-11,S-12 | `sprintId` purge key, `payload jsonb` snapshot (same anomaly objects, not re-generated), `sendStatus` | HIGH-CHURN (payload) |
| 18 | `refinement_session` | FR-020 / S-13 | `storyText`, `questions jsonb`, `dorScore`, `missingChecklist`, `model` | HIGH-CHURN (jsonb) |

Coverage check: FR-002(#1), FR-003(#2), FR-004(#3,4), FR-005(#5), FR-006(#6), FR-007(#7), FR-009(#15), FR-010(#16), FR-011(#8-11), FR-012(#7,8,12,13), FR-013(#9-14), FR-014(#14,15), FR-015(#14), FR-018(#17), FR-019(#17), FR-020(#18). All F-02 FRs mapped.

**Key design recommendations carried into `/10x-plan`:**
1. Credentials: **two tables** (not one polymorphic) — GitHub/Jira metadata diverges and S-02/S-03 are parallel slices; app-layer AES-256-GCM ciphertext columns + `keyVersion` + `tokenLast4`.
2. `sprint.endDate` populated from day one of S-05 syncs — retention purge (S-12) keys on sprint boundaries, not calendar days.
3. `status_mapping` as per-row rows (efficient aging/detection joins; clean phase-2 `BLOCKED`).
4. High-volume tables: consider `bigserial` PK + unique source-id dedup keys for incremental upsert under the Workers subrequest budget (S-05 risk).
5. **No technology-track history table** in MVP — FR-006 needs mutability, not history; inter-sprint trend is a PRD Non-Goal.
6. Land HIGH-CHURN tables minimal-now (lock the contract columns the FR pins; treat `jsonb` bodies as deliberately open) so S-05/S-06/S-11/S-13 aren't blocked but aren't over-specified.

## Code References

- `src/db/schema.ts:1-93` — existing Better Auth tables + conventions to mirror
- `src/lib/db.ts:1-12` — `getDb(env)`, Hyperdrive TCP driver (no change needed)
- `src/lib/auth.ts` — `createAuth(env)` factory; `drizzleAdapter(db, { provider:"pg", schema })`; `requireSession()`
- `src/app/api/auth/[...all]/route.ts` — per-request auth instance pattern (Workers caching rule)
- `drizzle.config.ts` — migration config; `src/db/migrations/0000_light_rawhide_kid.sql` + `meta/`
- `wrangler.jsonc` — `HYPERDRIVE` binding, `nodejs_compat`, secrets-not-vars note
- `package.json` — `drizzle-orm`, `pg`, `pg-cloudflare`, `drizzle-kit`, `supabase`; no `@neondatabase/serverless`

## Architecture Insights

- **Hyperdrive is the load-bearing decision** that makes ordinary Drizzle+`pg` valid on Workers — it retroactively invalidates the Neon/HTTP mandate scattered across the foundation docs.
- **Account-scoping is the universal pattern** — every product table FKs to `user.id` cascade; this is the relational expression of the PRD cross-account-isolation guarantee.
- **`nodejs_compat` (on for Better Auth scrypt) also unlocks synchronous `node:crypto` AES-GCM**, which is what makes the transparent encrypted-column ergonomic viable given Drizzle's synchronous `customType` contract.
- **Stable vs. high-churn split** lets F-02 lock the foundation (credentials, roster, sprint, mappings, sync state) while keeping the engine-owned tables (synced data, anomalies, recaps, refinement) minimal until their slice refines them.

## Historical Context (from prior changes)

- `context/changes/auth-provider-scaffold/research.md:61-67` — first flagged the Neon/HTTP-vs-Hyperdrive contradiction and declared the docs stale.
- `context/changes/auth-provider-scaffold/plan.md:12` — "DB is Supabase Postgres over Cloudflare Hyperdrive via `drizzle-orm/node-postgres` (`pg`)… This is the real driver; `infrastructure.md`'s Neon/HTTP mandate is stale."
- F-01 impl-review notes (per `git log`) — established the per-request `getDb`/`createAuth` non-caching rule that F-02's data-access code must also follow.

## Open Questions

1. **Encryption envelope shape** — single packed string vs. discrete `ciphertext`/`iv`/`authTag`/`keyVersion` columns. Recommendation: single envelope + `keyVersion`. Decide at `/10x-plan`.
2. **How much of the high-churn tables to materialize in F-02** — land all 18 vs. land STABLE + thin stubs for the engine-owned tables. The locked scope answer was "full entity model," but `/10x-plan` should still decide column-depth per high-churn table.
3. **Stale-doc cleanup in-scope?** — `CLAUDE.md:42`, `infrastructure.md`, roadmap F-02 risk all still mandate Neon/HTTP. Recommend folding the fix into F-02 (or a tiny separate docs change) so the contradiction doesn't mislead later slices.
4. **PRD Open Q #1 (6th `BLOCKED` status category)** — schema reserves room (enum extensible) but MVP ships 5. No action needed in F-02 beyond using an extensible enum.

## Related Research

- `context/changes/auth-provider-scaffold/research.md` — F-01 DB/auth foundation (the direct predecessor of this slice).
