# Frame Brief: S-07 Dashboard "Today" — what actually proves the north star

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

S-07 (`dashboard-today`) is the **north-star slice** (US-01): open Dashboard
"Today" with the Anomaly Inbox as the default view (each anomaly showing the 5
FR-014 attributes, default order severity→recency, re-sort by
severity/age/ticket/developer, filter by anomaly-type/team-member); Sprint Pulse
(burndown, scope changes, per-status distribution), Yesterday's Activity
(commits/PRs/reviews/tickets-to-Done), and the Reliability KPI chart (committed
vs delivered SP) sit one click away behind tabs; per-integration last-sync
freshness timestamp always visible; error banner naming the failed integration
(show last cached state, never blank). PRD refs FR-015, FR-016, US-01.

## Initial Framing (preserved)

- **User's stated cause or approach**: `change.md` frames S-07 as primarily UI
  assembly over already-built data surfaces — "Data surfaces already built:
  `listAnomaliesForSprint` (S-06), `sync_state` (S-05), synced
  tickets/PRs/commits/reviews + sprint (S-05), team roster (S-04)."
- **User's proposed direction**: build the whole surface — inbox + all three
  panels + freshness + error banner + sort/filter — in one slice.
- **Pre-dispatch narrowing**: user selected (Q1) **"Anomaly Inbox +
  freshness/banner alone proves US-01"**; (Q2) **"I know the three panels are
  new aggregation logic"**, not render of existing readers; (Q3) **"a real
  smoke-test with a real GitHub repo + Jira project is required"** before the
  slice is done. The user's own answers separated *what proves the hypothesis*
  from *what completes the dashboard* before investigation began.

## Dimension Map

The "what to build for S-07" scope could originate at any of these dimensions:

1. **Anomaly Inbox render + client interactivity** — assumes near-render over a
   ready reader; sort/filter are client-side over the returned view.  ← initial framing lands here for the whole slice
2. **Freshness timestamp + error banner** — assumes the per-integration
   sync-state fields exist and just need surfacing.
3. **Active-sprint resolution** — the inbox reader needs a `sprintId`; how does
   the dashboard know which sprint is current?
4. **Three panels' aggregation readers** — burndown series, per-dev/per-day
   activity rollups, committed-vs-delivered KPI: do these read surfaces exist,
   or are they new subsystems?
5. **Live data / detection for the smoke-test** — is there a real synced sprint
   with detected anomalies to render, so the north star actually demonstrates?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Dim 1 — Inbox is render-ready | `src/lib/anomaly/reader.ts:34` `listAnomaliesForSprint` returns `AnomalyView` with all 5 FR-014 attributes + `riskScore` + `detectedAt` + `relatedTeamMemberId`, pre-ordered severity→recency. Sort/filter need no new data. Organism dirs `components/organisms/{dashboard,anomaly}` are EMPTY; `dashboard/page.tsx` is a stub. | STRONG (data ready; UI unbuilt) |
| Dim 2 — Freshness + banner ready | `src/db/schema.ts:349` `syncState` has `lastSuccessfulSyncAt`, `lastAttemptAt`, `status`, `lastError`, per `(owner, integration)` unique. Surfacing only. | STRONG (data ready) |
| Dim 3 — Active-sprint resolver | Logic EXISTS but is **duplicated inline**, not a shared reader: `run-sync.ts:406-419` ("prefer ACTIVE, else most-recently-started") and `load-snapshot.ts` (`chosen.id`). No `getActiveSprint(ownerId)`. Dashboard needs the same resolution → small new/extracted reader. | STRONG (small new code, not render) |
| Dim 4 — Panel aggregations are new | Only `anomaly/reader.ts` is a DB reader; `github.ts`/`jira.ts` are API clients. **No** burndown reader (sprint row holds only `committedSp`/`completedSp` snapshots — no daily series; a burndown line must be derived from `jiraStatusHistory` transitions × SP). **No** per-dev/per-day activity reader (raw `githubCommit`/`PullRequest`/`Review` + `jiraTicket` exist; rollup does not). Reliability KPI (`committedSp` vs `completedSp`) is ~render-ready. | STRONG (2 of 3 panels are genuinely new subsystems) |
| Dim 5 — Data for smoke-test | Detection writes `anomaly` keyed to `sprintId` (`detect.ts:52,97`); inbox is empty unless sync+detect ran on a real connected team. Roadmap S-07 Risk mandates the smoke-test. Sync resolves the active sprint or SKIPs `no_sprint` (`run-sync.ts:94`). | STRONG (validation dimension, separate from UI build) |

## Narrowing Signals

- User (Q1) states the **inbox + freshness/banner alone prove US-01** — the
  three panels are context, not the hypothesis test.
- User (Q2) already knows the **panels are new aggregation**, contradicting
  `change.md`'s "data surfaces already built" for those panels.
- Code confirms **only the inbox + freshness/banner + (small) active-sprint
  resolver are render-ready**; burndown and Yesterday's-Activity are new readers.

## Cross-System Convention

The roadmap already assigns the aggregation-heavy activity/burndown work to a
*different* slice: **S-10 (`dashboard-sprint-detail`)** owns the "Team Activity
Matrix (Developer × Day with commit/line/PR/review counts)" and the
"per-technology sub-burndowns" (roadmap.md:216-264, §S-10). S-07's "Yesterday's
Activity" panel is a subset of S-10's Activity Matrix, and S-07's Sprint-Pulse
burndown overlaps S-10's sub-burndowns. Building mini-aggregators in S-07 would
**duplicate the read-side subsystems S-10 must build anyway** — and would gate
the north-star validation on them.

## Reframed Problem Statement

> **The actual problem to plan around is**: deliver the *hypothesis-proving*
> Dashboard "Today" — Anomaly Inbox (render + client sort/filter over the ready
> `listAnomaliesForSprint` view) + per-integration freshness timestamp + error
> banner + a shared active-sprint resolver + the real-data smoke-test — as the
> north-star slice; and treat the three data panels (burndown, Yesterday's
> Activity, Reliability KPI) as separable scope, because they neither prove
> US-01 nor share the inbox's ready data path, and two of the three duplicate
> aggregation that S-10 already owns.

Addressing this de-risks the north star: US-01's core hypothesis is validated by
the inbox end-to-end (with a real repo + Jira project), instead of the milestone
being blocked behind two new aggregation subsystems that FR-016 itself marks as
non-headline / progressive-disclosure. The Reliability KPI is nearly free
(`committedSp` vs `completedSp` already on the sprint row) and can ride along;
burndown and Yesterday's Activity are the parts worth splitting out or
explicitly deferring.

This is a **scope reframe, not a correctness reframe** — nothing in the initial
framing is *wrong*; the point is that "one slice for all four surfaces" bundles
the proven-ready core with two unbuilt aggregators and blurs what actually
proves the north star.

## Confidence

- **HIGH** — code evidence is decisive (readers present/absent verified at
  file:line), the cross-system convention (S-10 ownership) reinforces the split,
  and the user's own pre-dispatch answers landed on the same reframe
  independently.

## What Changes for /10x-plan

Plan S-07 around the **inbox-centric north-star core**: Anomaly Inbox
(render + sort/filter) + freshness timestamp + error banner + a shared
`getActiveSprint(ownerId)` resolver (extract the duplicated `run-sync` /
`load-snapshot` logic) + roster reader for the member filter + the real-data
smoke-test. Decide **per panel** whether to include it: Reliability KPI is
low-cost (render existing SP columns); Sprint-Pulse burndown and Yesterday's
Activity are new aggregators overlapping S-10 — either scope them out of S-07
(recommended) or plan them as explicitly-bounded, clearly-optional phases.
**Roadmap note:** any narrowing of S-07's scope is a roadmap change — per
CLAUDE.md task-tracking, update `context/foundation/roadmap.md` (S-07 row + the
S-07↔S-10 panel boundary) *before* the plan hardens. User's call.

## References

- Source files: `src/lib/anomaly/reader.ts:34`, `src/db/schema.ts:349`
  (syncState), `src/db/schema.ts:318` (sprint), `src/lib/integrations/sync/run-sync.ts:406-419`,
  `src/lib/anomaly/load-snapshot.ts`, `src/lib/anomaly/detect.ts:52`,
  `src/app/(app)/dashboard/page.tsx` (stub), empty
  `src/components/organisms/{dashboard,anomaly}/`
- Roadmap: `context/foundation/roadmap.md` §S-07 (216-226), §S-10 (216-264 region)
- Related research: none (`context/changes/dashboard-today/research.md` absent)
- Investigation: direct code reads (surface small/known; no sub-agents dispatched)
