<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-15 Team Management Surface

- **Plan**: `context/changes/team-management-surface/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-23
- **Verdict**: REVISE → SOUND (all 7 findings fixed in triage)
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After triage |
|-----------|---------|--------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

10/10 paths ✓, 8/8 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓
(6/6 phases, 39 → 43 items, none stray outside `## Progress`).

Verified against code: FK actions (`0001_lying_human_cannonball.sql:269,273`),
`saveRoster` delete-then-insert (`roster-store.ts:274-292`), zero coverage of
`saveRoster`, `isActive` read paths with no writer, `onboarding.ts` counting all
members, tabbed settings shell without active styling, absence of any dialog
primitive, `radix-ui ^1.4.3` present. All confirmed as the plan describes.

## Findings

### F1 — Phases 1–3 ship a save that silently ignores every removal

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 ↔ Phase 4 §3
- **Detail**: Phase 1 makes the bulk save upsert-only, but the editor's only removal paths stay client-side until Phase 4 — `remove(index)` on the trash (`roster-editor.tsx:357`) and `remove(drop)` in `mergeSelected` (`:175`). Both worked only because save was delete-then-insert. After Phase 1, deleting shows the success toast and the member is still there on refresh; merging two persisted rows duplicates the person. Live across three manual-confirmation pause points, and named in neither Migration Notes entry.
- **Fix A ⭐ Recommended**: Move Phase 4 §3 (row actions) into Phase 2, directly behind the services it calls.
  - Strength: `setMemberActiveAction` / `deleteMemberAction` / `mergeMembersAction` all exist by end of Phase 2; Phase 4 keeps the primitive, the Status column and the name fix — still a coherent phase.
  - Tradeoff: Row actions land before `ConfirmDialog`, so they need an interim `window.confirm`.
  - Confidence: HIGH — dependency order verifiable from the plan's own contracts.
  - Blind spot: Whether an interim confirm is acceptable vs. moving alert-dialog into Phase 2 too.
- **Fix B**: Disable trash/merge for persisted rows in Phase 1, re-enable in Phase 4.
  - Strength: Smallest edit; wizard first-run flow (all rows unsaved) unaffected.
  - Tradeoff: Roster partly read-only for three phases.
  - Confidence: HIGH — matches the plan's own unsaved-vs-persisted split.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — new Phase 2 §6 "Rewire the editor's removal paths"; Phase 4 §3 became "Swap the interim confirms for the dialog" with a `grep window.confirm` gate; Progress gained 2.8–2.9 and 4.2.

### F2 — Phase 1 breaks actions.integration.test.ts; no phase owns it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Changes Required / Success Criteria
- **Detail**: `src/app/(app)/setup/team/actions.integration.test.ts:210-231` calls `importRosterAction()` (still persists 4 members at Phase 1 — import isn't defanged until Phase 3), then `saveRosterAction()` with a 2-member id-less payload, then asserts `expect(rows).toHaveLength(2)`. Under the upsert save the 4 imported rows survive → 6 rows → red. The plan named only `roster-store.integration.test.ts`, and Phase 1's Automated Verification never ran the full suite — that gate appeared only in Phase 5.
- **Fix**: Name the file in Phase 1's Changes Required, re-express the assertion against post-upsert reality (preserving the `source === "BOTH"` and the two token-leak assertions), and add a full-suite green gate to Phase 1.
- **Decision**: FIXED — new Phase 1 §5, plus `npm test && npm run test:integration` in Phase 1's criteria and Progress 1.5.

### F3 — "Extract a shared reader into src/lib/roster.ts" — the file is occupied

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 5 §2
- **Detail**: `src/lib/roster.ts:28` already exports `listRoster(db, ownerId)` — the S-07 reader used by `dashboard/page.tsx:58` and `dashboard/sprint-detail/page.tsx:69`, asserted by `dashboard-readers.integration.test.ts:194-232`. Its projection is narrower than the editor's: `isActive` but neither `spCapacity` nor `source`, both required by `ClientMember`. So this is a widening or a second reader, not an extraction — and the plan did not decide which.
- **Fix A ⭐ Recommended**: Add `listRosterForEditor` beside `listRoster`; both editor pages use it.
  - Strength: Zero blast radius on the dashboards and their test; the two editor mounts still cannot drift, which is the goal.
  - Tradeoff: Two readers over one table in one file — needs a why-comment.
  - Confidence: HIGH — both projections read directly.
  - Blind spot: None significant.
- **Fix B**: Widen `listRoster` to the superset.
  - Strength: One reader, no drift anywhere.
  - Tradeoff: Touches both dashboards and `dashboard-readers.integration.test.ts`; ships two unused columns.
  - Confidence: MEDIUM.
  - Blind spot: Whether the test asserts exact object shape.
- **Decision**: FIXED via Fix A — Phase 5 §2 now states the reader is a NEW export, names the existing consumers, and forbids widening.

### F4 — mergeSelected keeps the wrong id when B has the lower index

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §5 (and Phase 2 §4, §6)
- **Detail**: `merged.id = a.id` (`roster-editor.tsx:164`) where `a = values[idxA]`, but keep/drop are picked by index (`:173`). When `idxB < idxA`, the surviving row is written with `a`'s id while `b`'s row is dropped from the grid. Harmless under delete-then-insert; from Phase 1 on, the save updates `a.id`'s row and leaves `b.id`'s row in the DB — the merge duplicates the person. Phase 4 §5 rewrites the *name* selection in this exact function and `roster-merge.test.ts` was specified to cover "identity keys union in both orders" — but never the id.
- **Fix**: Extract id selection with name selection — the surviving id is the KEPT row's id — test both selection orders, and make Phase 2's `mergeMembers` (`keepId`/`dropId`) agree.
- **Decision**: FIXED — Phase 4 §5 rewritten to cover both defects; Phase 2 §4 and §6 pin the `keepId` contract; Progress 4.1 updated.

### F5 — The preview badges have nowhere to live

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3
- **Detail**: Phase 3 renders `proposed` / `upstreamMissing` badges via `replace(result.members.map(toFormMember))`, but `toFormMember` (`:65-75`) projects down to `rosterMemberSchema`, which has neither field — the same reason `source` is already dropped and `originLabel` re-derives origin from watched keys. The flags would vanish into the field array.
- **Fix**: Hold them in component state set alongside `replace()`, mirroring `degradedReason`; key by member id (persisted) or lowercased identity key (proposed), never by array index.
- **Decision**: FIXED — Phase 3 §3 gained a "Where the flags live" contract.

### F6 — saveRoster has one call site, not two

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 Contract
- **Detail**: "update the two call sites" — there is exactly one, `actions.ts:151`, and it discards the result entirely. The second referent was the test file, now owned by F2's fix.
- **Fix**: Say one call site, which discards the return.
- **Decision**: FIXED.

### F7 — Phase 4 skips the project's shadcn MCP lookup rule

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1
- **Detail**: CLAUDE.md requires an `@shadcn` MCP lookup before implementing any UI surface; Phase 4 went straight to `npx shadcn add alert-dialog`. The choice is right (`radix-ui ^1.4.3`, package.json:35 — no new dependency), but the step was unstated.
- **Fix**: Add the MCP confirmation ahead of the add command.
- **Decision**: FIXED.
