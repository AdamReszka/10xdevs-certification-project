---
date: 2026-08-30T16:58:28+02:00
researcher: Adam Reszka
git_commit: 78f692d62792017223d45ef0afd53c1c01c53ad5
branch: feat/working-day-aging
repository: 10xdevs-certification-project
topic: "Making anomaly aging measure working days instead of wall-clock time (S-28)"
tags: [research, codebase, anomaly-rules, thresholds, working-days, demo-fixture, time-zones]
status: complete
last_updated: 2026-08-30
last_updated_by: Adam Reszka
---

# Research: Working-day-aware anomaly aging (S-28)

**Date**: 2026-08-30T16:58:28+02:00
**Researcher**: Adam Reszka
**Git Commit**: `78f692d62792017223d45ef0afd53c1c01c53ad5`
**Branch**: `feat/working-day-aging`
**Repository**: 10xdevs-certification-project

## Research Question

The owner reported that the anomaly engine counts Saturdays and Sundays as working
days when it ages tickets. `/10x-frame team-navigation-section` verified it and
split S-28 out. This research answers what it would take to fix: which rules
should change, what the threshold model costs, what a unit change does to stored
user settings, and what tests, fixtures and gates react.

## Summary

**The mechanism is already there and already trusted — it is simply not wired
into most callers.** `countWorkingDays` / `countWorkingDaysInclusive`
(`helpers.ts:96-118`) exist, are tested, and take the sprint's `workingDays`, the
team's time zone and `nonWorkingDays`. All three inputs ride on **every**
snapshot and are handed to **every** detector unconditionally
(`load-snapshot.ts:62-64,104`, `detect.ts:54-56`). Nothing new needs plumbing;
the work is inside the rule files.

Five findings shape the plan more than the rule edits do:

1. **No migration.** `anomaly_settings.thresholds` is `jsonb` with no shape
   constraint (`schema.ts:933`). A unit change is entirely application code.
2. **But a shape change silently resets every user's customised rule.**
   `mergeRule` validates the stored override on **read** with a `.strict()` zod
   schema and, on failure, discards the whole override — severity included —
   falling back to shipped defaults with only a `console.error`
   (`thresholds.ts:74-81`). The settings page then shows a "Modified" badge over
   default values and an immediate "Unsaved changes." on load. This is the
   largest risk in the slice and it has no user-visible signal today.
3. **The `"8_WORKING_DAYS"` sentinel is not a template to extend.** The day count
   `8` and the magnitude denominator `16` are literals inside the detector
   (`ticket-status-aging.ts:74-75`); the stored sentinel carries no number. That
   is why "10 working days" is inexpressible — in the type, the validator **and**
   the form at once, as S-14 recorded on purpose.
4. **The demo becomes load-day-dependent.** The demo anchor is real wall-clock
   time at load (`load.ts:71,91,130`), not a fixed historical instant, and every
   fixture timestamp is an hour-offset back from it (`fixture.ts:136-139`).
   Under working-day math, whether the demo still shows four distinct anomaly
   types — US-02's acceptance criterion — starts depending on which weekday the
   visitor pressed the button. `fixture.ts` has no test.
5. **Working-day math introduces a time-zone dependency where there is none
   today.** The hour-denominated rules do raw millisecond arithmetic and are
   zone-agnostic by construction. Day bucketing goes through
   `dayKeyInTimeZone` against `jira_project.time_zone`, which is nullable and
   degrades to UTC via `safeZone` (`time-zone.ts:33-47`). This repo has already
   recorded one zone bug (S-08 impl-review F2) and one zone miscorrection (S-25).

**Nothing was ever decided in favour of wall-clock aging.** S-06's plan,
plan-review and impl-review never discuss weekends at all; the only recorded
working-day discussion is S-14's deliberate freezing of the 21-SP sentinel. The
uneven state is slice ordering, exactly as the tester guessed in
`context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`.

## Detailed Findings

### 1. What each rule measures today

| Rule / sub-condition | FROM | Helper | Default threshold | Aware? |
| --- | --- | --- | --- | --- |
| `PR_REVIEW_STALLED` | `pr.readyForReviewAt` | `hoursBetween` (`pr-review-stalled.ts:31`) | 24 h | wall-clock |
| `TICKET_STATUS_AGING` — Code Review / Testing | `ticket.lastStatusChangeAt` | `hoursBetween` (`:83`) | 24 h / 48 h | wall-clock |
| `TICKET_STATUS_AGING` — In Progress 1–13 SP | `ticket.lastStatusChangeAt` | `hoursBetween` (`:77`) | 24/24/48/72/120/120 h | wall-clock |
| `TICKET_STATUS_AGING` — In Progress 21 SP | `ticket.lastStatusChangeAt` | `countWorkingDays` (`:67`) | 8 working days | **aware** |
| `DEVELOPER_INACTIVE` | `now − N × MS_PER_DAY` | raw ms (`developer-inactive.ts:31`) | 2 days | wall-clock |
| `TICKET_NO_COMMIT_LINK` | `ticket.lastStatusChangeAt` | `daysBetween` (`:28,36`) | 2 days | wall-clock |
| `SPRINT_AT_RISK` — ToDo near end | `now` → `sprint.endDate` | `hoursBetween` (`:88`) | 48 h | wall-clock |
| `SPRINT_AT_RISK` — absence cost | absence dates | `countWorkingDaysInclusive` (`:142,164`) | — | **aware** |
| `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC` | — | no elapsed-time input | — | n/a |

Three rules are out of scope entirely: they make no time measurement.

The sharpest internal inconsistency is inside **one function**:
`ticket-status-aging.ts` measures the same field, against the same conceptual
budget, in working days for the 21-SP bucket and in wall-clock hours for every
other bucket and both other categories.

`SPRINT_AT_RISK` is the arguable one. Its ToDo-near-end condition counts down to
an **instant** (the sprint's end), and a deadline does not move because a weekend
intervenes — so wall-clock is defensible there. But it sits three lines above a
sibling condition in the same detector that is working-day-aware, so whichever
way it goes, the file should stop answering two different questions silently.

### 2. Everything needed is already plumbed

`SprintSnapshot` (`types.ts:40-68`) carries `timeZone: string | null` and
`nonWorkingDays: ReadonlySet<DayKey>` at the top level, populated once in
`load-snapshot.ts:62-64,104`; `snapshot.sprint` is the whole row, so
`workingDays` travels with it. `detect.ts:54-56` passes the snapshot to every
detector. **No new snapshot field, no `load-snapshot.ts` change.**

### 3. What "working-day aware" can mean — and what exists

- **(a) Skip whole non-working days, keep hour granularity.** A PR ready Friday
  17:00 with a 24 h budget trips Monday 17:00. This is what a lead intuitively
  means — and it is **not** what `countWorkingDays` does. Those helpers return an
  integer count of qualifying calendar days (`helpers.ts:96-179`). Option (a)
  needs new code: a day-segment walk that zeroes non-working segments and sums
  the remaining hours, built on the same `enumerateDayKeys` machinery so the
  zone handling stays correct.
- **(b) Count only working hours within a day (9–17).** The codebase has **no
  notion of working hours** anywhere; cadence is day-of-week granularity only
  (`sprint.workingDays` as `["MON",…]`), and Jira exposes no such field
  (PRD FR-007's own Socratic note). This needs a new config surface, schema and
  settings UI before any rule math could use it. Out of proportion to the slice.
- **(c) Convert the budgets to working days outright** ("24 h" → "1 working
  day"). The only option the existing helpers support with zero new primitives,
  and it mirrors the two places already proven in the codebase. The cost is
  intra-day precision: a PR ready at 08:59 and one ready at 16:59 would age out
  at the same boundary.

`countWorkingDays` is **half-open** — it drops the day of `from`
(`helpers.ts:104-106,174`, "Mon→Fri is 4"), which is the right semantics for
"elapsed since a movement". `countWorkingDaysInclusive` is closed ("Mon→Fri is
5") and belongs to absence cost. Reusing the wrong one is an off-by-one that
looks like a threshold-tuning problem.

### 4. The threshold model, and the silent-reset trap

Resolution: `DEFAULT_THRESHOLDS` (`defaults.ts:47-90`) is never seeded; a row in
`anomaly_settings` exists **iff** the rule differs from defaults
(`anomaly-settings.ts:98-123`, `schema.ts:934-938`). `resolveEffectiveThresholds`
(`thresholds.ts:89-109`) and the settings page (`anomaly-settings.ts:57-85`) both
merge through the same `mergeRule`.

`mergeRule` (`thresholds.ts:57-87`):

- validates the stored body against a per-rule **`.strict()`** zod schema on
  **every read** — deliberately, because "a validated write is not a validated
  column" (`thresholds.ts:35-37`);
- on failure discards the whole override, **severity included**, and returns
  shipped defaults with a `console.error` (`:75-81`);
- on success spreads **one level deep** (`:83-86`) — so `inProgressHoursBySp` and
  `maxParallelByCategory` are replaced wholesale, never deep-merged.

Consequences of changing a threshold's shape, for any account that ever
customised that rule:

1. the customisation silently stops applying — detection runs on defaults;
2. the settings card still shows **"Modified"** (`isOverridden` means "a row
   exists", `anomaly-settings.ts:75-84`) over default values;
3. **"Unsaved changes."** appears on page load with no user edit, because the
   client recomputes `isModified` from form values (`anomaly-rules-editor.tsx:117-122,240-244`);
4. it self-heals only if the user re-saves or resets.

A plan must choose deliberately between: versioning the schemas, accepting both
shapes for a release, writing a one-off backfill, or accepting the reset and
telling the user. **No such backfill file exists in the repo today.**

### 5. The sentinel is not a template

`IN_PROGRESS_HOURS_BY_SP` is `Record<number, number | "8_WORKING_DAYS">`
(`defaults.ts:37-45`). The detector branches on the **value**, never the key
(`ticket-status-aging.ts:60-80`), and the numbers `8` and `16` are literals in
that branch. The validator accepts the sentinel on **any** SP bucket
(`validations/anomaly-settings.ts:63-93`); the form exposes it on exactly one, as
a hardcoded two-item `SP21_CHOICES` (`anomaly-rules-view.ts:223-226`). The five
other hour thresholds have no sentinel machinery at all.

`RULE_DESCRIPTORS` (`anomaly-rules-view.ts:108-213`) is hand-written per rule and
per field, each carrying a literal `unit` string rendered verbatim next to the
input (`anomaly-rules-editor.tsx:364-366`). A pure relabel is mechanical; a
dual-unit control anywhere else is bespoke new code copied from
`StoryPointBudgets` (`anomaly-rules-editor.tsx:260-336`) — there is no shared
unit-toggle component.

### 6. Time zone: a new dependency

`snapshot.timeZone` comes from `jira_project.time_zone` (`time-zone-reader.ts:14-24`),
is nullable, and degrades to `"UTC"` through `safeZone` (`time-zone.ts:33-47`)
without throwing. `dayKeyInTimeZone` (`day-bucket.ts:48-50`) decides which
calendar day an instant belongs to; `weekdayOf` (`helpers.ts:181-190`) then
resolves a day key's weekday **zone-free on purpose** — the zone has already done
its job upstream.

The hour-denominated rules are zone-agnostic today because raw millisecond
subtraction has no notion of a day. Making them day-aware makes their output
depend on a nullable column. Any new hour-granular code (option (a)) must resolve
segment boundaries through `enumerateDayKeys` / `dayRangeInTimeZone` rather than
naive UTC-midnight slicing — the exact bug `helpers.ts:69-76` records as already
having been made once.

### 7. The demo fixture — the biggest single risk

**Correction to an assumption carried in from S-14's plan:** the demo is not
anchored to a fixed historical instant. `buildDemoFixture(anchor, ownerId)`
(`fixture.ts:135`) is anchor-relative, and the anchor is the real wall-clock
moment of loading, stored as `user.demo_anchor_at` (`load.ts:71,91,130`). What is
frozen is the anchor after load, not which weekday it lands on.

The fixture already fears this in one place: `SPRINT_HOURS_LEFT = 47` is chosen
so "at least one WORKING day always remains, whichever weekday the demo happens
to be loaded on" (`fixture.ts:55-63`), and `workingDayKeyOnOrBefore`
(`fixture.ts:114-133`) keeps the team-day-off row off a weekend.

The anomaly-producing offsets have no such guard: `WEB-88` `h(96)`
(`fixture.ts:241`), `WEB-90` `h(60)` (`:246`), `WEB-91` `h(72)` (`:251`),
`WEB-93` `h(130)` (`:257`), PR `#142` `ready: h(31)` (`:398`), PR `#152`
`h(30)`/reviewed `h(26)` (`:405,448`). Under working-day math a Monday load
removes the whole weekend from those gaps, and one or more can drop below
threshold. **US-02's acceptance criterion is "at least four of the eight rule
types visible"**, and nothing tests it: `fixture.ts` has no test file.

### 8. Tests and gates that react

**MUST — break loudly:**

- `rules/ticket-status-aging.test.ts` — 5 tests seeded on Fri/Sat dates
  (`:15-42`, `:83-94`, `:96-107`, `:109-132`, `:134-156`), with wall-clock
  magnitude literals.
- `rules/pr-review-stalled.test.ts` — 4 tests seeded Sat/Sun (`:16-43`, `:74-81`,
  `:83-93`, `:95-106`).
- `rules/ticket-no-commit-link.test.ts:13-40` — Friday seed, literal
  `daysInProgress: 3` and `magnitude 3/4`.
- `detect.integration.test.ts` — `SF-1` Friday (`:127`) and PR `#42` Saturday
  (`:178`); `:263` asserts `toContain("PR_REVIEW_STALLED")` and `:277-284` does
  `.find(...)!` + `toBeDefined()`, including the reactivation path (`:308-319`).
- `src/lib/demo/fixture.ts` — per §7.
- `stryker.conf.json` (`break: 70`) mutates `src/lib/anomaly/rules/**/*.ts`,
  which **includes `helpers.ts`**. New branches need new killing tests. It is not
  wired into `.github/workflows/ci.yml`, so it is a local gate only.

**SHOULD — pass for the wrong reason, or mislead:**

- `ticket-no-commit-link.test.ts:42-58` — today it returns `[]` because a linked
  commit suppresses the rule; under a working-day gate it would return `[]`
  because the ticket is too fresh, exiting at `:37` before the commit is
  examined. The assertion stays green while the test stops covering its branch.
- `ticket-status-aging.test.ts:44-55` and the "within" halves of `:109-132`,
  `:134-156`; `developer-inactive.test.ts:42-50` (its window-boundary claim goes
  stale).
- Copy: `suggested-action.ts:12,18,21,27` (reused verbatim by the Daily Recap),
  rule descriptions at `pr-review-stalled.ts:42`, `developer-inactive.ts:64`,
  `ticket-no-commit-link.ts:51`, `sprint-at-risk.ts:100`, and the chips in
  `context.ts:183-245` (`${ageHours}h open`, `${noCommitDays}d no commits`, …).
  Nothing pins the chip text, so it will not fail — it will just lie.

**Unaffected:** `reader.integration.test.ts` (inserts anomaly rows directly, never
runs a detector); `e2e/dashboard-sprint-detail.spec.ts` (its unseeded block only
asserts the tab exists; its seeded block exercises the FR-017 aging **report**,
which lists open tickets by staleness and is not gated by the anomaly
threshold); `e2e/demo-boundary.spec.ts` and `e2e/seed.spec.ts` (no anomaly
references).

### 9. Manual rows this invalidates

From `context/foundation/manual-test-backlog.md`, all currently open: **10.3**
(pins the default values verbatim), **10.4** (shallow-merge of the SP map),
**10.5** (the 21-SP sentinel round-trip), **10.D** (numeric domain rejection),
**11.5** (a day off stops a 21-SP ticket's aging clock — and notes that a 3-SP
ticket deliberately does not react, which this slice would change), **20.A**
(`SPRINT_AT_RISK` absence arithmetic), and the meta-row **10.7** (a threshold
change silently invalidates the still-open S-07 inbox rows).

## Code References

- `src/lib/anomaly/rules/helpers.ts:23-29` — `hoursBetween`, `daysBetween`
- `src/lib/anomaly/rules/helpers.ts:96-118` — `countWorkingDays` (half-open) and
  `countWorkingDaysInclusive` (closed)
- `src/lib/anomaly/rules/helpers.ts:181-190` — `weekdayOf`, zone-free by design
- `src/lib/anomaly/rules/ticket-status-aging.ts:62-85` — the principle, and the
  one branch that follows it
- `src/lib/anomaly/load-snapshot.ts:62-64,104` / `src/lib/anomaly/detect.ts:54-56`
  — the inputs every detector already receives
- `src/lib/anomaly/thresholds.ts:57-109` — `mergeRule`, read-time validation,
  wholesale discard
- `src/db/defaults.ts:37-90` — the default thresholds and the sentinel
- `src/lib/validations/anomaly-settings.ts:63-93` — the sentinel's union schema
- `src/components/organisms/settings/anomaly-rules-view.ts:108-226` —
  `RULE_DESCRIPTORS`, `SP21_CHOICES`
- `src/lib/demo/fixture.ts:55-63,114-139,241-257,398-448` — anchor, guards,
  anomaly-producing offsets
- `src/lib/dashboard/day-bucket.ts:48-50,148-173` — `dayKeyInTimeZone`,
  `enumerateDayKeys`
- `stryker.conf.json:9-16` — mutate globs and `break: 70`

## Architecture Insights

- **The seam-first pattern.** S-08 declared `nonWorkingDays` as an empty
  parameter with five named call sites; S-23 filled all five in one phase,
  arguing that half-wiring produces "two counters that disagree". S-28 is the
  same argument applied to the callers that never had the parameter.
- **Validation lives at the read boundary, not the write boundary.** Because the
  jsonb column outlives any one slice, the zod layer runs on every read — which
  makes shape changes a data-compatibility question even without a migration.
  This is the inverse of the usual instinct and is the trap in this slice.
- **Zone handling is layered deliberately**: instants → day keys is zone-aware;
  day key → weekday is zone-free. New code must enter at the same layer.

## Historical Context (from prior changes)

- `context/archive/2026-08-20-anomaly-detection-engine/plan.md:296-298` — S-06
  specifies only the sentinel's resolution; weekends, working days and wall-clock
  are absent from its plan, plan-review and impl-review. **Wall-clock aging was
  never chosen — it was the default nobody discussed.**
- `context/archive/2026-08-27-capacity-in-man-days/plan.md:35-37,176-179` — the
  five call sites and the "must be wired in one phase" argument.
- `context/archive/2026-08-29-anomaly-settings-page/plan.md:105-108` — turning
  the sentinel into data is explicitly out of scope, "recorded here so it is not
  rediscovered mid-implementation". S-28 is where it gets rediscovered.
- `context/manual-tests/S-11-obserwacja-recap-dni-wolne.md` — the tester found
  the same 3-of-9 split from the recap side and guessed the cause correctly:
  "probably not a decision, just slice ordering". Never verified against a real
  send; the recap's own two defects (sends on weekends; "yesterday" is a calendar
  day) are adjacent and NOT in this slice.
- `context/archive/2026-08-25-absence-calendar/reviews/impl-review.md:61-73` — a
  recorded zone bug: offset arithmetic correct only on a UTC host, and a
  verification query that used `AT TIME ZONE` in a way that could not catch it.
- `context/changes/team-navigation-section/frame.md` — the frame that produced
  this slice.

## Related Research

- `context/archive/2026-08-29-anomaly-settings-page/research.md:150-154,620-631`
  — the sentinel-as-data question, asked and parked.
- `context/archive/2026-08-27-capacity-in-man-days/frame.md:19-21,54` — the
  day-key convention.

## Open Questions

These are decisions for `/10x-plan`, not gaps in the research:

1. **Which semantics — (a) hour-granular with non-working days skipped, or (c)
   budgets converted to working days?** (a) matches the lead's intuition and
   preserves intra-day precision but needs a new primitive; (c) reuses proven
   helpers and no new primitive but coarsens every threshold. This is the
   decision the whole slice hangs on.
2. **Which rules?** `TICKET_STATUS_AGING` (all buckets) and
   `TICKET_NO_COMMIT_LINK` are unarguable. `DEVELOPER_INACTIVE` is unarguable on
   substance but needs its absence-suppression window moved in lockstep with its
   trigger window, or the two boundaries disagree. `PR_REVIEW_STALLED` is
   arguable. `SPRINT_AT_RISK`'s ToDo-near-end counts down to an instant and may
   be correct as it stands.
3. **What happens to already-customised rules?** Version the schemas, accept both
   shapes, backfill, or accept the silent reset and warn. Doing nothing means
   choosing the silent reset by accident.
4. **How is the demo kept honest?** US-02 needs four visible anomaly types on any
   load day. Options include a weekday-aware anchor, offsets expressed in working
   days, or a test that loads the fixture across all seven anchors and asserts the
   floor. The last one is worth having regardless of the others.
5. **Does FR-009 get amended?** It fixes "1/2 SP=24h … 21 SP=8 working days" and
   says nothing about weekends. Changing the unit without amending the PRD leaves
   the requirement describing a product that no longer exists.
6. **Is the recap's own weekend behaviour in or out?** The S-11 observation
   covers a scheduler defect and a "yesterday" window defect that this slice does
   not touch. Recommend explicitly out, and say so, so the tester's note is not
   half-closed.
