<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Disconnect Data Retention (S-26)

- **Plan**: `context/changes/disconnect-data-retention/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

21/21 paths ✓, 7/7 symbols ✓, brief↔plan ✓, Progress↔Phase ✓.
Verified: `absence.sprintId` cascade + already nullable (`schema.ts:642-644`);
`monitoredRepo.credentialId` `.notNull()` + cascade (`schema.ts:298-300`);
constraint name `absence_sprint_id_sprint_id_fk` (`0001:270`);
`sprint_measurement.committedFrozenAt` exists (`schema.ts:519`) and
`unique("sprint_measurement_owner_sprint_uq").on(ownerId, jiraSprintId)`
(`schema.ts:533`); `deriveImpact` cascade/set-null split
(`disconnect-impact.test.ts:61-91`); demo refusal regex
(`boundary-inventory.test.ts:49`); reconcile (`run-sync.ts:685`) runs before the
freeze (`run-sync.ts:907`), so Phase 5's "verify rather than change" holds;
all four disconnect call sites are the four the plan lists.

## Findings

### F1 — The GitHub "keep" is undone by the only reconnect path

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Current State Analysis (bullet 3) → Phase 1 §1, Phase 2 §1
- **Detail**: The plan's rationale for keeping the whole GitHub subtree is that "commits, PRs and reviews hang off the internal `monitored_repo.id`, which survives with it". True of the FK change, false of the next action the lead takes. `storeGithubIntegration` (`github-store.ts:157-166`) reconnects with delete-then-insert (`tx.delete(monitoredRepo).where(eq(ownerId))` then insert with `randomUUID()`), so fresh ids cascade away every `github_commit` / `github_pull_request` (and reviews with the PRs). After a disconnect the credential row is gone, so the wizard IS the reconnect path — keep-then-reconnect lands on exactly today's outcome, minus the honest warning. The repo already documents this hazard verbatim at `connection-service.ts:297-304` and fixed it for the settings path (impl-review F1); `lessons.md:35-40` states the rule and its corollary (b).
- **Fix A ⭐ Recommended**: Add a Phase-2 step converting `storeGithubIntegration`'s repo write to the differential upsert `connection-service.ts:305-331` already runs (`onConflictDoUpdate` on `monitored_repo_owner_repo_uq` + delete only the deselected).
  - Strength: Makes the GitHub keep real; reuses a shape this repo already reasoned through and shipped; no new pattern; the unique constraint the plan leans on becomes load-bearing in fact.
  - Tradeoff: Widens Phase 2 and needs its own integration case (a commit survives disconnect→reconnect, not just disconnect).
  - Confidence: HIGH — the target shape exists 40 lines away with its own comment explaining why.
  - Blind spot: Whether a rotated token still sees the same repo ids (it should — `github_repo_id` is GitHub-side) is untested.
- **Fix B**: Drop the GitHub half of the schema change; ship the Jira half alone and roadmap GitHub symmetry.
  - Strength: Smallest slice that is fully true; refuses to ship copy the system cannot honour.
  - Tradeoff: Asymmetric dialog; reverses the frame's "full symmetry" decision; nullable `credential_id` and its migration go away.
  - Confidence: MED — clean, but the frame argued symmetry deliberately.
  - Blind spot: How the copy explains why GitHub has one button and Jira two.
- **Decision**: FIXED via Fix A — Phase 2 §2 added (differential upsert in `storeGithubIntegration`); Current State bullet 3 corrected; Phase 2 §4 gained the disconnect→reconnect case; Progress 2.6 added.

### F2 — Phase 1 declares three assertions safe that the change falsifies

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4
- **Detail**: "`deriveImpact` and the equality assertions (`:103-153`) stay as written" is wrong three times. (1) `disconnect-impact.test.ts:145-153` asserts `jira.weakenedTables` `toEqual([{ table: "daily_recap", column: "sprint_id" }])` — exact array equality, and `absence` joins the list; it sits inside the frozen range. (2) `:159-160` asserts `impact.destroys.length > 0` for EVERY key, and the plan empties `github.destroys` by moving both clauses to `clears`. (3) `:174-178` asserts `jira.destroys` contains "absences" and `/cannot be synced back/`; the plan moves that clause to `clears` (Phase 3 §4 schedules the identically-worded fix in `disconnect-confirm-copy.test.ts`, but not here).
- **Fix**: Name all three in Phase 1 §4, and restate the "names both" invariant as `destroys.length + clears.length > 0` so it keeps guarding the GitHub entry instead of being deleted.
- **Decision**: FIXED — Phase 1 §4 now enumerates all five hand-written assertions and restates the "names both" invariant as `destroys.length + clears.length > 0`.

### F3 — `mode` is an unvalidated Server Action argument

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2
- **Detail**: `disconnectJira` / `disconnectGithub` take no arguments today (`jira/actions.ts:300`, `github/actions.ts:211`). The plan gives them one and says only "thread the mode from the client without disturbing the demo refusal". A Server Action argument is a public HTTP parameter; the union type is erased at runtime, so a crafted post — or a future caller passing `undefined` — reaches the destructive branch. The plan is careful about the demo boundary and the IDOR guard on these same two functions and silent about this.
- **Fix**: Validate server-side and fail toward safety — anything that is not exactly `"clear"` resolves to `"keep"`. Put the schema beside the existing ones in `src/lib/validations/`, and assert the coercion in both `actions.integration.test.ts` (undefined → keep; garbage → keep).
  - Strength: The safe default is also the plan's stated UX default, so guard and design agree.
  - Tradeoff: One more validation module for a two-member union.
  - Confidence: HIGH — the failure mode is permanent data loss on the path the slice exists to make reversible.
  - Blind spot: Whether all four call sites can supply the mode synchronously is untraced past the type change.
- **Decision**: FIXED — Phase 2 §3 requires server-side validation resolving anything that is not exactly `"clear"` to `"keep"`, with two coercion cases in §4.

### F4 — `clearedTables` is a hand-maintained list in the module that exists to end them

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §3, Phase 2 §1
- **Detail**: `disconnect-impact.ts:11-16` states its own premise: the copy is not hand-maintained, a test derives the table sets from `getTableConfig` over the real schema, so a future slice that hangs a cascading child under `sprint` or `monitored_repo` fails the build. `clearedTables` is added as a plain literal with no derivation. Phase 2 states the contract ("the tables each `clear` branch deletes must equal `DISCONNECT_IMPACT[key].clearedTables`") but names no mechanism holding it — only prose plus hand-written integration assertions. That is the second-hand-written-answer shape S-24 removed, reintroduced exactly where the FK change makes new orphan children possible.
- **Fix**: Derive it in the guard test. For every `weakenedTables` entry, `clearedTables` must equal ⋃ ({table} ∪ `deriveImpact(table).destroyed`). A child hung under `absence` or `monitored_repo` by a later slice then fails the build instead of being silently left behind by `clear`.
  - Strength: Restores the module's invariant; ~10 lines in a test that already walks the graph.
  - Tradeoff: Couples `clear`'s definition to the schema rather than to product judgment — a table deliberately spared would need an explicit exception list.
  - Confidence: HIGH — `deriveImpact` already returns exactly this closure.
  - Blind spot: None significant.
- **Decision**: FIXED — `clearedTables` is now specified as derived; Phase 1 §4 adds the guard asserting it equals the closure of the weakened children.

### F5 — The manual checklist is written in Phase 6, after three phases have used it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §4 vs. Progress 1.7, 3.6–3.8, 4.6–4.7
- **Detail**: `MANUAL-CHECKLIST.md` does not exist yet and Phase 6 §4 creates it, with "Row 1 applies migration 0021 … and must precede every row that reads the changed schema". But Phase 1's manual row 1.7 IS that migration row, and Phases 3 and 4 add five manual rows reading the changed schema — all before the file exists. `lessons.md:56-60`'s rule cannot be satisfied by a checklist written last.
- **Fix**: Create `MANUAL-CHECKLIST.md` in Phase 1 with the migration row, appending each phase's rows as that phase closes. Phase 6 keeps only the backlog reconciliation and the sweep.
- **Decision**: FIXED — `MANUAL-CHECKLIST.md` is created in new Phase 1 §7 with the migration row; Phases 3 and 4 append theirs; Phase 6 §4 is a final pass only.

### F6 — Two dialog buttons collide with the E2E helper's documented locator trap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 vs. Phase 6 §1
- **Detail**: `e2e/disconnect.ts:11-18` carries an explicit ⚠️: `getByRole` name matching is case-insensitive SUBSTRING, so with the dialog open `{ name: "Disconnect" }` already resolves to two nodes and `{ name: "Connect" }` to three — each a strict-mode violation. Phase 3 adds a second button without pinning its accessible name; Phase 6 then asks the helper to "click the matching button by accessible name". Whether that is expressible depends on labels Phase 3 never commits to.
- **Fix**: Commit both accessible names in Phase 3's copy contract (keeping the existing `confirmLabel !== "Disconnect"` assertion), and have Phase 6 update the helper against those literals rather than discovering them.
- **Decision**: FIXED — Phase 3 §2 commits both accessible names with the mutual-non-substring constraint and a test for it; Phase 6 §1 consumes them.

### F7 — The destructive button is the one with no pending feedback

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1
- **Detail**: `confirm-dialog.tsx` renders "Working…" only on the primary action (`:107-112`); the secondary keeps its own label and is merely disabled (`:97-105`). The plan puts keep on the primary and clear on the secondary, so the irreversible branch gives no progress signal on a slow Server Action.
- **Fix**: Give `secondary` the same pending label in `ConfirmDialog` — one line, and it benefits `roster-editor`'s "Delete permanently" identically.
- **Decision**: FIXED — Phase 3 §1 adds the one-line `ConfirmDialog` change giving `secondary` the pending label.

### F8 — A kept absence outlives the project it was recorded under, silently

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: Under `keep`, a project switch leaves the previous project's absences with `sprint_id` NULL. `SPRINT_AT_RISK` matches absences by DATE only (`sprint-at-risk.ts:117-131`), so they immediately feed the NEW project's risk score and capacity. Defensible — an absence is a fact about a person, not a project — but the plan never states it, and `projectSwitch.keeps` will assert it to the lead as a benefit.
- **Fix**: State the semantics in Phase 4 and say it in the `keeps` clause ("the recorded absences, which stay with the team rather than the project"), so the copy is the decision rather than a side effect.
- **Decision**: FIXED — Phase 4 §1 states the cross-project semantics; §3 puts it in `projectSwitch.keeps`.
