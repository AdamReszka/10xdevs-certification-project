---
change_id: team-navigation-section
title: Roster and absences become a first-class Team section
status: archived
created: 2026-08-30
updated: 2026-08-31
archived_at: 2026-08-30T22:45:38Z
---

## Notes

Roadmap **S-19** (`context/foundation/roadmap.md`). PRD refs FR-006, FR-010.
Prerequisites S-08 and S-15, both `done`.

Outcome: roster and absences live under a first-class **Team** section instead
of being two tabs inside Settings.

**Cadence is not here.** It was split out at `/10x-frame` (2026-08-30) as
**S-29**: the clause promised moving a post-setup cadence surface that has never
existed. The working-day aging fix split out the same day as **S-28** and has
shipped (PR #89).

### Why this exists (recorded at S-08, 2026-08-25)

Settings carries Connections, Team and Absences, and S-14 added Anomaly rules.
Two of those four are "how SprintFlow reaches your data" and two are "who your
team is" — one nav that means two different things.

### Why it was deferred out of S-08

It MOVES `/settings/team`, which invalidates S-15 manual rows 5.3 / 5.4 — the
ones that verify the Settings nav reaches the roster at all. Those were ticked
on 2026-08-25, and re-opening them for a navigation preference was the wrong
trade at the time.

The roadmap also named this slice as the home for the post-setup cadence UI that
S-16 left out — which `/10x-frame` removed, because that UI does not exist to be
moved. It is S-29.

### Runs in a parallel worktree (2026-08-30)

Set up at `.claude/worktrees/team-navigation-section`, branch
`feat/team-navigation-section`, alongside S-26 (`disconnect-data-retention`) in
the main checkout. Checked against `context/foundation/parallel-worktrees.md`:

- **No migration** — this is routing and navigation, not schema. (S-26 carries
  one, which is why it stays in the main checkout.)
- **Seam overlap with S-26 is narrow.** S-26 works in `src/lib/absence-store.ts`,
  `src/db/schema.ts` and the disconnect actions under `settings/connections`;
  this slice works in `src/app/(app)/settings/layout.tsx` and the `team` /
  `absences` route folders. Expect a conflict in the Settings layout and in
  `roadmap.md` / `manual-test-backlog.md` at merge time.
- ~~**`npm run test:e2e` must not run while the S-26 session is running it**~~ —
  **wrong, corrected 2026-08-30 at `/10x-plan`.** The two specs named here touch
  `/settings/connections` only; nothing under `e2e/` references either moving
  route, so the move never forced a suite run. What the grep did find is the
  opposite problem, recorded in the roadmap's "How it was built": the doorstep
  spec enumerates the nav labels literally, so a fifth item silently stops being
  covered rather than failing. That one spec was updated and run on its own.
  Only `test:integration` genuinely shared state with the S-26 session.

### Settled

- **How far the move goes:** all the way. New `/team/roster`, `/team/absences`
  and `/team/days-off`, with `/team` as a stable redirect to the first tab, and
  307 stubs left behind at `/settings/team` and `/settings/absences`. Not a
  nav-only regrouping.
- **Cadence:** out. It is **S-29**, split out at `/10x-frame` on 2026-08-30
  because the surface it promised to move has never existed.
- **S-15 rows 5.3 / 5.4:** marked `SUPERSEDED` in place at
  `context/archive/2026-08-23-team-management-surface/plan.md:900-901` rather than
  re-opened — they were ticked, and the replacements belong to S-19. They are
  backlog rows **23.A** (nav reaches the roster) and **23.B** (active tab across
  all three tabs).
