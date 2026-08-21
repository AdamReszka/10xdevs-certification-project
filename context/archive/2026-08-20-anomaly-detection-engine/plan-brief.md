# Anomaly Detection Engine (S-06) — Plan Brief

> Full plan: `context/changes/anomaly-detection-engine/plan.md`

## What & Why

Build the engine that detects all 8 SprintFlow anomaly types by correlating the
already-synced Jira workflow state with GitHub developer activity, ranks each by a
severity-weighted sprint-risk score, and attaches a one-line suggested action. This is the
load-bearing slice on the north-star path — S-07's Dashboard "Today" only has something to
show because this engine produces it.

## Starting Point

S-05 already synced the correlated inputs and F-02 already defined the outputs: PR↔ticket
linkage is a populated column (`github_pull_request.linked_ticket_key`), FR-009 defaults are
a typed constant (`src/db/defaults.ts`), and the `anomaly`/`anomaly_settings` tables exist
(empty — S-06 is their first writer). What's missing is the detection logic itself.

## Desired End State

Each sync cycle (cron or on-demand) produces up-to-date `anomaly` rows for an owner's active
sprint: newly-true conditions inserted, still-true ones untouched (stable `detectedAt`),
cleared ones flipped to RESOLVED. Every ACTIVE anomaly has all five FR-014 attributes + a
0–100 risk score, and `listAnomaliesForSprint` returns them in FR-015 default order
(severity → recency).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Detection placement | Separate `detectAnomalies` module, run after `syncOwner` from cron + `syncNow` | Mirrors the pure-injectable sync pattern; independently testable; runs on cached data even when a sync cycle errors | Plan |
| Re-detection lifecycle | Upsert by stable `dedup_key` + ACTIVE/RESOLVED, `detectedAt` fixed on first sight | Keeps FR-015 recency ordering meaningful and anomaly ids stable for S-11/S-12 | Plan |
| commit→ticket correlation | Parse commit `message` for `{KEY}-{n}` (branch is NULL by design) | Uses data actually persisted; one shared extractor with the PR link path | Plan |
| Risk-score formula | `severityWeight × magnitude`, normalized 0–100 | "Severity-weighted" per FR-015; magnitude differentiates same-severity anomalies | Plan |
| `SPRINT_AT_RISK` shape | One anomaly per triggering condition (flow-framed, not per-dev) | User choice; guardrail kept via flow-phrased descriptions + member id used only for the action | Plan |
| Thresholds/severity | Read `DEFAULT_THRESHOLDS`; merge stored overrides; no seeding | Single source of truth; no stale-seed drift; S-14 writes rows lazily on override | Plan |
| Read surface | `listAnomaliesForSprint` with default order only | S-06 owns default ordering; interactive sort/filter is S-07 | Plan |
| Suggested action | Static per-rule template + context interpolation | FR-014 grounded + deterministic; no AI (PRD confines AI to Refinement Helper) | Plan |
| Testing | Unit pos+neg per rule + integration lifecycle + Stryker mutation on detectors | Roadmap risk note: a rule that never fires / fires on healthy data isn't caught by the build | Plan |
| Degradation | Detect on best-available cache; skip only when no active sprint | PRD graceful-degradation guardrail (never blank the inbox on an outage) | Plan |

## Scope

**In scope:** 8 pure detectors; risk-score; suggested-action templates; effective-threshold
resolver (defaults ⊕ overrides); sprint-snapshot loader; detect+reconcile orchestrator; a
`dedup_key` migration; wiring into cron + `syncNow`; a default-ordered inbox reader; unit +
integration + mutation tests.

**Out of scope:** inbox UI / panels / error banner (S-07); interactive re-sort/filter (S-07);
absence suppression + `SPRINT_AT_RISK` absence weight (S-08); settings-page editing UI (S-14);
daily-recap email (S-11); AI anywhere in detection.

## Architecture / Approach

New `src/lib/anomaly/` module mirroring `src/lib/integrations/sync/`: pure detectors
(`rules/*.ts`) over an in-memory `SprintSnapshot`, a central `detect.ts` orchestrator that
resolves thresholds, loads the snapshot, runs the rules, applies severity + risk score, and
reconciles into the `anomaly` table by `dedup_key`. Two entry points (`runScheduledSync`,
`syncNow`) call `detectAnomalies` right after `syncOwner`. A `reader.ts` returns the
default-ordered inbox.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations | `dedup_key` migration + unique index; threshold resolver; generalized key extractor; shared types | Nullable dedup key would silently defeat idempotency (lessons #1) |
| 2. Detectors | 8 pure rules + risk-score + suggested-action templates | A rule that never fires / fires on healthy data — caught only by pos+neg + mutation tests |
| 3. Orchestration | Snapshot loader + detect/reconcile + cron/`syncNow` wiring | `detectedAt`/`id` stability across re-runs; not aborting the cron loop on a detection throw |
| 4. Reader + verify | `listAnomaliesForSprint` (default order) + end-to-end integration | Ordering correctness; ACTIVE-only filtering |

**Prerequisites:** S-05 (done), F-02 (done). Local Supabase for migration + integration tests.
**Estimated effort:** ~3–4 sessions across the 4 phases (Phase 2 is the largest).

## Open Risks & Assumptions

- `TICKET_NO_COMMIT_LINK` / commit correlation depends on the team putting the Jira key in
  commit messages (branch labels aren't synced). False positives for teams that don't —
  acceptable for MVP, tunable via thresholds later.
- PRs have no sprint FK; PR-only anomalies (stalled/too-big) are attributed to the active
  sprint being detected (satisfies `anomaly.sprint_id NOT NULL`). Correct since the inbox is
  sprint-scoped, but it means a PR anomaly is nominally tied to a sprint it may not touch.
- Absence = empty this slice; `DEVELOPER_INACTIVE` has no suppression until S-08.
- Detectors take an `absences: []` input now so S-08 wires suppression without reshaping them.

## Success Criteria (Summary)

- For a seeded mixed sprint, a sync produces ≥4 distinct anomaly types, each with all five
  FR-014 attributes + a risk score, in severity → recency order.
- Re-running detection on unchanged data is a no-op (stable `detectedAt`/`id`); clearing a
  condition resolves exactly that anomaly.
- Green unit suite (positive + negative per rule), passing mutation run on detectors, and a
  passing reconcile-lifecycle integration test against real Postgres.
