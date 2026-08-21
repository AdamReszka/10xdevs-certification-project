# S-07 Dashboard "Today" — Anomaly Inbox north-star core — Plan Brief

> Full plan: `context/changes/dashboard-today/plan.md`
> Frame brief: `context/changes/dashboard-today/frame.md`
> Research: `context/changes/dashboard-today/research.md`

## What & Why

Deliver the US-01 north-star: open Dashboard "Today" with the Anomaly Inbox as the default headline view — every detected anomaly with its five FR-014 attributes + risk score, default-ordered severity→recency, client re-sort and filter — plus a per-integration last-sync timestamp, an error banner that never blanks the inbox, and empty states that are empty ONLY when zero anomalies exist. This is the first end-to-end slice that proves the product works (US-01), building on the already-shipped anomaly engine.

## Starting Point

The inbox reader `listAnomaliesForSprint` already returns the 5 FR-014 attributes pre-ordered (`src/lib/anomaly/reader.ts:34-61`); `syncState` already holds per-integration freshness/error (`src/db/schema.ts:349-383`). But `dashboard/page.tsx` is a stub, the `organisms/{anomaly,dashboard}` dirs are empty, active-sprint resolution is duplicated in two files, `context` jsonb is untyped, no ticket identifier is projected, and there is no roster/sync-state reader. The setup/connect flow is fully built; the smoke-test just has no trigger under `next dev`.

## Desired End State

A signed-in tech lead at `/dashboard` sees every ACTIVE anomaly for their current sprint, re-sortable and filterable client-side, with Jira and GitHub last-sync times always visible. A sync error shows a banner naming the integration while the last cached inbox stays up; "no active sprint", "zero anomalies", and "sync error" are three distinct states. Proven once with real credentials under `wrangler dev`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slice scope | Inbox-centric core; panels + tabs deferred | 2 of 3 panels overlap S-10's aggregation; inbox alone proves US-01 | Frame |
| Ticket identity + contextual data | Typed discriminated `AnomalyContext` union + widen reader with `dedupKey` | One typed source for FR-014 contextual-data render and ticket sort/filter | Plan |
| Smoke-test trigger | Real cron under `wrangler dev` (no "Sync now" button) | Exercises the real production sync path; no throwaway UI | Plan |
| Active-sprint duplication | Extract `getActiveSprint` + collapse both call-sites | Removes 1:1 duplication, one source of truth (aligns with lessons.md) | Plan |
| Empty/error surfaces | Three distinct states + error banner + always-visible timestamp | Satisfies US-01 AC: empty only on zero anomalies, never on silent failure | Plan |

## Scope

**In scope:** Anomaly Inbox render (5 FR-014 attrs + risk score); client sort (severity/age/ticket/developer) + filter (type/member incl. unassigned); `getActiveSprint`/`getSyncState`/`listRoster` readers; typed `AnomalyContext` + `dedupKey` projection; per-integration freshness timestamp; error banner (last cached, never blank); three empty states; nav link; real-data smoke-test.

**Out of scope:** Sprint Pulse / Yesterday's Activity / Reliability KPI panels; tabs/progressive disclosure; "Sync now" button; demo/seed data; severity re-tiering / threshold settings; resolving anomalies from the inbox.

## Architecture / Approach

Bottom-up: (1) three owner-scoped DB readers on the `getDb` request path, with active-sprint extracted once and both existing call-sites collapsed onto it; (2) a discriminated `AnomalyContext` union + `dedupKey` projection so the inbox renders contextual data and sorts by ticket safely; (3) a gated server component (`requireSession` → `getDb` → readers) feeding a `"use client"` inbox organism; (4) client sort/filter (plain `useState`) + freshness bar + error banner + empty-state branches; (5) real-credentials smoke-test via `wrangler dev` cron. All UI in shadcn/ui.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared readers | `getActiveSprint` (extract+collapse), `getSyncState`, `listRoster` | Refactor touches sync+detect — keep their tests green |
| 2. Typed context + reader widening | `AnomalyContext` union + `dedupKey` in `AnomalyView` | Reverse-engineering 8 detector context shapes |
| 3. Dashboard wiring + inbox render | Real page + inbox organism (5 attrs + risk score) | shadcn additions; serializable-props boundary |
| 4. Interactivity + freshness + empty-states | Sort/filter + timestamp + banner + 3 states | Empty-vs-error correctness (US-01 AC) |
| 5. Real-data smoke-test | US-01 validated end-to-end under `wrangler dev` | Needs a real active *dated* Jira sprint or inbox is legitimately empty |

**Prerequisites:** S-06 anomaly engine, S-05 sync + `sync_state`, S-04 roster, F-03 UI foundation (all done). Local Supabase (54322) + migrations for the smoke-test; real GitHub PAT + Jira credentials for Phase 5.
**Estimated effort:** ~3-4 sessions across 5 phases (Phases 3-4 are the bulk; Phase 5 is manual).

## Open Risks & Assumptions

- Detector `context` shapes must be reverse-engineered accurately for the typed union (Phase 2) — mitigated by reading `detect.ts` + per-rule detectors; `dedupKey` is the stable fallback.
- Phase 5 depends on a real Jira project with an active, dated sprint; without it the pipeline correctly skips `no_sprint` and the inbox is empty (surfaced as the "no active sprint" state).
- `next dev` does not run the cron — the smoke-test must run under `npm run preview` / `wrangler dev`.

## Success Criteria (Summary)

- `/dashboard` shows every ACTIVE anomaly with all 5 FR-014 attributes + risk score, re-sortable and filterable.
- Per-integration freshness always visible; a sync error banners the integration and keeps the last cached inbox (never blank).
- A real sync+detect under `wrangler dev` renders ≥1 real anomaly, validating US-01.
