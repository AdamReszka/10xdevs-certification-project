# S-05 Data Sync Engine — Plan Brief

> Full plan: `context/changes/data-sync-engine/plan.md`
> Frame brief: `context/changes/data-sync-engine/frame.md`
> Research: `context/changes/data-sync-engine/research.md`

## What & Why

Build a multi-user, DB-stateful sync engine that runs both on a global 15-minute Cron
Trigger and on demand (first sync after setup / "sync now"), fans out per owner within the
Workers subrequest/CPU budget, establishes the PR↔ticket correlation at ingestion, and is
safe against overlapping invocations — with freshness reported from actual DB completion
time. It serves FR-011/FR-012 and is the data source S-06 (anomaly detection) and S-07
(Dashboard "Today") depend on.

## Starting Point

The GitHub and Jira clients (`github.ts`, `jira.ts`) have only setup/validation methods —
zero commit/PR/review or ticket/changelog fetch. `syncState` exists with cursor/status/
freshness columns but no lock. `getDb()` builds a `max:1` pool per call and never closes
it. No cron is wired (`wrangler.jsonc` has no `triggers.crons`; no `scheduled()` export).
Synced tables, dedup keys, and `linkedTicketKey` (unpopulated) already exist.

## Desired End State

A `*/15` cron iterates all set-up owners and, per owner, pulls GitHub (commits/PRs/PR-
detail/reviews) and Jira (active-sprint tickets + changelog delta), upserts idempotently,
sets `linkedTicketKey` at ingestion, and stamps per-integration `lastSuccessfulSyncAt` from
actual completion time. A `syncNow` Server Action runs the same sync for the current owner
right after setup, so S-07 has data immediately. Overlapping fires skip freshly-leased
owners; the scheduled/on-demand pool is explicitly closed.

## Key Decisions Made

| Decision                     | Choice                                   | Why (1 sentence)                                                              | Source   |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Trigger model                | Cron + on-demand                         | S-07 needs data right after setup, not ≤15 min later                         | Frame    |
| PR↔ticket correlation        | Set at ingestion                         | S-06 consumes correlated rows without a detection-time join                  | Frame    |
| Fan-out                      | Capped global loop                       | Queues not installed; simplest thing that works at MVP scale, cursor-drained | Plan     |
| Overlap guard                | Claim/lease `claimedUntil`, per integration | Covers the long fetch phase; per `(owner, integration)` row so GitHub/Jira guard independently | Plan  |
| Freshness configurability    | `freshnessWindowMinutes` as a due-check  | Honors FR-011 upward; sub-15-min windows floored at the global cron interval  | Plan     |
| Owner enumeration            | Single set-based query                   | Per-owner `isOnboardingComplete` would be N×6 queries burning the shared budget | Plan   |
| Commit line-counts           | Left NULL in MVP                         | Commits-list omits stats; per-commit GET would blow the budget; no anomaly needs it | Plan |
| Pool teardown scope          | Cron path only                           | Keeps S-05 focused; request-path lesson-#3 debt stays a separate ticket      | Plan     |
| Transaction granularity      | Per-repo / per-integration batch         | Short connection-pin window; partial failure blast-radius = one unit         | Plan     |
| PR size (`PR_TOO_BIG` data)  | Per-PR detail GET, capped per cycle      | S-06 gets complete data now; cap protects the subrequest budget              | Plan     |
| On-demand surface            | Server Action                            | Consistent with `setup/*/actions.ts`; no new API/auth surface                | Plan     |
| Jira search endpoint         | `GET /rest/api/3/search/jql` (token pg.) | Old `GET /search` is deprecated/being removed (context7)                     | Research/context7 |

## Scope

**In scope:** lease column + migration; net-new GitHub/Jira fetch methods; PR↔ticket link
parser; pure `syncOwner` store layer (per-unit fetch→upsert, lease, per-integration status,
freshness); custom OpenNext `scheduled()` entry + `wrangler` crons; capped global loop with
pool teardown; `syncNow` Server Action.

**Out of scope:** Cloudflare Queues / self-fetch fan-out; request-path pool-teardown
retrofit; `RUNNING` enum value; anomaly detection (S-06); dashboard UI (S-07); absences /
thresholds; historical backfill beyond the active sprint.

## Architecture / Approach

Bottom-up on the existing two-layer split. Schema delta (lease) → net-new client fetch
methods mirroring the fixed per-client pattern (typed errors, injectable seam, capped +
origin-checked pagination; Jira adapted to token pagination) → pure injectable
`src/lib/integrations/sync/*` store layer (`linkTicketKey`, `syncOwner`) that fetches per
unit then opens short upsert transactions → wiring: custom OpenNext worker entry with
`scheduled()` running the capped global loop + `ctx.waitUntil(pool.end())`, and a `syncNow`
Server Action reusing `syncOwner`.

## Phases at a Glance

| Phase                        | What it delivers                                        | Key risk                                             |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| 1. Schema lease guard        | `claimedUntil` column + migration                       | Trivial; sequencing dependency for Phase 4/5         |
| 2. GitHub fetch methods      | commits/PRs/PR-detail/reviews                            | Per-PR detail/review fan-out (subrequest cost)       |
| 3. Jira fetch methods        | sprint issues + changelog delta, SP field               | Token pagination differs from existing loop; SP field id per-site |
| 4. Sync store layer          | `linkTicketKey` + `syncOwner` (upsert/lease/freshness)  | Per-integration independence; no fetch-in-txn        |
| 5. Cron + on-demand wiring   | `scheduled()` entry + crons + `syncNow` action          | OpenNext custom-entry must preserve `fetch`; pool teardown |

**Prerequisites:** S-04 (team + repos + Jira project configured) and F-02 (sync state +
data tables) — both done. Real GitHub PAT + Jira credentials for manual verification.
**Estimated effort:** ~4–5 sessions across 5 phases (Phase 1 small; Phases 2–4 the bulk).

## Open Risks & Assumptions

- OpenNext custom worker entry must add `scheduled()` without breaking the generated
  `fetch` path — verify the exact wrap/import against the `@opennextjs/cloudflare` template
  during Phase 5.
- Local cron verification under `initOpenNextCloudflareForDev()` may be limited — may need
  deployed verification for the scheduled path.
- Jira story-point `customfield_*` id is site-specific and must be discovered at runtime.
- Capped global loop shares one invocation's budget across owners — fine at MVP scale;
  fan-out is deferred, not free.
- `LEASE_TTL` must exceed worst-case per-integration run yet allow crashed-run recovery.
- Sub-15-min `freshnessWindowMinutes` is not honored (floored at the global cron interval);
  only upward configurability ships in MVP.

## Success Criteria (Summary)

- After setup with real credentials, `syncNow` populates commits/PRs/reviews/tickets/status-
  history for the owner, with `linkedTicketKey` set where a PR references a monitored-project
  key, and `syncState` shows OK + fresh per-integration timestamps.
- The `*/15` scheduled path syncs owners within budget, stamps freshness from DB completion
  time, and a second immediate fire skips the still-leased owner.
- A Jira outage leaves GitHub `syncState` OK (per-integration independence); no pooled
  connection is left open after repeated fires.
