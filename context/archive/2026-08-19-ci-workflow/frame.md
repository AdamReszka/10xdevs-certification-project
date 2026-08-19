# Frame Brief: CI/CD workflow scope

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`.github/workflows` is empty — nothing runs the project's quality gates
(lint / typecheck / tests) on pull requests or pushes. (As stated in
`change.md`, grounded in `CLAUDE.md` and `roadmap.md` notes.)

## Initial Framing (preserved)

- **User's stated cause or approach**: the gap is a missing workflow; add a
  GitHub Actions workflow that runs lint + typecheck + the hermetic unit tests.
- **User's proposed direction**: GH Actions on PR + push to main:
  `npm ci → lint → typecheck → npm test`; integration + e2e out of scope.
- **Pre-dispatch narrowing** (Step 1.5): the user **expanded** the scope — chose
  *"also integration"* (run the integration suite in CI) **and** *"verification +
  deploy (CI/CD)"* (deploy to Cloudflare after green gates). So the framing under
  test is broader than the original: CI (unit **+ integration**) **plus** CD.

## Dimension Map

The observation / expanded scope could originate at any of these dimensions:

1. **Unit-suite hermeticity** — does `npm test` run in CI with no DB/secret/network?
2. **Repo CI-readiness / workflow presence** — lockfile + Node pin + scripts exist; is `.github/workflows` really empty?  ← **initial framing lands here — and it is false**
3. **Integration-in-CI feasibility** — can `test:integration` run in CI at all?
4. **CD / deploy readiness** — can the app be deployed from CI today?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **Base CI is the gap** ("workflows empty → add lint/typecheck/test on PR") | `.github/workflows/ci.yml` **already exists** on `main` — added by commit `d66a9e6` (slice *testing-harness-credential-security*, p3). It runs `npm ci → lint → typecheck → npm test` on `pull_request`, pins Node via `.nvmrc`, needs no secrets. Confirmed firsthand (`ci.yml:8-23`). | **FALSE — already done** |
| Unit suite is hermetic (no DB/secret/network) | `crypto.test.ts:32-96` self-provisions its key (`randomBytes(32)`), never needs ambient `TOKEN_ENCRYPTION_KEY`; `github.test.ts:24-47` mocks the HTTP edge via `fetchImpl`; `vitest.config.ts:20` excludes `*.integration.test.ts`. | **STRONG** |
| Integration tests can run in CI | Feasible but real work: `test/integration/setup.ts:33-40` hard-locks the DB to `127.0.0.1:54322`; the suite assumes a **pre-migrated** schema (no `migrate()` in setup or specs — `actions.integration.test.ts:35-36` builds its own pool and inserts immediately); needs `DATABASE_URL` + `TOKEN_ENCRYPTION_KEY`. A CI job must stand up Postgres on 54322 (`npx supabase start`, `supabase/config.toml:29`, or a PG service mapped to 54322) → `npm run db:migrate` → `test:integration`. | **STRONG — feasible, NOT blocked; moderate new job** |
| App is deployable from CI today | Config READY: adapter fully wired (`open-next.config.ts`, `next.config.ts:2,24`), `wrangler.jsonc` complete with a **real** Hyperdrive id + `nodejs_compat`, `build:cf`/`deploy` scripts runnable, pg-over-Hyperdrive driver confirmed (`src/lib/db.ts:1-12`). BUT a CD run cannot succeed unattended: no `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`, Workers secrets (`TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) unprovisioned, and the non-TTY `opennextjs-cloudflare build` (`--yes`/CI-flag, infra risk #1198) is unverified. | **PARTIAL — config-ready, blocked on secrets/ops** |

## Narrowing Signals

- **`ci.yml` provenance**: `git log -- .github/workflows/ci.yml` → single commit `d66a9e6`. The "workflows empty" premise in `CLAUDE.md` / `roadmap.md:70` predates it — the docs are **stale**.
- **`ci.yml`'s own comment** anticipates the extension: *"Phase 4 extends this with e2e + the full gate matrix by adding jobs alongside `test` — it does not rebuild this workflow."* (`ci.yml:3-6`). The integration/e2e delta is an already-designed extension point, not greenfield.
- **`roadmap.md:372`** parks *"CI/CD pipeline (.github/workflows)"* explicitly: *"deferred given `speed` main goal; add in a hardening pass after S-07 lands."* We are at S-02/S-03; S-07 (north star) is far off. `infrastructure.md:91,160` records the deploy-workflow as outstanding hardening work.

## Cross-System Convention

The existing gate already follows convention (`actions/setup-node` + `.nvmrc` + `npm ci` + gate scripts). Extending it with an integration job (Postgres service + migrate step) is the standard pattern and matches the file's own "Phase 4" note. CD via `wrangler deploy` is also conventional but is gated on out-of-band secret provisioning and the roadmap's deliberate post-S-07 sequencing — not a code/config migration.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is NOT "add a CI workflow" — a hermetic-gate
> CI already exists (`ci.yml`, commit `d66a9e6`). It is a scope + sequencing
> decision: (1) whether to extend the existing PR gate with the integration suite
> (feasible now, self-contained), and (2) whether to pull CD/deploy forward from
> its parked post-S-07 slot — config-ready but blocked on provisioning Cloudflare
> + Workers secrets and verifying a headless build.**

The original framing ("workflows empty; add lint/typecheck/test") is **obsolete** —
that exact workflow is already committed. The user's expanded scope splits cleanly:
the **integration-in-CI** half is real, unblocked work (the `ci.yml` "Phase 4"
extension); the **CD** half is config-ready but blocked on secrets/ops and was
deliberately parked to a post-S-07 hardening pass, so bringing it forward is a
sequencing decision the user owns, not a coding task.

## Confidence

**HIGH** — the pivotal fact (an existing `ci.yml`) was confirmed firsthand and by
git history; integration-in-CI requirements and CD blockers are each backed by
file:line evidence from independent sub-agents; roadmap intent is explicit.

## What Changes for /10x-plan

Do **not** plan a from-scratch CI workflow — it exists. If planning proceeds, it
should target the **integration-in-CI extension** (a new job added alongside
`test` in `ci.yml`: Postgres-on-54322 → `db:migrate` → `test:integration`, plus
optionally a `push: main` trigger). **CD/deploy should be treated separately** — a
secrets-gated, roadmap-parked decision: either defer per the post-S-07 plan, or
scope "author the deploy workflow now, enable after secrets are provisioned." The
plan must not assume CD can run unattended today.

## References

- Source: `.github/workflows/ci.yml` (commit `d66a9e6`), `vitest.config.ts:18-20`,
  `src/lib/crypto.test.ts:32-96`, `src/lib/github.test.ts:24-47`
- Integration-in-CI: `test/integration/setup.ts:14-46`, `vitest.integration.config.ts`,
  `src/lib/db.ts:4-6`, `drizzle.config.ts`, `src/db/migrations/` (+ `meta/_journal.json`),
  `package.json:19-20`, `supabase/config.toml:29`
- CD readiness: `wrangler.jsonc`, `open-next.config.ts`, `next.config.ts:2,24`,
  `package.json:8-10`, `.env.example:19-32`, `context/foundation/infrastructure.md:74,91,106,160`,
  `context/foundation/roadmap.md:70,372`
- Investigation tasks: #5 (unit hermeticity + CI-readiness), #6 (integration-in-CI), #7 (CD readiness)
