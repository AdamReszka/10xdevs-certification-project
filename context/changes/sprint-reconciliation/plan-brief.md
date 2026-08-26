# S-16 Sprint Reconciliation — Plan Brief

> Full plan: `context/changes/sprint-reconciliation/plan.md`
> Scope decision: `context/changes/sprint-reconciliation/change.md`
> Research: `context/changes/sprint-reconciliation/research.md`

## What & Why

When the team starts a new sprint in Jira, SprintFlow must follow it
automatically. Today it does not: the sprint captured at setup is synced forever
until someone manually re-runs a wizard step. FR-007 promises the system "pulls
sprint cadence from the monitored Jira project's active-sprint configuration **on
each sync**" — as built, that happens exactly once.

Research found the problem is worse than the roadmap entry says. An owner who
onboards **between** sprints gets no sprint row at all and never gets one:
`syncJira` returns `SKIPPED / no_sprint` forever while stamping a fresh **OK**, so
the account is permanently dead *and* reports healthy. Three separate documents
record "cadence re-pulls on the next sync" as the accepted degradation for that
path. No such re-pull exists.

## Starting Point

`importCadence` (`roster-store.ts:838`) is the only `insert(sprint)` in `src/`,
and its only caller is the setup wizard. `run-sync.ts` writes two sprint columns
(`committedSp`/`completedSp`) and never touches `state`, `jiraSprintId`, or the
dates — it *reads* via `getActiveSprintRow` and never reconciles. `sprint.state`
is written once and never revised, so `ACTIVE` rows accumulate one per wizard
re-run, and the unique key is `(owner_id, jira_sprint_id)`, not "one active per
owner". Old-sprint anomalies freeze `status='ACTIVE'` forever because
`detect.ts:70`'s reconcile sweep is sprint-scoped.

This is the defect that made the real account report a healthy green sync while
showing an empty dashboard: the stored sprint was the demo seed's
`jira_sprint_id=1001`, which does not exist in that Jira.

## Desired End State

Every Jira cycle asks the monitored project's board which sprint is active and
makes the database agree — creating the row when absent, refreshing it when
stale, demoting any other `ACTIVE` row to `CLOSED`. A rollover is followed within
one cycle without touching the wizard. An owner's cadence override survives every
cycle. A failed or inconclusive reconcile changes nothing: the dashboard keeps
rendering the last good sprint rather than flipping to empty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | C1–C6 + B + E + H | Six items are inseparable from the outcome; three more are cheap and adjacent. | Frame |
| Board ambiguity | Skip, persist nothing, `outcome: board_ambiguous`, status stays OK | Silently auto-picking a board is the defect class that `type === "scrum"` already cost us; a new `sync_status` value would need a migration plus a `failure-reason.ts` branch. | Frame → confirmed in Plan |
| Absence re-stamping | Out — filed as roadmap **S-20** | Re-stamping contradicts S-08's recorded rule; the real defect is three consumers disagreeing about which sprint an absence belongs to. | Frame |
| Where the upsert lives | New shared `reconcileActiveSprint`; wizard repointed onto it | The three-way `cadence_overridden` SET must exist in exactly one place — two copies erase the owner's override the moment they diverge. | Plan |
| Demoting the old row | Blind-demote every other `ACTIVE` row to `CLOSED`, same transaction | One UPDATE, zero extra subrequests, and it kills both S-10 F7 twins at the source instead of patching each with an ORDER BY. | Plan |
| Reconcile frequency | Every cycle; `getActiveSprint` only, `listBoards` when `board_id` is NULL or 404s | +1 subrequest per cycle, no date arithmetic on columns known to drop their offset (bare `timestamp`, item G). | Plan |
| Old-sprint anomalies | One owner-scoped UPDATE inside the reconcile transaction | Cheaper and narrower than widening `detect.ts`'s sweep to every sprint on every cycle, and it cleans up accounts already carrying frozen rows. | Plan |
| One-cycle empty window | Accept and document | Both transactions live inside one `syncJira` call, so the window is seconds; merging them would put a network call inside a transaction, which F1 forbids. | Plan |

## Scope

**In scope:** reconcile step in `syncJira` (C1) · one-`ACTIVE`-row guarantee (C2) ·
never blank the stored row (C3) · between-sprints onboarding (C4) · 401 →
`JiraAuthError` on the agile endpoints (C5) · test-mock extension (C6) · close
old-sprint anomalies (B) · wizard project-change sprint delete (E) · the pending
`lessons.md` entry (H).

**Out of scope:** re-stamping `absence.sprint_id` (S-20) · retention purge (S-12) ·
post-setup cadence UI (S-19/S-15) · `timestamptz` migration (item G) · full
demo↔real delineation (S-09 / PRD Open Question #2) · any `sync_status` enum change.

## Architecture / Approach

One UI-free `reconcileActiveSprint(...)` completes every network read first
(resolve board → `getActiveSprint` → `deriveCadence`), then opens a single
transaction: upsert the sprint reproducing `importCadence`'s `cadence_overridden`
three-way SET, demote every other `ACTIVE` row of that owner, close anomalies
attached to any other sprint. Both the wizard and the sync loop call it.

In the cycle it sits between `run-sync.ts:604` (lease acquired) and `:606` (the
`no_sprint` early return), which puts it inside the lease's concurrency guard for
free. `validateCredentials` and the `try` that reaches `classifyError` move above
it. A reconcile that cannot conclude is **non-fatal** — the cycle falls back to the
stored sprint and pulls it as before, so S-16 never makes a working account worse.
A reconcile that throws propagates to the existing error classification.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Jira client 401/404 | `listBoards` + `getActiveSprint` classify auth failures; new `JiraBoardNotFoundError` | None isolated — but skipping it makes Phase 3 report a revoked token as "rate-limited, nothing to do" |
| 2. Shared reconciler | `reconcileActiveSprint` + wizard repointed onto it | Touches `/setup/team`, the one path that works today |
| 3. Wire into the cycle | FR-007 delivered: rollover followed, dead accounts revived | The test mock throws on unknown URLs — every existing Jira test fails until it grows |
| 4. Entry point + lesson | Wizard project-change sprint delete; `lessons.md` entry | Smallest phase; first thing to cut if time runs short |

**Prerequisites:** S-05 done (no blockers recorded). Local Supabase at
`127.0.0.1:54322` for the integration suite. A real-credential account for the
Phase 3 manual rows.
**Estimated effort:** ~2–3 sessions across 4 phases; Phase 2 and 3 carry the bulk.

## Open Risks & Assumptions

- **Repointing `importCadence` touches a working path.** S-10 F2 recorded twice
  that "whether `importCadence` is safe to call outside `/setup/team` has not been
  verified" — this plan answers it by extracting the shared half rather than
  calling the wizard function headlessly, but `roster-store.integration.test.ts`
  is the regression surface and a manual wizard pass is a Phase 2 gate.
- **`board_id` becomes a read for the first time.** It is currently write-only,
  written by the wizard and read by nobody. A stale value degrades to
  `listBoards` via the new 404 branch; a value stale in some other way is untested
  territory.
- **Board ambiguity stays invisible for accounts that already have a sprint.**
  Accepted at plan time: such an account syncs fine and reports plain `OK`, so the
  owner is never told to pick a board. Only an account with no stored sprint
  records the diagnostic outcome.
- **PRD Open Question #3 (rate-limit budget) is not resolved here.** The reconcile
  adds one subrequest per owner per cycle; nobody has measured the real ceiling at
  50 owners × 4 cycles/hour.
- **Rollover boundary arithmetic inherits bare `timestamp` columns** (item G, out
  of scope). This plan deliberately does no date arithmetic across the boundary —
  it asks Jira instead.

## Success Criteria (Summary)

- A tech lead whose team starts a new sprint in Jira sees the new sprint's tickets
  and anomalies on Dashboard "Today" within one sync cycle, without touching the
  setup wizard.
- A lead who signs up between sprints gets a working dashboard on the first cycle
  after their sprint goes active — instead of an account that is permanently
  empty and permanently green.
- A lead who overrode their sprint cadence still has that override an hour later.
