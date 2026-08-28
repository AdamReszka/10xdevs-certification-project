<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points — Phase 7

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phase 7 of 7 — "Sprint switcher on Sprint Detail"
- **Date**: 2026-08-28
- **Verdict**: REJECTED at review time; all 10 findings FIXED in triage the same day
- **Re-verified after the fixes**: `typecheck` clean · `lint` 0 errors · `npm test` 871 passed · `npm run test:integration` 274 passed (2 new cases)
- **Findings**: 1 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All four plan sections (§1 unpin the page, §2 the switcher, §3 the notice, §4 the
correction on the SELECTED sprint) implement their stated contract, including the
load-bearing one: row 2 of §1's table returns `kind: "measurement-only"` with
`sprintRowId: null` and does **not** fall back to the active sprint
(`sprint-selection.ts:105-110`), and §1, §3 and §4 all derive from that single
resolver output rather than each re-guessing the condition.

Automated criteria 7.1–7.4, 7.7, 7.8 all verified green:
`npm run typecheck` clean · `npm run lint` 0 errors (5 pre-existing warnings, none
in phase-7 files) · `npm test` 69 files / 871 tests · `npm run test:integration`
23 files / 272 tests.

Cross-account isolation was traced end to end and is clean: the raw `?sprint=`
param reaches SQL only through `getSprintRowByJiraId` (`sprint.ts:60-66`,
`and(ownerId, jiraSprintId)`, parameterized), and is otherwise resolved against a
list already scoped to the owner **and** the current Jira project. The write path
re-resolves owner + sprint and throws `UnknownSprintError` otherwise.

## Findings

### F1 — A sprint switch leaves the previous sprint's number in the adjustment input

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/dashboard/sprint-detail/page.tsx:172-180`
- **Detail**: `<CapacityAdjustments>` is rendered without a `key`. Switching
  sprints is a soft navigation (`sprint-switcher.tsx:55` → `router.push`), so
  React reconciles the same component at the same tree position and
  `AdjustmentField`'s `useState(current === null ? "" : String(current))`
  (`capacity-adjustments.tsx:179`) is **not** re-initialised — the initializer
  runs on mount only. Select sprint A with an override of `20`, switch to sprint
  B whose override is `null`: the input still reads `20` while the heading, the
  placeholder and the `jiraSprintId` prop are B's. `save` closes over the *new*
  prop, so pressing Save writes **A's number onto B**. Same shape for the
  delivered-SP correction, which is worse: that figure feeds FR-024's average,
  and manual row 7.9's own "why it matters" says a correction landing on the
  wrong sprint skews an estimate nobody can later reconstruct. Phase 5's version
  of this component could not hit it — the Availability tab has exactly one
  sprint. Phase 7 is what makes the props change under a live component.
- **Fix**: Add `key={selection.jiraSprintId}` to `<CapacityAdjustments>` so a
  sprint change remounts the fields.
  - Strength: Forces the `useState` initializer to re-run with the new sprint's
    values; one line, no change to the component's own contract, and it matches
    how the rest of the page derives everything from `selection`.
  - Tradeoff: An in-flight edit is discarded when the lead switches sprints —
    which is the correct outcome here, since the edit was about the other sprint.
  - Confidence: HIGH — read both files; the state is initialized from props and
    never synced, and no `key` exists at either call site.
  - Blind spot: Not reproduced in a browser (no component-test harness in this
    repo); the reasoning is from React's reconciliation rules, not observation.
- **Decision**: FIXED — `key={selection.jiraSprintId}` added at `page.tsx:173`.

### F2 — The aging clock keeps running after a closed sprint ended

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/dashboard/sprint-detail/page.tsx:124`
- **Detail**: `getTicketAging(db, ownerId, sprintRow.id, now)` passes the wall
  clock. `foldTimeInStatus` accrues the open interval to `now` with no clamp
  (`time-in-status.ts:112`), so on the newly-reachable closed-sprint path every
  unfinished ticket of a sprint that ended six weeks ago reports six weeks of
  aging, and the per-category totals inflate by the same amount. The page's two
  other reducers do clamp: `rangeTo` is `min(endDate, now)` (`page.tsx:116`) for
  the activity matrix, and `getBurndownSeries` clamps its own axis
  (`burndown-series.ts:105-106`, "a burndown must not draw a flat line into the
  future"). Aging is the one that was left on `now` — invisible while the page
  only ever showed the active sprint.
- **Fix**: Pass the clamped instant — `rangeTo` (already computed one line
  above), or `min(now, endDate)` — instead of `now` when the sprint is not
  ACTIVE.
  - Strength: Restores the same "clamp to the sprint window" rule the other two
    reducers already follow, at the call site where the window is already in
    scope; no reader signature changes.
  - Tradeoff: It changes the meaning of `sinceLastMoveMs` for a closed sprint
    from "until today" to "until the sprint ended" — which is what the aging
    report is asking about, but it is a semantic change to the default sort
    column, not only a display fix.
  - Confidence: HIGH — read `aging.ts:44-118` and `time-in-status.ts:89-113`;
    there is no clamp anywhere on that path.
  - Blind spot: Whether any existing aging test pins the unclamped behaviour for
    the active sprint (the fix should leave ACTIVE untouched either way).
- **Decision**: FIXED — `agingNow` clamps to `min(endDate, now)` for a non-ACTIVE
  sprint (`page.tsx:120-131`); an ACTIVE sprint past its end date is left
  unclamped on purpose.

### F3 — Three serial DB waves where there was one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/dashboard/sprint-detail/page.tsx:120-132`
- **Detail**: Before this phase the page issued one five-way `Promise.all`
  (aging, activity, burndown, sync state, roster). It now awaits three times in
  sequence: wave 1 resolves the sprint (lines 68-76), wave 2 the three reducers
  (120-127), wave 3 `getSyncState` + `listRoster` (129-132). Wave 3 depends on
  nothing in wave 2, so every render pays an extra serialized Hyperdrive round
  trip for no reason. Wave 1 genuinely must come first (the reducers need the
  resolved `sprint.id`); wave 3 does not.
- **Fix**: Hoist `getSyncState` and `listRoster` into wave 1's `Promise.all`, or
  spread them into wave 2's.
- **Decision**: FIXED — `getSyncState` and `listRoster` hoisted into the first
  `Promise.all` (`page.tsx:75-85`); the no-sprint branch reuses the resolved
  sync state instead of re-querying it.

### F4 — §3's promised retention-path integration test was not written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/measurement/sprint-switcher.integration.test.ts` (absent case)
- **Detail**: Phase 7 §3 states the retention half of the notice "cannot be
  triggered on a real account and must be covered by an integration test that
  deletes the rows directly". No such test exists — the integration file covers
  the *write* refusal for a measurement with no `sprint` row (`:308-327`), not
  the render-with-notice path. Coverage is not zero: `sprint-selection.test.ts`
  asserts the `measurement-only` decision itself, and the manual row 7.5 walks
  the project-switch half. But the specific test the plan promised, and named as
  the reason the retention half could be left unmanual, is missing. This is plan
  prose rather than a numbered criterion, which is why 7.1–7.8 are all honestly
  ticked.
- **Fix**: Either add the integration case (seed a finalized measurement, delete
  the `sprint` row directly, assert the page-level resolver yields
  `measurement-only`), or strike the sentence from §3 and record that the pure
  resolver test is the coverage.
- **Decision**: FIXED — added "a sprint whose raw data is gone but whose
  measurement survives" to `sprint-switcher.integration.test.ts`: it deletes the
  `sprint` row directly, then runs the REAL readers into `resolveSprintSelection`
  and asserts `measurement-only` + `{ kind: "unavailable" }`.

### F5 — With no active sprint the switcher disappears, stranding every recorded sprint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/dashboard/sprint-detail/page.tsx:86-99, 288-292`
- **Detail**: The `selection.jiraSprintId === null` branch passes
  `selectedJiraSprintId={null}`, and `PageShell` renders the switcher only when
  that value is truthy. So an owner who has recorded sprints but no active
  `sprint` row — precisely the state right after a monitored-project switch,
  before the next sync brings a new sprint in — sees "No active sprint" and no
  way to reach any of their recorded ones. `options` is computed and passed, then
  discarded. Manual row 7.5 routes around this by clicking "Sync now" first, so
  the row will pass while the gap stays.
- **Fix**: Render the switcher in the null-sprint branch too, gated on
  `options.length > 0` rather than on a selected id.
  - Strength: The list is already computed and already owner+project-scoped;
    showing it turns a dead end into the one screen that can still say what the
    account holds.
  - Tradeoff: `SprintSwitcher` currently takes a non-null `value`, so it needs a
    "nothing selected" state — a small prop change plus a placeholder, not a
    one-liner. It also interacts with `options.length < 2` hiding
    (`sprint-switcher.tsx:46`), which would need to become `< 1` on this path.
  - Confidence: HIGH — the branch and the guard were both read directly.
  - Blind spot: How often this state is actually reached outside the
    project-switch window; if a sync always follows immediately it is narrow.
- **Decision**: FIXED — `PageShell` now gates the switcher on `options.length > 0`
  instead of on a selected id, `SprintSwitcher.value` accepts `null` with a
  "Pick a recorded sprint" placeholder, and the self-hiding `< 2` rule applies
  only when something IS on screen.

### F6 — An unfinalized record sorts to the top of the switcher

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/measurement/reader.ts:108`
- **Detail**: `.orderBy(desc(sprintMeasurement.startDate))` — Postgres sorts
  `DESC` as `NULLS FIRST`. That was harmless while every caller filtered on
  `finalizedAt IS NOT NULL`; `listRecordedSprints` lifts that filter, and
  `writeLeadColumn` (`overrides.ts:156-167`) inserts a record carrying only the
  identity columns — no `start_date` — when a lead overrides ahead of the sweep.
  Such a record therefore sorts *above* the newest sprint. Usually benign (it is
  normally the active sprint, which belongs at the top anyway), but a sprint
  overridden before a late sweep would jump the queue.
- **Fix**: Order by `start_date desc nulls last`, with `measured_at` as a
  tiebreaker.
- **Decision**: FIXED — `orderBy(sql`start_date desc nulls last`, desc(measuredAt))`
  in `selectMeasurements` (`reader.ts:108-118`).

### F7 — Reliability copy is written for an active sprint, on a closed one

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/app/(app)/dashboard/sprint-detail/page.tsx:224`
- **Detail**: `hasActiveSprint: true` is hardcoded, with a comment explaining it
  means "there is a sprint on screen". The panel's own copy still reads
  "delivered so far" (`reliability-kpi.tsx:71`), and its empty state promises the
  numbers "are written on each Jira sync — this panel fills in after the next
  one" (`:51-52`) — a promise no sync will keep for a sprint that closed. The
  placement is in scope (§1's "headline figures"); only the wording lags.
- **Fix**: Give `ReliabilityKpi` a closed-sprint variant of the two strings, or
  pass a flag distinguishing "in flight" from "on screen".
- **Decision**: FIXED — `ReliabilityKpi` takes an `isClosed` flag (wording only,
  no number changes): "delivered so far" loses "so far", and the empty state
  stops promising a sync that will never come. Passed from Sprint Detail as
  `(sprintRow?.state ?? measurement?.state ?? "CLOSED") !== "ACTIVE"`.

### F8 — Test helper reads row[0] instead of the row it asks for

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/measurement/sprint-switcher.integration.test.ts:153-159`
- **Detail**: `recordOf` selects **all** the owner's measurements with no
  `jiraSprintId` predicate and no `limit`, then returns `row?.jiraSprintId ===
  jiraSprintId ? row : undefined`. It is correct today only because the test that
  uses it seeds one record; with two it silently returns `undefined` and the
  assertion fails confusingly rather than wrongly. The criterion-7.7 test itself
  (`:262-306`) is sound — it asserts the closed sprint's corrected value, the
  measurement left untouched, the active sprint's `null`, and `rows.length === 2`.
- **Fix**: Add `eq(sprintMeasurement.jiraSprintId, jiraSprintId)` to the `where`.
- **Decision**: FIXED — `recordOf` now filters on `jiraSprintId` as well as
  `ownerId` and returns the row it asked for.

### F9 — Nothing asserts the owner predicate on the one query that eats the raw param

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/sprint.ts:60-66` (test absent)
- **Detail**: `getSprintRowByJiraId` is the only new query that consumes the
  attacker-controlled `?sprint=` value directly. Its `and(ownerId, jiraSprintId)`
  predicate is correct, and the resolver refuses to use a row whose
  `jiraSprintId` disagrees — but no test pins the owner half, in a codebase whose
  cross-account isolation is entirely app-enforced (no RLS).
  `listRecordedSprintsForOwner` has exactly this test (`:231-246`); the sprint-row
  reader does not.
- **Fix**: Add an integration case — two owners with the same `jiraSprintId`,
  assert owner A's lookup returns `null` for owner B's sprint.
- **Decision**: FIXED — added `describe("getSprintRowByJiraId")` with two owners
  sharing `jira_sprint_id` "899": the other account's lookup returns `null`,
  the owner's returns the row.

### F10 — Switcher edges: a silent 12-sprint ceiling, and an uninterpolated id

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/measurement/reader.ts:60`, `src/components/organisms/dashboard/sprint-switcher.tsx:55`
- **Detail**: Two small ones on the same surface. (a) `DEFAULT_LIMIT = 12` bounds
  the switcher list — good, the query is not unbounded — but a team past twelve
  recorded sprints cannot reach the older ones, and a `?sprint=` naming one falls
  into the "unknown id" branch and silently renders the active sprint instead.
  Nothing on screen says a ceiling exists. (b) `` `?sprint=${next}` `` is
  interpolated without `encodeURIComponent`; the values are the account's own
  Jira sprint ids and the column is `text`, so this is hygiene rather than a
  vulnerability.
- **Fix**: Wrap `next` in `encodeURIComponent`; decide whether the 12-row ceiling
  needs an affordance or a raised limit before a team reaches it.
- **Decision**: FIXED — both. `next` is wrapped in `encodeURIComponent`, and the
  switcher's read takes its own `SWITCHER_LIMIT = 60` instead of the averaging
  window's `DEFAULT_LIMIT = 12`, so the ceiling is out of reach in the MVP's
  lifetime while the query stays bounded.

## Also noted, not filed

- **The state badge depends on how you arrived.** `toStateLabel`
  (`page.tsx:246-252`) suppresses the badge for `kind === "active"` only. The
  switcher always navigates with `?sprint=`, so picking the active sprint yields
  `kind === "selected"` and a "Sprint active" badge that the bare URL does not
  render. Documented as intentional at `:239-244`, though `PageShell`'s own prop
  doc ("Set only when the sprint is NOT active", `:266`) now contradicts it.
- **The notice keys on the `sprint` row, not on raw-data absence** (`:120-127`).
  The two coincide today. If the future "current + 2 sprints" purge deletes
  tickets while keeping `sprint` rows, `detail` will be non-null-but-empty and
  the tabs will fall back to generic empty states — the exact failure §3 exists
  to prevent. Matches the plan as written; flagged for whoever builds the purge.
- **Aging on a closed sprint is missing every carried-over ticket**, because
  `jira_ticket` is unique on `(owner_id, jira_key)` and the sync re-stamps
  `sprint_id` on carryover. Pre-existing; Phase 7 is what makes it visible.
- **`listRecordedSprints` (`reader.ts:82`) is exported with one caller**, its own
  `…ForOwner` wrapper twenty lines below.
- **Two extras beyond §2's contract**, both benign and both tested: the active
  sprint is unioned into the option list when the sweep has no record for it yet
  (`sprint-selection.ts:156-166`), and the switcher hides itself entirely at
  `options.length < 2` (`sprint-switcher.tsx:46`).
