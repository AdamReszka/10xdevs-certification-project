# First-run destination: the setup wizard's doorstep — Plan Brief

> Full plan: `context/changes/onboarding-routing/plan.md`
> Frame brief: `context/changes/onboarding-routing/frame.md`
> Research: `context/changes/onboarding-routing/research.md`

## What & Why

SprintFlow has no first-run surface at all — no screen where a new account is
told what the product needs, what to prepare, and that there are two ways in
(connect real data, or explore the demo). "Missing routing" is a symptom of that
absence, and routing alone cannot fix it, because a redirect can only ever name
ONE destination while the PRD promises two.

## Starting Point

`/setup` is a 9-line unconditional redirect that nothing links to and no test
asserts. Its *steps* are linked to, though — twice from inside the wizard, and
once from Settings (`jira-project-editor.tsx:118`, "Import sprint cadence" →
`/setup/team`).
Sign-up, sign-in and the `(auth)` layout all push to `/dashboard`, which renders
the real S-07/S-10 surface against an empty account. `isOnboardingComplete`
(S-04) exists, is tested, and has zero production callers. Demo works with zero
credentials but is four unsignposted clicks deep inside Settings.

## Desired End State

A new account lands on a Polish welcome screen at `/setup` — "Krok 1 z 4", no
navigation header, no skip link — naming what SprintFlow needs and offering two
doors: connect GitHub, or load the demo. A demo visitor is never sent to the
wizard, but carries a permanently visible "Dokończ konfigurację" link in the demo
banner until their real account is configured. A configured account lands on
`/dashboard` unchanged, and a lead disconnecting GitHub to rotate a PAT is never
ejected from Settings.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unit of work | A doorstep, not a redirect | A redirect names one destination; the PRD promises two entrances. | Frame |
| Gate location | `/dashboard/page.tsx` only, server-side | A layout gate sweeps all 19 `(app)` routes and produces both forbidden outcomes at once — a loop on `/setup/**` and PAT-rotation ejection from `/settings/**`. | Plan |
| Which owner id | Short-circuit on `isDemo`; predicate only on `realOwnerId` | The demo fixture satisfies all six predicate conditions under the demo owner, so the predicate must never be asked about a demo id. | Research |
| Demo door placement | On the doorstep itself | S-09's "No demo for Connections or Setup" is read as "these surfaces render the real account", narrowed deliberately and on the record. | Plan |
| Exit from the doorstep | None — and `MainNav` hidden there | The owner asked for a conscious exit; the header's four links would be four unconscious ones. Steps 2–4 keep their nav. | Plan |
| Step numbering | Four steps: doorstep(1) → GitHub(2) → Jira(3) → Team(4) | The doorstep is part of the flow the user walks, so the count should say so. | Plan |
| Language | Polish for the wizard's chrome only | Translating the shared organisms would leak Polish into `/settings/connections/**` and `/settings/team`, which mount the same components. | Plan |
| Return from demo | A banner link, only while the real account is un-onboarded | The banner already renders above every gated route and already owns the exit from demo; once configured it reverts to today's shape. | Plan |
| E2E strategy | Per-test onboarded accounts; the SHARED account stays un-onboarded | The shared `storageState` account is un-onboarded on purpose by `setup-github`/`setup-jira`'s `afterEach` disconnects, so seeding it once would flake under `fullyParallel`. | Plan review F1 |
| No new column | Onboarding stays derived | A stored boolean drifts, and a migration ships on a different track from code. | Plan |

## Scope

**In scope:** the doorstep screen at `/setup` with two doors; hiding the nav
there; the wizard renumbered 3→4 and its chrome polonised; a server-side gate on
`/dashboard`; the demo banner's return link; the e2e fixture rewrite plus a
dedicated doorstep spec; amendments to PRD US-02, roadmap S-22, and the manual
test rows.

**Out of scope:** a "Setup" nav item (explicitly forbidden); gating
`/settings/**`, `/dashboard/sprint-detail` or `/refinement`; middleware changes;
translating the shared setup organisms; a "seen it" column; testing US-02's
2-second demo budget; advertising demo on the landing page; the `pg.Pool` leak
(`db-pool-teardown`).

## Architecture / Approach

`/setup` stops being a redirect and becomes a thin server page rendering a
doorstep organism inside `SetupWizardShell` at step 1, with its door-selection
logic split into a pure `.ts` sibling (there is no component-test harness). The
demo door receives `loadDemoAction` as a prop and navigates itself, because
nothing in the URL changes when the workspace does.

The gate is four lines inside `/dashboard/page.tsx`, placed immediately after the
`resolveWorkspace()` and `getDb(env)` calls the page already makes — so it adds
no pool. It reads `isDemo` first and returns early; only a real workspace reaches
`isOnboardingComplete(realOwnerId)`, threading the existing `db` handle.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Doorstep | The screen, two doors, nav suppressed, demo revalidation | Settled (F2): `MainNav` goes client + `usePathname()`, exact-match `/setup`; `AppShell` untouched |
| 2. Renumber + polonise | "Krok 1 z 4" through 4 of 4, wizard chrome in Polish | The step count is hard-coded in four places; one is an e2e assertion |
| 3. Gate + e2e | Un-onboarded accounts land on the doorstep | The shared account is mutated mid-run by the setup specs, so onboarding it once would flake — four entry points get their own accounts |
| 4. Return from demo | "Dokończ konfigurację" in the banner while real setup is pending | Settled (F5): the predicate runs inside `resolveWorkspace()`'s DEMO branch, on the pool it already opened — never in the layout |
| 5. Written record | PRD, roadmap S-22, manual test rows reconciled | Row 13.7 in the backlog is the one this change closes |

**Prerequisites:** S-01, S-02, S-03, S-04, S-09, S-10 — all shipped. No new
dependencies, no schema change, no migration.
**Estimated effort:** ~3–4 sessions across 5 phases; Phase 3 is the only one with
suite-wide blast radius.

## Open Risks & Assumptions

- **Phase 3 is all-or-nothing.** The gate and the four moved `/dashboard` entry
  points must land in one commit; between them the Playwright suite is entirely
  red. CI does not run Playwright (`ci.yml` is lint → typecheck → unit, plus the
  integration job), so this phase is verified locally or not at all.
- **The onboarded-account helper becomes coupled to the predicate's shape.** If a
  later slice adds a seventh condition to `isOnboardingComplete`, the helper goes
  stale and the failure will read as a routing bug, not a seeding one.
- **Narrowing S-09's non-goal is a judgment call**, recorded rather than assumed —
  a demo door on `/setup` sits on the one route family declared always-real.
- **The doorstep is a new pattern for this codebase.** There is no data-driven
  redirect anywhere in `src/app/` today; the house idiom is conditional rendering
  of an honest empty state.
- **A ticked manual promise needs re-checking**: the S-11 checklist recorded that
  a fresh sign-up reaching sprint-detail from the nav gets the empty state, not an
  error. The doorstep changes how that account arrives.

## Success Criteria (Summary)

- A brand-new account never sees a dashboard of zeros — it lands on a screen that
  tells it what to do next and gives it two ways to do it.
- A curious visitor with no GitHub PAT and no Jira token reaches populated demo
  data in one click from the first screen they see, and can always find their way
  back to configuring the real thing.
- A configured lead notices nothing: sign-in still lands on `/dashboard`, and
  rotating a PAT never throws them out of Settings.
