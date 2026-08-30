<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Confirmation before a destructive disconnect (S-24)

- **Plan**: `context/changes/destructive-action-confirmation/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE → SOUND (all 10 findings fixed in the plan during triage)
- **Findings**: 2 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F4) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F1) |
| Blind Spots | WARNING (F2, F3) |
| Plan Completeness | WARNING (F5–F10) |

## Grounding

17/17 paths ✓, symbols ✓, brief↔plan ✓.

The plan's riskiest claim was verified **empirically**, not by reading: a
throwaway test in the unit project walked `getTableConfig(...).foreignKeys` over
every exported table with no database and reproduced the declared closure exactly
— `github_credential` → {`monitored_repo`, `github_commit`, `github_pull_request`,
`github_review`}, weakened ∅; `jira_credential` → {`jira_project`,
`status_mapping`, `sprint`, `jira_ticket`, `jira_status_history`, `absence`,
`anomaly`}, weakened `daily_recap.sprint_id`. Both `disconnect*Service`
implementations do delete the credential row, so the DB cascade is the real
mechanism. `fk.onDelete` is readable at runtime with no DB: confirmed.

## Findings

### F1 — The `jira-project-editor` warning has a different root than `DISCONNECT_IMPACT`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §1
- **Detail**: The plan rebuilt the editor's `Alert` from `DISCONNECT_IMPACT.jira`
  "minus the credential-level items". But a project switch has a different root:
  `connection-service.ts:393-412` **updates** the `jira_project` row in place and
  deletes only that project's `sprint` rows, so the closure is `sprint` →
  {`absence`, `anomaly`, `jira_ticket`, `jira_status_history`} + weakened
  `daily_recap.sprint_id`, while `jira_project` survives and `status_mapping` is
  replaced. Subtracting credential-level items removes neither from the list, so
  the "corrected" warning would still be wrong — and it was the one list the
  Phase 1 guard test did not cover, i.e. the exact drift class the slice exists
  to end.
- **Fix A ⭐ Recommended**: third entry `projectSwitch` with `rootTable: "sprint"`
  in the same module, covered by the same guard test.
  - Strength: the traversal is already generic over the root, so the third list
    is machine-checked for free.
  - Tradeoff: the `Record` key union and the module's framing widen.
  - Confidence: HIGH — verified against the service and the FK walk.
  - Blind spot: `status_mapping` is *replaced*, a third state beside
    destroyed/weakened; its copy stays hand-written.
- **Fix B**: drop the editor from this slice's scope.
- **Decision**: FIXED via Fix A

### F2 — `description` in `ConfirmDialog` renders inside a `<p>`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Key Discoveries + Phase 2 §1
- **Detail**: The plan asserted "ConfirmDialog needs no changes: it already
  supports a `ReactNode` description" and wanted a node listing `.destroys` then
  `.keeps`. True at the type level; false in the DOM —
  `AlertDialogPrimitive.Description` renders `Primitive.p`
  (`@radix-ui/react-dialog/dist/index.mjs:269`). A `<ul>`/`<div>` inside is
  invalid nesting: React warns and the browser hoists the list out of the
  paragraph, taking the accessible description with it. All three existing
  consumers pass a plain string, so the `ReactNode` path has never been used.
- **Fix**: copy is prose sentences (the house shape from S-15), stated in the
  Phase 2 §1 contract, with the `<p>` caveat recorded in Key Discoveries.
- **Decision**: FIXED

### F3 — "A different label" does not disambiguate the buttons in Playwright

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 2 §4, §5
- **Detail**: `getByRole`'s `name` defaults to `exact: false`, i.e. a
  case-insensitive **substring** match (`locatorUtils.ts` passes `!!options.exact`
  to `escapeForAttributeSelector`; `stringUtils.ts` appends the lax `i` suffix).
  With the dialog open, `{ name: "Disconnect" }` resolves to two nodes and
  `{ name: "Connect" }` to three — *Dis**connect***, *Re**connect***,
  *Dis**connect** GitHub* — a strict-mode violation. It lands squarely on the new
  "Cancel actually cancels" test, whose final assertion is that the Connect form
  is absent while the Disconnect trigger is visible.
- **Fix**: `{ exact: true }` on every `Disconnect` / `Connect` locator the slice
  touches, recorded in Critical Implementation Details and both E2E contracts.
- **Decision**: FIXED

### F4 — The demo boundary is applied inconsistently: `load*` exempted from its own rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2
- **Detail**: `test*Connection` is gated because it "spends the real credential
  against the live API with only a `disabled` attribute — a courtesy, not a
  boundary". `loadAvailableRepos`, `loadAvailableProjects` and
  `loadProjectStatuses` (three, not two) do exactly the same, and the plan
  exempted them with "not reachable while their editors are disabled" — the same
  `disabled`-as-a-boundary argument, two paragraphs later. Server Actions are
  their own entry points regardless of what renders.
- **Fix A ⭐ Recommended**: gate all three the same way; they already return
  `{ ok: false; message }`. The tab's action count becomes nine.
  - Strength: one rule, no exception; ~one line per action.
  - Tradeoff: "six actions" had to be restated in the plan and the brief.
  - Confidence: HIGH — signatures read in `connections/actions.ts`.
  - Blind spot: no sweep for server-side callers of `load*` outside the editors.
- **Fix B**: keep the exemption but state the honest reason (read-only).
- **Decision**: FIXED via Fix A

### F5 — Demo tests for the disconnects pointed at the integration files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4
- **Detail**: "extensions to the existing setup-action test files" —
  `setup/github/` and `setup/jira/` hold only `actions.integration.test.ts`,
  excluded from `vitest.config.ts` and requiring local Postgres. Criterion 3.1
  ("Unit tests pass, including the new demo refusals: `npm test`") could not have
  been met.
- **Fix**: three new files named explicitly, mirroring
  `setup/team/actions.demo.test.ts` (mock `@/lib/workspace`; `getCloudflareContext`
  and `getDb` throw, so "no write" is proven by the refusal returning at all).
- **Decision**: FIXED

### F6 — Criterion 4.5 was untrue, and one dangling reference is real

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §4 + automated criterion 4.5
- **Detail**: The grep returns five files today, not "only the roadmap entry":
  `frame.md`, `plan.md` (its own References line), `manual-test-backlog.md:295`,
  `roadmap.md`, and `context/manual-tests/S-16-4.6-tozsamosc-sprintu-niewidoczna.md:9`
  — a sibling note that **outlives this slice** and would be left pointing at a
  deleted file.
- **Fix**: criterion restated (roadmap + this change's own folder are allowed);
  the sibling note and the backlog line added to Phase 4's edits.
- **Decision**: FIXED

### F7 — The failure surfaces the plan called "existing" do not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1
- **Detail**: In the wizard cards `toast.error` sits in a `catch`
  (`github-connection-status.tsx:38-48`); a returned `{ ok: false }` does not
  throw, so the refusal would surface as `toast.success`.
  `IntegrationCard.handleDisconnect` (`integration-card.tsx:111-118`) has no error
  state at all — only the `failure` and `testResult` alerts, neither about
  disconnecting.
- **Fix**: contract now requires an explicit `if (!result.ok)` branch at each of
  the three call sites, and names what each renders.
- **Decision**: FIXED

### F8 — "Pure apart from the schema types" invites a value import into the client bundle

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1
- **Detail**: The intent ("no database handle in the bundle") is right, but the
  wording admits `import { sprint } from "@/db/schema"` — a value import that
  pulls `drizzle-orm/pg-core` into a client component.
- **Fix**: the module imports nothing from `@/db/schema`; table names are plain
  string literals and only the guard test imports the schema.
- **Decision**: FIXED

### F9 — Progress row 4.6 duplicated 2.5/2.6/3.6/3.7

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: `## Progress`, Phase 4
- **Detail**: The four "Manual Testing Steps" rows are the checks already tracked
  as 2.5, 2.6, 3.6 and 3.7; 4.6 was an aggregate, so the canon showed five open
  manual rows for four actual checks (`manual-test-sweep.mjs` counted five).
- **Fix**: 4.6 removed — Phase 4 has no surface of its own; the checklist rows are
  signed off against phases 2 and 3.
- **Decision**: FIXED

### F10 — Two factual slips in the plan's own diagnosis

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis, Phase 4 §1 and §5
- **Detail**: (a) The `Alert` in `jira-project-editor.tsx:77-84` does **not** omit
  `anomaly` — it says "Anomalies detected from that data go with it". Only
  `absence` is omitted; it is the **docstring** at `:23-30` that omits both and
  claims `daily_recap` cascades. The claim was repeated in five places.
  (b) Phase 3 §5 fixes `connections/page.tsx:34`'s comment, which `roadmap.md:574`
  still lists as remaining work **for S-27**; Phase 4 ("make every statement
  true") did not correct it.
- **Fix**: (a) sentence narrowed everywhere it appears; (b) the S-27 roadmap row
  added to Phase 4 §5's contract, keeping its other two items.
- **Decision**: FIXED

## Triage summary

Fixed: F1 (Fix A), F2, F3, F4 (Fix A), F5, F6, F7, F8, F9, F10 — 10 of 10.
Skipped / accepted / dismissed: none.

► Verdict after fixes: **SOUND**
