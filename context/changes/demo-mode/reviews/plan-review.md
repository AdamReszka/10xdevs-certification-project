<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Demo mode (S-09 / FR-008)

- **Plan**: `context/changes/demo-mode/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-29
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in plan)
- **Findings**: 2 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | FAIL (F1, F3) | PASS |
| Lean Execution | WARNING (F4) | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL (F2, F5) | PASS |
| Plan Completeness | PASS | PASS |

## Grounding

16/16 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (5 phases, all
Success Criteria bullets matched, one `## Progress` heading, no stray checkboxes).

Verified directly against the code rather than by sub-agent (surface small and
already familiar from the frame):

- `owner_id` is `.unique()` on `github_credential:212`, `jira_credential:231`,
  `jira_project:271` — the `is_demo`-column rejection holds.
- 25/25 owner FKs are `ON DELETE CASCADE` — reset-by-cascade holds.
- `enumerateOnboardedOwners` (`scheduled.ts:52-58`) is the single gate for sync,
  the S-23 measurement sweep AND `sendDailyRecap` (`scheduled.ts:100-146`), so one
  `isNull(user.demoOf)` really does close all three paths.
- `detectAnomalies`' reconcile resolves any ACTIVE row whose `dedupKey` is not
  re-detected (`detect.ts:126-135`) — the engine-produced-anomalies decision holds.
- `session.user.id` appears 53 times across exactly 22 files; Phase 3's two lists
  (11 demo-aware + 11 always-real) account for all 22.
- No client component computes relative time from the browser clock — one
  exception, see F5.
- Migration `0017_*` is the correct next number (`0016_flashy_newton_destine.sql`
  is the tip).

## Findings

### F1 — /settings/team is demo-aware but its writes are classified always-real

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §1 vs §2
- **Detail**: Phase 3 split call sites by directory. `settings/team/page.tsx` is
  demo-aware, `src/app/(app)/setup/**` always-real — but the page renders
  `RosterEditor`, which imports NINE server actions from
  `@/app/(app)/setup/team/actions` (`roster-editor.tsx:27`). In demo the page
  READS the demo roster and every button WRITES against the real owner:
  `saveRoster` refuses outright (`roster-store.ts:327-341`, `UnknownMemberError`
  rejects an id outside the caller's set), `importRosterAction` calls the REAL
  GitHub/Jira APIs from the demo surface (breaking US-02's "no external API
  call"), and `confirmAvailabilityAction` mutates the real team while the banner
  says "demo". Root cause is the classification rule, not the list.
- **Fix A ⭐ Recommended**: Classify by action, not by path.
  - Strength: Preserves "fully editable except integrations"; reuses the `syncNow`
    refusal pattern already specified in the same phase.
  - Tradeoff: `setup/team/actions.ts` serves both workspaces, so the wizard's own
    pinning must be explicit.
  - Confidence: HIGH.
  - Blind spot: `mergeMembersAction` / `deleteMemberAction` owner scoping not traced end to end.
- **Fix B**: Render `RosterEditor` read-only in demo.
  - Strength: Smallest diff.
  - Tradeoff: Contradicts the brief's editability decision and thins US-02.
  - Confidence: HIGH.
  - Blind spot: No read-only mode exists today.
- **Decision**: FIXED via Fix A — new Phase 3 §1b pins the six roster actions to
  `resolveWorkspace()` and the two import actions to `requireRealWorkspace()` +
  demo refusal; §2's file list amended; criteria 3.10 / 3.11 added.

### F2 — resolveWorkspace() on getOptionalSession() erases the per-action auth guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 (resolver contract), Phase 3 §1–§2
- **Detail**: Phase 1 specified the resolver on `getOptionalSession()` and listed
  three fallbacks, none for "no session". In this codebase the `(app)` layout
  guards pages but not Server Actions — all 25 actions call `requireSession()`
  themselves. `getOptionalSession` returns `null` for a missing session AND for a
  Hyperdrive blip (`auth.ts:181-193`). An implementer following Phase 3 literally
  deletes the `session.user.id` read — and criterion 3.8's grep gate rewards
  exactly that — leaving unauthenticated actions running with `ownerId: undefined`.
- **Fix**: Build `resolveWorkspace()` / `requireRealWorkspace()` on
  `requireSession()`; state it in the Phase 1 contract; add the unauthenticated
  resolver test; add a Phase 3 criterion that every `"use server"` file keeps one
  auth guard per exported action.
- **Decision**: FIXED — Phase 1 §2 contract rewritten with the rationale and the
  25 call sites named; criteria 1.7 and 3.12 added.

### F3 — Fixture omits sprint_measurement and team_day_off, so two Today panels are empty

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1 (fixture table list)
- **Detail**: The fixture enumerated 14 tables. Dashboard "Today" renders
  `ReliabilityKpi` and `VelocityEstimatePanel` off `getSprintMeasurement` /
  `listSprintMeasurementsForOwner` (`dashboard/page.tsx:6,9,22-24`), and the
  Availability headline reads `team_day_off`. Neither table was listed, and the
  sweep that would write measurements is the cron path Phase 2 correctly excludes
  — so nothing ever populates them. Two of the four FR-016 panels would open on
  their empty state, and FR-024's estimate stays withheld below two closed sprints.
- **Fix**: Add ≥2 finalized `sprint_measurement` rows (one with absence-reduced
  adjusted capacity so FR-023's normalisation is visible) plus `team_day_off`
  rows; assert both panels render numbers in Phase 4's manual list.
  - Strength: Restores the panels at fixture cost only — no new code path.
  - Tradeoff: More fixture to tune; measurement rows must agree with ticket SP.
  - Confidence: HIGH — verified against the page's actual imports.
  - Blind spot: Whether `listSprintMeasurementsForOwner` needs matching closed
    `sprint` rows was not traced.
- **Decision**: FIXED — Phase 2 §1 table list and rationale extended; criterion 4.12 added.

### F4 — Phase 5 keeps a CLI whose reason to exist Phase 4 removes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 5 §3
- **Detail**: Phase 2 already moves the dataset into `src/lib/demo/fixture.ts` —
  that is what closes the parallel-fixture class. Phase 5 then added
  `scripts/seed-demo.ts`, a new `tsx` devDependency and an owner-resolution path
  to reach a loader the app now exposes behind a button. `db:seed:demo` is
  referenced nowhere outside `package.json` and this change's own documents — not
  CI, not Playwright, not `docs/`. (`tsx` is genuinely required if the script
  stays: Node 24's native type stripping does not resolve the `@/*` alias that
  `load.ts` and `crypto.ts` rely on.)
- **Fix A ⭐ Recommended**: Delete the script and the npm script outright.
  - Strength: One fewer devDependency and entry point; the "db:seed:demo deletes
    real credentials" hazard disappears rather than being rewritten.
  - Tradeoff: Local seeding needs sign-in + two clicks; a future Playwright
    fixture calls `loadDemo` directly (it takes an injected `db`).
  - Confidence: MED — nothing references it today, but E2E work is not planned yet.
  - Blind spot: An unrecorded local habit relying on the script.
- **Fix B**: Keep Phase 5 §3 as written.
  - Strength: Sign-in-free seed for local work and future test setup.
  - Tradeoff: Carries `tsx` plus a second entry point forever.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 5 §3 rewritten as deletion; "What We're
  NOT Doing" and Phase 2's manual row updated; criteria 5.7 / 5.8 replaced.

### F5 — The frozen-clock survey is slightly optimistic about the client

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis — Key Discoveries; Phase 5 §1
- **Detail**: "The only `new Date()` under `src/components/` is a default
  parameter" is literally true but reads as harmless. That default is evaluated
  inside a `"use client"` component — `recap-settings-form.tsx:1,120` calls
  `describeLastSend(lastRecap)` with no `now` — and it feeds a real comparison
  (`now.getTime() - claimedAt >= CLAIM_TTL_MS`, `recap-settings-view.ts:47-49`).
  It is inert in demo only because that branch is `PENDING`-only and Phase 5
  already requires a terminal `send_status` — a coupling specified for a different
  reason and therefore currently accidental.
- **Fix**: Restate the discovery precisely and record in Phase 5 §1 that the
  terminal `send_status` is ALSO what keeps the browser clock out of the demo, so
  a `PENDING` fixture row is a frozen-clock regression.
- **Decision**: FIXED — both passages rewritten.
