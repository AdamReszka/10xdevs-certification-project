# Frame Brief: Cadence after setup

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

An onboarded lead has no in-app route to change sprint length, start day or
working days: the only `CadenceForm` mount is the wizard step
(`setup/team/page.tsx:104`), and none of the seven Settings/Team tabs renders it.
Separately, the owner reports that where SprintFlow's cadence disagrees with
Jira, **Jira is right and SprintFlow has drifted** — and that he wanted to change
the cadence after setup and could not.

## Initial Framing (preserved)

- **User's stated cause or approach**: FR-007 promises the override with no
  surface condition, so the promise is met *formally* (in the wizard) and not
  *practically*. The gap is a missing screen.
- **User's proposed direction**: build a post-setup cadence surface (roadmap
  S-29), reusing the existing `CadenceForm`.
- **Pre-dispatch narrowing**: the missing surface and the silent save-no-op are
  **one problem**, not two; the need is **real, not spec-derived** ("I wanted to
  change it and couldn't"); and the observed disagreement is **SprintFlow having
  drifted from a correct Jira config**, not Jira failing to describe the team.

## Dimension Map

1. **Cadence derivation / freshness** — the stored cadence can diverge from Jira,
   and the lead reached for an edit to *correct a sync error*, not to express a
   team-specific override.
2. **Surface** — the controls work; nothing an onboarded lead can reach mounts
   them.  ← initial framing
3. **Write path** — `saveCadence`'s UPDATE is narrower than the read that filled
   the form; a surface built on it would report success and persist nothing.
4. **Field provenance** — `length_days`, `start_day` and `working_days` have
   different sources and may not deserve the same treatment.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Derivation drifts from Jira** | `deriveCadence` (`cadence.ts:66-88`) takes only the sprint's `startDate`/`endDate` plus the owner's zone. `length_days` = `Math.round((end−start)/86400000)`; `start_day` = weekday of the start *instant*; `working_days` = the hard-coded constant `MON..FRI` (`cadence.ts:19-26`) — Jira has no such field, so it is invented, and the form still presents all three as *"Pulled from your active sprint"* (`cadence-form.tsx:203`). But nothing accumulates drift: on CONFLICT the cadence columns are frozen by `case when cadence_overridden` (`reconcile-sprint.ts:346-348`) while `start_date`/`end_date` refresh unconditionally (`:340-343`). | **PARTIAL — real, but frozen at setup, not accumulating** |
| **2. Surface (initial framing)** | Exactly one mount repo-wide (`setup/team/page.tsx:104`). Seven tabs across `settings/layout.tsx:22-30` and `team/layout.tsx:18-24`; none is cadence. The one in-app link (`jira-project-editor.tsx:169-171`) renders only after a **destructive Jira project switch** that discarded sprints. The doorstep tells an onboarded lead *"Zmiany … zrobisz później w Ustawieniach"* (`setup-doorstep-view.ts:100-101`) — self-refuting, since Settings has no cadence. Cadence is deliberately excluded from the six onboarding probes (`onboarding.ts:96-100`), so a wrong cadence can never re-open the door. | **STRONG** |
| **3. Write path** | `saveCadence` UPDATEs `where owner_id AND state='ACTIVE'` (`roster-store.ts:1003`) and *does* return `{updated: rows.length}` (`:1006`); `actions.ts:396` **discards it** and returns unconditional `{ok:true}`. The sibling `setMemberActive` (`roster-store.ts:653-660`) throws on zero rows — the guard exists 300 lines above. The read/write asymmetry was **created by S-25**, which widened the page's read to `getActiveSprintRow` (two tiers, second unscoped by state, `sprint.ts:20-42`) and left the write. `load-snapshot.ts:40` uses that same wide read, so since S-28 the anomaly engine detects against the CLOSED row's `working_days` — the exact column the write refuses to touch. No test covers the zero-row case. | **STRONG** |
| **4. Field provenance** | `length_days` and `start_day` have **zero consumers** outside `setup/team/page.tsx:69-70`, the form and the writers — stated in the source itself (`availability-view.ts:40-43`: *"written by the Jira importer and read by nothing"*). Only `working_days` is load-bearing: capacity (`capacity.ts:126-139`), all five time-based anomaly rules since S-28, the days-off editor, the measurement sweep. | **STRONG** |

## Narrowing Signals

- **The owner's own answer reframed the question**: the disagreement he saw was
  SprintFlow drifting from a correct Jira — which pointed the investigation at
  derivation and freshness rather than at the missing screen.
- **`saveCadence` sets `cadence_overridden: true` UNCONDITIONALLY** — no check
  that the lead changed anything (`roster-store.ts:1001`) — and that action *is*
  what finishes the wizard (`actions.ts:373`: "THIS IS WHAT FINISHES THE
  WIZARD"). Its only submit control is labelled "Save & finish setup".
- **Verified on the live database.** The one real account that completed
  onboarding: `cadence_overridden = t`, `start_day = FRI`, because its sprint was
  started in Jira on a Friday evening. The five rows never through the wizard are
  all `f`. This is the owner's reported drift, reproduced from data.
- **"Re-entering `/setup/team` is neutral" is FALSE between sprints.** The
  roadmap marks that claim "must not be re-litigated", citing
  `cadence-form.tsx:144-152`. Those lines are
  `if (!didAutoPull.current && !initialCadence) void pull()`, and
  `initialCadence` is null exactly when no sprint row resolves — so opening the
  page fires a live Jira call and can persist.
- **The roadmap's line numbers for the "already safe" claims are stale**
  (`:259-261` / `:216-225` are now `:344-349` / `:298-313`); the behaviour still
  holds, the citations do not.

## Cross-System Convention

This project's own convention is that a stored value which an upstream system
owns must be reconciled against that system rather than trusted indefinitely —
`lessons.md`, "a narrowing predicate turns 'wrong value' into 'empty result'":
*"the value is a cache, and a cache with no invalidation is a permanent silent
failure."* FR-007's Socratic note reaches the same conclusion from the product
side: auto-pull is the source of truth, and re-asking the user "duplicates state
and risks divergence". An override flag that is set by *finishing setup* rather
than by *choosing to differ* converts every account into exactly that
never-invalidated cache.

The deferral history reads differently once this is known. S-15 dropped cadence
with the reason *"Cadence is FR-007 with its own lifecycle gap in S-16"*
(`team-management-surface/plan-brief.md:55`) — the owner already suspected a
lifecycle problem, not merely a missing tab.

## Reframed Problem Statement

> **The actual problem to plan around is**: finishing the setup wizard
> permanently opts an account out of FR-007's auto-pull, because `saveCadence`
> sets `cadence_overridden = true` unconditionally — so whatever cadence happened
> to be derived at that moment is frozen for the account's lifetime, the one
> surface that could correct it is unreachable, and between sprints that surface
> would report success while writing nothing.

The initial framing was **right about the symptom and one layer short of the
cause**. A cadence tab is necessary — the reachability finding is confirmed and
worse than stated — but shipping only the tab would leave every existing account
frozen at a value it never chose, and would put the new screen on a write that
silently no-ops during sprint planning, which is precisely when a lead revises a
cadence. The three findings are one defect seen from three sides: the value is
wrong, it is frozen because *confirming* it counted as *overriding* it, and the
only place to fix it cannot be reached.

Two scope consequences fall out and belong to /10x-plan, not here. First,
`length_days` and `start_day` are read by nothing — so their drift is invisible
today and becomes visible the moment a surface displays them. Second,
`working_days` is the opposite: invented by SprintFlow, never sourced from Jira,
and since S-28 it drives when all five time-based anomaly rules fire.

## Confidence

**HIGH** — three independent investigations converged; the load-bearing claim
(unconditional override flag) is verified in code, in the wizard's own comment,
and against the live database row; and the leading hypothesis explains the
owner's reported observation, which the initial framing did not.

## What Changes for /10x-plan

Plan the **lifecycle**, with the surface as one part of it rather than the whole:
`cadence_overridden` must mean "the lead deliberately changed this" and not
"the lead finished setup"; the write must key on the same row the read returned
and must report rows-affected rather than an unconditional `ok`; and only then
does a reachable, non-wizard surface become a screen worth trusting. The
existing accounts frozen at a value they never chose are a migration question the
plan has to answer explicitly.

## References

- Derivation: `src/lib/integrations/cadence.ts:19-26,66-88`
- Reconciliation: `src/lib/integrations/reconcile-sprint.ts:298-313,340-349`
- Write: `src/lib/integrations/roster-store.ts:982-1007`; caller
  `src/app/(app)/setup/team/actions.ts:355-409`
- Read: `src/lib/sprint.ts:20-42`; anomaly consumer `src/lib/anomaly/load-snapshot.ts:40`
- Surface: `src/app/(app)/setup/team/page.tsx:104`,
  `src/components/organisms/setup/cadence-form.tsx:144-152,179,203,367-376`,
  `src/components/organisms/settings/jira-project-editor.tsx:169-171`,
  `src/components/organisms/setup/setup-doorstep-view.ts:96-102`
- Provenance: `src/components/organisms/dashboard/availability-view.ts:40-43`
- Prior deferrals: `context/archive/2026-08-23-team-management-surface/plan-brief.md:55`,
  `context/archive/2026-08-19-onboarding-routing/plan.md:387-390`
