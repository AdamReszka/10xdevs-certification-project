<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Disconnect Data Retention (S-26)

- **Plan**: `context/changes/disconnect-data-retention/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged 2026-08-30 (9 fixed, 1 accepted)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (re-run for this review, not taken from the plan)

| Command | Result |
|---|---|
| `npm run lint` | `src/` clean. 891 errors exist but all live in a stale `.claude/worktrees/` checkout — unrelated to this branch |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 94 files, 1182 tests |
| `npm run test:integration` | PASS — 30 files, 367 tests |
| `npm run test:e2e` | PASS — 17/17, incl. the new "two outcomes, three distinguishable controls" case |
| `npm run build` | PASS |
| `node scripts/manual-test-sweep.mjs` | exit 0 |
| local DB state | both FKs `SET NULL` (`confdeltype = n`), `monitored_repo.credential_id` nullable |

Every automated criterion in all six phases is genuinely green.

## Findings

### F1 — Roadmap IDs S-28 and S-29 collide with what PR #89 merged into main

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:62-63,577-578,1233,1269
- **Detail**: This branch's Phase 6 §3 added two proposed entries as **S-28 = cadence-override-retention** and **S-29 = reconnect-affordance**. `origin/main` — after the PR #89 merge (`d7e6b24`) — already carries **S-28 = working-day-aging** (active, shipped) and **S-29 = post-setup-cadence-surface** (proposed). Both branches edited `roadmap.md`, so the merge conflicts; resolving it carelessly leaves two different meanings for the same identifier, which `CLAUDE.md` names as the one thing that must never happen ("Roadmap IDs are the stable identifier … and never change"). Worse, main's S-29 (post-setup cadence surface) and this branch's S-28 (cadence-override retention) are about overlapping subject matter, so the collision is not just numeric. The numbers are also written in prose in `change.md:47-49`, `plan.md` ("What We're NOT Doing"), and the S-26 detail block — renumbering the table rows alone leaves those references pointing at someone else's slice.
- **Fix A ⭐ Recommended**: Rebase on `origin/main`, renumber this branch's two entries to the next free ids (S-30 / S-31), and update every prose reference in `change.md`, `plan.md` and the roadmap detail blocks in the same commit.
  - Strength: Keeps main's shipped S-28 authoritative and honours the never-reuse-an-id rule; the rebase has to happen before merge anyway.
  - Tradeoff: Touches four documents; the prose references are easy to miss — grep `S-28`/`S-29` after renumbering.
  - Confidence: HIGH — the collision is verifiable directly (`git show origin/main:context/foundation/roadmap.md`).
  - Blind spot: Whether main's S-29 (post-setup-cadence-surface) already subsumes this branch's cadence-override entry — if so the right move may be to fold it in rather than add a new id.
- **Fix B**: Drop this branch's cadence-override entry entirely and record the finding inside main's S-29 instead, keeping only the reconnect-affordance line as a new id.
  - Strength: Removes a near-duplicate roadmap entry instead of renumbering it.
  - Tradeoff: Loses the standalone framing S-26 wrote; a reader of S-29 has to notice the appended note.
  - Confidence: MEDIUM — depends on reading main's S-29 text carefully.
  - Blind spot: Have not diffed the two entries' scope in detail.
- **Decision**: FIXED via Fix A — merged `origin/main` into the branch (rather than rebasing, since PR #88 is already pushed), resolved both conflicts keeping main's shipped ids, renumbered this branch's entries to **S-30** (cadence-override-retention) and **S-31** (reconnect-affordance), and updated every prose reference: `change.md`, Open Roadmap Question 4, and S-30's `Overlaps S-19` cross-reference (that clause is main's S-29 now). `manual-test-backlog.md` had the same collision at section level — main's §21 (`working-day-aging`) keeps its number, S-26's became **§22**, rows `21.A–21.F` → `22.A–22.F`, and the two pointers in `MANUAL-CHECKLIST.md` follow.

### F2 — The Phase 5 freeze restore can adopt a foreign sprint's commitment

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/reconcile-sprint.ts:234-246
- **Detail**: The new read-back matches `sprint_measurement` on `(owner_id, jira_sprint_id)` only. Jira sprint ids are unique per Jira **instance**, not globally — so an owner who reconnects against a *different* Jira workspace can match a measurement written for an unrelated sprint, seeding `committed_sp` and `committed_frozen_at` from it. Because `run-sync.ts`'s freeze guard then correctly refuses to re-freeze an already-stamped row, the wrong commitment is permanent and flows into `sprint_measurement` and FR-024 — the exact corruption class Phase 5 exists to prevent, reached through a different door. `sprint_measurement.jira_project_id` is the **Jira-side** key and deliberately not an FK (`schema.ts:483`), so it survives a reconnect and is usable as the guard; the sweep writes exactly that value (`src/lib/measurement/sweep.ts:175`) and `projectKey` is already a parameter at the lookup site (`reconcile-sprint.ts:121`).
- **Fix**: Add `eq(sprintMeasurement.jiraProjectId, projectKey)` to the `and(...)` at `reconcile-sprint.ts:241-245`, and add a regression case seeding a measurement under a different project key that must NOT be restored.
  - Strength: One line, uses values already in scope, and closes the only path by which the restore can read a record it does not own.
  - Tradeoff: None functional — same index, same round trip.
  - Confidence: HIGH — `jiraProjectId` is documented as the Jira-side id and the sweep's writer was checked.
  - Blind spot: Whether any existing `sprint_measurement` row predates the `jira_project_id` column being populated; if NULLs exist, the added predicate would skip a legitimate restore.
- **Decision**: FIXED — the lookup is now scoped by project through a join on `jira_project`, bridging the internal `projectId` this function is handed to the Jira-side id `sprint_measurement` stores. (The first attempt compared `projectKey` directly and was wrong: the column holds the numeric project id, not the key.) Regression `(t)` added to `reconcile-sprint.integration.test.ts`, and verified non-vacuous — it fails both with the `jiraProject.id` predicate removed and with the scoping removed entirely.

### F3 — Disconnecting GitHub silently stops the Jira sync and the daily recap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/sync/scheduled.ts:67-74
- **Detail**: `enumerateOnboardedOwners` INNER JOINs `github_credential` onto `jira_project`, so an owner with no GitHub credential drops out of the scheduled cycle entirely — Jira stops syncing, anomalies stop refreshing, and `sendDailyRecap` (driven by the same loop) stops firing, with no signal anywhere. This is pre-existing, but the slice changes its likelihood by design: GitHub disconnect is now advertised as safe and reversible ("Keep my GitHub data"), so leads will deliberately sit in that state while rotating a PAT. Nothing in the new keep-branch copy warns that the *other* integration goes quiet too.
- **Fix A ⭐ Recommended**: Enumerate on `jira_project OR github_credential` (LEFT JOIN + a presence filter) so a Jira-only owner still syncs, and let `syncGithub`'s existing `SKIPPED/not_connected` branch handle the missing half.
  - Strength: The per-integration skip already exists (`run-sync.ts:390-411`), so the loop degrades correctly with no new concept; fixes the recap outage too.
  - Tradeoff: Widens what the cycle attempts, and the demo-exclusion rationale in the same docstring has to be rewritten anyway (see F4).
  - Confidence: MEDIUM — the enumeration is also the recap driver, so the change wants its own integration case.
  - Blind spot: Whether any downstream step in `runScheduledSync` assumes both credentials exist.
- **Fix B**: Leave the loop and say it in the dialog copy — add a `keeps`/`destroys` clause naming that syncing pauses for both integrations until you reconnect.
  - Strength: Small, and honest about behaviour the lead can then plan around.
  - Tradeoff: Documents a defect rather than fixing it; the recap silence remains.
  - Confidence: HIGH — the copy layer is already the single source for these clauses.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `enumerateOnboardedOwners` now LEFT JOINs both tables and admits an owner holding EITHER integration, so a GitHub disconnect no longer silences the Jira sync and the daily recap. Two integration cases added; the demo-exclusion docstring is rewritten, since `demo_of IS NULL` is now the only thing doing that job.

### F4 — Four docstrings still describe the pre-`0021` cascade

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/organisms/setup/jira-connection-status.tsx:28-33
- **Detail**: Phase 6's stated purpose was that "every sentence in the repo that describes the old behaviour is corrected in the same branch as the behaviour", and manual row 6.6 is "No document still claims a disconnect destroys absences unconditionally". Four sentences still do:
  - `jira-connection-status.tsx:28-33` — "Disconnect is DESTRUCTIVE five levels deep … and — the sharp edge — the lead's hand-entered absences, which no sync rebuilds." Unconditional, and this file was edited by this branch.
  - `github-connection-status.tsx:26-29` — "DESTRUCTIVE four levels deep … the credential takes `monitored_repo` with it, and that takes every synced commit, pull request and code review." False since `0021`.
  - `absence-store.ts:130-132` — "The stamp is still written because `absence.sprint_id` is `ON DELETE CASCADE` on `sprint` — the data-loss path S-26 owns." The edge is `SET NULL` now and S-26 has landed, so the stated reason for writing the stamp no longer exists.
  - `scheduled.ts:58-61` — the demo-exclusion guard's justification rests on "`github_commit.repo_id → monitored_repo.credential_id → github_credential.id` is NOT NULL the whole way". `0021` falsified that premise. The guard still works (the demo fixture inserts a credential), but a security-relevant rationale that is no longer true is the one worth fixing first.
- **Fix**: Correct all four in one commit, pointing at `disconnect-impact.ts` for the list as the surrounding comments already instruct, then tick manual row 6.6.
- **Decision**: FIXED — all four corrected (`scheduled.ts` as part of F3), plus a fifth found while sweeping: `detect.integration.test.ts:560` still explained a test setup by the old cascade. Manual row 6.6 ticked.

### F5 — Manual rows 4.6 / 4.7 were ticked in the implementation commit, ahead of their own precondition

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/disconnect-data-retention/MANUAL-CHECKLIST.md:163,205
- **Detail**: `git log -S` shows both rows flipped to `- [x]` in `92ef756` — the same commit that implemented Phase 4 — in both `plan.md` `## Progress` and the checklist, with no separate tester session. Row 4.6 requires a live Jira account with two projects and an actual project switch. The checklist's own Phase 4 preamble states that row 1.7 (migration applied) "musi być zrobiony **przed** tymi dwoma", and 1.7 is still open. So the two rows are ticked ahead of the precondition their own text names, which makes the sweep's picture of what remains to test wrong by two rows.
- **Fix**: Un-tick 4.6 and 4.7 in both files and let them run in a real tester session after 1.7, or record in the checklist what was actually observed and when.
- **Decision**: FIXED — 4.6 and 4.7 re-opened in both `plan.md` `## Progress` and `MANUAL-CHECKLIST.md`; the sweep's canonical count moved 174 → 175.

### F6 — `clearedTables` is a hand-written literal gated by a new hand-set flag

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/integrations/disconnect-impact.ts:31-54,115-120,158,200
- **Detail**: The plan was emphatic (plan-review F4) that `clearedTables` be purely mechanical — "for every entry in `weakenedTables`, that table plus its own cascade closure" — precisely because hand-maintained lists in this module had drifted in four places before S-24. The implementation instead declares literal arrays and adds a per-edge `clearedOnClear: boolean` to `WeakenedRef`. It departed for a reason the plan missed and the code documents at length: the plan's own formula would sweep `daily_recap` into `clear` for both Jira roots, silently undoing S-12/`0019`. The safety property survives — the guard at `disconnect-impact.test.ts:185-203` still holds the literal equal to the derivation, and `WeakenedRef` gives the flag no default, so a future weakened edge is *forced* to decide rather than being quietly omitted. Recorded so the deviation is signed off rather than absorbed: the plan's stated invariant no longer holds as written.
- **Fix**: Accept and note it in `change.md`'s "what shipped" section, so a later reader of the plan is not confused by the mismatch.
- **Decision**: ACCEPTED — the deviation is the better call and is now recorded in `change.md` so a later reader of the plan is not confused by the mismatch.

### F7 — `clear` deletes every absence the owner has, which is broader than the old cascade the docstrings compare it to

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/jira-store.ts:325
- **Detail**: Both clear branches run `delete(absence).where(eq(absence.ownerId, ownerId))` (`jira-store.ts:325`, `connection-service.ts:456`) — every absence, including rows whose `sprint_id` was already NULL, which the old cascade could never reach. The **behaviour is right**: the frame's whole complaint about the old cascade was that it destroyed "an arbitrary early-adopter subset decided by *when* the row was typed", and the button says "Delete my Jira data" without qualification. The two docstrings are what is wrong — `jira-store.ts:300` calls it "the one thing the narrowed edge spared" and `connection-service.ts:366` calls it "what the old cascade did by accident"; both describe a smaller set than the code deletes.
- **Fix**: Correct the two sentences to say the wipe is owner-wide and deliberately broader than the cascade it replaces.
- **Decision**: FIXED — both docstrings now say the wipe is owner-wide and deliberately broader than the cascade, and why.

### F8 — The migration's rollback story is incomplete

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/changes/disconnect-data-retention/plan.md:838-841
- **Detail**: `## Migration Notes` says rollback is "re-point both constraints at `ON DELETE cascade`". That leaves `monitored_repo.credential_id` nullable, and restoring `SET NOT NULL` will **fail** once any keep-disconnect has happened, because those rows hold NULL. A rollback attempted under pressure would hit that error mid-way.
- **Fix**: State it as three ordered steps — backfill or delete `monitored_repo` rows with a NULL `credential_id`, then `SET NOT NULL`, then re-point the constraints — keeping the existing "prefer rolling forward" note.
- **Decision**: FIXED — `## Migration Notes` now gives three ordered rollback steps, NULLs first.

### F9 — `e2e/disconnect.ts` justifies its destructive default with a false claim

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/disconnect.ts:3-16
- **Detail**: The docstring defaults the helper to `clear` because, it says, `keep` leaves the shared `storageState` account onboarded — "`monitoredRepo` (one of `isOnboardingComplete`'s six probes) stays satisfied". `isOnboardingComplete` is `ONBOARDING_PROBES.every(...)` (`src/lib/onboarding.ts:110`) and `githubCredential` is also a probe (`:45`), so a keep-disconnect deletes the credential and un-onboards the account regardless. The two specs it cites are the second half of the error: `seed.spec.ts:34` and `dashboard-sprint-detail.spec.ts:51` are the comments explaining those specs moved to their **own** accounts precisely because the shared account's onboarding state is a coin flip — they do not rest on it. The default itself is harmless (and on the Jira side it wipes absences on the shared account for no stated reason), but this is exactly the stale-rationale class Phase 6 existed to remove.
- **Fix**: Rewrite the docstring to the real reason (leave the shared account genuinely empty), or narrow the default per integration and pass `"keep"` at the two Jira call sites.
- **Decision**: FIXED — the docstring now names leftover DATA as the reason for the destructive default, and explicitly records that onboarding state is NOT the reason and that the two cited specs no longer use the shared account.

### F10 — The measurement lookup runs on every reconcile, not only on insert

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/reconcile-sprint.ts:234
- **Detail**: The plan scoped the read-back "on insert (not on the metadata refresh path)" and costed it at "at most once per sprint per owner" (`## Performance Considerations`). The `SELECT` in fact runs on every reconcile cycle — 15 minutes per owner — while `restoredFreeze` is consumed only by the INSERT branch (`onConflictDoUpdate.set` correctly omits both columns). Behaviour is right; it is a wasted round trip in the steady state, and over Hyperdrive round trips are the cost.
- **Fix**: Add `jiraSprintId` to the `previous` select at `reconcile-sprint.ts:199` and skip the lookup when `previous.jiraSprintId === jiraSprintId`.
- **Decision**: FIXED — an `isRecreate` guard skips the lookup when the owner's newest sprint row already carries this `jiraSprintId`, i.e. when the upsert is heading for its UPDATE branch and the answer could only be discarded.

## Notes not raised as findings

- **`src/app/(app)/settings/connections/actions.ts` and `jira-project-editor-copy.ts(+test)` are unplanned files, both justified.** The first had to change to thread the mode into `updateJiraProject` — a plan gap (Phase 4 never named it), implemented correctly including `parseDisconnectMode`. The second is the pure-`.ts`-sibling extraction `CLAUDE.md` mandates for decision logic and copy in a `.tsx`, mirroring `disconnect-confirm-copy.ts`, and is what makes Phase 4's two-button copy assertable at all.
- **`settings/connections/page.tsx` did not need editing** despite being listed in Phase 3 §3 — the widened Server Action signature already satisfies the widened prop type.
- **The accessible-name audit is clean.** `Cancel` / `Keep my {X} data` / `Delete my {X} data` are mutually non-containing and none contains the trigger's `Disconnect`; the property is pinned per integration in `disconnect-confirm-copy.test.ts:45-63`, and `setup-github.spec.ts:172-185` asserts it from the browser side with deliberately non-`exact` `toHaveCount(1)`.
- **Dialog footer DOM order is `Cancel` → destructive → primary** (`confirm-dialog.tsx:110-133`), so one Tab from the focused Cancel lands on the destructive button ahead of the safe default. It matches the existing `roster-editor.tsx` prior art and is written into checklist row 3.6 as the expected order, so it is deliberate — noted only because the slice's premise is that destruction is reached by name.
- **`settings/connections/actions.ts` still passes `mappings` through unvalidated** while the sibling `setup/jira/actions.ts:253` runs `statusMappingSchema.safeParse`. Pre-existing and not exploitable (the pgEnum rejects a bad category), but conspicuous now that `mode` is parsed in the same signature.
- **Everything in "What We're NOT Doing" was respected** — `anomaly` and `status_mapping` stay in the cascade, `sprint_measurement` is deleted by neither branch and is explicitly asserted surviving in both integration suites, the cadence override is untouched, the affordance problem is untouched, and zero demo files appear in the branch diff.
