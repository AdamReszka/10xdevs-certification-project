<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Confirmation before a destructive disconnect (S-24)

- **Plan**: `context/changes/destructive-action-confirmation/plan.md`
- **Scope**: Phases 1–4 of 4 (all automated Progress rows complete)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION → **APPROVED after triage** (all 5 findings fixed 2026-08-30)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING → PASS (F1 fixed) |
| Scope Discipline | WARNING → PASS (F4 recorded) |
| Safety & Quality | WARNING → PASS (F2 documented; cost is S-21's) |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS (F3, F5 fixed) |
| Success Criteria | PASS |

Automated criteria re-run at review time: `npm test` 1087 passed · `tsc --noEmit` clean ·
`eslint` 0 errors (5 pre-existing warnings, none in touched files) ·
`manual-test-sweep.mjs` exit 0. The four Manual rows are correctly left `- [ ]` —
no rubber-stamping.

Every file in the diff appears in the plan's file list except `playwright.config.ts`
and the `DemoRefusal` type added to `src/lib/demo/refusal.ts` (see F4, F5).

## Findings

### F1 — The demo banner still promises what is false

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/organisms/demo/demo-banner.tsx:92-93`
- **Detail**: Phase 4 §2's contract was *"`demo-banner.tsx` is verified unchanged-and-now-true;
  if any wording still overstates, it is tightened rather than weakened."* The implementation
  recorded it as standing-and-true after Phase 3 gated the Connections tab. That verification
  was not actually performed against the wizard's **write** path.

  `src/app/(app)/setup/github/actions.ts` and `.../jira/actions.ts` gate **only** the two
  disconnects (`:189`, `:271`). `storeGithubIntegration` / `storeJiraIntegration` and the
  validate actions carry no demo check, and `/setup/**` has no route-level demo guard. So a
  lead viewing demo can still reach `/setup/github`, enter a PAT, and **write or replace a real
  credential** — while the banner says *"Twoje prawdziwe dane i integracje są nietknięte."*

  Gating `/setup/**` is explicitly **out of scope** (plan, *What We're NOT Doing*) and belongs to
  **S-27**. But the roadmap put the *sentence* in S-24's scope: *"the banner stops promising what
  is false"*. So the sentence is the deliverable that was missed, not the gate.

  This is the same failure mode the slice exists to close — a claim recorded as verified without
  being checked — which is why it leads the report rather than sitting in observations.
- **Fix A ⭐ Recommended**: Tighten the banner to the claim the code actually keeps — that demo
  never *reads* real data and the Connections tab cannot mutate it — dropping the unqualified
  "integracje są nietknięte", and point at S-27 in a code comment.
  - Strength: Makes the sentence true today without touching a route guard that S-27 owns; keeps
    the slice's own scope boundary intact.
  - Tradeoff: The banner gets slightly longer and less reassuring — which is the honest state.
  - Confidence: HIGH — the gap is verified by reading the two actions files; no guesswork.
  - Blind spot: Have not audited every other demo surface for the same overstatement beyond the
    panel and banner named in the plan.
- **Fix B**: Leave the wording and record the gap as an explicit S-27 item instead.
  - Strength: Zero code change; S-27 is already the named owner of `/setup/**`.
  - Tradeoff: Ships a knowingly false sentence to the user until S-27 lands, which is exactly
    what S-24 was scoped to stop.
  - Confidence: MEDIUM — defensible only if S-27 is imminent.
  - Blind spot: No date on S-27.
- **Decision**: FIXED via Fix A — banner narrowed to the claim the code keeps, with an inline comment naming S-27 as the condition to widen it again.

### F2 — The plan's performance note does not hold for the nine Server Actions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/settings/connections/actions.ts:49-55`, `src/app/(app)/setup/github/actions.ts:189-191`, `src/app/(app)/setup/jira/actions.ts:271-273`
- **Detail**: The plan states the added `resolveWorkspace()` *"is `cache()`d per render, so it
  costs at most one extra query on pages that did not already resolve the workspace."* That is
  true for the two wizard **pages**. It is **not** true for the nine **Server Actions**.

  `resolveWorkspace` calls `getDb(env)` (`src/lib/workspace.ts:117`), and `getDb` **is** the pool
  constructor (`src/lib/db.ts:26-28`). React `cache()` is per-request; a Server Action is its own
  request, so nothing shares the page render's cache. Each gated action therefore opens **one
  additional `pg.Pool` that is never closed** — `lessons.md` #3 / roadmap **S-21**, still open.

  This is not theoretical for this slice: Phase 2 had to pin `workers: 1` in `playwright.config.ts`
  because that same leak exhausts Postgres's 100 connection slots mid-run. The security fix is
  worth the cost, but the plan's note under-describes it and the next reader will trust the note.
- **Fix A ⭐ Recommended**: Correct the plan's *Performance Considerations* paragraph to say the
  extra cost is a **pool**, not a query, on the action path, and cross-reference S-21.
  - Strength: The code follows `setup/team/actions.ts:181-187` exactly — the established house
    pattern — so the pattern is right and only the written claim is wrong. Fixing the claim is
    the minimal honest change.
  - Tradeoff: Leaves the extra pools in place until S-21.
  - Confidence: HIGH — `resolveWorkspace`'s `getDb` call and `getDb`'s body are both direct reads.
  - Blind spot: Have not measured the real per-request pool count on Workers, only reasoned from
    the code.
- **Fix B**: Give `resolveWorkspace` an optional `db` parameter so an action can pass the handle
  it already builds.
  - Strength: Removes the extra pool at the nine call sites now.
  - Tradeoff: Changes a shared resolver used well beyond this slice, and the actions build their
    `db` *after* the guard runs — so it needs reordering too. Real S-21 surface, in a slice that
    declared no schema/infra work.
  - Confidence: MEDIUM — the reorder is easy; the blast radius on other `resolveWorkspace`
    callers is not audited.
  - Blind spot: Every other caller of `resolveWorkspace`.
- **Decision**: FIXED via Fix A — plan's Performance Considerations corrected: a pool, not a query, on the action path; cross-references S-21. Code unchanged (it matches `setup/team/actions.ts`).

### F3 — Two exported helpers have no consumer, and a comment claims a test that does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/molecules/disconnect-confirm.tsx:36-49`
- **Detail**: `disconnectConfirmLabel()` and `disconnectDescription()` are exported, the latter
  carrying *"Exported so a test can read it without a DOM."* Nothing in `src/` or `e2e/` imports
  either. The repo has no component-test harness (`CLAUDE.md`), and the copy is already asserted
  at fragment level in `disconnect-impact.test.ts`, so the intended test was never written.

  A comment describing a test that does not exist is the small version of the defect this slice
  spent four phases removing.
- **Fix**: Either write the DOM-free assertion the comment promises (it would pin the assembled
  sentence, which the fragment-level tests do not), or un-export both and drop the claim.
- **Decision**: FIXED — copy extracted to the pure sibling `disconnect-confirm-copy.ts` (the `CLAUDE.md` pattern for untestable `.tsx` logic) with `disconnect-confirm-copy.test.ts`, 8 assertions on the ASSEMBLED sentence.

### F4 — `playwright.config.ts` changed outside the plan

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `playwright.config.ts:42-50`
- **Detail**: `workers: process.env.CI ? 1 : undefined` → `workers: 1`. Not in the plan. It was
  required to meet criterion 2.4: the 15th test pushed the suite past Postgres's connection cap
  via the S-21 leak. Baseline was verified first — `setup-doorstep.spec.ts:133` already failed on
  the pre-change tree — so this retires a pre-existing flake rather than masking a new one. It is
  documented in the commit body, the PR, and an eight-line comment in the config naming S-21 as
  the expiry condition.
- **Fix**: None needed. Optionally record it in the plan as an addendum so a later reader finds it
  from the plan rather than only from git history.
- **Decision**: FIXED — recorded in the plan's *What We're NOT Doing* as a dated addendum explaining why the config changed and naming S-21 as its expiry.

### F5 — The copy-shape guard rejects fragments starting with a proper noun

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/integrations/disconnect-impact.test.ts:164`
- **Detail**: `expect(fragment).not.toMatch(/^[A-Z]/)` enforces "clause fragment, not bullet
  label" by banning a leading capital. It would also reject a legitimate fragment such as
  `"GitHub's synced history"`, sending a future author to rewrite valid copy or delete the guard.
  The intent (lowercase *sentence start*) is right; the rule over-reaches.
- **Fix**: Narrow the assertion to reject only a leading capital followed by a lowercase letter
  (`/^[A-Z][a-z]/`), or allow an explicit proper-noun allowlist.
- **Decision**: FIXED — guard narrowed to `/^[A-Z][a-z]/` so proper nouns pass while sentence-cased labels still fail.

## Triage outcome — 2026-08-30

All five findings fixed on `chore/archive-s24-and-roadmap-refresh`.

Re-verified after the fixes: `npm test` **1095 passed** (88 files — up from 1087/87,
the 8 new assembled-copy assertions) · `tsc --noEmit` clean · `eslint` 0 errors ·
`npm run test:e2e` **15/15**.

Two of the five (F1, F3) were the same defect this slice existed to remove — a
statement recorded as true without being checked. F1 is the sharper one: Phase 4's
contract said to *verify* the banner and the implementation reported it verified
without reading the wizard's write path. Worth remembering that the slice's own
closing phase is exactly where that mistake is easiest to make.
