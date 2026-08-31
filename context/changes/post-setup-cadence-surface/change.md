---
change_id: post-setup-cadence-surface
title: Sprint cadence becomes editable after setup, outside the wizard
status: impl_reviewed
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

Roadmap **S-29** (`context/foundation/roadmap.md`). Outcome: sprint length,
start day and working days can be changed without re-entering the setup wizard.
PRD ref **FR-007**. Prerequisites S-15 and S-16, both done.

### Why this is the one remaining PRD gap

Of the five slices left on the roadmap, this is the only one tied to a
must-have FR. Roadmap's own wording: FR-007 promises the cadence override with
**no surface condition**, so it is met **formally** (in the wizard) and **not
practically** — an onboarded lead has no route to it. Everything else
outstanding (S-17, S-18, S-30, S-31) is either post-MVP or a follow-up raised
during framing.

### The defect it carries, found at frame time and not yet fixed

Between sprints, `saveCadence`'s UPDATE is scoped to `state = 'ACTIVE'`
(`roster-store.ts:1003`) while the form pre-fills from a CLOSED row via
`sprint.ts:34-42`. **Zero rows update and the action still returns
`{ok:true}`** — a silent failure that reports success. This is the
`lessons.md` "empty result reads as success" shape again, at a third layer.

### What is already known to be safe

- The write path preserves an override (`reconcile-sprint.ts:259-261`) and
  carries it across a rollover (`:216-225`), pinned by three integration tests.
- Re-entering `/setup/team` is neutral for an onboarded lead: no auto-write,
  no Jira call.

### Deferred three times before this, each time as substantive scope

Owner at S-15 (`plan-brief.md:55` "Cadence on the tab | Roster only"), declined
at S-22 (`onboarding-routing/plan.md:387-390` "a separate slice"), parked at
S-16 as out-of-scope item F. Split out of S-19 on 2026-08-30, because S-19's own
text never described it.

### Neighbouring context worth reading first

- **S-28 changed what `working_days` means.** It is no longer only a capacity
  multiplier — since `working-day-aging` it decides when every one of the five
  time-based anomaly rules fires. The roadmap says this slice is "worth more
  after S-28"; the flip side is that a bad edit here is now louder.
- **S-30** (cadence-override-retention) is adjacent: the override survives being
  edited, but not a Jira disconnect. Different mechanism, same column.
- Impl-review of S-28 left **backlog row 28.A**: changing the monitored Jira
  project nulls `jira_project.time_zone`, moving the working-hours clock to
  UTC. Same settings neighbourhood.
