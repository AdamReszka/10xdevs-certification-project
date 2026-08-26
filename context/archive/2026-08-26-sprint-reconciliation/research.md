---
date: 2026-08-26T00:35:00+02:00
researcher: Adam Reszka
git_commit: 536f51520f1b33a5b7347bca804d2219eb217b8b
branch: feat/s16-sprint-reconciliation
repository: 10xdevs-certification-project
topic: "S-16 sprint reconciliation — full blast radius of a sprint rollover"
tags: [research, codebase, sprint, run-sync, FR-007, cadence, absence, anomaly, demo-seed]
status: complete
last_updated: 2026-08-26
last_updated_by: Adam Reszka
---

# Research: S-16 sprint reconciliation — full blast radius of a sprint rollover

**Date**: 2026-08-26T00:35:00+02:00
**Researcher**: Adam Reszka
**Git Commit**: `536f51520f1b33a5b7347bca804d2219eb217b8b`
**Branch**: `feat/s16-sprint-reconciliation`
**Repository**: 10xdevs-certification-project

## Research Question

Per the owner's scope decision in `context/changes/sprint-reconciliation/change.md`: map the **full blast radius** of following a new Jira sprint on every sync, then come back with "this belongs in S-16 / this is its own slice". Nothing pre-committed.

Concretely: every writer and reader of the `sprint` row; what breaks in `jira_ticket` / `anomaly` / `absence` / `daily_recap` / `sync_state` at rollover; where a reconcile fits in the sync cycle; how `cadence_overridden` survives it; and how the demo dataset interacts (PRD Open Question #2).

## Summary

**The headline is bigger than the roadmap entry says.** S-16 is filed as a "week 1 vs week 3" problem — the sprint captured at setup is synced forever. That is true, but the research surfaced a strictly worse case: **an owner who onboards between sprints gets no sprint row at all, and never gets one.** Three separate documents record "cadence re-pulls on the next sync (FR-007)" as the accepted degradation for that path — and no such re-pull exists. `syncJira` then returns `SKIPPED / no_sprint` forever while stamping `sync_state` a fresh **OK**. That account is permanently dead and reports healthy.

Six findings shape the slice:

1. **Nothing outside the setup wizard ever creates or revises a sprint row.** `importCadence` (`roster-store.ts:838`) is the only `insert(sprint)` in `src/`. `run-sync.ts` writes exactly two columns, `committedSp`/`completedSp` (`:752-757`), and never touches `state`, `jiraSprintId`, or the dates.
2. **`sprint.state` is written once and never revised.** A sprint Jira closed last week is still `ACTIVE` in Postgres. Consequence: `getActiveSprintRow`'s "between sprints → null" branch is **unreachable** once any row exists, and ACTIVE rows accumulate one per wizard re-run.
3. **The seam is small and precise** — between `run-sync.ts:604` (lease acquired) and `:606` (the `no_sprint` early return). The Jira client already has everything needed (`listBoards` + `getActiveSprint`), and `deriveCadence` is pure and reusable unchanged.
4. **`cadence_overridden` has a codified contract already** — the three-way `case when` in `importCadence`'s conflict SET (`roster-store.ts:855-866`). A reconcile that writes cadence columns without reproducing it erases the owner's override **every 15 minutes**.
5. **The pre-built safety net works but has never fired in production.** `sync_state.jira_cursor_sprint_id` (`schema.ts:405-416`, guard at `run-sync.ts:617-626`) exists precisely to make a sprint switch safe. Nothing today ever *causes* a switch, so it only ever fires on project changes and first syncs. S-16 is what makes it earn its keep.
6. **A reconcile placed first would silently downgrade failure classification.** `listBoards` and `getActiveSprint` have no `JiraAuthError` branch — a 401 from either becomes `JiraUnavailableError` → `RATE_LIMITED` → "Jira is rate-limiting, nothing to do", instead of `ERROR` → "reconnect Jira". Today the correct verdict comes from `searchSprintIssues`, which runs later.

**Scope recommendation:** six items are inseparable from the outcome; seven more are genuinely separable and listed with a recommendation each in **§ Scope partition**.

## Detailed Findings

### 1. The `sprint` row — who writes it, who reads it

Table: `src/db/schema.ts:321-350`. Unique key `sprint_owner_sprint_uq (owner_id, jira_sprint_id)` at `:349`. DDL `src/db/migrations/0001_lying_human_cannonball.sql:208-225`; **no later migration touches it**.

#### Writers — four in production, one of which is a delete

| # | What | Location | Columns it sets |
|---|---|---|---|
| W1 | `importCadence` upsert — **the only `insert(sprint)`** | `src/lib/integrations/roster-store.ts:838-870` | insert: all but `committedSp`/`completedSp` (→ NULL). Conflict target `[ownerId, jiraSprintId]` (`:854`); SET always refreshes `name`/`state`/`startDate`/`endDate`, refreshes `lengthDays`/`startDay`/`workingDays` only via `case when cadence_overridden` (`:860-865`) |
| W2 | SP scalars, in `syncJira`'s txn | `src/lib/integrations/sync/run-sync.ts:752-757` | `committedSp`, `completedSp` only — aggregated from the `jira_ticket` **table**, not the delta payload (`:740-749`) |
| W3 | `saveCadence` user override | `src/lib/integrations/roster-store.ts:900-908` | `lengthDays`, `startDay`, `workingDays`, `cadenceOverridden: true`. **No `.limit(1)`** — updates *every* ACTIVE row |
| W4 | project-switch DELETE | `src/lib/settings/connection-service.ts:409-411` | deletes all of that owner's sprints for the old project; cascades `jira_ticket` → `jira_status_history`, `anomaly`, `absence` |
| — | demo seed (raw SQL) | `scripts/seed-dashboard.mjs:246-256` | all 14 columns; `jira_sprint_id='1001'`, `state='ACTIVE'` |
| — | E2E fixture | `e2e/dashboard-sprint-detail.spec.ts:269-275` | omits `length_days`/`start_day`/`working_days` — a useful pre-existing null-tolerance fixture |

W1's only caller chain is the wizard: `src/app/(app)/setup/team/actions.ts:214` → `src/components/organisms/setup/cadence-form.tsx:102` → mounted **only** at `src/app/(app)/setup/team/page.tsx:71`. There is no Settings mount (S-15 deferred it here — `context/changes/team-management-surface/plan-brief.md:55,68-69`).

#### Readers — one canonical resolver plus two ad-hoc twins

`getActiveSprintRow` (`src/lib/sprint.ts:19-43`) is the canonical resolver: prefer `state='ACTIVE'` `ORDER BY startDate DESC LIMIT 1`, else most-recently-started of any state, else `null`. Seven production call sites: `run-sync.ts:601`, `load-snapshot.ts:39`, `dashboard/page.tsx:44`, `sprint-detail/page.tsx:42`, `capacity.ts:151`, `absence-store.ts:144`, `settings/absences/page.tsx:36`.

Two **unfixed twins** of the S-10 F7 nondeterminism, both live the moment a second ACTIVE row exists:

- `src/app/(app)/setup/team/page.tsx:32-42` — `where(state='ACTIVE').limit(1)` with **no `orderBy`**. The wizard can display row A's cadence while every runtime reader uses row B.
- `saveCadence` (`roster-store.ts:900-908`) — **no `.limit(1)`**, so the override lands on *both* ACTIVE rows and `{updated}` returns 2 where every caller and test assumes 1 (`roster-store.integration.test.ts:479`).

Both are killed at the source by demoting the old row rather than by adding orderings.

#### Null-tolerance — what a half-populated row does

`startDate` NULL is the nastiest: **Postgres `ORDER BY … DESC` is NULLS FIRST**, so a NULL-dated ACTIVE row outranks a correctly-dated one in *both* branches of `getActiveSprintRow` (`sprint.ts:33`, `:40`). It also empties the burndown (`burndown-series.ts:108,117`), blinds SCOPE_CREEP (every ticket gets `addedAfterSprintStart = null` at `run-sync.ts:675-676`), over-fires PR_TOO_BIG (`pr-too-big.ts:20`), and removes the Availability tab (`capacity.ts:152`).

`committedSp` NULL **disables SCOPE_CREEP entirely** (`scope-creep.ts:13-14`) and drops the burndown's ideal line — and NULL is the *normal* state of a freshly-inserted row until the first successful W2. `endDate` NULL removes 2 of SPRINT_AT_RISK's 3 variants (`sprint-at-risk.ts:87,125`). `state` NULL makes `saveCadence` a silent no-op that still reports success (`roster-store.ts:907` + `actions.ts:271` ignoring the count) — reachable because `toSprintState` returns `null` for any unrecognised Jira state string (`roster-store.ts:720-731`).

`lengthDays` and `startDay` are **write-only** — nothing outside `setup/team/page.tsx:46-47` reads them. Only `workingDays` is genuinely consumed (`ticket-status-aging.ts:67`, `sprint-at-risk.ts:128,155`, `capacity.ts:192`), and always behind a Mon–Fri fallback at `helpers.ts:118-122`.

#### How a second ACTIVE row is reachable

The unique key is `(owner_id, jira_sprint_id)` — there is **no partial unique index enforcing at most one ACTIVE row per owner**. So `importCadence`'s upsert identity is *"this owner's row for this specific Jira sprint id"*, not *"this owner's active sprint"*. Sprint 4242 closes, 4243 starts, the owner re-visits `/setup/team` → `(owner,'4243')` does not collide with `(owner,'4242')` → plain INSERT, two ACTIVE rows. Nothing in the SET reaches sideways to demote the first.

### 2. What breaks in every table pointing at `sprint.id`

| Dependent | Nullable | FK action | Deferrable |
|---|---|---|---|
| `absence.sprint_id` (`schema.ts:449`) | yes | `ON DELETE cascade` | no |
| `jira_ticket.sprint_id` (`schema.ts:585`) | yes | `ON DELETE cascade` | no |
| `anomaly.sprint_id` (`schema.ts:650`) | **NOT NULL** | `ON DELETE cascade` | no |
| `daily_recap.sprint_id` (`schema.ts:719`) | **NOT NULL** | `ON DELETE cascade` | no |
| `sync_state.jira_cursor_sprint_id` (`schema.ts:416`) | yes | **no FK at all** | n/a |

`grep DEFERRABLE src/db/migrations/*.sql` returns nothing — all immediate. (Relevant because `lessons.md`'s delete-then-insert entry turns on exactly this.)

#### `jira_ticket` — re-stamped, with three edge failures

Written at sync time with `sprintId: chosenSprint.id` (`run-sync.ts:679`, and again in the conflict SET at `:695`), conflict key `(ownerId, jiraKey)` (`:703`) — deliberately **not** keyed on sprint, so a carried-over ticket *is* moved forward. What is not handled:

- A ticket that does **not** carry over keeps `sprint_id = N` forever. Correctly excluded from every read (all reads are `eq(jiraTicket.sprintId, current)`), but never deleted — no `delete(jiraTicket)` exists anywhere in `src/`.
- A ticket moved **out** of the sprint in Jira is never un-stamped; it keeps feeding `getTicketAging`, `getBurndownSeries`, and SCOPE_CREEP's `addedAfterSprintStart` sum for the sprint that last claimed it.
- The first post-rollover cycle is a **full pull** (correct, via the cursor guard) but has the least protection: `MAX_SEARCH_PAGES` **throws** rather than truncating (`jira.ts:820-824`), so a large new sprint fails the cycle outright.

#### `anomaly` — old rows freeze `ACTIVE` forever

The dedup key includes `sprint_id` (`schema.ts:675-679`), so at rollover every anomaly re-inserts under the new sprint with a fresh `id` and fresh `detectedAt`. Two consequences:

- **The reconcile sweep is sprint-scoped** (`detect.ts:70`), so the "flip to RESOLVED what is no longer detected" pass at `:118-127` never sees old-sprint rows. They stay `status='ACTIVE'` permanently — invisible on the inbox (`reader.ts:60` filters by sprint) but a lie in the data that any cross-sprint reader (S-12 recap history, the Reliability KPI trend noted at `reliability-kpi.tsx:22-23`) will read as live.
- **`detectedAt` recency is destroyed.** FR-015's default sort is `severity, detectedAt desc` (`reader.ts:62`), so a PR stalled six days shows as "detected just now" on rollover morning and the whole inbox reorders.

#### `absence` — F10 confirmed, plus a three-way disagreement

`createAbsence` stamps `sprintId: activeSprint?.id ?? null` (`absence-store.ts:157`); `updateAbsence` deliberately does **not** re-stamp (doc at `:169-173`). `sprint-at-risk.ts:141` is `if (absence.sprintId !== snapshot.sprint.id) continue;`, so a NULL never raises risk — the code already carries the admission and the S-16 hand-off at `:135-140`.

Two nuances the F10 note does not carry:

- **The NULL case is narrower than it looks.** `getActiveSprintRow` falls back to the most-recently-started sprint of any state, so NULL only happens for an owner with **zero** sprint rows. Given finding §3 below, that is exactly the "onboarded between sprints" owner — which the core S-16 fix eliminates. In practice the more common bad stamp is not NULL but *the stale old sprint's id*, which fails the same `!==` just as hard.
- **Three consumers of the same row disagree about which sprint it belongs to.** `sprint-at-risk.ts:141` is `sprint_id`-scoped; `getSprintCapacity` (`capacity.ts:170-176`) and `detectDeveloperInactive` (`developer-inactive.ts:47-51`) filter by **date overlap only**. So a cross-boundary absence *does* reduce sprint N+1's capacity and *does* suppress `DEVELOPER_INACTIVE` there, while being invisible to the risk rule. Per S-08's own design rule (`context/archive/2026-08-25-absence-calendar/plan.md:154-163`) the risk rule's behaviour is **intentional** ("planned there" by D2's definition) — so "re-stamp at rollover" would contradict a recorded decision, not just fix a bug. This is a genuine owner call, not a defect to sweep up.

Also: `isPlanned`'s client-side default is computed against `sprintStartDay` from the *stale* active sprint (`absence-calendar-view.ts:148-151` ← `settings/absences/page.tsx:41-42`).

#### `daily_recap` — no writer exists

`grep dailyRecap src/` outside `schema.ts` returns zero hits. S-11/S-12 are `proposed`. Schema-only; nothing to break yet.

#### `sync_state.jira_cursor_sprint_id` — the one mechanism already correct

Schema rationale at `schema.ts:400-416` (verbatim: *"Observed on a real project 2026-08-22"*). Guard at `run-sync.ts:617-626`; written back at `:760-765`, and **only on success** (the catch at `:769-773` passes neither cursor field).

Already handles: cursor-from-sprint-N never applied to N+1; first-ever sync; the post-`updateJiraProject` case. Does **not** handle: detecting the rollover — it is purely reactive to `getActiveSprintRow` already returning a different id. It is not an FK, so it can dangle (benign: mismatch → full pull). Verified live in `context/changes/dashboard-sprint-detail/MANUAL-CHECKLIST.md:265-272`.

#### Retention — does not exist, and a page already claims it does

`grep -i "retention|purge|prune" src/` finds only `SYNC_ATTEMPT_RETENTION = 50` for the operational log (`run-sync.ts:291,318-330`) and two *comments* promising the S-12 purge (`schema.ts:335`, `:718`). Meanwhile `src/app/(app)/settings/absences/page.tsx:24` already tells the reader "retention already bounds it to current + 2 previous sprints" — **false today.** S-16 is what turns "one sprint row per owner" into a growing series, so this stops being theoretical.

### 3. The load-bearing false premise — "cadence re-pulls on the next sync"

This is the finding that most changes S-16's priority. Three documents record, as an accepted degradation, that an owner onboarding between sprints is fine because cadence re-pulls later:

- `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:63` — *"write no `sprint` row … re-derives on the next sync once a sprint goes active (FR-007 'pull on each sync')"*
- `…/plan.md:277` — *"cadence is best-effort and re-pulls on the next sync per FR-007"*
- `context/changes/onboarding-routing/change.md:60-67` — consumed verbatim into first-run routing

The re-pull does not exist. `syncJira` returns `SKIPPED{no_sprint}` and stamps a **fresh OK** (`run-sync.ts:606-613`); the dashboard's `SyncStatusBar` renders `JIRA: OK`, freshly timestamped. So the account is permanently dead and permanently green. S-07 research saw the symptom without connecting it (`context/archive/2026-08-21-dashboard-today/research.md:145`: *"This is the most likely reason a real smoke test yields nothing."*).

Two things follow. First, S-16 is not only a week-3 fix — it is a first-run correctness fix. Second, closing it **subsumes most of F10**: once the sprint row appears on the first sync after a sprint starts, the `absence.sprint_id IS NULL` case largely stops being reachable.

### 4. Where the reconcile goes, and what it needs

#### The seam

**Between `run-sync.ts:604` and `:606`** — immediately after `acquireLease("JIRA")` succeeds, before the `if (!chosenSprint)` branch. Everything downstream that consumes the sprint, in order: `:606` the `no_sprint` return · `:622` the cursor comparison · `:641` the JQL sprint id · `:653` `sprintStart` → `addedAfterSprintStart` · `:679`/`:695` `jira_ticket.sprintId` · `:749`/`:757` the SP aggregate + write · `:764` the cursor stamp · then, after `syncOwner` returns, `detectAnomalies` → `loadSprintSnapshot` → `getActiveSprintRow` again.

Two mechanical consequences: `baseUrl`/`jiraCreds` (`:615-616`) must move **above** the reconcile, and the reconcile must sit inside a `try` that reaches `classifyError` (the existing `try` opens at `:628`, below the insertion point).

Placement matters for concurrency too: after the lease, the reconcile inherits the `sync_state.claimed_until` + `SELECT … FOR UPDATE` guard (`run-sync.ts:192-253`) for free. Placed *before* it — e.g. alongside the existing `getActiveSprintRow` at `:601` — cron and a `syncNow` click could race (`bypassDueCheck` skips the due-check but **not** the lease).

Nothing else stands in the way: between the start of `syncJira` and the sprint being chosen there are exactly three operations — a credential decrypt (`:579-590`), one `jira_project` SELECT (`:592-597`), one `sprint` SELECT (`:599-601`). **No Jira network call happens before the sprint is fixed.**

#### The client already has everything

Two calls, zero new client code: `listBoards(baseUrl, creds, projectKey)` (`jira.ts:454-519`, filtered to `{"scrum","simple"}` at `:110`) → `getActiveSprint(baseUrl, creds, boardId)` (`jira.ts:528-580`, returns the first active `JiraSprint` or **`null`**). `deriveCadence` (`cadence.ts:66-88`) is pure, DB-free, network-free and takes exactly the two ISO strings `getActiveSprint` returns plus the owner's IANA zone — which `syncJira` **already fetches every cycle** via `validateCredentials` at `run-sync.ts:635`. The call site to copy is `roster-store.ts:818-824`; the board-selection policy to copy is `roster-store.ts:782-812`.

#### But `board_id` cannot be assumed present

`jira_project.board_id` (`schema.ts:267`, nullable) is today **write-only** — its sole writer is `importCadence` (`roster-store.ts:829-832`), it is cleared on a project switch (`connection-service.ts:401`), and **nothing reads it back anywhere in `src/`**. A reconcile would be its first consumer. It is NULL in two reachable states: the demo seed never writes it (`seed-dashboard.mjs:239-244`), and `storeJiraIntegration` never writes it (`jira-store.ts:200-220`). So the reconcile needs a discovery fallback via `listBoards` — and a decision for the >1-board case, which in a headless cycle has no UI to ask (see § Scope partition, item C).

#### Failure semantics — one real regression risk

`classifyError` (`run-sync.ts:339-359`) maps `JiraAuthError` → `ERROR` ("reconnect", `needsOwnerAction: true`) and `JiraUnavailableError` → `RATE_LIMITED` ("try later", `needsOwnerAction: false`), per `failure-reason.ts:45-67`. **`listBoards` and `getActiveSprint` have no `JiraAuthError` branch** (`jira.ts:481-485`, `:540-544`) — every non-OK, 401 included, is `JiraUnavailableError`. Today the correct verdict still surfaces because `searchSprintIssues` (`jira.ts:841`) and `resolveStoryPointFieldId` (`:916`) run later and *do* classify 401. Move the first-throw point earlier and a revoked token reports as "Jira is rate-limiting, nothing to do". The fix is two small branches in the client.

What a failing reconcile must do to the stored row: **nothing.** Six surfaces resolve through `getActiveSprintRow`; blanking the row on failure would flip them all to empty states *while the dashboard also shows a red banner* — exactly the guardrail violation the PRD forbids. The pattern to copy is `roster-store.ts:826-869`: all network reads complete first, the transaction opens only after. And a *successful* reconcile returning `null` is not a failure and must also not blank the row — `importCadence` already models that restraint (`roster-store.ts:834`, `:746-747`: *"No active sprint → writes NO sprint row"*).

Vocabulary already exists for legible no-ops: `sync_attempt.outcome` (`run-sync.ts:606-613` stamps `"no_sprint"`). S-16 should extend that vocabulary rather than invent one.

#### The test harness will break loudly

`jiraFetch` in `run-sync.integration.test.ts:171-208` handles exactly three URL shapes and **throws on anything else** (`:205`). Adding agile board/sprint calls to `syncJira` fails **every existing Jira test in the file** until the mock grows two branches. `seedOwner` (`:212-274`) also does not set `jira_project.boardId` (`:249-252`) and seeds `sprint` as `jiraSprintId: "42"`, `ACTIVE` (`:259-271`). The closest existing analogue to a sprint switch — and the assertion style to reuse — is `:609-658` ("the delta cursor is scoped to its sprint"), with the `searchJql(calls)` helper at `:611-614`. `cadence.test.ts` is pure and unaffected.

### 5. Demo ↔ real integrations (PRD Open Question #2)

**No demo-mode flag exists anywhere** — zero hits for `demo`/`isDemo`/`seed` as a column, enum, or env marker in `src/db/schema.ts`; the only two `demo` hits in `src/` are prose comments (`reliability-kpi.tsx:26`, `roster-store.ts:121`). Seeded tokens are encrypted with the live `TOKEN_ENCRYPTION_KEY` (`seed-dashboard.mjs:57-78`), deliberately, so the app cannot tell a seeded credential from a real one by envelope shape either.

**No in-app reset exists.** FR-008's "Reset demo data" is S-09, unbuilt. Re-running the seed resets *to demo*, never to uninitialized. The only path that clears the sprint row is `disconnectJira` (`jira-store.ts:256-264`), via the `jira_credential` → `jira_project` → `sprint` cascade chain.

**How the collision is reachable.** Not by seeding after connecting — the seed deletes `jira_credential`/`jira_project`/`sprint` first (`seed-dashboard.mjs:196-223`, 15 tables). It is reachable by **seeding first, then connecting real Jira**: `storeJiraIntegration` upserts `jira_project` *in place*, preserving the row `id` so nothing cascades, and never touches `sprint` (`jira-store.ts:200-220`). The demo sprint survives, silently re-parented to the real project, `project_key` flips `WEB` → the real key while `jira_sprint_id` stays `1001`. The *settings* path was hardened for exactly this (`connection-service.ts:340-346` doc + `:405-411` delete); the **wizard path has no such branch**.

**Why the demo row wins.** It is `ACTIVE` with `start_date = now − 8d`, and `getActiveSprintRow` orders by `startDate DESC` — so it beats any real sprint that started ≥8 days ago.

**Why the cycle reports green** — `run-sync.ts:760-766` stamps `status: "OK"`, and `finalizeSyncState` (`:257-288`) clears `last_error` and sets a fresh `last_successful_sync_at`. **`issues.length` is never inspected anywhere on this path.** A `200 {"issues":[]}` falls straight through `jira.ts:850-867` and the loop iterates zero times.

**And it is worse than empty.** The SP scalars are recomputed from the `jira_ticket` *table*, not from `issues` (`run-sync.ts:740-757`) — so the demo's 11 tickets, still attached to `chosenSprint.id`, produce plausible-looking totals that a real sync then stamps onto the sprint. Stale demo numbers, refreshed by a real cycle. From the next cycle `jiraCursorSprintId` matches, so the wrong-sprint query becomes a wrong-sprint *delta* query (`:765`).

**What S-16 does and does not fix here.** A reconcile that asks Jira for the board's active sprint and demotes non-matching ACTIVE rows **closes the sprint half of this vector automatically** — the demo row loses ACTIVE, the real sprint takes over. It does **not** clear the demo `jira_ticket` / `anomaly` / `team_member` rows, which simply detach and linger. Full delineation is S-09 + Open Question #2, still owner-owned and unresolved (`prd.md` Open Questions #2; `roadmap.md:268` — *"S-09 cannot be planned until it is resolved"*).

## Code References

- `src/db/schema.ts:321-350` — `sprint` table; `:349` the unique key that permits two ACTIVE rows
- `src/db/schema.ts:400-416` — `jira_cursor_sprint_id` and the incident that produced it
- `src/lib/sprint.ts:19-43` — `getActiveSprintRow`; `:28-32` the S-10 F7 reachability comment
- `src/lib/integrations/roster-store.ts:838-870` — the only `insert(sprint)`; `:855-866` the `cadence_overridden` three-way SET
- `src/lib/integrations/roster-store.ts:782-812` — board-selection policy worth reusing
- `src/lib/integrations/roster-store.ts:900-908` — `saveCadence`, unbounded UPDATE over all ACTIVE rows
- `src/lib/integrations/sync/run-sync.ts:599-613` — the sprint read and the `no_sprint` early return: **the seam**
- `src/lib/integrations/sync/run-sync.ts:617-626` — the cursor-vs-sprint guard
- `src/lib/integrations/sync/run-sync.ts:740-757` — SP aggregate from the table + the only sync-time sprint write
- `src/lib/integrations/sync/run-sync.ts:339-359` — `classifyError`
- `src/lib/jira.ts:454-519` / `:528-580` — `listBoards` / `getActiveSprint`, both missing a 401 branch
- `src/lib/integrations/cadence.ts:66-88` — `deriveCadence`, pure and reusable unchanged
- `src/lib/anomaly/detect.ts:70,118-127` — the sprint-scoped reconcile sweep
- `src/lib/anomaly/rules/sprint-at-risk.ts:135-141` — the in-code S-16 hand-off note
- `src/lib/settings/connection-service.ts:340-346,405-411` — the hardened project-switch path (the pattern the wizard lacks)
- `src/lib/integrations/jira-store.ts:200-220` — `storeJiraIntegration`, the unhardened wizard path
- `scripts/seed-dashboard.mjs:196-223,246-256` — the destructive cleanup and the `jira_sprint_id='1001'` row
- `src/lib/integrations/sync/run-sync.integration.test.ts:171-208,212-274,609-658` — the mock that throws, the seed helper, the sprint-switch analogue

## Architecture Insights

- **One resolver, seven call sites, two rogue twins.** The codebase deliberately funnels "which sprint?" through `getActiveSprintRow`. The two queries that bypass it (`setup/team/page.tsx:32-42`, `saveCadence`) are precisely the two that misbehave with a second ACTIVE row. The structural fix is to make a second ACTIVE row impossible, not to add orderings to the twins.
- **Reads before transactions is an established, documented rule** (`run-sync.ts:629` "reads before txn (F1)", Hyperdrive single-connection constraint). A reconcile inherits it: fetch, then write.
- **Per-integration failure containment is an invariant, not an accident** (`run-sync.ts:59-60,778-781`; tested at `run-sync.integration.test.ts:565-588`). A reconcile lives entirely inside the Jira half.
- **`sync_state.last_error` is never forwarded to a client** — `classifyFailure` reads `status` and nothing else (`failure-reason.ts:9-19`), `sync_attempt` has no error column (`schema.ts:359-361`), `toClientOutcome` strips it (`sync/actions.ts:23-37`). Any new reconcile outcome must be expressible as a `status` + `outcome` enum value, never as text.
- **The narrowing-predicate failure class.** Three of the most expensive bugs in this project's history — `listBoards`' `type === "scrum"` filter, the sprint-blind delta cursor, and the `sprint = 1001` query — all narrowed a query with a wrong predicate, got an empty set, and had the caller read it as a legitimate absence. Write-up at `context/changes/dashboard-sprint-detail/plan.md:1103-1117`; **still not in `context/foundation/lessons.md`**. S-16 fixes exactly this class and is the natural place to land the entry.
- **`sprint.startDate`/`endDate` are bare `timestamp`, not `timestamptz`** (`context/changes/dashboard-sprint-detail/research.md:140` — the Jira offset is likely dropped on write). Any rollover boundary arithmetic inherits this. S-10 explicitly scoped the migration out (`…/plan-brief.md:40`).

## Historical Context (from prior changes)

- `context/changes/dashboard-sprint-detail/reviews/impl-review.md:117-134` — **S-10 F7**, the finding that filed S-16. Fixed half: `.orderBy(desc(sprint.startDate))`. Deferred half: the FR-007 gap itself.
- `context/changes/dashboard-sprint-detail/reviews/impl-review.md:58,63,70` — **S-10 F2**, the project-switch sibling; *"whether `importCadence` is safe to call outside `/setup/team` has not been verified"* — an open question S-16 inherits.
- `context/changes/dashboard-sprint-detail/plan.md:1033-1074` — the `jira_sprint_id=1001` root cause, and product gaps #4/#5 recorded verbatim before acting.
- `context/changes/dashboard-sprint-detail/plan.md:1318` — auto-running `importCadence` after a project change *"belongs with S-16"*.
- `context/archive/2026-08-25-absence-calendar/reviews/impl-review.md:198-211` — **S-08 F10**, absence re-stamping, decision: *"gap named in a comment … pointing at S-16 as the owner"*.
- `context/archive/2026-08-25-absence-calendar/plan.md:154-163` — the S-08 design rule F10 challenges: an absence carried into a later sprint **should** stop raising risk, by D2's definition of planned-ness.
- `context/archive/2026-08-20-setup-team-roster-cadence/reviews/plan-review.md:25-53` — **S-04 F1** (the between-sprints deferral built on the false premise) and **S-04 F2** (the `cadence_overridden` preservation rule, with its integration test at `…/plan.md:380`).
- `context/foundation/roadmap.md:439-467` — the S-16 entry, including the hard constraint *"avoid creating a second ACTIVE row rather than relying on that ordering"*. Note S-16 has **no row in the Backlog Handoff table** (`:469-488` stops at S-14).
- `context/foundation/roadmap.md:528-541` — **S-18** explicitly depends on S-16: *"Doing it properly likely depends on S-16 … so the next sprint is a real row rather than an extrapolation."*
- `context/foundation/roadmap.md:322`, `context/changes/data-schema-baseline/change.md:43` — **S-12**'s purge keys on `sprint.endDate` and presumes a series of sprint rows exists.
- `context/changes/team-management-surface/plan-brief.md:55,68-69` — **S-15** deferred cadence here; there is currently **no post-setup cadence UI at all**.

## Related Research

- `context/changes/dashboard-sprint-detail/research.md` — sprint scalars, `timestamptz` note
- `context/archive/2026-08-25-absence-calendar/research.md:250-266,454-468` — the canonical-resolver note, the write-only cadence columns, the demo seed description
- `context/archive/2026-08-21-dashboard-today/research.md:145` — the "no dated active sprint → empty inbox" symptom, seen but not connected
- `context/archive/2026-08-20-setup-team-roster-cadence/research.md:40,107` — why `cadence_overridden` exists

## Scope partition — what belongs in S-16, what is its own slice

> **DECIDED 2026-08-26 — owner approved core C1–C6 plus B, E and H.** The
> authoritative record, including the deferred items and the board-ambiguity
> default, is `change.md` § *Scope decision — approved*. The tables below are
> the research recommendations that decision was made against; they are kept
> unedited as the reasoning trail.

### Core — S-16 is not delivered without these

| # | Item | Why it is inseparable |
|---|---|---|
| **C1** | Reconcile step in `syncJira` between `:604` and `:606`: resolve board → `getActiveSprint` → upsert the `sprint` row, honouring the `cadence_overridden` three-way SET | This *is* the slice's outcome (FR-007 "on each sync") |
| **C2** | Guarantee at most one ACTIVE row per owner — demote the previous ACTIVE row when Jira names a different active sprint | The roadmap's explicit constraint (`roadmap.md:466-467`). Also kills both rogue twins (`setup/team/page.tsx:32-42`, `saveCadence`) at the source rather than patching each |
| **C3** | Never blank the stored row: not on a thrown reconcile, not on a legitimate `getActiveSprint → null`. Fetch before txn; extend the `sync_attempt.outcome` vocabulary so a no-op stays legible | PRD guardrail ("last cached state + error banner"). Six surfaces resolve through `getActiveSprintRow` |
| **C4** | Cover the between-sprints onboarding case: an owner with **zero** sprint rows gets one on the first cycle after a sprint goes active | §3 — three documents already promise this behaviour. Free once C1 exists, and it is the difference between a dead account and a working one |
| **C5** | Add a 401 → `JiraAuthError` branch to `listBoards` and `getActiveSprint` | Without it C1 downgrades a revoked token from "reconnect Jira" to "rate-limited, nothing to do" (§4). Two small branches |
| **C6** | Extend `jiraFetch` in `run-sync.integration.test.ts` with the two agile URL shapes; seed `jira_project.boardId` | Not optional — the mock **throws** on unknown URLs, so every existing Jira test fails until this lands |

### Separable — recommendation, owner decides

| # | Item | Recommendation |
|---|---|---|
| **A** | **Re-stamp `absence.sprint_id` at rollover** (S-08 F10) | **Defer, and say so in code.** C4 removes most of the reachable NULL case. And re-stamping would contradict S-08's recorded design rule that a carried-over absence *should* stop raising risk (`absence-calendar/plan.md:154-163`). What is worth doing here is naming the real defect: three consumers disagree (risk = `sprint_id`-scoped, capacity + `DEVELOPER_INACTIVE` = date-scoped). That reconciliation is its own slice |
| **B** | **Close old-sprint anomalies at rollover** (they freeze `ACTIVE` forever, `detect.ts:70`) | **Small enough to include** — one owner-scoped sweep when the sprint id changed. Invisible today, but S-12's recap history will read those rows as live. If the owner wants S-16 tight, this is the first thing to cut, with a note on S-12 |
| **C** | **Board ambiguity in a headless cycle** — `board_id` is NULL for demo-seeded and wizard-`storeJiraIntegration` accounts, and `listBoards` can return >1 with no UI to ask | **Must be decided inside S-16** (C1 cannot ship without an answer), but the *answer* can be minimal: persist nothing and skip with a new `outcome: "board_ambiguous"`, leaving the owner to pick at `/setup/team`. Auto-picking silently is how `type === "scrum"` bit us before |
| **D** | **Retention purge** (current + 2 previous sprints) | **S-12.** But S-16 turns "one row per owner" into a growing series, so flag it — and fix the false claim at `settings/absences/page.tsx:24` while nearby |
| **E** | **Demo ↔ real delineation** (PRD Open Question #2) | **S-09, still owner-owned.** C1+C2 close the *sprint* half of the vector for free. Worth doing in S-16 anyway: give the wizard's `storeJiraIntegration` the same project-change sprint delete the settings path already has (`connection-service.ts:405-411`) — a 3-line symmetry fix that removes the documented incident's entry point |
| **F** | **Post-setup cadence UI** — `/setup/team` is the only mount | **S-19 / S-15.** S-16 makes cadence auto-refresh; the override surface staying wizard-only is a navigation problem, not a reconciliation one |
| **G** | **`timestamptz` migration of sprint dates** | **Out of scope**, as S-10 already recorded. Note it in the plan so rollover boundary arithmetic does not silently assume otherwise |
| **H** | **Land the "narrowing predicate → empty result" lesson** in `context/foundation/lessons.md` | **Include.** S-16 fixes exactly this failure class; the entry has been pending since 2026-08-23 and is cheap |

## Open Questions

1. **Is `importCadence` safe to call outside the wizard?** Recorded as unverified twice (S-10 F2 `impl-review.md:63`, and `plan.md:1318` deferring the post-project-change auto-import to S-16). C1 must either answer it and reuse `importCadence`, or extract the upsert into a shared reconcile function that both the wizard and the cycle call. The second is likely cleaner — the wizard path also returns `boardCandidates` for a UI chooser, which the cycle has no use for.
2. **What demotes an ACTIVE row (C2) — and to what?** `toSprintState` maps Jira's own state string; a sprint Jira closed maps to `CLOSED`. But the reconcile only ever *sees* the currently-active sprint, not the old one's new state. Options: blind-demote every other ACTIVE row for the owner when Jira names a different active sprint, or query the old sprint's state explicitly (an extra subrequest per cycle). Blind-demote is cheaper and matches what "Jira says *this* is the active one" actually asserts.
3. **Does the reconcile run every cycle, or only when something suggests a change?** Every cycle costs 1–2 extra Jira subrequests per owner (plus the existing `validateCredentials` call at `:635`, which already re-reads the timezone every cycle). FR-011's rate-limit budget was flagged as needing confirmation during implementation (PRD Open Question #3) and has never been measured against a real 5000 req/h PAT ceiling at 50 owners × 4 cycles/hour.
4. **The one-cycle empty window.** Between the new sprint row appearing and the first post-rollover sync+detect completing, aging / burndown / inbox all read empty. Inside one cycle the window is short, but a dashboard loaded mid-cycle sees it — and US-01's acceptance criterion says the inbox is *"empty only when zero anomalies are detected — never because a data fetch failed silently"*. Is a one-cycle window acceptable, or does the reconcile need to be transactional with the ticket re-stamp?
5. **PRD Open Question #2 remains owner-owned and unresolved**, and the roadmap records it as hard-blocking S-09 from being planned (`roadmap.md:268`).
