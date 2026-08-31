<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-31 — Reconnect and Disconnect stop looking like the same decision

- **Plan**: `context/changes/reconnect-affordance/plan.md`
- **Scope**: all 5 phases (full plan)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION → all 4 findings triaged and FIXED (2026-08-31)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Scope check.** The diff touches exactly the files the plan named — 5 source
files, 2 new test files, 3 documents — with no unplanned source change and
nothing planned but missing. `git diff --stat 38a4342^..HEAD` lists 16 files;
every one maps to a "Changes Required" item or to Phase 5's document list.

**Automated criteria, re-run at review time.** `npm test` 1335 passed;
`npm run typecheck` clean; `npm run lint` 0 errors (4 pre-existing warnings in
`src/lib/anomaly/*`, untouched by this slice); `node scripts/manual-test-sweep.mjs`
exit 0. `npm run test:e2e` was not re-run for the review itself — the plan's
criterion 4.4 is a SINGLE local run, recorded green at 20/20 under commit
`45f99d1` — but the triage fixes below change rendered copy and the spec's own
cleanup, so the suite was re-run after them and passed 20/20 again.

**Manual criteria.** 12 rows remain `- [ ]` (2.5–2.11, 3.4–3.7, 5.3). None is
marked complete without evidence, so there is no rubber-stamping to flag; they
are genuinely pending and carried in `MANUAL-CHECKLIST.md` and backlog §24.

## Findings

### F1 — In demo, the settings promise names a control the reader cannot see

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/organisms/settings/integration-card.tsx:299`
- **Detail**: The card renders `reconnectCost(integration)` — the `"settings"`
  variant, whose closing clause quotes `Change monitored project` /
  `Change monitored repositories`. Directly above it, `editSlot` is gated
  `{isDemo ? null : editSlot}`, so in demo that control **is not on the screen**.
  The `surface` parameter exists precisely to stop this: the plan (Phase 1,
  `reconnectCost`, plan-review F5) states the rule as *"a sentence must not name
  a control its reader cannot see"* and cites it as the same defect class as
  naming a control that no longer exists. The wizard was given the guard; the
  demo branch of the settings card was not. A pure-string test cannot see it —
  which is the plan's own stated reason for the parameter — and no E2E covers the
  connected card in demo (`demo-boundary.spec.ts` visits the NOT-connected
  branch only), so nothing in the suite reports it.
- **Fix A ⭐ Recommended**: Pass the editor-less variant when the editor is
  hidden — `reconnectCost(integration, isDemo ? "wizard" : "settings")` — with a
  comment naming demo as the second surface that has no selection editor.
  - Strength: One expression, no new vocabulary, and it makes the existing
    parameter carry its actual meaning ("does this screen have the selection
    editor") on every surface rather than on two of three.
  - Tradeoff: `"wizard"` is now passed from a screen that is not the wizard, so
    the value name under-describes the condition it encodes.
  - Confidence: HIGH — the variant already exists, is tested in both directions
    (`integration-card-copy.test.ts`, "the wizard variant quotes no control the
    wizard does not have"), and the change is local to one JSX expression.
  - Blind spot: Not covered by any automated test after the fix either; it needs
    the checklist row (row 4) to gain the condition.
- **Fix B**: Rename the parameter's values to describe the condition —
  `"with-editor" | "without-editor"` — and pass `isDemo` into the choice.
  - Strength: The parameter stops being named after two screens and starts being
    named after the thing it actually tests, so the third caller is obvious.
  - Tradeoff: Touches three call sites, the type, the copy module's docstring and
    two assertions in `integration-card-copy.test.ts`, for no behavioural gain
    over Fix A.
  - Confidence: MEDIUM — mechanical, but it re-opens a naming the plan settled
    deliberately (plan-review F5 argued the surface, not the capability).
  - Blind spot: The plan's own prose refers to the `"wizard"` variant by name in
    three places; they would drift.
- **Decision**: FIXED via Fix A — `reconnectCost(integration, isDemo ? "wizard" : "settings")` in `integration-card.tsx`, with the reason recorded at the call site. `MANUAL-CHECKLIST.md` row 4 gained the condition, since no automated test can see it.

### F2 — The GitHub promise overstates what deselecting a repository costs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/organisms/settings/integration-card-copy.ts:262`
- **Detail**: The sentence reads *"Deselecting a repository is what removes the
  list of monitored repositories and every commit, pull request and code review
  synced from them."* Those two clauses are `DISCONNECT_IMPACT.github.clears`,
  written for the disconnect-**clear** branch, where the whole list does go. What
  deselecting actually does is per-repository: `github-store.ts:195-202` deletes
  only the rows `notInArray(keptRepoIds)`, and the comment at `:174-175` says so
  in as many words — *"Deselecting a repo still removes it and its history"*. As
  worded, the card tells the lead that dropping one repository clears the entire
  monitored list. This is the slice's own failure mode — a promise that
  overstates a loss pushes the lead off a safe path exactly as effectively as one
  that hides a real one, which is the argument S-26 made for the dialog and this
  module quotes at `disconnect-confirm-copy.ts:74-78`.
  Introduced late: the earlier draft said *"shortens …, and it takes … with it"*,
  and the switch to `joinClauses` (correct in itself — it removed a positional
  destructure that could render `undefined`) collapsed the scope qualifier with
  it.
- **Fix**: Re-frame the clause so the scope is explicit while both fragments stay
  verbatim — e.g. *"Deselecting a repository is the one thing here that costs
  anything: for each one you drop, it takes its place out of `${a}` and removes
  `${b}`."*
  - Strength: Keeps every `github.clears` fragment `.includes()`-present, so the
    fragment-sync assertion and the `/delet|destroy/i` assertion both stay green;
    the attribution to "Deselecting" also stays ahead of both fragments, which is
    what the S-26 assertion checks.
  - Tradeoff: A longer sentence on a card that already carries two paragraphs.
  - Confidence: HIGH — verified against `github-store.ts:176-202` and against the
    four assertions in `integration-card-copy.test.ts` that constrain this
    string.
  - Blind spot: None significant.
- **Decision**: FIXED — reworded with an explicit per-repository scope (`for each one you drop, it takes its place out of … and removes …`), both fragments still verbatim. Reverted to a positional read of the source entry, with a comment saying why joining them was wrong here.

### F3 — The new E2E spec's cleanup leaks the account on an early `beforeAll` failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `e2e/connections-card.spec.ts:84`
- **Detail**: `afterAll` calls `deleteAccount(ownerId)`, and `ownerId` is assigned
  inside `beforeAll` only after `resolveOwnerId` returns. If the sign-up succeeds
  and anything between it and that assignment throws, the account row survives
  the run with no cleanup. `accounts.ts:177-183` documents
  `deleteAccountByEmail` as existing for exactly this: *"the owner id is not
  known until the row is written, so a cleanup keyed on an id captured inside the
  test body would leak the account whenever the test fails early."* This is not
  hypothetical — the first run of this spec did fail inside `beforeAll` (the
  per-worker sign-up collision), and it only escaped leaking because it failed
  one line earlier than the gap.
- **Fix**: Call `deleteAccountByEmail(email)` in `afterAll` — the email is a
  module-level const, known before the sign-up runs.
  - Strength: Leak-proof regardless of where `beforeAll` dies, and it is the
    helper the repo added for this case.
  - Tradeoff: None — same cascade, one extra query by a unique-indexed column.
  - Confidence: HIGH — the helper is already exported and used elsewhere.
  - Blind spot: None significant.
- **Decision**: FIXED — `afterAll` now calls `deleteAccountByEmail(email)`.

### F4 — First E2E spec to import application source

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `e2e/connections-card.spec.ts:12-20`
- **Detail**: No other spec in `e2e/` imports from `@/…`; this one pulls six
  exports out of `integration-card-copy.ts`. It is the plan's own intent — the
  Phase 4 contract asks that the assertion carry *"the fragment `reconnectCost`
  derives"*, and a literal would have been a fourth copy of a string this slice
  exists to keep in one place. It works because Playwright reads the root
  `tsconfig.json` path mapping, and the only app modules reached are pure or
  type-only, so no server code enters the test process. Worth naming because it
  is a new dependency direction for the browser suite, and because a future
  change to `tsconfig.json` paths would break the suite in a way whose cause is
  not local to `e2e/`.
- **Fix**: Add two sentences to the spec's docstring recording why the import
  exists and what it depends on (root-tsconfig path mapping; the imported module
  must stay pure).
- **Decision**: FIXED — docstring records why the import exists and the two things it rests on (root-tsconfig path mapping; the imported module staying pure).
