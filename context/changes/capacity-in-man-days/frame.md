# Frame Brief: Capacity in man-days, velocity in story points

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Capacity is expressed in story points, hand-entered per team member
(`team_member.sp_capacity`, `src/db/schema.ts:318`). The owner states this does
not match reality: capacity is a *volume of available time* — man-days — and
story points are what the team *delivers* out of it. Second, stated as a
separate symptom: a team that commits 100 SP and delivers 100 SP shows 100%
reliability, and a half-staffed team that commits 50 and delivers 50 shows the
same 100% — two different states rendering identically.

## Initial Framing (preserved)

- **User's stated cause or approach**: wrong unit and wrong source of truth.
  Capacity belongs in MD (`FTE fraction × sprint working days`), velocity stays
  in SP, and the MD↔SP conversion must be *derived from history*, never entered.
  The owner's own notes assert the arithmetic is unaffected:
  *"zmienia się jednostka i źródło prawdy, nie rachunek"*
  (`context/foundation/capacity-model-notes.md:71-73`).
- **User's proposed direction**: replace `sp_capacity` with an FTE fraction;
  compute `capacity_full` / `capacity_current`; normalise each past sprint's
  velocity up to full capacity before averaging; show capacity and velocity side
  by side; keep history for the team's whole lifetime; honest "no data" on the
  first sprint.
- **Pre-dispatch narrowing** (Step 1.5, owner's words): *"UI wyświetla capacity
  w SP, Capacity to pojemność w Mandaysach. W SP mamy Velocity. (…) Mamy też
  mieć relację między velocity a capacity."* Scope named: **capacity, velocity
  and reliability** — `cel_SP` (the next-sprint target) was **not** named.
  "Delivered" settled as **"Done kiedykolwiek w sprincie"** — first entry into
  DONE counts, even if the ticket later reopened or carried over.

## Dimension Map

1. **Unit & source of truth** — `sp_capacity`, a hand-entered nullable integer
   in SP.  ← initial framing
2. **The divisor: working days** — an MD capacity *is* a working-day count, so
   it inherits every inaccuracy in that counter.
3. **Velocity's producer** — whether the number to be normalised is the one the
   owner means, and whether it is stable.
4. **History substrate** — whether any past sprint's capacity and velocity are
   durably recorded, or reconstructible.
5. **The relation surface** — whether anywhere can hold a capacity↔velocity
   relation across sprints.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Unit & source of truth** — the swap is not a relabel | `0.5` is unenterable at four layers: `type="number"` with no `step` (`roster-editor.tsx:610-618`), `z.number().int()` client-side and server-side (`validations/roster.ts:42`, `setup/team/actions.ts:185`), `integer` column (`schema.ts:318`). Shipped helper copy asserts the **opposite** model — *"a half-time developer's number is already halved… it never multiplies it by anything"* (`roster-editor.tsx:535-538`). S-08 recorded a deliberate decision **against** an `fte` column (`context/archive/2026-08-25-absence-calendar/plan-brief.md:41`). Stored non-null values are un-reinterpretable: `8` as SP vs `8` as FTE is indistinguishable, so the only safe migration NULLs the column. `isUnchanged`'s `===` (`roster-store.ts:484-494`) breaks on a fractional/`numeric` type. And the reducer's *shape* changes, not only its unit: `sp × (available ÷ total)` is a ratio that cancels the day dimension; MD needs `fte × availableDays` — the divisor disappears (`capacity.ts:106,124`). The notes' "nie rachunek" is refuted. | STRONG |
| **2. The divisor** | `nonWorkingDays` is a declared, **empty** seam — no production caller (`helpers.ts:78-80`; call sites `capacity.ts:83,120`, `sprint-at-risk.ts:125,152`, `ticket-status-aging.ts:64`). The roadmap already names this exact victim: *"a Polish team's 15 August currently counts as a full working day **in the capacity number**"* (`roadmap.md:529-533`, S-17, status `proposed`). `sprint.working_days` is never sourced from Jira — a hard-coded Mon–Fri (`cadence.ts:19-26`), with NULL falling silently to the same default (`helpers.ts:117-122`); the user can only pick weekdays, never dates. Sprint boundaries are bare naive `timestamp` (`schema.ts:342-344`), a `timestamptz` migration deferred three slices running. **`sprintWorkingDays` is computed and never rendered** (zero consumers) — so today's wrong divisor is unfalsifiable by the user; MD puts it on screen as the headline. | STRONG |
| **3. Velocity's producer** | `completed_sp = SUM(story_points) filter (current_category = 'DONE')` (`run-sync.ts:821`) — a snapshot of *now*, not "entered DONE during the sprint". The owner's definition is **already implemented twenty lines away**: `burndown-series.ts:135-153` burns SP on a ticket's *first* transition into DONE and never un-burns. The same page renders both, inconsistently (`dashboard/page.tsx`). The scalar keeps being rewritten after the sprint closes (S-16 impl-review F5, `context/archive/2026-08-26-sprint-reconciliation/reviews/impl-review.md:127-134`), freezing at an arbitrary post-end moment. Story points are mutable (`run-sync.ts:772`). `committed_sp` excludes post-start additions, `completed_sp` does not — the reliability ratio divides two different populations and can exceed 100%. And `added_after_sprint_start` is `issue.createdAt > sprintStart` (`run-sync.ts:748-749`) — the ticket's **creation** date, so an old backlog item pulled in mid-sprint counts as committed. | STRONG |
| **4. History substrate** | **No column in any table has ever recorded a sprint's capacity**, in any unit (`schema.ts:331-360`). It is computed live and discarded (`capacity.ts:147-200`), and its reader is pinned to the active sprint via `getActiveSprintRow` (`capacity.ts:151`) — no function can answer "capacity in sprint N-3". Its inputs carry **no time dimension**: `grep valid_from\|effective\|as_of\|snapshot src/db/schema.ts` returns **zero hits**. `is_active` flips in place (`roster-store.ts:585-611`), `sp_capacity` is edited in place, members can be deleted or merged. Velocity survives only as a frozen, unauditable scalar: `jira_ticket` is unique on `(owner_id, jira_key)` (`schema.ts:614`) and the upsert re-stamps `sprint_id` (`run-sync.ts:770`), so a carried ticket **leaves** the old sprint's set and past sprints are unrecomputable. Sprint rows accumulate only since S-16 (2026-08-26, `roadmap.md:631`), never backfilled, and are erased wholesale by a Jira-project switch (`connection-service.ts:405-411`, `jira-store.ts:255-259`). | STRONG |
| **5. The relation surface** | No panel anywhere draws a multi-sprint series (only `sprint-pulse`, `sub-burndown-chart`, `reliability-kpi` import recharts; all single-sprint). `ReliabilityKpi` takes exactly two scalars (`reliability-kpi.tsx:31-37`) with no capacity term, so it *cannot* distinguish the owner's two 100% cases. Its empty state says "fills in after the next sync" — wrong copy for "no history yet", which no sync fixes. PRD names inter-sprint trend dashboards an explicit phase-2 non-goal (`prd.md:217`), reinforced at `roadmap.md:705`. **Correction to the hypothesis:** capacity and reliability are on the *same page* and in the *same server `Promise.all`* (`dashboard/page.tsx:58-70`), split only across two Radix tabs — the gap is presentational and cheaper than assumed. | STRONG |

## Narrowing Signals

- **The owner's "delivered" definition is not the one the system produces.** He
  answered "Done kiedykolwiek w sprincie"; `completed_sp` is a current-category
  snapshot. This alone moves the change out of the unit dimension.
- **Scope named was "capacity, velocity, reliability"** — `cel_SP`, the
  next-sprint target, was not named. That matters, because `cel_SP` is the one
  part that collides with `prd.md:216` (*"SprintFlow will not … forecast sprint
  outcomes"*), a guardrail not scoped to ML alone.
- **The pressure test independently reached the same #1.** A fresh agent given
  only the owner's outcome, with no hypothesis named, ranked
  *"nothing is written down when a sprint ends, and the inputs needed to
  reconstruct it later are mutable current-state"* above every other obstacle —
  including above the PRD prohibition, on the reasoning that a paragraph can be
  revised in an afternoon and lost data cannot.
- **`sp_capacity` is, in practice, usually NULL.** Nothing populates it: the
  roster import does not set it, new rows default to `null`
  (`roster-editor.tsx:736`), and the availability tab has a dedicated empty
  state for exactly that (`availability.tsx:143-147`). The live state is not
  "capacity in the wrong unit" — it is **no denominator at all**, which is
  literally the owner's *"nie znamy dziś relacji"*.

## Cross-System Convention

This repo already knows how to freeze a fact, and did it one slice ago:
`daily_recap.payload` (jsonb `RecapPayload`) is a durable per-day snapshot
holding `committedSp`, `remainingSp`, `byCategory` and activity — and it holds
**no capacity, headcount or absence data**. The per-sprint cadence columns
(`sprint.length_days`, `start_day`, `working_days`) are a second instance of the
same convention: a per-sprint *copy* rather than a global setting, which is why a
past sprint's working-day calendar **is** recoverable while its headcount is not.
So the capability is not missing — the decision that a sprint is a unit of
measurement worth freezing is. The house pattern for the read side is likewise
established: a pure reducer plus an owner-scoped reader (`capacity.ts`,
`aging.ts`), which a "last N sprints" reader extends rather than breaks.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: SprintFlow never records what a
> sprint *was*. Capacity is computed live from a roster with no time dimension
> and then discarded; velocity survives only as a scalar frozen by whichever
> 15-minute sync happened to run before Jira flipped the sprint. So the
> capacity↔velocity relation the owner wants cannot be formed for any sprint but
> the current one — and every rollover permanently destroys another sprint's
> worth of it.

The unit change (SP → MD/FTE) is real and necessary, but it is the *input* to
this problem, not its substance. Changing the unit today and stopping there
leaves the owner exactly where he started at the next retrospective: the
normalised average he asked for still has nothing to average, because
`is_active`, `sp_capacity` and the absence rows will all have moved on, and the
old sprint's tickets will have been re-stamped into the new one. The rollover is
where both halves meet — `reconcileActiveSprint` is the only code in the system
that knows a sprint just ended, it even returns `switched`
(`reconcile-sprint.ts:288`), and it writes nothing about the sprint it closed.

The initial framing was **not wrong** — every claim in it holds. It was
**incomplete in the dimension that decides whether the feature works at all**.
Likewise S-08's recorded decision against an `fte` column was correct
*conditionally*: "an FTE multiplier would double-count a part-timer whose number
is already reduced" is true only while the number is a hand-entered SP total. In
an MD model the FTE is not a multiplier laid on top — it is the source. The
prior decision is reversed by a change of model, not by an error in it, and the
reversal must be recorded rather than passed over.

## Confidence

**HIGH** — all five dimensions returned strong file:line evidence; an
independent agent that was never told the hypothesis ranked the same dimension
first; the reframe matches an existing house convention (`daily_recap.payload`)
rather than inventing a mechanism; and the one sub-claim that failed
pressure-testing (D5's "different dashboards") was corrected downward, not
defended.

## What Changes for /10x-plan

The plan is about **per-sprint measurement**, with the MD/FTE unit change as one
input to it: a durable per-sprint record written at the rollover
(`reconcile-sprint.ts`, which already detects the moment), holding that sprint's
full capacity, absence-adjusted capacity and delivered SP — the last computed
from first-entry-into-DONE (`burndown-series.ts:135-153`), which the repo
already implements correctly and simply never persists as velocity.

### Settled at framing (2026-08-27, owner) — do not re-open

These three were resolved before this brief was handed on, and the canonical
documents were amended in the same pass. The slice is **roadmap S-23**.

1. **Retention — amended, not circumvented.** `prd.md` § Non-functional
   non-goals now bounds *raw synced data* to current + 2 sprints and exempts the
   FR-023 per-sprint measurement record, retained for the team's whole lifetime.
   Inter-sprint **trend dashboards** stay parked, for a narrowed reason: the
   surface is phase-2, the data is no longer forbidden.
2. **Holidays — in scope here, entered by hand.** A holiday reduces capacity by
   one man-day per person (the owner's framing: *"to tak jakby wszyscy
   jednocześnie mieli wolne"*). The lead records team-wide days off per sprint
   (FR-007 extended); deriving them from a country stays **S-17**, which is now
   *downstream* of S-23. `roadmap.md`'s "no unshipped FR depends on it" note was
   retired.
3. **`cel_SP` — out of scope; the guardrail was clarified, not loosened.**
   Measuring and normalising past sprints is measurement of the past and is in;
   a computed "aim for N SP next sprint" target is out. Recorded on the
   no-forecasting non-goal itself, so a future reader cannot mistake FR-023 for
   a violation.

### Still open for /10x-plan

1. **The `sp_capacity` migration destroys data.** Every stored non-null value is
   un-reinterpretable — an `8` is indistinguishable as 8 SP or 8 FTE — so the
   migration must NULL them, throwing any team that filled the field into the
   "no capacity set for anyone" empty state. A user-visible regression needing a
   decision and copy, not a silent migration.
2. **Where the per-sprint record is written, and what happens to sprints that
   closed before it existed.** The rollover hook exists (`reconcile-sprint.ts:288`)
   but the series only starts accumulating from the first write; there is no
   backfill, and S-16 means sprint rows themselves date only from 2026-08-26.
3. **A Jira-project switch still erases the whole substrate**
   (`connection-service.ts:405-411`, `jira-store.ts:255-259`) — one settings
   action deletes every sprint row and cascades. Decide whether the measurement
   record survives it.

Two smaller items the notes did not anticipate, both cheap and both load-bearing
for a ratio measured to a few percent: `story_points` is an `integer` column
(`schema.ts:600`) so half-points are lost, and `added_after_sprint_start` keys
off ticket *creation* date (`run-sync.ts:748-749`), misstating reliability's
denominator today.

## References

- Domain notes: `context/foundation/capacity-model-notes.md`
- Current capacity: `src/lib/dashboard/capacity.ts:68-128,147-200`
- Velocity write: `src/lib/integrations/sync/run-sync.ts:748-749,770-772,818-831`
- The correct DONE primitive: `src/lib/dashboard/burndown-series.ts:135-153`
- Rollover hook: `src/lib/integrations/reconcile-sprint.ts:265-274,288`
- Schema: `src/db/schema.ts:318,321,331-360,600,614,620-651`
- Surfaces: `src/components/organisms/dashboard/reliability-kpi.tsx:31-37`,
  `availability.tsx:126-166`, `src/components/organisms/setup/roster-editor.tsx:535-538,610-619`
- Prior decisions reversed or touched: `context/archive/2026-08-25-absence-calendar/plan-brief.md:41`,
  `context/archive/2026-08-26-sprint-reconciliation/reviews/impl-review.md:127-134`
- Product constraints in tension: `context/foundation/prd.md:111,216,217`,
  `context/foundation/roadmap.md:516,529-550,631,705`
- Investigations: 5 parallel dimension agents (D1–D5) + 1 unbiased pressure-test agent
