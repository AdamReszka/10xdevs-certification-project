# Test Rollout Phase 1 — Harness Bootstrap + Credential Security — Plan Brief

> Full plan: `context/changes/testing-harness-credential-security/plan.md`
> Research: `context/changes/testing-harness-credential-security/research.md`

## What & Why

Stand up the project's first automated test runner (none exists) and write the
unit suite that defends `src/lib/crypto.ts` — the credential-encryption envelope
that is the load-bearing defense for risk #3 (token leakage) and the
crypto-layer expression of risk #4 (cross-account isolation). This is rollout
Phase 1 of `context/foundation/test-plan.md`. A leaked GitHub PAT / Jira token
is, per the PRD, "a project-killing failure" — so the cheapest honest test of
the defense ships first.

## Starting Point

Zero test infrastructure: no Vitest/Jest/Playwright, no runner config, no test
files — `npm run lint` is the only quality command. `crypto.ts` is complete,
pure synchronous `node:crypto`, AAD-bound AES-256-GCM with a versioned
envelope — and has **zero callers** (its first caller, a connect/validate
Server Action, lands in S-02). The route, response payload, log surface, and
owner-scoped query that the #3/#4 risks ultimately describe **do not exist yet**.

## Desired End State

`npm test` runs Vitest (node env) green over `src/lib/crypto.test.ts`;
`npm run typecheck` runs clean; a minimal CI workflow gates lint + typecheck +
test on every PR. The test-plan §6 cookbook records how to add a unit test in
this project, and the two risk sub-claims that can't be honestly grounded today
are relocated to S-02 as required test sub-phases.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Phase 1 scope | Harness + crypto unit suite only | The payload/log + IDOR assertions have no code to assert against today | Research |
| Deferred #3/#4 assertions | Move to S-02 as required test sub-phases | S-02 is the slice that creates the route, payload, and first owner-scoped query | Research + Plan |
| Test runner | Vitest, node environment | `crypto.ts` is pure `node:crypto`; no Workers pool / DB / mocks needed | Research |
| Workers pool / MSW | Not now | Neither risk's testable surface touches a binding or an HTTP edge | Research |
| Test file layout | Co-located `*.test.ts` | Travels with the unit; Vitest default; minimal config (locks §6.1) | Plan |
| `typecheck` script | Add `tsc --noEmit` now | Completes the local half of the §5 lint+typecheck gate cheaply | Plan |
| CI timing | Minimal workflow in Phase 1 | Machine-enforce the gate the moment tests exist; Phase 4 extends it | Plan (user override) |
| Key in tests | In-test generated key via `env` arg | Keeps the suite hermetic; no `.env` / CI secret dependency | Research |
| AAD provider constant | `"GITHUB"` | Matches the value S-02's write path will pass (encrypt/decrypt symmetry) | Research |

## Scope

**In scope:** Vitest install + node-env config (mirroring the `@/` alias);
`test` + `typecheck` scripts; the seven-family crypto unit suite; a minimal
PR CI workflow (lint + typecheck + test); §6 cookbook entries; §3 status
advance; recording the S-02 deferral.

**Out of scope:** #3 payload/log integration test and #4 IDOR-by-id integration
test (both → S-02); `@cloudflare/vitest-pool-workers`; MSW; coverage tooling;
e2e/Playwright; the full Phase 4 gate matrix; any change to `crypto.ts`.

## Architecture / Approach

Three independently-verifiable phases: (1) install Vitest + node-env config +
scripts, proven by a throwaway smoke test that fails loudly if the `@/` alias is
misconfigured; (2) the crypto suite — round-trip, tamper rejection on
iv/ct/tag, AAD isolation, malformed/wrong-version envelope, key validation, IV
uniqueness, error opacity — against real code with an in-test key; (3) minimal
CI workflow + cookbook fill + rollout bookkeeping that pushes the two deferred
assertions onto S-02.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness bootstrap | Vitest node-env runner, `test`/`typecheck` scripts, smoke test | `@/` alias not mirrored into Vitest → imports silently fail |
| 2. Crypto unit suite | `crypto.test.ts`, 7 assertion families, in-test key | Tests pass without real signal (happy-path only) — mitigated by signal checks |
| 3. CI + cookbook + bookkeeping | PR workflow, §6 cookbook, S-02 deferral recorded | Deferred #3/#4 assertions get forgotten — mitigated by writing them into S-02's folder |

**Prerequisites:** None beyond the existing repo (Node 20, `npm`). No DB,
network, or Workers runtime needed.
**Estimated effort:** ~1 session across 3 phases (small, pure-function surface).

## Open Risks & Assumptions

- `tsc --noEmit` over the whole tree is **currently clean** (verified at plan-
  review time, exit 0, zero errors), so the typecheck gate is safe on arrival;
  the only residual is that adding `vitest.config.ts` + `*.test.ts` to the tree
  means `tsc` now checks them too — ensure `vitest` is installed before running
  typecheck so its types resolve.
- The S-02 deferral relies on the note actually being honored when S-02 is
  planned — Phase 3 makes it a discoverable obligation in S-02's folder, but a
  future planner must read it.
- Assumes the AAD provider string `"GITHUB"` is what S-02 will use; flag drift
  if S-02 deviates (Research Open Q2).

## Success Criteria (Summary)

- `npm test` and `npm run typecheck` exit 0 locally; CI runs them green on a PR.
- The crypto suite has real signal: weakening `crypto.ts` (AAD check or error
  opacity) makes specific tests fail.
- test-plan §6.1 reads as a usable cookbook entry, and S-02's folder carries the
  deferred #3 payload/log + #4 IDOR test obligations.
