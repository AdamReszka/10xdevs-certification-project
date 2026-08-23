# S-15 — manual checklist (owner side)

> Everything left that a human has to look at before PR #49 goes ready.
> Automated checks are all green at HEAD and are **not** repeated here:
> 350 unit tests, 121 integration tests, `typecheck`, `lint`, and a production
> build that lists `/settings/team` among the routes.

**How this file relates to `plan.md` `## Progress`** (which stays canonical):

- Every row below carries the number of the **phase it belongs to**. Tick it in
  that phase in `## Progress` as it passes.
- Rows **1.8, 1.9, 2.6–2.9, 3.5–3.7** are already ticked there. They were
  verified in-session by throwaway-account simulations that drove the real
  service functions and Server Actions against local Postgres, printing
  before/after state. They are listed here in **§E** so you can re-run them by
  hand if you want eyes on the UI rather than on a transcript — but they are not
  blocking.
- Rows **4.4–4.9** and **5.3–5.7** are **not** ticked. They are browser-only —
  dialog copy on screen, row muting, focus behaviour, nav, tablet width — and no
  simulation can stand in for them. These are the blocking ones.

## Before you start

1. Local Supabase up (`npx supabase status`), migrations applied.
2. `npm run dev` (not `wrangler dev` — `next dev` is what points at local
   Supabase on `:54322`).
3. Sign in and go to `/settings/team`.

### ⚠️ Which account — they are not interchangeable

`demo@sprintflow.test` holds the **real** GitHub/Jira credentials on this
machine; `adam.reszka85@gmail.com` holds the seeded fakes. The naming is
inverted from what you would guess, so **identify the target by the token's
last4, never by the account name.**

`npm run db:seed:demo` **deletes both credential tables for its target account**.
Never point it at the account holding real credentials. Nothing in this checklist
requires re-seeding — every row below works on an account that already has a
roster, and the destructive rows create and remove their own members.

---

## A. The confirmation dialogs (Progress 4.4–4.9)

Route: `/settings/team`.

- [ ] **4.4** Trash on a member **with** recorded absences or attributed
      anomalies: the dialog offers **Deactivate** only — no "Delete permanently"
      button — and the description states both counts and says the history stays
      with a deactivated member.
- [ ] **4.5** Trash on a **clean** member (no absences, no anomalies, not the
      last one): the dialog offers **both**, and "Delete permanently" removes the
      row for good. Refresh the page — it must still be gone.
- [ ] **4.6** Trash on the **last remaining** member: no "Delete permanently"
      button, and the description says the roster cannot be emptied.
- [ ] **4.7** Select two rows → **Merge selected**. The dialog names which row
      disappears and which name survives. Confirm; one row remains.
- [ ] **4.8** A deactivated row is visually muted, shows **Inactive** with a
      **Reactivate** link, and reactivating restores it. Unticking **Show
      inactive members** hides it; the default is shown.
- [ ] **4.9** Keyboard: the dialog traps focus, **Escape** cancels, and **Cancel**
      takes the default focus (not the destructive action).

## B. The Settings tab (Progress 5.3–5.7)

- [ ] **5.3** Main nav → **Settings** lands on Connections; the **Team** tab is
      beside it and renders the roster.
- [ ] **5.4** The active tab is visually distinct on **both** tabs — check
      Connections and Team, and confirm `/settings/connections/github` still
      highlights **Connections**.
- [ ] **5.5** Change someone's technology track from Settings → Team, save, and
      confirm it reaches the Sprint Detail sub-burndowns after the next sync.
- [ ] **5.6** `/setup/team` still works end-to-end on a fresh account: auto-import
      fires on an empty roster, the grid fills, Save persists.
- [ ] **5.7** Tablet width (10-inch floor, NFR): the grid scrolls horizontally and
      every control stays reachable. **This closes the parked S-04 backlog row
      4.6** — tick it here, not in `manual-test-backlog.md`.

## C. Re-import as a proposal (Progress 3.5–3.7, already verified)

- [ ] **3.5** Press **Re-import** on a populated roster. New people appear as
      rows badged **New — unsaved**, the summary line says how many and that
      nothing is saved until you press Save, and **no DB row appears** until you
      do. Check with psql before saving.
- [ ] **3.6** Deactivate someone, then re-import: they must **not** come back as
      a new proposal, and must still read **Inactive**.
- [ ] **3.7** With a GitHub token lacking `read:org`, the degradation banner shows
      and **nobody** is flagged "Not in GitHub/Jira any more" — a scope failure is
      not evidence that the team left.

## D. Lifecycle against psql (Progress 2.6–2.9, already verified)

- [ ] **2.6** What the dialog reports matches psql: `select count(*) from absence
      where team_member_id = …` and the same for
      `anomaly.related_team_member_id`.
- [ ] **2.7** A deactivated member disappears from the dashboard's member filter
      but their **existing anomalies still carry their name** — they must not
      silently re-label as team-level.
- [ ] **2.8** Trash on a persisted row removes them for real: gone after a full
      page refresh, not just from the grid.
- [ ] **2.9** Merging two persisted rows leaves **exactly one** row in psql.

## E. The save no longer destroys anything (Progress 1.8, 1.9, already verified)

This is the defect the whole slice exists for. Worth doing by hand once.

- [ ] **1.8** Note every member's `updated_at`. Edit **one** member's role in the
      UI and save. Exactly **one** row's `updated_at` moved.
- [ ] **1.9** Record an absence in psql against a member, save the roster from the
      UI, and confirm the absence **survives**. Before this slice it did not.
      Then deactivate someone in psql, reload the page, save — `is_active` stays
      `false`.

> **Known behaviour, not a bug:** saving from a page that was loaded *before* an
> out-of-band change overwrites that change, because the form carries every field
> back. This is last-write-wins and is shared with `role`, `name` and every other
> column — reload before saving if you have been editing in psql.

---

## When everything above is ticked

1. Tick the matching rows in `plan.md` `## Progress`.
2. Mark PR #49 ready for review.
3. After merge: flip the Linear **SPR-N** for S-15 to Done + `status:done` by
   hand — GitHub auto-closes the issue, Linear does not follow.
