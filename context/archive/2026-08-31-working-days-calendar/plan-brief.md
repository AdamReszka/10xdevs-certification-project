# Working-days calendar (S-17) — Plan Brief

> Full plan: `context/changes/working-days-calendar/plan.md`
> Frame brief: `context/changes/working-days-calendar/frame.md`
> Plan review: `context/changes/working-days-calendar/reviews/plan-review.md`
> (8 findings, all fixed; verdict REVISE → SOUND)

## What & Why

SprintFlow treats the working-day calendar as an input the lead will supply
unprompted — so on every real account it is empty, the product presents a
capacity figure and five anomaly budgets computed as if no holiday exists, and
says nothing; deriving the dates removes the typing but, on its own, changes none
of that and goes stale every 1 January.

So this slice ships three things, not one: the **sentence** that names the
missing input, the **derivation** from a country, and the **annual re-offer**
that keeps it from decaying.

## Starting Point

S-23 already wired the seam and built `team_day_off` explicitly for this slice —
`schema.ts:794` says so in prose, and the store's `ON CONFLICT DO NOTHING`
(`team-day-off-store.ts:27`) was chosen for a generator that did not exist yet.
Both consumers are fed. What is missing is a jurisdiction (the account stores
none; `jira_project.time_zone` is a zone and dies with the credential), a
recurrence, and any disclosure at all: `availability.tsx:247` gates the only
days-off line on `teamDaysOff > 0`, so an empty calendar is byte-identical to a
holiday-free sprint. Measured 2026-08-31: **no real account holds a single
`team_day_off` row.**

## Desired End State

A lead with an empty calendar is told, next to the man-day number, that it
assumes nobody is ever off. They pick Poland once, review the proposed holidays
for every year the current sprint touches, uncheck what their team works, and
approve — the rows land beside anything they typed by hand, marked as derived,
and capacity and every aging budget move. Next January the same surfaces say the
new year is unreviewed, and the proposal comes back — never re-offering a day
they declined, and never saying anything at all to an account that reviewed the
year and deliberately kept nothing.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the harm actually is | Not the typing — the silence | An unsupplied input is indistinguishable from a verified-empty one, on a number the lead commits a sprint against | Frame |
| Date source | Bundled rules + Easter algorithm | Works for any year with zero dependencies and zero network, and every rule is pinnable to a test | Plan |
| Country scope | Poland only | 13+1 holidays can be tested honestly in one slice; an untested holiday rule is wrong by one day, silently, in man-days | Plan |
| Country field shape | ISO code, one-entry list | A second country becomes an append to a rule table rather than a migration and a UI rewrite | Plan |
| What an absent row means | `source` column **plus** a year-approval record | The column says where a row came from; only the year record says the year was already decided about — which is what keeps a deleted holiday deleted | Plan |
| Where the country lives | New per-owner singleton table | `jira_project` dies with the credential (the S-32 finding) and `recap_settings`' own header rejects a second geographic value | Plan |
| Recurrence mechanism | Year-keyed approval record, **no cron step** | The proposal is recomputable forever, so a cron cache would add an invalidation problem; the year record makes 1 January answer for itself on every render | Plan |
| Approval flow | Proposed for review, never written silently | The owner asked to review a proposal once a year; rows must not appear on their own | Frame |
| **Which years are proposed** | **Every year the ACTIVE SPRINT touches** | A single-year proposal is silent every December while the running sprint counts 1 and 6 January as working days — a failure guaranteed once a year, in the hardest sprint to plan | Review F3 |
| **Notice precedence** | **A stated table, with `isDemo` first** | Four branches can be true at once; leaving the order to the implementer either nags every hand-entry account forever or puts a "configure me" prompt into demo | Review F1 |
| **What silences the notice** | **The approval record, not the row count** | A lead who reviewed the year and kept nothing has verified the opposite of "nobody is ever off"; aiming that sentence at them is aiming it at the one person who checked | Review F2 |
| **`source` gets a reader in the same phase that adds it** | Shown in the existing days-off list | A column only ever written is not provenance, it is a migration with no consequence — and the manual row asserting it could not be executed | Review F4 |
| Disclosure surfaces | `/team/days-off` + dashboard Availability | The first is where the lead can act; the second is where the number it moves is on screen | Plan |
| Phase order | Disclosure first | It is the cheapest of the three and the only one valuable before a single holiday is derived | Frame |

## Scope

**In scope:** the notice on two surfaces; a per-owner country and year-approval
record; `team_day_off.source` and its display; a pure Polish holiday engine; the
proposal and approval flow with re-detection on write.

**Out of scope:** regional subdivision (Länder, cantons); any country but Poland;
a cron step; network or npm holiday data; a setup-wizard step; `WORKING_TIME_HINT`;
and the three defects the frame filed elsewhere (the wall-clock/working-hours
split in `time-in-status.ts`, FR-024's sprint-length cancellation, and the
unnamed time zone).

## Architecture / Approach

```
src/lib/holidays/
  easter.ts        Meeus/Jones/Butcher → DayKey, no Date, no zone
  poland.ts        14 rules as data; 12-24 carries fromYear: 2025
  index.ts         holidaysForYear(code, year) + SUPPORTED_COUNTRIES
  proposal.ts      pure diff over years[]: rules − existing rows,
                   nothing from a year already approved
  calendar-notice.ts   the precedence table → one sentence, or null
  calendar-store.ts    country + approvals, {db, ownerId}, owner-scoped

holiday_calendar          owner ⇄ ISO code (singleton)
holiday_year_approval     unique(owner, country, year) — the closing record
team_day_off.source       'manual' | 'derived', NOT NULL default 'manual',
                          rendered in the existing list beside costsNothing
```

**The notice is a precedence table, in this order** — four inputs can be true at
once, so the order is stated rather than discovered:

| # | Condition | Result |
| --- | --- | --- |
| 0 | `isDemo` | `null` — a demo visitor chose to skip configuration |
| 1 | country set, but no rules for it | `"country_unavailable"` |
| 2 | no country | `"no_country"` — outranks "rows exist" deliberately |
| 3 | a year in scope not approved | `"year_unapproved"` |
| 4 | otherwise | `null` |

Phase 1's `"empty"` member is the whole notice while Phases 2–4 are unbuilt, and
Phase 4 **retires** it: rows 2 and 3 catch every undecided account, so the only
state left for it would be a lead who reviewed the year and kept nothing.

**The years asked about are `[year(sprintStart), year(sprintEnd)]`,
deduplicated** — one year for eleven months, two for the sprint that crosses
31 December. It costs no new read: `capacity.ts:283-284` already holds both
dates and `/team/days-off` already loads the active sprint row.

Approval is one transaction: insert the kept rows and stamp **every** submitted
year, or neither — including a year in which the lead kept nothing, which must
still be stamped or it re-opens on the next render. Everything downstream is
unchanged — `getNonWorkingDays` already reaches all five elapsed-time rules and
the man-day divisor.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The sentence | Empty calendar says so, on both surfaces | Copy that nags an account which legitimately has no holidays this sprint — mitigated by `calendarIsEmpty` (whole account) vs `teamDaysOff` (this sprint), and pinned by an integration test through the REAL reader, not the injected set |
| 2. The records | Country, year approvals, row provenance **and its display** + migration | A migration that reaches code but not production — named route required, and it is row 0 of `MANUAL-CHECKLIST.md` |
| 3. Polish calendar | Pure engine, 14 rules, testable to the day | An off-by-one Easter or a missed `fromYear` is wrong silently, in man-days |
| 4. Proposal & approval | Pick, review, approve; the notice becomes the full precedence table | A regeneration resurrecting a deleted holiday — closed by the year record, and the manual row that proves it |

**Prerequisites:** S-08 and S-23, both done. No new dependencies, no new secrets,
no bundle-size concern (tripwire is 5000 KiB gzip).
**Estimated effort:** ~2–3 sessions across 4 phases; Phase 1 is roughly an hour
and ships alone.

## Open Risks & Assumptions

- **Poland-only makes the country picker a one-entry list.** Honest, but it looks
  odd until a second country lands; the copy has to carry that.
- **Nothing pushes.** A lead who opens neither the dashboard nor the tab is never
  told the new year is unreviewed. Accepted: the target persona opens Dashboard
  Today every morning, and the recap is out of scope.
- **A country switch leaves rows derived under the old country in place.**
  Deliberate — they are days the team was off — but unreachable while only Poland
  ships, so it goes untested in practice. The `source` display makes those rows
  at least visible to the lead rather than silently indistinguishable.
- **An account with no active sprint has no window**, so the proposal falls back
  to the single year `now` falls in. Correct, but it means the year-spanning
  behaviour cannot be exercised between sprints.
- ~~**12-24 as a Polish statutory holiday from 2025**~~ — checked at plan review
  and confirmed, along with the rest of the table: 10 fixed + 4 Easter-relative
  = 14, Easter 2026 falls on 5 April so Easter Monday is 2026-04-06 and Boże
  Ciało (+60) is 2026-06-04, and 2024 correctly yields 13.

## Success Criteria (Summary)

- A lead can no longer read a capacity figure computed against an empty calendar
  without being told that is what it is — and a lead who reviewed the calendar
  and kept nothing is not told anything.
- Poland's public holidays reach `team_day_off` without the lead typing a date,
  and the man-day number moves accordingly.
- A holiday the lead declined stays declined across every later render — the
  S-30 class of defect does not reappear here.
- A sprint crossing 31 December is proposed both of its years, so the one sprint
  a year that spans the boundary is not the one computed against a calendar
  nobody was asked about.
