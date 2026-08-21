---
change_id: anomaly-detection-engine
title: Anomaly detection engine — detect all 8 anomaly types with default thresholds
status: impl_reviewed
created: 2026-08-20
updated: 2026-08-21
archived_at: null
---

## Notes

Roadmap slice **S-06** (Stream A, toward north-star S-07). Prereq S-05 (data-sync-engine) is done.

Scope: detect all 8 anomaly types (`PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC`) by correlating synced Jira + GitHub data against configurable thresholds shipping with FR-009 defaults. Each anomaly carries 5 attributes (severity, description, context, one-line suggested action, source deep-link). Inbox ordered by raw severity (high → medium → low, then recency). Severity-weighted sprint-risk score computed + stored per anomaly.

PRD refs: FR-009, FR-013, FR-014, FR-015, US-01 (all 5 attributes).

Known: absence records (S-08) not yet available — this slice ships with absence = empty (no DEVELOPER_INACTIVE suppression, no SPRINT_AT_RISK absence-weight); S-08 wires those on top.
