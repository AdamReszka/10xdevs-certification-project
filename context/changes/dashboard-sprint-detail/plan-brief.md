# S-10 Dashboard "Sprint Detail" — Plan Brief

> Full plan: `context/changes/dashboard-sprint-detail/plan.md`
> Frame brief: `context/changes/dashboard-sprint-detail/frame.md`
> Research: `context/changes/dashboard-sprint-detail/research.md`

## What & Why

S-10 keeps its one-slice framing because the five read surfaces genuinely collapse to three reducers, two of which are shared across surface-pairs — splitting by dashboard would build each reducer twice. But the scope is materially larger than the roadmap states: the tabs primitive is net-new, the Activity Matrix's line-count column has no data, and no reader has ever touched `jiraStatusHistory`. This plan delivers FR-017 (aging report, activity matrix, per-technology sub-burndowns) plus the FR-016 remainder S-07 deferred (Sprint Pulse, Yesterday's Activity, Reliability KPI).

## Starting Point

The read-side convention is uniform and easy to extend: `(db, ownerId, …) → serializable` readers in `src/lib/*`, rendered by server components under `src/app/(app)/`. The roadmap's flagged top risk — a status-history backfill — **does not exist**: `run-sync.ts:493-513` already writes every transition incrementally and idempotently. Two smaller gaps do exist and were missed by the roadmap: per-commit `additions`/`deletions` columns exist but are never written, and the owner's Jira IANA time zone is fetched on every credential validation but never persisted. Today is a single-column page with the Anomaly Inbox; there is no tabs primitive and no Reliability KPI, contrary to what the roadmap records for S-07.

## Desired End State

A lead opens `/dashboard` and lands on the Anomaly Inbox, with Sprint Pulse, Yesterday's Activity, and Reliability KPI each one click away. They click through to `/dashboard/sprint-detail` and see which tickets have stopped moving and where their time went, who did what on which day, and how each technology track is burning down — with unattributed work shown as `UNKNOWN` rather than silently dropped.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Slice shape | One slice, three shared reducers | Two reducers each serve two surfaces; splitting by dashboard duplicates them | Frame |
| Status-history backfill | Not needed | Sync already writes full transitions, deduped on a NOT-NULL key | Frame |
| Charting | shadcn `chart` + Recharts, client-only leaves | OKLCH `--chart-1..5` tokens already exist in both themes; `radix-ui` already installed | Research |
| Commit line metric | Extend the sync, forward-only, cap 30/cycle | Columns already exist; no migration, no backfill | Research |
| Unattributed SP | Explicit `UNKNOWN` track | Makes `Σ byTrack === total` hold and the lossy value-join visible | Research |
| Between-sprints | Render on the last sprint | Matches Today and the detection pipeline; label only | Research |
| D + E placement | Retrofit Today with tabs | Only option literally matching FR-016; closes the S-07 debt | Plan |
| Reliability KPI | In scope for S-10 | Data is already in `sprint` scalars; marginal cost near zero once tabs exist | Plan |
| Time zone | New `jira_project.time_zone` column, written each sync | `/myself` already returns it and `weekdayInTimeZone` already consumes it — only persistence was missing | Plan |
| Matrix rendering | Metric switcher, one number per cell | Four values × 14 columns is unreadable at the 10-inch NFR floor | Plan |
| Aging rendering | Five numeric columns | Exactly what FR-017 describes; avoids the design risk FR-017 deferred | Plan |
| Testing | Unit + integration + E2E | The retrofit touches the shipped north-star route — the biggest regression risk in the slice | Plan |

## Scope

**In scope:** three reducers (M1 SP-over-time, M2 per-dev-per-day rollup, M3 time-in-status); the `/dashboard/sprint-detail` route with aging report, activity matrix, sub-burndowns; the Today retrofit with Sprint Pulse, Yesterday's Activity, Reliability KPI; `tabs` + `chart` primitives; per-commit churn in the sync; `jira_project.time_zone`; seed extension; E2E coverage.

**Out of scope:** per-status heatmap (FR-017 defers to phase 2); churn backfill; `timestamptz` migration of sprint dates; a "no active sprint" gate; inter-sprint KPI history (S-12); active-link nav styling; any second connection pool or caching layer.

## Architecture / Approach

```
sync ──► jira_project.time_zone          github_commit.additions/deletions
             │                                        │
             ▼                                        ▼
   ┌─────────────────── src/lib/dashboard/ ───────────────────┐
   │  M1 burndown.ts   M2 activity.ts   M3 aging.ts           │  owner-scoped readers
   │  + pure folds: burndown-series / activity-grid /         │  (one getDb, max:1)
   │    time-in-status / day-bucket   (+ unit tests)          │
   └──────────┬───────────────────────┬───────────────────────┘
              │                       │
   /dashboard (tabs)          /dashboard/sprint-detail (tabs)
   Inbox · Pulse ·            Aging · Matrix · Sub-burndowns
   Yesterday · KPI
```

Server components fetch and serialize; one `"use client"` organism per interactive surface; pure sort/aggregate logic in colocated non-React `.ts` files. Recharts appears only in client leaves.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data prerequisites | `time_zone` column + write; per-commit churn in sync | Subrequest budget on first-sync bursts — mitigated by dedup-aware skip + cap 30 |
| 2. Three reducers | M1/M2/M3 readers + pure folds + tests | Time math (re-opens, DST, open final interval) is where silent wrongness hides |
| 3. Primitives | `tabs` + `chart`, chart theming convention | Recharts bundle size / Workers build |
| 4. Sprint Detail route | Aging report, activity matrix, sub-burndowns | Readability at the 10-inch tablet floor |
| 5. Today retrofit | Sprint Pulse, Yesterday's Activity, Reliability KPI | Regression on the shipped north-star surface |
| 6. E2E + closeout | Seed extension, Playwright specs, roadmap update | Seed must produce a coherent multi-source story |

**Prerequisites:** S-05 (sync) and S-07 (Today) — both done. Local Supabase at `:54322` for migration and integration tests.
**Estimated effort:** ~4–6 sessions across 6 phases; Phase 2 and Phase 4 are the largest.

## Open Risks & Assumptions

- **The `max:1` pool serializes every reducer query.** Phase 5's Today page has the heaviest fan-out. Assumed acceptable at ≤10 developers; measured during Phase 5 manual verification. Fix if needed is pre-aggregation, never a second pool.
- **Commit churn is forward-only.** Pre-existing commits keep NULL permanently — the matrix must render `—`, not `0`, or it lies about historical work.
- **Both cross-system joins are lossy by construction.** GitHub logins and Jira account IDs are nullable, unconstrained value joins; the `UNKNOWN` buckets are the honest answer, not a stopgap.
- **The Today retrofit modifies working S-07 code.** The `<AnomalyInbox>` element and its props stay byte-identical; only its container changes.
- **The PR leg of M2 has no supporting index.** Range-bounded scan is fine at target scale; an index is the fix if it isn't.

## Success Criteria (Summary)

- The lead can see, on one screen per dashboard, which tickets stopped moving and where their time went, who worked when, and how each track is burning down.
- The Anomaly Inbox still opens first on `/dashboard` and behaves exactly as it did before the retrofit.
- Every reducer is proven owner-scoped by an integration test seeding two owners — the PRD isolation guardrail has no RLS behind it.
