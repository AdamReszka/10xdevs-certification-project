<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-14 — Anomaly threshold + severity settings page

- **Plan**: `context/changes/anomaly-settings-page/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-29
- **Verdict**: REVISE → **SOUND** after triage (all 6 findings fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict (as reviewed) | After fixes |
|-----------|----------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

18/18 paths ✓, 10/11 code claims verified ✓ (1 contradicted — see F2), brief↔plan ✓,
Progress↔Phase format ✓ (one `## Progress`, 4/4 phases matched, no stray checkboxes).

Verified as claimed: `riskScore` propagates `NaN` through `Math.max(0, Math.min(1, NaN))`
into an `integer` column (`risk-score.ts:16-20`); `inProgressBudget` returns `null` for an
empty map (`ticket-status-aging.ts:30`); `anomalySettings` has exactly one reader in the
tree (`thresholds.ts`) and `isDefault` exactly zero; `detectAnomalies` returns
`skipped: no_sprint` rather than throwing (`detect.ts:48`); the demo fixture is generated
*by* detection (`demo/load.ts:129`), so the re-detect is idempotent against it and the
"no demo refusal" decision is safe; `roadmap.md:48` and `:380` are where the plan says;
Stryker's `mutate` globs (`stryker.conf.json`) do not reach `thresholds.ts`, so no mutation
gate is disturbed; the next migration is correctly `0018_*`.

## Findings

### F1 — The read side of the jsonb boundary is never guarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment (promise gap)
- **Location**: Current State Analysis + Overview vs. Phase 1 §3
- **Detail**: Current State Analysis names the defect as "zero runtime guards **on read**",
  the Overview promises "the only runtime validation the threshold bodies will ever have",
  and Critical Implementation Details says the schema checks "either side of it" — but no
  phase adds a read-side check. Phase 1 §3 states the opposite: `resolveEffectiveThresholds`'s
  "behaviour unchanged", and criterion 1.6 asserts `detect.ts` has no diff. Every success
  criterion can pass with the read path exactly as unguarded as today. The live trap: the
  shallow merge plus the schema's "exactly seven SP keys" rule means the first later slice
  that adds a bucket to `DEFAULT_THRESHOLDS` silently loses it for every account that ever
  saved `TICKET_STATUS_AGING` (the stored seven-key map *replaces* the new eight-key
  default), and the write schema would by then also reject the stored shape, so the lead
  cannot re-save out of it. That is `lessons.md` "a narrowing predicate turns 'wrong value'
  into 'empty result'", which the plan cites but applies only to the write.
- **Fix A ⭐ Recommended**: parse the stored override inside `mergeRule`
  - Strength: one place, already being touched in Phase 1 §3; `detect.ts` still has no diff.
    On failure the rule falls back to its defaults and logs which rule and why — lesson 40's
    obligation (a). Closes the future-default trap for free.
  - Tradeoff: one zod parse per rule per detection run; requires an explicit decision to fall
    back to defaults rather than to a partial merge.
  - Confidence: HIGH — `mergeRule` is being extracted anyway and has no server-only imports.
  - Blind spot: `readAnomalyRules` wants the same treatment so the form never seeds from a
    body it would refuse to save.
- **Fix B**: leave the read unguarded, correct the prose, document the trap.
  - Strength: zero code change.
  - Tradeoff: the trap stays armed and its cost lands on a different slice.
  - Confidence: MED.
- **Decision**: FIXED via Fix A — Phase 1 §3 rewritten ("Extract the merge, and guard the
  READ side of the jsonb boundary"), Phase 1 §5 test contract extended, new criterion 1.6
  ("A stored body that fails the schema degrades that rule to its defaults and logs"),
  Implementation Approach step 1 updated.

### F2 — Two of the three "load-bearing" copy sentences describe states the lead can never observe

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution (internal contradiction)
- **Location**: Critical Implementation Details; Phase 3 §3 copy (b) + (d)
- **Detail**: `listAnomaliesForSprint` filters `eq(anomaly.status, "ACTIVE")` (`reader.ts:61`),
  and `recap/build.ts:3` consumes the same reader — so RESOLVED anomalies render on no
  surface. Copy (d) warns about an invisible state. Copy (b) ("a re-tier reaches existing
  rows only on re-detection") is obsoleted by the plan's own D1 decision: the save
  re-detects, and `detect.ts:75-85` refreshes `severity` and `context` for every still-true
  row. Both sentences trace to `change.md`'s pre-plan finding, written before D1 was chosen;
  the plan adopted D1 and carried the caveat forward anyway.
- **Fix**: drop copy (d), rewrite (b) to the D1 fact, keep (a) (no tier above HIGH).
- **Decision**: FIXED — Critical Implementation Details rewritten, Phase 3 §3 now specifies
  two copy constants plus an explicit "deliberately NOT copy" note, and the "Not re-tiering
  anomalies already stored" scope bullet was brought into line.

### F3 — Eight independent `useForm` hooks, but only one component named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4 (+ Phase 1 §2)
- **Detail**: Phase 3 §4 says the editor "maps `RULE_DESCRIPTORS` … rendering one `Card` per
  rule" AND that "each card is its own react-hook-form form … with its own `useTransition`".
  Those cannot both hold in one component — hooks inside a `.map()` violate rules-of-hooks
  and `eslint-plugin-react-hooks` fails criterion 3.2. The repo has no precedent to copy:
  every multi-row form (`roster-editor.tsx:189-200`) is ONE `useForm` + `useFieldArray`,
  which the per-rule-save decision rules out. Second, eight per-card `zodResolver`s need the
  union MEMBERS individually; Phase 1 §2 specifies only the union.
- **Fix**: name a per-card child component (`AnomalyRuleCard`, same file) that owns
  `useForm`/`useTransition`; state in Phase 1 §2 that each member is exported by name.
- **Decision**: FIXED — Phase 3 §4 now opens with "Two components, not one"; Phase 1 §2
  requires per-member exports.

### F4 — The deep-equal that drives normalise-to-delete is unspecified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach + Phase 2 §1
- **Detail**: "A row exists iff the rule differs from its defaults" rests entirely on a
  deep-equal against `DEFAULT_THRESHOLDS[type]`, and the repo has no deep-equal utility and
  no dependency that supplies one (no lodash / dequal / fast-deep-equal). It must also
  compare a map declared with numeric keys (`defaults.ts:33`, `Record<number, …>`) against a
  parsed, string-keyed payload with `number | "8_WORKING_DAYS"` values.
- **Fix**: name the comparison — a pure `equalsDefaults(type, input)` in the view module,
  compared over sorted `Object.keys` — and test the numeric/string key form.
- **Decision**: FIXED — Phase 2 §1 now names `equalsDefaults` and its key-form requirement.

### F5 — The D1-proof row (3.8) has no stated precondition

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 Manual Verification 3.8; Phase 4 §2
- **Detail**: `detectAnomalies` returns `{status:"skipped", reason:"no_sprint"}` when
  `loadSprintSnapshot` finds nothing (`detect.ts:48`), and the action swallows the result.
  On an account without an active sprint the save toasts success and the inbox never
  changes — indistinguishable from the D1 wiring being broken. CLAUDE.md's manual-test
  convention requires "the account to use when it matters"; as written the row is
  unfalsifiable.
- **Fix**: name the demo workspace as the account, in 3.8 and in the MANUAL-CHECKLIST row.
- **Decision**: FIXED — 3.8 and Phase 4 §2 now name the demo workspace and say why.

### F6 — Citation drift on the form pattern

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4
- **Detail**: `recap-settings-form.tsx` is cited as the react-hook-form pattern, but it uses
  no react-hook-form at all — it is `useState` + manual validation through its pure sibling.
  Lines 53-79 are the right citation for the `useTransition`/toast/`router.refresh()` tail
  only. The genuine RHF+zodResolver precedents are `absence-editor.tsx:139-146` and
  `roster-editor.tsx:189-200` (the `useWatch` comment is at `:144-146`, not `:137-138`).
- **Fix**: re-point the citations; the pattern itself is the house standard (9 forms use it).
- **Decision**: FIXED — Phase 3 §4 citations corrected.
