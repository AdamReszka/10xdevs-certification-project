---
change_id: dashboard-sprint-detail
title: Dashboard "Sprint Detail" — aging report, activity matrix, sub-burndowns (+ deferred S-07 panels)
status: planned
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
