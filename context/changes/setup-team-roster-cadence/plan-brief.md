# S-04 — Setup Wizard: Team Roster + Sprint Cadence — Plan Brief

> Full plan: `context/changes/setup-team-roster-cadence/plan.md`
> Research: `context/changes/setup-team-roster-cadence/research.md`

## What & Why

Build the **final setup-wizard step** (`/setup/team`, `step={3}` of 4): auto-import an editable team roster from GitHub collaborators + Jira project members (FR-006), and auto-pull overridable sprint cadence from the Jira Agile API (FR-007). This completes onboarding — after it, the tech lead has a team mapped across both systems and a known sprint rhythm, the two inputs the anomaly engine needs to correlate Jira state with GitHub activity.

## Starting Point

S-02 (GitHub) and S-03 (Jira) shipped the first two wizard steps on a copy-ready four-layer template (service core → thin action → shell page → client organism). The schema already carries every column S-04 needs (`team_member`, `sprint` cadence, `jira_project.boardId`). S-03 deliberately deferred `boardId`/Agile-API discovery to S-04 and left a placeholder Jira → `/dashboard` "Continue" link for S-04 to re-point. No "onboarding complete?" signal exists yet.

## Desired End State

From the Jira "connected" card, Continue lands on `/setup/team`. The lead sees a roster pre-seeded from both integrations (with a manual control to map a GitHub person to a Jira person), edits any field, and reviews a cadence form pre-filled from the active sprint. On finish, the wizard is complete (`isOnboardingComplete` returns true) and the user lands on `/dashboard`. Degradation banners cover a narrow PAT and a between-sprints project.

## Key Decisions Made

| Decision                     | Choice                                             | Why (1 sentence)                                                        | Source   |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| Step UX                      | Single page, roster + cadence, `step={3}`          | "Last step finishes the wizard" narrative; one page, less nav state.   | Plan     |
| Roster dedup                 | Manual GitHub-login ↔ Jira-accountId mapping       | Email is null (GitHub) / privacy-withheld (Jira) — unreliable to match.| Research |
| Re-import semantics          | Preserve manual edits, merge by stable key         | FR-006 "auto-import seeds, manual edit persists"; safe re-run.         | Plan     |
| Onboarding-complete predicate| Derived helper `src/lib/onboarding.ts` (no column) | One source of truth, no migration, no state-vs-flag divergence.        | Plan     |
| Cadence timezone             | Jira owner's `timeZone` (UTC fallback)             | Already fetched in the same import; avoids off-by-one weekday.         | Plan     |
| Board selection              | Auto first scrum; chooser only when multiple       | Zero-touch in the common single-board case, correct when several.     | Plan     |
| PAT-scope failure            | Degrade to manual entry + banner                   | Graceful-degradation guardrail; wizard never hard-blocks.             | Plan     |
| No active sprint             | Banner + editable defaults, wizard still finishes  | Teams onboard between sprints; cadence re-pulls next sync.            | Plan     |

## Scope

**In scope:** roster auto-import + merge-by-key persistence; manual GitHub↔Jira mapping; editable member profiles; cadence auto-derivation (length/start-day/working-days) + override; `boardId` discovery; onboarding-complete predicate; re-pointing the Continue link.

**Out of scope:** any new migration; threshold/severity settings; absence calendar; wizard routing/gate wiring and returning-user settings surface (owned by `onboarding-routing`); a standalone "Setup" nav item; pool teardown; credential re-encryption.

## Architecture / Approach

Follow the four-layer setup-step template. Build bottom-up: (1) extend the two pure API clients (`github.ts` collaborators; `jira.ts` gets `AGILE_API_PATH` + board/sprint/members) with cap+origin pagination; (2) a new **credential decrypt-back seam** (`credentials.ts` — first production consumer of `decryptToken`) plus the `roster-store.ts` service core doing reads-before-transaction, merge-by-key upsert, and cadence derivation; (3) thin actions with the `toFailure` ladder surfacing degradation markers as typed results; (4) the single `step={3}` page + roster/cadence organisms with banners; (5) the derived onboarding predicate + nav re-point.

## Phases at a Glance

| Phase                                  | What it delivers                                     | Key risk                                              |
| -------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| 1. API client extensions               | 3 new credentialed readers, unit-tested              | Offset vs Link pagination quirks; scope/auth mapping  |
| 2. Decrypt seam + service core         | First prod `decryptToken`; import/merge/cadence      | Reads-before-tx discipline; merge-by-key correctness  |
| 3. Validations + actions               | Thin actions, `toFailure` ladder, degradation typed  | Token never logged; degradation surfaced not thrown   |
| 4. UI                                  | `/setup/team` page + roster/cadence organisms        | Manual-mapping UX; three degradation/branch states    |
| 5. Onboarding signal + nav handoff     | `isOnboardingComplete` + re-pointed Continue         | Cross-change coordination with `onboarding-routing`   |

**Prerequisites:** S-02 + S-03 done (✓); local dev DB with a real stored GitHub PAT (`read:org` + `repo`) and Jira credential for manual verification.
**Estimated effort:** ~3–4 sessions across 5 phases.

## Open Risks & Assumptions

- Stored S-02 PAT may lack `read:org` — handled by degradation, but auto-import from GitHub is partial until the token is widened.
- Jira `timeZone` may be withheld by privacy → UTC fallback (start-day may need user override).
- The onboarding predicate's exact name/location must be confirmed with `onboarding-routing` before merge.
- `decryptToken` is unproven in production — the AAD `{ownerId, provider}` must exactly match what S-02/S-03 wrote (`"GITHUB"`/`"JIRA"`).

## Success Criteria (Summary)

- Roster auto-imports from both integrations, is fully editable, and edits survive a re-import.
- Cadence pre-fills from the active sprint and is overridable; `boardId` gets persisted.
- Wizard finishes gracefully even with a narrow PAT or no active sprint; completion drives `isOnboardingComplete` true and routes to `/dashboard`.
