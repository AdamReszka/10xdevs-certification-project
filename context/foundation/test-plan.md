# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-16

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. SprintFlow's owner
   named three: detection-engine correctness, secret leakage, and
   DB↔engine↔UI consistency.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding
`node_modules`, `.next`, build output).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | Detection engine fires wrong: a threshold rule flags healthy data, or silently fails to flag a real anomaly (e.g. a ticket past its SP-aware time-in-status cutoff isn't caught, or fires at the wrong boundary). The inbox looks fine while the sprint is actually at risk. | High | High | PRD Business Logic; FR-009 (SP-aware thresholds), FR-013; US-01 acceptance criteria; interview Q1, Q3; roadmap S-06 |
| 2 | Jira↔GitHub correlation mismaps — a ticket is joined to the wrong PR/branch/commit, or a real link is missed — so correlated anomalies (`TICKET_NO_COMMIT_LINK`, `PR_TICKET_DESYNC`) are false or absent. | High | High | PRD Business Logic (correlation is the load-bearing differentiator), FR-013; interview Q3 |
| 3 | A stored GitHub PAT or Jira token leaks into a log line, an error body, or a client-facing payload; or encryption-at-rest round-trip / tamper-check fails. | High | Medium | PRD Guardrails ("a token leak is a project-killing failure"); FR-002, FR-003; interview Q1; hot-spot dir `src/lib/` (1 commit/30d) |
| 4 | Cross-account data leak (IDOR): an endpoint checks authentication but not ownership, so one account reads another account's credentials, roster, anomalies, or refinement sessions. | High | Medium | PRD Access Control (strict per-account isolation); memory `supabase-isolation-model`; interview Q1 |
| 5 | Pipeline inconsistency: a partial or failed sync is presented as complete (stale data shown as current), or an anomaly's five attributes drift between DB → engine → UI / email. | High | Medium | PRD Guardrails (graceful degradation); US-01 acceptance criteria ("inbox empty only when zero anomalies, never because a fetch failed silently"); FR-018 (email and dashboard share the same anomaly objects); interview Q1 |
| 6 | On API error / rate-limit, the app shows a white screen, an unhandled crash, or a request storm instead of last-cached state plus a clear error banner. | Medium | Medium | PRD Guardrails; NFR data-freshness with visible staleness; `infrastructure.md` (Workers subrequest / rate-limit budget) |

**Impact × Likelihood rubric.** Both axes are scored High / Medium / Low so
two readers agree on the same row. High impact = user loses access, data, or
credentials, or the failure is publicly visible. High likelihood = the area
changes weekly or is brand-new untested logic the owner is least confident
in. Risks #1 and #2 are High × High because they are the core product
promise *and* the owner's least-confident churn (interview Q3); the
security rows (#3, #4) are High impact but Medium likelihood because the
crypto envelope and isolation model are already decided, not yet exercised.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Each of the 8 rules fires on a crafted "anomalous" fixture AND stays silent on a "healthy" one, including at the exact SP-aware time-in-status boundary | "Final status 200 / no error thrown = the rule worked" | Where thresholds are defined, what time and story-point inputs each rule consumes, the source of the default values | unit | **Oracle problem** — expected anomaly lifted from the engine's own output instead of hand-derived from the FR-009 threshold spec |
| #2 | A ticket with a known linked PR resolves to exactly that PR; an unlinked ticket yields no false link | "A branch-name string match implies a correct ticket↔PR link" | The join key (branch ↔ ticket key, PR body references), where the correlation is computed | unit + integration | Brittle fixture that only covers the single happy link shape |
| #3 | The token never appears in a response body or a log line; encrypt→decrypt round-trips; tampered ciphertext is rejected | "Encrypted at rest means safe everywhere" (ignoring logs and payloads) | The credential write path, exactly what the API route returns, the AAD / versioned-envelope shape | integration | Asserting only the DB column, never the response body + log surface |
| #4 | Account A's session cannot read Account B's resources by id | "Authenticated equals authorized" | Where ownership is enforced (query scope vs route guard), the cross-account isolation model | integration | Testing only the resource owner's happy path |
| #5 | A sync that errors mid-run does not overwrite good cache with partial data; the same anomaly object yields identical attributes on the dashboard and in the email | "Sync returned rows, therefore the sync is complete" | The sync transaction / commit boundary, last-sync-timestamp semantics, the shared anomaly serializer | integration | Over-mocking the sync edge so the partial-failure path is never exercised |
| #6 | The API-error path renders cached state plus a named banner — no crash, no retry storm | "The error path is rare, skip it" | The error-translation layer, the cache-fallback read, the retry / backoff policy | integration + 1 e2e | A meaningless snapshot of the banner with no behavioral assertion |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk. Phases are ordered
by what is testable now × risk priority: Phase 1 covers surfaces that exist
today (credential crypto + account isolation); Phases 2–3 land as their
feature slices (S-06, then S-05/S-07) are built.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Harness bootstrap + credential security | Stand up the test runner; defend token leakage and cross-account isolation at the cheapest layer | #3, #4 | unit (integration → S-02) [^p1] | complete | context/changes/testing-harness-credential-security/ |
| 2 | Detection engine — thresholds & correlation | Per-rule positive/negative coverage for all 8 anomalies, SP-aware boundary cases, and the Jira↔GitHub correlation join | #1, #2 | unit + integration | not started | — |
| 3 | Sync integrity + pipeline consistency | Partial sync never shown as complete; graceful degradation (cached + banner, no crash/storm); anomaly-attribute parity DB→UI→email | #5, #6 | integration + targeted e2e | not started | — |
| 4 | Quality-gates wiring | Lock the floor in CI (none exists yet): lint + typecheck + unit/integration gate; e2e smoke on the US-01 north-star flow | cross-cutting | gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

[^p1]: Phase 1 delivered the Vitest harness + the credential-crypto unit suite
(`src/lib/crypto.test.ts`) — the only surfaces that existed in code. The two
literal integration assertions the risks name — #3 "token absent from response
body / log line" and #4 "Account B cannot read Account A's row by id" — have no
target until **S-02** (`setup-github-integration`) builds the connect/validate
route and the first owner-scoped query. They are recorded there as required test
sub-phases (see §6.6 and `context/changes/setup-github-integration/change.md`).

## 4. Stack

The classic test base for this project. There is **none yet** — no test
runner config and zero test files were found. Phase 1 of §3 bootstraps the
runner; the rows below are recommendations to be verified at that phase's
`/10x-research`, grounded against the current stack (Next.js 16 App Router,
TypeScript strict, Drizzle/`pg` over Cloudflare Hyperdrive, Better Auth,
Cloudflare Workers via `@opennextjs/cloudflare`, shadcn/ui).

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | TBD | none yet — installed by §3 Phase 1; pairs with the Vite/TS toolchain already in the repo |
| Workers-env integration | `@cloudflare/vitest-pool-workers` | TBD | none yet — verify at Phase 1 research for testing code that touches the `HYPERDRIVE` binding / Workers runtime |
| API mocking | MSW (or `undici` interceptors) | TBD | none yet — mock the GitHub/Jira HTTP edge only; never mock internal modules |
| e2e | Playwright | TBD | none yet — added in §3 Phase 3/4 for the US-01 smoke path only |
| accessibility | axe-core (via Playwright) | TBD | optional; selective, not per-page |
| (optional) AI-native | LLM-as-judge eval for FR-020 Refinement Helper — checked: 2026-06-16 | n/a | **When NOT to use:** any deterministic assertion. Reserve for grading whether generated DOR questions reference the story's *specific* actors/gaps vs generic templates — a property classic tests cannot cheaply assert. Not a critical-path phase; defer until S-13 ships. |

**Stack grounding tools (current session):**
- Docs: Context7 — available; not yet queried (Vitest/Better Auth/Drizzle/Workers test setup to be grounded at Phase 1 `/10x-research`); checked: 2026-06-16
- Search: Exa.ai — available; not used yet; checked: 2026-06-16
- Runtime/browser: Playwright MCP — not detected this session; Playwright itself is a candidate e2e tool for Phase 3/4; checked: 2026-06-16
- Provider/platform: Supabase MCP + `gh` CLI — available; relevant for verifying isolation model (Data API off) and CI wiring in Phase 4; checked: 2026-06-16

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (local via `npm run lint` / `npm run typecheck`; CI wired by §3 Phase 1 minimal workflow, extended by §3 Phase 4) | syntactic / type drift |
| unit | local + CI | required after §3 Phase 1 | logic regressions (crypto now; detection per §3 Phase 2) |
| integration | local + CI | required after S-02 | credential leak / IDOR against real Postgres (#3, #4); sync/pipeline per §3 Phase 3 |
| e2e on critical flows (US-01) | CI on PR | required after §3 Phase 3 | broken north-star user path |
| post-edit hook | local (agent loop) | recommended (configured in a later Module 3 lesson, not here) | regressions at edit time |
| visual diff (deterministic) | CI on PR | optional | rendering regressions on the 1–3 dashboard screens |
| pre-prod smoke | between merge + prod | optional | Workers environment-specific failures (subrequest/rate-limit) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Runner**: Vitest, node environment. Config is `vitest.config.ts` at the repo
  root — `test.environment: "node"`, include glob `src/**/*.test.ts`, and an `@`
  alias to `./src` mirroring `tsconfig.json` `paths` (no trailing slash on the
  alias value).
- **Location & naming**: co-locate the test beside the unit as `<name>.test.ts`
  (e.g. `src/lib/crypto.test.ts` next to `src/lib/crypto.ts`).
- **Run**: `npm test` (`vitest run`, non-watch). Pair with `npm run lint` and
  `npm run typecheck`.
- **Reference test**: `src/lib/crypto.test.ts` — the credential-envelope suite
  (round-trip, tamper, AAD isolation, malformed/version, key validation, IV
  uniqueness, error opacity).
- **Hermetic env/secrets**: never depend on a shell/CI secret. Generate what the
  unit needs in-test and inject it via the unit's `env` arg — the crypto suite
  makes a 32-byte key with `randomBytes(32).toString("base64")` and passes
  `{ TOKEN_ENCRYPTION_KEY }`. The suite must pass with the real env var unset.
- **Signal check**: a unit test should go red when the behavior it guards is
  weakened (verified for crypto by dropping the AAD owner-binding and by leaking
  the GCM message — both turn specific tests red). If weakening the code doesn't
  fail a test, the test isn't asserting the risk.
- Detection-engine per-rule pattern (anomalous + healthy fixture, oracle
  hand-derived from FR-009, never lifted from engine output) — TBD, see §3 Phase 2.

### 6.2 Adding an integration test

- No integration harness exists yet — §3 Phase 1 shipped **unit-only** (the
  credential-leak and IDOR surfaces have no code until S-02). The first
  integration tests land with **S-02** (`setup-github-integration`) as required
  sub-phases: assert the connect/validate response body + log lines never carry
  the token (#3), and that Account B's session cannot read Account A's row by id
  (#4) — run against **real Postgres** (local Supabase `:54322` via
  `getDb`/`DATABASE_URL` in Node, *not* `vitest-pool-workers`), never a mocked
  DB. The sync partial-failure + graceful-degradation pattern is TBD, see §3 Phase 3.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 3 / Phase 4 (Playwright smoke on the US-01 Dashboard "Today" flow).

### 6.4 Adding a test for a new API endpoint

- No product route exists yet (the app's only handler is the Better Auth
  catch-all). The reference endpoint test lands with **S-02**'s connect/validate
  route: request → response shape AND side-effect, with the GitHub/Jira HTTP edge
  mocked via MSW (never internal modules), plus the negative IDOR case (Account
  B's session + Account A's id → 404 / empty). TBD until S-02.

### 6.5 Adding a test for a new anomaly detection rule

- TBD — see §3 Phase 2 (positive fixture that must fire, healthy fixture that must stay silent, SP-aware boundary case, expected value hand-derived from FR-009 — never lifted from the engine output).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

- **Phase 1 (harness + credential security, 2026-06-23).** The risk-first plan
  and the build order were one slice apart: the crypto envelope and the
  account-scoped schema existed, but the route/payload/log surface (#3) and the
  first owner-scoped query (#4) did not. Phase 1 shipped the Vitest harness +
  the crypto unit suite (the only grounded surface) and **deferred both literal
  integration assertions to S-02** as required test sub-phases — see
  `context/changes/setup-github-integration/change.md`. CI landed early (minimal
  lint+typecheck+unit on PRs, Node pinned via `.nvmrc`); §3 Phase 4 extends it
  rather than rebuilding. Lesson: when the defense ships ahead of its consumer,
  test the defense now and bind the edge assertions to the slice that builds the
  edge — don't fake them against code that doesn't exist.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives** (`src/components/ui/`) — the library is the test; snapshot tests here break constantly and catch nothing. Re-evaluate only if a primitive is locally forked and customized. (Source: Phase 2 interview Q5.)
- **Demo-mode fixtures** (S-09) — an exploration/sales surface with low blast radius if a number is slightly off. Re-evaluate if demo data ever feeds real calculations. (Source: Phase 2 interview Q5.)
- **Mid-layer presentational organisms/molecules** — "mostly proxies" that pass data through. Test the data *reaching* the page and the custom **atoms**, not the pass-through wrappers. Re-evaluate a specific component only if it grows real branching logic. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-16
- Stack versions last verified: 2026-06-16
- AI-native tool references last verified: 2026-06-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
