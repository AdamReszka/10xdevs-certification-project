<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-11 Daily Recap Email

- **Plan**: `context/changes/daily-recap-email/plan.md`
- **Scope**: Phases 1–6 of 6 (all automated Progress rows `[x]`)
- **Date**: 2026-08-26
- **Verdict**: REJECTED → **APPROVED** after triage (all 6 findings fixed)
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict (as reviewed) | After fixes |
|-----------|----------------------|-------------|
| Plan Adherence | WARNING | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | FAIL | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | PASS | PASS |

Post-triage gates: `tsc` clean, `lint` 0 errors, **565** unit (45 files), **214**
integration (18 files), **11/11** E2E.

## Scope check

57 files changed across `9986bc1..c21f9d3`. Every file in the plan's "Changes
Required" is present in the diff; **no file in the diff is absent from the plan**
except three, all benign and documented in their commits:

- `src/lib/auth-email.ts` + `src/lib/auth.test.ts` — the plan put the reset-email
  logic directly in `auth.ts`; it was split out so it is unit-testable without
  standing up a Better Auth instance and a pg pool. Consistent with CLAUDE.md's
  "decision logic moves to a testable sibling" rule.
- `src/lib/recap/escape-html.ts` — planned for Phase 4, pulled forward into
  Phase 3 because the reset href needs it.
- `src/components/ui/switch.tsx` — the plan said "add with `npx shadcn add`".

Automated criteria re-run at HEAD: `tsc` clean, `lint` 0 errors (5 pre-existing
warnings, none in new files), 550 unit, 210 integration, 11/11 E2E.

## Findings

### F1 — A missing sender burns the day, and the console transport is unreachable from the recap

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/recap/send.ts:215-216`, against `src/lib/email-transport.ts:82-95`
- **Detail**:
  `resolveEmailTransport` degrades to the console transport when no
  `RESEND_API_KEY` is set outside production — Phase 2's stated purpose, verbatim:
  *"a thin adapter so local development renders and logs the recap without any
  API key at all. The key becomes configuration, not a prerequisite."*

  `sendDailyRecap` defeats it. The sender check at `:215-216` runs **before** the
  transport is resolved at `:234`, and `RESEND_FROM_ADDRESS` is unset in exactly
  the same environments the key is. So the recap path takes `fail(… "no_sender")`
  and the console transport at `email-transport.ts:71-79` is **never reached from
  the recap** — only from `auth.ts`, which has its own no-sender fallback
  (`auth.ts:112-119`) and therefore hides the asymmetry.

  Worse than unreachable code: `fail()` writes `send_status = 'FAILED'` **and**
  `attempt_count = MAX_ATTEMPTS`. The day is permanently burned. This is not
  hypothetical — no Resend account exists yet, so the first cron tick after
  deploy writes a poisoned row for every owner, `/settings/recap` reports *"could
  not be delivered after 3 attempts"*, and provisioning the secrets that same
  afternoon does not un-burn the day: the owner waits until tomorrow.

  No test catches it because every `send.integration.test.ts` case passes an
  `ENV` with both fields set, and the `deps.transport` injection bypasses
  `resolveEmailTransport` entirely.
- **Fix A ⭐ Recommended**: Give the no-key path a placeholder sender, and move the remaining check above the claim
  - Approach: in `email-transport.ts`, have `resolveFromAddress` return a
    development placeholder (e.g. `SprintFlow <recap@localhost>`) when no key is
    configured outside production, so the console transport runs end to end and
    logs the recap as designed. In `send.ts`, move the sender check up beside the
    `no_sprint` / `disabled` checks so a genuinely misconfigured **production**
    skips before the claim instead of poisoning a row.
  - Strength: restores the Phase 2 contract exactly as written, and makes the
    skip-before-claim shape match how every other precondition in this function
    already behaves. Production still hard-fails loudly through
    `resolveEmailTransport`'s existing `EmailConfigError`.
  - Tradeoff: one more branch in the transport module, and a placeholder address
    that must never be reachable in production — guarded by the same
    `NODE_ENV === "production"` check the base-URL override already uses.
  - Confidence: HIGH — both halves are small, and the `no_sprint` skip is the
    working precedent for the ordering change.
  - Blind spot: not verified whether the console transport's output is actually
    useful for eyeballing a recap locally (it logs subject + recipient only, by
    design — the body carries ticket titles).
- **Fix B**: Only move the check above the claim; drop the console-transport-for-recap promise
  - Approach: leave `resolveFromAddress` alone; hoist the sender check so an
    unconfigured deployment returns `SKIPPED("no_sender")` before writing
    anything, and record in "What We're NOT Doing" that the recap needs real
    credentials even locally.
  - Strength: smallest possible edit; removes the poisoned-row defect, which is
    the part that actually costs the owner a day.
  - Tradeoff: local development can never see a recap end to end without a
    Resend account — the exact prerequisite Phase 2 existed to remove.
  - Confidence: HIGH — the poisoned-row half is unambiguous.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — `resolveFromAddress` yields a dev placeholder on the
  no-key path outside production (so the recap's console transport runs end to
  end), and the sender check moved above the claim, beside `no_sprint` and
  `disabled`, so a misconfigured production SKIPS instead of writing a poisoned
  row. Two consequences surfaced while fixing and were handled: `auth.ts`'s dev
  log line was re-gated on "no transport" rather than "no sender" (otherwise the
  reset URL would stop printing and a local password reset became unclickable),
  and an injected transport now counts as a real transport. Two new integration
  tests cover the production-skip and the dev-placeholder paths — the gap that
  let this ship was that every existing case passed a full `ENV` *and* an
  injected transport.


### F2 — Both 409s are treated as "in flight", so a permanent one leaves the row PENDING forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/recap/send.ts:250-253`
- **Detail**:
  The plan is explicit: *"a `409 concurrent_idempotent_requests` is the one 409
  that means 'in flight, come back later' rather than 'give up'."* The
  implementation branches on `err.status === 409` alone, so
  `409 invalid_idempotent_request` — a repeated key carrying a different payload,
  permanent by definition — is also read as in-flight.

  It cannot be distinguished as written: `email.ts` deliberately never reads the
  response body into the error (the rule that keeps the key out of every error
  surface), and the discriminator is the body's `name` field.

  Consequence is bounded but user-visible: the row stays `PENDING` and is never
  marked `FAILED`, so `describeLastSend` renders *"A recap for <day> is being sent
  right now"* indefinitely for that day. The attempt cap still terminates the
  retries, so there is no loop and no duplicate email — the defect is a status
  line that lies.
- **Fix A ⭐ Recommended**: Read only the `name` field on a 409, and carry it as a typed field
  - Approach: in `sendEmail`, on a 409 alone, parse the body and copy `name` onto
    `EmailRequestError` as a separate `code` field — never into `message`, never
    as `cause`. `send.ts` then treats `concurrent_idempotent_requests` as
    in-flight and everything else as terminal.
  - Strength: implements the plan's stated distinction, and keeps the
    never-interpolate-the-body rule intact because only a known enum-ish field
    crosses over.
  - Tradeoff: one narrow exception to "the body is never read on an error path",
    which has to be commented so a later reader does not widen it.
  - Confidence: MEDIUM — Resend's error `name` values are documented, but this
    branch will not be exercised against the real API until the account exists.
  - Blind spot: the existing `email.test.ts` 409 case asserts only the status; it
    would need a body fixture.
- **Fix B**: Treat every 409 as terminal FAILED
  - Approach: delete the in-flight branch; a 409 marks the row `FAILED` at the cap.
  - Strength: no body parsing at all, and the "Last send" line stops lying.
  - Tradeoff: a genuine `concurrent_idempotent_requests` is misreported as a
    failure. Harmless for delivery — the other attempt is already mid-flight at
    Resend and the idempotency key stops a second email — but the owner is told
    a recap failed that in fact arrived.
  - Confidence: HIGH — the delivery consequence is provably nil; only the status
    is wrong, and in the safer direction.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — `EmailRequestError` gained a `code` field
  populated from the body's `name`, read for **409 only**, never interpolated
  into `message` and never attached as `cause`. `send.ts` now treats only
  `concurrent_idempotent_requests` as in-flight; every other 409, including one
  with an unreadable body, falls through to terminal FAILED (fail closed). Three
  integration tests plus two unit tests, one of which puts the API key in the
  409 body to prove the narrow read still cannot leak it.


### F3 — `foldTeamActivity` has zero tests, including its null-churn invariant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/recap/build.ts:150-186`
- **Detail**:
  The function is exported specifically so a unit test can reach it, and it
  carries the one rule the plan singled out twice — *"Null is not zero"*: the sum
  is null only when **every** contributing cell was null, and a real 0 survives
  as 0.

  Nothing tests it. `render.test.ts` covers how null churn is *rendered*, which
  is the wrong end of the pipe: if `foldTeamActivity` collapsed a null into 0,
  the renderer would faithfully print `+0` and all 550 unit tests would still be
  green. The email would claim the team wrote zero lines on a day the churn was
  simply never measured — the precise misreading `activity-grid.ts:18-24` exists
  to prevent.

  The build integration test asserts `ticketsMovedToDone` but never the folded
  commit/churn/PR numbers.
- **Fix**: Add a unit test for `foldTeamActivity` covering: all-null churn stays
  null; one null cell among several non-null does not null the sum; a real 0 stays
  0; totals sum across rows AND days; an absent day key is skipped.
- **Decision**: FIXED — `src/lib/recap/build.test.ts`, 9 cases: all-null churn
  stays null, one null among non-nulls does not null the sum, a real 0 stays 0,
  additions and deletions are independent, summation across rows AND days, a
  missing day key is skipped, an off-axis cell is ignored, an empty grid returns
  null churn (not 0), and the folded shape carries no per-developer breakdown.


### F4 — The unsubscribe headers are computed at send time, not frozen with the bytes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/recap/send.ts:247`, `:288-297`
- **Detail**:
  The plan says of `List-Unsubscribe` / `List-Unsubscribe-Post`: *"Both headers
  are part of the frozen bytes, so they are identical across retries."* They are
  not — `unsubscribeHeaders(env)` is called per attempt and reads
  `BETTER_AUTH_URL` live, while `rendered_message` stores only
  `{ subject, html, text }`.

  In practice `BETTER_AUTH_URL` does not change between two attempts fifteen
  minutes apart, so the payload stays identical and the `Idempotency-Key` holds.
  The gap is that the invariant rests on an assumption rather than on the
  mechanism the plan chose to guarantee it with.
- **Fix**: Either widen `RenderedEmail` to carry `headers` and store them on the
  claim alongside the body, or amend the plan's wording to say the headers are
  derived from deployment-stable config rather than frozen.
- **Decision**: FIXED — `RenderedEmail` gained an optional `headers` field; the
  unsubscribe pair is now frozen onto the claim row with the body and re-sent
  from there, so the byte-identical-across-attempts invariant rests on the
  mechanism rather than on "that config never changes". Optional, so any row
  written before this shape still reads.


### F5 — The concurrency test serializes on a `max: 1` pool

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/recap/send.integration.test.ts:262-281`
- **Detail**:
  The two `sendDailyRecap` calls run under `Promise.all` against a pool with
  `max: 1`, so their statements interleave only at `await` boundaries — they
  never contend inside Postgres. The test does prove the `ON CONFLICT DO NOTHING`
  branch is taken and that exactly one email leaves, which is the assertion the
  plan asked for.

  What it does not prove is the thing the slice's headline claim rests on: that
  two genuinely simultaneous transactions resolve to one winner. Given the guard
  is a database UNIQUE constraint that would be doing the work either way, the
  residual risk is small — noted so nobody reads this test as stronger evidence
  than it is.
- **Fix**: If it is ever worth hardening, give the second call its own `Pool` so
  the two claims race on separate connections.
- **Decision**: FIXED — the concurrency test gives its second call its own
  `Pool`, so the two claims contend inside Postgres instead of serializing on one
  connection. Still one transport call and one `SENT` row.


### F6 — `describeLastSend`'s PENDING copy can outlive the send

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/organisms/settings/recap-settings-view.ts:38-42`
- **Detail**:
  *"A recap for <day> is being sent right now"* is true for the few seconds a
  send holds the claim. It is also what the owner sees after a Worker died
  mid-flight, and — until F2 is resolved — permanently after an
  `invalid_idempotent_request`. The plan's contract for this function named three
  states (never-sent, sent, failed); PENDING was added during implementation
  without a staleness bound.
- **Fix**: Compare `lastAttemptAt` against the 10-minute claim TTL and say
  "stalled — SprintFlow will retry within 15 minutes" once it is exceeded. Needs
  `lastAttemptAt` added to `getLastRecap`'s projection.
- **Decision**: FIXED — `getLastRecap` now projects `lastAttemptAt`, and
  `describeLastSend` compares it against the 10-minute claim TTL: inside it the
  copy says "being sent right now", past it "stalled mid-send — SprintFlow will
  retry within 15 minutes". A PENDING row with no timestamp reads as stalled
  (fail toward the honest reading). Three unit tests cover both sides of the
  boundary and the missing-timestamp case.


## Note for the reader

Architecture and Scope Discipline passed cleanly and were not touched by any
finding: the anti-divergence extraction is real (the integration test compares
the email's action strings against `listAnomaliesForSprint`'s rows and would fail
on drift), the sibling-`try` structure in `scheduled.ts` is verified by a test
that throws from `runOwner` and asserts the recap still runs, and the exactly-once
guarantee is where the plan put it — in the database, not in application logic.
Every "What We're NOT Doing" boundary held; nothing from S-12 leaked in.
