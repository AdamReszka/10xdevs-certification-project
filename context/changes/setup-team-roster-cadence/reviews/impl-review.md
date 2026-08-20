<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04 — Setup Wizard: Team Roster + Sprint Cadence

- **Plan**: context/changes/setup-team-roster-cadence/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Date**: 2026-08-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- **Changed files** map 1:1 to the plan's file list (plus test siblings + the planned `ui/table.tsx` shadcn primitive). No unplanned files.
- **Automated success criteria** (all phases): `npm run lint` clean, `npm run build` clean, **89 unit tests** + **22 integration tests** pass.
- **Lessons honored**: reads-before-transaction (all network reads precede `db.transaction` in `importRoster`/`importCadence`); cap + cross-origin check on `listCollaborators`; no nullable-column UNIQUE dedup key (sprint upsert keyed on NOT-NULL `(ownerId, jiraSprintId)`; roster merge is app-level).
- **Security**: decrypted tokens live only in local vars, never returned/logged/thrown (integration-asserted); actions return non-secret shapes only.
- **Scope discipline**: every "What We're NOT Doing" boundary respected (no migration, no threshold settings, no absence calendar, no standalone Setup nav, no wizard routing/gate, no pool teardown, no crypto changes, manual-merge-only dedup).

## Findings

### F1 — Scrum-board filter lives in the client reader, not the store's board-selection step

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/jira.ts (`listBoards`, `board.type === "scrum"` filter)
- **Detail**: The plan's Critical Implementation Details described the `type == "scrum"` filter under "Board selection" in the store (`importCadence`). It was instead implemented inside `listBoards`, which returns scrum-only boards. This is functionally equivalent (the store counts scrum boards for auto-vs-chooser exactly the same way), is documented in the reader's JSDoc, and satisfies the Phase-1 "scrum-filter" unit-test criterion. No behavioral difference; `importCadence` never assumes unfiltered boards.
- **Fix**: None needed. Optionally add a one-line note to the plan that the scrum filter was pulled into `listBoards`.
- **Decision**: FIXED — added an impl note to the plan's Board-selection detail.

### F2 — Partial GitHub read still seeds members while showing the degradation banner

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/integrations/roster-store.ts (`importRoster` GitHub try/catch)
- **Detail**: If `listCollaborators` succeeds for repo #1 then throws for repo #2, the catch sets `githubDegraded = true` but the already-collected repo-#1 logins remain in `githubLogins` and are still seeded. The result is a partial GitHub seed *plus* the "add members manually" banner — mildly inconsistent messaging. Behavior is benign (partial data is better than none; the banner is still accurate that GitHub was incomplete), and the common cases (all-repos-succeed or first-call-403) are unaffected.
- **Fix**: Leave as-is (partial seed is useful), or clear `githubLogins` in the catch so degradation means "no GitHub members." Reviewer's call — both are defensible.
- **Decision**: SKIPPED — partial GitHub data is useful; the banner accurately reports an incomplete read.
