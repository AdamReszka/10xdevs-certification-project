<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Refinement Helper (S-13 / FR-020, FR-021)

- **Plan**: `context/changes/refinement-helper-ai/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-26
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) |
|-----------|---------------------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

7/7 paths ✓, 7/7 symbols ✓, brief↔plan ✓

## Findings

### F1 — The run has no time budget, and the cost model contradicts the model config

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH
- **Dimension**: Blind Spots
- **Location**: Performance Considerations × Phase 1 §2 × Phase 6 §2
- **Detail**: Performance Considerations sized a 40-ticket run at ~$0.66 "inside the default 5-minute cache TTL" — that needs ≤7.5s/ticket. Phase 1 pinned `claude-sonnet-5` at `effort: "high"` and never mentioned `thinking`; on Sonnet 5 adaptive thinking is the only on-mode and runs when omitted, thinking tokens bill as output and draw from `max_tokens: 8000`. So 700 output tokens, $0.66 and 7.5s/ticket were all floors, a hard-thinking ticket could hit the cap and return `stop_reason: "max_tokens"` (surfacing as a misleading schema failure), and the whole run sat in one Workers request holding a request-scoped Hyperdrive pool. "A per-run ticket cap" appeared three times with no value.
- **Decision**: FIXED via Fix A — cap derived from measured p95 latency in Phase 4 (new criteria 4.8, 4.9); explicit `thinking: {type: "adaptive"}`, `effort: "medium"`, `max_tokens: 16000`, new `AnthropicTruncatedError` raised before parsing; Performance Considerations rewritten around the wall-clock constraint, with the off-request-path alternative recorded as a follow-up slice.

### F2 — Phase 5's grep criterion can never pass, and misses what actually breaks tsc

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §1 + criterion 5.4
- **Detail**: (a) `grep -r "refinement_session\|RefinementSession" src/` returns nothing was unachievable — `0001_lying_human_cannonball.sql:195,294,316` and the drizzle meta snapshots hold the string permanently, and `0010_*.sql` will contain `DROP TABLE "refinement_session"`. (b) The same pattern missed the two live references Phase 5 §1 omitted: `schema.ts:853` `refinementSessions: many(refinementSession)` in `userRelations`, and `schema.ts:1109-1117` `refinementSessionRelations` (lowercase initial — never matched by the capitalised pattern). Dropping the table without both fails `tsc` while 5.4 goes green.
- **Decision**: FIXED — all four call sites enumerated in Phase 5 §1; criterion rewritten to `grep -rn "refinementSession" src --include='*.ts' | grep -v migrations`.

### F3 — Four manual criteria and the corpus eval had no TypeScript runner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §4, Phase 1 and Phase 2 Manual Verification
- **Detail**: `scripts/` holds one `.mjs` under bare `node`; no `tsx`/`ts-node` in devDependencies; Node 24 strips types but does not resolve the `@/*` alias every `src/` module imports through, and plain `node` does not load `.env.local`. Criteria 1.5, 1.6, 2.4, 2.5 and `npm run eval:refinement` all rested on a runner no phase provisioned.
- **Decision**: FIXED via Fix A — new Phase 1 §4 adds `vitest.eval.config.ts` (third Vitest project, `include: ["scripts/**/*.eval.ts"]`, reusing the `@` alias and the `.env.local` loading `test/integration/setup.ts` already performs) plus `scripts/anthropic-smoke.eval.ts`; Phase 2 gets `scripts/jira-refinement.eval.ts`; Phase 4's script becomes `scripts/refinement-corpus.eval.ts`. `npm test` stays hermetic (asserted by 1.3).

### F4 — ANTHROPIC_API_KEY was never provisioned anywhere the deploy can see it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2, Phase 6 §5
- **Detail**: `wrangler.jsonc` carries an explicit comment enumerating which values must be Workers *secrets* (plain vars resolve to `null` in `getCloudflareContext().env` on this OpenNext version), and `.env.example` repeats it per integration. No phase added the AI key to either — `lessons.md` #7's shape: green suite, first post-deploy request cannot run.
- **Decision**: FIXED — Phase 6 §5 becomes "Documentation and provisioning" covering `wrangler secret put ANTHROPIC_API_KEY`, the wrangler.jsonc comment and a new `.env.example` section; criterion 6.10 added.

### F5 — The gate's drop count was visible in tests but not to the lead

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details, Phase 4 §2, Phase 5 §1
- **Detail**: The plan mitigated half of the narrowing-predicate risk (store + display `task_kind`). `lessons.md`'s rule has a second obligation — record *which* predicate produced the empty set. Dropped out-of-kind gaps were counted only "so it is visible in tests", so a ticket misclassified as `BUG` whose four gaps the gate discarded reaches the lead as a clean `DOR_MET`.
- **Decision**: FIXED via Fix A — `droppedClasses` carried on the verdict (Phase 4), persisted as `dropped_classes` jsonb (Phase 5), rendered next to the task kind when non-empty (Phase 6); Critical Implementation Details rewritten as two explicit halves.

### F6 — Two of FR-020's three inputs had transport and an enum value but no surface

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: End-State Alignment
- **Location**: Overview × Phase 5 §1 × Phase 6 §2
- **Detail**: FR-020 lists backlog, ticket key and pasted text. Phase 5 provisioned `refinementSource` as `BACKLOG | KEYS | PASTED_TEXT`, but Phase 6 rendered only the backlog picker and validated keys against the fetched set — i.e. against the backlog. `PASTED_TEXT` was a stored enum value with no producer: the shape `frame.md` was written to close at `dor_score`.
- **Decision**: FIXED — build all three. Phase 3 gains `src/lib/refinement/pasted.ts` (`parsePastedTicket`, empty-input raise, "attachment state unknown ≠ absent" so a paste doesn't trip every absence-based P2 class); Phase 6 §2 renders all three inputs and dispatches on source; criteria 3.5, 6.11, 6.12 added; Desired End State restated.

### F7 — MANUAL-CHECKLIST row 6.5 pointed at the wrong Progress row

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: `MANUAL-CHECKLIST.md`
- **Detail**: Checklist 6.5 ("braki nazywają coś z tego konkretnego ticketu") is plan Progress **6.6**; plan 6.5 is "A run produces one row per ticket with task kind and verdict". The checklist tells the user to tick the matching plan row and calls plan.md canonical, so the off-by-one ticks a criterion nobody verified.
- **Decision**: FIXED — row renumbered to 6.6, the header's account note updated to match, and row 1.6's runner named concretely.

### F8 — run-view.ts broke the "sibling" precedent it cited

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Phase 6 §3
- **Detail**: All three existing extracted-logic modules sit beside their components (`organisms/anomaly/inbox-controls.ts`, `organisms/settings/absence-calendar-view.ts`, `organisms/setup/roster-merge.ts`). The plan placed `run-view.ts` in `src/lib/refinement/` and called it a sibling.
- **Decision**: FIXED — moved to `src/components/organisms/refinement/run-view.ts`.
