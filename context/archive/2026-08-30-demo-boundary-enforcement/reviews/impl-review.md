<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-27 — The demo boundary is a gate, not a convention

- **Plan**: `context/changes/demo-boundary-enforcement/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria run at review time

| Check | Result |
|---|---|
| `npm run lint` | pass — 0 new problems (count identical to the pre-branch baseline) |
| `npm run typecheck` | pass |
| `npm test` | pass — 1132 tests / 91 files, inventory test included |
| `npm run test:integration` | pass — 340 tests / 30 files |
| `npm run test:e2e` | pass — 16/16, including `demo-boundary.spec.ts` |
| `node scripts/manual-test-sweep.mjs` | exit 0 |

The E2E suite had not been run since Phase 4 made the doorstep's demo-door label
dynamic (`DEMO_TRANSITION_LABEL`); Phase 2's E2E criterion was signed off at
`4524f94`, two commits earlier. Re-running it here closes that gap — green.

Phase-1 negative controls were checked individually: all five newly-guarded
actions have one (`validateGithubToken`, `validateJiraCredentials` and
`fetchProjectStatuses` assert the service was reached; `storeGithubIntegration`,
`storeJiraIntegration` assert they reach the throwing Cloudflare-context mock).

Eight `#### Manual` rows remain `- [ ]` across phases 1–4. Correctly unchecked —
no rubber-stamping — and all eight are carried in
`context/foundation/manual-test-backlog.md` §18 as 18.A–18.I.

## Findings

### F1 — The inventory test's module predicate is narrower than the rule it enforces

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/demo/boundary-inventory.test.ts:126` (`actionModules`), `:86` (`topLevelFunctions`)
- **Detail**: The scan enumerates `src/**/actions.ts` and matches only
  `export async function` declarations. A `"use server"` module named anything
  else, or an action written `export const foo = async () => {}`, is invisible to
  it — and would ship unguarded, which is the exact omission class Phase 5 exists
  to stop. Verified nothing violates this today: all 13 `"use server"` files
  except two incidental matches are named `actions.ts`, and every exported action
  is `export async function`. So this is a future hole, not a live one — but it
  is the same shape as `lessons.md`'s "a narrowing predicate turns 'wrong value'
  into 'empty result', which reads as success", applied to the enforcement
  itself. The existing per-module assertion covers the arrow case only when a
  module has *no* detected action at all; a module mixing one arrow action into
  guarded declarations still passes.
- **Fix**: Derive `actionModules()` from the presence of `"use server"` in the
  file rather than from the `actions.ts` filename, and additionally fail when a
  `"use server"` module mentions `requireRealWorkspace(` but the function scanner
  attributes it to no exported function.
  - Strength: Makes the predicate match the rule's own wording ("every exported
    Server Action"), and costs one changed glob plus one assertion.
  - Tradeoff: The scan reads ~13 files instead of ~6; still milliseconds.
  - Confidence: HIGH — the file set was enumerated and the two incidental
    `"use server"` matches (`demo-panel.tsx`, `refusal.ts`) contain no
    `requireRealWorkspace(`, so the change is inert today and only widens cover.
  - Blind spot: Does not cover an action defined in a `.tsx` server component
    file; no such action exists in this repo.
- **Decision**: FIXED — `actionModules()` now selects `.ts`/`.tsx` files
  containing `"use server"` (excluding `*.test.ts*`, which would otherwise match
  itself), and a new assertion,
  *"attributes every requireRealWorkspace() call site to a function it can
  check"*, fails when a call site sits outside any top-level `function`
  declaration. Both new cases were verified by hand against a temporary module
  and then removed: an unguarded action in a non-`actions.ts` `"use server"`
  module is now reported by name, and an arrow-const action fails the attribution
  assertion instead of passing invisibly. `npm test` 1133 passing, lint and
  typecheck clean.

### F2 — D1/D2 integration assertions landed in a different file than the plan named

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/app/(app)/settings/demo/actions.integration.test.ts:178-270`
- **Detail**: Phase 3 §3 named `src/lib/demo/load.integration.test.ts (extend)`
  for the "demo world survives exit → re-enter" assertions. They were written in
  `settings/demo/actions.integration.test.ts` instead, which was not touched by
  the plan text. Every content requirement is met and verified: stable demo owner
  id, `demoAnchorAt` unchanged, a demo-side edit intact, and the real account's
  credentials byte-identical across `load → exit → open → reset`. The chosen file
  is arguably the better home — the properties are about `openDemoAction`, not
  about `loadDemo`.
- **Fix**: None needed. Recorded so a future reader of the plan does not go
  looking in `load.integration.test.ts`.
- **Decision**: FIXED — a blockquote note in the plan's Phase 3 §3 now records
  the actual location (`settings/demo/actions.integration.test.ts:178-270` and
  `settings/demo/actions.test.ts`) and why it is the better home.

### F3 — The configure door writes to the database and revalidates eight paths even in REAL

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/components/organisms/setup/setup-doorstep.tsx:89-99`
- **Detail**: `handleConfigure` calls `exitDemoAction()` unconditionally before
  navigating. In demo that is the point. In REAL — the common case, since the
  doorstep is where every new account lands — it is a no-op `UPDATE` on
  `user.active_workspace` followed by `revalidateWorkspace()`, which fires
  `revalidatePath()` for eight routes (`settings/demo/actions.ts:31-47`) on the
  primary onboarding click path. The plan chose this deliberately ("In REAL the
  exit is a no-op `UPDATE`, so one path serves both modes and the door needs no
  `isDemo` prop") and the code documents it, so this is a recorded decision, not
  drift. Noted because the cost is on the hottest path in the wizard and the page
  already holds `isDemo` — it passes `demoLabel` down from exactly that state.
- **Fix**: If it ever matters, pass the `isDemo` the page already resolves down
  as a prop and skip `exitDemoAction()` when false, navigating directly.
  - Strength: Removes a write and eight cache invalidations from the default
    onboarding click; the flag is already computed one level up.
  - Tradeoff: Reintroduces the `isDemo` prop the plan deliberately removed, and
    gives the door two paths where it currently has one — the shape that let the
    doorstep and the panel disagree in the first place (D1).
  - Confidence: MEDIUM — the cost is real but unmeasured; no evidence it is felt.
  - Blind spot: Have not measured `revalidatePath` cost on Workers.
- **Decision**: SKIPPED — the plan weighed this tradeoff and chose the single
  path deliberately; the cost is unmeasured, and the two-path shape is the one
  that let the doorstep and the panel disagree in the first place (D1).
