---
change_id: dashboard-sprint-detail
title: Dashboard "Sprint Detail" — aging report, activity matrix, sub-burndowns (+ deferred S-07 panels)
status: impl_reviewed
created: 2026-08-21
updated: 2026-08-22
archived_at: null
---

## Notes

S-10 (roadmap). Dashboard "Sprint Detail" surface:
1. Workflow aging report — tickets sorted by time-since-last-movement, cumulative time-in-each-status shown inline (per-status heatmap deferred to phase 2 per FR-017).
2. Team Activity Matrix — Developer × Day with commit / line / PR / review counts.
3. Per-technology sub-burndowns — SP burndown filtered by frontend / backend / mobile / QA track.

Also absorbs the two panels deferred from S-07 (frame.md 2026-08-21):
- Sprint Pulse burndown
- Yesterday's Activity (per-dev commit/PR/review activity)

Both are new read-side aggregators in the same family as the Activity Matrix and sub-burndowns, so built here rather than duplicated in the north-star slice. Reliability KPI stays in S-07.

PRD ref: FR-017. Prereqs S-05, S-07 (both done).

Key risk (roadmap): aging report needs cumulative time-in-each-status per ticket — verify S-05's schema captures full jiraStatusHistory transitions (not just current status) before writing queries, else a backfill migration is needed. Burndown series must be derived from jiraStatusHistory transitions × SP (the `sprint` row holds only committedSp/completedSp snapshots, not a daily series).

## Scope extension (2026-08-22)

Phases 7–8 add a `/settings` shell with a **Connections** tab: both integrations'
state and sync health in one place, a live "Test connection", "Sync now" (wiring
the already-built `syncNow()` action, which had no caller), editing the monitored
repos / Jira project without re-entering the token, and a bounded sync-attempt
history.

Requested by the owner after hitting the gap while testing S-10: the setup wizard
connects GitHub and Jira, but nothing links back to those pages afterwards, so a
failing integration surfaces only as a banner with no route to any detail.

Thematically this is FR-002/FR-003/FR-011, not S-10's FR-016/FR-017. It ships
here for delivery reasons, and the roadmap says so rather than back-filling the
justification. `sync_state.last_error` stays off the client (S-07 impl-review F2);
the surface classifies `status` instead and offers a live re-validation.

---

Both halves of that risk resolved during planning: the backfill is NOT needed (`run-sync.ts:493-513` already writes every transition idempotently), and the `sprint` row does not in fact hold committedSp/completedSp snapshots at all — nothing but the demo seed writes those columns, so S-10 adds the derivation to the sync (plan review F1).
