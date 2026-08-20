<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Data Sync Engine

- **Plan**: context/changes/data-sync-engine/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria (all phases): unit 131 ✓, integration 30 ✓, typecheck ✓,
lint ✓, `next build` ✓, `build:cf` ✓, `wrangler deploy --dry-run` ✓ (bundle carries
both the OpenNext `fetch` and the `scheduled` cron handler). Manual criteria
1.5/2.4/3.5/4.6/5.6/5.7/5.8 signed off by the user.

Changed-file set matches the plan; the only file outside the plan's list is
`drizzle.config.ts` (the user-requested `db:migrate`→local default), documented in
the Phase 1 commit — not scope creep.

## Findings

### F1 — GitHub PR cap overflow does not drain on the next cycle

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/integrations/sync/run-sync.ts:263 (`pulls.slice(0, maxPrs)`)
- **Detail**: The plan's Critical Implementation Details say "the cursor (`since` / `jiraHistoryCursor`) lets a backlog drain across multiple cycles." For GitHub the cap slices `pulls` to the `maxPrs` newest-updated PRs and ONLY those are written; then `finalizeSyncState` stamps `lastSuccessfulSyncAt = now`. Next cycle uses `since = now`, so any PR beyond the cap that isn't updated again is never listed — it is NOT re-fetched next cycle, contradicting the "drains across cycles" claim. It reappears only when it next updates. Practically low-risk: PRs are processed newest-updated-first and >`maxPrs`(30) PRs updated within one 15-min window is unlikely for a 3–10-person team, but the behavior diverges from the stated end-state.
- **Fix A ⭐ Recommended**: Record the limitation explicitly (extend "What We're NOT Doing" / a code comment): the per-cycle PR cap is a safety valve; overflow waits for the PR's next update, not the next cycle.
  - Strength: Zero code risk; honest about actual behavior at MVP scale where the cap is essentially never hit.
  - Tradeoff: Leaves the (rare) overflow-starvation edge unfixed.
  - Confidence: HIGH — matches the team's small-scale target and the existing MVP-limitation documentation style.
  - Blind spot: A repo with a burst of >30 simultaneously-touched PRs would under-sync until they re-update.
- **Fix B**: When `pulls.length > maxPrs`, hold the GitHub freshness cursor back to the oldest processed PR's `updatedAt` instead of `now`, so the next cycle re-lists the overflow.
  - Strength: Actually realizes cross-cycle drain.
  - Tradeoff: More cursor bookkeeping (GitHub currently reuses `lastSuccessfulSyncAt` as the single cursor for both commits and PRs; commits would need a separate cursor to avoid re-scanning), and some PR re-processing (idempotent, so only wasted subrequests).
  - Confidence: MEDIUM — correct but adds state the MVP deliberately kept minimal.
  - Blind spot: Interaction with the commit `since` (shared cursor) needs splitting.
- **Decision**: FIXED (Fix A) — documented in `run-sync.ts` `DEFAULT_MAX_PRS_PER_SYNC` comment + plan "What We're NOT Doing".

### F2 — Jira status history relies on the embedded (truncatable) changelog

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/jira.ts (`searchSprintIssues`, `expand=changelog`) → parseStatusHistory
- **Detail**: `search/jql?expand=changelog` embeds each issue's changelog, but Jira caps the embedded histories for issues with very long change logs (the dedicated `/issue/{key}/changelog` endpoint is the fully-paginated source). For a ticket with an unusually long in-sprint history, the earliest status transitions could be missed in `jira_status_history`. Acceptable for MVP sprint-scoped tickets (short histories) and the plan chose `expand=changelog` deliberately; worth revisiting if S-06 aging reports look incomplete.
- **Fix**: Note the embedded-changelog truncation as a known limitation; if aging accuracy demands it later, fall back to per-issue `/changelog` pagination for issues whose embedded changelog reports `total > returned`.
- **Decision**: SKIPPED — accepted as a known MVP limitation; revisit if S-06 aging looks incomplete.

### F3 — Custom worker `fetch: generated.fetch` depends on OpenNext not using `this`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture (Reliability)
- **Location**: src/worker.ts:33 (`const fetchHandler = (generated as …).fetch`)
- **Detail**: The generated OpenNext default export is an object literal whose `fetch` method does not reference `this`, so passing the method reference detached works (verified via `wrangler --dry-run` bundle). If a future OpenNext version makes `fetch` `this`-dependent, the detached reference would break subtly.
- **Fix**: Wrap defensively — `fetch: (req, env, ctx) => generated.fetch(req, env, ctx)` — to survive a future `this`-dependent generated handler.
- **Decision**: FIXED — `src/worker.ts` now calls through `openNext.fetch(...)` keeping the receiver.

### F4 — JQL built via string interpolation (safe today, not parameterized)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: src/lib/jira.ts (`searchSprintIssues`, `jql = \`project = "${projectKey}" AND sprint = ${sprintId}\``)
- **Detail**: `projectKey` and `sprintId` are interpolated into the JQL string. Both come from authoritative, owner-scoped DB values written from Jira's own validated project/sprint lists during setup (`projectKey` is Jira's `[A-Z][A-Z0-9]+` key; `sprintId` is `Number(...)`), not user free-text, and all data is single-tenant per account — so there is no cross-tenant injection surface. Flagged only because it is unparameterized string-built query construction.
- **Fix**: Leave as-is (values are authoritative and owner-scoped); optionally assert `sprintId` is a finite number and `projectKey` matches `/^[A-Z][A-Z0-9]+$/` before interpolation as defense-in-depth.
- **Decision**: SKIPPED — values are authoritative + owner-scoped; no cross-tenant injection surface.
```
