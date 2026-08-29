# Demo mode (S-09 / FR-008) — Plan Brief

> Full plan: `context/changes/demo-mode/plan.md`
> Frame brief: `context/changes/demo-mode/frame.md`

## What & Why

SprintFlow has no concept of demo data — demo is currently *impersonated* by fake
credentials and hand-written rows in the production tables — so an in-app demo
surface cannot be built safely, cannot be reset without deleting real data, and
cannot keep its own anomalies alive. This plan introduces the missing
distinction, then builds FR-008's "Load demo team" / "Reset demo data" on top of
it.

## Starting Point

FR-008 has no implementation; the only demo path is `scripts/seed-dashboard.mjs`,
a CLI that `DELETE`s 14 tables by `owner_id` — including both credential tables —
and inserts `anomaly` rows directly, bypassing the detection engine that
reconciles them away on the next cycle. The frame established that the blocking
question everyone assumed (demo↔real precedence) was answered mid-frame without
unblocking anything; the real blockers are one layer down, in the data model and
in fixture durability.

## Desired End State

A signed-in user clicks "Zobacz demo" in Settings and lands on a populated
Dashboard "Today" showing at least four distinct anomaly types — produced by the
real detection engine — alongside healthy-flow signals, with Sprint Detail, the
roster and the absence calendar all showing the same fictional team. A persistent
banner says they are in demo mode and offers a way back. "Reset demo data"
removes the demo world exactly, and an account holding real GitHub and Jira
tokens can do all of this without those tokens ever being at risk.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Demo↔real interaction | Any account may hold both | Settled by the owner; demoted from blocker to design input. | Frame |
| Where the blocker actually is | Data model + fixture durability, not precedence | Three of four dimensions carry direct file:line evidence. | Frame |
| Demo data model | **Separate demo owner** (synthetic `user` row, `demo_of`) | Three tables are `UNIQUE (owner_id)`, so a flag cannot work; and all 25 owner FKs cascade, making reset exact by construction. | Plan |
| Rejected alternatives | No `is_demo` column, no duplicated tables | A flag adds a predicate to ~25 call sites where one omission silently mixes data; duplicate tables double the schema forever and, in Drizzle, become a second code path rather than a SQL condition. | Plan |
| Mode switch | `user.active_workspace` column | Durable across browsers and devices; one source of truth. | Plan |
| Demo scope | Everything except Connections and Setup | Matches US-02's tour; integration config is not a thing to simulate. | Plan |
| Time coherence | **Frozen demo clock** (`demo_anchor_at`) | Keeps the demo a coherent "konkretny moment" indefinitely, and makes re-detection idempotent so the reconcile stops being a threat. | Plan |
| Anomaly production | The real detection engine on fixture rows | Demo then shows the product's actual output and survives every reconcile — the frame's defect is removed, not contained. | Plan |
| External effects | Pre-made fixture results, actions disabled | Refinement and Daily Recap are in demo scope but must not spend tokens or send mail. | Plan |
| Fixture home | TS module in `src/lib/demo/`; the seed CLI is deleted | One dataset, one entry point; two parallel fixtures is the shape behind all three prior incidents. | Plan + review F4 |
| Demo editability | Fully editable except integrations | US-02 says "explore"; writes go to the demo owner and reset undoes them. | Plan |

## Scope

**In scope:** demo tenancy columns + resolver; `loadDemo` / `resetDemo`; fixture
ported to TypeScript with anchor-relative offsets; cron exclusion; effective-owner
threading across ~22 call sites (classified per ACTION, not per directory —
review F1); frozen-clock threading; Settings "Demo" tab; demo banner; demo-mode
refusals for sync, roster/cadence import, refinement and recap;
`scripts/seed-dashboard.mjs` and `db:seed:demo` deleted outright (review F4).

**Out of scope:** `is_demo` columns or duplicated tables; demo for Connections and
Setup; live AI or outbound email in demo; signing in as the demo owner; re-anchoring
demo timestamps over time; a second fixture dataset.

## Architecture / Approach

Demo is modelled as **tenancy, not a flag**. The account gains a synthetic `user`
row whose `demo_of` points at the real one; all demo data lives in the existing
tables under that `owner_id`. One `cache()`d resolver — `resolveWorkspace()` →
`{ ownerId, realOwnerId, isDemo, now }` — replaces the ~22 inline
`session.user.id` reads, with an explicit `requireRealWorkspace()` for Connections
and Setup. Demo's isolation is therefore the same mechanism already trusted to
isolate two real customers, and there is one place to get it right instead of
twenty-five. Anomalies come from `detectAnomalies` run over fixture rows at the
frozen anchor; because both data and clock are fixed, re-detection is idempotent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Demo tenancy in the data model | Migration (`demo_of`, `active_workspace`, `demo_anchor_at`) + `resolveWorkspace()`; inert by design | A resolver that fails open would render a half-created demo as demo — covered by explicit fallback tests |
| 2. Demo lifecycle and fixture | `loadDemo` / `resetDemo`, fixture as a typed module, cron exclusion | The fixture must genuinely cross default thresholds for ≥4 anomaly types — tuning dates is now real work, not a literal |
| 3. Effective owner + frozen clock | ~22 call sites switched; demo `now` reaches detection and both dashboards | A missed call site reads the wrong owner — caught by a `grep` gate in the success criteria |
| 4. The FR-008 surface | Settings "Demo" tab, load/exit/reset actions, demo banner, disabled sync controls | Mode lives in the DB, not the URL, so the banner is load-bearing, not decorative |
| 5. No external effects, one fixture | Refinement + recap fixture rows and refusals; seed CLI deleted | The recap row's terminal `send_status` is load-bearing twice — it also keeps the one client-side clock out of demo (review F5) |

**Prerequisites:** S-07 and S-10 (both dashboards shipped — met). Local Supabase
for the integration suite. No new external services.
**Estimated effort:** ~4–5 sessions across 5 phases; Phase 2 is the largest.

## Open Risks & Assumptions

- **The demo owner necessarily holds a `github_credential`** (`github_commit → monitored_repo → github_credential` is NOT NULL end to end), so it *will* match `enumerateOnboardedOwners` — which drives Daily Recap sending, not just sync. The exclusion in Phase 2 is mandatory; if it regresses, a fictional account starts emailing.
- **Assumption: no client component computes relative time.** Verified today — the only `new Date()` under `src/components/` is a default parameter. A future client-side "x hours ago" would break the frozen clock's illusion.
- **Fixture tuning is empirical.** The plan names the eight target anomaly types, but which ones actually fire depends on the default thresholds; Phase 2's integration test asserts ≥4, and the fixture is adjusted until it passes.
- **Review-corrected (2026-08-29).** `/10x-plan-review` found two CRITICALs, both
  now fixed in `plan.md`: the roster editor's server actions live under
  `setup/team/` and would have written to the REAL owner from the demo page (F1),
  and the resolver as first specified would have replaced each action's
  `requireSession()` guard with a non-throwing session read (F2). The fixture also
  gained `sprint_measurement` and `team_day_off`, without which two of Today's
  four FR-016 panels open empty (F3). Full report:
  `context/changes/demo-mode/reviews/plan-review.md`.
- **A synthetic row lands in the `user` table.** It has no `account` row so it cannot be signed into, but any future query that counts or enumerates users must filter `demo_of IS NULL`.

## Success Criteria (Summary)

- A visitor with no integrations connected can load demo and explore both dashboards, seeing ≥4 distinct anomaly types with suggested actions — in under 2 seconds, with no external API call.
- An account holding real GitHub and Jira tokens can load and reset demo repeatedly; both credentials remain connected and byte-identical throughout.
- The demo reads as the same coherent moment whenever it is viewed, and no sync, cron cycle or absence save erases its anomalies.
