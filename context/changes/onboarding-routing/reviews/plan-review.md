<!-- PLAN-REVIEW-REPORT -->
# Plan Review: First-run destination — the setup wizard's doorstep

- **Plan**: `context/changes/onboarding-routing/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 1 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

20/20 paths ✓, 8/9 symbols ✓ (the "not one `href` targets the wizard" claim was
falsified — see F3), brief↔plan ✓, Progress 5/5 phases · 34/34 criteria ✓
(36/36 after triage).

## Findings

### F1 — The setup specs un-onboard the shared account mid-run

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 and §3 — the e2e fixture
- **Detail**: Phase 3 seeded onboarding once in `auth.setup.ts` and declared
  `setup-github.spec.ts` / `setup-jira.spec.ts` unaffected. Both run on the same
  shared `storageState` account and disconnect the integration in `afterEach`
  (`setup-github.spec.ts:25-34`, `setup-jira.spec.ts:25-31`), flipping
  `isOnboardingComplete` back to `false` at its first query
  (`onboarding.ts:35-40`). With `fullyParallel: true`
  (`playwright.config.ts:39`), `seed.spec.ts:36` and
  `dashboard-sprint-detail.spec.ts:76` then redirect to `/setup` at random. The
  identical bug already occurred in this suite —
  `dashboard-sprint-detail.spec.ts:143-148`. CI does not run Playwright, so it
  flakes locally only.
- **Fix A ⭐ Recommended**: Per-test onboarded accounts; the shared account stays
  un-onboarded.
  - Strength: The fix this suite already chose for the same bug; `seedSprint`
    (`dashboard-sprint-detail.spec.ts:253-330`) is a working template that
    already writes five of the six predicate rows.
  - Tradeoff: More per-test sign-ups; a second site encoding the predicate shape.
  - Confidence: HIGH — precedent, helper and DB access all already in the file.
- **Fix B**: Setup specs restore the credential in `afterEach`.
  - Tradeoff: Makes two independent specs stateful — fights the suite's own
    isolation convention under `fullyParallel`.
- **Decision**: FIXED via Fix A. Phase 3 §2 rewritten as an
  `signUpOnboardedAccount()` helper; §3 moves four entry points (`auth.setup.ts`
  now waits for the doorstep, not `/dashboard`); Current State's "blast radius is
  one line" paragraph corrected; `plan-brief.md` E2E row + risk + phase table
  updated.

### F2 — Nav suppression is deferred, and the plan's own non-goals close the obvious routes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4
- **Detail**: The only unresolved mechanism in an otherwise file-and-line-specific
  plan, and Phase 1's own named key risk. `AppShell` renders `MainNav`
  unconditionally (`app-shell.tsx:26`) from a server-component layout that cannot
  read the child route; "Not touching middleware" rules out a pathname header;
  and `/setup` shares its route group with `/setup/github|jira|team`, which must
  keep their nav.
- **Fix**: `MainNav` becomes a client component reading `usePathname()`, returning
  `null` on exactly `/setup`.
  - Strength: One file, no middleware, `AppShell` untouched. In-repo precedent at
    `settings-tabs.tsx:4,21`; `main-nav.tsx:19` already names `usePathname` as
    this component's planned next step.
  - Tradeoff: Hard-codes one route in a presentational molecule; converts a
    static server component to a client one.
  - Confidence: MED — mechanism sound; molecule-vs-prop placement was a taste
    call worth making explicitly.
- **Decision**: FIXED. Phase 1 §4 rewritten with the mechanism, the three closed
  alternatives, and an exact-match warning (`startsWith` would strip steps 2–4).

### F3 — "Not one href targets the wizard" is false, and one link lives in Settings

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Current State Analysis; Phase 2; `plan-brief.md` "Starting Point"
- **Detail**: Three live hrefs point into `/setup/**`:
  `github-connection-status.tsx:84` → `/setup/jira`,
  `jira-connection-status.tsx:93` → `/setup/team`, and
  `settings/jira-project-editor.tsx:118` →
  `<Link href="/setup/team">Import sprint cadence</Link>`. The third is rendered
  by `/settings/connections` (`connections/page.tsx:4`) after a Jira project
  switch, so after Phase 2 it lands an English Settings button on a Polish
  "Krok 4 z 4" stepper — the regression
  `dashboard-sprint-detail.spec.ts:193-225` exists to prevent.
- **Fix**: Correct the premise, and record the Settings→wizard hop as accepted
  with its reason.
  - Strength: Costs a paragraph and a decision; leaving it means the next slice
    re-discovers the contradiction from a red assertion.
  - Tradeoff: A Settings-local cadence surface is real scope this slice does not
    carry — accepting the hop is the cheaper correct call.
  - Confidence: HIGH — all three hrefs and the render path verified by grep.
- **Decision**: FIXED. Overview + Current State + `plan-brief.md` premise
  corrected; Phase 2 gains §4 recording the accepted hop (old §4 → §5); Desired
  End State clarified that "never ejected" is about the *gate*, not about a link
  the lead clicks.

### F4 — Phase 2's prose sweep named 1 of 7 stale sites, and criterion 2.5's grep could not catch the rest

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3; success criterion 2.5
- **Detail**: Missing sites: `setup/github/page.tsx:12`, `setup/jira/page.tsx:12`,
  `setup/team/page.tsx:14`, `github-connect-form.tsx:65`,
  `jira-connect-form.tsx:76`, `jira-connection-status.tsx:90`. Criterion 2.5
  grepped for `"of 3"`, which matches none of them — it would go green with all
  six stale.
- **Fix**: Enumerate all seven sites in §3; widen 2.5 to
  `grep -rniE "of 3|3-step|three-step|step [1-3]\b" src e2e`.
- **Decision**: FIXED. §3 rewritten with the seven sites; criterion 2.5 and
  Progress 2.5 both widened.

### F5 — Phase 4 opened a new leaked pg.Pool on every gated route in demo

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1; Performance Considerations
- **Detail**: Phase 4 §1 said "thread a `db` handle rather than opening a new
  pool" in `(app)/layout.tsx` — but that layout imports neither `getDb` nor
  `getCloudflareContext`, and `getDb` **is** the pool constructor
  (`db.ts:14,26-28`, a fresh `Pool({max:1})` per call, closed by nobody on the
  request path). The layout runs on every gated route, so in demo this leaks one
  extra Hyperdrive connection per render across all ten. That is `lessons.md`
  rule #3 verbatim, on the platform the lesson names. The plan's Performance
  section reasoned only about the real branch.
- **Fix**: Compute the flag inside `resolveWorkspace()`'s DEMO branch.
  - Strength: `resolveWorkspace` is already `cache()`d (`workspace.ts:86`),
    already builds exactly one `db` (`:93`), and already branches on DEMO
    (`:104-117`). Zero new pools; real mode returns at `:104-111` before the
    branch and pays nothing.
  - Tradeoff: Widens the resolver past pure tenancy; `Workspace` gains a field
    only the banner consumes.
  - Confidence: HIGH — verified against `db.ts`, `workspace.ts`, `layout.tsx`.
- **Decision**: FIXED. Phase 4 §1 retargeted at `src/lib/workspace.ts`;
  `decideWorkspace` stays pure (flag passed in like `demoOwner`); Performance
  section and `plan-brief.md` phase table updated.

### F6 — Finishing the wizard from inside demo landed on the demo dashboard

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4; manual rows 4.6–4.8
- **Detail**: The journey Phase 4 creates, walked to its end: the demo visitor
  clicks "Dokończ konfigurację", connects GitHub + Jira + roster, presses Save &
  finish — which does `router.push("/dashboard")` (`cadence-form.tsx:142`).
  `active_workspace` is still `DEMO`, so the gate short-circuits on `isDemo` and
  renders fictional data under the demo banner. No signal the real setup worked.
  Rows 4.6–4.8 stopped before this step.
- **Fix**: Exit demo on wizard completion when already in demo; add the
  end-to-end manual row.
- **Decision**: FIXED. Phase 4 gains §3 (`cadence-form.tsx:142`, flag passed in
  so the real-account finish is unchanged, demo world kept not reset), plus
  manual criterion and Progress row 4.9.

### F7 — Doorstep door state for a partially-onboarded account was unspecified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 and §3
- **Detail**: §3 promised the view fn decides "which doors are offered and in what
  state", but §1's page contract listed only `requireRealWorkspace()` — no read
  that could supply that state — and the Desired End State named the door flatly
  as "connect GitHub". Since the gate redirects on the whole predicate rather
  than on a step, a GitHub-only account is bounced to a doorstep re-offering
  GitHub.
- **Fix**: Add `getOnboardingSteps({ db, ownerId })` beside `isOnboardingComplete`
  — the same six reads, returning which are satisfied — and have the door target
  the first incomplete step.
- **Decision**: FIXED. Phase 1 §1 gains "Its one data read"; §3's contract names
  the href/label mapping and the four unit cases; Desired End State reworded; new
  criterion and Progress rows 1.6–1.8.

### F8 — Phase 1 and Phase 4 stated opposite conventions for the same server action

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 contract vs. Phase 4 §2
- **Detail**: Phase 1 §2 required the action "as a **prop**, not an import — the
  house pattern at `demo-panel.tsx:32-34`", but `demo-banner.tsx:10` — the file
  Phase 4 edits — imports `exitDemoAction` directly. Two conventions, not one.
- **Fix**: Doorstep imports `loadDemoAction` directly, matching the banner; note
  that both patterns exist and what distinguishes them.
- **Decision**: FIXED. Phase 1 §2 contract rewritten.
