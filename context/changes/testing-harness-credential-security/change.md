---
change_id: testing-harness-credential-security
title: Test rollout Phase 1 — harness bootstrap + credential security
status: implementing
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Harness bootstrap +
credential security". Stands up the test runner (none exists yet — see
test-plan §4) and defends the two highest-impact security risks at the
cheapest layer.

**Risks covered (test-plan §2):**

- **#3 — credential leakage.** A stored GitHub PAT / Jira token leaks into a
  log line, an error body, or a client-facing payload; or the
  encryption-at-rest round-trip / tamper-check fails.
- **#4 — cross-account IDOR.** An endpoint checks authentication but not
  ownership, so one account reads another account's credentials, roster,
  anomalies, or refinement sessions.

**Test types:** unit + integration.

**Risk response intent (test-plan §2 Risk Response Guidance):**

- #3: prove the token never appears in a response body or a log line, that
  encrypt→decrypt round-trips, and that tampered ciphertext is rejected
  (integration). Challenge "encrypted at rest means safe everywhere"
  (ignoring logs and payloads). Avoid asserting only the DB column while
  never checking the response body + log surface.
- #4: prove Account A's session cannot read Account B's resources by id.
  Challenge "authenticated equals authorized." Avoid testing only the
  resource owner's happy path.
