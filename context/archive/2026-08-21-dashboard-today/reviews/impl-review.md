<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-07 Dashboard "Today" — Anomaly Inbox north-star core

- **Plan**: context/changes/dashboard-today/plan.md
- **Scope**: Phases 1–5 (all; automated criteria complete, manual pending)
- **Date**: 2026-08-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Anomalies of a deactivated member render as "Team-level" and escape the member filter

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/dashboard/page.tsx:38-46, src/lib/roster.ts:27-40, src/components/organisms/anomaly/anomaly-inbox.tsx (member filter)
- **Detail**: `listRoster` is filtered to `isActive = true` and is used for BOTH the member-name map and the filter dropdown. An anomaly whose `relatedTeamMemberId` points to a deactivated member (`isActive = false`, row still present — deactivation is not deletion) then: (a) fails the name lookup → the row displays "Team-level" even though it IS assigned, and (b) is unreachable by any filter — the `UNASSIGNED` bucket only matches `memberId == null`, and no dropdown option exists for an inactive member. The plan's own contract conflated the two uses of `listRoster` ("filtered to isActive = true for the dropdown" AND "map relatedTeamMemberId → display name"), so this is a plan-level gap surfaced in implementation. Only bites when members are deactivated rather than deleted (FK `onDelete: set null` handles deletion correctly → shows as Unassigned).
- **Fix**: Resolve names from an all-members map (owner-scoped, no `isActive` filter) while keeping the filter dropdown to active members only — e.g. `listRoster` returns all members plus an `isActive` flag; page builds `memberNameById` from all, the organism builds dropdown options from the active subset. Add an integration-test case for an anomaly tied to a deactivated member.
  - Strength: Closes both the mislabel and the unfilterable-row gap at the source; keeps the dropdown clean.
  - Tradeoff: Reader returns a slightly wider set; one extra field on `RosterMember`.
  - Confidence: MED — depends on whether the app deactivates members at all today (S-04 roster editor sets `isActive`, but the UI path for deactivation vs. deletion isn't confirmed in this slice).
  - Blind spot: Haven't confirmed a live deactivation path exists in the current UI; if members are only ever deleted, this is latent, not active.
- **Decision**: FIXED (Fix now, future-proof). `listRoster` now returns ALL members + `isActive`; `page.tsx` builds the name map from all, dropdown from the active subset; integration test covers a deactivated member. Confirmed latent today (no `isActive = false` write path in code).

### F2 — Error banner renders raw `lastError` (`err.message`) to the owner's browser

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/dashboard/sync-status-bar.tsx:70-74
- **Detail**: The destructive banner appends `s.lastError` verbatim. `lastError` is populated (S-05) from `classifyError`, whose catch-all branch is `err instanceof Error ? err.message : "Unknown sync error."` — an uncontrolled string. S-07 is the slice that first surfaces this value in a client-facing payload. It is owner-scoped (cross-account isolation via `getSyncState` holds — the owner only ever sees their own error), so this is defense-in-depth, not a leak across tenants. Still, the Guardrail "tokens never in client-facing payloads" argues for not echoing raw sync-error text.
- **Fix**: Render a friendly per-status message (e.g. "Jira sync failed — reconnect your token" for ERROR, "Jira is rate-limited — retrying later" for RATE_LIMITED) and drop the raw `lastError` from the client payload, or gate raw display to known typed error classes only.
- **Decision**: FIXED. `lastError` removed from `InboxIntegrationState` + the `page.tsx` mapping (no longer in the client payload); banner renders a friendly per-status message (`STATUS_MESSAGE`) from `status` alone.

### F3 — `sourceUrl` rendered as an href without scheme validation

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/organisms/anomaly/anomaly-row.tsx:82-92
- **Detail**: The "View source" link binds `anomaly.sourceUrl` directly to `href`. Values are app/API-constructed — Jira `${baseUrl}/browse/${jiraKey}` and GitHub `row.html_url` — so the practical risk is low, but React does not neutralize a `javascript:`-scheme href, and `html_url` originates from an external API response. A defensive http(s) guard would harden against a hostile/misconfigured source returning a non-http scheme.
- **Fix**: Only emit the anchor when `sourceUrl` parses as an `http(s)` URL; otherwise render plain text.
- **Decision**: SKIPPED — URLs are app/API-constructed (`${baseUrl}/browse/...`, GitHub `html_url`); risk accepted for this slice.

### F4 — `hasActiveSprint` is really "has any sprint" (fallback to most-recent closed sprint)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/(app)/dashboard/page.tsx:31,88; src/lib/sprint.ts:20-37
- **Detail**: `getActiveSprintRow` returns the ACTIVE sprint OR, failing that, the most-recently-started sprint (possibly CLOSED/FUTURE). So `hasActiveSprint = sprint != null` is true whenever the owner has ANY sprint row. A between-sprints team whose only sprints are closed will see the "No anomalies detected" healthy state rather than the "No active sprint" empty state. This exactly matches the plan's prescribed Phase-3 contract (`hasActiveSprint={sprint != null}`) and is consistent with the detection pipeline (`load-snapshot` uses the same fallback, so anomalies are attributed to that same sprint) — so it is NOT drift. Recorded for awareness: the empty-state (a) label "No active sprint" is slightly narrower than its trigger condition.
- **Fix**: If the distinction matters to UX, either rename the prop to `hasSprint` for honesty, or have the page check `sprint.state === "ACTIVE"` to drive empty-state (a) for closed-only owners. Otherwise accept as-is (consistent with detection).
- **Decision**: SKIPPED — matches the plan contract and is consistent with the detection pipeline; accepted as-is.
