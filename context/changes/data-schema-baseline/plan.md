# F-02 Data Schema Baseline — Implementation Plan

## Overview

Land the SprintFlow foundation database schema: extend the existing Drizzle schema (`src/db/schema.ts`) with all ~18 product entities, a central set of Postgres enums, a token encryption-at-rest helper, and a single Supabase migration. This is the foundation slice that unblocks S-01 through S-13 — every downstream slice queries a table defined here. No query/sync/UI/feature logic ships in F-02 beyond the encryption primitive.

## Current State Analysis

What exists today (from F-01, see `research.md`):

- **`src/db/schema.ts:1-93`** — four live Better Auth tables (`user`, `session`, `account`, `verification`) with `relations()` but **no exported inferred types**. Conventions: lowercase-singular table names, snake_case DB columns / camelCase TS fields, `text` PKs (app-generated), `defaultNow()` + `$onUpdate(() => new Date())` timestamps, FKs `references(() => user.id, { onDelete: "cascade" })`, indexes via `(table) => [index("name_idx").on(table.col)]`.
- **`src/lib/db.ts:1-12`** — `getDb(env?)` over `drizzle-orm/node-postgres` + `pg` Pool, connection from `env.HYPERDRIVE.connectionString ?? process.env.DATABASE_URL`. Per-request, never cached. **The driver is final — no change needed** (Hyperdrive makes TCP Workers-safe).
- **`src/lib/auth.ts`** — env pattern to mirror: `env?.X ?? process.env.X`; secrets come from `getCloudflareContext().env` on Workers, `process.env` in Node/CLI.
- **`drizzle.config.ts`** — schema → `src/db/schema.ts`, out → `src/db/migrations`, dialect `postgresql`, creds from `DATABASE_URL`. One migration exists (`0000_light_rawhide_kid.sql`).
- **`wrangler.jsonc`** — `HYPERDRIVE` binding, `compatibility_flags: ["nodejs_compat", ...]` (so synchronous `node:crypto` AES-GCM is available), secrets set via `wrangler secret put` (plain `vars` resolve to `null` in `getCloudflareContext().env` on this OpenNext version).
- **No test framework**, **no db npm scripts**, **no `.dev.vars`** (local dev reads `.env` via `process.env`).
- Three docs carry a **stale** Neon/HTTP driver mandate contradicted by the shipped code: `CLAUDE.md:42`, `context/foundation/infrastructure.md`, roadmap F-02 Risk.

## Desired End State

`src/db/schema.ts` defines all 18 product tables (account-scoped, fully detailed), all enums, relations, and exported `$inferSelect`/`$inferInsert` types. A token-encryption module provides AES-256-GCM `encryptToken`/`decryptToken` with AAD binding. A single new migration is generated **and applied to the remote Supabase DB**, so the tables exist live. The three stale driver docs reflect Hyperdrive-TCP. Verify: `tsc` + `npm run lint` pass; `drizzle-kit migrate` reports applied; the tables are queryable in Supabase; a throwaway script round-trips a token through encrypt→decrypt and fails on tamper.

### Key Discoveries

- Schema file is live, not a placeholder — F-02 **appends**; never redefine the 4 Better Auth tables (`src/db/schema.ts:1-93`).
- `nodejs_compat` is on → synchronous `node:crypto` `createCipheriv('aes-256-gcm')` is available (the path async Web Crypto can't provide). See `research.md` Area 3.
- AAD binding (`ownerId+provider`) requires row identity at encrypt/decrypt time → the token column is plain `text` storing an envelope string, with **explicit helper calls** (not a transparent Drizzle `customType`). See Critical Implementation Details.
- `sprint.endDate` is load-bearing for S-12 retention purge — must exist now.

## What We're NOT Doing

- No data-access/repository layer, no query helpers, no sync logic, no UI — those belong to S-01+.
- No test framework / committed tests (deferred to a later training lesson; crypto verified via a throwaway script this slice).
- No seeding of `anomaly_settings` default rows (defaults defined as a typed constant in F-02; rows written per-account at S-06).
- No `BLOCKED` 6th status category (ships 5; phase-2 `ALTER TYPE` if adopted).
- No changes to the 4 Better Auth tables or the `getDb`/driver setup.
- No encryption of Better Auth's existing plaintext `account.accessToken/refreshToken/idToken` (unused in email+password MVP; phase-2 concern if OAuth lands).

## Implementation Approach

Build bottom-up: enums + crypto primitive first (Phase 1), then the stable config/entity tables (Phase 2), then the high-churn engine/data tables + the defaults constant (Phase 3), then generate+apply the migration and fix docs (Phase 4). Phases 1–3 keep `tsc`/lint green without touching the DB; the single migration is generated and applied only in Phase 4, once every table exists, yielding one clean `0001_*` migration.

## Critical Implementation Details

- **Encryption shape (AAD vs transparent column).** "Single envelope string" + "AAD-bound" together preclude a transparent Drizzle `customType` (its `toDriver`/`fromDriver` are pure value transforms with no access to the row's `ownerId`/`provider`). Resolution: the credential token columns are plain `text("encrypted_token")` storing the envelope `v1:base64(iv):base64(ciphertext‖gcmTag)`; encryption happens through explicit `encryptToken(plaintext, { ownerId, provider })` / `decryptToken(envelope, { ownerId, provider })` helpers invoked by the data-access layer in S-02/S-03. F-02 ships the helpers + columns; the per-slice call sites come later. `keyVersion` is the `v1` prefix (parsed back for rotation); no separate column required, but a `tokenLast4 text` non-secret display hint is stored to render UI without decrypting.
- **`node:crypto` must be the synchronous API.** Use `crypto.createCipheriv('aes-256-gcm', key, iv)` (12-byte random IV per encryption, never reused) + `cipher.getAuthTag()`; decrypt with `createDecipheriv` + `decipher.setAuthTag(...)` + `decipher.setAAD(aadBytes)`. GCM throws on tamper/wrong-key/wrong-AAD — surface as a controlled error, never log plaintext.
- **Key source.** `TOKEN_ENCRYPTION_KEY` (32-byte key, base64) read as `env?.TOKEN_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY`, mirroring `BETTER_AUTH_SECRET`. Set via `wrangler secret put TOKEN_ENCRYPTION_KEY` (prod) and `.env` (local). A missing key at encrypt time must throw loudly, never silently store plaintext.
- **Cross-account isolation model (PostgREST/`anon` exposure).** The Supabase baseline grants the `anon` role `USAGE` on `public` + `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES` (`supabase/migrations/20260524085002_remote_schema.sql:54,249`), and these new tables carry **no RLS** (drizzle-kit emits none). The app reaches the DB **only** via Cloudflare Hyperdrive on the direct `postgres` connection — never through PostgREST — so isolation depends on the project's **Data API (PostgREST) being disabled**. This must be true because `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is browser-bundled (`wrangler.jsonc` vars): if the Data API were on, any visitor could read `github_credential`, `team_member`, `anomaly`, etc. cross-account via `https://<ref>.supabase.co/rest/v1/<table>`, breaching the PRD cross-account-isolation guardrail. Phase 4 verifies the Data API is off (and documents it as the isolation rationale); enabling RLS is the phase-2 defense-in-depth fallback if the Data API is ever turned on.

## Phase 1: Enums & Crypto Foundation

### Overview

Define every Postgres enum centrally and build the token-encryption primitive with its key wiring. No tables yet.

### Changes Required:

#### 1. Central enums

**File**: `src/db/schema.ts` (top of file, after imports)

**Intent**: Declare the closed enum sets once via Drizzle `pgEnum` so every table references the same type and the DB enforces membership.

**Contract**: Export `pgEnum` declarations: `statusCategory` (`TODO`,`IN_PROGRESS`,`CODE_REVIEW`,`TESTING`,`DONE`), `anomalyType` (the 8 values), `severity` (`HIGH`,`MEDIUM`,`LOW`), `technologyTrack` (`FRONTEND`,`BACKEND`,`MOBILE`,`QA`), `absenceType` (`VACATION`,`SICKNESS`,`TRAINING`), plus state enums: `integration` (`GITHUB`,`JIRA`), `syncStatus` (`OK`,`ERROR`,`RATE_LIMITED`), `prState` (`OPEN`,`CLOSED`,`MERGED`), `reviewState` (`APPROVED`,`CHANGES_REQUESTED`,`COMMENTED`), `sprintState` (`ACTIVE`,`CLOSED`,`FUTURE`), `anomalyStatus` (`ACTIVE`,`RESOLVED`), `recapSendStatus` (`PENDING`,`SENT`,`FAILED`), `refinementSourceType` (`PASTED_TEXT`,`JIRA_TICKET`), `memberSource` (`GITHUB`,`JIRA`,`MANUAL`,`BOTH`). Postgres enum names snake_case; TS exports camelCase.

#### 2. Token encryption module

**File**: `src/lib/crypto.ts` (new)

**Intent**: Provide AES-256-GCM encrypt/decrypt for third-party tokens, bound to the owning row via AAD, producing a versioned envelope string. This is the security boundary the PRD guardrail demands.

**Contract**: Export `encryptToken(plaintext: string, aad: { ownerId: string; provider: string }, env?): string` returning `v1:base64(iv):base64(ciphertext‖tag)`, and `decryptToken(envelope: string, aad: { ownerId: string; provider: string }, env?): string`. Internals: synchronous `node:crypto` (`createCipheriv`/`createDecipheriv` `aes-256-gcm`), 12-byte `randomBytes` IV, `setAAD(utf8(ownerId + "\0" + provider))`, key from `env?.TOKEN_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY` (base64-decoded to 32 bytes; throw if absent/wrong length). `decryptToken` parses the `v1` version prefix for future rotation and throws a typed error (not the raw plaintext) on GCM auth failure. Export a `redactToken(plaintext): string` → `tokenLast4` helper for the non-secret display hint.

#### 3. Key configuration

**File**: `.env.example` (and developer's local `.env`)

**Intent**: Document and provision the encryption key for local dev; the production key is a Workers Secret.

**Contract**: Add `TOKEN_ENCRYPTION_KEY=` (base64 32-byte) to `.env.example` with a comment on generation (`openssl rand -base64 32`). Production provisioning noted in the plan, set out-of-band via `wrangler secret put TOKEN_ENCRYPTION_KEY` (not committed).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- A throwaway script (not committed), run with the env loaded (`node --env-file=.env <script>` — a bare `node` won't read `.env`, leaving `TOKEN_ENCRYPTION_KEY` undefined and masking the test), round-trips a sample token: `encryptToken` → `decryptToken` returns the original.
- Tamper test: flipping a byte of the ciphertext, or passing a different `{ownerId, provider}` AAD, makes `decryptToken` throw (not return wrong plaintext).
- Missing `TOKEN_ENCRYPTION_KEY` makes `encryptToken` throw loudly.

**Implementation Note**: After Phase 1 automated checks pass, pause for human confirmation of the manual crypto verification before proceeding.

---

## Phase 2: Config & Entity Tables (STABLE)

### Overview

Add the 9 stable, fully-specified config/entity tables, all account-scoped, with relations and inferred types.

### Changes Required:

#### 1. Credential tables

**File**: `src/db/schema.ts`

**Intent**: Store validated GitHub PAT and Jira API token (encrypted envelope) plus non-secret metadata, one of each per account.

**Contract**: `githubCredential` (`id` text PK; `ownerId` → user.id cascade, UNIQUE; `encryptedToken` text; `tokenLast4` text; `githubLogin` text; `scopes` text; `validatedAt` timestamp; timestamps) and `jiraCredential` (same shape plus `workspaceUrl` text NOT NULL, `jiraEmail` text NOT NULL; `ownerId` UNIQUE). Index on `ownerId` (UNIQUE covers it).

#### 2. Monitoring config tables

**File**: `src/db/schema.ts`

**Intent**: Record which repos and the single Jira project to monitor, and the per-status → 5-category mapping.

**Contract**: `monitoredRepo` (`id`; `ownerId` cascade; `credentialId` → githubCredential.id cascade; `githubRepoId` `bigint({ mode: "number" })`; `fullName` text; `isActive` boolean default true; unique(`ownerId`,`githubRepoId`)). `jiraProject` (`id`; `ownerId` cascade UNIQUE; `credentialId` → jiraCredential.id cascade; `jiraProjectId` text; `projectKey` text; `projectName` text; `boardId` text). `statusMapping` (one row per Jira status; `id`; `ownerId` cascade; `jiraProjectId` → jiraProject.id cascade; `jiraStatusId` text; `jiraStatusName` text; `category` `statusCategory` enum; unique(`jiraProjectId`,`jiraStatusId`)).

#### 3. Roster, sprint, sync-state, absence

**File**: `src/db/schema.ts`

**Intent**: Team roster (data entities, no login), sprint cadence+metadata, per-integration sync cursor, and absences.

**Contract**:
- `teamMember` (`id`; `ownerId` cascade; `name` text; `githubUsername` text; `jiraAccountId` text; `role` text; `spCapacity` integer; `technologyTrack` enum; `source` `memberSource` enum; `isActive` boolean default true; timestamps; index `ownerId`).
- `sprint` (`id`; `ownerId` cascade; `jiraProjectId` → jiraProject.id; `jiraSprintId` text; `name` text; `state` `sprintState` enum; `startDate` timestamp; `endDate` timestamp; `committedSp` integer; `completedSp` integer; `lengthDays` integer; `startDay` text; `workingDays` jsonb; `cadenceOverridden` boolean default false; timestamps; unique(`ownerId`,`jiraSprintId`)).
- `syncState` (one row per account+integration; `id`; `ownerId` cascade; `integration` enum; `lastSuccessfulSyncAt` timestamp; `lastAttemptAt` timestamp; `status` `syncStatus` enum; `lastError` text; `jiraHistoryCursor` text; `freshnessWindowMinutes` integer default 15; timestamps; unique(`ownerId`,`integration`)).
- `absence` (`id`; `ownerId` cascade; `teamMemberId` → teamMember.id cascade; `sprintId` → sprint.id; `type` `absenceType` enum; `startDate` timestamp; `endDate` timestamp; `isPlanned` boolean; createdAt; index(`teamMemberId`,`startDate`,`endDate`)).

#### 4. Relations + inferred types (Phase 2 tables)

**File**: `src/db/schema.ts`

**Intent**: Wire `relations()` for the new tables and export `$inferSelect`/`$inferInsert` types so downstream slices get typed queries.

**Contract**: Drizzle requires exactly **one** `relations()` per table — **extend the existing `userRelations` block in place** (`src/db/schema.ts:76-79`, currently sessions + accounts) to add `user → many` credentials/repos/members/sprints, rather than declaring a second `userRelations` (a duplicate-identifier error). This edits relations *metadata*, not table DDL — it does not touch the Better Auth tables and has no migration impact. Add new `relations()` for the new tables (jiraProject → many statusMappings; teamMember → many absences; etc.). Note that hub tables whose relations span both phases (e.g. `monitoredRepo`, `sprint`) get their full relation set in Phase 3 §4 — keep each as a single declaration. Export `type SelectGithubCredential = typeof githubCredential.$inferSelect` / `type InsertGithubCredential = typeof githubCredential.$inferInsert` (and equivalents) per table.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Schema reads cleanly; FK targets and enum references resolve; account-scoping (`ownerId` cascade + index/unique) present on every new table.

**Implementation Note**: Pause for human confirmation after automated checks before Phase 3.

---

## Phase 3: Engine & Data Tables (HIGH-CHURN, full detail) + Defaults

### Overview

Add the 9 remaining tables (synced GitHub/Jira data, anomaly, settings, recap, refinement) at full detail, plus the typed default-thresholds constant.

### Changes Required:

#### 1. GitHub synced-data tables

**File**: `src/db/schema.ts`

**Intent**: Store commits, PRs, and reviews — the GitHub side of the correlation inputs.

**Contract**:
- `githubCommit` (`id` text PK; `ownerId` cascade; `repoId` → monitoredRepo.id cascade; `sha` text; `authorGithubUsername` text; `authoredAt` timestamp; `additions` int; `deletions` int; `branch` text; `message` text; createdAt; unique(`repoId`,`sha`); index(`ownerId`,`authoredAt`), index(`authorGithubUsername`)).
- `githubPullRequest` (`id`; `ownerId` cascade; `repoId` cascade; `githubPrId` `bigint({ mode: "number" })`; `number` int; `title` text; `authorGithubUsername` text; `state` `prState` enum; `additions`/`deletions`/`changedFiles` int; `openedAt`/`mergedAt`/`closedAt`/`readyForReviewAt` timestamp; `linkedTicketKey` text; `sourceUrl` text; timestamps; unique(`repoId`,`githubPrId`); index(`ownerId`,`state`), index(`linkedTicketKey`)).
- `githubReview` (`id`; `ownerId` cascade; `pullRequestId` → githubPullRequest.id cascade; `reviewerGithubUsername` text; `state` `reviewState` enum; `submittedAt` timestamp; createdAt; index(`pullRequestId`), index(`ownerId`,`submittedAt`)).

#### 2. Jira synced-data tables

**File**: `src/db/schema.ts`

**Intent**: Store active-sprint tickets and append-only status-change history (needed for S-10 cumulative time-in-status).

**Contract**:
- `jiraTicket` (`id`; `ownerId` cascade; `jiraProjectId` → jiraProject.id; `sprintId` → sprint.id; `jiraKey` text; `summary` text; `storyPoints` int; `currentStatusId` text; `currentCategory` `statusCategory` enum; `assigneeJiraAccountId` text; `lastStatusChangeAt` timestamp; `addedAfterSprintStart` boolean; `sourceUrl` text; timestamps; unique(`ownerId`,`jiraKey`); index(`sprintId`), index(`currentCategory`)).
- `jiraStatusHistory` (`id`; `ownerId` cascade; `ticketId` → jiraTicket.id cascade; `fromStatusId` text; `toStatusId` text; `fromCategory`/`toCategory` `statusCategory` enum; `changedAt` timestamp; `jiraChangelogId` text; unique(`ticketId`,`jiraChangelogId`); index(`ticketId`,`changedAt`)).

#### 3. Anomaly, settings, recap, refinement

**File**: `src/db/schema.ts`

**Intent**: The anomaly record (5 attributes), account-scoped threshold/severity settings, daily-recap snapshots (sprint-bounded retention), and refinement sessions.

**Contract**:
- `anomaly` (`id`; `ownerId` cascade; `sprintId` → sprint.id; `type` `anomalyType` enum; `severity` `severity` enum; `description` text; `context` jsonb; `suggestedAction` text; `sourceUrl` text; `riskScore` integer; `relatedTeamMemberId` → teamMember.id; `detectedAt` timestamp; `status` `anomalyStatus` enum; createdAt; index(`ownerId`,`sprintId`), index(`type`), index(`severity`)).
- `anomalySettings` (one row per account+type; `id`; `ownerId` cascade; `anomalyType` `anomalyType` enum; `severityOverride` `severity` enum nullable; `thresholds` jsonb; `isDefault` boolean; timestamps; unique(`ownerId`,`anomalyType`)).
- `dailyRecap` (`id`; `ownerId` cascade; `sprintId` → sprint.id NOT NULL [purge key]; `recapDate` timestamp; `sentAt` timestamp; `sendStatus` `recapSendStatus` enum; `payload` jsonb; `anomalyIds` jsonb; createdAt; index(`ownerId`,`sprintId`), index(`recapDate`)).
- `refinementSession` (`id`; `ownerId` cascade; `sourceType` `refinementSourceType` enum; `jiraTicketKey` text; `storyText` text; `questions` jsonb; `dorScore` integer; `missingChecklist` jsonb; `model` text; createdAt; index(`ownerId`,`createdAt`)).

#### 4. Relations + inferred types (Phase 3 tables)

**File**: `src/db/schema.ts`

**Intent**: Same as Phase 2 step 4, for the engine/data tables.

**Contract**: One `relations()` per table (repo → many commits/PRs; PR → many reviews; sprint → many tickets/anomalies/recaps; ticket → many statusHistory) + `$inferSelect`/`$inferInsert` exports per table. For hub tables already given a `relations()` in Phase 2 (`monitoredRepo`, `sprint`), **extend that same declaration in place** here — do not add a second `relations()` for them. Likewise extend `userRelations` again if any Phase 3 table is user-owned (e.g. user → many anomalies/recaps/refinementSessions), keeping it a single block.

#### 5. Default thresholds constant

**File**: `src/db/defaults.ts` (new) — or a clearly-named export

**Intent**: Encode FR-009 sensible defaults (per-rule thresholds incl. the SP-aware in-progress timeouts) as a typed constant, ready for S-06 to write per-account rows. Not seeded in F-02.

**Contract**: Export `DEFAULT_THRESHOLDS` keyed by the 8 `anomalyType` values, each holding its rule config (e.g. `TICKET_STATUS_AGING`: SP→hours map `{1:24,2:24,3:48,5:72,8:120,13:120,21:"8wd"}`; `PR_TOO_BIG`: `{maxLines}`; `SCOPE_CREEP`: `{percent}`; `DEVELOPER_INACTIVE`: `{noCommitDays}`; `PR_REVIEW_STALLED`: `{hours:24}`; parallel-limit rules; etc.) plus a default `severity` per rule, typed against the enum values.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- All 18 tables present in `schema.ts`; every enum used; `DEFAULT_THRESHOLDS` covers all 8 anomaly types and type-checks against the enum.

**Implementation Note**: Pause for human confirmation after automated checks before Phase 4.

---

## Phase 4: Migration & Doc Cleanup

### Overview

Generate the migration, apply it to remote Supabase, verify the tables exist, and correct the three stale driver docs.

### Changes Required:

#### 1. DB npm scripts (convenience)

**File**: `package.json`

**Intent**: Add scripts so generate/migrate aren't bare `npx` invocations.

**Contract**: Add `"db:generate": "drizzle-kit generate"` and `"db:migrate": "drizzle-kit migrate"`.

#### 2. Generate + apply migration

**File**: `src/db/migrations/` (generated)

**Intent**: Produce one `0001_*` migration from the new schema and apply it to the Supabase DB so the foundation is live (precedent: F-01 applied `0000`).

**Contract**: Run `npm run db:generate` (creates `0001_*.sql` + updates `meta/_journal.json` + snapshot) then `npm run db:migrate` against `DATABASE_URL` (Supabase). The migration creates all enums + 18 tables + indexes + FKs; it must not alter the existing 4 Better Auth tables.

#### 3. Stale-doc cleanup

**Files**: `CLAUDE.md`, `context/foundation/infrastructure.md`, `context/foundation/roadmap.md`

**Intent**: Replace the obsolete Neon/HTTP driver mandate with the real Hyperdrive-TCP decision so later slices aren't misled.

**Contract**: `CLAUDE.md:42` — change the "Database driver" line to `drizzle-orm/node-postgres` (`pg`) over Cloudflare Hyperdrive (Workers-safe TCP via binding). `infrastructure.md` — correct the Neon/HTTP sections to Hyperdrive-TCP (note Hyperdrive as the load-bearing decision). `roadmap.md` F-02 Risk — mark RESOLVED (driver already Hyperdrive-TCP in `src/lib/db.ts`; verify the Hyperdrive binding id stays valid during migration). Also flip roadmap F-02 status `ready → done` only after the slice lands (epilogue), not in this edit.

#### 4. Verify cross-account isolation (PostgREST/`anon`)

**Files**: (verification only) — Supabase project setting + a note in `context/foundation/infrastructure.md`

**Intent**: Prove that the new public tables are not reachable cross-account via the Supabase Data API with the browser-bundled publishable key, since the tables carry `anon` grants and no RLS (see Critical Implementation Details). Document the direct-Hyperdrive-only access model as the isolation rationale.

**Contract**: Confirm the Supabase **Data API (PostgREST) is disabled** for the project (Dashboard → Project Settings → Data API → "Enable Data API" off; or exposed schemas empty). Verify empirically: `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/github_credential?select=id" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` must NOT return rows (expect a disabled-API error / 404, not a JSON array). Record the outcome + the "DB reached only via Hyperdrive direct connection; PostgREST off" rationale in `infrastructure.md`. If the Data API turns out to be ON, STOP and escalate (enable RLS + revoke `anon`/`authenticated` before the migration is considered safe).

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` (new `0001_*` file appears).
- Migration applies: `npm run db:migrate` reports success (no error).
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Anon Data API blocked: `curl` to `/rest/v1/github_credential` with the publishable key returns no rows (disabled-API error, not a data array).

#### Manual Verification:

- The 18 tables + enums exist in Supabase (inspect via Supabase dashboard or `psql \dt`); the 4 Better Auth tables are unchanged.
- The three docs no longer mention `@neondatabase/serverless` / neon-http as required; they describe Hyperdrive-TCP.
- `git diff` on `0000_*` is empty (only a new `0001_*` migration was added).
- Supabase Data API confirmed disabled; isolation rationale recorded in `infrastructure.md`.

**Implementation Note**: Pause for human confirmation that the remote migration applied and the tables are visible before closing the slice.

---

## Testing Strategy

No automated test framework this slice (deferred to a later training lesson). Verification is:

### Manual Testing Steps:

1. Crypto round-trip + tamper + missing-key, via a throwaway script (Phase 1).
2. `tsc --noEmit` + `npm run lint` green after each schema phase.
3. Migration generates a single `0001_*` file and applies to Supabase without touching `0000_*` (Phase 4).
4. Inspect Supabase: 18 new tables + enums present, Better Auth tables intact.

## Performance Considerations

High-write correlation tables (`githubCommit`, `githubPullRequest`, `githubReview`, `jiraTicket`, `jiraStatusHistory`) carry `text` PKs (uniform convention) and unique source-id keys (`(repoId,sha)`, `(repoId,githubPrId)`, `(ticketId,jiraChangelogId)`, etc.) to support idempotent incremental upsert in S-05 under the Workers subrequest budget. Indexes are scoped to the documented query paths (aging, activity, filtering) — no speculative indexing.

## Migration Notes

- One additive `0001_*` migration; no data migration (tables are new). No backfill.
- Remote apply uses the same `DATABASE_URL`/Supabase path F-01 used for `0000`.
- Rollback: drop the new tables/enums (additive migration; the `0000` auth schema is independent and unaffected).

## References

- Research: `context/changes/data-schema-baseline/research.md`
- Change identity + locked decisions: `context/changes/data-schema-baseline/change.md`
- Existing schema/conventions: `src/db/schema.ts:1-93`
- DB driver (final): `src/lib/db.ts:1-12`; env/secret pattern: `src/lib/auth.ts:27-28`
- F-01 predecessor: `context/changes/auth-provider-scaffold/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Enums & Crypto Foundation

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — 7b3c90a
- [x] 1.2 Linting passes: `npm run lint` — 7b3c90a

#### Manual

- [x] 1.3 Throwaway script round-trips a token (encrypt → decrypt returns original) — 7b3c90a
- [x] 1.4 Tamper test: byte-flip or wrong `{ownerId,provider}` AAD makes decrypt throw — 7b3c90a
- [x] 1.5 Missing `TOKEN_ENCRYPTION_KEY` makes encrypt throw loudly — 7b3c90a

### Phase 2: Config & Entity Tables (STABLE)

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — 0fa6e76
- [x] 2.2 Linting passes: `npm run lint` — 0fa6e76

#### Manual

- [x] 2.3 FK targets + enum refs resolve; `ownerId` cascade + index/unique on every new table — 0fa6e76

### Phase 3: Engine & Data Tables + Defaults

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — eebabf3
- [x] 3.2 Linting passes: `npm run lint` — eebabf3

#### Manual

- [x] 3.3 All 18 tables present; every enum used; `DEFAULT_THRESHOLDS` covers all 8 anomaly types and type-checks — eebabf3

### Phase 4: Migration & Doc Cleanup

#### Automated

- [x] 4.1 Migration generates: `npm run db:generate` (new `0001_*` appears)
- [x] 4.2 Migration applies: `npm run db:migrate` reports success
- [x] 4.3 Type checking passes: `npx tsc --noEmit`
- [x] 4.4 Linting passes: `npm run lint`
- [x] 4.5 Anon Data API blocked: `curl` to `/rest/v1/github_credential` with publishable key returns no rows

#### Manual

- [x] 4.6 18 tables + enums exist in Supabase; 4 Better Auth tables unchanged
- [x] 4.7 The three docs describe Hyperdrive-TCP (no neon-http mandate)
- [x] 4.8 `0000_*` migration untouched; only `0001_*` added
- [x] 4.9 Supabase Data API confirmed disabled; isolation rationale recorded in `infrastructure.md`
