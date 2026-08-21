<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Anomaly Detection Engine (S-06)

- **Plan**: context/changes/anomaly-detection-engine/plan.md
- **Scope**: Phases 1–4 of 4 (full plan; automated criteria complete, manual pending)
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Grounding

45 files changed across 5 commits (dc458cc, 323c1c5, bbdeb40, 0fbcece, 65f89a9), all in-plan
(anomaly module, sync wiring, schema/migration, defaults, link-ticket refactor, stryker config,
context docs). No unplanned files. Automated success criteria re-verified: tsc 0, lint 0,
unit 196 pass, integration 34 pass, build ✓, mutation 77.88% ≥ 70. Manual items (1.6, 2.5, 3.5,
4.6) unchecked — acknowledged pending (not rubber-stamped).

## Findings

### F1 — Detection insert is not concurrency-safe (can throw on the unique constraint)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/anomaly/detect.ts (insert branch of the reconcile loop)
- **Detail**: `detectAnomalies` has no concurrency lease (unlike `syncOwner`), and the insert
  branch is a plain `tx.insert(anomaly).values(...)` with no `onConflict`. If a cron detection
  and a `syncNow` detection run for the same (owner, sprint) concurrently, both can read the
  same stale existing-set and both attempt an INSERT for the same `dedup_key` → the new
  `anomaly_owner_sprint_dedup_uq` constraint raises, the transaction rolls back, and the
  detection run fails (cron swallows it; syncNow would surface it — see F2). The plan's
  Phase 3 contract explicitly specified `onConflictDoUpdate` as the idempotent-upsert path; the
  select-then-insert implementation gets the single-threaded semantics right but drops the
  race safety.
- **Fix**: Add `.onConflictDoUpdate({ target: [anomaly.ownerId, anomaly.sprintId, anomaly.dedupKey], set: mutable })` to the insert (leaving `detectedAt` out of the conflict `set` so a concurrent create keeps its clock). Restores the plan's stated upsert and makes overlapping runs converge instead of throw.
  - Strength: One-line-ish change; matches the plan intent and the idempotent-upsert pattern already used in run-sync.ts; the pre-loaded map still drives the common path so detectedAt semantics are unchanged.
  - Tradeoff: None significant — the conflict branch only fires under a genuine race.
  - Confidence: HIGH — the unique constraint + missing lease make the race concrete.
  - Blind spot: Doesn't add a lease; two runs still do redundant work, just without failing.
- **Decision**: FIXED — added `onConflictDoUpdate` (target the unique key, `set: mutable`, detectedAt excluded) to the detect.ts insert.

### F2 — `syncNow` does not isolate a detection failure from the sync result

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/integrations/sync/actions.ts (detectAnomalies call)
- **Detail**: In `syncNow`, `await detectAnomalies(...)` sits in the same `try` as `syncOwner`;
  a detection throw rejects the whole Server Action even though credentials were saved and the
  sync completed. The just-finished-setup UI would show an error for a best-effort background
  step. The cron loop (`scheduled.ts`) already isolates detection per owner; `syncNow` should
  match that (detection is best-effort, not part of the user's sync contract).
- **Fix**: Wrap the `detectAnomalies` call in `syncNow` in its own try/catch — log and swallow — so the sync `IntegrationOutcome` still returns.
- **Decision**: FIXED — wrapped the syncNow detection call in try/catch (log + swallow).

### F3 — Snapshot loads all owner PRs/reviews unbounded

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/lib/anomaly/load-snapshot.ts (PR + review selects)
- **Detail**: The loader selects every PR and every review for the owner with no state/recency
  bound. The PR-rules only need OPEN PRs or PRs merged after sprint start, so closed/ancient PRs
  are loaded and discarded. Harmless at the 3–10-person MVP scale (sync only stores what it
  fetches), but the set grows across sprints.
- **Fix**: Optionally scope the PR select (e.g. `state = OPEN` OR `merged_at >= sprint start`) when this becomes a hotspot. No action needed now.
- **Decision**: SKIPPED — observation only; acceptable at MVP scale, revisit if the PR set grows.
