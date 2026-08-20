---
change_id: setup-team-roster-cadence
title: Setup wizard — team roster + sprint cadence (S-04)
status: impl_reviewed
created: 2026-08-20
updated: 2026-08-20
archived_at: null
---

## Notes

Roadmap S-04 (setup wizard steps 3 + 4 of 4 — completes the wizard). Outcome: user reviews/edits the auto-imported team roster (name, GitHub username, Jira account ID, role, SP capacity per sprint, technology track from frontend/backend/mobile/QA — track mutable over time), and sprint cadence (length, start day, working days) is auto-pulled from the monitored Jira project's active sprint and is overridable. PRD refs: FR-006, FR-007. Prereqs S-02, S-03 (both done ✓).

**New API surfaces (not yet built):**
- **GitHub Collaborators API** + **Jira project members API** for roster auto-import.
- **Jira Agile API** (`/rest/agile/1.0/board?projectKeyOrId=…` → active sprint) for cadence — this is the **`boardId` discovery deliberately deferred from S-03**. `jiraProject.boardId` column already exists and is currently null; S-04 populates it. Note Agile API auth is the same Basic-auth Jira Cloud pattern as S-03's `src/lib/jira.ts`, but a **different base path** (`/rest/agile/1.0`, not `/rest/api/3`).

**Schema already exists (F-02) — likely no migration:** `team_member` (name, githubUsername, jiraAccountId, role, spCapacity, technologyTrack, source, isActive) and `sprint` (jiraSprintId, name, state, startDate, endDate, committedSp, completedSp, **lengthDays, startDay, workingDays (jsonb), cadenceOverridden**). Confirm at plan time.

**Template to copy:** the S-02/S-03 setup-step pattern — injectable request-context-free service core + thin Server Actions + `SetupWizardShell` step. Reuse the Basic-auth Jira client (`src/lib/jira.ts`) and the GitHub client (`src/lib/github.ts`); extend both with the members/collaborators + Agile-board reads. This is the LAST wizard step, so it also finalizes the "onboarding complete?" signal that `onboarding-routing` consumes.

**Open unknown (roadmap):** roster dedup strategy — GitHub collaborators and Jira members won't perfectly overlap; match by email or manual mapping. Manual-matching fallback is sufficient for MVP (Owner: TBD, resolve at plan/research time).

**Nav coordination:** S-03 shipped a placeholder "Continue →" on the Jira connected card pointing at `/dashboard`. S-04 introduces the real step-3 route (`/setup/team` or similar) — re-point that Continue target and coordinate the wizard-completion handoff with `context/changes/onboarding-routing/`.

**Why research before plan:** three new external API surfaces (GitHub Collaborators, Jira members, Jira Agile/boards) + the dedup decision + confirming the F-02 cadence columns fit FR-007 — enough unknowns that a `/10x-research` pass will make the plan much sharper.
