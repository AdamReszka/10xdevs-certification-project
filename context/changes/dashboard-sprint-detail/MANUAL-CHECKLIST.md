# S-10 — manual checklist (owner side)

> Everything left that a human has to look at before PR #46 goes ready.
> Automated checks are all green at HEAD and are **not** repeated here.

**How this file relates to `plan.md` `## Progress`** (which stays canonical):

- Finishing **this entire file** is what closes the single Progress item
  **11.15**. There is deliberately no row numbered 11.15 below — 11.15 is the
  umbrella, not a check.
- Every numbered row below carries the number of the **phase it belongs to**
  (4.5–4.11 Sprint Detail, 5.6–5.10 Today, 2.5/2.6/3.5 reducers and charts,
  1.7 and 7.7 security, 8.12 Settings, 6.6 closeout). Tick each one in its own
  phase in `## Progress` as it passes.
- **Section F has no Progress counterpart.** Those rows are new in this review —
  live checks on the destructive fixes F1/F2/F5 — and exist only here.

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

- [x] **4.5** All three surfaces render: aging report, activity matrix, sub-burndowns.
- [x] **4.6** Aging report defaults to *time since last move*, descending. Every
      column sorts both ways.
- [x] **4.7** Matrix switcher (Commits / Lines / PRs / Reviews) changes the
      rendered values. A commit without churn shows **`—`**, never `0`.
      The seed has exactly two such commits.
      *A day with zero commits renders blank, not `—`. That distinction is deliberate.*
- [x] **4.8** Sub-burndown legible in light **and** dark theme; the `UNKNOWN`
      track is visually distinguishable from real tracks.
      *Verified by an agent-run Playwright capture, not by hand — the app ships no
      theme switch, so nobody can reach dark mode through the UI (`globals.css`
      keys the dark variant on a `.dark` class that nothing ever sets; the OS
      setting has no effect). Method: seed a sprint carrying all four tracks plus
      unattributable SP, screenshot the chart, force `.dark` on `<html>`, screenshot
      again. Both themes read cleanly and all five bands separate. `UNKNOWN` is
      dashed (`4 4`) as well as muted, so it stays distinguishable without relying
      on colour — which matters, since it is the closest pair to Backend in OKLab
      distance in both themes. Two caveats, both inherited from the stock shadcn
      chart palette and NOT introduced by S-10: QA (`--chart-4`) contrasts 1.72:1
      against the light card and Frontend (`--chart-1`) 2.63:1 against the dark
      card — both below the 3:1 WCAG non-text floor. Noted, not blocking.*
- [x] **4.9** Usable at 10-inch tablet width: wide tables scroll **inside their
      own container**, the page body does not scroll horizontally.
- [x] **4.10** Freshness timestamps and the error banner appear, with no raw
      error text.
- [x] **4.11** A **fresh sign-up** (no setup at all) reaching this route from the
      nav gets the empty state, not an error page.

## B. Today retrofit (Progress 5.6–5.10)

Route: `/dashboard`.

- [x] **5.6** Opens on the Anomaly Inbox; sorting and filtering behave exactly as
      before the tab retrofit.
- [x] **5.7** All four tabs render; the freshness bar stays visible across tab
      switches (it now lives on the page, outside the tabs — see the Phase 5 §5
      amendment).
- [x] **5.8** Yesterday's Activity matches the seeded fixture for the correct
      **zone-local** day (`Europe/Warsaw`), not the UTC day.
- [x] **5.9** Reliability KPI shows its explanatory empty state when
      `committedSp` is null — use a fresh sign-up, not the seeded account.
- [x] **5.10** Today page render latency is acceptable. This was never measured;
      the F8 fixes (bounded PR query, memoized formatters) should have helped.
      If it is slow, say so — the fix is pre-aggregation, **never** a second pool.

## C. Reducer arithmetic (Progress 2.5–2.6, 3.5)

- [x] **2.5** Burndown day-0 remaining SP equals Σ SP over the sprint's tickets —
      and equals `committedSp` exactly when no ticket is `addedAfterSprintStart`.
      *Agent-run, read from the Sprint Pulse **tooltip** — the number the lead
      actually sees — not from the reducer's return value. Seeded 8+13+5+3+5 = **34**
      SP with `committed_sp = 34`, deliberately self-consistent because that is the
      precondition the second half is asserted under. Day 0 read `Remaining SP 34`,
      `Ideal 34` — equal, as required. Then one 5 SP ticket was inserted with
      `added_after_sprint_start = true` and the page reloaded: day 0 read
      `Remaining SP 39`, `Ideal 34`. The divergence is exactly the crept 5 SP — the
      two agree when nothing crept and separate by precisely the creep when it did,
      which is the behaviour the plan's `committedSp` comment describes.*
- [x] **2.6** Sub-burndown series visibly sum to the total series (spot-check one day).
      *Done for **all nine days**, not one — sweeping the tooltips is cheap once
      automated. Per-track readings off the sub-burndown were summed and compared
      with Sprint Pulse's `Remaining SP` for the same day label. Every day matched
      exactly, including the days a track burns down:*

      | days | Frontend | Backend | Mobile | QA | Unattributed | Σ | total |
      |---|---|---|---|---|---|---|---|
      | 08-15 → 08-17 | 8 | 13 | 5 | 3 | 5 | 34 | 34 |
      | 08-18 → 08-19 | 8 | 13 | 0 | 3 | 5 | 29 | 29 |
      | 08-20 → 08-23 | 0 | 13 | 0 | 3 | 5 | 21 | 21 |

      *`Σ byTrack === total` is what stops the unattributed remainder being silently
      dropped, so it was worth checking every point rather than one.*
- [x] **3.5** Charts render legibly in both light and dark theme.
      *Verified the same way as 4.8 (agent-run Playwright capture in both themes,
      `.dark` forced on `<html>`), covering the two surfaces 4.8 did not: Sprint
      Pulse (burndown area + dashed ideal line + the "Tickets by status" tiles) and
      the Reliability KPI bars. Both read cleanly in dark; axis ticks, value labels
      and tooltips stay legible. Same `--chart-1` caveat as 4.8 — as a 20%-opacity
      area fill and as a solid bar it is fine; it is thin strokes that would suffer.*
      **Trap for anyone re-running this:** shadcn components carry `transition-all`,
      so toggling `.dark` ANIMATES every colour over ~150ms. A screenshot taken
      immediately captures light-theme controls on a dark page and reads exactly
      like a broken theme. Wait for computed colours to stop changing first.*

## D. Security spot-checks — watch the network tab, not the DB (Progress 1.7, 7.7)

- [x] **1.7** No token value and no raw error text in Worker logs during a sync.
      *Agent-run on the **real Workers runtime** (`opennextjs-cloudflare build` +
      `wrangler dev`), not `next dev`. **The cron path was the point**: `Sync now`
      cannot reach `scheduled.ts:92`, which is the only line that logs during a
      scheduled sync.*

      *Isolation was load-bearing. `enumerateOnboardedOwners` returns EVERY
      onboarded owner, and the local dev DB holds `demo@sprintflow.test` with
      **real** GitHub + Jira credentials (`AdamLisek`, `foxmind.atlassian.net`) —
      firing the cron against it would have run a real sync on a real workspace. So
      the run used a throwaway database (`sf_canary_17`, migrations 0000–0007) whose
      only owner was a canary account. `wrangler.jsonc` was NOT edited: the
      `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env var already in
      `.env.local` takes precedence over `localConnectionString`.*

      *Result: across four failure modes — valid-but-rejected canary token (GitHub
      401), non-resolving Jira host, deliberately corrupted credential envelopes,
      and a missing table mid-cycle — the Worker log contained **nothing** beyond
      the request line. Not a redacted message: no message. Failures are classified
      into `sync_state.status` (ERROR / RATE_LIMITED) rather than thrown, so the two
      `console.error` sites never even fire. The canary plaintext was also planted
      **inside** the corrupted `encrypted_token` value, so any path echoing the
      stored column would have surfaced it. It did not.*

      *Positive control (the part that makes the null result mean something): a
      temporary `console.error` placed in the `scheduled` handler DID appear in the
      wrangler log, proving the measurement can see output from that path. The
      instrumentation was reverted — `git diff src/worker.ts` is empty.*

      *Two notes for whoever repeats this. (1) `/cdn-cgi/handler/scheduled` returns
      `exception` / HTTP 500 in this project — the assets router swallows it; a
      no-op scheduled handler 500s the same way, so it is not the sync code. Use
      `wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=*%2F15+*+*+*+*"`.
      (2) `wrangler dev` reads secrets from `.dev.vars`, which is **not** in
      `.gitignore` (`.env*` does not cover it). Create it, then delete it.*

      *Not exercised: `actions.ts:79` (`[detect] syncNow detection failed`) needs
      `detectAnomalies` to throw, which nothing in this setup provokes. Static
      reading of both sites: each interpolates only `err.message`, every client
      error is a fixed string (`github.ts:104-107` deliberately does not attach the
      caught error as `cause` precisely so a request echo cannot ride along), and
      the token travels only in the `Authorization` header, never in a URL.*
- [x] **7.7** No token and no raw error text in the **response payload** of any
      Settings action. Specifically re-check **Sync now**: it used to return
      `classifyError`'s raw `err.message`; F3 narrowed it to `SyncNowOutcome`.
      Force a failure and confirm the payload carries only `status` (+ `reason`
      on SKIPPED).
      *Agent-run against **canary credentials**: distinctive plaintext tokens
      (`ghp-CANARY-…`, `jira-CANARY-…`) written through the real AES-GCM envelope, so
      decryption SUCCEEDS and the true token reaches the outbound call — the only
      state in which a leak is possible. Failures were forced for real: GitHub's API
      rejected the canary PAT (401) and the Jira workspace host does not resolve.
      Every Server Action response (`next-action` POSTs) was captured verbatim:*

      ```
      Sync now         1:{"github":{"status":"ERROR"},"jira":{"status":"SKIPPED","reason":"no_sprint"}}
      Test connection  1:{"ok":false,"reason":"auth"}          (GitHub)
      Test connection  1:{"ok":false,"reason":"unavailable"}   (Jira)
      ```

      *That is the whole body — 94–144 bytes each, no room for a message. Sync now
      shows both required branches at once: a real failure carrying `status` alone,
      and a SKIPPED carrying `status` + `reason`. Asserted absent from every payload:
      either canary plaintext, `Basic`/`Bearer` blobs, node network errors
      (`ENOTFOUND` / `getaddrinfo` / `fetch failed`), API error text (`Bad
      credentials`, `Unauthorized`, `401`), and stack frames. `toClientOutcome` is
      shared by both integrations, so GitHub's ERROR covers the branch Jira did not
      exercise here. Scope: Sync now + both Test connection actions; the mutating
      actions behind* Change monitored repositories / project *are F1/F2 and were
      left alone.*

## E. Settings (Progress 8.12)

- [x] **8.12** `/settings/connections` usable at 10-inch tablet width and legible
      in dark mode.
      *Agent-run capture at 810×1080 (iPad 10.2" portrait — the 10-inch floor the
      NFR names), on a seeded account in the mixed state that matters: GitHub
      `sync_state = ERROR` with repos + token last4, Jira OK, four `sync_attempt`
      rows spanning OK / ERROR / RATE_LIMITED / SKIPPED_FRESH. Both halves pass.
      Tablet: the two integration cards drop to one column and
      `scrollWidth - clientWidth === 0` on both `<html>` and `<body>` in each theme
      — no page-body horizontal scroll. Dark: nav, cards, status badges, the
      credential-rejected banner, the button row and the sync-history table are all
      legible; no raw error text anywhere on the page.*

## F. The two fixes that changed destructive behaviour — worth seeing live

Not in Progress; these are new in this review and only covered by integration tests.

- [x] **F1** Settings → *Change monitored repositories* → **add** a repo while
      keeping an existing one. The kept repo's commits/PRs must **survive**.
      (Before the fix this silently wiped them.)
      *UI verified by the owner. Data layer verified by agent-run integration test
      against real Postgres: the existing suite only asserts **commits** survive,
      but `github_pull_request.repo_id` cascades off the same `monitored_repo.id`
      and `github_review` cascades off the PR. Added a throwaway spec seeding all
      three, adding a repo, and asserting the kept repo's row id is unchanged and
      commit + PR + review all survive. Passed.*

      > ✅ **Found here, fixed here** (was: "needs a decision"). The picker
      > opens with **nothing pre-checked**. `repo-selector.tsx:44` starts at
      > `useState<Set<string>>(new Set())`, `repo-selection-editor.tsx` passes no
      > initial selection, and the list action returns only `{id, fullName}` with
      > no "currently monitored" flag — even though the service knows it. The
      > dialog reads as *add a repo* but behaves as *redefine the whole selection*.
      > Tick only the new repo, press `Save (1)`, and every existing repo is
      > deselected → deleted → its commits/PRs/reviews cascade away. By
      > `connection-service.ts`'s own comment that loss is **unrecoverable**: the
      > next sync's `since` window starts at `sync_state.lastSuccessfulSyncAt`,
      > which this path never touches. F1's stable-id fix protects only what stays
      > ticked, so it does not cover this. Contrast the Jira editor, which gates
      > the equivalent action behind an explicit destructive warning.
      >
      > **Fix applied.** `listAvailableRepos` now also returns `monitoredRepoIds`;
      > the Settings action surfaces it as `selectedRepoIds`; `RepoSelector` takes
      > an optional `monitoredRepoIds` prop and seeds its checkbox state from it
      > (the setup wizard omits the prop, so first-run behaviour is unchanged);
      > and the picker shows a destructive Alert naming every monitored repo the
      > pending save would drop, stating that the history does not come back.
      > The drop calculation lives in `repo-selection.ts` as a pure function so it
      > is unit-testable without component-test infrastructure (5 unit tests), and
      > `listAvailableRepos` gained 2 integration tests including owner scoping.
- [x] **F2** Settings → *Change monitored project* → pick a **different** project.
      Expect: the destructive warning first, then after saving a panel saying the
      old sprints were discarded, with an **Import sprint cadence** button
      linking to `/setup/team`. Re-saving the **same** project must **not**
      discard anything.
      *UI verified by the owner; the four stages are wired as described in
      `jira-project-editor.tsx` (`closed → warning → project → mapping`, then
      `discarded` only when `sprintsDiscarded` comes back true, with the
      `/setup/team` link). Data layer verified by agent-run integration test —
      the existing suite asserts the `sprint` rows only, so the throwaway spec
      added what happens around them:*

      - *`jira_ticket` and `jira_status_history` cascade away with the sprints —
        no orphans left pointing at a discarded sprint.*
      - *`board_id` and `time_zone` are nulled (they describe the project being
        left behind), and `status_mapping` is replaced with the new project's.*
      - *Re-saving the **same** project keeps sprints, tickets, history **and**
        the descriptors — `board_id`/`time_zone` are not collateral damage of a
        mapping fix.*
      - *The delta-cursor invariant, which is the subtle one:
        `updateJiraProject` never touches `sync_state`, so
        `jira_history_cursor` survives a project switch. Asserted that
        `jira_cursor_sprint_id` still points at the **deleted** sprint — so the
        guard described in `schema.ts` trips, the delta clause is dropped, and
        the new project is pulled in full. Had the cursor stayed live against a
        surviving sprint, the new project's tickets would have been silently
        invisible (the failure observed on a real project 2026-08-22).*
- [x] **F5** `npm run db:seed:demo` with a non-loopback `DATABASE_URL` must
      refuse to run unless `SEED_ALLOW_REMOTE=1`.
      *Agent-run, six cases. Every target was deliberately unreachable (`.invalid`
      hosts, port 1) and **no `EMAIL`/`OWNER_ID` was ever set**, so even a broken
      guard had no owner to resolve and would have exited before the deletes.*

      | case | `DATABASE_URL` host | `SEED_ALLOW_REMOTE` | result |
      |---|---|---|---|
      | A | `db.sf-canary.invalid` | unset | **refused**, exit 1 |
      | B | `127.0.0.1.evil.invalid` | unset | **refused**, exit 1 |
      | C | `not-a-url` | unset | **refused** (unparseable), exit 1 |
      | D | `db.sf-canary.invalid` | `1` | passed the guard, died on DNS |
      | E | `127.0.0.1` | unset | passed the guard, died on connect |
      | F | `localhost` | unset | passed the guard, died on connect |

      *B is the case worth having run: a host merely **starting with** `127.0.0.1`
      is still refused, so the check is equality against the loopback list and not a
      substring/prefix match — the shape that would have let
      `127.0.0.1.attacker.example` through. D confirms the override is the only
      thing that unlocks a remote target; E/F confirm the guard is not blanket-
      blocking local use. (`::1` is in the same equality list as E/F and was not
      run separately.) The guard sits **before** `client.connect()`, so a refused
      run never even opens a connection to the target — which is the point, since
      the failure mode is data loss on somebody's hosted database.*

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
