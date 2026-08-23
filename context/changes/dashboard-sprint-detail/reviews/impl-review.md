<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-10 Dashboard "Sprint Detail"

- **Plan**: `context/changes/dashboard-sprint-detail/plan.md`
- **Scope**: Phases 1–10 (full plan) + the post-Phase-10 fix commits on the branch
- **Date**: 2026-08-22
- **Verdict**: REJECTED at review time (2 critical data-safety findings) → **all 10 findings triaged and 9 fixed 2026-08-23**; the two criticals are closed. Remaining blocker to PR-ready is verification, not code: F6's manual pass (Progress 11.13–11.15).
- **Findings**: 2 critical, 6 warnings, 2 observations
- **Triage outcome**: 9 FIXED (F1, F2, F3, F4, F5, F7, F8, F9, F10), 1 PARTIALLY ADDRESSED (F6 — E2E run green, manual rows still open)
- **Post-fix verification** (HEAD, 2026-08-23): `typecheck` clean · `test` 322/322 · `test:integration` 88/88 · `lint` 0 errors · `test:e2e` **11/11**

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (re-run at HEAD 59e149e)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS — clean |
| `npm run test` | PASS — 322/322, 26 files |
| `npm run test:integration` | PASS — 88/88, 12 files |
| `npm run lint` | PASS — 0 errors, 5 warnings (all pre-existing in `src/lib/anomaly/**`) |
| `npm run build` | PASS — 17 routes, new ones dynamic |
| `npm run build:cf` | PASS — worker emitted; only the pre-existing better-auth vendor warning |
| `npm run test:e2e` | NOT RUN — a dev server holds :3000 and `reuseExistingServer` would adopt it without the fixture env (`playwright.config.ts:68-69`), so `setup-*` specs would hit real GitHub/Jira |

## Findings

### F1 — `updateMonitoredRepos` cascade-deletes all synced GitHub history

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/settings/connection-service.ts:260-271`
- **Detail**: The transaction does `DELETE FROM monitored_repo WHERE owner_id = $1` (`:261`) and re-inserts every selected repo with a **fresh `randomUUID()`** (`:264`). `github_commit.repoId` and `github_pullRequest.repoId` both reference `monitoredRepo.id` with `onDelete: "cascade"` (`src/db/schema.ts:485-487, 514-516`), and `github_review` cascades off the PR (`:550-553`). So *adding one repo wipes every commit, PR, and review for the repos the owner kept.* It does not recover: `sync_state.lastSuccessfulSyncAt` is untouched, so the next cycle's `since` window is minutes wide and never backfills. The UI offers this behind a plain outline button reading "Change monitored repositories" (`repo-selection-editor.tsx:57-59`) with no warning at all. The delete-then-insert shape was copied from `github-store.ts:157-166`, where it is harmless because setup is replacing the whole credential.
- **Fix**: Upsert on the existing `monitored_repo_owner_repo_uq` unique constraint (`schema.ts:251`, on `ownerId, githubRepoId`) via `onConflictDoUpdate`, keeping the row `id` stable, and delete only rows whose `githubRepoId` is no longer selected.
  - Strength: The unique constraint the fix needs already exists; ids stay stable so nothing cascades, and unchanged repos keep their history.
  - Tradeoff: A few more lines than the blunt replace; the delete leg needs a `notInArray` on the kept ids.
  - Confidence: HIGH — FK cascade and constraint both read directly from schema.ts.
  - Blind spot: None significant.
- **Decision**: **FIXED** 2026-08-22 — applied at `connection-service.ts:3` (added `notInArray`, `sql` to the `drizzle-orm` import) and `:260-297` (upsert on `[ownerId, githubRepoId]` with `id` omitted so row ids stay stable, then `delete … notInArray(githubRepoId, keptRepoIds)`). `npm run typecheck` clean. **Not yet covered by a test** — the existing integration test asserts "replace rather than duplicate" (7.3) but not "keeps history for retained repos"; add that assertion before the PR.
- **Related, out of this branch's scope**: `github-store.ts:157-166` does the same blunt delete-then-insert. Because its `onConflictDoUpdate` deliberately keeps the *credential* id stable (`:140-146`), the `monitoredRepo` delete there still cascades away commits/PRs — so reconnecting GitHub through the setup wizard also discards history. Worth a separate roadmap row.

### F2 — `updateJiraProject` warns about a cascade it never performs, and strands the account on a dead sprint

- **Severity**: CRITICAL
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/lib/settings/connection-service.ts:330-338`
- **Detail**: The exact inverse of F1. The `jira_project` row is `UPDATE`d in place (`:331-338`), so `sprint` → `jira_ticket` → `jira_status_history` never cascade — the *previous* project's synced history survives, silently re-labelled as the new project. Three consequences chain: (a) `getActiveSprintRow` (`src/lib/sprint.ts:19-37`) is owner-scoped but not project-scoped, so both dashboards keep rendering the old project's ACTIVE sprint indefinitely; (b) `run-sync.ts:589,624-634` then calls `searchSprintIssues` with the *new* `projectKey` and the *old* `jiraSprintId`, gets nothing, and reports `OK`; (c) `jira_project.boardId` is never cleared and nothing outside the wizard's team step calls `importCadence`, so no sprint for the new project is ever created. Meanwhile `jira-project-editor.tsx:70-77` shows a destructive alert telling the owner this "deletes the sprints, tickets, and status history". The docblock at `:279-285` shows the in-place update was a deliberate choice — but it reasons only about the project-*unchanged* case and never handles the changed one. This is also the failure mode the plan's own runbook already documented once (plan.md:1020-1031, the stale `Sprint 24` row that made the real account sync 0 tickets while reporting OK).
- **Fix A ⭐ Recommended**: In the same transaction, when `target.jiraProjectId !== ` the stored value, delete the owner's `sprint` rows for `existing.id` (letting tickets and history cascade), null out `boardId` and `timeZone`, and send the owner through cadence import before the next sync.
  - Strength: Makes the code do what the UI already promises, and clears the exact stale-sprint state the runbook root-caused by hand.
  - Tradeoff: Needs a story for re-running cadence import outside the wizard, which does not exist yet.
  - Confidence: MEDIUM — the delete is straightforward; the re-import hand-off is the unresolved half.
  - Blind spot: Whether `importCadence` is safe to call outside `/setup/team` has not been verified.
- **Fix B**: Block the project change in Settings for now — keep the read-only display, and route "change project" back through the setup wizard, which already owns cadence import.
  - Strength: Removes an action that currently cannot leave the account in a correct state; no new hand-off to design.
  - Tradeoff: Walks back a shipped, manually-verified capability (8.10).
  - Confidence: HIGH — the wizard path is known to work.
  - Blind spot: None significant.
- **Decision**: **FIXED via Fix A** 2026-08-22 — applied in `connection-service.ts`: `sprint` added to the schema import; the `existing` select widened to carry `jiraProjectId`; `projectChanged` derived from it; when changed the `.set()` now clears `boardId`/`timeZone` and the same transaction deletes the owner's `sprint` rows for this project (tickets + history cascade); return widened with `sprintsDiscarded`. Docblock rewritten to describe the real behaviour. `npm run typecheck` and `npm run lint` clean.
- **Open half — NOT done**: nothing consumes `sprintsDiscarded` yet, so after a project change the account has no sprint until someone re-runs `/setup/team`. `jira-project-editor.tsx:125-137` should route there on `sprintsDiscarded === true`. Blocked on the unverified question of whether `importCadence` is safe to call outside the wizard.
- **Test gap**: no integration test covers the changed-project branch (that sprints are discarded) or the unchanged-project branch (that they are NOT). Add both before the PR.

### F3 — Raw sync error text now reaches the client payload

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/integrations/sync/actions.ts:22-25,53`
- **Detail**: `SyncNowResult` returns `IntegrationOutcome` whole, whose `ERROR`/`RATE_LIMITED` variant carries `error: string` (`run-sync.ts:116`). That string comes from `classifyError`, whose final branch is `err instanceof Error ? err.message : "Unknown sync error."` (`run-sync.ts:355-358`) — an arbitrary Postgres/driver/untyped throw. This branch's own `failure-reason.ts:9-15` names that exact string as never-audited-for-secrets and is the stated reason `sync_state.last_error` is withheld from the client (S-07 impl-review F2, restated in plan Phase 7 §1). `syncNow()` had no caller until this branch; `SyncNowButton` makes it a browser-reachable Server Action, and the return value is serialized into the response payload even though `describe()` (`sync-now-button.tsx:28-36`) renders only fixed copy. The action's own doc comment ("Returns non-secret per-integration status", `actions.ts:20`) is now inaccurate. Note this is precisely what unchecked manual item **7.7** was written to catch.
- **Fix**: Map to a bounded shape at the action boundary — return `{ status, reason? }` per integration and drop `error` before returning.
- **Decision**: **FIXED** 2026-08-23 — `actions.ts` now exports `SyncNowOutcome`, a union with the same discriminants as `IntegrationOutcome` but **no `error` field**; `toClientOutcome()` maps at the boundary and `syncNow` returns the mapped pair. The union shape was kept (rather than a flat `{status, reason?}`) so `sync-now-button.tsx`'s exhaustive `switch` keeps narrowing `reason` on the SKIPPED branch — it compiles unchanged, since it derives its type via `SyncNowResult["github"]`. Doc comment corrected. Typecheck, lint, 322 unit + 88 integration all green. This closes the code half of unchecked manual item **7.7**; the network-tab spot-check itself is still worth doing.

### F4 — One bad commit-detail response aborts the whole GitHub cycle, permanently

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/integrations/sync/run-sync.ts:441-445`
- **Detail**: `getCommitDetail` throws `GithubUnavailableError` on any non-OK and `GithubAuthError` on 401 (`github.ts:650-676`). The enrichment loop has no per-item guard, sits inside the `for (const repo of repos)` loop, and runs before `listPullRequests` and before any write, inside the single try wrapping the cycle. So a 403/429/404 on one SHA — force-push + GC, a secondary rate limit, or exhausting the Workers subrequest budget — loses that cycle's commits, PRs **and** reviews for every repo. Worse, the next cycle re-lists the same window and hits the same SHA, so it stalls indefinitely. The design already treats NULL churn as legitimate ("NULL means not measured", `:105-110`), so degrading is free.
- **Fix**: Wrap the `getCommitDetail` call in a try/catch that leaves `additions`/`deletions` NULL and continues to the next SHA.
- **Decision**: **FIXED** 2026-08-23 — per-item `try/catch` added around `getCommitDetail` in `run-sync.ts`; on failure the commit keeps NULL churn and the loop continues, so a single bad SHA can no longer discard the cycle's commits, PRs and reviews or stall the cursor. Typecheck, lint, 322 unit + 88 integration green. **Test gap**: no test covers the failing-SHA path — worth an integration case asserting the cycle still completes and the commit lands with NULL churn.

### F5 — The seed script's own documented usage destroys the real-credential account

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-dashboard.mjs:22,103-119`
- **Detail**: Line 22 documents usage as `EMAIL=demo@sprintflow.test npm run db:seed:demo`. Lines 103-119 then unconditionally run `delete from <t> where owner_id = $1` across 13 tables including `github_credential` and `jira_credential`. Per the plan's own runbook (plan.md:980,985), `demo@sprintflow.test` is the account holding the **real** GitHub and Jira credentials and must *never* be seeded — the fake-credential account is `adam.reszka85@gmail.com`. Copy-pasting the script's example destroys exactly what the runbook protects. `DATABASE_URL` is also unvalidated (`:69`), so a non-loopback value is accepted silently. The token encryption itself is correct (`encryptSeedToken:45-66` produces a real `v1:iv:ct‖tag` envelope with the same AAD binding as `crypto.ts`) — Phase 10 §3 is satisfied. Minor: `sync_attempt` is missing from the cleanup list, so re-seeding leaves stale attempt rows.
- **Fix**: Change the usage example to the fake-credential account, refuse to run when `DATABASE_URL` is not loopback unless an explicit override var is set, and add `sync_attempt` to the cleanup list.
- **Decision**: **FIXED** 2026-08-23 — all three applied to `scripts/seed-dashboard.mjs`: the usage example now reads `EMAIL=you@example.com` (no real account named) under an explicit DESTRUCTIVE header naming the credential tables it clears; a loopback guard rejects any non-`127.0.0.1`/`localhost`/`::1` `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1`, with an unparseable URL also refused; `sync_attempt` added to the cleanup list. `node --check` clean, lint clean.

### F6 — Manual verification is inverted: the actual S-10 deliverable is the unverified part

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/dashboard-sprint-detail/plan.md:1100-1269`
- **Detail**: Every automated criterion across all 10 phases is `[x]` and I re-ran them all green at HEAD. But 22 manual items remain unchecked, and they cluster on the wrong side: **all of Phase 4 (4.5–4.11) and all of Phase 5's manual set (5.6–5.10) are unverified** — that is the aging report, activity matrix, sub-burndowns, the Today tab retrofit, and the Reliability KPI, i.e. the entire FR-016/FR-017 deliverable this slice exists to ship. Meanwhile the *scope-extension* phases 8–10 are fully manually verified (8.6–8.11, 9.6–9.10, 10.6–10.8). Also unverified: 2.5/2.6 (burndown arithmetic), 3.5 (chart legibility), 1.7 and 7.7 (the two security spot-checks — and F3 shows 7.7 would fail), 8.12 (tablet width), 6.6. Separately, E2E last passed at `f3c4977`, but three code-bearing commits landed after it (`474d384` wizard shell, `d4da8d9` jira.ts, `9af2ed5` run-sync + migration 0007), so the suite is not current with HEAD.
- **Fix**: Work the Phase 4/5 manual rows against the seeded `adam.reszka85@gmail.com` account using the runbook (plan.md:962-1064), and re-run `npm run test:e2e` with the dev server stopped, before the PR is marked ready.
  - Strength: The runbook already says exactly which account each row needs, so this is execution, not investigation.
  - Tradeoff: It is a real manual pass, not a five-minute check.
  - Confidence: HIGH — the gap is visible directly in the Progress section.
  - Blind spot: None significant.
- **Decision**: **PARTIALLY ADDRESSED** 2026-08-23 — E2E half done, manual half still open. The dev server was stopped so Playwright could own the app with its fixture env, and the full suite ran green at HEAD **with all eight review fixes applied**: 11/11 passed (auth setup, Today tab retrofit, Sprint Detail no-sprint empty state, Sprint Detail three surfaces + matrix switcher, Settings connections, Settings single-step connect vs wizard stepper, login guard, route guard, setup GitHub, setup Jira). Dev server restarted afterwards. **Still open**: the 22 unchecked manual rows — above all Phase 4 (4.5–4.11) and Phase 5 (5.6–5.10), the actual FR-016/FR-017 deliverable — plus 1.7/7.7 network-tab spot-checks and 8.12 tablet width. Tracked as Progress item **11.15**; blocking for PR-ready.

### F7 — Two defects the plan root-caused are recorded nowhere actionable

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/sprint.ts:23-27`
- **Detail**: The plan's runbook documents two product gaps under a heading that says "record before acting" (plan.md:1033-1052), but neither reached `Follow-ups not yet planned`, `roadmap.md`, or `lessons.md` — I grepped all three. (1) `getActiveSprintRow`'s ACTIVE branch filters and `.limit(1)` with **no `orderBy`** (`sprint.ts:23-27`), so with two ACTIVE rows Postgres may return either; the fallback branch at `:34` is correctly ordered, so the ACTIVE branch was simply missed. This is reachable today — re-running `importCadence` inserts a second ACTIVE sprint rather than conflicting, since the conflict target is `jiraSprintId`. Every new S-10 surface reads through this resolver, so the slice multiplied its blast radius. (2) `run-sync.ts` contains no `insert(sprint)` at all (confirmed by grep — only the Phase 1 §3 scalar `update` at `:737`), so FR-007's "pulls sprint cadence on each sync" happens exactly once, at setup; when the team starts their next sprint SprintFlow keeps syncing the old one forever.
- **Fix A ⭐ Recommended**: Add `.orderBy(desc(sprint.startDate))` to the ACTIVE branch now (one line, matching `:34`), and file the FR-007 sprint-reconciliation gap as a roadmap row against the S-04/S-05 seam.
  - Strength: Closes the reachable nondeterminism immediately for the cost of one line; keeps the larger FR-007 gap visible instead of buried in a runbook.
  - Tradeoff: The FR-007 fix itself still isn't scheduled.
  - Confidence: HIGH — both facts verified by reading the files.
  - Blind spot: None significant.
- **Fix B**: Record both in `roadmap.md` only and change no code on this branch.
  - Strength: Keeps this branch strictly within its slice.
  - Tradeoff: Leaves a one-line nondeterminism bug live under five new read surfaces.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: **FIXED via Fix A** 2026-08-23 — `.orderBy(desc(sprint.startDate))` added to the ACTIVE branch in `src/lib/sprint.ts`, matching the fallback branch, with the reachability reasoning in a comment. The FR-007 gap is now filed as roadmap slice **S-16 `sprint-reconciliation`** (table row + full section), carrying the root-cause write-up and the note that reconciliation should avoid creating a second ACTIVE row rather than leaning on the new ordering. Typecheck, lint, 322 unit + 88 integration green.

### F8 — Performance: unbounded PR scan on both dashboards, plus per-event formatter construction

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/dashboard/activity.ts:68-75`
- **Detail**: Two compounding costs on the `max:1` pool, on the one page the plan flagged for latency measurement (5.10, unchecked). (a) The PR leg selects *every* pull request the owner has ever synced, with no range predicate. The inline comment at `:65-67` gives a correct reason (a PR opened before the window can merge inside it), but the docblock 40 lines above still claims "the range bound keeps it small" (`:22-25`) — code and doc now contradict each other. There is no index on `openedAt`/`mergedAt`, the set grows monotonically across sprints, and the current+2-sprint retention purge is not built yet. It also runs on Today for a *single-day* range. (b) `dayKeyInTimeZone` constructs a new `Intl.DateTimeFormat` per call and the `safeZone()` it calls constructs a second one just to validate (`day-bucket.ts:27-34`, `time-zone.ts:24-32`); `buildActivityGrid` calls it once per commit, twice per PR, once per review, and `dayRangeInTimeZone` binary-searches to millisecond precision (~112 constructions per call, `day-bucket.ts:64-77`).
- **Fix**: Bound the PR query with `or(between(openedAt, from, to), between(mergedAt, from, to))` — which preserves the cross-boundary case the comment protects — fix the stale docblock, and memoize formatters in a module-level `Map` keyed by resolved zone.
  - Strength: Keeps the documented correctness property while restoring the bound the plan's perf reasoning depended on.
  - Tradeoff: Three small edits across two files.
  - Confidence: HIGH — the `or(...)` form covers every case the comment names.
  - Blind spot: 5.10 was never measured, so the actual current latency is unknown.
- **Decision**: **FIXED** 2026-08-23 — all three parts applied. (a) `activity.ts` PR leg now bounded with `or(between(openedAt, from, to), between(mergedAt, from, to))`, preserving the cross-boundary case; `or` added to the import. (b) The contradicting docblock corrected — it now says the scan is unindexed and that the range bound is what keeps the *returned set* small. (c) Formatters memoized: `time-zone.ts` caches the resolved-zone verdict in a module-level `Map`, and `day-bucket.ts` caches one `Intl.DateTimeFormat` per resolved zone (keyed post-resolution, so every invalid input collapses onto the single `"UTC"` entry). Typecheck, lint, 322 unit + 88 integration green. **Still unmeasured**: 5.10 latency — the fixes should help but nobody has timed the page.

### F9 — The one write on this branch that inherits owner scoping instead of asserting it

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/integrations/sync/run-sync.ts:645-648`
- **Detail**: `tx.update(jiraProject).set({ timeZone }).where(eq(jiraProject.id, project.id))` scopes on the primary key alone. Currently safe — `project.id` came from the owner-scoped read at `:580-584` — but the project's rule is that every table carries its own `ownerId` predicate and never inherits scoping, and the sibling `sprint` update 90 lines later does it correctly with `and(eq(sprint.ownerId, ownerId), …)`. Everything else audited clean: all dashboard and settings readers scope per table, `jira_status_history` filters on both its own `ownerId` and the joined ticket's (`aging.ts:87-88`, `burndown.ts:93-94`) exactly as the plan required.
- **Fix**: Add `eq(jiraProject.ownerId, ownerId)` to the where clause.
- **Decision**: **FIXED** 2026-08-23 — `and(eq(jiraProject.ownerId, ownerId), eq(jiraProject.id, project.id))`, with a comment noting there is no RLS behind it. Typecheck + 88 integration green.

### F10 — Plan-record accuracy: three small gaps between the plan and what shipped

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/dashboard-sprint-detail/plan.md:410`
- **Detail**: (a) Phase 5 §5 required `<AnomalyInbox>` and "every prop it receives" to stay **byte-identical**, but the `syncState` prop was removed and its internal `<SyncStatusBar>` deleted (`anomaly-inbox.tsx:56-60`). This is a *plan* defect, not an implementation one — the same Contract also required the bar to sit outside the tabs, and both cannot hold at once since S-07 rendered it inside the inbox. The implementation resolved it the only non-double-rendering way and documented the reasoning in the docblock; the sort/filter body and `inbox-controls.test.ts` are untouched. (b) `sync_attempt` shipped without the `startedAt` column its Phase 7 §4 Contract lists (`schema.ts:376-388`, `0006_high_echo.sql`), so attempt duration is unrecoverable; the load-bearing part — no error-text column — is correct. (c) Three code-bearing commits landed after Phase 10 (`474d384`, `d4da8d9`, `9af2ed5`, the last adding migration `0007`) with no Progress row and no phase, while plan.md:959-960 states "`## Progress` stays canonical for what is done".
- **Fix**: Amend Phase 5 §5 to record the resolved contradiction, add `startedAt` (or drop it from the Contract), and add a short Progress entry covering the three post-Phase-10 fixes.
- **Decision**: **FIXED (docs only)** 2026-08-23 — (a) Phase 5 §5 carries an amendment stating the two clauses are mutually exclusive, that the byte-identical clause is **void** and the outside-the-tabs clause stands. (b) Phase 7 §4 Contract amended to drop `startedAt` (nothing reads attempt duration) and to accept the ascending index as equivalent. (c) New **Phase 11** section in `## Progress` records the three post-Phase-10 commits (11.1–11.3), the eight fixes applied during triage (11.4–11.12), and what triage left open (11.13–11.15).

## What audited clean

- **Cross-account isolation** across every new dashboard and settings reader — each table carries its own `ownerId` predicate; nothing reached by join alone (F9 is the sole exception, and it is a write with a safe upstream).
- **Server Action authz** — all seven exports in `settings/connections/actions.ts` call `requireSession()` first and pass `session.user.id`; no client-supplied id is trusted; `updateMonitoredRepos` and `updateJiraProject` both re-validate the selection against a fresh listing from the owner's own stored credential.
- **Pool discipline** — all five pages take exactly one `getDb(env)` and run one `Promise.all`; no `getDbWithPool` in any request path.
- **Token handling** — no decrypted token or `encryptedToken` reaches any return value, client component, or log; `getConnectionsOverview` selects neither `encryptedToken` nor `lastError`; `classifyFailure` switches on `status` only.
- **Workers safety** — no `fs`, `setInterval`, or `Buffer` in a request path; no `Date` object crosses a server→client boundary un-serialized.
- **N+1** — transitions, commits, PRs, and reviews are each a single query folded in memory.
- **`sync_attempt` prune** — a single `DELETE … WHERE id IN (SELECT … OFFSET 50)` statement, appended after the `syncState` update inside `finalizeSyncState`, with a documented never-throw `catch {}`.
- **Plan guardrails** — no second pool, no caching layer, no `usePathname`, no `timestamptz` migration, no per-status heatmap.
- **Reducer null-handling** — every rule the plan called load-bearing verified in code: null `changedAt` dropped, null category → `UNKNOWN` never a `null` key, DONE excluded from aging, first-DONE-only burn, `Σ byTrack === total`, churn null only when every contributor is null, full roster including deactivated members.
- **Extras are defensible and recorded** — the team-managed-board fix (`d4da8d9`) and the sprint-scoped delta cursor (`9af2ed5`) are real product bugs found in manual testing, both covered by new integration tests and root-caused in the plan; the roadmap closeout is honest, including the corrected S-07 row and the S-09 unblock.
