# Test Rollout Phase 1 — Harness Bootstrap + Credential Security Implementation Plan

## Overview

Stand up the project's first automated test runner (none exists today) and
write the unit suite that defends the credential-crypto envelope
(`src/lib/crypto.ts`) — the load-bearing defense for risk #3 (credential
leakage) and the crypto-layer expression of risk #4 (cross-account isolation).
Wire a minimal CI workflow plus a `typecheck` script, record the project's test
conventions into the test-plan cookbook (§6), and explicitly relocate the two
risk sub-claims that cannot be honestly grounded today — "token never in a
response body / log line" (#3) and "Account B can't read Account A's row by id"
(#4) — into S-02 (`setup-github-integration`) as required test sub-phases.

This is rollout Phase 1 of `context/foundation/test-plan.md` §3.

## Current State Analysis

- **Zero test infrastructure.** No Vitest/Jest/Playwright, no runner config, no
  `*.test.ts` / `*.spec.ts` files. `npm run lint` (ESLint flat config) is the
  only quality command (`package.json:12`). This matches test-plan §4: "There
  is none yet."
- **The crypto envelope is complete, pure, and caller-less.**
  `src/lib/crypto.ts` is synchronous `node:crypto` (AES-256-GCM, versioned
  `v1:` envelope, AAD-bound to `ownerId\0provider`, opaque `TokenCryptoError`).
  `encryptToken` / `decryptToken` have **zero callers repo-wide** — the first
  caller (a connect/validate Server Action) lands in S-02. The function is fully
  unit-testable today with no DB, no network, no Workers pool, no mocks.
- **Key injection is test-friendly.** `getKey(env?)` reads `env.TOKEN_ENCRYPTION_KEY`
  first, `process.env` fallback (`crypto.ts:54-55`). A test can generate a fresh
  32-byte base64 key in-process and pass it via the `env` arg — no `.env`
  dependency, no shared CI secret.
- **The literal #3/#4 leak surfaces do not exist yet.** No product route, no
  `"use server"` action, no response payload, no token-logging line, and no
  owner-scoped Drizzle read. The only route is the Better Auth catch-all
  (`src/app/api/auth/[...all]/route.ts`); the only DB reads are Better Auth's
  own session lookups. There is nothing to assert a payload/log leak or an
  IDOR-by-id against until S-02 ships.
- **Isolation has no safety net.** Supabase Data API (PostgREST) is OFF, no RLS,
  app reaches DB only via Hyperdrive (memory `supabase-isolation-model`). 100%
  of cross-account isolation will rest on the app-side `ownerId` predicate —
  which makes the eventual IDOR integration test (in S-02) a hard gate that must
  run against real Postgres, never a mock.
- **Toolchain facts for config:** path alias `@/*` → `./src/*`
  (`tsconfig.json:21-23`); `target ES2017`, `module esnext`,
  `moduleResolution: bundler`; `nodejs_compat` is on for the *Workers* build
  (`wrangler.jsonc`) but the *test* process is Node, where `node:crypto` is
  native.

## Desired End State

After this plan:

- `npm test` runs Vitest (node environment) and the crypto unit suite passes
  green; `npm run typecheck` runs `tsc --noEmit` clean.
- `src/lib/crypto.test.ts` exercises the seven grounded assertion families
  (round-trip, tamper rejection, AAD isolation, malformed/wrong-version
  envelope, key validation, IV uniqueness, error opacity) against real
  `crypto.ts` code with an in-test key.
- A minimal GitHub Actions workflow runs lint + typecheck + test on pull
  requests (a foundation Phase 4 later extends with e2e + the full gate matrix).
- test-plan §6.1 / §6.2 / §6.4 cookbook entries are filled for "add a unit
  test" and stamped with the conventions this phase locks; §3 Phase 1 status is
  advanced; and the deferred #3-payload/log + #4-IDOR assertions are recorded as
  required test sub-phases against S-02.

**Verification:** `npm test` and `npm run typecheck` both exit 0 locally; the CI
workflow runs green on a PR; `git grep -l "from \"vitest\""` finds the crypto
suite; test-plan §6 no longer reads "TBD" for the unit-test rows touched here.

### Key Discoveries:

- `src/lib/crypto.ts:81-97` — `encryptToken` (fresh 12-byte IV per call, GCM tag
  appended, AAD-bound, `v1:` envelope).
- `src/lib/crypto.ts:105-142` — `decryptToken` rejects malformed envelope
  (`parts.length !== 3`), unknown version, wrong IV length / short payload, and
  any GCM failure → typed `TokenCryptoError("Token decryption failed.")` with
  the original error only as `{ cause }` (never surfaced in the message).
- `src/lib/crypto.ts:54-70` — `getKey` throws loudly on missing/short key; never
  returns a partial key or stores plaintext.
- `src/lib/crypto.ts:72-75` — AAD = `utf8(ownerId + "\0" + provider)`; the NUL
  separator is deliberate (prefix-collision avoidance).
- `tsconfig.json:21-23` — `@/*` → `./src/*`, must be mirrored in the Vitest
  config or the suite's `@/lib/crypto` import won't resolve.
- Research Open Q2 — the AAD `provider` string the eventual S-02 write path will
  use is `"GITHUB"` (matching the `integration` pgEnum, `schema.ts:62`). Fix
  this constant in the test so encrypt/decrypt symmetry is asserted against the
  value S-02 will actually pass; flag drift if S-02 deviates.

## What We're NOT Doing

- **Not writing the #3 payload/log-leak integration test.** No route, no
  token-logging line exists. It rides with S-02 as a required test sub-phase.
- **Not writing the #4 IDOR-by-id integration test.** No owner-scoped query
  exists to attack. It rides with S-02 (and must run against real Postgres).
- **Not installing `@cloudflare/vitest-pool-workers`.** Neither risk's testable
  surface touches a binding (crypto is pure; the eventual isolation test uses
  plain `pg`). Defer until Phase 3 code needs the Workers runtime.
- **Not installing MSW.** No GitHub/Jira HTTP edge is on the #3/#4 path; MSW
  lands with S-02's `src/lib/github.ts` PAT-validation call.
- **Not setting up coverage tooling** (v8/istanbul). Premature for one pure
  suite; revisit when there is a body of tests worth a coverage gate.
- **Not authoring the full CI gate matrix or any e2e/Playwright job.** Phase 1's
  CI workflow is intentionally minimal (lint + typecheck + test); test-plan §3
  Phase 4 owns the complete gate wiring and e2e smoke.
- **Not refactoring `crypto.ts`.** The suite tests it as-is. If a test reveals a
  real defect, raise it separately — do not fold a behavior change into the
  harness-bootstrap change.

## Implementation Approach

Three phases, each independently verifiable:

1. **Harness first, proven by a smoke test.** Install Vitest, write a node-env
   config that mirrors the `@/` alias and globs co-located `*.test.ts`, add the
   `test` and `typecheck` scripts, and prove the runner + alias work with a
   trivial smoke test before any real assertion depends on them. This de-risks
   the config (alias resolution is the one thing that silently breaks).
2. **Crypto suite second, against real code with an in-test key.** With the
   harness proven, write `src/lib/crypto.test.ts` — the seven assertion families
   the research grounded — generating the key in-process and passing it via the
   `env` arg.
3. **CI + cookbook + bookkeeping last.** Wire the minimal CI workflow, fill the
   §6 cookbook rows this phase can honestly answer, advance the §3 status, and
   record the two deferred assertions against S-02 so they are not forgotten.

## Critical Implementation Details

- **Path-alias mirroring is the load-bearing config detail.** The suite imports
  `@/lib/crypto`. Vitest does not read `tsconfig` `paths` by default. Mirror it
  with a manual `resolve.alias` (`'@': fileURLToPath(new URL('./src', import.meta.url))`
  — no trailing slash) — zero extra dependency, matching the project's
  minimal-deps posture — or add `vite-tsconfig-paths`. The smoke test in Phase 1
  exists specifically to catch a broken alias before Phase 2 depends on it.
- **The in-test key must never come from `.env` or a CI secret.** Generate
  `randomBytes(32).toString("base64")` in the test setup and pass it as the
  `env` arg to every `encryptToken`/`decryptToken` call. This keeps the suite
  hermetic and prevents a green CI run from depending on a configured secret.
- **Tamper tests must decode → flip → re-encode the envelope's parts.** The
  envelope is `v1:base64(iv):base64(ct‖tag)`. Flipping a byte means base64-
  decoding the relevant segment, mutating one byte, re-encoding, and reassembling
  — a raw string mutation may corrupt base64 framing and throw "Malformed
  envelope" instead of exercising the GCM auth-failure path the test intends.
- **Assert the error *type and message*, not just that it throws.** Error
  opacity is a named #3 sub-claim: on a tampered/wrong-AAD decrypt, assert the
  thrown value is `TokenCryptoError` and `.message === "Token decryption failed."`
  (the generic string) — never the GCM internal message, never plaintext.

## Phase 1: Vitest Harness Bootstrap

### Overview

Install and configure Vitest (node environment), wire the `test` and
`typecheck` npm scripts, and prove the runner + `@/` alias resolve with a
throwaway smoke test.

### Changes Required:

#### 1. Test runner dependency

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency so the project has a test runner.
Pin to the current major (verify exact version at install via the Vitest
registry — v3.x line is current).

**Contract**: `devDependencies.vitest` present after `npm install`. No change to
runtime `dependencies`.

#### 2. npm scripts

**File**: `package.json`

**Intent**: Expose `test` (runs Vitest once, non-watch, for CI/agent loops) and
`typecheck` (`tsc --noEmit`) so both the local loop and CI call the same
commands. Completes the local half of the test-plan §5 lint+typecheck gate.

**Contract**: `scripts.test` = `vitest run`; `scripts.typecheck` = `tsc --noEmit`.
Existing `lint` script unchanged.

#### 3. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure the node test environment, mirror the `@/*` → `./src/*`
alias, and glob co-located `*.test.ts` files so the suite resolves imports the
same way the app does.

**Contract**: `defineConfig` from `vitest/config` with `test.environment = "node"`,
an include glob covering co-located `src/**/*.test.ts`, and an `@` alias to
`src`. Manual `resolve.alias` is the default (no extra dep). Use `fileURLToPath`
with **no trailing slash** on the value — a trailing-slash value under the `"@"`
key resolves `@/lib/crypto` to `…/src//lib/crypto` (double slash); the no-slash
form is clean:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

(Alternative: `vite-tsconfig-paths` derives the alias from `tsconfig` so it
can't drift — at the cost of one extra dev dependency.)

#### 4. Smoke test (throwaway)

**File**: `src/lib/__smoke__.test.ts` (new, deleted at end of phase or kept as a
trivial sanity test — implementer's call)

**Intent**: Prove the runner executes and the `@/` alias resolves before Phase 2
depends on it. Import any existing `@/lib/*` symbol and assert a trivial truth.

**Contract**: One `test()` that imports through the `@/` alias and asserts a
constant — its only job is to fail loudly if the alias is misconfigured.

### Success Criteria:

#### Automated Verification:

- Vitest installs cleanly: `npm install` exits 0
- Test runner executes: `npm test` exits 0 with the smoke test passing
- Alias resolves: the smoke test's `@/lib/*` import does not error
- Typecheck script runs: `npm run typecheck` exits 0
- Lint still passes: `npm run lint` exits 0

#### Manual Verification:

- `npm test` output shows Vitest running in the node environment (not jsdom)
- Removing/breaking the alias in `vitest.config.ts` makes the smoke test fail
  (confirms the alias is actually load-bearing, not coincidentally resolving)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Crypto-Envelope Unit Suite

### Overview

Write `src/lib/crypto.test.ts` covering the seven grounded assertion families
for risks #3 and #4 against the real `crypto.ts`, with an in-test key and the
fixed `"GITHUB"` provider constant.

### Changes Required:

#### 1. Crypto unit suite

**File**: `src/lib/crypto.test.ts` (new, co-located with `crypto.ts`)

**Intent**: Assert the credential envelope's full contract — the load-bearing #3
defense and the crypto-layer expression of #4 — using an in-process generated
32-byte key passed via the `env` arg, and `provider: "GITHUB"` (the value S-02
will use).

**Contract**: A Vitest suite importing `encryptToken`, `decryptToken`,
`redactToken`, `TokenCryptoError` from `@/lib/crypto`. Assertion families:

1. **Round-trip** — `decryptToken(encryptToken(p, aad), aad)` === `p` for a
   representative PAT-shaped string.
2. **Tamper rejection** — flip one byte in each of iv / ciphertext / tag
   (decode→mutate→re-encode the envelope segment) → `decryptToken` throws
   `TokenCryptoError`.
3. **AAD isolation (#4 at crypto layer)** — an envelope sealed for
   `{ownerId: "A", provider: "GITHUB"}` decrypted under `{ownerId: "B", …}`
   throws; same for a mismatched `provider`.
4. **Malformed / wrong-version envelope** — `"not:an:envelope:x"` (wrong part
   count), a `v2:`-prefixed envelope, and a too-short payload each throw
   `TokenCryptoError`.
5. **Key validation** — missing key throws; a key that base64-decodes to ≠ 32
   bytes throws; no path returns a partial key. (Pass `env` with absent / short
   `TOKEN_ENCRYPTION_KEY`.)
6. **IV uniqueness** — two `encryptToken` calls on identical plaintext+AAD
   produce different envelopes (proves no IV reuse).
7. **Error opacity** — on a tampered/wrong-AAD decrypt, the thrown
   `TokenCryptoError.message` is exactly `"Token decryption failed."` (never the
   GCM internal message, never plaintext). Optionally assert `redactToken`
   returns only the last 4 chars.

A small in-file helper generates the key (`randomBytes(32).toString("base64")`)
and builds the `env` object; the AAD `provider` constant is `"GITHUB"`.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test` exits 0 with all seven families green
- Typecheck clean: `npm run typecheck` exits 0 (the suite is strict-mode TS)
- Lint clean: `npm run lint` exits 0
- No reliance on ambient env: the suite passes with `TOKEN_ENCRYPTION_KEY`
  unset in the shell (proves the in-test key injection works)

#### Manual Verification:

- Temporarily weakening `crypto.ts` (e.g. making `decryptToken` ignore the AAD)
  causes the AAD-isolation and tamper tests to fail — confirms the assertions
  have real signal, not just exercising the happy path
- The error-opacity assertion fails if `decryptToken` is changed to surface the
  underlying GCM message — confirms the opacity check is load-bearing

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: CI Gate + Cookbook + Rollout Bookkeeping

### Overview

Wire a minimal CI workflow (lint + typecheck + test on PRs), fill the test-plan
§6 cookbook rows this phase can honestly answer, advance the §3 Phase 1 status,
and record the deferred #3-payload/log and #4-IDOR assertions as required test
sub-phases against S-02.

### Changes Required:

#### 1. Minimal CI workflow

**File**: `.github/workflows/ci.yml` (new — create `.github/workflows/`; the
`.github` directory does not exist yet)

**Intent**: Machine-enforce the test gate the moment tests exist: run lint,
typecheck, and the unit suite on every pull request. Scoped minimal — Phase 4
extends this with e2e and the full gate matrix rather than rebuilding it.

**Contract**: A `pull_request`-triggered workflow, steps:
`npm ci` → `npm run lint` → `npm run typecheck` → `npm test`. Pin the runtime to
the repo's Node version via `actions/setup-node` with `node-version-file: .nvmrc`
(currently Node 24) — never a hardcoded version, so CI tracks local dev. No
deploy, no e2e, no secrets (the crypto suite generates its own key). Name the job
so Phase 4 can add jobs alongside it without renaming.

#### 2. Cookbook: unit-test pattern

**File**: `context/foundation/test-plan.md` (§6.1, §6.2, §6.4)

**Intent**: Replace the "TBD — see §3 Phase 1" placeholders with the concrete
conventions this phase locked: co-located `*.test.ts`, node-env Vitest,
`npm test` run command, in-test key injection via the `env` arg, and a pointer
to `src/lib/crypto.test.ts` as the reference unit suite. §6.2 / §6.4 record that
the credential-write integration + IDOR negative case are deferred to S-02 (so
the cookbook doesn't claim a pattern that has no reference test yet).

**Contract**: §6.1 filled with location/naming/run-command/reference-test; §6.2
and §6.4 updated to point at the S-02 sub-phases for the integration/route +
IDOR reference (not left bare "TBD", not falsely claimed as shipped).

#### 3. Reconcile the §5 quality-gate row

**File**: `context/foundation/test-plan.md` (§5 gates table)

**Intent**: The §5 row "unit + integration | required after §3 Phase 1" becomes
false the moment this phase completes — all integration tests are deferred to
S-02, so only the unit half is enforced after Phase 1. Split the gate so §5
tells the truth and CI (unit-only) isn't contradicted by a gate claiming
integration is enforced now. This mirrors the same temporal split the plan
applies to §3/§6.

**Contract**: The single "unit + integration" §5 row becomes two obligations —
**unit: required after §3 Phase 1** (what this phase delivers) and
**integration: required after S-02** (the slice that creates the route +
owner-scoped query the integration tests assert against). The "Catches" column
keeps crypto under the unit row; isolation moves under the integration row.

#### 4. Advance the rollout status

**File**: `context/foundation/test-plan.md` (§3 table) and
`context/changes/testing-harness-credential-security/change.md`

**Intent**: Move §3 Phase 1 status from `change opened` toward `complete` (the
orchestrator re-derives exact state from artifacts; set it to reflect that
harness + crypto suite landed). Update `change.md` `status` + `updated`.

**Contract**: §3 Phase 1 Status cell reflects the implemented state; a footnote
or §6.6 note records that the payload/log + IDOR sub-claims are tracked against
S-02. `change.md` frontmatter `updated: <today>`.

#### 4. Record the S-02 deferral

**File**: `context/changes/setup-github-integration/` (append to its
`change.md` Notes or a dedicated `test-requirements.md`) — and a §6.6 per-phase
note in `test-plan.md`

**Intent**: Make the two deferred assertions a required, discoverable obligation
on S-02's plan: (a) the connect/validate route response body never contains the
token and no log line emits it (#3 integration); (b) Account B's session cannot
read Account A's credential/roster/anomaly row by id, tested against real
Postgres, not a mock (#4 integration). Include the `provider: "GITHUB"` AAD
constant note so encrypt/decrypt symmetry is preserved. (This is the same
obligation §5's new "integration: required after S-02" row points at — Change #3.)

**Contract**: S-02's change folder carries an explicit "required test
sub-phases" note citing risks #3/#4 and the real-Postgres constraint; test-plan
§6.6 references it.

### Success Criteria:

#### Automated Verification:

- CI workflow is valid YAML and runs: a PR triggers the workflow and it passes
  (lint + typecheck + test all green in CI)
- The workflow uses no repository secrets (grep the YAML for `secrets.` → none
  on the test path)
- The workflow pins Node via `.nvmrc` (grep for `node-version-file` → present;
  no hardcoded `node-version`)
- test-plan §6.1 no longer contains "TBD" for the unit-test row
- test-plan §5 no longer has a single "unit + integration … required after
  Phase 1" row (split into unit-after-Phase-1 + integration-after-S-02)

#### Manual Verification:

- The S-02 change folder visibly carries the deferred #3/#4 test obligations
  (someone opening S-02's plan cannot miss them)
- test-plan §3 Phase 1 status accurately reflects what shipped vs what deferred
- A reviewer reading §6.1 can add a new unit test from the cookbook alone
  (location, naming, run command, reference test all present)

**Implementation Note**: After this phase, the change is ready to archive
(`/10x-archive`) once the user confirms the rollout bookkeeping is correct.

---

## Testing Strategy

### Unit Tests:

- The crypto suite IS the unit-test deliverable (Phase 2). Seven assertion
  families; oracle values hand-derived from the envelope spec, never lifted from
  `crypto.ts` output.
- Key edge cases: byte-flip in each envelope segment; wrong AAD owner and wrong
  AAD provider; absent vs wrong-length key; identical-input IV uniqueness;
  generic error message on failure.

### Integration Tests:

- **Deferred to S-02** by design (Phase 3 bookkeeping). The #3 payload/log
  assertion and the #4 IDOR-by-id assertion require code that does not exist in
  this slice. Writing them now would test invented stubs, not the product.

### Manual Testing Steps:

1. Run `npm test` with `TOKEN_ENCRYPTION_KEY` unset — suite passes (hermetic).
2. Temporarily break `decryptToken`'s AAD check — AAD-isolation + tamper tests
   fail (signal check).
3. Temporarily surface the GCM cause in `TokenCryptoError.message` — opacity
   test fails (signal check).
4. Break the `@` alias in `vitest.config.ts` — suite fails to resolve imports
   (config check).
5. Open a PR — CI runs lint + typecheck + test and reports green.

## Performance Considerations

None. One pure-function suite; no DB, network, or Workers runtime. Suite runtime
is sub-second; CI is dominated by `npm ci`, not the tests.

## Migration Notes

None — greenfield harness. No existing tests or config to migrate. The CI
workflow is the first file in `.github/workflows/`.

## References

- Research: `context/changes/testing-harness-credential-security/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks #3/#4, §4 stack, §6 cookbook)
- Crypto under test: `src/lib/crypto.ts:81-150`
- Alias source: `tsconfig.json:21-23`
- Related slice (deferral target): `context/changes/setup-github-integration/research.md`
- Vitest config (Context7, `/vitest-dev/vitest`): node environment is the
  default; mirror tsconfig paths via manual `resolve.alias` or `vite-tsconfig-paths`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest Harness Bootstrap

#### Automated

- [x] 1.1 Vitest installs cleanly: `npm install` exits 0 — 5a66d05
- [x] 1.2 Test runner executes: `npm test` exits 0 with the smoke test passing — 5a66d05
- [x] 1.3 Alias resolves: the smoke test's `@/lib/*` import does not error — 5a66d05
- [x] 1.4 Typecheck script runs: `npm run typecheck` exits 0 — 5a66d05
- [x] 1.5 Lint still passes: `npm run lint` exits 0 — 5a66d05

#### Manual

- [x] 1.6 `npm test` output shows Vitest running in the node environment — 5a66d05
- [x] 1.7 Breaking the alias in `vitest.config.ts` makes the smoke test fail — 5a66d05

### Phase 2: Crypto-Envelope Unit Suite

#### Automated

- [x] 2.1 Full suite passes: `npm test` exits 0 with all seven families green — b89d245
- [x] 2.2 Typecheck clean: `npm run typecheck` exits 0 — b89d245
- [x] 2.3 Lint clean: `npm run lint` exits 0 — b89d245
- [x] 2.4 Suite passes with `TOKEN_ENCRYPTION_KEY` unset (in-test key injection works) — b89d245

#### Manual

- [x] 2.5 Weakening `crypto.ts` AAD check fails the AAD-isolation + tamper tests — b89d245
- [x] 2.6 Surfacing the GCM message fails the error-opacity assertion — b89d245

### Phase 3: CI Gate + Cookbook + Rollout Bookkeeping

#### Automated

- [x] 3.1 CI workflow runs on a PR and passes (lint + typecheck + test green in CI)
- [x] 3.2 The workflow uses no repository secrets on the test path
- [x] 3.3 The workflow pins Node via `.nvmrc` (`node-version-file` present; no hardcoded version)
- [x] 3.4 test-plan §6.1 no longer contains "TBD" for the unit-test row
- [x] 3.5 test-plan §5 splits the gate into unit-after-Phase-1 + integration-after-S-02

#### Manual

- [ ] 3.6 S-02 change folder visibly carries the deferred #3/#4 test obligations
- [ ] 3.7 test-plan §3 Phase 1 status accurately reflects shipped vs deferred
- [ ] 3.8 A reviewer can add a new unit test from §6.1 alone
