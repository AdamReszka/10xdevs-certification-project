---
change_id: sprint-reconciliation
title: Follow the team's active sprint on every sync, not just at setup
status: new
created: 2026-08-26
updated: 2026-08-26
archived_at: null
---

## Notes

Roadmap **S-16** (`context/foundation/roadmap.md`), PRD **FR-007**.

Outcome: when the team starts a new sprint in Jira, SprintFlow follows it
automatically. Today it does not — the sprint captured at setup is synced forever
until someone manually re-runs a wizard step.

**Why this exists (S-10 impl-review F7, 2026-08-23).** FR-007 says the system
"pulls sprint cadence from the monitored Jira project's active-sprint
configuration **on each sync**". As built, that happens *once*: the only writer of
the `sprint` row is `importCadence` (`roster-store.ts`, the `/setup/team` step),
and `run-sync.ts` contains no `insert(sprint)` at all — it *reads* via
`getActiveSprintRow` and never reconciles against Jira.

**Observed cost, not hypothetical.** This is what made the real account report a
healthy green sync while showing an empty dashboard: the stored sprint was the
demo seed's `jira_sprint_id=1001`, which does not exist in that Jira, so
`searchSprintIssues` correctly returned nothing and the cycle reported OK.
Root-cause write-up: `context/changes/dashboard-sprint-detail/plan.md:1020-1052`.

**Constraint carried in from S-10.** The sibling defect — `getActiveSprintRow`
choosing nondeterministically between two ACTIVE rows — was already closed
(`src/lib/sprint.ts` orders by `startDate desc`). Reconciliation must avoid
*creating* a second ACTIVE row rather than leaning on that ordering. Note
`importCadence` conflicts on `jiraSprintId`, which is exactly how a second ACTIVE
row becomes reachable.

**Touches S-08's work.** `absence.sprint_id` is stamped at record time and never
re-stamped, so an absence entered between sprints keeps `NULL` and can never raise
`SPRINT_AT_RISK` (impl-review F10, `sprint-at-risk.ts`). Rollover is this slice's
concern, so decide here whether re-stamping belongs in scope.

Prerequisite S-05 is done. No blockers recorded.

## Scope decision (2026-08-26, owner)

**Research the full blast radius first; do not fix the scope up front.** The
rollover touches more than the `sprint` row — `jira_ticket.sprint_id`,
`anomaly.sprint_id` and `absence.sprint_id` all point at it, and
`sprint.cadence_overridden` exists because FR-007 lets the owner override the
auto-pulled cadence, so a reconcile must not stomp it.

Research maps what breaks at rollover, then comes back with "this belongs in
S-16 / this is its own slice" and the owner picks. Nothing is pre-committed.
