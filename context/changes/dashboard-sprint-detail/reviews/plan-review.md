<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-10 Dashboard "Sprint Detail"

- **Plan**: `context/changes/dashboard-sprint-detail/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-22
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 3 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) |
|-----------|---------------------|
| End-State Alignment | FAIL (F1, F3) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F8) |
| Blind Spots | FAIL (F2, F4) |
| Plan Completeness | WARNING (F5, F6, F7) |

Two FAILs map to RETHINK in the rubric; called REVISE deliberately — the
three-reducer architecture held up under verification and every fix was additive.

## Grounding

17/17 paths ✓, 11/12 symbols ✓ (`weekdayInTimeZone` exists at `cadence.ts:50` but is
NOT exported — see F8), line refs spot-checked accurate, brief↔plan ✓,
Progress↔Phase structure ✓ (one `## Progress`, six matching phase headings, no stray
checkboxes in phase bodies). `docs/reference/contract-surfaces.md` absent — check skipped.

## Cross-cutting note

F1 and F3 shared a root cause: `scripts/seed-dashboard.mjs` was the only thing making
those surfaces work. Every automated and manual gate in the plan could go green on a
feature that is empty for real users. The F1 fix includes an integration assertion
driven by the sync path rather than the seed.

## Findings

### F1 — sprint.committedSp / completedSp are never written

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 §4 (Surface F), Phase 2 §3 (M1), Progress 2.5 / 5.9
- **Detail**: `roster-store.ts:435-465` omits both columns from the sprint insert and
  its conflict-update; `run-sync.ts` never updates the sprint row. The only writer in
  the repo is `scripts/seed-dashboard.mjs:78` (40/18). Reliability KPI would render its
  empty state permanently for every real owner, Sprint Pulse would have no ideal line,
  and Phase 6 would tell the roadmap the KPI "ships here".
- **Fix A ⭐ Recommended**: Derive both scalars in the Jira sync.
  - Strength: inputs already land every cycle; no new network read; also repairs
    `scope-creep.ts:13` and `sprint-at-risk.ts:83` reading `?? 0`.
  - Tradeoff: new write path in Phase 1; `committedSp` tracks mid-sprint estimate edits.
  - Confidence: HIGH — verified every writer.
  - Blind spot: whether "committed" should freeze at sprint start (needs a
    first-sync-wins guard).
- **Fix B**: Cut Surface F from S-10, derive only the burndown baseline.
- **Decision**: FIXED via Fix A — new Phase 1 §3. Correction applied during the fix:
  aggregate over the `jiraTicket` table inside the existing transaction, **not** over
  the in-memory `issues` array, because `searchSprintIssues` is an incremental delta
  pull (`updatedSince`). Also clarified that the burndown baseline is Σ sprint-ticket SP,
  deliberately *not* `committedSp` (they diverge exactly when scope crept), and rewrote
  Progress 2.5 accordingly.

### F2 — Sprint Detail has no null-sprint path; the route crashes

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 vs. "What We're NOT Doing"
- **Detail**: The scope exclusion conflated "sprint exists but is CLOSED" (correctly
  handled) with "no sprint row at all". `getActiveSprintRow` returns
  `SelectSprint | null` (`sprint.ts:22,36`); Today guards it at `page.tsx:31-33`.
  Phase 4 fanned out `getTicketAging`/`getBurndownSeries` — both take `sprintId` —
  with no guard. `middleware.ts` has no setup gate and Phase 4 adds the nav link
  unconditionally, so a signed-up user with zero setup reaches it.
- **Fix**: Mirror `dashboard/page.tsx:31-33` — resolve the sprint first, render the
  empty state when null, run only the sprint-independent reads.
- **Decision**: FIXED — "Null-sprint guard (F2)" added to Phase 4 §1, the
  "NOT Doing" bullet reworded to separate CLOSED from null, plus manual criterion 4.11.

### F3 — Sprint Pulse's per-status ticket distribution has no data source

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 5 §2 and §5
- **Detail**: FR-016 requires a per-status ticket distribution. Phase 5 §2 claimed it
  was "derived from the same reducer output", but M1's contract carried no category
  counts; M3 carries `currentCategory` but excludes DONE tickets, and Phase 5 §5 never
  added `getTicketAging` to the page's `Promise.all` anyway.
- **Fix**: Extend M1 with `byCategory: Record<CategoryKey, number>`, folded from the
  sprint-tickets query `getBurndownSeries` already runs — no extra round-trip.
- **Decision**: FIXED — M1 contract extended, Sprint Pulse points at
  `BurndownSeries.byCategory`, `Σ byCategory === ticket count` added to the unit tests,
  and the ideal line is omitted (not drawn at 0) when `committedSp` is null.

### F4 — Nullable toCategory / changedAt unhandled in both folds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (`foldTimeInStatus`) and §3 (`buildBurndownSeries`)
- **Detail**: `fromCategory`/`toCategory`/`changedAt` are nullable (`schema.ts:564-566`),
  as is `jiraTicket.currentCategory` (`:534`); `run-sync.ts:504-506` writes
  `categoryOf.get(...) ?? null`, so any status unmapped under FR-005 lands NULL.
  Unspecified, this makes `foldTimeInStatus` write `byCategory[null]` and lets
  `buildBurndownSeries` silently never burn a ticket completed through an unmapped
  status. The plan's own stated risk area, and the one input case its test list omitted.
- **Fix A ⭐ Recommended**: Drop null-`changedAt` transitions; accrue null categories to
  an `UNKNOWN` bucket, consistent with M1's UNKNOWN track and M2's UNKNOWN row.
  - Tradeoff: a sixth bucket needs a display decision in the aging report.
  - Confidence: HIGH — nullability verified at schema and write site.
  - Blind spot: whether an unmapped status deserves its own lead-facing warning.
- **Fix B**: Filter null-category transitions at the reader layer.
- **Decision**: FIXED via Fix A — "Null handling (F4), load-bearing" added to Phase 2 §2
  and mirrored in §3; `CategoryKey = StatusCategory | "UNKNOWN"`; aging report renders
  the sixth column **only when some ticket has a non-zero UNKNOWN value**, so the
  well-mapped case keeps FR-017's five columns; both rules added to the unit-test lists.

### F5 — Commit-stats cap is per-repo, not per-cycle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2; brief "Phases at a Glance" row 1
- **Detail**: The enrichment sits inside `for (const repo of repos)` (`:269-283`), the
  same place `maxPrs` is applied (`:229`) — whose own "per-cycle" comment (`:81-90`) is
  already loose for the same reason. Real ceiling is 30 × N, so 5 repos moves a cycle
  from ~310 to ~460 subrequests, not the ~340 the framing implied. The brief leaned on
  "cap 30" as *the* subrequest mitigation.
- **Fix**: Name the constant `DEFAULT_MAX_COMMIT_STATS_PER_REPO`, record the N-repo
  arithmetic in its comment, and verify against the Workers subrequest limit.
- **Decision**: FIXED — in plan Phase 1 §2 and in the brief's phase table; noted that if
  the limit is tight the fix is a shared budget decremented across repos, not a smaller
  per-repo cap. Also clarified "commit 31+" in the tests means per repo.

### F6 — Progress 5.10 has no matching Success Criteria bullet

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 Manual Verification vs. Progress 5.6-5.10
- **Detail**: Performance Considerations defers the `max:1` pool measurement to "Phase 5
  manual verification", and Progress carries it as 5.10, but the phase body listed only
  four manual bullets.
- **Fix**: Add the latency bullet to Phase 5's Manual Verification.
- **Decision**: FIXED.

### F7 — Activity Matrix date range unspecified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1
- **Detail**: `getActivityRollup` takes an explicit `{ from, to }`; Phase 5 pins its
  range precisely, Phase 4 did not. Different choices give different day axes and
  interact with the 10-inch-tablet column budget.
- **Fix**: Pin to `sprintStart → min(sprintEnd, now)`, matching M1's day axis.
- **Decision**: FIXED — "Matrix range (F7)" added to Phase 4 §1.

### F8 — Time-zone fallback duplicated rather than shared

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1
- **Detail**: `day-bucket.ts` was told to "mirror" `weekdayInTimeZone`'s UTC fallback.
  Accurate — `cadence.ts:50` declares it without `export` — but mirroring leaves two
  copies of the same try/catch that can drift, with the DST rationale living only in
  `cadence.ts:6-11`.
- **Fix**: Export a shared zone-fallback helper and have both consume it.
- **Decision**: FIXED — Phase 2 §1 now specifies extracting/exporting `safeZone`
  (or an equivalent formatter wrapper) with `cadence.test.ts` staying green.
