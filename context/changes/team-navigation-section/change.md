---
change_id: team-navigation-section
title: Roster, absences and cadence become a first-class Team section
status: preparing
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

Roadmap **S-19** (`context/foundation/roadmap.md`). PRD refs FR-006, FR-010.
Prerequisites S-08 and S-15, both `done`.

Outcome: roster, absences and cadence live under a first-class **Team** section
instead of being three tabs inside Settings.

### Why this exists (recorded at S-08, 2026-08-25)

Settings carries Connections, Team and Absences, and S-14 added Anomaly rules.
Two of those four are "how SprintFlow reaches your data" and two are "who your
team is" — one nav that means two different things.

### Why it was deferred out of S-08

It MOVES `/settings/team`, which invalidates S-15 manual rows 5.3 / 5.4 — the
ones that verify the Settings nav reaches the roster at all. Those were ticked
on 2026-08-25, and re-opening them for a navigation preference was the wrong
trade at the time.

The roadmap also names this slice as the home for the post-setup cadence UI that
S-16 left out.

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
- **`npm run test:e2e` must not run while the S-26 session is running it** —
  shared port 3000 and fixture ports 3098/3099. Two specs reference `/settings`
  (`e2e/demo-boundary.spec.ts`, `e2e/dashboard-sprint-detail.spec.ts`), so moving
  routes means the suite has to be run — coordinate the window.

### Open at this point

- How far the move goes: new `/team/*` routes with redirects from
  `/settings/team` and `/settings/absences`, versus a nav-only regrouping.
- Whether the post-setup cadence UI (S-16's leftover) is in this slice or stays
  separate.
- Which manual rows S-15 5.3 / 5.4 are replaced by.
