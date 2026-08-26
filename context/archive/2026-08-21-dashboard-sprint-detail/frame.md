# Frame Brief: S-10 Dashboard "Sprint Detail" — is this one coherent slice?

> Framing step before /10x-plan. Captures what is *actually* at issue, separated
> from what the roadmap assumed.

## Reported Observation

Roadmap slice S-10 is framed as ONE slice bundling 5 read-side surfaces:
(A) Workflow aging report, (B) Team Activity Matrix, (C) per-technology
sub-burndowns, plus two panels absorbed from S-07: (D) Sprint Pulse burndown,
(E) Yesterday's Activity. Question brought to frame: is this one coherent slice
or a grab-bag that should be cut differently?

## Initial Framing (preserved)

- **Roadmap's stated approach**: D+E were deferred from S-07 to S-10 "because of
  aggregation overlap" with the Activity Matrix and sub-burndowns → build them
  here, once. Roadmap's flagged *top risk*: aging report + burndown need full
  per-ticket status-change history; if S-05 only stored current status, a
  backfill migration is needed.
- **User's proposed direction**: plan and build S-10 as a whole.
- **Pre-dispatch narrowing**: user answered "haven't separated the concern yet"
  (wants the full frame to surface what matters) + "treat as one slice, order by
  shared aggregation machinery, not by dashboard."

## Dimension Map

Where the "right cut" question could originate:

1. **Shared aggregation machinery** — do the 5 surfaces reduce to a few reusable
   reducers (→ one slice is efficient), or 5 bespoke queries (→ cut)? ← user's leaning
2. **Cross-dashboard placement** — D+E render on "Today" (FR-016); A/B/C on
   "Sprint Detail" (FR-017). Does crossing two routes force a split by dashboard?
3. **Data readiness / backfill** — is the source data actually *populated* by the
   S-05 sync (not merely present in schema)? ← roadmap's flagged top risk
4. **Reuse surface from S-07** — what already exists (readers, shell, tabs) vs.
   what S-10 builds new? Determines the true slice size.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **(1) 5 surfaces share machinery** | Reduce to **3 reducers**: M1 SP-over-time (shared C+D, group-by all vs. `technologyTrack`), M2 per-dev-per-day GitHub rollup (shared B+E, day-grid vs. single-day), M3 time-in-status (standalone A). Group-by/granularity is the only intra-pair difference. All 3 are **net-new**; `loadSprintSnapshot` (`src/lib/anomaly/load-snapshot.ts:42-59`) does NOT load `jiraStatusHistory` and must be extended to feed M1+M3. | **STRONG** |
| **(3) backfill risk (roadmap's top risk)** | `jiraStatusHistory` IS written by sync — `run-sync.ts:493-513` inserts from/to category + `changedAt` per transition, incrementally (`updatedSince` cursor) + idempotently (`onConflictDoNothing` on `(ticketId, jiraChangelogId)`). Changelog fetched via `expand:"changelog"` (`jira.ts:810`, parsed `723-758`). **No backfill needed.** | **NONE** (risk retired) |
| **(4) "reuse the Today tabs"** | **No tab structure exists.** No `src/components/ui/tabs.tsx`; Today page = `h1` + `<AnomalyInbox>` single column (`dashboard/page.tsx:90,96`). The roadmap's claimed S-07 "Reliability KPI tab" was **never built** — zero `reliability`/`committedSp`/`completedSp` refs in `src/components` or `src/app`. S-10 inherits only *plumbing*: `getActiveSprintRow` (`src/lib/sprint.ts:19`), `listRoster` (`src/lib/roster.ts:28`, carries `technologyTrack`), `AppShell` (auto-inherited via `(app)/layout.tsx`), and the `table` primitive. Sprint Detail route is **brand-new** (no stub). | **STRONG** (scope larger than framed) |
| **(2b) commit line-count data gap** | (B) Activity Matrix is specified as "commit/**line**/PR/review counts", but `githubCommit.additions/deletions` are **never written** — commit insert writes only `sha`+`author`+`authoredAt`+`message` (`run-sync.ts:295-296`); per-commit stats dropped by MVP design (too many subrequests, `github.ts:347-357`). PR-level `additions/deletions` ARE populated (`run-sync.ts:317-318`). | **STRONG** (hidden gap) |

## Narrowing Signals

- Cohesion is **real**: two of three reducers are each shared across two surfaces
  (M1→C+D, M2→B+E). Splitting *by dashboard* would fracture M1 and M2 across two
  slices and force building each reducer twice — the opposite of what the user's
  "order by shared machinery" instinct wants. This is the decisive signal **for**
  keeping one slice.
- Two hidden items the roadmap did not surface: (a) S-10 must build a **tabs
  primitive + retrofit the Today page** (the roadmap wrongly assumes S-07 left a
  tabbed shell to fill); (b) the **commit line-count column of (B) has no data**.

## Cross-System Convention

Read-side aggregation in this repo lives as owner-scoped readers (`(db, ownerId,
…)`) in `src/lib/*` (`sprint.ts`, `roster.ts`, `anomaly/reader.ts`,
`sync-state.ts`), rendered by server components under `src/app/(app)/…`. S-10's
3 reducers fit that convention exactly — new readers in `src/lib`, a new
`(app)/dashboard/…` route, `AppShell` inherited. Nothing about the shape is
unconventional; the cost is volume (3 new reducers + 5 UI surfaces + a tabs
primitive + a new route), not novelty.

## Reframed (or Confirmed) Problem Statement

> **The one-slice framing HOLDS on cohesion grounds — but the scope is materially
> larger than the roadmap states, and carries two hidden items the roadmap missed.**

Keep S-10 as one slice: the 5 surfaces genuinely collapse to 3 reducers (2 of
them shared across surface-pairs), so splitting by dashboard would duplicate the
shared machinery — exactly the waste the user's instinct wants to avoid. The
roadmap's *top risk* (status-history backfill) is **retired** — the sync already
writes full transitions. But the frame corrects the scope on three points the
roadmap got wrong or omitted:

1. **Tabs infra is net-new.** S-07 did NOT ship a tabbed Today page or a
   Reliability KPI. S-10 must add a `tabs` primitive and retrofit the Today page
   to host Inbox + Sprint Pulse + Yesterday's Activity (or decide the alternative
   placement). "Reuse the Today tabs" does not hold.
2. **Commit line-count column of the Activity Matrix has no data.** Decide before
   planning: descope the per-commit "line" metric to PR-level `additions/
   deletions` (data exists), or add per-commit stat fetching to the sync (a hidden
   sync prerequisite, extra subrequest budget).
3. **`loadSprintSnapshot` must be extended** to read `jiraStatusHistory` (never
   read for aggregation today) to feed M1 (burndowns) and M3 (aging).

## Confidence

**HIGH** — every claim carries file:line evidence, three independent
investigations corroborate (two independently flagged that `loadSprintSnapshot`
omits `jiraStatusHistory`), and the two roadmap-contradicting claims (no tabs / no
KPI; commit line-counts unwritten) were directly re-verified by grep.

## What Changes for /10x-plan

Plan S-10 as **one slice around 3 shared reducers (M1/M2/M3)**, not 5 bespoke
queries — but budget for the corrected scope: (i) a new `tabs` primitive + Today
retrofit, (ii) an explicit decision on the commit-line-count gap (recommend:
descope to PR-level churn for MVP, note per-commit sync as phase-2), (iii)
extending `loadSprintSnapshot`/adding a status-history reader. Drop the
backfill-migration risk from the plan — it does not exist.

## References

- Schema: `src/db/schema.ts:531-580` (jiraStatusHistory, jiraTicket), `:424-512`
  (github commit/PR/review), `:294-347` (teamMember, sprint)
- Sync writes: `src/lib/integrations/sync/run-sync.ts:295-296` (commit gap),
  `:317-318` (PR churn), `:493-513` (status history)
- Reuse surface: `src/lib/sprint.ts:19`, `src/lib/roster.ts:28`,
  `src/lib/anomaly/load-snapshot.ts:42-59`, `src/app/(app)/dashboard/page.tsx:90-96`
- Roadmap: `context/foundation/roadmap.md:260-271` (S-10 + scope note + risk)
- Investigation: 3 parallel Explore sub-agents (aggregation machinery / reuse
  surface / sync data readiness), 2026-08-21
