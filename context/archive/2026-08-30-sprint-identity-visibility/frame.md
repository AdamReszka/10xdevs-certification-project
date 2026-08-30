# Frame Brief: Sprint identity visibility (S-25)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

A tester, part-way through the setup wizard after switching the monitored Jira
project from `FM` to `PT`, could not answer "which sprint is this?". In her own
words (`context/manual-tests/S-16-4.6-tozsamosc-sprintu-niewidoczna.md`):

> „dla mnie brak dobrze widocznej nazwy aktualnego sprintu. nazwa sprintu
> występuje tylko na dole strony w Sprint cadence"

> „na dashboardzie nie ma nazwy, nazwa jest dopiero w zakładce Sprint Detail ale
> jest mało widoczna, nie rzuca się w ogóle w oczy"

Separately, on the same screen:

> „czy w tym widoku powinna być data rozpoczęcia sprintu?"

Recorded as a product observation, not a defect — row 4.6 itself passed.

## Initial Framing (preserved)

- **User's stated cause or approach**: the sprint's name is rendered too weakly —
  woven into a `CardDescription` sentence on the cadence step, buried inside a
  panel description on Today, and shown as a deliberately muted
  `<Badge variant="secondary">` on Sprint Detail.
- **User's proposed direction**: *"Jedna linijka `PT Sprint 1 · 30.08 – 12.09`
  zamknęłaby obie uwagi naraz"* — on the three named surfaces.
- **Pre-dispatch narrowing**: asked which of three observation states applied on
  Today, the owner answered *"znalazła ale nazwa jest w badgu mało czytelna,
  powinna być bardziej wyeksponowana"*. That describes **Sprint Detail** — Today
  has no badge at all (see Narrowing Signals). On content, the owner picked
  **name + date range** over "name + day N of M" and over "name alone". On scope,
  the owner delegated the decision to the evidence.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Visual hierarchy** — the claim is on screen but subordinate.
   `cadence-form.tsx:180-181`, `sprint-detail/page.tsx:308`. ← initial framing
2. **The claim never reaches the surface** — Today passes `sprintName` to exactly
   one consumer, in a non-default tab. `dashboard/page.tsx:227`.
3. **Content of the identity: a name is not checkable** — `sprint.start_date` /
   `end_date` exist and are rendered nowhere as identity. `schema.ts:416-418`.
4. **The fallback asserts what it has not verified** — `?? "the active sprint"`,
   `?? "your sprint"`. `velocity-estimate.tsx:42`, `recap/render.ts:58`.
5. **Surface coverage wider than the three named** — the Daily Recap email and
   Settings → Absences also render sprint-scoped data.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Visual hierarchy** — the name is present everywhere, just styled down | True on Sprint Detail ONLY: `sprint-detail/page.tsx:308` renders `<Badge variant="secondary">{sprintName}</Badge>`, with a sibling `stateLabel` badge for non-active sprints and a `SprintSwitcher` (S-23 Phase 7). On the cadence step the name is inside prose, not a styled element (`cadence-form.tsx:180-181`). On Today there is no element to restyle. | **PARTIAL** — covers one of three surfaces |
| **2. The claim never reaches Today** | `dashboard/page.tsx:227` passes `sprintName={sprint?.name ?? null}` to `VelocityEstimatePanel` and to nothing else. The `<h1>` is the constant string `Dashboard — Today` (`page.tsx:186`); `SyncStatusBar`, `AnomalyInbox`, `SprintPulse`, `YesterdayActivity`, `ReliabilityKpi` receive no sprint identity. The inbox is the DEFAULT tab (FR-016), so on arrival the name is not on screen at all. | **STRONG** |
| **3. A name alone is not checkable** | `grep` over `src/**/*.tsx` finds **zero** renders of `sprint.startDate` / `endDate` as identity. The only reads are `sprint-detail/page.tsx:120` (a range bound for the aging window) and `settings/absences/page.tsx:51-53` (a day-key default). The columns are populated from Jira — on the tester's account `2026-08-29 22:46 → 2026-09-12 22:46`. | **STRONG** |
| **4. The fallback fabricates identity** | `velocity-estimate.tsx:42` `sprintName ?? "the active sprint"`, fed by `sprint?.name ?? null` — so when the owner has **no sprint row at all**, the panel reads *"…scaled to what the active sprint actually has"*, asserting an active sprint that does not exist. `recap/render.ts:58` does the same with `?? "your sprint"`. Same shape as `lessons.md` — *"A narrowing predicate turns 'wrong value' into 'empty result', which reads as success"*: an unknown rendered as a reassuring generality. | **STRONG** |
| **5a. Daily Recap email** (listed "not checked" in the tester's note) | Name appears in the SUBJECT only, and only on the ≥ 1-anomaly branch — `render.ts:59-61`; the `count === 0` subject drops it entirely. Neither body names it: `renderHtml` (`render.ts:145-160`) and `renderText` (`render.ts:210-250`) print only *"Sprint day N of M"*. `RecapSprint` (`types.ts:65-72`) carries `name` but no dates. | **STRONG** |
| **5b. Settings → Absences** | `absences/page.tsx:51-53` derives the "planned" checkbox default from the active sprint's first day and never names that sprint. Real, but see Scope below — S-20 owns what sprint an absence belongs to. | **WEAK (defer)** |

## Narrowing Signals

- **The owner's answer described Sprint Detail while the question asked about
  Today.** That is itself the finding: the two surfaces are in different states,
  so a single instruction ("make it more prominent") is executable on one and
  meaningless on the other. Today has nothing to promote — it needs the claim
  introduced; Sprint Detail has the claim and needs it promoted; the cadence step
  has it as prose and needs it lifted out of the sentence.
- **The owner chose "name + date range" over "name + day N of M".** That rules the
  slice's content question closed and makes dimension 3 load-bearing rather than
  a nice-to-have: dates are what make the name comparable to Jira.
- **The worst case is the first run** — with fewer than two closed sprints the
  velocity panel renders `emptyCopy(...)`, and two of its three branches
  (`velocity-estimate.tsx:87`, `:91`) never interpolate `sprintLabel`. On a
  freshly configured account, the name can fail to appear on Today even once.

## Cross-System Convention

This codebase already has the pattern for "a bar that says something about the
data on this page, on every dashboard": `SyncStatusBar`
(`components/organisms/dashboard/sync-status-bar.tsx`), rendered by BOTH
`dashboard/page.tsx:194` and `sprint-detail/page.tsx:329`, answering *how fresh
is this?* per integration. *Which sprint is this about?* is the same class of
question about the same data, and the component even carries the date-rendering
convention the backlog §5 trap requires — `formatSyncedAt:33-36` emits
`YYYY-MM-DD HH:mm UTC` deterministically so server render and hydration agree.
The leading hypothesis matches the convention: identity belongs beside freshness,
not inside a panel's prose.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: no surface states the sprint's
> identity as a *checkable fact* — a name together with the dates that let the
> lead compare it against Jira — and where an identity claim is made at all, it is
> either buried in prose, styled as an aside, or fabricated by a fallback when the
> sprint is unknown.

The initial framing (prominence) is correct for exactly one of the three surfaces.
Planning "restyle the name" would leave Today with nothing to restyle, would leave
the name unverifiable everywhere it does appear, and would leave the copy claiming
"the active sprint" on an account that has none. The reframe matters because the
failure this traces back to — S-16's `jira_sprint_id=1001` surviving a real Jira
connection, sync green, dashboard empty — is only recognisable if the identity on
screen can be checked against something the lead independently knows. That is the
date range, not the font size.

## Scope (owner delegated to the evidence)

- **IN — the three surfaces from the roadmap**: cadence step, Today, Sprint
  Detail. Each needs a different move (introduce / lift out of prose / promote),
  which the plan must state per surface rather than as one instruction.
- **IN — the fallback copy** wherever identity is unknown: say so, do not
  substitute a confident generality.
- **IN, but as a separable final phase — the Daily Recap email**: the name is
  missing from both bodies and from the zero-anomaly subject, dates are absent
  from `RecapSprint`. It is cheap and hermetically testable (`render.test.ts`
  exists), but sending is blocked pending Resend, so it cannot be manually
  verified — keep it last so it can be dropped without disturbing the rest.
- **OUT — Settings → Absences**: naming the sprint there states which sprint an
  absence belongs to, and that meaning is exactly what **S-20**
  (`absence-sprint-scoping`) exists to settle. Deciding it here would decide it
  twice. Deferred with reason, not dropped.

## Confidence

**HIGH** — every dimension is backed by a direct `file:line` read in this repo,
the owner's answer settled the content question (name + date range), the
divergence between the answer and the code is itself corroborating rather than
contradicting, and the leading hypothesis matches an existing in-repo convention
(`SyncStatusBar`).

## What Changes for /10x-plan

Plan **one identity fact rendered on three surfaces in three different states of
absence**, not one restyle. The unit is "name + date range, in UTC, following
`formatSyncedAt`'s deterministic formatting", plus an honest rendering for the
unknown case that replaces `?? "the active sprint"` / `?? "your sprint"`. No
migration is needed — `sprint.start_date` / `end_date` are already populated.

## Grounding for /10x-plan (facts checked, no design implied)

Four gaps were checked directly rather than by running `/10x-research`, because
the surface was already located and each was a single read:

- **The test harness for this is an extracted pure sibling.** Every non-trivial
  organism on this dashboard already has one — `activity-matrix-view.ts`,
  `aging-report-controls.ts`, `availability-view.ts`,
  `capacity-adjustments-view.ts`, `reliability-kpi-view.ts`, each with a
  `.test.ts`. The two files this slice touches are precisely the two with **no**
  sibling and therefore no unit coverage of their formatting:
  `velocity-estimate.tsx` and `sync-status-bar.tsx`.
- **The E2E suite pins both `<h1>` strings by exact accessible name.**
  `e2e/dashboard-sprint-detail.spec.ts:82` (`"Dashboard — Today"`) and `:161`
  (`"Dashboard — Sprint Detail"`) use `getByRole("heading", { name })`, which
  matches the full accessible name. Interpolating the sprint into either heading
  breaks them; putting identity in a sibling element beside the heading — which is
  what Sprint Detail already does with its badge — does not.
- **An open formatting decision the plan must settle explicitly.** Two in-repo
  conventions disagree for this data. `sync-status-bar.tsx:33-36` renders UTC
  (`YYYY-MM-DD HH:mm UTC`) for hydration determinism, and backlog §5 records that
  the UI renders these columns as UTC deliberately; but `settings/absences/
  page.tsx:51-53` renders sprint-derived days through `dayKeyInTimeZone` using the
  team's `jira_project.time_zone` (`src/lib/time-zone.ts`). Both are defensible;
  the point is that one must be chosen and stated, not inherited by accident.
- **Demo mode renders this fine.** `demo/fixture.ts:754-757` gives the demo active
  sprint `name: "Sprint 24"` with populated `startDate` / `endDate`, so the new
  identity line has real values under DEMO with no fixture change.

## References

- Source files: `src/app/(app)/dashboard/page.tsx:186,194,227`,
  `src/app/(app)/dashboard/sprint-detail/page.tsx:120,283-311,329`,
  `src/components/organisms/setup/cadence-form.tsx:180-181`,
  `src/components/organisms/dashboard/velocity-estimate.tsx:42,50,79-95`,
  `src/components/organisms/dashboard/sync-status-bar.tsx:33-36`,
  `src/lib/recap/render.ts:58-61,78-79,145-160,210-250`,
  `src/lib/recap/types.ts:65-72`, `src/db/schema.ts:403-419`,
  `src/lib/sprint.ts:19-43`, `src/app/(app)/settings/absences/page.tsx:51-53`
- Tester's note: `context/manual-tests/S-16-4.6-tozsamosc-sprintu-niewidoczna.md`
- Roadmap entry: `context/foundation/roadmap.md` § S-25
- Related prior lesson: `context/foundation/lessons.md` — *"A narrowing predicate
  turns 'wrong value' into 'empty result', which reads as success"*
- Investigation: performed inline (no sub-agents — small, pre-located surface;
  the owner's standing instruction is to confirm before multi-agent steps)
