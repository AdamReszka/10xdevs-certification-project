# Frame Brief: Team navigation section (S-19)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Settings carries six tabs with two different meanings — four are "how SprintFlow
reaches your data" (Connections, Daily recap, Anomaly rules, Demo) and two are
"who your team is" (Team, Absences). Separately: after the setup wizard finishes,
there is no cadence surface anywhere in the app.

## Initial Framing (preserved)

- **User's stated cause or approach** (roadmap S-19, owner's note at S-08,
  2026-08-25): "one nav that means two different things" — the problem is the
  information architecture of Settings.
- **User's proposed direction**: roster, absences and cadence move out of
  Settings into a first-class **Team** section.
- **Pre-dispatch narrowing**: the pre-dispatch question round was declined; the
  owner narrowed it in conversation instead, and the narrowing was decisive —
  *"uwiera mnie kadencja, nawigacja to kosmetyka"* ("cadence is what bothers me,
  navigation is cosmetic"). A second observation arrived mid-investigation and
  turned out to be the load-bearing one — see Narrowing Signals.

## Dimension Map

The observation could originate at any of these dimensions:

1. **No post-setup cadence surface** — the only `CadenceForm` mount is the
   wizard step, whose Save finishes onboarding and pushes to `/dashboard`.
2. **Wizard re-entry has side effects** — `/setup/team` mounts the roster editor
   too, so the workaround may not be neutral.
3. **Override durability across the sprint lifecycle** — a hand-entered cadence
   might be silently overwritten by S-16 reconciliation or lost at rollover.
4. **"Cadence" is not one thing** — sprint length / start day / working days
   (wizard) versus team-wide days off (`/settings/absences`).
5. **Navigation grouping** — the surfaces are hard to find. ← initial framing
6. **The working-day calendar is not consulted by the rules that measure
   elapsed time** — discovered mid-investigation, from the owner's own report.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. No post-setup cadence surface | `saveCadence` (`roster-store.ts:982-1006`) is the only lead-triggered writer, reachable only from `CadenceForm` → `/setup/team` (`setup/team/page.tsx:104`). None of the six Settings tabs mounts it (`settings/layout.tsx:20-28`). The only in-app link in is `jira-project-editor.tsx:149`, rendered **only** when `stage.kind === "discarded"` — i.e. right after switching the Jira project | **STRONG** (the gap is real) |
| 2. Wizard re-entry has side effects | Visiting is neutral for an onboarded lead: cadence auto-pull fires only `if (!initialCadence)` (`cadence-form.tsx:144-152`), roster auto-import only `if (initialMembers.length === 0)` (`roster-editor.tsx:273-276`); the two saves are independent (`setup/team/actions.ts:373-380`). **One real defect found in passing:** `saveCadence`'s UPDATE is scoped to `state = 'ACTIVE'` (`roster-store.ts:1003`) while `getActiveSprintRow` falls back to the most recently started sprint of any state (`sprint.ts:34-42`) — between sprints the form pre-fills from a CLOSED row, Save updates 0 rows, and the action returns `{ok:true}` regardless | **WEAK** (workaround is safe; separate silent no-op bug) |
| 3. Override durability | `reconcile-sprint.ts:259-261` guards every column with `case when cadence_overridden then <existing> else <proposed> end`; `:216-225` carries an override onto a NEW sprint row at rollover, including after a between-sprints demotion (`:186-202`). Pinned by three integration tests (`reconcile-sprint.integration.test.ts:256-273`, `:457-479`, `:514-536`) | **NONE** |
| 4. "Cadence" is not one thing | `working_days` has **no Jira source** — `cadence.ts:19-25`: *"workingDays = the Mon–Fri default (no Jira source)"*. Team-wide days off are a different model entirely (`team_day_off`, edited inside `/settings/absences`) | **PARTIAL** (a real conflation, but not the pain) |
| 5. Navigation grouping (initial framing) | Owner, verbatim: *"nawigacja to kosmetyka"*. Live references to the two routes are five in total (`settings/layout.tsx:21-22`, `settings/demo/actions.ts:39-40`, `dashboard/availability.tsx:144`) — the move is cheap, and wanted, but it is not what hurts | **WEAK as a cause** (confirmed as a want) |
| 6. Rules ignore the working-day calendar | `countWorkingDays` exists, is tested (`helpers.test.ts:65,142`) and is read by 3 of ~9 elapsed-time measurements. Wall-clock elsewhere: `ticket-status-aging.ts:77` (In Progress 1–13 SP), `:83` (Code Review, Testing), `pr-review-stalled.ts:31`, `developer-inactive.ts:31`, `ticket-no-commit-link.ts:28,36`, `sprint-at-risk.ts:88`. Working-day-aware only at `ticket-status-aging.ts:67` (21 SP) and `sprint-at-risk.ts:142,164` | **STRONG** |

## Narrowing Signals

- **Owner, verbatim, on the initial framing:** *"uwiera mnie kadencja, nawigacja
  to kosmetyka."* This demoted dimension 5 — the slice's entire recorded
  rationale — from cause to preference in one sentence.
- **Owner, verbatim, unprompted:** *"na pewno było takie wskazanie, że mechanizm
  niepotrzebnie liczy soboty i niedziele jako dni robocze, w sensie że czas się
  przelicza na taskach."* This put dimension 6 on the map, which no reading of
  the roadmap would have produced — S-19's text never mentions the rules.
- **Owner, on the move itself:** *"przeniesienie tych dwóch stron i zmiana pathów
  byłaby spoko … myślę o tym cały czas."* The navigation change is genuinely
  wanted; it is simply not the problem it was sold as solving.
- **The codebase states the principle and applies it once.**
  `ticket-status-aging.ts:62-66`: *"A ticket does not age on a day the whole team
  is off — the 8-working-day budget is a budget of days somebody could have moved
  it, and a public holiday is not one of those."* That comment governs one of the
  five branches in its own function.
- **Nothing recorded ever called cadence-editing cosmetic.** The post-setup
  cadence UI was deferred three times, each time as substantive scope: owner at
  S-15 (`plan-brief.md:55`, "Cadence on the tab | Roster only"), declined at S-22
  (`onboarding-routing/plan.md:387-390`, "a separate slice"), and parked at S-16
  as out-of-scope item F (`change.md:127-128`). S-16's research is where the
  label came from — *"the override surface staying wizard-only is a **navigation
  problem**, not a reconciliation one"* (`research.md:290`) — a true statement in
  its own context that travelled into S-19 and became the whole slice.
- **The cadence-UI assignment is an annotation, not part of the slice.** S-19's
  outcome and its "Why this exists" text (`roadmap.md:634-651`) are purely about
  nav grouping; the cadence connection appears only in the Backlog Handoff row
  (`roadmap.md:566`).

## Cross-System Convention

This class of observation — "elapsed time counted against a team that was not
working" — already has a recorded instance in this project at a different layer:
`context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`, *"Daily Recap nie zna
weekendów ani dni wolnych firmy"*, raised by the tester and still open. The
convention the codebase reaches for when it does handle this is
`countWorkingDays` / `countWorkingDaysInclusive` (`helpers.ts:96-117`), which
already take `workingDays`, the team's time zone and `nonWorkingDays`. So the
leading hypothesis matches the convention — the mechanism is present and simply
not wired into most of the callers.

Searched and **nothing found**: no recorded decision anywhere in
`context/archive/**` that wall-clock aging is deliberate. The only recorded
working-day discussion concerns the 21-SP sentinel
(`anomaly-settings-page/research.md:152-154`, `plan.md:108`). PRD FR-009 itself
mixes units ("1/2 SP=24h … 21 SP=8 working days") without ever saying how a
weekend is treated.

## Reframed Problem Statement

> **The actual problem to plan around is**: SprintFlow measures how long work has
> been sitting in wall-clock hours while the team it watches works in working
> days — so the Monday-morning inbox, the product's headline surface, charges the
> team for the weekend; and the working-day calendar that would fix it is read by
> only 3 of ~9 elapsed-time measurements and can be set only inside the setup
> wizard.

The initial framing was **not** wrong about a real irritation — Settings does mix
two meanings, and the owner still wants the move — but it was wrong about what
the slice is *for*. Fixing the navigation would leave a 3-SP ticket moved to In
Progress on Friday at 16:00 firing `TICKET_STATUS_AGING` on Sunday at 16:00, and
the lead reading a Monday inbox padded with anomalies nobody could have acted on.
Addressing dimension 6 changes what the product asserts about the team; addressing
dimension 5 changes where two links live.

Note the dependency the reframe exposes: dimension 6 makes `working_days` matter
far more than it does today, and dimension 1 means that column is settable only
by re-entering the wizard. They are separate slices, but the second becomes worth
doing *because* of the first — not because of navigation.

## Confidence

**HIGH.** The evidence is direct code reading with file:line for every claim,
the leading hypothesis was volunteered by the owner rather than proposed to them,
the mechanism it needs already exists and is tested, and the archive search
returned no recorded decision to the contrary. What is NOT settled here — and is
deliberately left to planning — is *which* rules should become working-day-aware
and whether thresholds need recalibrating once they are; that is a per-rule
judgment, not a framing question.

## What Changes for /10x-plan

S-19 splits into three, and only one of them is S-19:

1. **The wall-clock/working-day mismatch in the anomaly rules** — a new roadmap
   slice, and the one carrying actual product value. Not S-19; it touches
   `src/lib/anomaly/rules/*` and nothing in the navigation.
2. **A post-setup cadence surface** — the leftover deferred three times
   (S-15 → S-22 → S-16). Worth doing on its own merits, and more so after (1).
   Carries the `saveCadence` between-sprints silent no-op as a defect to fix.
3. **The Team navigation move** — S-19 as written, minus the cadence clause the
   roadmap's Backlog Handoff row bolted on. Cheap, wanted, cosmetic, and safe to
   plan on its own; the roadmap's outcome text should drop "and cadence", which
   it never described accurately.

The roadmap's S-19 entry needs correcting either way: its outcome promises to
move a cadence surface that has never existed.

## References

- Rules: `src/lib/anomaly/rules/ticket-status-aging.ts:62-84`,
  `pr-review-stalled.ts:31`, `developer-inactive.ts:31`,
  `ticket-no-commit-link.ts:28,36`, `sprint-at-risk.ts:88,142,164`,
  `helpers.ts:96-117`
- Cadence write path: `src/lib/integrations/roster-store.ts:982-1006`,
  `src/app/(app)/setup/team/actions.ts:355-409`,
  `src/components/organisms/setup/cadence-form.tsx:144-185`,
  `src/lib/integrations/cadence.ts:19-25`
- Reconciliation: `src/lib/integrations/reconcile-sprint.ts:186-261`,
  `reconcile-sprint.integration.test.ts:256-273,457-479,514-536`
- Navigation: `src/components/molecules/main-nav.tsx:13-18`,
  `src/app/(app)/settings/layout.tsx:20-28`,
  `src/components/organisms/settings/jira-project-editor.tsx:137-149`
- Prior decisions: `context/archive/2026-08-23-team-management-surface/plan-brief.md:55`,
  `context/archive/2026-08-19-onboarding-routing/plan.md:387-390`,
  `context/archive/2026-08-26-sprint-reconciliation/change.md:127-128`,
  `research.md:290`, `context/foundation/roadmap.md:534-536,566,634-651`
- Neighbouring open report: `context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`
- Investigations: post-setup cadence paths; override durability across the sprint
  lifecycle; prior recorded decisions on a post-setup cadence surface (three
  parallel read-only agents, 2026-08-30)
