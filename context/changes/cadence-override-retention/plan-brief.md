# Cadence Override Retention (S-30) — Plan Brief

> Full plan: `context/changes/cadence-override-retention/plan.md`
> Frame brief: `context/changes/cadence-override-retention/frame.md`
> Research: `context/changes/cadence-override-retention/research.md`

## What & Why

SprintFlow has no durable representation of *"this is the cadence the lead chose
for this sprint"* — the statement lives as four columns on a row the Jira sync
owns, deletes and reseeds; one boolean governs three fields with two different
provenances, of which the only consequential one (`working_days`) has no Jira
source at all; and every path that replaces it — disconnect, project switch,
rollover, the restore button, migration `0022` — does so without an event, a
status, or a word of copy.

Only two of those five paths involve a credential, which is why re-homing the
values is necessary but not sufficient. `working_days` moves five anomaly rules
and freezes a capacity figure into the lifetime FR-023 record, so a silently
wrong array is not a cosmetic defect.

## Starting Point

The four cadence columns sit on `sprint`, which cascades off `jira_project` off
`jira_credential`; both S-26 disconnect outcomes destroy them, and two explicit
deletes fire on a project switch. Carry-forward reads the *previous* sprint row,
so with that row gone the next reconcile reseeds from Jira and writes
`cadenceOverridden: false` — the override is not lost loudly, it is replaced by a
plausible wrong number. S-29 shipped the editing surface and deliberately left
the ownership question open, which raised the stakes: the override is now
settable from a reachable screen.

Measured during planning rather than assumed: the local database holds six
`sprint` rows, all Mon–Fri with the flag `false`, and production holds zero. The
mechanism is live; its blast radius is currently empty.

## Desired End State

A lead sets Mon–Thu working days. They disconnect Jira choosing "keep", or switch
the monitored Jira project, or the sprint rolls over — and the pattern is still
Mon–Thu while length and start day still auto-pull from Jira. That combined state
is unreachable today in either direction. "Restore Jira's values" returns length
and start day and leaves the working days alone, which is what its dialog has
promised since S-29. A cycle that resolves a cadence from the default while the
account holds a record FOR THAT SAME JIRA-SIDE PROJECT says so in the operator
log instead of finalizing as `OK`. (Scoped to the project at impl-review: a
record left by a project the account switched away from is the outcome
`DISCONNECT_IMPACT.projectSwitch` promises in advance, and counting it made every
cycle of a deliberately switched account report a failure indefinitely.)

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the override belongs | Per-sprint record keyed Jira-side, no FK into the sync graph | The owner ruled the working-day pattern a property of the sprint, not the account; `sprint_measurement` is the shipped instance of surviving this cascade. | Frame |
| Record shape | Three NULLABLE fields; row exists iff the lead has spoken FOR THIS SPRINT, and no write path deletes | NULL means "follow the source for this field", the only shape giving a Mon–Thu team its pattern AND FR-007's auto-pull; `anomaly_settings`' delete-when-equal rule is deliberately NOT copied — with an inheritance tier it makes "stop inheriting" inexpressible (plan review F1). | Plan + review |
| What stays on `sprint` | All four columns, none dropped | Owner's decision; the additive migration keeps a revert to a code revert. `length_days`/`start_day` remain a real derived cache and the resolver's third tier. | Plan |
| The risk that creates | Hermetic reader guard + superseded docblock + roadmap follow-up | `sprint.working_days` becomes written-but-never-read, so only a test can stop a future reader picking up the stale copy — the `boundary-inventory.test.ts` pattern this repo already trusts. | Plan |
| Inheritance at rollover | Read-time recency fallback, no write | No rollover window to miss, so `sweep.ts`'s recorded "A SWEEP, NOT A HOOK, deliberately" objection does not apply. | Plan |
| Restore semantics | Clears length and start day, preserves working days | Jira has no working-days field, so "restoring" it is deleting the lead's choice under someone else's name; the shipped dialog string becomes true instead of being rewritten. | Plan |
| Workspace-URL identity gap | Fixed inside S-30 | This slice's own mechanism opens it — the record now survives the delete that used to mask the collision; shipping without it re-creates S-26 impl-review F2 for a new payload. | Research |
| Mutation glob | Left alone, decision recorded | Every file touched is outside the glob, and a first run against an untuned file can drop the aggregate below `break: 70` and break CI. | Plan |

## Scope

**In scope:** the new table and its migration; the resolver and its precedence;
the two read seams that cover 15 call sites; `saveCadence` per field and in a
transaction; restore preserving the working days; the reconcile's unconditional
cadence SET and the removal of `carry`; one operator-log token; the
`DISCONNECT_IMPACT` promise plus a declared clause and a structural regression;
the workspace-URL comparison; the `/team/cadence` dead-end route; the second
uncanonicalised Mon–Fri copy; the dead `no_sprint` arm; one net-new E2E spec.

**Out of scope:** dropping any column; giving `length_days`/`start_day` a
consumer; a column registry in the copy guard; touching `stryker.conf.json`; a
write-time rollover seed; any data-repair migration.

## Architecture / Approach

New table `sprint_cadence_override` in the `sprint_measurement` shape — Jira-side
project and sprint ids, one FK to `user` and none into the sync graph. One
resolver module answers every cadence question with four tiers: this sprint's
record (per field, NULL falls to tier 3, never to tier 2) → the latest earlier
record for this Jira-side project with `start_date <= this sprint's` → `sprint`'s
own derived columns for length and start day, `DEFAULT_CADENCE.workingDays` for
working days → the defaults. Two functions collapse most of the read surface:
`getSprintCapacityFor` covers the dashboard and the measurement sweep,
`loadSprintSnapshot` covers all eight anomaly rules by surfacing
`SprintSnapshot.workingDays`. Writes join the reconciler's existing transaction,
with the restore intent arriving as an argument rather than as a caller-side
pre-clear.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Record and resolver | The table, the migration, the precedence logic | The recency fallback must order against the sprint being resolved, not "now", or an unfinalized closed sprint's capacity gets rewritten |
| 2. Read seams | Every reader on the resolver; behaviour unchanged | 15 sites, 8 modules; two `as SelectSprint` casts would hide a compile break |
| 3. Write paths | Per-field save; restore preserves the pattern | Reverses a test currently pinning the destruction green |
| 4. Reconcile | Unconditional SET, `carry` gone, one diagnostic token | The intent must stay an argument — four Jira outcomes return successfully having written nothing |
| 5. Copy, contract, identity | Promise made true, guard made able to notice, collision closed | `integration-card-copy.test.ts:184` forces `reconnectCost` to quote every fragment of its source |
| 6. E2E and bookkeeping | One browser spec, checklist, backlog, PRD/roadmap | `/team/cadence` has zero E2E coverage today, so this is net-new, not an edit |

**Prerequisites:** S-16 and S-26 (both done). Local Supabase running for the
integration suite. A production migration route (see the plan's Migration Notes —
the prod host is IPv6-only, so drizzle-kit cannot reach it from this Mac).

**Estimated effort:** ~6 sessions, one per phase; Phases 2 and 5 are the widest.

## Open Risks & Assumptions

- **The kept columns.** `sprint.working_days` and `cadence_overridden` become
  written-but-never-read. The reader guard and the docblock are the whole
  mitigation; if either is removed the "which copy is true" question comes back.
- **The measured blast radius is a fact about today.** Re-run the pre-flight
  `select count(*) from sprint where cadence_overridden = true;` immediately
  before applying the migration to production.
- **The migration route is manual.** Merging code that reads the new table before
  the migration lands breaks at the first request, and every CI gate would still
  be green — the exact S-12 shape recorded in `lessons.md`.
- **`e2e/accounts.ts:110` excludes cadence from E2E seeding on purpose**, so the
  new spec must set the cadence through the UI.

## Success Criteria (Summary)

- A hand-set Mon–Thu week survives a disconnect, a project switch and a rollover,
  while length and start day keep auto-pulling from Jira.
- "Restore Jira's values" does what its dialog says — the working days are still
  there afterwards.
- A cadence that falls back to the default while the account holds a record
  elsewhere is visible in Sync history, not silent.
