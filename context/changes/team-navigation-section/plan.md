# Team Navigation Section (S-19) Implementation Plan

## Overview

Roster and absences leave Settings and become a first-class **Team** section at
`/team/*`. The old paths stay reachable as redirect stubs; the main nav gains a
`Team` entry; and the absences page — which today carries two different models on
one screen — splits into `Absences` (people) and `Team days off` (the company
calendar).

This is the navigation half of what S-19 originally promised. The other two
halves were split out at `/10x-frame` (2026-08-30): the working-day aging fix
became **S-28** and has shipped (PR #89), and the post-setup cadence surface
became **S-29**. Cadence is not in this slice, and the roadmap's outcome line —
which promised to move a cadence surface that has never existed — is corrected
here.

## Current State Analysis

Settings is a six-tab shell (`src/app/(app)/settings/layout.tsx:20-28`) whose
tabs mean two different things. Four answer "how SprintFlow reaches your data"
(Connections, Daily recap, Anomaly rules, Demo); two answer "who your team is"
(Team, Absences). The shell's own subtitle says only the first — *"How SprintFlow
reaches your team's data, and what it watches"* — so the copy is already written
as if the move had happened.

**The move is small and the codebase makes it smaller than `change.md` feared.**

- **There are exactly five live route references**, in three files. Everything
  else among the ~35 grep hits is prose in comments or in `context/`:
  - `src/app/(app)/settings/layout.tsx:21-22` — the two `TABS` entries
  - `src/app/(app)/settings/demo/actions.ts:39-40` — two entries in
    `WORKSPACE_SCOPED_PATHS`, the `revalidatePath` list
  - `src/components/organisms/dashboard/availability.tsx:144` —
    `<Link href="/settings/absences">Manage</Link>`
- **`revalidatePath` exists in exactly one file.** `settings/demo/actions.ts` is
  its only caller in `src/`; every other surface refreshes with
  `router.refresh()` and says so in a comment. So the path-list edit is a single
  place, not a sweep.
- **There is no `middleware.ts`.** The auth gate is `(app)/layout.tsx`
  (`requireSession()` + `force-dynamic`), so `src/app/(app)/team/**` inherits
  gating, the demo banner and the app shell with no new wiring.
- **`SettingsTabs` (`src/components/molecules/settings-tabs.tsx`) is already
  generic — with one exception.** It takes `tabs: { label, href }[]` and marks
  the active one by prefix match, so it is reusable as the Team section's tab
  strip. The exception is line 26: `aria-label="Settings sections"` is
  hard-coded, and it is user-facing copy, not a component name. Reused verbatim,
  the Team strip would announce itself to a screen reader as Settings.
- **`/settings/page.tsx` is a bare `redirect("/settings/connections")`** with a
  comment saying it exists so `/settings` stays a stable URL as sections are
  added. `/team/page.tsx` copies that shape.

**No E2E spec references either moving route — but one pins the nav list.** The
two specs `change.md` worried about touch `/settings/connections` only
(`e2e/demo-boundary.spec.ts:54`, `e2e/dashboard-sprint-detail.spec.ts:240`), and
nothing under `e2e/` mentions `/settings/team` or `/settings/absences`. The claim
stops there, though: `e2e/setup-doorstep.spec.ts:71` loops over the literal list
`["Dashboard", "Sprint Detail", "Settings", "Refinement"]`, asserting each has
`toHaveCount(0)` on the doorstep, under a comment about *"four exits"*. Adding a
fifth nav item does not fail that test — it silently stops covering the new link,
which is the failure mode `lessons.md` records under *"A parallel worktree cannot
run the suite that guards the shape it is changing"*. The spec is updated in
Phase 1 and run once; that same lesson also corrects the port worry — the
constraint is `test:e2e` in TWO worktrees at once, and S-26 has finished
(`origin/feat/disconnect-data-retention`, epilogue committed), so ports 3000 and
3098/3099 are free.

**The S-27 demo boundary is not affected either.**
`src/lib/demo/boundary-inventory.test.ts` guards two page trees —
`src/app/(app)/setup` and `src/app/(app)/settings/connections` — neither of which
moves, and its action scan matches only actions that pin the real owner via
`requireRealWorkspace()`. The absence and day-off actions use
`resolveWorkspace()` and write freely in demo by design, so they are outside the
inventory both before and after the move.

**The absences page carries two models.**
`src/app/(app)/settings/absences/page.tsx` renders `AbsenceEditor` (individual
absences, S-08 / FR-010) and `TeamDaysOffEditor` (team-wide days off, S-23 /
FR-007) under two headings. Their reads barely overlap: the first needs
`listRoster` + `listAbsences` + `getJiraTimeZone` + `getActiveSprintRow` (for the
"planned" default), the second needs `listTeamDaysOff` + `getActiveSprintRow`
(for `workingDays`). `getActiveSprintRow` is the only shared call.

**Two S-15 manual rows die with the move.**
`context/archive/2026-08-23-team-management-surface/plan.md:900-901` — *"5.3
Settings → Team reachable from the nav and renders the roster"* and *"5.4 Active
tab is visually distinct on both tabs"* — both ticked on 2026-08-25. They assert
a navigation path that will no longer exist.

## Desired End State

A signed-in lead sees five items in the header nav: Dashboard, Sprint Detail,
**Team**, Settings, Refinement. Clicking Team lands on `/team/roster` with a
three-tab strip — Roster, Absences, Team days off — under a section heading that
says what the section is for. Settings keeps four tabs, all of them about
reaching data, and its subtitle is finally true.

Anyone arriving at `/settings/team` or `/settings/absences` from a bookmark, an
old note or an archived document is redirected to the new home rather than shown
a 404.

Verify by: `npm run build` succeeds; `npm run lint`, `npm run typecheck` and
`npm test` are green; visiting `/settings/team` in a browser lands on
`/team/roster` with the roster rendered; recording an absence still clears a
`DEVELOPER_INACTIVE` row from the inbox without a manual sync.

### Key Discoveries:

- Five live route references only, in three files (`settings/layout.tsx:21-22`,
  `settings/demo/actions.ts:39-40`, `dashboard/availability.tsx:144`)
- `revalidatePath` has one caller in `src/`: `settings/demo/actions.ts:46`
- No `middleware.ts`; gating is `(app)/layout.tsx` — a new `(app)/team/**` tree
  is gated for free
- `SettingsTabs` is section-agnostic except for its hard-coded `aria-label`
- `boundary-inventory.test.ts` guards `/setup` and `/settings/connections` only
- No E2E spec references either moving route, but `setup-doorstep.spec.ts:71`
  enumerates the four nav labels and must learn the fifth
- `RosterEditor` lives in `organisms/setup/` and is mounted by both the wizard and
  Settings — the repo's established convention is that an organism's folder names
  its origin, not its mount points

## What We're NOT Doing

- **Cadence.** No post-setup cadence surface, no fix for the `saveCadence`
  between-sprints silent no-op. That is **S-29**, split out at `/10x-frame`
  because S-19's own outcome text never described it.
- **Moving the organisms.** `absence-editor.tsx`, `absence-calendar-view.ts`,
  `team-days-off-editor.tsx` and `team-days-off-view.ts` stay in
  `src/components/organisms/settings/`. Moving six files changes nothing a user
  can see, and `RosterEditor` already sets the precedent that an organism folder
  names its origin (`organisms/setup/`, mounted by both the wizard and Settings).
- **Renaming `SettingsTabs`.** It is reused, not rewritten; renaming it to
  `SectionTabs` would touch every Settings import for a cosmetic gain inside a
  cosmetic slice. Its hard-coded `aria-label` is a different matter and IS
  fixed — one optional prop, no call-site churn.
- **Splitting the Server Actions file.** Both action families keep one home
  (`src/app/(app)/team/actions.ts`) because they share the private `redetect()`
  helper, and `setup/team/actions.ts` is the precedent for one actions file
  serving two independent forms.
- **Any schema change or migration.** This slice runs in a parallel worktree
  against the shared local Postgres; `db:migrate` is forbidden here.
- **The full `npm run test:e2e` suite.** Nothing under `e2e/` touches the moving
  routes, so a whole-suite run buys nothing here. The ONE spec this slice
  changes — `e2e/setup-doorstep.spec.ts` — is run on its own in Phase 1
  (`npx playwright test e2e/setup-doorstep.spec.ts`), which the worktree rules
  permit: they forbid two concurrent suites, and S-26 has finished.
- **A "Blocked" status bucket, demo changes, or any anomaly-rule work.**

## Implementation Approach

Three phases, each ending on a green build.

Phase 1 moves the routes one-to-one and makes every reference point at the new
home, so the app is consistent before anything is restructured. Phase 2 performs
the one structural change the owner asked for — separating people from the
company calendar. Phase 3 makes the words match: section copy, the roadmap entry
that promised the wrong thing, the stale `change.md`, and the manual-test
backlog, which holds 26 references to the two moved paths and two now-dead S-15
rows.

Moving a Next.js route folder is a `git mv` plus import-path updates; the pages
themselves are unchanged server components. The redirect stubs are ordinary
`(app)` pages calling `redirect()` — a 307, uncached, behind the session gate, so
reversing the decision is deleting two files rather than waiting out a browser's
permanent-redirect cache.

## Phase 1: The Team section exists; routes move one-to-one

### Overview

`/team/roster` and `/team/absences` become the real homes. Settings drops to four
tabs, the nav gains Team, the old paths redirect, and the three files holding
live references are updated. The absences page still renders both editors — the
split is Phase 2.

### Changes Required:

#### 1. Team section shell

**File**: `src/app/(app)/team/layout.tsx` (new)

**Intent**: Give the section its own shell — heading, subtitle and tab strip —
mirroring `settings/layout.tsx` so the two sections read as siblings. The heading
answers "who your team is", the counterpart to Settings' "how SprintFlow reaches
your data".

**Contract**: Default-exports a component taking `{ children: ReactNode }`.
Declares a module-level `TABS: { label: string; href: string }[]` with `Roster` →
`/team/roster` and `Absences` → `/team/absences` (Phase 2 adds the third).
Renders `SettingsTabs` from `@/components/molecules/settings-tabs` with
`label="Team sections"` (see the next item). Must NOT re-declare
`requireSession()` or `force-dynamic` — both are inherited from
`(app)/layout.tsx`.

#### 2. `SettingsTabs` takes its own label

**File**: `src/components/molecules/settings-tabs.tsx`

**Intent**: The one thing in the molecule that is not section-agnostic is the
`aria-label` on line 26. Parameterising it is what makes the reuse honest; it is
a different change from the rename this slice declines.

**Contract**: The props gain an optional `label?: string` defaulting to
`"Settings sections"`, used as the `<nav aria-label>`. Every existing Settings
call site is untouched by construction — the default preserves today's string.
The Team layout passes `label="Team sections"`.

#### 3. Team section entry point

**File**: `src/app/(app)/team/page.tsx` (new)

**Intent**: Keep `/team` a stable URL that always lands on the first section, so
adding a tab later never changes where the nav points.

**Contract**: `redirect("/team/roster")`. Same shape and same rationale as
`src/app/(app)/settings/page.tsx`.

#### 4. Roster page moves

**File**: `src/app/(app)/settings/team/page.tsx` → `src/app/(app)/team/roster/page.tsx`

**Intent**: Move the page unchanged. Its body already reads
`resolveWorkspace()` + one `getDb` handle and hands plain data to
`RosterEditor`; nothing about it depends on being under Settings.

**Contract**: Same default export, same reads (`listRosterForEditor`), same
props to `RosterEditor` — which keeps importing its actions from
`@/app/(app)/setup/team/actions`. Update the doc comment's self-reference from
`/settings/team` to `/team/roster`.

#### 5. Absences page moves

**File**: `src/app/(app)/settings/absences/page.tsx` → `src/app/(app)/team/absences/page.tsx`

**Intent**: Move unchanged in this phase — both editors still on one page — so
the move and the split are separately revertible.

**Contract**: Same default export and the same five parallel reads. Update the
doc comment's self-reference.

#### 6. Server Actions move

**File**: `src/app/(app)/settings/absences/actions.ts` → `src/app/(app)/team/actions.ts`

**Intent**: One mutation surface for the whole Team section. Both action families
already share the private `redetect()` helper, and `setup/team/actions.ts` is the
precedent for one actions file serving two independent forms.

**Contract**: All six exports keep their names and signatures —
`createAbsenceAction`, `updateAbsenceAction`, `deleteAbsenceAction`,
`createTeamDayOffAction`, `deleteTeamDayOffAction`, plus the `ActionFailure` /
`AbsenceMutationResult` types. Three importers must be repointed to
`@/app/(app)/team/actions`:
`src/components/organisms/settings/absence-editor.tsx:15`,
`src/components/organisms/settings/team-days-off-editor.tsx:11`, and
`src/lib/demo/workspace.integration.test.ts:40`. The sibling integration test
moves with it (`settings/absences/actions.integration.test.ts` →
`team/actions.integration.test.ts`).

The file also carries **seven runtime strings naming its own route** — six
`toFailure(err, "[settings/absences] …")` tags (lines 92, 121, 142, 181, 202) and
the `console.error` at line 230 — plus the doc comment at line 29. These are the
operator log, not prose: left alone they would name a route that from Phase 1
onward only redirects. All become `[team/absences]`, and the doc comment's
self-reference is updated to `/team/absences` and `/team/days-off`.

#### 7. Redirect stubs at the old paths

**Files**: `src/app/(app)/settings/team/page.tsx` (new stub),
`src/app/(app)/settings/absences/page.tsx` (new stub)

**Intent**: Bookmarks, archived docs and the manual-test backlog's own older rows
all point at the old paths. A 404 there would read as a broken app.

**Contract**: Each default-exports a component whose only statement is
`redirect("/team/roster")` / `redirect("/team/absences")`. Living inside `(app)`
means they inherit the session gate, so an unauthenticated visitor still reaches
login rather than learning the route map. A comment on each names S-19 and the
date, so a future reader can judge when they are safe to delete.

#### 8. Settings loses two tabs

**File**: `src/app/(app)/settings/layout.tsx`

**Intent**: Remove `Team` and `Absences` from `TABS`, leaving the four tabs that
are genuinely about reaching data.

**Contract**: `TABS` becomes Connections, Daily recap, Anomaly rules, Demo — in
that order, with the existing comment about Demo being deliberately last kept
intact. The doc comment's history paragraph gains one sentence recording that
S-19 moved two tabs out.

#### 9. Main nav gains Team

**File**: `src/components/molecules/main-nav.tsx`

**Intent**: Make the section first-class, which is the whole point of the slice.

**Contract**: `NAV_ITEMS` gains `{ label: "Team", href: "/team" }` positioned
between `Sprint Detail` and `Settings` — team data sits with the other
team-data surfaces, ahead of configuration. `NAV_FREE_PATHS` is untouched.

#### 10. Workspace revalidation list

**File**: `src/app/(app)/settings/demo/actions.ts`

**Intent**: `WORKSPACE_SCOPED_PATHS` drives `revalidatePath` on every demo
enter/exit/reset. Left stale, entering demo would leave the roster and absence
screens rendering the previous workspace until the next navigation.

**Contract**: `/settings/team` → `/team/roster`, `/settings/absences` →
`/team/absences`. Order within the array is irrelevant; membership is not.

#### 11. The doorstep E2E spec learns the fifth nav item

**File**: `e2e/setup-doorstep.spec.ts`

**Intent**: Line 71 asserts the doorstep offers no way out by naming each nav
link. A fifth link that the list does not know about is a hole in exactly the
assertion that exists to catch a partial nav regression.

**Contract**: `"Team"` joins the label array at line 71, and the comment above it
(*"the header links would be visible and the doorstep would have four exits"*,
line 47) says five. No other change to the spec.

#### 12. Dashboard deep link

**File**: `src/components/organisms/dashboard/availability.tsx`

**Intent**: The Availability tab's "Manage" button is the one in-app deep link
into absences from outside Settings.

**Contract**: `<Link href="/settings/absences">` → `href="/team/absences"` at
line 144.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`
- No live reference to the old paths remains. Two greps, both must return
  nothing — the loose `grep -rn "settings/team\|settings/absences" src e2e
  scripts` is NOT a criterion, since ~30 of its ~35 hits are historical prose in
  comments and a human judging "only comments" is not a check:
  - `grep -rn 'href="/settings/\(team\|absences\)"' src` — no live link
  - `grep -rn "(app)/settings/absences/actions\|\[settings/absences\]" src` —
    no live import and no stale log tag
- Integration tests pass: `npm run test:integration` (S-26 is not running one
  concurrently — confirm first; the suite shares the local Postgres)
- The doorstep spec still guards every nav link, now including Team:
  `npx playwright test e2e/setup-doorstep.spec.ts`

#### Manual Verification:

- The nav shows Team between Sprint Detail and Settings; clicking it lands on
  `/team/roster` with the roster rendered and the Roster tab marked active
- `/settings/team` and `/settings/absences` typed into the address bar redirect
  to the new paths; Settings itself now shows four tabs
- Recording an absence on `/team/absences` still clears the matching
  `DEVELOPER_INACTIVE` row from the dashboard inbox without pressing Sync now
- Entering demo from `/settings/demo` and then opening `/team/roster` shows the
  six-person demo team, not the real roster

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 2.

---

## Phase 2: Team days off becomes its own tab

### Overview

`/team/absences` keeps individual absences; the company calendar moves to
`/team/days-off` as a third tab, and the demo revalidation list learns about it. The two carry different models with different
time horizons — one is per person and per sprint, the other is a property of the
calendar that applies to every sprint spanning it — and the section now has room
to say so.

### Changes Required:

#### 1. Days-off page

**File**: `src/app/(app)/team/days-off/page.tsx` (new)

**Intent**: Host `TeamDaysOffEditor` alone, with the heading and explanatory copy
lifted from the second half of the current absences page.

**Contract**: Gated server component under `(app)` — one `getDb` handle, reads
`resolveWorkspace()`, then `listTeamDaysOff` and `getActiveSprintRow` (for
`workingDays`). Passes `daysOff` (already `YYYY-MM-DD`; the column is `date`, so
no zone resolution) and `workingDays` exactly as the current page does. Do NOT
re-declare `requireSession()` or `force-dynamic`.

#### 2. Absences page sheds the second editor

**File**: `src/app/(app)/team/absences/page.tsx`

**Intent**: Leave one thing on the page.

**Contract**: Drop the `TeamDaysOffEditor` import, its heading block and the
`listTeamDaysOff` read from the `Promise.all`. `getActiveSprintRow` stays — the
absence editor needs `sprintStartDay` for the "planned" checkbox default. Keep
the existing doc comment explaining why the absence list is deliberately
unwindowed.

#### 3. Workspace revalidation list gains the new route

**File**: `src/app/(app)/settings/demo/actions.ts`

**Intent**: `/team/days-off` is a third workspace-scoped route — it reads
`listTeamDaysOff` under `resolveWorkspace()` — and Phase 1 §10 only repointed the two
entries that already existed. Left out, entering or resetting demo would leave
this page rendering the PREVIOUS workspace's holidays until the next navigation,
which is the same silent failure Phase 1 §10 exists to prevent.

**Contract**: `WORKSPACE_SCOPED_PATHS` gains `/team/days-off`. Nothing is
removed; the array is membership, not order.

#### 4. Third tab

**File**: `src/app/(app)/team/layout.tsx`

**Intent**: Make the new page reachable.

**Contract**: `TABS` gains `{ label: "Team days off", href: "/team/days-off" }`
after Absences. Prefix matching in `SettingsTabs` requires no special handling —
`/team/days-off` is not a prefix of any sibling.

#### 5. Cross-reference the two halves

**Files**: `src/app/(app)/team/absences/page.tsx`,
`src/app/(app)/team/days-off/page.tsx`

**Intent**: The two used to sit on one screen, so a lead who knew where days off
lived will now find them gone. Each page's subtitle names the other.

**Contract**: One sentence in each page's subtitle prose pointing at the sibling
tab. No new component; plain text within the existing `<p>`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test` — in particular
  `src/components/organisms/settings/team-days-off-view.test.ts` and
  `absence-calendar-view.test.ts`, whose pure decision logic is untouched by the
  page split and must stay green as evidence of that
- Production build succeeds: `npm run build`

#### Manual Verification:

- `/team/days-off` renders the team-days-off editor with the existing rows;
  adding a public holiday there still lowers the sprint's capacity on the
  dashboard
- `/team/absences` shows only individual absences, and its subtitle points at the
  Team days off tab
- All three tabs highlight correctly when visited directly by URL
- In demo, `/team/days-off` shows the demo workspace's days off immediately after
  entering demo — not the real account's, and without a second navigation

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: Copy, roadmap, and the manual-test backlog

### Overview

The code is done; the words are not. Settings' subtitle finally matches its
contents, the roadmap stops promising a cadence surface, `change.md` stops
describing a slice that was rescoped, and the manual-test backlog — the file a
second, non-technical person works from alone — stops sending them to paths that
redirect.

**Prerequisite: rebase onto `main` first.** S-26 (`disconnect-data-retention`)
is finished and pushed on `origin/feat/disconnect-data-retention`, and it edits
both files this phase rewrites. It appends its own `## 21.` section to the
backlog — `origin/main` already has `## 21. S-28` there, so the tail renumbers
when S-26 lands — and its new rows add roughly eleven more `/settings/absences`
and `/settings/team` strings (`grep -c` gives 26 on this branch, 33 on theirs).
It touches `roadmap.md` too. So every count and section number below is
**relative, not literal**: take the next free section number and re-run the grep
after the rebase rather than trusting the figures recorded on 2026-08-30.
Phases 1 and 2 are pure `src/` work and do not collide — only this phase waits.

### Changes Required:

#### 1. Section copy

**Files**: `src/app/(app)/settings/layout.tsx`,
`src/app/(app)/team/layout.tsx`

**Intent**: Two sections, two sentences that no longer overlap.

**Contract**: Settings keeps its existing subtitle, which is now accurate as
written. The Team layout's subtitle states the section's job in the same
register — who the team is and when they are not working. No `h1` duplication:
Team's heading is an `h1` like Settings', and the pages below keep their `h2`s.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: The S-19 row and its detail block both describe a slice that no
longer exists. The at-a-glance row (line 53) still says "roster and absences move
out of Settings" — correct — while the detail block's outcome and the Backlog
Handoff row (line 568) still carry the cadence clause and the unrescoped status.

**Contract**: Set S-19 `status` to `done` in the at-a-glance table and the detail
block once the slice lands; add a "How it was built" note recording the three
decisions taken here (the `/team/*` shape with `/team` as a stable redirect, the
absences/days-off split, and 307 stubs rather than 308 permanent redirects), and
the finding that corrects `change.md`: no E2E spec touched either moving route.
Update the Backlog Handoff row (line 568) to match. S-29's row already says it
was split out of S-19 — leave it.

#### 3. Change identity file

**File**: `context/changes/team-navigation-section/change.md`

**Intent**: It still calls the slice "Roster, absences **and cadence**", still
says `status: preparing`, and its "Open at this point" section lists three
questions all of which are now answered.

**Contract**: `title` drops the cadence clause; `status: planned` at plan time
and `implemented` at close; `updated: 2026-08-30`. Replace "Open at this point"
with a "Settled" block recording the three answers. Correct the parallel-worktree
note: the E2E coordination warning is wrong — no spec references the moving
routes, so only `test:integration` needs coordinating with the S-26 session.

#### 4. Manual-test backlog — the two dead S-15 rows

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: S-15 rows 5.3 and 5.4
(`context/archive/2026-08-23-team-management-surface/plan.md:900-901`) assert a
navigation path this slice deletes. They were ticked, so they cannot simply be
re-opened in place — the replacement rows belong to S-19 and must carry S-19's
number.

**Contract**: A new `## <N>. S-19 team-navigation-section` section at the end of
the file, where `<N>` is the next free number AFTER the rebase — 22 as this plan
is written, 23 if S-26 has landed its own section by then. Rows are `<N>.A` …
`<N>.E`; the letters are stable, the number is assigned at execution time. In
Polish, matching the format established by the last existing section. It opens with
the one-sentence statement of what changed and why, then carries the blocking
rows. Each row carries the established four parts — *Gdzie / Co zrobić / Co musi
być prawdą / Dlaczego to łapie*. The set:

- **<N>.A** (replaces S-15 5.3) — the nav reaches the roster: `/team` from the
  header nav lands on `/team/roster` and lists the team.
- **<N>.B** (replaces S-15 5.4) — the active tab is visually distinct across all
  three Team tabs, visited both by clicking and by typing the URL directly.
- **<N>.C** — the redirects work: `/settings/team` and `/settings/absences` typed
  into the address bar land on the new paths, and Settings shows four tabs, not
  six. Catches a half-done move where a bookmark 404s.
- **<N>.D** — 🔴 the split did not break the write path: record an absence on
  `/team/absences`, then a company day off on `/team/days-off`, and confirm the
  dashboard's capacity and inbox both react. Catches the one real regression risk
  in Phase 2 — two editors that used to share a page now sit behind two separate
  reads of `getActiveSprintRow`.
- **<N>.E** — demo: entering demo and opening `/team/roster` AND `/team/days-off`
  shows the demo workspace on both — the demo team, and the demo's days off, not
  the real account's. Catches a stale `WORKSPACE_SCOPED_PATHS`, which fails
  silently: the screen renders, it is just the wrong workspace.

#### 5. Manual-test backlog — the 26 stale path strings

**File**: `context/foundation/manual-test-backlog.md`

**Intent**: Existing rows across sections 8, 11, 12, 13, 15, 16, 19, 20 and 21
send the tester to `/settings/team` or `/settings/absences` — twenty-six of them
on this branch, and about thirty-three once S-26's section merges. Count them
with `grep -c` after the rebase; do not trust the figure recorded here. The
redirects mean those rows still *work*, but a tester who reads "go to
`/settings/absences`" and lands somewhere else has to stop and ask whether that
is the bug.

**Contract**: Replace every occurrence of `/settings/team` with `/team/roster`
and `/settings/absences` with `/team/absences` — except where the row is
specifically about days off (sections 11 Phase 2, 21.C's neighbours), which
become `/team/days-off`. Read each occurrence before replacing; this is not a
blind `sed`. Add one line under the file's header noting the rename and its date,
so a tester holding a printed copy can reconcile.

#### 6. Slice checklist

**File**: `context/changes/team-navigation-section/MANUAL-CHECKLIST.md` (new)

**Intent**: The short list of what actually blocks the slice, per the 3–5 row
convention.

**Contract**: Rows `<N>.A`–`<N>.E` copied verbatim from the backlog section, each
carrying the `## Progress` row it signs off so the two tick in step. The mapping,
read against the Progress block as it stands after this review:

| Row | Signs off |
| --- | --- |
| `<N>.A` nav reaches the roster | `1.8` |
| `<N>.B` active tab across all three tabs | `2.7` |
| `<N>.C` old paths redirect, Settings shows four tabs | `1.9` |
| `<N>.D` 🔴 the write path survived the split | `1.10` and `2.5` |
| `<N>.E` demo shows the demo workspace on both pages | `1.11` and `2.8` |

Every blocking row lands in Phase 1 or 2 — Phase 3 changes no behaviour a tester
can click, so it signs off nothing here. Re-read the numbers against `## Progress`
before writing the file; they shift whenever a criterion is inserted.

#### 7. Backlog reconciliation sweep

**Intent**: The convention in `CLAUDE.md` requires the sweep at the closing phase
of implementation, before the epilogue commit — the backlog must contain every
open manual row in the repo.

**Contract**: `node scripts/manual-test-sweep.mjs` exits zero.

### Success Criteria:

#### Automated Verification:

- Manual-test sweep passes: `node scripts/manual-test-sweep.mjs`
- No stale path strings remain in the backlog:
  `grep -c "settings/team\|settings/absences" context/foundation/manual-test-backlog.md`
  returns 0
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Reading the Team section's heading and the Settings heading side by side, it is
  obvious which section answers which question
- The roadmap's S-19 entry no longer mentions cadence, and its status matches
  reality
- A tester opening `manual-test-backlog.md` at the new S-19 section can execute
  its five rows without asking a question

---

## Testing Strategy

### Unit Tests:

No new unit tests. This slice adds no decision logic — every moved file is either
a server component doing owner-scoped reads or a Server Action that already
delegates to a service core. The repo has no component-test harness (no jsdom, no
RTL), so nav and tab rendering is not unit-testable here by design.

The existing pure-logic tests are the regression evidence that the Phase 2 page
split changed no behavior:
`src/components/organisms/settings/absence-calendar-view.test.ts` and
`team-days-off-view.test.ts` must stay green untouched.

### Integration Tests:

`src/app/(app)/team/actions.integration.test.ts` (moved from
`settings/absences/`) and `src/lib/demo/workspace.integration.test.ts` both
import the absence actions by path; they are the proof the actions file moved
without breaking its contract. Run once, in Phase 1, and only after confirming
the S-26 session in the main checkout is not running the suite — both worktrees
share one local Postgres.

### Manual Testing Steps:

1. Sign in, click **Team** in the header → lands on `/team/roster` with the team
   listed and the Roster tab marked active.
2. Click through all three Team tabs, then reload each by URL → the correct tab
   is highlighted each time.
3. Type `/settings/team` and `/settings/absences` in the address bar → both
   redirect; Settings shows four tabs.
4. Record an absence on `/team/absences` → the matching `DEVELOPER_INACTIVE` row
   leaves the dashboard inbox without pressing Sync now.
5. Record a company day off on `/team/days-off` → the sprint's capacity on the
   dashboard drops by one man-day per person.
6. Enter demo, open `/team/roster` → the demo team, not the real roster.

## Migration Notes

No schema change, no migration, no data movement. The only migration-shaped
concern is URLs held outside the app — browser bookmarks and the manual-test
backlog — and both are handled: the stubs keep old URLs working, and Phase 3
rewrites the backlog's strings.

The stubs are deliberately 307 (a server-component `redirect()`), not a 308 from
`next.config`. A 308 is cached permanently by the browser and cannot be
invalidated remotely, which would make reversing this decision expensive for
every tester who had visited an old path once.

## References

- Frame brief: `context/changes/team-navigation-section/frame.md`
- Roadmap entry: `context/foundation/roadmap.md:53,568,634-651`
- Dead S-15 rows: `context/archive/2026-08-23-team-management-surface/plan.md:900-901`
- Pattern to follow for the section shell: `src/app/(app)/settings/layout.tsx`
- Pattern to follow for the entry redirect: `src/app/(app)/settings/page.tsx`
- Reusable tab strip: `src/components/molecules/settings-tabs.tsx`
- One actions file, two forms (precedent): `src/app/(app)/setup/team/actions.ts`
- Organism folder names its origin (precedent):
  `src/components/organisms/setup/roster-editor.tsx`, mounted by both the wizard
  and `/settings/team`
- Demo boundary, unaffected: `src/lib/demo/boundary-inventory.test.ts`
- Backlog row format to match: `context/foundation/manual-test-backlog.md` §21

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The Team section exists; routes move one-to-one

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 60079c3
- [x] 1.2 Linting passes: `npm run lint` — 60079c3
- [x] 1.3 Unit tests pass: `npm test` — 60079c3
- [x] 1.4 Production build succeeds: `npm run build` — 60079c3
- [x] 1.5 No live href, import or log tag names the old paths (the two precise greps return nothing) — 60079c3
- [x] 1.6 Integration tests pass: `npm run test:integration` (coordinate with the S-26 session first) — 60079c3
- [x] 1.7 Doorstep spec passes with Team in its nav list: `npx playwright test e2e/setup-doorstep.spec.ts` — 60079c3

#### Manual

- [ ] 1.8 Nav shows Team; clicking it lands on `/team/roster` with the roster rendered and the Roster tab active
- [ ] 1.9 `/settings/team` and `/settings/absences` redirect; Settings shows four tabs
- [ ] 1.10 Recording an absence still clears the matching `DEVELOPER_INACTIVE` row without pressing Sync now
- [ ] 1.11 In demo, `/team/roster` shows the demo team, not the real roster

### Phase 2: Team days off becomes its own tab

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — a0dbd63
- [x] 2.2 Linting passes: `npm run lint` — a0dbd63
- [x] 2.3 Unit tests pass: `npm test`, including the two untouched pure-view tests — a0dbd63
- [x] 2.4 Production build succeeds: `npm run build` — a0dbd63

#### Manual

- [ ] 2.5 `/team/days-off` renders the editor with existing rows; a new public holiday still lowers the sprint's capacity
- [ ] 2.6 `/team/absences` shows only individual absences and points at the Team days off tab
- [ ] 2.7 All three tabs highlight correctly when visited directly by URL
- [ ] 2.8 In demo, `/team/days-off` shows the demo workspace's days off immediately after entering demo

### Phase 3: Copy, roadmap, and the manual-test backlog

#### Automated

- [x] 3.1 Manual-test sweep passes: `node scripts/manual-test-sweep.mjs` — d95eede
- [x] 3.2 No stale path strings remain in `manual-test-backlog.md` — d95eede
- [x] 3.3 Linting passes: `npm run lint` — d95eede
- [x] 3.4 Unit tests pass: `npm test` — d95eede
- [x] 3.5 Production build succeeds: `npm run build` — d95eede

#### Manual

- [ ] 3.6 The two section headings make it obvious which answers which question
- [ ] 3.7 The roadmap's S-19 entry no longer mentions cadence and its status matches reality
- [ ] 3.8 A tester can execute the new S-19 backlog section's five rows without asking a question
