# Frame Brief: Next-window capacity as a number on the availability tab

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

The Availability tab on Dashboard "Today" draws two member × day grids — "This
sprint" and "Next window" — but the capacity figure in man-days is rendered for
the first only. The second shows WHO is away and no number
(`availability.tsx:89-90`: "It shows WHO is away; it deliberately does not
compute that window's capacity number (its own slice)").

## Initial Framing (preserved)

- **User's stated cause or approach**: the blocker is *window identity* — the
  open question is whether the forecast window should be a real future sprint
  pulled from Jira (`state=future`, often without dates) or the window
  `availability-view.ts:nextWindowAfter()` extrapolates today.
- **User's proposed direction**: put a man-days capacity NUMBER for the next
  window on the Availability tab. PRD refs FR-010, and FR-022 for the unit.
- **Pre-dispatch narrowing**:
  - *Does the drawn "Next window" match the sprint you actually plan next?* —
    **"Not checked / don't know."** The window-identity question is therefore
    unresolved by observation and had to be settled from code.
  - *Are absences for the next window recorded in advance?* — **"Mixed — some
    yes, some no."** Long holidays go in early; shorter ones and sickness do not.
  - *Which absence on the screen bites harder — no MD number, or no SP answer?*
    — **the MD number.** Extending FR-024's story-point estimate to an unstarted
    window is explicitly NOT the leading concern.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Window identity — where the next window's dates come from.** Three
   candidate sources: extrapolation from the current sprint's own dates (today),
   a Jira `state=future` sprint, or the cadence the LEAD chose
   (`sprint_cadence_override.length_days` / `start_day`). ← **initial framing**
2. **Calendar inputs past the active sprint's end.** The working-day pattern,
   the team-wide day-off calendar and the holiday-approval year set all have to
   answer for dates beyond `sprint.end_date`. Any that silently degrades there
   makes the number wrong without saying so.
3. **Absence coverage in a window that has not started.** Capacity's whole
   `adjusted` half is the absence subtraction. If absences for that window are
   only partly recorded, `adjusted` is not a measurement of that window.
4. **The recorded deferral rationale itself.** S-08 parked this slice on the
   claim that "the next sprint does not exist in the database yet" and that
   doing it properly "likely depends on S-16 so the next sprint is a real row".
   Both halves are checkable against a codebase where S-16 and S-23 have since
   shipped.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **D1: the date source is a genuine open fork.** A Jira future sprint is a reachable alternative to extrapolation. | `getActiveSprint` hard-codes `state=active` (`jira.ts:560`) and is the ONLY sprint entry point — `reconcile-sprint.ts:23` imports it and nothing else. No code path anywhere fetches, stores or models a future sprint. The user's own note that future sprints are "often without dates" is the second half: even if fetched, the field the window needs is commonly absent. Meanwhile the third candidate is now strong: `length_days` / `start_day` are lead-owned and durable since S-30, resolve through `pickCadence` tier 2 whose `applies` predicate is `start_date <= <this sprint's>` (`cadence-override.ts:286`) — an ordering that reaches FORWARD for free — and `survivingCadenceProvenance` (`cadence-override.ts:339`) already exists to resolve cadence with NO sprint row at all. | **WEAK** — the fork is real but nearly settled; one branch is unbuilt integration, one is stale, one is ready |
| **D2: the calendar inputs go blind past sprint end.** | Split. The day-off SET is fine — `getNonWorkingDays` is unbounded by date on purpose (`team-day-off-store.ts:104-110`), so a 2027 holiday is visible today. The APPROVAL that puts rows there is not: `holidayYears` returns today's year ∪ every year the ACTIVE sprint touches (`proposal.ts:58`), fed exactly those (`dashboard/page.tsx:149-154`). A sprint ending 2026-12-20 whose next window runs into January never proposes 2027, so 1 and 6 January carry no rows and count as ordinary working days — in the next window's capacity only. Cadence is fine (D1 evidence). | **STRONG** |
| **D3: `adjusted` is not a measurement for an unstarted window.** | The reader already pulls absences across the whole second window — `lookahead` at `capacity.ts:257-258` — so the plumbing is there and the data is not: the owner reports absence entry ahead of time is **mixed**. `absence` is free-dated (`schema.ts:741-778`, no sprint bound; `sprint_id` is provenance with no reader since S-20), so nothing PREVENTS forward entry — it just is not consistently done. Every missing absence moves the figure in ONE direction. | **STRONG** |
| **D4: the recorded deferral rationale still holds.** | Falsified on both halves. S-16 shipped and reconciles the sprint Jira reports ACTIVE — it never imports a future one, so the hoped-for "real row" did not arrive and will not. S-23 shipped and discharged the other half: its own plan records S-18 as parked pending "S-23, which makes the next window's capacity computable" (`archive/2026-08-27-capacity-in-man-days/plan.md:1046-1049`). Separately, the comment carrying S-08's reasoning is now stale — `availability-view.ts:41` still calls the cadence columns "written by the Jira importer and read by nothing", which S-29/S-30/S-32 made false. | **STRONG (as falsification)** |

## Narrowing Signals

- **The owner has not compared the drawn window against their real next sprint.**
  So no observation supports "the extrapolation is wrong in practice" — and none
  refutes it either. The date source cannot be settled by appeal to their
  experience; it is a decision, and D1 shows two of the three branches are
  already effectively closed.
- **Absences for the next window are recorded *sometimes*.** This is the signal
  that reframes the slice. "Always" would have made `adjusted` trustworthy;
  "never" would have made it obviously meaningless. "Sometimes" makes it
  *plausible and wrong by an unknown amount* — the worst of the three.
- **Man-days, not story points, is what is missing.** FR-024's estimate stopping
  at the active sprint (`estimate.ts:10-14`) is a known, accepted boundary, not
  the felt gap. It stays out of this slice.
- **Every identified error points the same way.** Unapproved holidays add
  working days; unrecorded absences subtract nothing. Both inflate. There is no
  offsetting term.

## Cross-System Convention

This codebase has an established and repeatedly-enforced convention for exactly
this class: **a figure whose provenance is weaker than a measurement is labelled
on screen, never silently equalised with one.** FR-022 makes a capacity override
a *marked* exception and the tab renders an `Overridden` badge; FR-023 keeps the
computed figure beside a correction and renders `Corrected`; FR-024 withholds
the estimate below two closed sprints rather than showing a weak one; S-17's
calendar notice exists precisely because "zero holidays recorded" and "checked,
genuinely none" rendered identically. The leading hypothesis matches the
convention: a next-window figure derived from projected dates, an unapproved
holiday year and partial absence data is the weakest number this product would
have ever displayed, and the house rule says such a number ships with its
provenance attached or does not ship.

The convention also names the failure mode this slice risks. `lessons.md`: *"A
narrowing predicate turns 'wrong value' into 'empty result', which reads as
success"* — and its sibling, half-wiring a calendar input so one caller stops
excluding holidays. D2 is that lesson, one window to the right.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the next window's capacity is
> computable today from data already loaded on this page — what is missing is
> not the arithmetic or the dates, but a defensible answer to *what such a
> number is allowed to assert*, given that two of its three inputs degrade
> silently past the active sprint's end and both degrade in the same direction.

The initial framing put the whole slice on window identity. That question turns
out to be nearly closed by evidence rather than open: no code path fetches a
Jira future sprint, S-16 shipped without making one a row, and the lead's own
cadence is now durable and already resolves forward. What the framing did not
reach is the part that decides whether the number is worth showing at all —
holiday years that stop at the active sprint's end (`proposal.ts:58`,
`dashboard/page.tsx:149-154`) and absence entry the owner describes as mixed.
Address only the dates and the tab gains a confident figure, rendered at the
same weight as the measured one beside it, that is systematically too high in
exactly the months the lead most needs it (December→January) and by an amount
nobody on screen can see. Address what the number asserts and the date source
becomes what it actually is: a bounded sub-decision inside the slice.

## Confidence

**HIGH.** D2 and D4 rest on unambiguous, cited code and archive facts; D3 rests
on those plus the owner's own report. The one thing NOT verified is whether this
team's Jira board actually holds a dated future sprint — the owner answered "not
checked". That is an input to the date-source sub-decision inside /10x-plan, not
a blocker on the reframe: the holiday-year and absence-coverage gaps are
untouched by however that turns out, and D1 already shows the fetch path does
not exist regardless.

## What Changes for /10x-plan

The plan is about **the honesty of a forecast number**, not about acquiring a
future sprint. It has to settle, in order: what the figure asserts and how the
tab says so; whether the holiday-approval window extends to cover the forecast
window (D2 is a defect the moment a number is shown, and arguably a small one
already); how partial absence coverage is surfaced rather than silently folded
into `adjusted`; and only then, as a bounded sub-decision, which of the three
date sources the window uses — with the lead's own durable cadence the leading
candidate and a `state=future` Jira fetch the branch that must justify a new
integration path. Two incidental cleanups fall out and should be named rather
than discovered: the stale rationale at `availability-view.ts:38-42`, and
`getSprintCapacityFor`'s pinning to a `SelectSprint` row, which no unstarted
window can supply.

## References

- Source files: `src/components/organisms/dashboard/availability.tsx:89-90`;
  `src/components/organisms/dashboard/availability-view.ts:38-42,53-64`;
  `src/lib/dashboard/capacity.ts:257-258`, `capacity.ts` (`getSprintCapacityFor`);
  `src/lib/jira.ts:554-560`; `src/lib/integrations/reconcile-sprint.ts:23`;
  `src/lib/cadence-override.ts:286,339`;
  `src/lib/team-day-off-store.ts:104-110`; `src/lib/holidays/proposal.ts:58`;
  `src/app/(app)/dashboard/page.tsx:149-154`;
  `src/lib/measurement/estimate.ts:10-14`; `src/db/schema.ts:741-778`
- Prior decisions: `context/archive/2026-08-25-absence-calendar/plan.md:650-655`
  (the original "deliberately not from the cadence columns" rationale);
  `context/archive/2026-08-27-capacity-in-man-days/plan.md:1046-1049` (S-18
  parked pending S-23); `context/foundation/roadmap.md:654-670` (S-18 entry)
- Investigation: conducted inline (no sub-agents — the surface is four modules
  already read in full)
