# Sprint Identity Visibility (S-25) — Plan Brief

> Full plan: `context/changes/sprint-identity-visibility/plan.md`
> Frame brief: `context/changes/sprint-identity-visibility/frame.md`

## What & Why

> No surface states the sprint's identity as a **checkable fact** — a name
> together with the dates that let the lead compare it against Jira — and where an
> identity claim is made at all, it is either buried in prose, styled as an aside,
> or fabricated by a fallback when the sprint is unknown.

Raised by the tester on 2026-08-30 after switching the monitored Jira project from
`FM` to `PT`. It is not cosmetics: the failure it traces back to is S-16's
`jira_sprint_id=1001` surviving a real Jira connection with a green sync and an
empty dashboard. Recognising that state needs an identity that can be checked
against something the lead independently knows.

## Starting Point

The name exists in three different states of absence. The cadence step has it
inside a `CardDescription` sentence; Sprint Detail has it as a muted
`<Badge variant="secondary">`; Today has no identity element at all —
`sprintName` reaches exactly one panel, in a tab that is not the default, and two
of three empty-state branches never print it. The Daily Recap email names the
sprint only in its subject, and only when there is at least one anomaly. The
dates — `sprint.start_date` / `end_date`, populated from Jira since S-04 — render
nowhere.

## Desired End State

Every surface that shows sprint data answers "which sprint is this?" in one
glance: `PT Sprint 1 · 30.08 – 12.09`, in the team's own time zone. On an account
with no sprint, each surface says so in words rather than substituting "the active
sprint".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the real problem is | Identity as a checkable fact, not prominence | Prominence is executable on only one of the three surfaces; Today has nothing to restyle | Frame |
| Scope | Three UI surfaces + the recap email; Absences excluded | Naming the sprint on Absences decides which sprint an absence belongs to — that is S-20's question | Frame |
| Where identity lives | A shared bar in the page header row on both dashboards | One implementation, beside the `<h1>` but never inside it, and next to the "Sprint closed" badge it qualifies; keeps the `<h1>` strings the E2E suite pins | Plan |
| Time zone | The team's Jira zone, via `dayKeyInTimeZone` | The roadmap's "render UTC" instruction misreads backlog §5, which is about `sync_state` timestamps; the cadence step already derives `startDay` in the team's zone, and a UTC reading would show 29.08 for a sprint everyone calls 30.08 | Plan |
| Date format | `30.08 – 12.09`, year only outside the current year | Fits on one line beside the name; the year keeps the Sprint Detail switcher unambiguous | Plan |
| Unknown identity | Say so — `Sprint: none active`, `Sprint <id>` for a nameless one | An absent element cannot be told apart from a failed render; `?? "the active sprint"` claims what it has not verified. The copy deliberately avoids `No active sprint`, which three existing empty states already render and one E2E test pins exactly | Plan + review F1 |
| Recap email | In, as a separable final phase | Cheap and hermetically testable, but unverifiable manually until Resend lands | Frame + Plan |

## Scope

**In scope:** the wizard's cadence step; Dashboard "Today"; Dashboard "Sprint
Detail"; the Daily Recap email; removal of the two identity-fabricating fallbacks.

**Out of scope:** Settings → Absences (S-20 owns the meaning); `sync_state.*_at`
rendering; any time-of-day display; any migration. Sprint-resolution BEHAVIOUR is
also out of scope — `getActiveSprintRow` is unchanged — but the wizard's cadence
step is switched onto it from its own hand-rolled `state = 'ACTIVE'` query, so the
wizard and the dashboards stop being able to disagree about which sprint exists
(review F6).

## Architecture / Approach

One pure module, `src/lib/sprint-identity.ts`, owns every formatting decision and
returns a discriminated `SprintIdentityView` of plain strings — including the
nameless-sprint spelling, which moves here out of `sprint-selection.ts` so the
switcher and the identity bar cannot drift (review F7). One shared component,
`src/components/molecules/sprint-identity-bar.tsx`, renders it on all three UI
surfaces; `molecules/` rather than `organisms/dashboard/` because the wizard's
setup organism mounts the same component (review F8). Each surface asks for a view
and renders it — including `cadence-form.tsx`, a client component,
which receives the formatted view rather than `Date`s plus a zone, keeping all
`Intl` work on the server side of the boundary. Sprint Detail's three-way branch
(active / selected / measurement-only) is extended in the pure module that already
owns it, `sprint-selection.ts`, so "where do the dates come from when the `sprint`
row was cascade-deleted" is answered by a test rather than by an untestable server
component.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure identity module | `sprint-identity.ts` + test: format, year rule, nameless sprint, no-sprint | Zone/DST edge cases — mitigated by testing the Warsaw boundary case directly |
| 2. Selection carries dates | `sprint-selection.ts` carries dates through all three branches | The `measurement-only` branch silently taking the ACTIVE sprint's dates — the exact failure that file exists to prevent |
| 3. Identity bar on both dashboards | Today gains identity; Sprint Detail's badge is replaced; velocity fallback removed | Two E2E pins, neither runnable here: touching the `<h1>` breaks `dashboard-sprint-detail.spec.ts:82,161`, and reusing the string `No active sprint` breaks `:163` |
| 4. Wizard cadence step | Dates threaded up from `roster-store.ts`; identity out of the prose | Four files in one plumbing chain; a missed branch shows nothing on first paint |
| 5. Daily Recap email | Sprint named in both bodies and in the zero-anomaly subject | Older stored payloads lack the new fields and history must still render |

**Prerequisites:** none beyond a working checkout — S-04, S-07, S-10 and S-16 are
all done. No migration, which is what makes this safe to build in a parallel
worktree.
**Estimated effort:** ~1–2 sessions across five phases; Phases 1–2 are small and
purely additive, Phase 4 is the widest diff.

## Open Risks & Assumptions

- **The zone choice departs from the letter of the roadmap entry**, which says
  "do not fix UTC here". The plan records why: that instruction cites backlog §5,
  which is about `sync_state.*_at`, not sprint dates. The roadmap should be
  corrected in the same PR rather than left contradicting the code.
- **E2E cannot be run from this worktree**, so its assertions are verified only
  after the branches merge. Two mitigations, both structural rather than
  procedural: identity is a sibling of the heading and never inside it, and the
  empty-state copy is a string no existing element uses (`Sprint: none active`),
  greppable without Playwright.
- **Assumption:** `jira_project.time_zone` is populated for real accounts;
  `safeZone` degrades an absent or invalid zone to UTC without throwing, so the
  worst case is the old behaviour rather than a crash.

## Success Criteria (Summary)

- A lead landing on Dashboard "Today" can name the sprint and its dates without
  opening a tab or leaving the page.
- Switching sprints on Sprint Detail changes the identity on screen, including for
  a sprint whose raw rows are gone.
- No surface tells a lead about "the active sprint" on an account that has none.
