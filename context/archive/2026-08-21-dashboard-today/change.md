---
change_id: dashboard-today
title: Dashboard "Today" — Anomaly Inbox default view + panels, freshness, error banner
status: archived
created: 2026-08-21
updated: 2026-08-21
archived_at: 2026-08-21T21:31:48Z
---

## Notes

Roadmap slice **S-07** — the **north star** (US-01): first end-to-end slice proving the product works. Prereqs S-06 (anomaly engine, done) and F-03 (UI foundation, done).

Scope: open Dashboard "Today" with the **Anomaly Inbox as the default view** (all detected anomalies, each with the 5 FR-014 attributes, sorted by severity → recency — reader `listAnomaliesForSprint` already provides this). Sprint Pulse (burndown, scope changes, per-status distribution), Yesterday's Activity (commits/PRs/reviews/tickets-to-Done), and the Reliability KPI chart (committed vs delivered SP) sit **one click away** behind tabs/progressive disclosure. Per-integration **last-sync freshness timestamp** always visible; **error banner** naming the failed integration when the most recent sync errored (show last cached state, never blank). User can **re-sort** (severity/age/ticket/developer) and **filter** (anomaly type / team member) the inbox.

PRD refs: FR-015, FR-016, US-01 (all acceptance criteria).

Data surfaces already built: `listAnomaliesForSprint` reader (S-06), `sync_state` last-sync timestamp + status/lastError per integration (S-05), synced tickets/PRs/commits/reviews + sprint (S-05), team roster (S-04). All UI must use shadcn/ui (per CLAUDE.md).
