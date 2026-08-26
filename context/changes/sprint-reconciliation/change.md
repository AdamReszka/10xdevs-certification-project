---
change_id: sprint-reconciliation
title: Follow the team's active sprint on every sync, not just at setup
status: impl_reviewed
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

## Scope decision — approved (2026-08-26, owner, after research)

Research: `research.md`. The owner picked **core C1–C6 plus B, E and H**.

### In scope

- **C1** Reconcile step in `syncJira`, between `run-sync.ts:604` and `:606`:
  resolve board → `getActiveSprint` → upsert the `sprint` row, reproducing
  `importCadence`'s three-way `cadence_overridden` SET (`roster-store.ts:855-866`)
  so an owner override is not erased every 15 minutes.
- **C2** Guarantee at most one ACTIVE row per owner — demote the previous ACTIVE
  row when Jira names a different active sprint. This is the roadmap's explicit
  constraint, and it kills both unfixed twins of S-10 F7 at the source
  (`setup/team/page.tsx:32-42`, `saveCadence` at `roster-store.ts:900-908`)
  rather than patching each with an ORDER BY / LIMIT.
- **C3** Never blank the stored row — not on a thrown reconcile, not on a
  legitimate `getActiveSprint → null`. Fetch before txn; extend the
  `sync_attempt.outcome` vocabulary so a no-op stays legible.
- **C4** Cover the between-sprints onboarding case: an owner with **zero** sprint
  rows gets one on the first cycle after a sprint goes active. This closes the
  load-bearing false premise recorded in three places
  (`setup-team-roster-cadence/plan.md:63`, `:277`, `onboarding-routing/change.md:60-67`)
  — today such an account is permanently dead and permanently green.
- **C5** Add a 401 → `JiraAuthError` branch to `listBoards` and `getActiveSprint`
  (`jira.ts:481-485`, `:540-544`), so C1 does not downgrade a revoked token from
  "reconnect Jira" to "rate-limited, nothing to do".
- **C6** Extend `jiraFetch` in `run-sync.integration.test.ts:171-208` with the two
  agile URL shapes and seed `jira_project.boardId` in `seedOwner`. Not optional —
  the mock throws on unknown URLs, so every existing Jira test fails without it.
- **B** Close old-sprint anomalies at rollover. `detect.ts:70`'s reconcile sweep
  is sprint-scoped, so anomalies from the previous sprint freeze `status='ACTIVE'`
  forever. Invisible on the inbox today; S-12's recap history would read them as
  live.
- **E** Give the wizard's `storeJiraIntegration` (`jira-store.ts:200-220`) the
  same project-change sprint delete the settings path already has
  (`connection-service.ts:405-411`). This removes the entry point to the
  documented `jira_sprint_id=1001` incident. Scoped to that symmetry fix only —
  full demo↔real delineation stays with S-09 / PRD Open Question #2.
- **H** Land the pending "narrowing predicate → empty result is indistinguishable
  from true absence" entry in `context/foundation/lessons.md`
  (`dashboard-sprint-detail/plan.md:1103-1117`, unwritten since 2026-08-23).
  S-16 fixes exactly that failure class.

### Assumed default, flag at plan time

**Board ambiguity (research item C).** C1 cannot ship without an answer:
`jira_project.board_id` is NULL for demo-seeded accounts and for any account
that went through `storeJiraIntegration`, and `listBoards` can return more than
one sprint-capable board with no UI to ask in a headless cycle. Proceeding on
the research recommendation — **persist nothing and skip with a new
`outcome: "board_ambiguous"`**, leaving the owner to pick at `/setup/team`.
Silently auto-picking is how the `type === "scrum"` defect bit us before.
Revisit in `/10x-plan` if the owner wants different behaviour.

### Explicitly out of scope

- **A — re-stamping `absence.sprint_id`.** C4 removes most of the reachable NULL
  case, and re-stamping would contradict S-08's recorded design rule that a
  carried-over absence *should* stop raising risk
  (`context/archive/2026-08-25-absence-calendar/plan.md:154-163`). **But research
  surfaced a separate, unfiled defect that must not be lost:** three consumers of
  the same absence row disagree about which sprint it belongs to —
  `sprint-at-risk.ts:141` is `sprint_id`-scoped while `capacity.ts:170-176` and
  `developer-inactive.ts:47-51` are date-scoped. **Filed 2026-08-26 as roadmap
  S-20 `absence-sprint-scoping`** (prerequisites S-08, S-16) — note it is a
  decision slice, not a filter fix: `sprint-at-risk`'s behaviour is S-08's
  recorded intent, and the other two consumers were never brought in line.
- **D — retention purge** (S-12). Note that S-16 turns "one sprint row per owner"
  into a growing series, so the gap stops being theoretical. Related one-liner
  left undone: `settings/absences/page.tsx:24` already tells the reader retention
  bounds the list to current + 2 sprints, which is false.
- **F — post-setup cadence UI** (S-19 / S-15). `/setup/team` remains the only
  mount of `CadenceForm`.
- **G — `timestamptz` migration** of `sprint.startDate` / `endDate`. Out of scope
  as S-10 already recorded; rollover boundary arithmetic inherits the bare
  `timestamp` columns.
