---
change_id: setup-github-integration
title: Setup wizard — GitHub integration (S-02)
status: preparing
created: 2026-06-14
updated: 2026-06-23
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap: S-02 · GitHub #12 · Linear SPR-9 · FR-002, FR-004
- Prereqs S-01 + F-02 both done (auth flow + github_credential/monitored_repo tables + crypto.ts).

## Required test sub-phases (inherited from test-plan §3 Phase 1)

S-02 is the slice that first builds the connect/validate route, the response
payload, the token-touching log surface, and the first owner-scoped query — so
the two literal credential-security assertions that test-plan Phase 1 could not
ground (no target code existed) **must land here as required test sub-phases**.
S-02's `/10x-plan` must include them; do not mark S-02 complete without them.

- **#3 — credential leakage (integration).** Prove the connect/validate response
  body never contains the plaintext token, and that no log line emits it, on
  both the success and the validation-failure paths. Necessary-not-sufficient:
  the crypto round-trip is already covered by `src/lib/crypto.test.ts`; this adds
  the payload/log surface that suite cannot reach.
- **#4 — cross-account IDOR (integration).** Prove Account B's session cannot
  read Account A's credential / roster / monitored-repo row by id (→ 404 /
  empty), exercised against **real Postgres** (local Supabase `:54322` via
  `getDb`/`DATABASE_URL` in Node — *not* `vitest-pool-workers`), never a mocked
  DB. Ownership is enforced only by the `where eq(table.ownerId, session.user.id)`
  predicate (Data API off, no RLS), so the test must hit the real query layer.
- **AAD constant.** The encrypt/decrypt AAD `provider` value must be `"GITHUB"`
  (matches the `integration` pgEnum and `src/lib/crypto.test.ts`). Flag drift if
  S-02's write path deviates.

(Recorded by `testing-harness-credential-security` Phase 3; see
`context/foundation/test-plan.md` §5 "integration: required after S-02" and §6.6.)
