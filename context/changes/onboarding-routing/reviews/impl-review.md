<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First-run destination — the setup wizard's doorstep

- **Plan**: context/changes/onboarding-routing/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION → **RESOLVED 2026-08-30** (6 fixed, 4 skipped by decision; all gates re-run green)
- **Findings**: 1 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Every planned item was implemented as described — the drift sweep found no MISSING and no
intent-level DRIFT across 25 planned changes, and all ten `What We're NOT Doing` boundaries
hold (no Setup nav item; `/settings/**`, sprint-detail and refinement ungated; `middleware.ts`
untouched; shared setup organisms untranslated; no column, no migration). The FAIL is a
correctness gap the plan's own Phase 4 §3 contract did not anticipate, not a deviation from it.

## Findings

### F1 — The demo→wizard journey writes the roster and cadence under the DEMO owner, so "Save & finish" bounces straight back to the doorstep

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/demo/demo-banner.tsx:73 → src/app/(app)/setup/team/actions.ts:242,306
- **Detail**: Phase 4 opens a designed path into the wizard from inside demo (banner → `/setup`),
  but `/setup/team`'s two save actions resolve their owner with `resolveWorkspace()`
  (`actions.ts:242` roster, `:306` cadence) — deliberately, so that `/settings/team` demo edits
  stay in demo (S-09 plan-review F1, documented at `actions.ts:44-60`). `/setup/team/page.tsx:22`
  meanwhile READS with `requireRealWorkspace()`. So a lead who takes the banner link sees the real
  roster, saves it under the **demo** owner, then `cadence-form.tsx:156` exits demo and pushes to
  `/dashboard` — where the gate runs `isOnboardingComplete` on `realOwnerId`, finds `teamMember = 0`,
  and redirects to `/setup`. The configure door then points at `/setup/team`, the page just left.
  The same two import actions refuse outright in demo (`workspaceForImport`, `actions.ts:176`), so
  the lead cannot even pull the roster from GitHub/Jira on that path. This is exactly the journey
  Phase 4 §3 exists to close and exactly what manual row 4.9 / checklist row D would catch.
  Before Phase 4 the path was reachable only by hand-typing the URL; the banner link makes it the
  signposted route.
- **Fix A ⭐ Recommended**: Exit demo at the START of the journey — make "Dokończ konfigurację" a
  button that calls `exitDemoAction()` and then routes to `/setup`, mirroring "Wyjdź z demo" three
  lines above it in the same file. The whole wizard then runs on the real account, which is what
  `/setup/**` is by contract.
  - Strength: One file, one already-present pattern; makes the wizard always-real again instead of
    negotiating per action. `cadence-form.tsx`'s exit stays as harmless belt-and-braces.
  - Tradeoff: The lead loses the demo banner while configuring — arguably correct, since they are
    configuring the real account, but it is a visible mode switch they did not explicitly ask for.
  - Confidence: HIGH — `exitDemoAction` only flips `active_workspace` (`settings/demo/actions.ts:109-121`),
    so the demo world survives and Settings → Demo can re-enter it.
  - Blind spot: Have not checked whether anything else links into `/setup/**` from a demo context.
- **Fix B**: Scope the two save actions to the real owner when the caller is the wizard rather than
  `/settings/team`.
  - Strength: Fixes the hand-typed `/setup/team` path too.
  - Tradeoff: The actions cannot see the route, so a flag must be threaded page → organism → action,
    and it re-opens the S-09 F1 decision the docblock argues for at length.
  - Confidence: MEDIUM — invasive, and the read/write split at `page.tsx:22` would still need fixing.
  - Blind spot: `/settings/team` regression risk on a shared organism.
- **Decision**: FIXED via Fix A — `demo-banner.tsx` now calls `exitDemoAction()` and navigates to `/setup` only once the flip has committed, so the wizard always runs on the real account.

### F2 — The team step has two independent saves; skipping "Save roster" now produces an unexplained bounce loop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/setup/team/page.tsx:69-70
- **Detail**: The final step mounts `RosterEditor` (own "Save roster" button, whose own copy says
  "nothing is saved until you press Save" — `roster-editor.tsx:258`) and `CadenceForm`, and only the
  latter navigates. A lead who reviews the imported roster without pressing "Save roster" and then
  presses "Save & finish" is pushed to `/dashboard`, gated on `teamMember = 0`, and returned to
  `/setup`, whose configure door sends them back to `/setup/team`. Each lap needs a click, so it is
  not an infinite redirect — but nothing on any of the three screens names the unsatisfied condition.
  This failure mode did not exist before Phase 3, when `/dashboard` simply rendered zeros.
- **Fix**: Have the finish handler refuse to navigate when the owner has no `team_member` rows and
  say so, or have the doorstep's `detail` line name the unsatisfied probe instead of describing the
  step generically.
- **Decision**: FIXED — `saveCadenceAction` refuses with `no_roster` when the owner has no `team_member`, before saving, so the form keeps its values and the message names the missing step.

### F3 — `e2e/accounts.ts` deletes and inserts user rows with no local-database guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/accounts.ts:26-27
- **Detail**: `DB_URL = process.env.DATABASE_URL ?? <local>` with no assertion, and the module now
  runs `delete from "user" where email = $1` / `where id = $1` plus six direct INSERTs. The
  integration project refuses any non-local `DATABASE_URL` for exactly this reason
  (`test/integration/setup.ts:8-12`: "these specs INSERT and DELETE credential rows… a wrong
  `DATABASE_URL` fails fast instead of mutating real data"). The E2E path has no equivalent, and
  this change extends the direct-delete blast radius from one spec to four. The repo's
  `DATABASE_URL_OVERRIDE` convention exists precisely because people do point `DATABASE_URL`
  elsewhere.
- **Fix**: Assert `DB_URL` resolves to `127.0.0.1:54322` at module load and throw otherwise,
  mirroring `test/integration/setup.ts`.
- **Decision**: FIXED — `e2e/accounts.ts` throws at import unless `DB_URL` resolves to `127.0.0.1:54322`, mirroring `test/integration/setup.ts`.

### F4 — `DoorstepSteps` structurally duplicates `OnboardingSteps`, re-opening the drift seam one file downstream

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/organisms/setup/setup-doorstep-view.ts:16-23
- **Detail**: `onboarding.ts:20-27` states that the probe table exists so the boolean and the
  breakdown "cannot drift on what complete means". `setup-doorstep-view.ts` then re-declares the
  six fields by hand instead of importing the type. TypeScript accepts a seven-field
  `OnboardingSteps` value where a six-field `DoorstepSteps` is expected (excess-property checking
  does not apply to non-literals), so adding a seventh probe compiles silently and yields the exact
  ping-pong the header claims to prevent: the gate says incomplete, the door says complete.
- **Fix**: `import type { OnboardingSteps } from "@/lib/onboarding"` and type `configureDoor` /
  `allStepsDone` on it, deleting the local copy.
- **Decision**: FIXED — `DoorstepSteps` is now `OnboardingSteps`, imported type-only so the module stays runtime-pure.

### F5 — `cadence-form.tsx` discards `exitDemoAction`'s result

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/setup/cadence-form.tsx:156
- **Detail**: `exitDemoAction` returns `{ok:false, error:"unavailable"}` on a DB failure rather than
  throwing, so a failed workspace flip is invisible: the surrounding `catch` never fires, no
  `formError` is set, and `router.push("/dashboard")` runs anyway — landing the lead back under the
  demo banner, the precise outcome the three-line comment above the call says it exists to prevent.
  Every other consumer in the repo (`demo-panel.tsx`, `setup-doorstep.tsx`) checks `result.ok` and
  surfaces `result.message`.
- **Fix**: Check `result.ok` and set `formError` before navigating.
- **Decision**: FIXED — `cadence-form.tsx` checks `result.ok` and surfaces `result.message` instead of navigating.

### F6 — Six sequential probes on every `/dashboard` render for an already-onboarded account

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/dashboard/page.tsx:69, src/lib/workspace.ts:150
- **Detail**: The short-circuit only helps un-onboarded accounts. A complete account pays all six
  `SELECT … LIMIT 1` sequentially over Hyperdrive on every load of the app's main page, and in demo
  on every gated render of every route (`resolveWorkspace` is `cache()`d per request, so it is one
  set per request, not per component). The repo already judges this shape too expensive —
  `sync/scheduled.ts:44-48` refuses it explicitly and substitutes one set-based join. Minor extra
  waste at `workspace.ts:150`: when `activeWorkspace = "DEMO"` but the demo owner row or its anchor
  is missing, the six queries run and `decideWorkspace` then discards the result in favour of
  `realOnboarded: true`. The plan's Performance section discussed gated renders only; server actions
  that call `resolveWorkspace` in demo also pay it.
- **Fix**: Collapse the probes into one query (six `EXISTS` subselects, or the `scheduled.ts` join
  style), and move the `realOnboarded` computation below the demo-owner null check.
- **Decision**: FIXED — the six probes became ONE query (six `EXISTS` columns over the owner's `user` row); `realOnboarded` moved below the demo-anchor check. New integration coverage for `getOnboardingSteps` asserts the key→column mapping and was mutation-checked against a swapped column.

### F7 — `eslint.config.mjs` ignore-list entry is unrelated to this change

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.mjs:18-21
- **Detail**: Adds `.worker-dryrun/**` to the ignore list. Harmless and correct (the directory is
  gitignored generated output), but it has no connection to onboarding routing and is the only true
  scope creep in the branch.
- **Fix**: Leave it and note it in the PR description, or split it into its own commit.
- **Decision**: SKIPPED — kept deliberately; call it out in the PR description.

### F8 — The doorstep's demo door always RELOADS the demo, discarding edits

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/organisms/setup/setup-doorstep.tsx:47
- **Detail**: `demo-panel.tsx` deliberately splits `loadDemoAction` (resets first) from
  `enterDemoAction` (keeps edits), and `settings/demo/actions.ts:76-79` documents the split as
  load-bearing. The doorstep only ever calls `loadDemoAction`, and Phase 4 made the doorstep
  reachable from inside demo — so a visitor already exploring demo who wanders back and presses
  "Zobacz demo" silently loses their demo edits.
- **Fix**: Call `enterDemoAction` when a demo owner already exists (`setup/page.tsx` already holds a
  `db` handle for `findDemoOwner`).
- **Decision**: SKIPPED — F1's fix means the doorstep is no longer reachable from inside demo, so the reset path is moot.

### F9 — The demo banner renders on the doorstep, offering a link to the page you are on

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/(app)/layout.tsx:46-56
- **Detail**: The nav suppression is per-route (`main-nav.tsx:34`) but the banner is not, so on
  `/setup` in demo the screen whose stated design is "there is no third way off it" carries both
  "Wyjdź z demo" and a "Dokończ konfigurację" button pointing at the current page.
- **Fix**: Suppress `needsSetup` on `/setup` (the layout cannot read the route, so pass it the same
  way `MainNav` gets it, or drop the button when `usePathname() === "/setup"`).
- **Decision**: SKIPPED — unreachable after F1's fix.

### F10 — `allStepsDone` is exported and tested but has no production caller

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/organisms/setup/setup-doorstep-view.ts:33
- **Detail**: Eleven lines of test coverage, zero callers across `src/` and `e2e/`. `configureDoor`'s
  fallback branch already encodes "everything done".
- **Fix**: Delete it, or use it in `setup/page.tsx` if a distinct all-done rendering was intended.
- **Decision**: SKIPPED — harmless tested code.

## Success criteria — re-verified 2026-08-30

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors (5 pre-existing warnings in anomaly rules, untouched here) |
| `npx tsc --noEmit` | PASS — clean |
| `npm test` | PASS — 1057 / 83 files |
| `npm run test:integration` | PASS — 335 / 30 files |
| `npm run test:e2e` | PASS — 14 / 14 |
| `node scripts/manual-test-sweep.mjs` | PASS — exit 0 |
| 2.5 stale step-count grep | PASS — no `of 3` / `3-step`; hits are the new numbering |

Manual rows: 1.5–1.8 are `[x]` (confirmed in an earlier session). The remaining 11 are `[ ]` and
tracked in `manual-test-backlog.md` §15 — no rubber-stamping found. Row 4.9 / checklist row D is
the one that would have caught F1.
