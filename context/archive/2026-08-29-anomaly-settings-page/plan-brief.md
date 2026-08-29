# S-14 — Anomaly threshold + severity settings page — Plan Brief

> Full plan: `context/changes/anomaly-settings-page/plan.md`
> Research: `context/changes/anomaly-settings-page/research.md`

## What & Why

FR-009 puts threshold tuning on a dedicated settings page rather than in the
setup wizard; FR-014 makes each rule's severity tier user-configurable, because
"what counts as high" is team-subjective. S-14 builds that surface as the sixth
tab of the existing `/settings` shell — eight per-rule cards where the lead
re-tiers severity and overrides detection thresholds, each saving independently.

## Starting Point

The structural half already exists and is live. `anomaly_settings`
(`schema.ts:924-947`) carries `unique(owner_id, anomaly_type)` with a cascading
FK to `user`, so account scoping is structural — the roadmap's stated framing
risk is already closed, which is why this slice skipped `/10x-frame`.
`resolveEffectiveThresholds` (`thresholds.ts:24-52`) layers overrides over
`DEFAULT_THRESHOLDS` and is really called by the detector. S-10 reserved the tab
slot at `settings/layout.tsx:28`.

What is missing is everything between a form field and that jsonb column: there
are **zero writers** to the table and **zero runtime guards** on read — all eight
detectors do an unchecked `as` cast — and the merge is **shallow**, so a payload
carrying one changed story-point bucket silently deletes the other six.

## Desired End State

Settings → **Anomaly rules** shows eight cards. Each has a severity select, its
own numeric fields, a "Modified" badge when it differs from the shipped defaults,
and its own Save / Reset to defaults. Saving persists the rule, re-runs detection
immediately, and toasts; the inbox reflects the new threshold without waiting for
the cron cycle. Reset removes the override row and the card returns to defaults.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Effect timing | Re-detect after save (D1) | The owner's generalised rule names S-14 explicitly and `/settings/absences` already implements it; the roadmap's "next detection cycle" wording is corrected in this change. | Plan |
| `TICKET_STATUS_AGING` depth | All 7 SP buckets + a two-position 21-SP control | FR-009 lists the buckets verbatim, and the `"8_WORKING_DAYS"` sentinel cannot carry a number, so that one bucket is a choice rather than an input. | Plan |
| Demo mode | Allowed, like `/settings/absences` | Thresholds make no outbound call, so there is nothing to simulate; demo writes land under the demo owner and are undone by "Reset demo data". | Plan |
| Dead `is_default` column | Dropped in a migration | Written nowhere, read nowhere, and it contradicts the settled "no row means defaults" model. | Plan |
| Save granularity | Per rule | A per-rule payload always carries the rule's complete nested body, which is what makes the shallow merge unable to lose a bucket. | Plan |
| Override visibility | "Modified" badge + per-rule reset | The no-row model makes "modified" free to know; without it the lead cannot tell a tuned rule from a default one. | Plan |
| Row semantics | A row exists **iff** the rule differs from defaults | The store normalises a defaults-equal save into a delete, so one concept drives both the badge and Reset. | Plan |
| jsonb read guard | `mergeRule` re-parses the stored body | A validated write is not a validated column: without it, the first later slice that adds an SP bucket to the defaults silently loses it for every account that ever saved TICKET_STATUS_AGING. | Plan review F1 |
| Persistence idiom | `onConflictDoUpdate` on the existing unique constraint | `lessons.md` names "future settings/threshold sets" by hand as delete-then-insert territory. | Research |
| Defaults themselves | Numerically untouched | The demo fixture is tuned against them; a changed default empties the demo inbox with unit tests still green. | Research |

## Scope

**In scope:** the `DROP COLUMN` migration; the zod schema for all eight threshold
bodies; a settings reader reporting `isOverridden`; the owner-scoped store
(upsert / delete); the Server Action with best-effort D1 re-detect; the page,
client organism and its pure view sibling; tab registration; unit + integration
tests; the roadmap correction and manual-test documentation.

**Out of scope:** changing any default value; turning `"8_WORKING_DAYS"` into
tunable data; a severity filter on the inbox; re-tiering anomalies already
stored; the S-19 Settings-nav taxonomy; E2E tests.

## Architecture / Approach

`page.tsx` (`resolveWorkspace` → `getDb` → `readAnomalyRules`) hands eight
serialisable rule states to a client organism of eight independent
`react-hook-form` cards. Save calls a thin Server Action —
`resolveWorkspace` → zod → `getDb` → request-context-free store → typed
`{ ok } | ActionFailure` — which upserts on `(owner_id, anomaly_type)` and then
fires `detectAnomalies` post-commit in a `try/catch` using the **workspace**
clock. All UI judgement, copy and payload mapping lives in a pure `.ts` sibling,
because the project has no jsdom/RTL harness.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract layer | `DROP COLUMN is_default`; the zod schema; the settings reader; the resolver's first-ever tests | The schema must match what each detector actually reads — a mismatch is invisible until detection |
| 2. Write path | Store (upsert / normalise-to-delete) + Server Action + D1 re-detect; integration tests | Cross-account isolation is app-enforced only (no RLS); the owner predicate must be on every statement |
| 3. The surface | The tab, page, organism, pure view module and its tests | The SP-bucket card is the one place a partial payload could still silently disable In-Progress aging |
| 4. Closure | Roadmap D1 correction + status; `MANUAL-CHECKLIST.md`; backlog section | Leaving two versions of the truth about when a change takes effect |

**Prerequisites:** S-06 (defaults + resolver) and S-07/S-10 (the settings shell)
— all landed. Local Supabase running for `db:migrate` and the integration suite.

**Estimated effort:** ~2–3 sessions across 4 phases; Phase 3 is the largest.

## Open Risks & Assumptions

- The D1 re-detect adds `loadSprintSnapshot`'s five selects to every save. Per-rule
  saving means one re-detect per user action, but a lead tuning several rules pays
  it several times.
- Threshold numbers and severity are snapshotted into the `anomaly` row at
  detection time, so `RESOLVED` rows keep the old figures. Not a risk after all
  (plan review F2): `reader.ts:61` filters `status = ACTIVE` and the recap uses
  the same reader, so resolved rows render nowhere — and D1 refreshes every
  still-true row on save. No copy is spent on it.
- Severity can only ever move **down**: `SPRINT_AT_RISK` already defaults to
  `HIGH` and there is no tier above it.
- Allowing the tab in demo mode lets a visitor detune the fixture into an empty
  inbox; only "Reset demo data" recovers it.

## Success Criteria (Summary)

- The lead can re-tier severity and change a threshold for any of the eight
  rules from Settings, and see the inbox change without waiting for a sync.
- A rule that has been tuned is visibly distinguishable from one still on the
  defaults, and can be put back with one click.
- A malformed value is refused at the form, not discovered as a broken detection
  run — the state the codebase is in today.
