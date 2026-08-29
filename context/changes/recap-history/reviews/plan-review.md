<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-12 Recap History

- **Plan**: `context/changes/recap-history/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-29
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed in the plan)
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

18/18 paths ✓, 9/9 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓
(42 criteria / 42 rows before triage; 45 / 45 after).

Verified independently: no query filters `daily_recap` by `sprint_id`, so
dropping `daily_recap_owner_sprint_idx` is safe; `recap_settings_owner_uq`
exists, so the webhook's upsert target is valid; `isPublic`'s prefix semantics
(`middleware.ts:29-33`) do open `/api/webhooks/resend`; the S-23 sweep
(`scheduled.ts:129-136`) runs BEFORE the recap and over every sprint row, so the
active sprint always has a `sprint_measurement` row by the time a fourth step
would read it.

## Findings

### F1 — Phase 4 never touches the only read/write path for `recap_settings`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment / Plan Completeness
- **Location**: Phase 4 §7 "Tell the owner"
- **Detail**: §7 listed only the page, the form and the view sibling.
  `src/lib/recap-settings.ts` is the only path to that table:
  `getRecapSettings` (`:47-52`) selects three columns and `RecapSettings`
  (`:26-31`) has three fields, so the page cannot read the new columns without
  a second query (the fan-out `lessons.md` #3 rejects); `saveRecapSettings`
  (`:76-93`) sets only sendHour/sendMinute/enabled/updatedAt, so criterion 4.20
  ("re-enabling clears the explanation") had no backing change. The clearing
  semantics were also undecided.
- **Fix A ⭐ Recommended**: Add `recap-settings.ts` to Phase 4 §7 — widen
  `RecapSettings` + the select list, clear both columns only on a save that sets
  `enabled: true`, keep `sendDailyRecap`'s behaviour unchanged.
  - Strength: One file, both halves; keeps the page's single `Promise.all`.
  - Tradeoff: Widens a type the cron also consumes.
  - Confidence: HIGH — read both functions in full; the change is mechanical.
  - Blind spot: Whether the send path should also read `disabled_reason` (it need not).
- **Fix B**: Clear from the webhook side only, never on save. Drops criterion 4.20.
- **Decision**: FIXED — Fix A. Phase 4 §7 rewritten; new criterion 4.11 and a
  Testing Strategy line for the clear-on-re-enable semantics.

### F2 — The purge count reaches no log; the cycle result is discarded

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 + Progress 2.11
- **Detail**: `worker.ts:46` is `ctx.waitUntil(runScheduledSync(env, ctx))` — the
  returned `ScheduledSyncResult` is discarded — and `scheduled.ts` logs only
  inside its three catch blocks (`:117`, `:132`, `:154`). Nothing writes a
  success line, so manual row 2.11 ("a full cron cycle logs a purge count")
  could not pass, and the first irreversible deletion in the repo would ship
  with no way to answer "what did it delete last night?".
- **Fix A ⭐ Recommended**: `console.info` inside the purge step when
  `deleted > 0`, carrying `{ ownerId, cutoff, deleted }`.
  - Strength: Makes 2.11 pass; a DayKey and an integer carry no PII; rides
    `wrangler tail` like the existing error lines.
  - Tradeoff: A per-owner line on cycles where rows fall off (bounded by ≤50 owners).
  - Confidence: HIGH — verified `worker.ts` discards the return value.
  - Blind spot: None significant.
- **Fix B**: Observe-only first deploy behind a flag, then enable the delete.
- **Decision**: FIXED — Fix A. Phase 2 §2 gained the logging contract with the
  `worker.ts:46` evidence.

### F3 — The sandbox as specified makes the recap's links inert

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 vs. Progress 3.12
- **Detail**: `render.ts:131` emits a plain `<a href="…">` with no `target`, so a
  click is a top-level navigation — blocked by a sandbox carrying neither
  `allow-top-navigation-by-user-activation` nor `allow-popups`. The deep-link is
  FR-014's fifth attribute, and the manual row asserts the links are clickable.
- **Fix**: `sandbox="allow-popups allow-popups-to-escape-sandbox"` plus
  `<base target="_blank">` injected into the `srcDoc` head; `allow-scripts` and
  `allow-same-origin` stay off, with the reasoning in the header comment.
- **Decision**: FIXED.

### F4 — The manual checklist and the sweep lived in the severable phase

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §8 + Phase 4's Implementation Note
- **Detail**: `MANUAL-CHECKLIST.md`, `manual-test-sweep.mjs`, the roadmap update
  and `change.md` were all Phase 4 work, while the plan states twice that FR-019
  is met at the end of Phase 3 and Phase 4 is severable. Cutting Phase 4 would
  leave the change with no checklist while phases 1–3 carry six manual rows.
- **Fix**: New Phase 3 §7 creates the checklist for phases 1–3; Phase 4 §8
  becomes an append of the operator steps and two webhook rows.
- **Decision**: FIXED.

### F5 — A forged webhook request still costs a Hyperdrive pool

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §4 "The route"
- **Detail**: The contract fixed the order (secret → verify → parse → act) but
  not where `getDbWithPool` is called. Copied literally from `scheduled.ts:92`
  the handle opens at the top, so every unauthenticated POST to the repo's only
  public endpoint costs a connection before the signature is checked.
- **Fix**: State that the pool is acquired only after `verifyResendSignature`
  returns ok, and that the 401/500 paths return before any database work.
- **Decision**: FIXED.

### F6 — The schemaVersion guard was discovered but never planned

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries #1 vs. Phase 3 §2
- **Detail**: The discovery says the detail view "must not assume the current
  shape without checking it", but no phase contract or criterion covered the
  check — and the detail page does read `payload.sprint` for its header facts.
- **Fix**: Read payload-derived header facts only when
  `payload.schemaVersion === RECAP_SCHEMA_VERSION`, else fall back to the row's
  own columns; new criterion 3.3.
- **Decision**: FIXED.

### F7 — The purge only reaches owners the cron enumerates

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Key Discoveries / Open Risks
- **Detail**: `enumerateOnboardedOwners` (`scheduled.ts:58-66`) requires a
  `jira_project` AND a `github_credential`, demo excluded. An owner who
  disconnects GitHub keeps every stored recap forever. Same fail-safe direction
  as the two risks the plan already named, and bounded, but unstated.
- **Fix**: Recorded as a third fail-safe case in Key Discoveries and in the
  brief's Open Risks.
- **Decision**: FIXED.
