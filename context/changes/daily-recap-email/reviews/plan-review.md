<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-11 Daily Recap Email

- **Plan**: `context/changes/daily-recap-email/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-26
- **Verdict**: REVISE → **SOUND** after triage (all 7 findings fixed)
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict (as reviewed) | After fixes |
|-----------|----------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

20/20 paths ✓, 12/12 symbols ✓, brief↔plan ✓.

Confirmed against the code at `9986bc1`: `run-sync.ts:645` / `:677-687` / `:721-728`
(timezone write inside the txn below the early return), `dashboard/page.tsx:76-97`
(inline anomaly→view mapping), `day-bucket.ts:30-46` (formatter cache),
`auth.ts:56-59` (reset stub naming S-11), `github.ts:77-111` (transport shape),
`activity.ts:36-40` (zone re-read), `capacity.ts:151` (sprint re-resolve),
`reader.ts:12-15` (severity via enum declaration order), `vitest.config.ts:19`
(`src/**/*.test.ts`, `.ts` only), `wrangler.jsonc:12-14` (`*/15 * * * *`),
`scheduled.ts:81-97` (single per-owner try), `db.ts` (`max: 1`).

External claims verified via live docs (Context7): Resend idempotency semantics
and expiry, the 10 req/s team rate limit, the 100/day free tier; Better Auth's
`sendResetPassword` guidance.

## Findings

### F1 — The Idempotency-Key kills the retry path it sits next to

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 5 §3, step 5
- **Detail**: Resend rejects a repeated `Idempotency-Key` carrying a *different*
  payload with `409 invalid_idempotent_request` (and an in-flight one with `409
  concurrent_idempotent_requests`); keys expire after 24h. The plan's retry path
  rebuilds the payload from live DB state, and `runDetect` runs on every 15-minute
  tick immediately before the recap — so the anomaly set, risk scores and activity
  counts routinely change between attempts and the rendered HTML differs. Every
  retry would take a 409 instead of a send, in exactly the case retries exist for.
- **Fix A ⭐ Recommended**: Persist the rendered message on the claim; retries re-send stored bytes
  - Strength: Keeps both guards intact — DB unique key covers the restart, the
    Resend key covers the accepted-then-dropped response — and the payload is
    byte-identical across attempts so 409 never fires.
  - Tradeoff: A retry reports the picture as of the first attempt, not the current one.
  - Confidence: HIGH — explicit in Resend's idempotency-keys reference.
  - Blind spot: `concurrent_idempotent_requests` still needs its own mapping (F2).
- **Fix B**: Drop the Idempotency-Key; rely on the DB claim + attempt cap alone
  - Strength: Simplest; removes the 409 branch entirely.
  - Tradeoff: Reopens the accepted-then-dropped window that produces a real duplicate.
  - Confidence: HIGH on mechanics, LOW that it's the right call.
- **Decision**: FIXED via Fix A — `rendered_message` jsonb column (Phase 1 §3),
  render-once-then-freeze sequencing (Phase 5 §3 step 5), `RenderedEmail` type
  (Phase 4 §3), 409 semantics in Critical Implementation Details, test 5.9.

### F2 — Four documented Resend status codes have no error mapping

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2 — the Resend client
- **Detail**: The contract defined `EmailAuthError` (401) and
  `EmailUnavailableError` (429/5xx/network/unreadable JSON) only. Resend also
  returns `400 invalid_idempotency_key`, `403` (the missing-`User-Agent` case the
  plan itself names), `409` (both variants), and `422`. Routing a permanent 4xx
  into `EmailUnavailableError` would burn all three daily attempts against a
  misconfiguration that can never succeed.
- **Fix**: Third class `EmailRequestError` (non-retryable, carries `status`);
  `sendDailyRecap` marks the row FAILED at the cap; `409
  concurrent_idempotent_requests` maps to `SKIPPED("in_flight")`.
- **Decision**: FIXED — Phase 2 §2 rewritten to three error classes; tests 2.3, 2.8.

### F3 — A sync or detect failure silently cancels the recap for the day

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 §4 — cron wiring
- **Detail**: `scheduled.ts:81-97` awaits `runOwner` and `runDetect` inside one
  try whose catch counts the owner failed and moves on. Placing the recap "as a
  third step inside" it means an expired PAT, a Jira 401 or a Hyperdrive blip
  jumps past the recap entirely — its own inner try/catch never runs. FR-018
  exists for the lead who is *not* at the dashboard, so the email goes silent
  precisely when something is wrong and no banner is visible to them.
- **Fix A ⭐ Recommended**: Sibling per-owner try for the recap + a staleness line in the email
  - Strength: Every reader the recap calls is DB-only; the independence becomes structural.
  - Tradeoff: On sustained failure the email carries stale data, so it must say so.
  - Confidence: HIGH.
  - Blind spot: Whether the email should name the failing integration was an unmade content decision.
- **Fix B**: Keep the nesting and document the gap.
- **Decision**: FIXED via Fix A — sibling `try` with a code sketch (Phase 5 §4),
  Critical Implementation Details paragraph rewritten, `syncState` added to
  `RecapPayload` / builder / renderer as a fourth branch (`lastError` withheld),
  tests 4.5, 4.6, 5.11.

### F4 — Awaiting the reset-password send contradicts Better Auth's guidance

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 — wire `sendResetPassword`
- **Detail**: The plan mandated that a send failure propagate. Better Auth's
  email-password docs say the opposite: *"To prevent timing attacks, avoid
  awaiting the email dispatch directly, using mechanisms like `waitUntil` on
  serverless platforms."* `sendResetPassword` fires only when the user exists, so
  propagation builds an account-enumeration oracle — unknown address returns 200
  instantly, a known one errors or takes a Resend round-trip longer. It also puts
  a third-party call on the auth request path.
- **Fix A ⭐ Recommended**: `ctx.waitUntil` dispatch; log failures server-side; uniform response
  - Strength: Follows the library's documented pattern; constant timing and status.
  - Tradeoff: A failed reset email is invisible to the user.
  - Confidence: HIGH.
  - Blind spot: `ctx` reachability inside the closure from `api/auth/[...all]/route.ts:15` is unverified.
- **Fix B**: Keep propagation, normalize the response to a constant 200 (closes the status channel, not the timing one).
- **Decision**: FIXED via Fix A — Phase 3 §2 rewritten with the reachability check
  called out as verify-first, test 3.3.

### F5 — `daily_recap` cascades off `sprint`, so a project switch can un-dedup the day

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3 — reshape `daily_recap`
- **Detail**: The plan reasoned about `sprint_id` being *created* mid-cycle but
  not *deleted*. `daily_recap.sprint_id` is `ON DELETE CASCADE`
  (`schema.ts:718-720`) and sprint rows are deleted on a Jira project switch
  (`connection-service.ts:405-411`, `jira-store.ts:257`). Switching project at
  10:00 deletes the day's claim row, so the 10:15 tick sends a second email for
  the same local day; every stored recap for that sprint — S-12's history — goes
  with it, while the destructive confirmation promises only "synced history".
- **Fix**: Record as an accepted consequence and widen the confirmation copy.
  Reversing it (nullable `sprint_id`, purge keyed on `recap_day`) undoes a
  decision `change.md` records and belongs to S-12.
- **Decision**: FIXED — accepted consequence recorded in Phase 1 §3; new Phase 6
  change #6 widens `jira-project-editor.tsx` copy; manual row 6.10.

### F6 — No bounce path, no `List-Unsubscribe`, on a brand-new domain

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 / Phase 5 + "What We're NOT Doing"
- **Detail**: `enabled` defaults true and `requireEmailVerification: false`
  (`auth.ts:52`), so a typo'd sign-up address receives a daily email carrying
  ticket titles and member names, with no unsubscribe link. A 200 from Resend
  means accepted, not delivered, so the row reads `SENT` throughout a hard-bounce
  loop — the standard route from "fresh domain deliverability risk" to a suspended
  Resend account.
- **Fix**: `List-Unsubscribe` + `List-Unsubscribe-Post` pointing at
  `/settings/recap`; record the bounce gap as S-12 scope.
- **Decision**: FIXED — headers added to the send (frozen with the bytes), a
  `headers` passthrough on `sendEmail` that cannot clobber `Authorization`, the
  bounce gap under "What We're NOT Doing"; test 2.4.

### F7 — Phase 5's Progress block had fewer rows than Success Criteria bullets

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress` → Phase 5
- **Detail**: Row 5.7 collapsed two distinct bullets (`no_sprint` skip, `enabled:
  false` skip) into one line. The block still parsed, but two separate tests would
  tick together and one could land unwritten.
- **Fix**: Split and renumber.
- **Decision**: FIXED — Phase 5 Progress now maps 1:1; whole-plan re-check passes
  (1: 8+1, 2: 8+0, 3: 6+3, 4: 12+1, 5: 14+2, 6: 9+6), zero stray checkboxes
  outside `## Progress`.

## Note for implementation

Lean Execution and Architectural Fitness passed on the first read and were not
touched by any fix: every phase is load-bearing, DB-as-concurrency-guard matches
how the rest of the repo does idempotency, the divergence guard is discharged
structurally, and the DST reasoning behind `localTimeOfDay` is correct where the
obvious implementation would not be.
