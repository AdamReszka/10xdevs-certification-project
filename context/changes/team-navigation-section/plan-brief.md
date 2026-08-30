# Team Navigation Section (S-19) — Plan Brief

> Full plan: `context/changes/team-navigation-section/plan.md`
> Frame brief: `context/changes/team-navigation-section/frame.md`

## What & Why

Settings carries six tabs that mean two different things: four answer "how
SprintFlow reaches your data", two answer "who your team is". This slice moves
the second pair out into a first-class **Team** section at `/team/*`, and splits
the absences screen — which today carries individual absences and the company
holiday calendar on one page — into two tabs.

This is what remains of S-19 after `/10x-frame` (2026-08-30) took it apart. The
frame's reframed problem statement was about the anomaly rules, not the
navigation; that half shipped as **S-28** (PR #89). A post-setup cadence surface
became **S-29**. What is left is the part the owner called cosmetic and still
wants — *"przeniesienie tych dwóch stron i zmiana pathów byłaby spoko … myślę o
tym cały czas"* — and it is genuinely small.

## Starting Point

Six Settings tabs; `Team` and `Absences` are two of them. Live references to the
two moving routes number **five, in three files** — the tab list, the demo
`revalidatePath` array, and one deep link on the dashboard's Availability tab.
Everything else among ~35 grep hits is prose in comments and in `context/`.

Two claims recorded in `change.md` did not survive checking. **The E2E suite is
not affected**: the two specs it names touch `/settings/connections` only, and
nothing under `e2e/` references either moving route. **The S-27 demo boundary is
not affected either**: `boundary-inventory.test.ts` guards `/setup` and
`/settings/connections`, and the absence actions resolve the active workspace
rather than pinning the real owner, so they were never in its inventory.

## Desired End State

Five items in the header nav — Dashboard, Sprint Detail, **Team**, Settings,
Refinement. Team lands on `/team/roster` under a three-tab strip: Roster,
Absences, Team days off. Settings keeps four tabs and its subtitle, which was
already written as if this move had happened, is finally true. Old bookmarks to
`/settings/team` and `/settings/absences` redirect rather than 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slice scope | Navigation only | The frame split cadence into S-29 and working-day aging into S-28; S-19's own outcome text never described either | Frame |
| Route depth | New `/team/*` **with** redirects from the old paths | Honest URLs without breaking a bookmark or an archived document | Plan |
| Roster URL | `/team` redirects to `/team/roster` | Keeps `/team` a stable nav target as tabs are added — the exact shape `/settings/page.tsx` already uses | Plan |
| Absences page | Splits into `/team/absences` and `/team/days-off` | People and the company calendar are different models with different time horizons; the section now has room to say so | Plan |
| Redirect mechanism | 307 stub pages inside `(app)`, not a 308 in `next.config` | A 308 is cached permanently by the browser and cannot be invalidated remotely, so reversing the decision would cost every tester | Plan |
| Server Actions | One file, `src/app/(app)/team/actions.ts` | Both action families share the private `redetect()` helper, and `setup/team/actions.ts` is the precedent for one file serving two forms | Plan |
| Organism folders | Stay in `organisms/settings/` | `RosterEditor` already sets the convention that an organism's folder names its origin, not its mount points — moving six files changes nothing a user sees | Plan |

## Scope

**In scope:** `/team/{roster,absences,days-off}` plus a section shell and entry
redirect; redirect stubs at both old paths; Settings down to four tabs; a `Team`
nav entry; the three files holding live route references; the absences/days-off
split; roadmap S-19 corrected; `change.md` de-staled; manual-backlog section 22
with replacement rows for the two dead S-15 rows, plus a rewrite of 26 stale path
strings.

**Out of scope:** cadence (S-29), including the `saveCadence` between-sprints
silent no-op; moving the organism files; renaming `SettingsTabs`; any schema
change or migration; `npm run test:e2e`.

## Architecture / Approach

`src/app/(app)/team/` is a new route folder inside the existing `(app)` group, so
it inherits `requireSession()`, `force-dynamic`, the app shell and the demo
banner from `(app)/layout.tsx` with no new wiring — there is no `middleware.ts`
in this repo. Its `layout.tsx` reuses `SettingsTabs` unchanged; the molecule is
already section-agnostic. The moved pages are unchanged server components. The
old paths become two-line `redirect()` stubs that stay behind the session gate.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Routes move one-to-one | `/team/roster`, `/team/absences`, nav entry, stubs, three reference files updated | A missed reference — most likely `WORKSPACE_SCOPED_PATHS`, whose failure is silent (a stale screen after entering demo) |
| 2. Days off splits out | `/team/days-off` as a third tab; absences page sheds its second editor | Two editors that shared one page's reads now sit behind two separate `getActiveSprintRow` calls |
| 3. Copy, roadmap, backlog | Section copy, corrected S-19 entry, fixed `change.md`, backlog section 22 + 26 path rewrites | The path rewrite must be read occurrence by occurrence — days-off rows go to a different tab than absence rows |

**Prerequisites:** S-08 and S-15, both done. Runs in the parallel worktree at
`.claude/worktrees/team-navigation-section` on `feat/team-navigation-section`
(fast-forwarded to `origin/main`, which includes the S-28 merge). No migrations
here; coordinate `test:integration` with the S-26 session in the main checkout —
they share one local Postgres.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- **`WORKSPACE_SCOPED_PATHS` fails silently.** A stale entry does not error; it
  leaves the roster or absence screen rendering the previous workspace until the
  next navigation. Backlog row 22.E exists specifically to catch it.
- **The Phase 2 split is the only real regression surface.** Two editors that
  shared a page's `Promise.all` become two pages each reading
  `getActiveSprintRow` for its own reason. Row 22.D is the check.
- **The redirect stubs are debt with no expiry date.** They carry a dated comment
  naming S-19 so a future reader can judge when to delete them; nothing in this
  slice removes them.
- **Assumption: no external system links to the old paths.** The Daily Recap
  email was checked and does not; a stale link in a tester's own notes is covered
  by the stubs.

## Success Criteria (Summary)

- A lead reaches the roster from the header nav in one click, and the two Settings
  headings no longer overlap in meaning.
- Every old URL still lands somewhere sensible — no 404 from a bookmark.
- Recording an absence and recording a company day off both still move the
  numbers on the dashboard, after the page they lived on was split in two.
