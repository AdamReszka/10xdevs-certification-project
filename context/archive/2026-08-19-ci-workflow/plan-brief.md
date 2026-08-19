# CI: integration-suite job — Plan Brief

> Full plan: `context/changes/ci-workflow/plan.md`
> Frame brief: `context/changes/ci-workflow/frame.md`

## What & Why

Add a second CI job, `integration`, to the existing `.github/workflows/ci.yml` that runs the credential-security integration suite (`npm run test:integration`) against a real Postgres in CI. **Why**: the base CI (lint/typecheck/unit on PR) already exists (commit `d66a9e6`) — the framing reframed the task from "add CI" to "add the integration-in-CI extension the workflow's own comment already anticipates," so the #3-leak / #4-IDOR / F4 integration tests finally get an automated gate instead of only running on a developer's machine.

## Starting Point

`ci.yml` runs one `test` job (`npm ci → lint → typecheck → npm test`) on `pull_request`, secret-free, Node pinned via `.nvmrc`. The integration suite exists and passes locally but is **not** in CI: it hard-requires Postgres at `127.0.0.1:54322` (`setup.ts:33-40`), a pre-migrated schema, and `TOKEN_ENCRYPTION_KEY`.

## Desired End State

Every PR runs two jobs: the unchanged `test`, plus `integration`, which spins up Postgres on `:54322` via `supabase start`, applies the drizzle schema, and runs the 4 integration tests green — with **no repository secrets** (the encryption key is generated per-run). Both jobs run and report status on every PR (making `integration` a merge-blocking check is a separate branch-protection setting, out of scope).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What to build | Integration-in-CI extension, not new CI | Base CI already exists (`d66a9e6`) — verified firsthand | Frame |
| CD / deploy | Out of scope | Parked per roadmap post-S-07 + blocked on secrets | Frame |
| Postgres in CI | `supabase start` (setup-cli) | Mirrors local dev; binds `:54322` natively (config.toml) | Plan |
| Schema creation | `npm run db:migrate` after start | Supabase snapshot is infra-only (0 tables) → drizzle owns schema, no double-apply | Plan |
| `TOKEN_ENCRYPTION_KEY` | Ephemeral, generated in-job | Keeps CI secret-free; suite only encrypts+reads within the run | Plan |
| Trigger | PR only | Consistent with the existing `test` job | Plan |
| Job structure | Separate `integration` job (parallel to `test`) | Matches the `ci.yml` "add jobs alongside test" comment | Plan |

## Scope

**In scope:**
- One new `integration` job in `.github/workflows/ci.yml` (supabase start → db:migrate → test:integration, ephemeral key, PR trigger).
- Verification via a real PR CI run.

**Out of scope:**
- CD / `wrangler deploy` / Cloudflare secrets (parked post-S-07).
- e2e-in-CI (Playwright) — future same-pattern extension.
- `push:main` trigger; any edit to `setup.ts` or the `test` job.

## Architecture / Approach

Single-file change. The `integration` job reuses the `test` job's preamble (checkout → `setup-node@v4` with `.nvmrc` + npm cache → `npm ci`), then: `supabase/setup-cli` → `supabase start -x <non-db services>` (Postgres-only on `127.0.0.1:54322`) → `npm run db:migrate` (drizzle creates tables; env `DATABASE_URL` = the exact `:54322` URL) → generate ephemeral `TOKEN_ENCRYPTION_KEY` → `npm run test:integration`. Runs in parallel with `test` under the existing `pull_request` trigger. **Ordering is load-bearing**: start → migrate → test.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Add `integration` job + verify on PR | The integration suite gated in CI on every PR | GitHub-Actions wiring of `supabase start` (the only unproven part; recipe already passes locally) |

**Prerequisites:** none — branch `chore/ci-workflow` off main already exists; local Supabase recipe already verified green during S-02.
**Estimated effort:** ~1 short session (one file edit + one PR CI run to confirm).

## Open Risks & Assumptions

- **`supabase start` behavior in GitHub Actions** (image pull time, health-check flags) is the only unproven link — the recipe's steps already pass locally; the PR run is the proof.
- Assumes `supabase/setup-cli` + `supabase start` publish Postgres on `127.0.0.1:54322` on the runner (matches `config.toml`); if a flag is needed for headless CI, adjust at implementation time.
- Assumes the drizzle migrations remain the schema source of truth (confirmed: supabase snapshot has 0 tables).

## Success Criteria (Summary)

- A PR shows two green CI jobs; the `integration` job log shows Postgres@54322 + migrations applied + 4 integration tests passed.
- No new repository Secret is required.
- The full new→frame→plan→implement→PR→merge chain is demonstrable end-to-end.
