<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cadence after setup (S-29)

- **Plan**: `context/changes/post-setup-cadence-surface/plan.md`
- **Scope**: Phases 1–5 of 5 (all automated Progress rows ticked; 10 manual rows open by design)
- **Date**: 2026-08-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run at review time)

| Command | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 4 warnings, all in pre-existing `src/lib/anomaly/**` files untouched by this slice |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 98 files, 1350 tests |
| `npm run test:integration` | PASS — 30 files, 381 tests |
| `npm run test:e2e` | PASS — 20/20 |
| `npm run build` | PASS — `/team/cadence` present as a dynamic route |
| `node scripts/manual-test-sweep.mjs` | PASS — exit 0 |

## Grounding

Every phase contract was checked against the file on disk, not against the
commit message.

**Phase 1 — MATCH.** `saveCadence` (`roster-store.ts:1062-1098`) resolves through
`getActiveSprintRow`, keys the UPDATE on `and(eq(sprint.id, row.id),
eq(sprint.ownerId, ownerId))`, returns `{updated, overridden}`, and spreads
`...(overridden ? { cadenceOverridden: true } : {})` so an unchanged save omits
the column rather than writing `false`. `sameCadence` (`:1027`) runs the stored
side through `cadenceFromRow`'s defaults and canonicalises weekdays Mon→Sun, so
a NULL row confirmed with the page's defaults is not an edit and a reordered set
is not an edit. `NoSprintRowError` is exported at `:585`. `"no_sprint"` is on
`ActionFailure["error"]` and mapped in the shared `toFailure`, so the restore
path inherits it.

**Phase 2 — MATCH.** `0022_unfreeze_cadence_override.sql` is a single unqualified
`UPDATE "sprint" SET "cadence_overridden" = false;`, with the journal entry and
`0022_snapshot.json` both tracked (the snapshot arrived in the follow-up commit
`57d5031`). The production-migration row is first in `MANUAL-CHECKLIST.md`, naming
the Supabase MCP route and the hand-written `drizzle.__drizzle_migrations`
bookkeeping.

**Phase 3 — MATCH, including the part that is easy to get wrong.**
`forceCadenceRefresh` defaults `false` (`reconcile-sprint.ts:142`); the else-branch
of the CONFLICT `set` is character-for-character the old SQL, and that is pinned
by a test rather than by a comment. Under the flag the three `case when` wrappers
are dropped and `cadenceOverridden: false` rides in the *same* SET, inside the
existing transaction; the INSERT branch's `carry` is guarded by
`!forceCadenceRefresh` so a restore racing a rollover cannot resurrect the
override. `restoreCadenceFromJira` performs no UPDATE of its own — a failing
`fetchImpl` leaves both the values and the flag untouched, asserted in
`roster-store.integration.test.ts`.

**Phase 4 — MATCH.** `cadence-editor-view.ts` has zero imports (pure, no React, no
`Date`), a discriminated union over the four states, and a restore outcome that
keys on `pulled` rather than `noActiveSprint` — a deliberate improvement over the
plan's wording, because `board_ambiguous` returns `noActiveSprint: false` while
writing nothing. The `nothing_to_pull` body says the override is still in place
and never claims auto-pull is back. `/team/cadence` mirrors `team/days-off/page.tsx`:
one `getDb`, `resolveWorkspace()`, `Promise.all([getActiveSprintRow,
getJiraTimeZone])`, `toSprintIdentity` server-side, no re-declared `requireSession`
or `force-dynamic`. The editor uses shadcn/ui throughout (`Alert`, `Button`,
`Card`, `Form`) plus the `ConfirmDialog` molecule, with no `router.push` and no
`exitDemoAction`.

**Phase 5 — MATCH.** The wizard swap is a behavioural no-op: `"Save & finish
setup"`, `exitDemoAction()`, the `/dashboard` push, the board chooser and the
auto-pull effect are all intact, and the `provenance` flag is off in the wizard so
no new copy appears there. `jira-project-editor.tsx` now links `/team/cadence` and
its stale seam comment was rewritten. The doorstep detail names the Team section
and the new test asserts it.

**Safety.** `/team/cadence` inherits `requireSession()` + `force-dynamic` from
`(app)/layout.tsx`; every read and write is owner-scoped, and `saveCadence` keeps
its `owner_id` predicate even though the id came from an owner-scoped read
(`lessons.md` corollary (a)). `restoreCadenceAction`'s return payload mirrors
`importCadenceAction` field for field — no token in any branch, and the demo
refusal fires before any Jira client is constructed. The demo policy matches the
file's own stated rule (`actions.ts:72-75`): cadence writes follow
`resolveWorkspace()`, credential-spending actions use `requireRealWorkspace` +
`demoRefusal`.

**Scope.** No unplanned `src/` file. `actions.demo.test.ts` is not named in any
phase's Changes Required, but Phase 3's criterion 3.8 has no other home — not
creep in substance. Every "What We're NOT Doing" boundary holds: no account-level
cadence model, no placeholder sprint row, no explicit sync toggle, nothing
touching S-17 / S-18 / backlog 28.A.

## Findings

### F1 — Phase 1's comment rewrite did not land, and the stale text is what misled this slice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/app/(app)/setup/team/actions.ts:412`, `:432-439`
- **Detail**: Phase 1 §2 names the rewrite as a contract item: *"It is rewritten
  here, in the phase that touches the function, to name both callers and to
  record that `no_roster` is reachable only from the wizard."* Neither edit was
  made. The docblock at `:412` still reads *"Persist the user-confirmed /
  overridden cadence (flips `cadence_overridden`)"* — it no longer flips it, which
  is the entire point of Phase 1. The comment at `:432` still opens *"THIS IS WHAT
  FINISHES THE WIZARD"* and never mentions `/team/cadence`, now a second caller
  for which the `no_roster` branch and its wizard-specific copy ("Save your team
  roster first…") are unreachable rather than merely unlikely. This is not a
  cosmetic nit by this repo's own standard: the plan's Current State Analysis
  cites *this comment* as the evidence that the flag meant the wrong thing, so
  leaving it stale re-arms the thing that hid the defect for four slices.
  Documentation only — the code contract it describes is correct.
- **Fix**: Rewrite both. The docblock becomes "flips `cadence_overridden` only on
  a real edit"; the `:432` block names `/team/cadence` as the second caller and
  records that `no_roster` is a wizard-only refusal.
- **Decision**: FIXED — both comments rewritten in `actions.ts`. The docblock now
  records that the flag flips only on a real edit and why that mattered; the
  guard's comment names both callers, keeps the wizard-only wording deliberately,
  and states that the `no_roster` refusal is UNREACHABLE from `/team/cadence`
  (an onboarded lead always has a `team_member` row). Documentation only — no
  behaviour changed.

### F2 — The cadence defaults exist in four hand-copied places, and the dirty-check's correctness rests on them agreeing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/integrations/roster-store.ts:80-84`; `src/app/(app)/team/cadence/page.tsx:47-56`; `src/app/(app)/setup/team/page.tsx:69-77`; `src/lib/integrations/roster-store.integration.test.ts:520-524`
- **Detail**: `DEFAULT_CADENCE` (`14` / `"MON"` / `DEFAULT_WORKING_DAYS`) is a
  module-private `const` in `roster-store.ts`. Both page components hand-roll the
  same triple as literals — including the working-days array, even though
  `DEFAULT_WORKING_DAYS` is already exported from `cadence.ts` — and the
  integration test hardcodes it a fourth time. The plan's Phase 1 §1 contract
  requires that *"both sides of that comparison are normalised through the same
  defaults the read applied"*. Today they are, by coincidence of four matching
  literals; nothing in the repo binds them. `team/cadence/page.tsx:45-47` even
  asserts the relationship in a comment ("`saveCadence`'s dirty-check normalises
  against exactly these defaults") — a promise held by prose. The failure is
  asymmetric: a change to `DEFAULT_CADENCE` alone breaks the existing test, but a
  change to a *page's* prefill alone breaks nothing.
- **Failure scenario**: a later slice changes the sprint-length prefill from `14`
  to `10` on the two page components and misses the module-private
  `DEFAULT_CADENCE`. A lead opens `/team/cadence` on an account whose
  `length_days` is NULL, sees `10`, presses Save without touching anything;
  `sameCadence` compares `10` against `14`, scores a confirmation as an edit, sets
  `cadence_overridden = true` and cuts the account off FR-007's auto-pull — the
  exact defect this slice exists to close, one layer up, and no suite goes red.
- **Fix**: Export `DEFAULT_CADENCE` from `roster-store.ts` (or lift it beside
  `DEFAULT_WORKING_DAYS` in `cadence.ts`, which already owns one third of it) and
  have both pages and the test spread it instead of restating the literals.
  - Strength: turns the comment's promise into a compile-time fact; one symbol,
    four call sites, no behaviour change.
  - Tradeoff: a store constant becomes public API of that module.
  - Confidence: HIGH — `DEFAULT_WORKING_DAYS` is already exported and consumed
    this way from `cadence.ts`, so the shape has precedent in the same domain.
  - Blind spot: none significant; `npm test` + `test:integration` cover the
    substitution.
- **Decision**: FIXED — `DEFAULT_CADENCE` was lifted out of `roster-store.ts` and
  is now exported from `src/lib/integrations/cadence.ts`, beside the
  `DEFAULT_WORKING_DAYS` it already contained, carrying the reason it must stay
  the single spelling. All four consumers spread it: `roster-store.ts` imports it
  instead of defining its own, both page components coalesce through
  `DEFAULT_CADENCE.lengthDays` / `.startDay` / `[...workingDays]`, and
  `roster-store.integration.test.ts`'s `DERIVED` is built from it rather than
  restating the triple — which is what closes the asymmetry, since that test was
  the only guard and it pinned the literal. The constant keeps its own copy of the
  weekday array, so no caller can mutate `DEFAULT_WORKING_DAYS` through it.
  Behaviour unchanged.

### F3 — Nothing automated proves `/team/cadence` is reachable

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/app/(app)/team/layout.tsx:24-27`
- **Detail**: The slice's headline outcome is that the screen is *reachable*, and
  the tab entry is plain data — a wrong `href` or a dropped entry is caught only
  by manual row 4.6. The plan scoped it that way deliberately and the e2e suite
  ran green as a regression gate, so this is not drift. It is worth noting only
  because the suite already does exactly this kind of nav assertion cheaply
  elsewhere (`setup-doorstep.spec.ts`, `dashboard-sprint-detail.spec.ts:200`), and
  `lessons.md` asks for a guard where the suite can reach it.
- **Fix**: If it is picked up, add one Playwright case to an existing spec: from
  `/team`, click the "Sprint cadence" tab and assert the heading renders. Defer to
  a follow-up if the manual row covers it in time.
- **Decision**: SKIPPED — manual row 4.6 covers reachability, and the plan scoped
  it as manual deliberately. Recorded here so a later slice adding e2e around
  `/team` knows the gap is known rather than overlooked.

## Notes on process

The safety/pattern sub-agent hung without producing a report and was stopped; its
scope (auth and owner-scoping on the new route and actions, token leakage,
migration blast radius, `forceCadenceRefresh` call-site audit, shadcn/ui and pure-
module pattern compliance) was carried out directly and is recorded under
**Grounding** above.
