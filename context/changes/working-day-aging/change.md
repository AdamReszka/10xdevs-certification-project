---
change_id: working-day-aging
title: Anomaly aging stops counting the weekend as work
status: impl_reviewed
created: 2026-08-30
updated: 2026-08-31
archived_at: null
---

## Notes

Roadmap **S-28** (`context/foundation/roadmap.md`). PRD refs FR-009, FR-013,
FR-016. Prerequisites S-06, S-14, S-23 — all `done`.

Split out of S-19 on 2026-08-30 at `/10x-frame team-navigation-section`. The
full evidence and the reasoning that produced this slice live in
`context/changes/team-navigation-section/frame.md`; this file carries only what
a planner needs first.

### Where it came from

The owner raised it unprompted while framing S-19: *"było takie wskazanie, że
mechanizm niepotrzebnie liczy soboty i niedziele jako dni robocze, w sensie że
czas się przelicza na taskach."* The frame verified it against the code and found
it wider than reported.

### The mechanism, verified at frame time

`countWorkingDays` / `countWorkingDaysInclusive` (`src/lib/anomaly/rules/helpers.ts:96-117`)
exist, are tested (`helpers.test.ts:65,142`) and already take the sprint's
`workingDays`, the team's time zone and `nonWorkingDays`. They are read by **3 of
~9** elapsed-time measurements:

| Measurement | How it measures | Weekend counts? |
| --- | --- | --- |
| `TICKET_STATUS_AGING` In Progress 1–13 SP | `hoursBetween` (`ticket-status-aging.ts:77`) | yes |
| `TICKET_STATUS_AGING` Code Review / Testing | `hoursBetween` (`:83`) | yes |
| `TICKET_STATUS_AGING` In Progress 21 SP | `countWorkingDays` (`:67`) | no |
| `PR_REVIEW_STALLED` | `hoursBetween` (`pr-review-stalled.ts:31`) | yes |
| `DEVELOPER_INACTIVE` | `now − days × MS_PER_DAY` (`developer-inactive.ts:31`) | yes |
| `TICKET_NO_COMMIT_LINK` | `daysBetween` (`ticket-no-commit-link.ts:28,36`) | yes |
| `SPRINT_AT_RISK` time left | `hoursBetween` (`sprint-at-risk.ts:88`) | yes |
| `SPRINT_AT_RISK` absence cost | `countWorkingDaysInclusive` (`:142,164`) | no |

The principle is already stated in the codebase and applied to one of five
branches of the function it sits in — `ticket-status-aging.ts:62-66`: *"A ticket
does not age on a day the whole team is off … the budget is a budget of days
somebody could have moved it."*

Concretely: a 3 SP ticket moved to In Progress on Friday at 16:00 has a 48 h
budget and fires on Sunday at 16:00 — into the Monday morning-sync inbox that
FR-016 calls the headline surface.

### Open, and deliberately left to planning

- **Which rules become working-day-aware.** Not obviously all of them: a PR that
  has waited across a weekend may still be worth surfacing on Monday. The frame
  did not settle this and should not have.
- **Whether thresholds need recalibrating.** A 24 h budget that skips weekends is
  a different promise from the one the defaults were tuned against (FR-009).
- **FR-009 itself mixes units** ("1/2 SP=24h … 21 SP=8 working days") and never
  says how a weekend is treated. Expect a PRD amendment rather than a silent
  reinterpretation.

### Three places a plan can trip (not yet read — research targets)

1. **The threshold model** — `src/db/defaults.ts` and `/settings/anomalies`. A
   bucket is hours OR a sentinel; "10 working days" is currently inexpressible,
   recorded as deliberately not done in `manual-test-backlog.md` §10 and
   `anomaly-settings-page/plan.md:108`.
2. **The demo fixture is anchored to the moment it was loaded** — corrected by
   research on 2026-08-30; this line previously said "a frozen clock", which is
   only half true. `buildDemoFixture` is anchor-relative (`fixture.ts:135-139`)
   and the anchor is real wall-clock time at load, stored as `user.demo_anchor_at`
   (`load.ts:71,91,130`). So the demo can be loaded on any weekday, and under
   working-day math whether it still shows four anomaly types — US-02's
   acceptance criterion — starts depending on which day that was. `fixture.ts`
   has no test.
3. **`stryker.conf.json`** — `break: 70`, scoped to exactly these rule files.
   Per CLAUDE.md it wins by filename precedence over the stale
   `stryker.config.json`.

### Neighbouring open report

`context/manual-tests/S-11-obserwacja-recap-dni-wolne.md` — the Daily Recap knows
neither weekends nor company days off. Same class of defect at a different layer;
read before scoping.

### Worktree constraints

No migration — this slice touches `src/lib/anomaly/**` and possibly
`src/db/defaults.ts`, not the schema. Safe for the parallel worktree alongside
S-26 in the main checkout. Per `lessons.md:63`, grep `*.integration.test.ts` and
`e2e/*.spec.ts` for assertions on anomaly copy and counts before closing any
phase, and run the E2E suite from here only while the other session is idle.

### Stored numeric thresholds changed meaning, and nobody held one (impl-review F1, 2026-08-31)

Recorded so a later reader does not go hunting for a bug that has no victims.

The slice divided every default by three — 24 → 8, 48 → 16, 72 → 24, 120 → 40 —
because 24 h had always *meant* "a day" and a day is eight working hours. A
**stored** override does not move with a default. So a number an owner had saved
before the merge survives validation untouched and is now read in the new unit:
`codeReviewHours: 24`, entered meaning one calendar day, becomes 24 WORKING hours
= three working days; a saved `inProgressHoursBySp["8"]: 120` becomes fifteen
working days, about three calendar weeks, and `TICKET_STATUS_AGING` effectively
stops firing on that bucket for the rest of the sprint.

Two things make this invisible rather than loud. The shape did not change, so
`mergeRule`'s `.strict()` revalidation passes and nothing is discarded or logged —
the mechanism that *would* have shouted is the one the plan correctly worked to
avoid tripping. And the failure direction is **suppression**: a threshold that is
too long produces silence, which reads like a healthy sprint. The settings card
shows the same digits it always showed; only the unit label moved from `h` to
`working hours`.

**Measured at review time: `anomaly_settings` on production holds ZERO rows** —
`select count(*)` = 0, no account has ever saved a threshold. The blast radius was
empty, which is why no migration and no user-facing warning were added. `updated_at`
exists on the table, so a backfill dividing pre-merge bodies by three would have
been feasible had there been anything to divide.

The exposure window is closed going forward: anything saved from now on is
entered and stored in working hours. This note exists only for the case where some
other environment — a local database, a restored dump — still carries a pre-merge
row, and someone wonders why its anomalies went quiet.

The plan's `## Migration Notes` reasoned this through for the `"8_WORKING_DAYS"`
string sentinel and concluded "no migration", which was right; it simply never
addressed the numeric case, which was the larger population had any of it existed.
