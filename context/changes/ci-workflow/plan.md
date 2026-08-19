# CI: integration-suite job Implementation Plan

## Overview

Extend the existing CI workflow (`.github/workflows/ci.yml`) with a second job, `integration`, that runs the credential-security integration suite (`npm run test:integration`) against a **real Postgres** in CI — mirroring the local `supabase start` → `db:migrate` → `test:integration` flow. The existing hermetic `test` job (lint / typecheck / unit) is left untouched.

Scope was locked by `context/changes/ci-workflow/frame.md`: the base CI already exists (commit `d66a9e6`), so this is **not** "add CI" — it is the integration-in-CI extension the `ci.yml` header comment already anticipates ("Phase 4 extends this … by adding jobs alongside `test`"). CD/deploy is explicitly out (parked per roadmap post-S-07, blocked on secrets).

## Current State Analysis

From the frame investigation (three parallel sub-agents, all evidence file:line-cited in `frame.md`):

- **`.github/workflows/ci.yml` exists** and runs one `test` job on `pull_request`: `npm ci → lint → typecheck → npm test`, Node pinned via `.nvmrc` (`24`), `cache: npm`, **no secrets**. Its comment reserves the extension point for exactly this work.
- **The integration suite is real-Postgres-bound.** `test/integration/setup.ts` (a) loads `.env.local` (dotenv; a missing file is a silent no-op and does **not** clobber pre-set `process.env`), (b) requires `DATABASE_URL`, (c) **hard-refuses any DB that is not `127.0.0.1`/`localhost` on port `54322`** (`setup.ts:33-40`), (d) requires `TOKEN_ENCRYPTION_KEY`.
- **The suite assumes a pre-migrated schema.** Neither `setup.ts` nor the spec migrates; `actions.integration.test.ts:35-36` builds its own `pg.Pool` from `DATABASE_URL` and inserts immediately.
- **The supabase snapshot is infra-only.** `supabase/migrations/20260524085002_remote_schema.sql` contains 16 `GRANT` / 4 `CREATE EXTENSION` / 12 `ALTER DEFAULT` and **zero `CREATE TABLE`**. So `supabase start` binds Postgres on `54322` (`supabase/config.toml:29`) and applies grants/extensions, but does **not** create the product tables.
- **Drizzle owns the schema.** `src/db/migrations/0000_*.sql` creates `user`/`account`/`session`; `0001_*.sql` creates `github_credential`/`monitored_repo` (+ the rest). `npm run db:migrate` = `drizzle-kit migrate` against `DATABASE_URL`.
- The full recipe (`supabase start` + `db:migrate` + `test:integration`) is the local-dev flow and **already passes locally** (verified during S-02 Phase 3). Only the GitHub-Actions wiring is unproven — which the PR CI run verifies.

## Desired End State

A pull request runs **two** CI jobs: the existing `test` (unchanged) and a new `integration` that stands up Postgres on `127.0.0.1:54322` via `supabase start`, applies the drizzle schema, and runs `npm run test:integration` green — with **no repository secrets** (the encryption key is generated ephemerally in-job). Both jobs pass on the PR that introduces the workflow change.

> Note (F2): this plan delivers the `integration` job and its **PR status report**, not automated merge-gating. Making `integration` a *required* (merge-blocking) check is a separate one-time GitHub **branch-protection** setting (repo settings, outside this file) — out of scope here.

Verify:
- `.github/workflows/ci.yml` parses and defines both `test` and `integration` jobs.
- On the introducing PR, the GitHub Actions `integration` job stands up Postgres, migrates, and runs the 4 integration tests green; the `test` job stays green.
- No new entry under repository Secrets is required.

### Key Discoveries:

- `.github/workflows/ci.yml` already exists (commit `d66a9e6`) and reserves the "jobs alongside `test`" extension point — do not rebuild it.
- The `:54322` host/port lock in `test/integration/setup.ts:33-40` forces the CI Postgres to be reachable at exactly `127.0.0.1:54322` — `supabase start` binds there natively (`supabase/config.toml:29`); a generic `services: postgres` (5432) would be refused.
- `supabase/migrations/*.sql` creates **no tables** → `supabase start` alone leaves the product schema absent → the job **must** run `npm run db:migrate` (drizzle) after start. No double-apply conflict, precisely because the snapshot creates nothing drizzle also creates.
- `setup.ts` reads env, not necessarily `.env.local`; dotenv won't clobber pre-set vars, so **setting `DATABASE_URL` + `TOKEN_ENCRYPTION_KEY` as job env is sufficient — no guard edit, no `.env.local` in CI**.

## What We're NOT Doing

- **No CD / deploy.** No `wrangler deploy`, no Cloudflare secrets, no `push:main` deploy. Parked per `roadmap.md:372` (post-S-07 hardening) and blocked on secret provisioning (`frame.md` §CD).
- **No e2e in CI** (Playwright + browser + dev server) — a separate future extension, same pattern.
- **No `push:main` trigger** — keep the existing `on: pull_request` (chosen: PR-only, consistent with the `test` job).
- **No change to `test/integration/setup.ts`** — its `:54322` guard is satisfied, not relaxed.
- **No rewrite of the existing `test` job.**

## Implementation Approach

Add one job to `ci.yml`. It reuses the `test` job's setup preamble (checkout → `setup-node` with `.nvmrc` + npm cache → `npm ci`), then: install the Supabase CLI (`supabase/setup-cli`), `supabase start` (binds `:54322`, applies infra snapshot), `npm run db:migrate` (drizzle creates tables), and `npm run test:integration` — with `DATABASE_URL` and an **ephemeral** `TOKEN_ENCRYPTION_KEY` provided as env. The job runs in parallel with `test` under the existing `pull_request` trigger. Verification is the PR's own CI run.

## Critical Implementation Details

- **DB URL must be exact**: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` — any other host/port trips the `setup.ts:33-40` guard and fails fast. This is also what `db:migrate` targets.
- **Ordering is load-bearing**: `supabase start` → `db:migrate` → `test:integration`. Migrating before start (no DB) or skipping migrate (snapshot has no tables) both fail.
- **Ephemeral key**: generate `TOKEN_ENCRYPTION_KEY` in-job (`openssl rand -base64 32`, 32 bytes) and pass via env; the suite only encrypts-and-reads within the run, so a per-run key is sufficient and keeps CI secret-free.
- **Runner has Docker**: `ubuntu-latest` ships Docker, which `supabase start` needs; expect the image pull to add ~1–2 min to this job (acceptable; it runs parallel to `test`).
- **Boot only Postgres (F1)**: run `supabase start -x <non-db services>` so CI pulls/starts only the database the integration suite uses (it hits Postgres directly via a `pg` pool — no PostgREST/Auth/Realtime/Storage needed). Cuts cold-start time and failure surface vs the full stack. Confirm the exact exclusion list against the installed CLI at implement time (candidate: `gotrue,realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,postgrest,supavisor,mailpit`).

## Phase 1: Add the `integration` job to CI and verify on a PR

### Overview

Add the `integration` job to `.github/workflows/ci.yml` and prove it green via a real PR CI run, leaving the `test` job unchanged.

### Changes Required:

#### 1. CI workflow — new `integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the credential-security integration suite against a real Postgres in CI, mirroring the local flow, without adding repository secrets. Sits alongside the existing `test` job under the same `pull_request` trigger.

**Contract**: a second job `integration` (peer of `test`) on `runs-on: ubuntu-latest`. Reuses the checkout + `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: npm`) + `npm ci` preamble, then the ordered steps below. Env `DATABASE_URL` (the exact `:54322` URL) is set for the migrate + test steps; `TOKEN_ENCRYPTION_KEY` is generated ephemerally and exported for the test step. Shape:

```yaml
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start -x gotrue,realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,postgrest,supavisor,mailpit
      - run: npm run db:migrate
        env: { DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres }
      - name: Integration tests
        run: |
          export TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
          npm run test:integration
        env: { DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres }
```

(Exact action versions/keys to be confirmed against current `supabase/setup-cli` at implementation time; the ordering + env contract above is the load-bearing part.)

#### 2. Declare `dotenv` as a devDependency (F3)

**File**: `package.json`

**Intent**: `test/integration/setup.ts` imports `dotenv`, but it is only present transitively today — the new `integration` job is the first place a dropped transitive provider would break. Declaring it removes that fragility.

**Contract**: add `dotenv` (the installed `^16.6.1`) to `devDependencies`; `package-lock.json` updated via `npm install`. No code change.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` is valid YAML and defines both `test` and `integration` jobs (parse check; `actionlint` if available).
- On the introducing PR, the GitHub Actions **`integration`** job completes green: `supabase start` succeeds, `db:migrate` applies, and `npm run test:integration` passes its 4 tests.
- The existing **`test`** job stays green on the same PR.
- Local sanity (pre-push): with local Supabase up, `npm run test:integration` is green (already verified) and `npm test` is green — no regressions to either script.
- `dotenv` is declared in `package.json` `devDependencies`; `npm ci` and `npm test` stay green.

#### Manual Verification:

- The PR's Checks tab shows two jobs, both green; the `integration` job log shows Postgres started on 54322, migrations applied, and 4 integration tests passed.
- No new repository Secret was needed (confirm the key is generated in-job).
- (Demo) The end-to-end chain is visible: plan → implement (edit `ci.yml`) → open PR → CI runs the new job → merge.

**Implementation Note**: After the workflow is authored and the local sanity checks pass, the real gate is the PR CI run — push the branch, open the PR, and confirm both jobs green before merging. Pause for human confirmation of the green PR run.

## Testing Strategy

### Automated (CI itself is the test):
- The `integration` job IS the test surface — its green run proves the recipe. The 4 integration specs (#3 leak success + failure, F4 re-connect FK, #4 IDOR) run inside it.

### Manual Testing Steps:
1. Push `chore/ci-workflow`, open a PR → observe both `test` and `integration` jobs trigger.
2. Confirm the `integration` job log: `supabase start` → `db:migrate` → 4 tests green.
3. Confirm no repository secret is referenced by the workflow.
4. (Negative sanity, optional) temporarily point `DATABASE_URL` off `:54322` locally → `setup.ts` guard throws → revert.

## Performance Considerations

The `integration` job adds ~1–2 min for the `supabase start` image pull; it runs in parallel with `test`, so wall-clock PR feedback is bounded by the slower job, not the sum.

## Migration Notes

No application or DB migration. The only artifact is the CI workflow edit. `npm run db:migrate` runs **against the ephemeral CI Postgres only**, never a real environment.

## References

- Frame brief: `context/changes/ci-workflow/frame.md` (scope + hypothesis evidence)
- Existing workflow: `.github/workflows/ci.yml` (commit `d66a9e6`)
- Integration harness: `test/integration/setup.ts:14-46`, `vitest.integration.config.ts`, `src/app/(app)/setup/github/actions.integration.test.ts:35-36`
- Schema source: `src/db/migrations/0000_*.sql`, `0001_*.sql`; `package.json` `db:migrate`/`test:integration`
- Supabase local: `supabase/config.toml:29` (db port 54322), `supabase/migrations/20260524085002_remote_schema.sql` (infra-only)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add the `integration` job to CI and verify on a PR

#### Automated

- [ ] 1.1 `ci.yml` valid YAML with both `test` and `integration` jobs (parse / actionlint)
- [ ] 1.2 PR `integration` job green: supabase start -x → db:migrate → test:integration (4 tests)
- [ ] 1.3 PR `test` job stays green
- [ ] 1.4 Local sanity: `npm run test:integration` + `npm test` green, no regressions
- [ ] 1.5 `dotenv` declared in `package.json` devDependencies; `npm ci` + `npm test` green

#### Manual

- [ ] 1.6 PR Checks show two green jobs; integration log shows PG@54322 + migrations + 4 tests
- [ ] 1.7 No new repository Secret required (key generated in-job)
- [ ] 1.8 End-to-end chain visible: plan → implement → PR → CI run → merge
