# Frame Brief: Working-days calendar (S-17)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Leads must type every public holiday into `/team/days-off` by hand — otherwise
the day counts as a full working day in the capacity divisor and in all five
elapsed-time anomaly budgets.

**Measured, 2026-08-31:** in the local database **no real account holds a single
`team_day_off` row.** Only four demo accounts have rows (2 each, from the demo
fixture). Production has zero users at all.

## Initial Framing (preserved)

- **User's stated cause or approach**: the account stores no country, so holidays
  cannot be derived (roadmap S-17).
- **User's proposed direction**: a country (or holiday-set) field, a source for
  the dates, generated rows, and a settings surface.
- **Pre-dispatch narrowing**: the owner has not yet separated the concerns —
  *"jeszcze do tego nie doszliśmy, dlatego nie było żadnych obaw wcześniej;
  trzeba to zrobić i zobaczyć co wyjdzie"*. Scope: **one country, whole team**
  (regions and multi-country ruled out). Exceptions: **the inverse of deletion** —
  the national calendar is correct, and the team ADDS company days and bridge
  days on top. On staying current: *"raz w roku przeglądam propozycję"* — the
  lead expects to review and approve a proposed list, not to have rows appear
  silently.

## Dimension Map

1. **Data model** — `team_day_off` cannot express where a row came from, and
   `unique(owner_id, day)` forces a collision policy nobody has chosen.
2. **Lifecycle** — nothing decides *when* generation runs; nothing in the repo is
   year-boundary aware.
3. **Consumer semantics** — populating the table may not actually produce correct
   behaviour everywhere it is read.
4. **Silence** — nothing tells the lead the calendar is empty; zero holidays
   reads identically to "checked, there are none".
5. **Country and date source** — no column exists; a time zone is not a
   jurisdiction. ← initial framing *(verified without an agent: no country column
   anywhere, `jira_project.time_zone` is the only geographic signal)*

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Data model cannot carry generated rows | S-23 built this table **for S-17 explicitly**. `schema.ts:794`: *"the row shape S-17 will later GENERATE from a country, so that slice appends rows rather than reshaping the model."* `team-day-off-store.ts:27`: `ON CONFLICT DO NOTHING` chosen because *"S-17 will later generate these rows onto a set the owner may already have entered by hand"*; `:119` the lead's label outranks *"S-17's generator"*. No inbound FKs; write path is per-row and idempotent. | **WEAK** |
| 2. Lifecycle is undecided | One cron (`wrangler.jsonc:13`, `*/15`) with five per-owner steps. Onboarding writes zero day-off rows (`onboarding.ts:40-51` has six probes, none for days off). Nothing anywhere reasons about a calendar year. **The repo already litigated this exact class**: `sweep.ts:17-25` — *"A SWEEP, NOT A HOOK, deliberately… 'Every sprint without a current record: compute and write' delays the record instead of losing it."* Reads are unwindowed on purpose (`team-day-off-store.ts:93-97`), so writing ahead is already safe. | **STRONG** |
| 3. Consumers ignore the rows | Both readers call the **same** `getNonWorkingDays` (`load-snapshot.ts:106`, `capacity.ts:264`); the parameter is required, not optional (`helpers.ts:105`). All five rules thread it. `capacity.test.ts:195-280` proves a holiday removes a man-day, including the double-subtraction case. DayKey is conversion-free (`date` column → `'YYYY-MM-DD'` string) and the 08:00–16:00 window resolves in the same zone. | **NONE** |
| 4. The empty calendar is silent | `availability.tsx:247` gates the **only** days-off disclosure on `teamDaysOff > 0`, so zero renders nothing — byte-identical to "this sprint spans no holiday". `reliability-kpi-view.ts:32-35` structurally cannot mention days off at all. `WORKING_TIME_HINT` (`anomaly-rules-view.ts:269`) asserts the clock runs *"never on a company day off"*. `roster-editor.tsx:611` teaches the model during a wizard that never asks for one. | **STRONG** |

## Narrowing Signals

- **The owner's real case is additive, not subtractive.** National calendar
  correct; they add company and bridge days. This retires hypothesis 1 for their
  account: the generator appends, collides harmlessly, preserves their wording.
  The deletion case the roadmap worried about is not theirs.
- **One country, whole team.** Regional subdivision and multi-country are out.
- **"Once a year I review a proposal."** Decisive, and it *unifies* hypotheses 2
  and 4: an annual proposal the lead approves is simultaneously the generator's
  lifecycle and the diagnostic that names the missing input.
- **A blind cross-check independently ranked the silence first** (Step 5, an
  agent given only the situation and the measured fact, forbidden from reading
  this folder). Its words: *"the single highest-leverage thing this codebase is
  missing is not the holiday importer. It's the sentence it already knows how to
  write, four times over, and doesn't write here."*

## Cross-System Convention

This repo's house style for a defaulted input is: **name the missing input, name
what it silently defaulted to, and name the number it moves.** It is applied to
the two inputs sitting either side of this one:

- `CADENCE_PROVENANCE.workingDays` (`cadence-editor-view.ts:147-149`) — *"SprintFlow's
  own Mon–Fri default … drives your capacity in man-days and how fast tickets and
  PRs age."* This is the live precedent.
- `sync_attempt.outcome = cadence_default_fallback` (`run-sync.ts:990`), and
  `sendTimeHint` (`recap-settings-view.ts:100`) which names both the zone and the
  UTC fallback.

**One correction to that list, verified directly:** the `fteConfirmedAt` banner
(`roster-editor.tsx:555-583`) is *not* an ongoing diagnostic. `roster-store.ts:435`
stamps `fteConfirmedAt: now` on every member the wizard inserts — *"confirmed by
construction"* — so it fires only for accounts the `0012` migration touched. It is
a migration banner. Cite it as a shape to copy, never as proof the pattern is live.

`team_day_off` is the one input of this class with none of it.

## Reframed Problem Statement

> **The actual problem to plan around is**: SprintFlow treats the working-day
> calendar as an input the lead will supply unprompted — so on every real account
> it is empty, the product presents a capacity figure and five anomaly budgets
> computed as if no holiday exists, and says nothing; deriving the dates removes
> the typing but, on its own, changes none of that and goes stale every
> 1 January.

The initial framing was **not wrong, but incomplete in the way that matters**.
Deriving holidays from a country is the right feature and the model is already
built for it — S-23 saw to that deliberately. What the framing omitted is that
the harm is not the typing; it is that an unsupplied input is indistinguishable
from a verified-empty one, on a number the lead commits a sprint against. A
generator that runs once at onboarding would move that harm to the following
January rather than remove it, which is the shape `sweep.ts:17-25` was written to
reject and the shape S-30 was a whole slice about.

Addressed, the lead sees a proposed calendar they approve once a year, and — until
they do — a sentence saying the numbers currently assume nobody is ever off.

## Confidence

**HIGH** — strong file:line evidence on both surviving dimensions; a blind
cross-check converged on the same leading finding without being told it; the
reframe matches an established house convention and an explicitly recorded
precedent for the lifecycle half; and the owner's own answer on staying current
independently selects the shape the evidence points to.

## What Changes for /10x-plan

Plan the slice as **three things that must ship together**, not one: the
derivation (country field + a date source), the **recurrence** (a sweep, not an
onboarding hook — the year boundary is the failure mode), and the **disclosure**
(the sentence for an empty or stale calendar, in the house pattern). The
disclosure half is the part that is valuable even before a single holiday is
derived, and it is the cheapest of the three.

Two decisions the plan owes: whether the annual proposal is *presented for
approval* (which the owner asked for) or written and then reported, and whether a
provenance column is added now — the owner's additive case does not need it, but
the annual-proposal flow may, because "which of these did I already decide about"
is exactly what the table cannot answer.

## Out of Scope — findings to file elsewhere, not to fold in

Three real defects surfaced that are **not** S-17's and must not be smuggled into
it. Each deserves its own roadmap entry:

1. **Two clocks disagree on ticket age.** `time-in-status.ts` measures raw
   wall-clock milliseconds (verified: the file contains no reference to working
   days or non-working days at all), while `ticket-status-aging.ts:104` measures
   working hours. Sprint Detail's aging report and the Anomaly Inbox will rank the
   same tickets differently, and `aging-report-controls.ts:37-40` makes wall-clock
   the default sort while calling it *"the most-stalled ticket first"*. The
   days-off page promises a recorded day *"stops tickets ageing across it"*
   (`days-off/page.tsx:50`) — false for the surface titled Workflow health.
2. **The velocity estimate does not scale with sprint length.** Verified:
   `estimate.ts:113` normalises past sprints by `adjustedMd / fullMd` and `:82,89`
   scales by the same ratio for the current sprint, so the sprint's working-day
   count cancels — a holiday-shortened sprint gets the same SP suggestion as a
   full one. **This matches FR-024 as written** (the PRD's own worked example is
   about a person being away), so the requirement, not the code, is what would
   need revisiting. Flagging, not fixing.
3. **"The team's time zone" is one person's Jira profile** (`run-sync.ts:668` from
   `GET /myself`), and `WORKING_TIME_HINT` names neither the zone nor the UTC
   fallback that `safeZone` applies.

## References

- Roadmap: `context/foundation/roadmap.md` § S-17 (corrected 2026-08-31 on this branch)
- The table and its S-17 intent: `src/db/schema.ts:786-823`
- The store's collision policy: `src/lib/team-day-off-store.ts:24-31,93-97,115-155`
- The lifecycle precedent: `src/lib/measurement/sweep.ts:17-25`
- The cron surface: `wrangler.jsonc:13`, `src/lib/integrations/sync/scheduled.ts`
- The gated disclosure: `src/components/organisms/dashboard/availability.tsx:247`
- The promise it undercuts: `src/components/organisms/settings/anomaly-rules-view.ts:269`
- House pattern: `src/components/organisms/settings/cadence-editor-view.ts:147-149`
- Consumers: `src/lib/anomaly/load-snapshot.ts:106`, `src/lib/dashboard/capacity.ts:264`
