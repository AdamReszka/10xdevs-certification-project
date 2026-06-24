---
date: 2026-06-23T20:31:22+0200
researcher: Adam Reszka
git_commit: 00e3b60
branch: feat/setup-github-integration
repository: 10xdevs-certification-project
topic: "Test rollout Phase 1 — harness bootstrap + credential security (risks #3 leakage, #4 IDOR)"
tags: [research, codebase, testing, crypto, credentials, isolation, idor, vitest]
status: complete
last_updated: 2026-06-23
last_updated_by: Adam Reszka
---

# Research: Test rollout Phase 1 — harness bootstrap + credential security

**Date**: 2026-06-23T20:31:22+0200
**Researcher**: Adam Reszka
**Git Commit**: 00e3b60
**Branch**: feat/setup-github-integration
**Repository**: 10xdevs-certification-project

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` (change
`testing-harness-credential-security`) in current code. For each of the two
risks, find the real failure path, verify or correct the test-plan's response
guidance, locate existing tests, pick the cheapest useful test layer, and flag
speculative risks or misleading hot-spot evidence.

- **#3 — credential leakage.** A stored GitHub PAT / Jira token leaks into a log
  line, an error body, or a client payload; or the encryption-at-rest
  round-trip / tamper-check fails.
- **#4 — cross-account IDOR.** An endpoint authenticates but does not authorize
  by ownership, so Account A reads Account B's credentials / roster / anomalies /
  refinement sessions.

## Summary

**The single most important finding: Phase 1's intended assertion surface is
only half-built.** The crypto primitive and the account-scoped schema both
exist and are testable now; the *route, response payload, log surface, and any
resource-by-id read query* that the risk guidance keeps pointing at **do not
exist yet**. This is not a gap to paper over — it determines what Phase 1 can
honestly test today versus what must ride with S-02.

Concretely:

- **Risk #3 — the only existing surface is `src/lib/crypto.ts`** (AES-256-GCM,
  AAD-bound, versioned envelope). It is pure, synchronous `node:crypto` and is
  **unit-testable with plain Vitest, no Workers pool, no DB, no mocks**. The
  round-trip / tamper / AAD-mismatch / key-validation half of the risk is fully
  groundable now.
  **`encryptToken`/`decryptToken` have ZERO callers in the repo** (verified
  repo-wide). There is no credential write path, no connect/validate route, no
  response body, and no token-touching log line to assert against. The
  "token never appears in a response body or a log line" half of the guidance
  **cannot be grounded against code that doesn't exist** — it belongs to S-02's
  implementation (`feat/setup-github-integration`, researched but not landed).

- **Risk #4 — ownership is enforced by query scope (`ownerId`), not a route
  guard, and no owner-scoped product query exists yet.** Every product table
  carries `ownerId text NOT NULL → user.id ON DELETE CASCADE`; isolation is
  *designed* to be `where eq(table.ownerId, session.user.id)`. But the only
  reads in the app today are Better Auth's own session lookups. There is **no
  product endpoint, no data-access helper, and therefore no IDOR-testable
  surface yet.** The gating that exists (`middleware.ts` optimistic cookie +
  `requireSession()` DB-backed) is **authentication, not per-resource
  authorization** — exactly the "authenticated ≠ authorized" gap the test-plan
  warns about, but there is nothing reading a resource by id to exploit yet.

- **Harness bootstrap is the part of Phase 1 that is fully actionable now.**
  Recommend **plain Vitest (node environment)** for this phase. The crypto suite
  needs nothing more. `@cloudflare/vitest-pool-workers` is **not required for
  #3/#4** (crypto touches no binding; the eventual isolation test hits Postgres
  via plain `pg`, not the `HYPERDRIVE` binding). **MSW is premature** — there is
  no GitHub/Jira HTTP edge in the crypto or isolation paths; it lands with
  S-02's `src/lib/github.ts`. Pull those into the phase only when their code
  exists.

**Net recommendation for `/10x-plan`:** scope Phase 1 to **(a) Vitest harness +
(b) the crypto unit suite** (real signal, the only fully-grounded surface), and
**sequence the response-body/log-line assertion and the IDOR integration test
to ride with S-02's first owner-scoped mutation/read** — either as a required
test sub-phase inside S-02's plan, or as a Phase 1b that unblocks once S-02
lands. Writing those two assertions now would mean inventing the very code
they assert against. See "Cheapest Useful Test Layer" and "Open Questions."

## Detailed Findings

### Risk #3 — Credential leakage

#### What exists: the crypto envelope (the defense), fully testable

`src/lib/crypto.ts` is complete and self-contained:

- **Envelope shape** (`crypto.ts:81-97`): `encryptToken(plaintext, {ownerId,
  provider}, env?)` → `` `v1:base64(iv):base64(ciphertext‖gcmTag)` ``. Fresh
  12-byte random IV per call (`crypto.ts:87`); GCM auth tag appended
  (`crypto.ts:94-95`); `v1` key-version prefix (`crypto.ts:46,96`).
- **AAD binding** (`crypto.ts:72-75, 89`): `aadBytes = utf8(ownerId + "\0" +
  provider)`. The NUL separator is deliberate (prefix-collision avoidance,
  `crypto.ts:72`). A ciphertext cannot be replayed under a different
  account/provider — decrypt verifies the same AAD (`crypto.ts:130`).
- **Decrypt rejects everything it should** (`crypto.ts:105-142`): malformed
  envelope (`parts.length !== 3`, `crypto.ts:110-112`), unknown version
  (`crypto.ts:115-117`), wrong IV length / short payload (`crypto.ts:122-124`),
  and any GCM failure — tamper, wrong key, wrong AAD — caught and re-thrown as a
  typed `TokenCryptoError("Token decryption failed.")` **that never surfaces the
  underlying message or plaintext** (`crypto.ts:132-141`). The original error is
  preserved only as `{ cause }` (`crypto.ts:140`) — relevant: assert the
  *message* is the generic string, not the cause.
- **Key validation fails loudly, never silently degrades** (`crypto.ts:54-70`):
  missing `TOKEN_ENCRYPTION_KEY` throws; a key that doesn't base64-decode to
  exactly 32 bytes throws (`crypto.ts:63-68`). No path returns a weak/partial
  key or stores plaintext.
- **`redactToken`** (`crypto.ts:148-150`): returns `plaintext.slice(-4)` — the
  non-secret `tokenLast4` UI hint, designed so the read-back view never
  decrypts.
- **Env resolution** (`crypto.ts:54-55`): Workers `env.TOKEN_ENCRYPTION_KEY`
  first, `process.env` fallback. Tests can inject `env` directly — no Workers
  runtime needed.

**Schema side** (`src/db/schema.ts:196-231`): `githubCredential` /
`jiraCredential` store `encryptedToken` (the envelope verbatim) + non-secret
`tokenLast4`, `githubLogin`/`workspaceUrl`+`jiraEmail`, `scopes`, `validatedAt`.
Column comment (`schema.ts:202`): *"AES-256-GCM envelope … Never logged, never
client-sent."* — the intent is documented; nothing enforces it yet because
nothing writes or reads these columns.

#### What does NOT exist: the leak surface the risk actually describes

- **`encryptToken`/`decryptToken` have no callers anywhere** (verified:
  `grep -rn 'encryptToken|decryptToken' --include=*.ts` returns only
  `crypto.ts`). The crypto comment itself says call sites land in S-02
  (`crypto.ts` header; `setup-github-integration/research.md:28`).
- **No product route or server action exists.** Only route in the app is the
  Better Auth catch-all `src/app/api/auth/[...all]/route.ts`. `grep -rn
  '"use server"'` is empty. So there is **no connect/validate response body** to
  inspect and **no credential endpoint** to test.
- **Log surface today touches no tokens.** The only logging in the security path
  is `auth.ts:58` (`console.log` of the password-reset URL — a known S-01/S-11
  stub, not a token) and `auth.ts:98` (`console.error` of a session-validation
  failure, no credential). The token-logging risk has no code to manifest in
  until S-02 wires the validate→encrypt→store action.

#### Verdict on the test-plan's #3 guidance

| Guidance | Verdict |
|---|---|
| "encrypt→decrypt round-trips" | ✅ Groundable now (unit). |
| "tampered ciphertext is rejected" | ✅ Groundable now (unit) — flip a byte in iv / ciphertext / tag → expect `TokenCryptoError`. |
| "token never appears in a response body or a log line" | ⚠️ **Not groundable now** — no route, no token-logging line. Belongs to S-02. |
| Challenge "encrypted at rest means safe everywhere" | ✅ Valid challenge — and the *reason* it can't be fully tested yet is precisely that the payload/log surface is unbuilt. Don't let the crypto unit suite masquerade as covering it. |
| Anti-pattern "asserting only the DB column" | ✅ Correct — but note the inverse trap here: asserting only the crypto round-trip and *claiming* the leak risk is covered. The round-trip is necessary, not sufficient. |
| Test-plan "Likely cheapest layer: integration" | 🔧 **Correct for the existing surface: unit.** The crypto half is pure and needs no integration harness. The payload/log half is integration *once S-02 exists*. |

**Strengthen the guidance with two assertions the brief under-specifies, both
unit and free now:** (1) **AAD isolation** — `decryptToken(envelope, {ownerId:
"B", provider})` on an envelope sealed for owner A throws (this is the
crypto-level expression of the cross-account guarantee — ties #3 to #4).
(2) **IV uniqueness** — two `encryptToken` calls on identical plaintext+AAD
produce different envelopes (proves no IV reuse, `crypto.ts:87`).
(3) **Error opacity** — assert `TokenCryptoError.message` is the generic
`"Token decryption failed."`, never the GCM internal message or plaintext.

### Risk #4 — Cross-account IDOR

#### Where ownership is (will be) enforced: query scope, not a route guard

- **Schema is the isolation contract** (`schema.ts:184-192` block comment):
  *"Every product table is account-scoped: `ownerId text NOT NULL → user.id ON
  DELETE CASCADE`."* Confirmed across all 17 product tables (githubCredential
  `:198`, jiraCredential `:217`, monitoredRepo `:239`, teamMember `:299`,
  anomaly `:583`, refinementSession `:665`, etc.). One-per-account tables add
  `.unique()` on `ownerId` (githubCredential `:200`, jiraCredential `:219`,
  jiraProject `:259`).
- **The enforcement pattern (planned, per S-02 research)**: `requireSession()`
  → `session.user.id` becomes `ownerId` → every product query filters
  `where eq(table.ownerId, session.user.id)`
  (`setup-github-integration/research.md:52`). There is **no route guard layer**
  and **no RLS** — see the isolation model below. Authorization is entirely the
  presence of an `ownerId` predicate on every read/write.
- **No owner-scoped product query exists yet.** The only DB reads are Better
  Auth's session/user lookups via the Drizzle adapter (`auth.ts:47`). No
  `db.select().from(githubCredential)` / roster / anomaly read exists. So there
  is **no endpoint to attack with Account B's session and Account A's id.**

#### The isolation model raises the stakes (memory: supabase-isolation-model)

Per memory `supabase-isolation-model` and `local_dev_db_and_cf_context`: the
Supabase **Data API (PostgREST) is OFF**, public tables have no RLS, and the app
reaches the DB **only via Hyperdrive** (`src/lib/db.ts:4-12`, per-request
`Pool({max:1})`). **Consequence: there is no second line of defense.** Postgres
RLS is not enforcing per-row ownership; the publishable Supabase key cannot
reach these tables. **100% of cross-account isolation rests on the app-side
`ownerId` predicate.** That makes the eventual integration test high-value — but
also means it must test the *real query layer*, not a mocked DB, to have signal.

#### The gating chain is authn, not per-resource authz

1. `middleware.ts:34-47` — optimistic `getSessionCookie()` presence check;
   explicitly **"NOT the security boundary"** (`middleware.ts:13-17`, cf.
   CVE-2025-29927). `PUBLIC_PREFIXES` (`middleware.ts:26`) gate by path only.
2. `src/app/(app)/layout.tsx:22` — authoritative `await requireSession()`
   (DB-backed, `force-dynamic`).
3. `auth.ts:89-123` — `getOptionalSession()` (React `cache()`-wrapped) +
   `requireSession()` (redirect `/login`).

All three answer **"is there a valid session?"** None answers **"does this
session own row X?"** That second question has no code yet because no code reads
row X by id. This is the textbook authenticated-but-not-authorized shape — but
it is a *future* failure mode, not a present, exploitable one.

#### Verdict on the test-plan's #4 guidance

| Guidance | Verdict |
|---|---|
| "Account A's session cannot read Account B's resources by id" | ⚠️ **Not groundable now** — nothing reads a resource by id. Lands with S-02's first owner-scoped read. |
| Challenge "authenticated equals authorized" | ✅ Exactly the right challenge for this codebase's design (query-scope enforcement, no RLS fallback). |
| Ground "where ownership is enforced (query scope vs route guard)" | ✅ **Answered: query scope** (`where eq(ownerId, session.user.id)`), no route guard, no RLS. |
| "Cheapest layer: integration" | ✅ Correct **once a query exists** — must hit real Postgres (local Supabase :54322 via `getDb`/`DATABASE_URL`, plain `pg`, not the Workers pool) to exercise the actual predicate. Over-mocking the DB would assert nothing. |
| Anti-pattern "testing only the owner's happy path" | ✅ Correct — the load-bearing case is *Account B's session + Account A's row id → empty result / 404*, not the owner read. |

### Harness bootstrap (the actionable core of Phase 1)

Current state: **zero test files, zero runner config, no Vitest/Jest/Playwright
in `package.json`** (verified). `npm run lint` (ESLint flat config) is the only
quality command (`package.json` scripts).

Grounded recommendations for the runner (verify exact versions at plan time via
Context7 — Vitest/Workers-pool docs):

- **Vitest, node environment, for Phase 1.** `crypto.ts` is synchronous
  `node:crypto`; `nodejs_compat` is on for the *Workers* build
  (`wrangler.jsonc:8`) but the *test* process is Node, where `node:crypto` is
  native. No Workers pool needed for the crypto suite.
- **`@cloudflare/vitest-pool-workers` — NOT for this phase.** It exists for code
  exercising the `HYPERDRIVE` binding / Workers runtime. Neither risk's testable
  surface touches a binding: crypto is pure; the eventual isolation test talks to
  Postgres through plain `pg` (`db.ts` `Pool`), which runs fine in Node against
  local Supabase. Defer the Workers pool until a test genuinely needs the
  Workers runtime (sync-loop / binding code, Phase 3).
- **MSW — NOT for this phase.** No GitHub/Jira HTTP edge is on the #3/#4 path.
  MSW lands with S-02's `src/lib/github.ts` PAT-validation call
  (`setup-github-integration/research.md:81-89`). Pulling it in now mocks
  nothing real.
- **Config wiring to verify at plan time:** path alias `@/*` → `./src/*`
  (`tsconfig.json:21-23`) must be mirrored in Vitest (e.g. `vite-tsconfig-paths`
  or a manual `resolve.alias`). `tsconfig` is `target ES2017`,
  `moduleResolution: bundler`. Pick a test-file convention (`*.test.ts`
  co-located vs `__tests__/`) and a `test` npm script — this is the §6.1 cookbook
  decision the phase must record.
- **`TOKEN_ENCRYPTION_KEY` for tests:** the crypto suite can generate a fresh
  32-byte base64 key in-test and pass it via the `env` arg (`crypto.ts:54-55`) —
  no `.env` dependency, no shared secret. `.env.example:23` only holds a
  placeholder; do not rely on a real key being present in CI.

## Cheapest Useful Test Layer (corrected)

| Risk | Sub-claim | Cheapest layer | Status today |
|------|-----------|----------------|--------------|
| #3 | encrypt→decrypt round-trip | **unit** | ✅ groundable now |
| #3 | tamper (iv/ct/tag byte-flip) rejected | **unit** | ✅ groundable now |
| #3 | wrong-AAD decrypt rejected (cross-account at crypto layer) | **unit** | ✅ groundable now |
| #3 | malformed / wrong-version envelope rejected | **unit** | ✅ groundable now |
| #3 | missing/short key throws (no silent plaintext) | **unit** | ✅ groundable now |
| #3 | IV uniqueness across calls | **unit** | ✅ groundable now |
| #3 | error message opacity (no plaintext / no cause leak) | **unit** | ✅ groundable now |
| #3 | token absent from response body | integration | ⛔ no route — rides with S-02 |
| #3 | token absent from log lines | integration | ⛔ no token-logging line — rides with S-02 |
| #4 | Account B cannot read Account A row by id | **integration (real Postgres)** | ⛔ no owner-scoped query — rides with S-02 |
| #4 | every product read carries an `ownerId` predicate | (lint/arch test — hard) | ⛔ defer; revisit when a data-access layer exists |

**Cost × signal call:** the seven unit rows are the entirety of what Phase 1 can
test against real code, and they carry real signal (the crypto envelope is the
load-bearing credential defense). The four ⛔ rows are the *named risks'* most
literal expression, but writing them now means writing the production code first.
Recommend Phase 1 = harness + crypto unit suite; the ⛔ rows become **required
test sub-phases in S-02's plan** (the slice that introduces the route, the
response payload, and the first owner-scoped query).

## Existing Tests

**None.** No `*.test.ts`/`*.spec.ts`, no `vitest.config.*`, no test runner in
`package.json`. Phase 1 is a true greenfield harness bootstrap (matches
test-plan §4: *"There is none yet"*).

## Code References

- `src/lib/crypto.ts:81-97` — `encryptToken` (envelope, fresh IV, GCM tag, AAD)
- `src/lib/crypto.ts:105-142` — `decryptToken` (all rejection paths; opaque error)
- `src/lib/crypto.ts:54-70` — `getKey` (loud validation, never partial key)
- `src/lib/crypto.ts:72-75` — `aadBytes` (NUL-separated ownerId\0provider)
- `src/lib/crypto.ts:148-150` — `redactToken` (non-secret last-4)
- `src/db/schema.ts:184-192` — account-scoping contract (block comment)
- `src/db/schema.ts:196-231` — `githubCredential` / `jiraCredential` (encryptedToken, ownerId unique)
- `src/lib/db.ts:4-12` — per-request `getDb(env)` Pool over Hyperdrive / DATABASE_URL
- `src/lib/auth.ts:89-123` — `getOptionalSession()` / `requireSession()` (authn boundary)
- `middleware.ts:13-17, 34-47` — optimistic cookie gate, explicitly not the security boundary
- `src/app/(app)/layout.tsx:22` — authoritative `requireSession()` on gated routes
- `src/app/api/auth/[...all]/route.ts` — the only route handler in the app
- `package.json` — no test deps; `lint` is the only quality script
- `tsconfig.json:21-23` — `@/*` → `./src/*` (mirror into Vitest)
- `wrangler.jsonc:5-8` — `nodejs_compat` (Workers build; test process is Node)

## Architecture Insights

- **The defense exists; the consumer doesn't.** F-02 deliberately landed the
  crypto envelope and the fully account-scoped schema ahead of any caller. Phase
  1 lands on a foundation whose *contract* is testable but whose *behavior at the
  edge* (route payloads, owner-scoped queries) is still S-02 work. The risk-first
  plan and the build order are one slice out of phase — name it, don't fake it.
- **Isolation has no safety net.** Data API off + no RLS (memory
  `supabase-isolation-model`) means the `ownerId` predicate is the *only* thing
  between accounts. That argues for the IDOR integration test to be a hard gate
  the moment the first owner-scoped query lands — and for it to run against real
  Postgres, never a mock.
- **Workers-native / minimal-deps posture** (sync `node:crypto`, plain `pg`, no
  Octokit) means the test stack can stay lean: Node-env Vitest covers Phase 1
  outright; the heavier `vitest-pool-workers` + MSW are deferred until code that
  needs them exists.

## Misleading Evidence / Speculative-Risk Flags

- **Hot-spot `src/lib/` (1 commit/30d) is weak likelihood evidence for the
  *named* failure modes.** The hot-spot points at `crypto.ts` — the *defense* —
  not at the leak site (a route payload / log line) or the IDOR site (an
  owner-scoped query), neither of which exists in `src/lib/` or anywhere yet. The
  hot-spot reasonably supports "crypto-envelope correctness"; it does **not**
  support "tokens leak into payloads/logs" or "IDOR" as present, likely failures.
  The test-plan's own note — security rows are Medium likelihood because the
  envelope/isolation model are *"already decided, not yet exercised"*
  (`test-plan.md:57-59`) — is accurate and is exactly why much of Phase 1's
  intended assertion surface can't be written against today's tree.
- **No risk is speculative in the *will-matter* sense** — both #3 and #4 are real
  once S-02 ships. The correction is purely temporal: the cheapest-layer column
  for the literal "payload/log" and "by id" sub-claims is integration-*after*-
  S-02, not now.

## Open Questions

1. **Phase 1 scope decision (for `/10x-plan`):** ship Phase 1 as *harness +
   crypto unit suite only* and move the payload/log + IDOR assertions into S-02's
   plan as required test sub-phases? Or hold Phase 1 open as a "1b" that unblocks
   when S-02's first owner-scoped mutation/read lands? Recommendation: the former
   — it keeps Phase 1 honest and lets the crypto suite + harness land now, while
   binding the route/query assertions to the slice that creates their target.
2. **AAD provider-string convention** for the eventual write path:
   `setup-github-integration/research.md:131` recommends `"GITHUB"` (matching the
   `integration` pgEnum, `schema.ts:62`). The crypto AAD test should fix this
   constant so encrypt/decrypt symmetry is asserted against the value S-02 will
   actually use — flag drift if S-02 deviates.
3. **Isolation integration target:** confirm the IDOR test (when written) runs
   against local Supabase Postgres (:54322 per memory `local_dev_db_and_cf_context`)
   via `getDb`/`DATABASE_URL` in Node — *not* `vitest-pool-workers` — since the
   query path uses plain `pg`. Verify at S-02 plan time.

## Related Research

- `context/changes/setup-github-integration/research.md` — S-02, the slice that
  introduces `encryptToken`'s first caller, the connect/validate Server Action,
  the response payload, and the first owner-scoped Drizzle write. The
  payload/log + IDOR assertions deferred above land here.
- `context/changes/account-auth-flow/` (S-01) — established `requireSession`/
  `getOptionalSession`, the gating chain, and the local-dev DB prerequisites.
