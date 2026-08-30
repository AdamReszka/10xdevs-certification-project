<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sprint Identity Visibility (S-25)

- **Plan**: `context/changes/sprint-identity-visibility/plan.md`
- **Scope**: full plan — Phases 1–5 of 5
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 1 critical · 0 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

**Plan Adherence** — all 17 planned changes verified MATCH against the plan's
stated contracts, judged on substance. `labelFor` was genuinely moved rather
than copied (one definition repo-wide); the `measurement-only` and `selected`
branch fallbacks are asserted at branch level, both cases; the `none` copy
`Sprint: none active` is unique in `src/` and `e2e/`.

**Scope Discipline** — every "What We're NOT Doing" guardrail held, verified by
empty diffs: no migration, `settings/absences/` untouched, `sync-status-bar.tsx`
and `integration-card.tsx` untouched, `src/lib/sprint.ts` unmodified (Phase 4
adds a caller, it does not change resolution behaviour), no time-of-day anywhere
in the identity path.

**Success Criteria** — the plan's own four automated gates pass locally. The
WARNING is F1: the repo's CI runs an integration suite this worktree is
forbidden to run, and it was red.

## Findings

### F1 — Phase 2 broke an integration test the worktree cannot run

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/measurement/sprint-switcher.integration.test.ts:412`
- **Detail**: `resolveSprintSelection`'s return shape gained `startDate` and
  `endDate` in Phase 2. A second test file asserts that shape with a full
  `toEqual`, and it was missed — the unit sibling `sprint-selection.test.ts` was
  updated, this one was not. CI on PR #79 reported `integration` **fail**
  (1 failed / 336 passed) while `test`, `bundle-size` and Workers Builds all
  passed. `npm run typecheck` cannot catch it: a `toEqual` shape mismatch is a
  runtime assertion, not a type error. This is a direct consequence of the
  parallel-worktree rule forbidding `test:integration` here — the class of
  breakage that rule makes invisible locally.
- **Fix**: Add the two expected date fields to the assertion, and strengthen it
  to the branch guarantee — the dates come from the measurement record and
  explicitly not from the active sprint.
  - Strength: Restores the gate and makes the test say more than it did before;
    unlike the unit test, these values have actually round-tripped through
    Postgres.
  - Tradeoff: None — the assertion was under-specified, not wrong.
  - Confidence: HIGH — mirrors the assertion already added to the unit sibling.
  - Blind spot: Still not executable from this worktree; re-verified only by CI.
- **Decision**: FIXED — applied during review (`6cfaf40`). Swept the remaining
  integration tests for the same class of pin: `roster-store`, `build`, `send`,
  `retention`, `reconcile-sprint` — none asserts the shape of a changed type or
  a literal recap subject, so this was the only casualty.

### F2 — `formatRange` does not guard `startDate > endDate`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/sprint-identity.ts:98-113`
- **Detail**: A reversed pair renders as a reversed range (`13.09 – 30.08`)
  rather than being normalised or withheld. Not reachable today — both endpoints
  come from Jira via the database, never from user input — and not a regression
  this diff introduces, since the dates rendered nowhere before it. No test
  covers it.
- **Fix**: Return `null` when `endDate < startDate`, with a test — the same
  "say nothing rather than something wrong" rule the `none` case already
  follows.
- **Decision**: PENDING

### F3 — a nameless sprint loses its date range in the recap email

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/recap/render.ts:76-90`
- **Detail**: `RecapSprint` carries no `jiraSprintId`, so `sprintIdentityLine`
  passes `jiraSprintId: null`. On a sprint Jira left nameless the reducer
  therefore returns `kind: "none"` and the email prints no identity line at all
  — including the date range, which the payload *does* have. The dashboards
  render `Sprint <id> · 30.08 – 12.09` for the same sprint, so the two surfaces
  disagree in exactly the case this slice exists to make consistent. This
  follows the plan as written (FR: make no identity claim when the name is
  unknown) and is a narrow edge, but it is an asymmetry worth recording.
- **Fix A ⭐ Recommended**: Leave it, and record the reason in the code comment
  — a bare date range with no name attached is not an identity, and inventing
  one from a field the payload does not carry would be worse.
  - Strength: Matches the slice's own principle — claim nothing you cannot
    verify. No payload change, no schema-version question reopened.
  - Tradeoff: The email stays quieter than the dashboards on a rare sprint.
  - Confidence: HIGH — the alternative needs a payload field that does not exist.
  - Blind spot: How often Jira actually yields a nameless sprint is unmeasured.
- **Fix B**: Add `jiraSprintId` to `RecapSprint` as another optional field, so
  the email can say `Sprint 1042` like the dashboards do.
  - Strength: Removes the asymmetry outright; the field is already in hand at
    build time.
  - Tradeoff: A third optional payload field for an edge case nobody has hit;
    reopens the stored-payload compatibility surface Phase 5 deliberately kept
    narrow.
  - Confidence: MEDIUM — mechanically easy, but the value is speculative.
  - Blind spot: Not covered by any current test or manual row.
- **Decision**: PENDING
