# Working-Day-Aware Anomaly Aging (S-28) — Plan Brief

> Full plan: `context/changes/working-day-aging/plan.md`
> Frame brief: `context/changes/team-navigation-section/frame.md`
> Research: `context/changes/working-day-aging/research.md`

## What & Why

The anomaly engine ages tickets, PRs and developers against a wall clock that
never stops — so a budget is spent on nights, Saturdays and company days off, and
the Monday morning-sync inbox holds items that accrued while nobody could act on
them. The frame verified the report and found it wider than reported: the
working-day calendar the fix needs already exists, is tested, and is read by
**3 of ~9** elapsed-time measurements. Nothing in the archive ever argued for
wall-clock aging — it was the default nobody discussed.

## Starting Point

`countWorkingDays` / `countWorkingDaysInclusive` (`helpers.ts:96-118`) take the
sprint's working days, the team's zone and the team-wide day-off calendar, and
all three inputs ride on every snapshot already (`load-snapshot.ts:62-64,104`).
They govern exactly two places: the 21-SP In-Progress bucket and
`SPRINT_AT_RISK`'s absence cost. Every other measurement does raw millisecond
arithmetic — including four branches of the same function that contains the
working-day one, which states the principle in a comment and applies it to one
branch out of five.

## Desired End State

A ticket moved to Code Review on Friday at 15:00 is absent from the inbox all
weekend and appears on Monday at 15:00. If the lead marked that Monday as a
company day off, it appears on Tuesday. If its assignee is on personal leave, it
appears on Monday all the same — the sprint belongs to the team, and the inbox is
an alert for the lead, not a device pointed at a person. The settings page says
`working hours` on every time budget, and the 21-SP bucket is an ordinary number
field.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Semantics of "working-day aging" | The clock runs only 08:00–16:00 local, on the sprint's working days, minus team-wide days off | The owner's own framing: what matters is that time stops outside working hours, not that the boundary is exact — a ticket put in review at 16:00 must not alert at 04:00 | Plan (owner) |
| Working hours as config vs. constant | Hard-coded 08:00–16:00 | Research ruled this shape out only because it assumed a column, a migration and a settings surface; the owner settled that an average is good enough, which removes all three | Plan (owner) |
| Threshold unit | Stays **hours**, now working hours | `mergeRule` revalidates every stored override on read with a `.strict()` schema and silently discards the whole rule on failure — keeping the shape is what makes this slice safe without a backfill | Research |
| Default values | Intent preserved in days at 8 h/day: 24→8, 48→16, 72→24, 120→40, sentinel→64, 48→16 | A mid-week ticket ages out after roughly the same calendar span as today; a Friday one stops firing on Saturday. Defaults, not a ceiling — the lead retunes per team | Plan (owner) |
| The `"8_WORKING_DAYS"` sentinel | Retired from the detector and the form; still accepted by the validator, normalised to 64 | 8 working days is 64 working hours — an ordinary number — so S-14's parked "10 working days is inexpressible" problem dissolves; dropping the literal outright would reset every account that used it | Research |
| Which rules change | All five that measure elapsed time, including `PR_REVIEW_STALLED` and `SPRINT_AT_RISK`'s ToDo-near-end | One unit across the whole engine; the ToDo countdown becomes less calendar-like, so its copy names the unit explicitly | Plan (owner) |
| Individual absences | Do **not** pause any clock | The sprint is measured per team; if someone cannot finish, someone else picks it up | Plan (owner) |
| `DEVELOPER_INACTIVE` absence suppression | Unchanged | A separate mechanism required by FR-010, and consistent with "an alert, not a collar" | Plan |
| Daily Recap's own weekend defects | Out of scope, annotated | The recap's scheduler and its calendar-day "yesterday" are a different layer; the tester's note gets a dated paragraph so it is not read as half-closed | Research |
| PRD FR-009 | Amended in this slice | It mixes units today and never says how a weekend is treated; a silent reinterpretation is what the frame warns against | Plan (owner) |

## Scope

**In scope:** a working-hours primitive (measure + signed shift) and its zone
layer; `TICKET_STATUS_AGING`, `PR_REVIEW_STALLED`, `SPRINT_AT_RISK` ToDo-near-end,
`DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`; recalibrated defaults; validator
back-compatibility; settings units and the retired sentinel control; inbox and
recap copy; the demo fixture plus its first-ever test; PRD FR-009, roadmap S-28,
and seven manual-backlog rows.

**Out of scope:** configurable working hours; individual absences as clock input;
`DEVELOPER_INACTIVE`'s FR-010 suppression; `SPRINT_AT_RISK`'s absence-cost
arithmetic; the Daily Recap's weekend send and "yesterday" window; any migration.

## Architecture / Approach

One primitive, symmetric by design — `workingHoursBetween` to measure and
`shiftWorkingHours` to walk, with `workingHoursBefore` as the named backwards
wrapper the rules call. It sums each qualifying day's overlap with that day's
08:00–16:00 window, resolved through a new `localHourInstant` in `day-bucket.ts`
that uses the same binary search `dayRangeInTimeZone` already uses (local
midnight + 8 h is wrong across DST, and that file's own doc block says so). The
detectors then read the calendar they were already being handed on every
snapshot; the loader, the schema and the snapshot type are untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Working-time primitive | Measure + signed shift, zone- and DST-correct, nothing calls it yet | DST and non-whole-hour zones — the repo has one recorded zone bug and one bad zone correction already |
| 2. Hour-denominated rules + defaults | Aging, PR review and ToDo-near-end on working hours; recalibrated numbers; sentinel back-compat | A shape change would silently reset every customised rule with only a `console.error` |
| 3. Window-based rules | `DEVELOPER_INACTIVE` and `TICKET_NO_COMMIT_LINK` | One `windowStart` serves three boundaries; one test will pass for the wrong reason |
| 4. Settings, copy, PRD | Units, numeric 21-SP field, FR-009 amendment, roadmap, S-11 annotation | Copy is unpinned by tests, so a wrong unit does not fail — it lies, including in email |
| 5. Demo + backlog | Fixture offsets in working hours, seven-anchor test, manual reconciliation | US-02's "four anomaly types" becomes load-day-dependent, and `fixture.ts` has no test today |

**Prerequisites:** S-06, S-14, S-23 — all `done`. No migration, so this is safe in
the parallel worktree; the integration and E2E suites must wait for the other
session to be idle.
**Estimated effort:** ~4–5 sessions across 5 phases.

## Open Risks & Assumptions

- **DST inside the working window.** In `Europe/Warsaw` the transition falls at
  night, so a working day stays 8 hours; a zone that shifts inside 08:00–16:00
  would give 7 or 9. The plan asserts whatever the wall clock gives rather than
  forcing 8 — worth a second look at review time.
- **`snapshot.timeZone` is nullable** and degrades to UTC. Rules that were
  zone-agnostic by construction now depend on it, so a team whose Jira never
  supplied a zone shifts its boundaries by up to a day's fraction.
- **The recalibration is a judgement, not a measurement.** No team's data was
  consulted; the numbers preserve the intent recorded in the code's own comments,
  and the settings page is the escape hatch.
- **Assumption:** no account outside the owner's has customised a threshold, so
  the back-compat path is belt-and-braces rather than load-bearing — but it costs
  one union member to keep, and the failure it prevents is silent.

## Success Criteria (Summary)

- A Friday-afternoon ticket does not reach the inbox until Monday, and a company
  day off pushes it a further day.
- An account that had customised a threshold before this slice still sees its own
  numbers, with no unprompted "Unsaved changes." on page load.
- The demo shows at least four distinct anomaly types on any weekday it is
  loaded — asserted by a test, not by inspection.
