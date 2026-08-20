# Frame Brief: S-05 Data Sync Engine

> Framing step before /10x-plan. Captures what is *actually* at issue for S-05,
> separated from what the roadmap one-liner assumed.

## Reported Observation

Scope question (not a bug): S-05 = "a data sync engine — a 15-minute cycle pulls
GitHub commit/PR/review data and Jira active-sprint tickets + status-change
history (incremental delta since last successful sync); results stored in DB;
last-sync timestamp per integration stored and readable by the dashboard."
PRD refs FR-011, FR-012. Prereqs S-04, F-02 (both done).

## Initial Framing (preserved)

- **User's stated cause or approach**: time-driven background job; Cloudflare Cron
  Trigger vs node-cron (open); GitHub freshness TTL 15-min default (open, PRD OQ#3).
- **User's proposed direction**: build the engine as the roadmap S-05 describes.
- **Pre-dispatch narrowing** (user decisions this round):
  - Trigger model → **Cron + on-demand** (S-05 also owns initial/"sync now").
  - PR↔ticket correlation → **set at ingestion in S-05** (populate
    `githubPullRequest.linkedTicketKey` during sync).
  - Fan-out → **multi-user from day one** (one global cron iterates all owners).

## Dimension Map

The scope could be mis-cut at any of these dimensions:

1. **Trigger model** — "15-min cycle" implied scheduler-only; hid whether initial /
   on-demand sync belongs to S-05. ← RESOLVED: yes, S-05 owns it.
2. **Fan-out / scale** — Cloudflare Cron Triggers are *global* (one fire → all users);
   "sync 15-min" hid the N-users × M-repos fan-out under the 10k-subrequest / CPU
   ceiling. ← RESOLVED: multi-user now.
3. **Correlation ownership** — `linkedTicketKey` is what makes data correlatable for
   S-06; framing was silent on ingestion-time vs detection-time. ← RESOLVED: ingestion.
4. **Idempotency / delta** — dedup keys + `jiraHistoryCursor`. Already pinned by F-02
   schema + lessons.md. ← Solid; low risk.
5. **Execution context** — pg Pool is per-request with an after-hook teardown; cron
   runs in `scheduled()` with NO request. Framing "engine" hid this runtime shift.
6. **Overlapping-invocation concurrency** — *surfaced by cross-check, not in original
   frame*: two overlapping cron fires caused sync race conditions in a prior
   post-mortem. Multi-user fan-out makes long runs (→ overlap) more likely.

## Hypothesis Investigation

Grounded by direct targeted reads (schema.ts, lessons.md, github.ts/jira.ts exports,
db.ts, infrastructure.md, deploy-plan.md) rather than spawned sub-agents — the surface
was small and the evidence conclusive (guardrails #6 no-padding, #7 time-box).

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1 Trigger model under-specified | No `scheduled()` handler, no `src/app/api` sync route, no "sync now" path exist yet — all net-new; S-07 north star needs data right after setup, not ≤15 min later | STRONG |
| D2 Fan-out hidden by "15-min" phrasing | Cron Triggers global per Worker (`infrastructure.md:38,57`); subrequest ceiling shapes sync (`infrastructure.md:75,107`) | STRONG |
| D3 Correlation ownership unclear | `githubPullRequest.linkedTicketKey` column exists + indexed (`schema.ts:470,481`); no code populates it; S-06 needs correlated data | STRONG |
| D4 Idempotency/delta | `syncState.jiraHistoryCursor` (`schema.ts:362`); dedup unique keys on all synced tables; lessons.md#1 (NULL-in-dedup-key) | SOLID (already designed) |
| D5 Execution context shift | db.ts per-request Pool + lessons.md#3 (teardown must fire after handler, not at construction); cron has no request after-hook | STRONG |
| D6 Overlapping-invocation races | `infrastructure.md:79` post-mortem: overlapping Cron invocations caused sync race conditions; `:108` in-memory state resets → DB is sole state source | STRONG |

## Narrowing Signals

- User: trigger = **Cron + on-demand** → D1 resolved; S-05 must expose a manual/initial
  sync entry point, not just a `scheduled()` handler.
- User: correlation = **ingestion-time** → D3 resolved; sync parses the Jira key from PR
  branch/title/body and writes `linkedTicketKey`, so S-06 consumes correlated rows.
- User: fan-out = **multi-user now** → D2 resolved; and it *amplifies* D6 (longer runs,
  overlap risk) → the plan needs a per-owner overlap guard / lock.

## Cross-System Convention

Scheduled sync on Workers here is conventionally: native **Cron Trigger** in a
`scheduled()` handler (`deploy-plan.md:14` places cron wiring in the feature plan, i.e.
S-05, not the deploy plan); DB as single source of sync state (`infrastructure.md:108`);
**"last sync" derived from actual DB completion timestamp, not scheduled time**
(`infrastructure.md:87`, `deploy-plan.md` E5); subrequest budget managed by batching Jira
delta and capping GitHub scan per cycle (`infrastructure.md:107`). The leading direction
matches this convention exactly.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: build a *multi-user, DB-stateful sync
> engine* that runs both on a global 15-min Cron Trigger and on demand (first sync after
> setup / "sync now"), fans out per owner within the Workers subrequest + CPU budget,
> establishes the PR↔ticket correlation at ingestion, and is safe against overlapping
> invocations — with freshness reported from actual DB completion time.

The initial "15-min sync engine" framing **held up** — this is a sharpening, not a
reversal. Three under-specified axes are now pinned (on-demand ownership, ingestion-time
correlation, multi-user fan-out), and the cross-check added one risk the original framing
omitted (overlapping-invocation concurrency). Addressing these up front prevents S-06/S-07
from inheriting un-correlated data, a stale-by-15-min first impression, and fan-out races.

## Confidence

**HIGH** — every dimension has strong evidence with file:line refs; the direction matches
the documented Workers convention; the three user decisions are decisive and mutually
consistent; the one added risk (D6) is corroborated by a project post-mortem.

## What Changes for /10x-plan

The plan is not "wire a 15-min cron" — it is a sync engine with: (a) a `scheduled()`
Cron entry AND an on-demand/initial trigger; (b) per-owner fan-out under the subrequest
budget (batch Jira delta, cap GitHub scan, cursor-driven); (c) new client fetch methods
(commits/PRs/reviews on github.ts; tickets/status-history/changelog delta on jira.ts —
none exist yet); (d) PR↔ticket link parsing at ingestion; (e) a scheduled-context DB pool
lifecycle (no request after-hook); (f) an overlap guard per owner; (g) freshness =
actual DB completion timestamp. Recommend `/10x-research` next to ground (c)/(e)/(f)
before planning.

## References

- Source files: `src/db/schema.ts:349-378` (syncState), `:419-577` (synced tables),
  `src/lib/github.ts` (validatePat/listRepos/listCollaborators — no fetch-data methods),
  `src/lib/jira.ts` (getActiveSprint et al — no ticket/history fetch), `src/lib/db.ts:4-11`
- Lessons: `context/foundation/lessons.md` #1 (NULL dedup key), #3 (pool teardown),
  #4 (pagination cap + origin check)
- Convention/risk: `context/foundation/infrastructure.md:75,79,87,107,108`,
  `context/deployment/deploy-plan.md:14,369` (E5 cron drift)
- Related research: none yet (research skipped; recommend `/10x-research data-sync-engine`)
- Investigation tasks: none (grounded by direct reads, not spawned agents — see note above)
