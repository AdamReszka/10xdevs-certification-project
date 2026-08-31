# Next-window capacity as a number on the availability tab — Plan Brief

> Full plan: `context/changes/next-sprint-capacity/plan.md`
> Frame brief: `context/changes/next-sprint-capacity/frame.md`

## What & Why

The next window's capacity is computable today from data already loaded on the
Availability tab — what is missing is not the arithmetic or the dates, but a
defensible answer to *what such a number is allowed to assert*, given that two of
its three inputs degrade silently past the active sprint's end and both degrade in
the same direction. This slice ships the number, closes one of the two
degradations, and labels the other.

## Starting Point

The Availability tab draws two member × day grids and puts a man-day figure under
the first only; the second says who is away and stops there. `nextWindowAfter`
extrapolates that second window from the current sprint's accidental
millisecond span, ignoring the lead's cadence, and its comment explaining why is
stale as of S-30. `getSprintCapacityFor` already loads every input the second
window needs — roster, absences past sprint end, day-off calendar, resolved
cadence — in one fan-out. Meanwhile the holiday-approval horizon stops at the
active sprint's end, so a January the forecast window reaches carries no holiday
rows and counts as ordinary working days.

## Desired End State

Above the "Next window" grid sits a capacity figure in man-days for a window whose
length is the lead's own durable cadence, carrying a `Projected` badge, the
working-day count it was computed from, and a sentence naming both ways the figure
can be too high — with a stronger line for a lead whose account holds no absence
at all past the running sprint. The badge is withheld once the window's first day
has arrived, because the displayed sprint is not always one that is running. The
holiday proposal, the calendar notice and the approval action all reason about the
same, longer horizon.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the window's dates come from | Not a Jira `state=future` sprint | No code path fetches one, S-16 shipped without making one a row, and they commonly carry no dates. | Frame |
| Window LENGTH | The lead's cadence (`resolveCadenceFor().lengthDays`) | A strict superset of today's LENGTH SOURCE — tier 3 falls back to `sprint.length_days`, the reconciler's cache of Jira's own dates, when the lead has set nothing. | Plan |
| Window START | The day after this sprint's last drawn day | Keeps the two grids contiguous; aligning to `startDay` would open a 1–6 day gap in which an absence appears in neither grid. | Plan |
| Window drawn length | Exactly `lengthDays` calendar days | The cadence field says "Sprint length (days)"; reproducing the current grid's extra boundary day would inflate the figure by one working day per FTE. EVERY account's "Next window" grid therefore loses one column, not only one that set a cadence (plan-review F1). | Plan |
| How the weaker provenance shows | `Projected` badge + one caveat sentence, both keyed on `now` | House convention (`Overridden`, `Corrected`, S-17's notice): a figure weaker than a measurement is labelled, never silently equalised — and the badge alone would not say the error is one-directional. The badge is withheld once the window's first day has arrived: `getActiveSprintRow` falls back to an ENDED sprint, so "projected" would be a false claim there (plan-review F3). | Frame + Plan |
| Partial absence coverage | Always-on caveat, plus a stronger notice when the ACCOUNT holds no absence past the running sprint | Zero absences in a fortnight is the ordinary healthy state, so a windowed test would fire almost always and could not separate "checked" from "not entered"; the true analogue of S-17's account-wide, date-unbounded `calendarIsEmpty` is the lead's habit of recording forward at all (plan-review F2). | Plan |
| Holiday horizon (D2) | Extended, on all three surfaces at once | `approveHolidayYearAction` re-derives the window and refuses years outside it, so widening only the pages produces a notice naming a year the button rejects. | Frame + Plan |
| Story points for the next window | Out of scope | FR-024's estimate stops at the ACTIVE sprint by design; the owner named the MD number, not the SP answer, as the felt gap. | Frame |

## Scope

**In scope:** the forecast window's man-day figure and its provenance copy; the
window's length moving onto the lead's cadence; the absence query's bound
following the real window; the holiday-approval horizon reaching that window
across all three surfaces; the two cleanups the frame named (the stale rationale
comment, `getSprintCapacityFor`'s `SelectSprint` pin).

**Out of scope:** a Jira `state=future` fetch; a story-point estimate for the next
window; capacity override or delivered-SP for a window with no Jira sprint id; the
current sprint's own window and figure; any schema change; making forward absence
entry easier.

## Architecture / Approach

`resolveCadenceFor` needs a database handle, so moving the window onto the cadence
moves its derivation from the client to the server. One pure helper
(`lib/dashboard/next-window.ts`) then serves three consumers: the capacity reader,
which computes both windows from ONE fan-out and widens its absence bound to the
cadence editor's own ceiling so the window can never outrun it; the holiday
horizon, which composes it with `holidayYears` into a
single spelling the dashboard, `/team/days-off` and `approveHolidayYearAction`
all call; and the tab, which now receives the window's bounds as ISO strings
instead of computing them. The panel's sentences are decided in a pure `.ts`
sibling, because this project has no component-test harness.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Window as a server-side fact | Cadence-driven window, absence bound widened to the cadence ceiling, both frame cleanups; the grid loses one column everywhere | The absence bound falling short of the new window — absences vanish and the figure silently rises |
| 2. Holiday horizon | The forecast window's year is proposed and approvable on all three surfaces | The page and the validator disagreeing, producing a dead end on screen |
| 3. The number and its label | `Projected` figure (badge keyed on `now`), working days, caveat, no-forward-absence notice | Shipping the number without the label — the one outcome the slice exists to prevent |

**Prerequisites:** S-08, S-16, S-17, S-23, S-30 and S-32 — all shipped. No
migration, no new dependency, no external access.
**Estimated effort:** ~1–2 sessions across 3 phases; Phase 1 is the largest diff,
Phase 3 the largest design surface.

## Open Risks & Assumptions

- **The two grids differ by one drawn day, for every account.** A real Jira sprint
  ends at the same time of day it starts, so the current grid draws
  `lengthDays + 1` columns while the forecast draws `lengthDays`. Accepted and
  named in the plan: the extra day would inflate the figure in the same direction
  as every other error here. The visible consequence is that the "Next window"
  grid loses one column on first render after deploy, on every account.
- **Nobody has compared the drawn window against a real next sprint** (owner:
  "not checked"). The cadence source makes this checkable for the first time, but
  the first real confirmation comes from manual testing.
- **The caveat's honesty is only as good as the lead reading it.** There is no
  mechanism forcing forward absence entry; this slice makes the consequence
  visible, it does not remove it.
- **`sweep.ts` shares the reader.** It must keep producing identical capacity
  numbers for closed sprints and must not start persisting the forecast field.

## Success Criteria (Summary)

- The lead opens Availability mid-sprint and gets a man-day answer to "can I
  promise this?" for the next window, not only a list of who is away.
- The answer says out loud that it is projected — while it still is — and in which
  direction it errs.
- A sprint running into January proposes that January's holidays and lets the lead
  approve them, instead of counting 1 January as an ordinary working day.
