<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cadence Override Retention (S-30)

- **Plan**: `context/changes/cadence-override-retention/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND after triage (all 9 findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

16/16 paths ✓, 9/9 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md`
absent → surface check skipped. `0023` is the next migration number;
`normalizeWorkspaceUrl` is at `src/lib/jira.ts:168`, matching the plan's citation.
Every code claim spot-checked held, including the subtle ones: `getSprintCapacity`
delegating to `getSprintCapacityFor`, the four write-nothing Jira outcomes preceding
the transaction, `no_sprint`'s other producers, and the `integration-card-copy.ts:184`
coupling.

## Findings

### F1 — Delete-on-source-equal and inheritance cannot coexist

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: End-State Alignment / Architectural Fitness
- **Location**: precedence tiers 1–2; Phase 1 `writeCadenceOverride`; Phase 3 §1–2
- **Detail**: Three stated rules are jointly unsatisfiable — whole-record tier-2
  inheritance, DELETE when all three fields are NULL, and "a field equal to its
  source is stored as NULL". A lead on Mon–Thu at sprint N who saves Mon–Fri at
  N+1 writes three source-equal fields → row deleted → no record for N+1 → tier 2
  returns Mon–Thu. The save is silently reverted, which is the failure mode the
  slice exists to end. Restore has the same hole: clearing `["lengthDays",
  "startDay"]` on a sprint with no row of its own is a no-op, so an inherited
  length survives "Restore Jira's values". It also silently drops the guarantee
  `reconcile-sprint.ts:314-317` holds on purpose ("a restore that races a rollover
  must not resurrect the override it was asked to drop"). `anomaly_settings` is a
  safe precedent only because it has no inheritance tier.
- **Fix A ⭐ Applied**: Row existence means "the lead has spoken for THIS sprint";
  no write path deletes. A three-NULL row is the meaningful state "follow the
  source, do not inherit". `clearCadenceOverrideFields` creates the row when
  absent and materialises the currently-resolved value for fields it is not
  clearing.
- **Decision**: FIXED (Fix A) — precedence block, Phase 1 §3, Phase 3 §1, Phase 4
  §1, criterion 3.5, Testing Strategy, plus the `plan-brief.md` decision row.

### F2 — The reader guard cannot pass in Phase 2, and never passes at all

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5 + criterion 2.3
- **Detail**: Seven non-test files carry `cadenceOverridden` today; Phase 3 removes
  six, and `src/lib/anomaly/test-support.ts:42` can never drop it (it builds a
  `SelectSprint` literal whose column stays NOT NULL). `cadence-editor.tsx:61,87,96`
  and `setup/cadence-form.tsx:76` were in no phase at all. Criterion 2.3 was
  therefore unachievable, and the guard never went green even at Phase 6.
- **Fix ⭐ Applied**: Guard moves to Phase 5 §6; `test-support.ts` joins the
  allowlist permanently with the reason stated; criteria 2.3 and 5.2 swapped.
- **Decision**: FIXED

### F3 — `saveCadence`'s return-type change has four unnamed consumers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 and §3
- **Detail**: The `{ overridden }` boolean travels through
  `setup/team/actions.ts:419,470`, `cadence-editor.tsx:61,87,96,115-124,198-208`
  and `setup/cadence-form.tsx:76`. Notably `:120-122` is a deliberate STICKY OR so
  a confirming save cannot un-override an account, and the post-save banner has
  exactly two sentences where the new mixed state needs a third.
- **Fix ⭐ Applied**: All four named in Phase 3 §3 with the per-field merge and the
  third banner sentence specified.
- **Decision**: FIXED

### F4 — The guard catches one of three spellings in the repo

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: the guard's identifier list (now Phase 5 §6)
- **Detail**: A case-sensitive scan for `sprint.workingDays` misses
  `activeSprint.workingDays` (`setup/team/page.tsx:76`, `team/cadence/page.tsx:53`)
  and `row.workingDays` (`roster-store.ts:985`) — and `db.select().from(sprint)`
  then `.workingDays` is precisely the future reader the guard exists to stop.
- **Fix ⭐ Applied**: Scan for bare `.workingDays` in any file that also references
  the `sprint` table or `SelectSprint`; the scan's blind spot goes in the failure
  message.
- **Decision**: FIXED

### F5 — The Phase 6 E2E spec has no sprint row to act on

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §1
- **Detail**: `e2e/accounts.ts:109-111` says "Deliberately NOT seeded: sprint,
  tickets, commits" — the opposite of the licence the plan read into it. With no
  sprint row, `/team/cadence` renders `no_sprint`, restore is `disabled`, and
  `saveCadence` throws `NoSprintRowError`. Restore additionally needs a live Jira
  call, and `e2e/jira-fixture-server.mjs` serves only `myself`, `project/search`
  and `project/{id}/statuses` — no agile endpoints, so `listBoards` 404s and the
  reconcile returns `no_board`.
- **Fix A ⭐ Applied**: Spec walks `/setup/jira` against the fixture to mint a real
  sprint row; Phase 6 explicitly budgets adding `/rest/agile/1.0/board` and
  `/board/{id}/sprint` to the fixture, serving a sprint whose derived length and
  start day differ from what the spec sets by hand.
- **Decision**: FIXED (Fix A)

### F6 — Criterion 1.6 cannot test the migration's backfill

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1, criterion 1.6
- **Detail**: `db:migrate` runs before the integration suite, so `0023`'s
  INSERT…SELECT has already executed against an empty table and never sees a row
  the test seeds afterwards.
- **Fix A ⭐ Applied**: The backfill becomes an exported re-runnable statement
  (`BACKFILL_CADENCE_OVERRIDES`) that the migration and the test both execute;
  `ON CONFLICT DO NOTHING` becomes load-bearing rather than defensive.
- **Decision**: FIXED (Fix A)

### F7 — Nobody computes `cadenceSource` inside the reconcile

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §3
- **Fix ⭐ Applied**: One `resolveCadenceFor` inside the existing transaction,
  against the returned row and AFTER the clear; a diagnostic that must not be able
  to roll the write back.
- **Decision**: FIXED

### F8 — `start_date` nullability undeclared on both sides

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 and §3
- **Fix ⭐ Applied**: Column declared NOT NULL (it is tier 2's ordering key); the
  resolver skips tier 2 outright for an undated `sprint` row rather than relying on
  SQL three-valued logic.
- **Decision**: FIXED

### F9 — The backfill writes rows asserting a choice nobody made

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2
- **Fix ⭐ Applied**: Each backfilled field is written NULL when it equals the
  derived source, holding the same invariant as every other write path.
- **Decision**: FIXED
