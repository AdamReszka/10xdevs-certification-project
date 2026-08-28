# Capacity in man-days, velocity in story points — Plan Brief

> Full plan: `context/changes/capacity-in-man-days/plan.md`
> Frame brief: `context/changes/capacity-in-man-days/frame.md`
> Planning decisions (binding): `context/changes/capacity-in-man-days/planning-notes.md`

## What & Why

**SprintFlow never records what a sprint *was*.** Capacity is computed live from
a roster with no time dimension and then discarded; velocity survives only as a
scalar frozen by whichever 15-minute sync happened to run before Jira flipped the
sprint. So the capacity↔velocity relation the owner wants cannot be formed for
any sprint but the current one — and every rollover permanently destroys another
sprint's worth of it. The unit change (SP → man-days) is real and necessary, but
it is the *input* to this problem, not its substance.

## Starting Point

`team_member.sp_capacity` is a hand-entered story-point integer that nothing ever
populates — so today there is not "capacity in the wrong unit", there is **no
denominator at all**. The working-day counter has a `nonWorkingDays` seam that
S-08 declared and left empty at all five call sites. Both sprint scalars are
recomputed every cycle: committed SP grows with scope creep (reliability always
looks good) and delivered SP is a snapshot of "what is in Done right now",
rewritten even after the sprint closed. The rollover hook exists —
`reconcileActiveSprint` returns `switched` — and writes nothing about the sprint
it just closed. `ReliabilityKpi` takes two scalars and no capacity, so a full
team's 100% and a half team's 100% render identically.

## Desired End State

The lead sees a capacity in man-days with the working-day count it came from,
beside a reliability figure that is finally interpretable. Public holidays are
recorded once as dates and cost one man-day per person in every sprint they fall
in. When a sprint closes, a small permanent record of what it was is written —
full capacity, capacity after absences, committed SP frozen at start, delivered
SP counted from first entry into Done. After two closed sprints, an estimated
velocity appears next to the numbers it was derived from — the average of past
normalised velocity scaled by the **active** sprint's capacity ratio — and is
withheld entirely below that sample size.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the slice is about | Per-sprint measurement, not a unit swap | Changing the unit and stopping leaves the average with nothing to average at the next retrospective | Frame |
| Roster column | `sp_capacity` deleted, `fte numeric(3,2)` NOT NULL DEFAULT 1.00, entered by a 1.0/0.75/0.5/0.25 select | An `8` is un-reinterpretable as SP or FTE, and `0.5` is unenterable at four layers today | Notes |
| Where capacity lives | Roster holds the *fact* (availability); capacity is an artefact of a sprint | "Prawdziwe capacity w team roster to nie jest właściwe miejsce" — so FR-022's override sits at the sprint | Notes |
| Record location | A separate `sprint_measurement` table, `jira_project_id` as plain text with **no FK** | `sprint` rows cascade away on a project switch and fall under "current + 2" retention; the record must outlive both | Notes |
| When the record is written | Idempotent sweep in every sync cycle, not a rollover hook | A stalled cron or expired token at rollover would lose that sprint forever — the exact silent loss the frame identified | Notes |
| Backfill | None | Historical capacity is physically unreconstructable; FR-023 forbids substituting a default | Notes |
| Committed SP | Frozen at first sighting as ACTIVE, **with a freeze timestamp** | A commitment that grows with the scope added to it makes reliability good by construction; the stamp makes a late freeze visible | Notes |
| Delivered SP | First entry into Done inside the sprint window, sharing the burndown's primitive | The owner's own definition, already implemented twenty lines from the wrong one and never persisted | Frame |
| `story_points` column | Stays `integer`; a rounding guard is added at the Jira parser | Measured: a `0.5` rolls back the whole Jira transaction and wedges sync in `ERROR` forever — an availability defect, not a precision one; 0.5 SP is not in FR-009's Fibonacci domain | Notes |
| Team days off | Dates on the account, not per sprint | One entry works in every sprint spanning it, and it is the row shape S-17 will generate from a country | Notes |
| Reliability formula | Unchanged (delivered ÷ committed); capacity stands **beside** it | FR-016 is explicit that capacity is context, not a term in the ratio | Notes |
| FR-024's capacity ratio | Taken over the **active** sprint, not a future one; minimum two closed sprints | A sprint that has not started has no Jira row, no working days and no absences — that is roadmap S-18; `roadmap.md:744` already carries the owner's formula as `capacity_current ÷ capacity_full`. PRD FR-024 is amended in Phase 1 | Plan review F1, F8 |
| Sweep's SP sources | `committed_sp` **copied** from the frozen `sprint` scalar; `delivered_sp` **recomputed** from `jira_status_history` first-DONE, not filtered by `sprint_id` | A carried-over ticket is re-stamped into the next sprint, so a `where sprint_id = N` sum loses it; copying `completed_sp` would record a stale figure whenever the cron stalls across a rollover | Plan review F2 |
| History surface | A sprint switcher on `/dashboard/sprint-detail` | Chosen over a separate list, knowing older sprints show correct headline numbers beside empty detail tabs — the screen must say so | Notes |
| Jira-project switch | The record survives and carries `jira_project_id`; the series filters on the current project | Mixing two projects' measurements averages two different teams, worse than the honest "no data" | Notes |

## Scope

**In scope:** FTE column + migration + confirmation banner; team-days-off
calendar and the `nonWorkingDays` seam wired at all five sites; committed-SP
freeze, changelog-based `added_after_sprint_start`, story-point guard,
delivered-SP from first entry into Done; the `sprint_measurement` table and its
idempotent sweep; per-sprint capacity override and delivered-SP correction;
capacity beside the Reliability KPI; FR-024's estimated velocity; a sprint
switcher on Sprint Detail.

**Out of scope:** backfilling historical sprints; a `numeric` migration for
`story_points`; automatic holiday derivation from a country (S-17); a "you took
on too much" `SPRINT_AT_RISK` condition (needs history to set a threshold);
multi-sprint trend charts; per-member historical snapshots; the `timestamptz`
sprint-boundary migration.

## Architecture / Approach

Four write-path phases then three read-path phases. `team_member.fte` feeds a
reshaped pure reducer (`fte × availableDays` — the old
`sp × (available ÷ total)` ratio cancelled the day dimension). A `team_day_off`
table fills the seam that already exists in `countWorkingDays*`, reaching the
detectors through `SprintSnapshot`. `run-sync` stops recomputing what it should
freeze. A sweep called beside `detectAnomalies` — in the cron loop and after a
manual sync — upserts one `sprint_measurement` row per sprint, refreshing
computed columns only until the sprint finalizes and never touching the lead's
override or correction. Everything downstream (capacity beside reliability, the
FR-024 estimate, the sprint switcher) reads that one table.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. FTE replaces SP capacity | `fte` column, four-choice select, confirmation banner, MD reducer | The migration makes every part-timer full-time — inflated capacity if the banner is skipped |
| 2. Team days off + the seam | Days-off table, seam wired at all five call sites, working days on screen | Half-wiring the seam gives two counters that disagree (`lessons.md`) |
| 3. Honest sprint sums | Committed frozen at start, changelog denominator, delivered from first-DONE, SP guard | The changelog fix must land *before* the freeze, or the first freeze captures the wrong denominator permanently |
| 4. Measurement record | `sprint_measurement` + idempotent sweep | The sweep computes a closed sprint's capacity from the *current* roster — accurate only if it runs within a cycle or two |
| 5. Override & correction | Per-sprint capacity override and delivered-SP correction | A careless override feeds FR-024's normalisation and skews every later average |
| 6. Relation & estimate | Capacity beside Reliability; FR-024 estimated velocity over the **active** sprint's capacity ratio | Presenting arithmetic as a forecast — guarded by always showing its inputs and withholding below two closed sprints |
| 7. Sprint switcher | Closed sprints viewable on Sprint Detail | Older sprints show correct numbers beside empty detail tabs; the screen must state the reason |

**Prerequisites:** S-08 and S-16 are done. **Manual-test backlog row 1.8 blocks
Phase 3's manual verification** — the FM Jira project has all `story_points =
NULL`, so the capacity↔velocity relation has nothing to measure on live data
until estimates are entered.
**Estimated effort:** ~4–6 sessions; phases 1–4 are the spine, 7 is cuttable.

## Open Risks & Assumptions

- The sweep reads the **current** roster to measure a sprint that has closed. A
  sweep that runs weeks late (long outage) measures a roster that has moved on.
  Accepted: a delayed record beats a lost one, and this is why the sweep runs
  every cycle rather than at rollover.
- ~~Jira's changelog names the `Sprint` field by display name; a non-English Jira
  instance may label it differently.~~ **Closed by plan review F5**: matching
  moves to the resolved `fieldId` (discovered the way `resolveStoryPointFieldId`
  already discovers the story-point field), with the display name as a secondary
  and a counted fallback. The accepted-risk framing no longer held once Phase 3
  §4 began *freezing* the denominator permanently.
- Phase 1's data loss is irreversible. Any team that had filled `sp_capacity`
  loses it, and the banner is the only signal.
- After a Jira-project switch the history reads as empty despite rows existing —
  correct, and it needs saying on the screen. Phase 7 resolves `?sprint=` from
  `sprint_measurement` first so this case renders the notice rather than
  silently falling back to the active sprint (plan review F3).
- The "current + 2 sprints" purge is not implemented yet; only the
  project-switch cascade is live, so the retention notice's retention half is
  integration-test-only for now (plan review F7).

## Success Criteria (Summary)

- A lead looking at 100% reliability can tell a full team's sprint from a
  half-staffed one, because the capacity in man-days stands next to it.
- A sprint that closes is recorded permanently, and the record is still there
  three sprints and one Jira-project switch later.
- After two closed sprints the lead gets an estimated velocity with the numbers
  it came from — and before that, an honest "we have N of the 2 sprints this
  needs" rather than a fabricated conversion or a one-sprint pseudo-average.
