# Frame Brief: Demo mode (S-09 / FR-008)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

FR-008 / US-02 has no implementation in the application. `grep -ri demo src/`
returns zero hits outside unrelated comments (`demote`, `refinementSource`);
there is no route, no action, no "Load demo team" or "Reset demo data" control.
The only demo path in the repo is `scripts/seed-dashboard.mjs` — a Node CLI
script run via `npm run db:seed:demo`, outside the app, that writes fixture
literals into the same owner-scoped tables the real sync reads and writes.

## Initial Framing (preserved)

- **User's stated cause or approach**: from `roadmap.md:272` and Open Roadmap
  Question #1 — the blocker is a UX decision (mutual exclusion / toggle /
  real-data precedence), and that decision "determines demo-mode data routing
  architecture; S-09 cannot be planned until resolved".
- **User's proposed direction**: resolve the demo↔real interaction question,
  then plan S-09.
- **Pre-dispatch narrowing**: leading concern is **the missing surface**, not
  the collision ("brak powierzchni demo"); scope is **any account, including
  one with real credentials connected**; purpose is to show "jak działa w
  ujęciu jakiegoś konkretnego momentu cała aplikacja … na fikcyjnych
  użytkownikach aby dało się to zobaczyć bez podpinania jakichkolwiek kont".

## Dimension Map

The observation could originate at any of these dimensions:

1. **Entry surface** — no route/action exists to load or reset demo data from
   inside the app; the capability lives only in a CLI script.
2. **Precedence policy** — with demo and real data both present, nothing
   decides what the dashboard shows.  ← initial framing
3. **Data-model discriminator** — nothing in the schema marks a row as demo.
   "Demo account" is expressed as *fake-but-validly-encrypted credentials* plus
   hand-written rows, indistinguishable from a real account with a bad token.
4. **Fixture durability & authorship** — seeded rows are hand-written into
   tables that reconciling writers own, and their timestamps are relative to
   seed time.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Entry surface absent | `grep -ri demo src/` → 0 functional hits; `find src/app -type d` lists no demo route; capability is `scripts/seed-dashboard.mjs` + `package.json:23` | **STRONG** |
| 2. Precedence policy is the blocker | The question is real, but it was **answered during Step 1.5** ("any account, incl. real data") and the slice remained unplannable — the destructive-load and non-durable-fixture problems are untouched by any of its three answers | **WEAK** |
| 3. No demo discriminator in the data model | `src/db/schema.ts` has no demo flag on any table; seed scopes purely by `owner_id` (`seed-dashboard.mjs:222`). Load CLEARS 14 tables incl. `github_credential` / `jira_credential` (header, lines 31–38) — on an account with real tokens this destroys them unrecoverably | **STRONG** |
| 4. Fixture is not durable | `detect.ts:119-128` — `detectAnomalies` is a full reconcile per (owner, sprint): every ACTIVE row whose `dedupKey` is not re-detected flips to `RESOLVED`. The seed inserts `anomaly` rows **directly** (`seed-dashboard.mjs:354+`), bypassing the engine. Detection is reachable three ways on a demo account: cron (`scheduled.ts:100`, and the seeded owner IS enumerated — `enumerateOnboardedOwners` joins `jira_project` × `github_credential`, both of which the seed writes), "Sync now" (`sync/actions.ts:92`), and **saving an absence** (`settings/absences/actions.ts:223`, no credentials involved). Timestamps are `h(n) = n hours ago` relative to seed time (`seed-dashboard.mjs:130`) | **STRONG** |

## Narrowing Signals

- **The blocking question was answered and nothing unblocked.** The user's
  Step 1.5 answer settles Open Question #1 (any account may load demo, including
  one with real integrations). Under that answer the slice is *less* plannable,
  not more: it is exactly the case where a destructive load eats real
  credentials. A decision that does not change the work when answered was not
  the blocker.
- **The leading concern is the missing surface** — the user's own answer. But
  the surface cannot be built as a thin wrapper over the existing script,
  because the script's contract (clear 14 tables for this owner) is only safe on
  a throwaway account, and the chosen scope is the opposite.
- **"Konkretny moment"** — the demo must read as a coherent snapshot *when
  viewed*, not when seeded. A fixture anchored to seed time drifts: viewed a
  week later, every anomaly age, burndown position and activity row is a week
  stale.

## Cross-System Convention

This project has met this class twice before, and `lessons.md` already records
one of them. Both are the same root — demo literals living in real tables with
no marker:

- **`jira_sprint_id=1001`** — a real account held the seed's sprint row, so the
  JQL matched nothing and the cycle reported OK for days
  (`lessons.md` § "A narrowing predicate turns 'wrong value' into 'empty
  result'"; root cause at
  `archive/2026-08-21-dashboard-sprint-detail/plan.md:1020-1052`). Closed by
  S-16 for the sprint row specifically.
- **Roster synthetic keys** — `alice-kim` / `acc-alice-kim` match nothing a real
  import returns, so import grew the roster: 5 rows became 9
  (`roster-store.ts:118-126`). Closed by S-15 for `team_member` specifically.

Both were fixed **per-table, at the consumer**. Neither introduced the missing
concept, which is why the third instance (anomalies) is still open and a fourth
(credentials) is one `npm run db:seed:demo` away.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: SprintFlow has no concept of demo
> data — demo is currently *impersonated* by fake credentials and hand-written
> rows in the production tables — so an in-app demo surface cannot be built
> safely, cannot be reset without deleting real data, and cannot keep its own
> anomalies alive.

The initial framing put the blocker at the precedence policy (dimension 2). The
evidence puts it one layer down, at dimensions 3 and 4. Precedence is a question
you can only *implement* once demo rows are distinguishable from real ones;
until then all three of its candidate answers are equally unbuildable. Give the
system that distinction and the FR-008 surface becomes ordinary work: load
becomes additive rather than destructive, reset becomes exact rather than
"delete this owner's world", and the demo's anomalies stop being collateral of
the next reconcile.

Two consequences the plan must own, both discovered here rather than assumed:

- **Load must not be a `DELETE … WHERE owner_id`.** The chosen scope (any
  account) makes the existing script's contract actively dangerous.
- **Demo anomalies must either be produced by the detection engine or be
  excluded from its reconcile.** Hand-writing rows into a table a reconciling
  writer owns is the same defect shape as `lessons.md`'s delete-then-insert
  entry, and it fires on an action as innocent as saving an absence.

## Confidence

**HIGH** — three of four dimensions carry direct `file:line` evidence; the
leading reframe predicted collisions on three independent surfaces (sprint,
roster, anomalies) and all three are documented in this repo; and the initial
framing's own blocking question was answered mid-frame without unblocking
anything.

## What Changes for /10x-plan

The plan is not "pick a precedence policy and wrap the seed script in a button".
It is: introduce a demo/real distinction the schema and the reconciling writers
both respect, then build the FR-008 load/reset surface on top of it — with the
precedence policy (now answered: any account may hold both) as a design input,
not a prerequisite. Fixture *content* is a solved problem; `seed-dashboard.mjs`
already covers all 8 anomaly types and the full upstream set both dashboards
read, and remains the head start `roadmap.md:270` says it is.

## References

- Source files: `scripts/seed-dashboard.mjs:1-38,130,196-226,253,354`;
  `src/lib/anomaly/detect.ts:60-128`;
  `src/lib/integrations/sync/scheduled.ts:49-101`;
  `src/lib/integrations/sync/actions.ts:92`;
  `src/app/(app)/settings/absences/actions.ts:223`;
  `src/lib/integrations/roster-store.ts:118-126`; `src/db/schema.ts`
- Prior incidents: `context/foundation/lessons.md` § narrowing predicate;
  `context/archive/2026-08-21-dashboard-sprint-detail/plan.md:1020-1052`
- Roadmap: `context/foundation/roadmap.md:263-272` (S-09),
  Open Roadmap Question #1; PRD FR-008, US-02, Open Question #2
- Investigation: direct reads (surface small and familiar; no sub-agents
  dispatched, per Step 2's "use sub-agents when the surface is large or
  unfamiliar")
