# S-10 — manual checklist (owner side)

> Everything left that a human has to look at before PR #46 goes ready.
> Automated checks are all green at HEAD and are **not** repeated here.
>
> Item numbers map to `plan.md` `## Progress`, which stays canonical — tick them
> there too, or tick here and copy across at the end.

## Before you start

1. Local Supabase up (`npx supabase status`), migrations applied through `0007`.
2. `npm run dev`.
3. Re-seed the demo account: `EMAIL=<your-own-login> npm run db:seed:demo`
   (idempotent — clears and re-inserts).

**Which account for which row — they are not interchangeable.** The seed writes
*fake but properly encrypted* credentials, so read surfaces work and live API
calls fail cleanly. The account holding **real** GitHub/Jira credentials must
never be seeded — the script deletes both credential tables for its target.
Confirm which is which in `plan.md` § "Which account for which check" before
running anything destructive.

---

## A. Sprint Detail — the core deliverable (Progress 4.5–4.11)

Route: `/dashboard/sprint-detail`, on the seeded account.

- [ ] **4.5** All three surfaces render: aging report, activity matrix, sub-burndowns.
- [ ] **4.6** Aging report defaults to *time since last move*, descending. Every
      column sorts both ways.
- [ ] **4.7** Matrix switcher (Commits / Lines / PRs / Reviews) changes the
      rendered values. A commit without churn shows **`—`**, never `0`.
      The seed has exactly two such commits.
      *A day with zero commits renders blank, not `—`. That distinction is deliberate.*
- [ ] **4.8** Sub-burndown legible in light **and** dark theme; the `UNKNOWN`
      track is visually distinguishable from real tracks.
- [ ] **4.9** Usable at 10-inch tablet width: wide tables scroll **inside their
      own container**, the page body does not scroll horizontally.
- [ ] **4.10** Freshness timestamps and the error banner appear, with no raw
      error text.
- [ ] **4.11** A **fresh sign-up** (no setup at all) reaching this route from the
      nav gets the empty state, not an error page.

## B. Today retrofit (Progress 5.6–5.10)

Route: `/dashboard`.

- [ ] **5.6** Opens on the Anomaly Inbox; sorting and filtering behave exactly as
      before the tab retrofit.
- [ ] **5.7** All four tabs render; the freshness bar stays visible across tab
      switches (it now lives on the page, outside the tabs — see the Phase 5 §5
      amendment).
- [ ] **5.8** Yesterday's Activity matches the seeded fixture for the correct
      **zone-local** day (`Europe/Warsaw`), not the UTC day.
- [ ] **5.9** Reliability KPI shows its explanatory empty state when
      `committedSp` is null — use a fresh sign-up, not the seeded account.
- [ ] **5.10** Today page render latency is acceptable. This was never measured;
      the F8 fixes (bounded PR query, memoized formatters) should have helped.
      If it is slow, say so — the fix is pre-aggregation, **never** a second pool.

## C. Reducer arithmetic (Progress 2.5–2.6, 3.5)

- [ ] **2.5** Burndown day-0 remaining SP equals Σ SP over the sprint's tickets —
      and equals `committedSp` exactly when no ticket is `addedAfterSprintStart`.
- [ ] **2.6** Sub-burndown series visibly sum to the total series (spot-check one day).
- [ ] **3.5** Charts render legibly in both light and dark theme.

## D. Security spot-checks — watch the network tab, not the DB (Progress 1.7, 7.7)

- [ ] **1.7** No token value and no raw error text in Worker logs during a sync.
- [ ] **7.7** No token and no raw error text in the **response payload** of any
      Settings action. Specifically re-check **Sync now**: it used to return
      `classifyError`'s raw `err.message`; F3 narrowed it to `SyncNowOutcome`.
      Force a failure and confirm the payload carries only `status` (+ `reason`
      on SKIPPED).

## E. Settings (Progress 8.12)

- [ ] **8.12** `/settings/connections` usable at 10-inch tablet width and legible
      in dark mode.

## F. The two fixes that changed destructive behaviour — worth seeing live

Not in Progress; these are new in this review and only covered by integration tests.

- [ ] **F1** Settings → *Change monitored repositories* → **add** a repo while
      keeping an existing one. The kept repo's commits/PRs must **survive**.
      (Before the fix this silently wiped them.)
- [ ] **F2** Settings → *Change monitored project* → pick a **different** project.
      Expect: the destructive warning first, then after saving a panel saying the
      old sprints were discarded, with an **Import sprint cadence** button
      linking to `/setup/team`. Re-saving the **same** project must **not**
      discard anything.
- [ ] **F5** `npm run db:seed:demo` with a non-loopback `DATABASE_URL` must
      refuse to run unless `SEED_ALLOW_REMOTE=1`.

## G. Closeout (Progress 6.6)

- [ ] **6.6** Seed reset then re-run produces a coherent sprint story across both
      dashboards.

---

## Known, already recorded — do not re-log these

- **A successful reconnect does not clear a stale `sync_state`.** The card keeps
  showing the previous failure until a sync runs. Recorded under
  `plan.md` § Follow-ups #1.
- **Nothing refreshes the `sprint` row after setup.** Filed as roadmap **S-16**.
  This is why F2's flow hands you off to `/setup/team` rather than re-importing
  cadence itself.
- **`github-store.ts:157-166` has the same destructive delete-then-insert** that
  F1 fixed, on the wizard's *reconnect* path. Out of scope for this branch;
  recorded in the impl-review report under F1.

## If something fails

Note the row number and what you saw. Nothing here is expected to fail — but
rows 4.7, 5.8 and 5.10 are the ones most likely to, because they depend on
zone-local bucketing and on the `max:1` pool under a widened fan-out.
