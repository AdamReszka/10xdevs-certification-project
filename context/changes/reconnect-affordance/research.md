---
date: 2026-08-31T08:18:35+0200
researcher: Adam Reszka
git_commit: 9f26609b8df29d60adadf4c705a38433e913070d
branch: feat/reconnect-affordance
repository: 10xdevs-certification-project
topic: "S-31 — Reconnect and Disconnect stop looking like the same decision"
tags: [research, codebase, settings-connections, integration-card, disconnect, reconnect, copy, s-31]
status: complete
last_updated: 2026-08-31
last_updated_by: Adam Reszka
---

# Research: S-31 — Reconnect and Disconnect stop looking like the same decision

**Date**: 2026-08-31T08:18:35+0200
**Researcher**: Adam Reszka
**Git Commit**: `9f26609b8df29d60adadf4c705a38433e913070d`
**Branch**: `feat/reconnect-affordance` (parallel worktree `.claude/worktrees/reconnect-affordance`)
**Repository**: 10xdevs-certification-project

## Research Question

S-31 says: *a lead whose token expired can see, without experimenting, which
control rotates it losslessly — and Disconnect stops reading as the natural thing
to press when an integration is broken.* Shape: **copy and layout, no schema and
no store change.**

Before planning that, four things had to be established against the live code,
not against the roadmap's summary of it:

1. What is actually on screen today — every surface, every string, every variant.
2. Whether the load-bearing claim ("token rotation is already lossless") is still
   true at HEAD, in every branch, for **both** integrations.
3. What S-24 and S-26 already fixed in the dialog, so this slice continues those
   decisions instead of reopening them.
4. Which test assertions pin the strings this slice will rewrite — because
   `lessons.md` #9 says a parallel worktree breaks exactly those, silently.

## Summary

**The premise holds, but it is narrower than the roadmap states, and it has
become asymmetric between the two integrations.**

- **Jira: the asymmetry is real and worth a UI promise.** Re-submitting the
  credential form with the **same project** never deletes the `sprint` row —
  `storeJiraIntegration` upserts with `id` omitted from the SET, and the `sprint`
  delete is gated on `previous.jiraProjectId !== project.jiraProjectId`
  (`jira-store.ts:185-196`, `:205-211`, `:258-261`). Disconnect, by contrast,
  deletes `jira_credential`, and that cascades through
  `jira_project → sprint → jira_ticket / jira_status_history / anomaly`
  **unconditionally, in both `keep` and `clear` modes** (`jira-store.ts:320-337`).
- **GitHub: the asymmetry has largely closed since S-26, and nobody wrote that
  down.** `storeGithubIntegration` stopped being a delete-then-insert; it is now
  an upsert on `(ownerId, githubRepoId)` plus a targeted delete of only the
  deselected repos (`github-store.ts:177-202`). And `monitored_repo.credential_id`
  is `ON DELETE SET NULL`, so a `keep`-disconnect leaves the repos and all synced
  commits/PRs/reviews alive, and the reconnect upsert re-points `credential_id`
  onto the same row ids (`github-store.ts:169-175`). **GitHub
  disconnect(keep) → reconnect(same repos) is now equivalent to a resubmit.**
- **So the sentence "Disconnect costs you everything, Reconnect costs you
  nothing" is only true of Jira, and only about the currently-open sprint.** The
  concrete, unrecoverable thing a Jira disconnect destroys that a resubmit does
  not is the FR-023 commitment freeze — `sprint.committedFrozenAt` /
  `committedSp` — which the next sync re-freezes at the post-reconnect ticket
  set, silently mislabelling the sprint's commitment. Closed-sprint history
  (`sprint_measurement`) is safe in every branch; `shouldRecompute` refuses to
  touch a finalized record (`sweep.ts:65-67`).
- **The card's problem is confirmed, and it is narrower than "two buttons look
  alike".** `Reconnect` and `Test connection` are both `variant="outline"`;
  `Disconnect` is `variant="ghost"` — already the *lightest* control of the three
  (`integration-card.tsx:265-290`). The failure alert already tells the lead to
  reconnect (`failure-reason.ts:52-57`). What is missing is not emphasis on
  Disconnect's danger; it is that **nothing names the job** — three controls
  named after mechanisms, in a row, with equal-to-lighter weight, and the one
  piece of guidance buried in alert prose above them.
- **A direct conflict to resolve before planning.** S-24's plan froze
  *"No visual re-weighting of the buttons … Owner's decision — the dialog is the
  gate"*. S-31's roadmap entry says *"make the lossless one the obvious route"*.
  S-26 explicitly deferred this to S-31 (*"that Disconnect sits beside it looking
  equally reasonable is a UI question this slice does not own"*). S-31 is the
  slice licensed to revisit it — but it is a **reversal of a recorded owner
  decision**, and should be taken as one, not slipped in.

## Detailed Findings

### 1. The live surface

Six places render these controls; only **one** has a `Reconnect` button.

**`IntegrationCard` (`src/components/organisms/settings/integration-card.tsx`)** —
the target of this slice.

- Not-connected branch (`:178-202`): `CardDescription` = `"Not connected."`
  (`:185`); a single primary `Button` `Connect {name}` — a link to
  `reconnectHref` (`:194-196`), disabled in demo (`:192`).
- Connected branch (`:207-307`): status `Badge` (`:58-62`) — `OK`→"Healthy"
  (`secondary`), `ERROR`→"Failing" (`destructive`), `RATE_LIMITED`→"Rate-limited",
  else `"Not synced yet"` (`outline`, `:213`); `CardDescription` =
  `Last successful sync: {…}` (`:217`, `formatAt` at `:64-69` yields `"never"` or
  `"YYYY-MM-DD HH:mm UTC"`); then up to three stacked `Alert`s; then the action
  row; then the demo note; then `editSlot`.
- **Action row DOM order (`:263-297`)**: `Test connection` (`outline`) →
  `Reconnect` (`outline`, `asChild` link to `reconnectHref`) → `Disconnect`
  (`ghost`, opens `DisconnectConfirmDialog`). The `ghost` is deliberate, with a
  comment naming it as the owner's decision (`:282-283`): *"Stays `ghost`
  deliberately (owner's decision): the dialog is the gate, not the button's
  weight."*
- **All strings are inline JSX literals.** There is no `integration-card-copy.ts`
  — unlike `disconnect-confirm-copy.ts` and `jira-project-editor-copy.ts`.
  `TEST_FAILURE_COPY` (`:71-83`) is a module-level const inside the `.tsx`.
- Demo gating: `isDemo` disables Test connection, Reconnect and Disconnect, hides
  `editSlot`, and renders a Polish `DemoNote` (`:96-105`).

**Two error surfaces, both only here** (neither the wizard status cards nor the
connect-route pages show token-error state):

1. Last-sync failure alert, from `classifyFailure` (`failure-reason.ts`). For
   `ERROR` it already says: *"{name} rejected SprintFlow's credentials."* /
   *`Run "Test connection" below to confirm, then reconnect {name} with a fresh
   token…`* (`failure-reason.ts:52-57`).
2. Live `Test connection` result, `TEST_FAILURE_COPY` (`integration-card.tsx:71-83`)
   — including `credential_unreadable` → *"reconnect to store a fresh one"* and
   `auth` → *"needs reconnecting"*.

Both are additive and stack above the button row (`:226-250`).

**`/settings/connections/github|jira/page.tsx`** — the Reconnect destination.
Heading is conditional: `{existing ? "Reconnect GitHub" : "Connect GitHub"}`
(`github/page.tsx:65`, `jira/page.tsx:52`). When `existing`, a non-destructive
`Alert` states what is replaced (`github:74-79`, `jira:62-67`). Both `redirect`
to `/settings/connections` in demo before rendering. Back link:
`"Back to connections"`.

**`github-connection-status.tsx` / `jira-connection-status.tsx`** (wizard steps)
— **no Reconnect control at all**; footer is `Disconnect` (`outline`) then a
primary `Continue…`. Reconnecting inside the wizard requires disconnecting first;
`settings/connections/github/page.tsx:22-27` documents that gap as the reason the
settings route exists. These cards report failure only via a transient `sonner`
toast — no persistent alert.

### 2. Is Reconnect actually lossless? — verified at HEAD

**Jira, same project.** Credential upsert omits `id` (`jira-store.ts:185-196`).
`projectChanged` is computed from the pre-existing row (`:205-211`); when false,
the `sprint` delete (`:258-261`) is skipped entirely and `jiraProject` is upserted
with `id` omitted (`:225`). Preserved: credential id, project id, `sprint`
(including `committedFrozenAt`/`committedSp`), `jira_ticket`,
`jira_status_history`, `anomaly`, `absence`, `sprint_measurement`.
`status_mapping` is **always** delete-then-insert (`:264-276`) — project-specific
by definition.

**Jira, different project.** The `sprint` delete fires and cascades to
`jira_ticket`, `jira_status_history`, `anomaly` (`schema.ts:343`, `:417`, `:833`).
**Reconnecting into a different project through the same form is exactly as
destructive as a disconnect** — the safe-route promise must be scoped to "same
project", or the copy will be a lie in the one branch a lead reaches when their
team really did move.

**GitHub.** Credential upsert omits `id` (`github-store.ts:141-152`). The repo set
is an upsert on `(ownerId, githubRepoId)` with `id` omitted, followed by
`delete … where notInArray(githubRepoId, keptRepoIds)` (`:177-202`) — a
differential upsert, not delete-then-insert. The code comment records this as a
**post-S-26 fix**: the old idiom minted fresh `monitored_repo.id`s and, because
`github_commit.repo_id` / `github_pull_request.repo_id` cascade off that id
(`schema.ts:741`, `:770`), silently discarded synced history for repos the owner
kept. Deselecting a repo still deletes it and its history — a visible choice, not
a side effect.

**Disconnect after S-26.**

| | `keep` (default) | `clear` |
| --- | --- | --- |
| GitHub | deletes `github_credential` only; `monitored_repo` survives with `credential_id = NULL` (SET NULL), commits/PRs/reviews untouched | additionally deletes `monitored_repo` → cascades to `github_commit`, `github_pull_request`, `github_review` |
| Jira | deletes `jira_credential` → cascades to `jira_project`, `status_mapping`, `sprint`, `jira_ticket`, `jira_status_history`, `anomaly`; `absence` survives with `sprint_id = NULL` | additionally deletes every `absence` row for the owner |

(`github-store.ts:235-254`, `jira-store.ts:320-337`; matches
`DISCONNECT_IMPACT` at `disconnect-impact.ts:115-120` etc.)

**The precise asymmetry, stated for the copy writer:**

- **GitHub** — `Disconnect(keep)` then reconnect with the same repo selection is
  *equivalent* to a resubmit. The lead loses nothing. The two buttons genuinely
  are close to the same decision here.
- **Jira** — `sprint` sits in the **unconditional** cascade of the credential
  delete, in both modes. So even `keep` destroys the currently-open sprint's
  tickets, status history, anomalies and — the part nothing re-derives — the
  FR-023 commitment freeze. `run-sync.ts:907-917` computes `committedSp` live only
  until `committedFrozenAt` is set; after a disconnect the fresh `sprint` row has
  `committedFrozenAt = null`, and the next sync re-freezes at the *post-reconnect*
  ticket set. `shouldFinalize` (`sweep.ts:51-54`) needs `committedFrozenAt`, so a
  sprint that closes across the gap either records a wrong commitment or none.
  `sprint_measurement` for **closed** sprints is safe under every branch
  (`shouldRecompute`, `sweep.ts:65-67`).

**Reachability — no blocking state found.** No page that hosts the Reconnect form
decrypts the stored credential or calls the vendor API on load: the setup pages
read only `workspaceUrl`/`jiraEmail`/`tokenLast4`/`githubLogin`
(`setup/jira/page.tsx:36-44`, `setup/github/page.tsx:36-43`), the settings connect
routes render the form unconditionally (`jira/page.tsx:60-71`,
`github/page.tsx:73-83`), and `getConnectionsOverview` is decrypt-free
(`connections.ts:80-138`). Even a `credential_unreadable` (`TokenCryptoError`,
e.g. after key rotation) leaves the Reconnect link rendered and working. Fresh
validation happens **before** `db.transaction` opens (`jira-store.ts:143-166`), so
a bad new token leaves the database untouched — no partial write.

### 3. What S-24 and S-26 already established (do not reopen)

- **Language**: dialog copy is **English**; demo-refusal copy is **Polish**
  ("copy language follows the surface, not the slice" — S-24 plan). The card is
  English with a Polish demo note, consistent with that rule.
- **The dialog's shape**: title is the only place the word *Disconnect* appears
  (`disconnect-confirm-copy.ts:49`); the **primary** button is the safe one,
  `Keep my {X} data`, `variant="default"`; the destructive branch is `secondary`,
  `variant="destructive"`, `Delete my {X} data`, reached by name
  (`disconnect-confirm.tsx:56-69`).
- **A hard test invariant**: none of the three strings (trigger `Disconnect`, keep
  label, clear label) may be a case-insensitive substring of another, in either
  direction — because Playwright's `getByRole` name match is substring-based even
  under `{ exact: true }` (`disconnect-confirm-copy.test.ts:45-71`). **Any new
  card label must be checked against this rule too.**
- **Name what survives, not only what is destroyed** — "so the prompt is not pure
  alarm" (`disconnect-confirm-copy.test.ts:131-133`); and **name which control
  causes which loss**, because *"describing a destructive alternative without
  saying which control produces it is how a lead ends up clicking to find out"*
  (`disconnect-confirm-copy.ts:80-85`).
- **No live counts** — categories, not "12 absences" (S-24 plan, owner's
  decision).
- **The copy-module pattern**: two layers — a pure fact module
  (`src/lib/integrations/disconnect-impact.ts`, held equal to the schema's FK
  graph by `disconnect-impact.test.ts`) and a pure copy-assembly module
  (`disconnect-confirm-copy.ts`, tested for assembled prose). The `.tsx` is a thin
  renderer holding no string logic. This exists because the repo has **no
  component-test harness** — no jsdom, no RTL.
- **The deferral is explicit.** S-26's plan, *What We're NOT Doing*
  (`disconnect-data-retention/plan.md:124-126`): *"Reconnect already rotates a
  token losslessly … that Disconnect sits beside it looking equally reasonable is
  a UI question this slice does not own. Roadmap line."*
- **The conflict.** S-24's plan, *What We're NOT Doing* (`:180-185`): *"No visual
  re-weighting of the buttons. `integration-card.tsx:205` stays
  `variant="ghost"`; the wizard's Disconnect stays in the same `CardFooter` as
  Continue. Owner's decision — the dialog is the gate."*

### 4. Tests that pin the strings — and the gate that does not exist

**CI runs no E2E job.** `.github/workflows/ci.yml` triggers on `pull_request`
only, with three jobs: `test` (lint → typecheck → hermetic unit), `integration`
(real Postgres), `bundle-size` (`wrangler deploy --dry-run`). `lefthook.yml`
pre-commit runs typecheck/lint/`vitest related`. **`e2e/*.spec.ts` runs nowhere
automatically** — not in CI, not in a hook, and not in this worktree while another
session is live. Broken E2E assertions will not turn anything red; they will just
be wrong until a human runs `npm run test:e2e`.

**Will break on a card copy change (E2E, ~20 assertions across 5 files):**

| File | What it pins |
| --- | --- |
| `e2e/disconnect.ts:54,65,68` | the shared helper — `getByRole("button",{name:"Disconnect",exact:true})`, `Keep my {X} data`, `Delete my {X} data`, and the post-disconnect `Connect` button. **Fixing this one file fixes four specs at once.** |
| `e2e/setup-github.spec.ts:55,75,77,97,101,104,112-117,123,125,130,152,156,160,172-177,183,190` | `"GitHub connected"`, `/Connected as …/`, `Connect`/`Disconnect` buttons, the three-control footer, and — most brittle — `toContainText` on **full assembled dialog sentences** (`:112-117`) |
| `e2e/setup-jira.spec.ts:50,60,63,64,65` | `"Jira connected"`, `/Connected to …/`, `/Monitoring project/`, `Connect`, `Save` |
| `e2e/demo-boundary.spec.ts:57,63-64,67` | `heading "Connect GitHub"` count 0; `button "Connect GitHub"` disabled; `link "Connect GitHub"` count 0; `button "Connect Jira"` disabled — i.e. the not-connected card branch **and** the connect-route heading |
| `e2e/dashboard-sprint-detail.spec.ts:220,223-224,242,246,249,252` | `"Sync now"`, `link "Connect GitHub"/"Connect Jira"`, `heading "Connect GitHub"`, `"Back to connections"` |

**Already self-defending in this worktree:**
`src/components/molecules/disconnect-confirm-copy.test.ts` is a hermetic unit test
— `npm test` runs it here, so a broken label invariant surfaces before commit.

**Not affected by copy alone:** `connections.integration.test.ts` (pins the
`getConnectionsOverview` data contract, not rendered text),
`disconnect-impact.test.ts`, `validations/disconnect.test.ts`,
`actions.demo.test.ts`, `boundary-inventory.test.ts`,
`jira-project-editor-copy.test.ts`.

**Untested today — zero regression risk, zero safety net.** No assertion anywhere
covers `"Not connected."`, `"Test connection"`, `"Reconnect"` (the settings-card
button), the four status badges, `"Connection is live"`, `"Connection test
failed"`, or `"Disconnect refused"`. These are the exact strings S-31 will
rewrite: touching them is **new test writing**, not test updating.

## Code References

- `src/components/organisms/settings/integration-card.tsx:58-62` — status badge map
- `src/components/organisms/settings/integration-card.tsx:71-83` — `TEST_FAILURE_COPY`
- `src/components/organisms/settings/integration-card.tsx:178-202` — not-connected branch
- `src/components/organisms/settings/integration-card.tsx:263-297` — the three-button action row
- `src/components/organisms/settings/integration-card.tsx:282-283` — the `ghost` comment (owner's decision)
- `src/lib/integrations/failure-reason.ts:52-57` — the existing "reconnect with a fresh token" guidance
- `src/lib/integrations/jira-store.ts:185-196` — credential upsert, `id` omitted
- `src/lib/integrations/jira-store.ts:205-211,258-261` — `projectChanged` gate on the `sprint` delete
- `src/lib/integrations/jira-store.ts:320-337` — `disconnectJira`, keep/clear
- `src/lib/integrations/github-store.ts:169-175,177-202` — differential repo upsert (post-S-26)
- `src/lib/integrations/github-store.ts:235-254` — `disconnectGithub`, keep/clear
- `src/lib/integrations/sync/run-sync.ts:907-917` — the commitment freeze
- `src/lib/integrations/sync/sweep.ts:51-54,65-67` — `shouldFinalize` / `shouldRecompute`
- `src/components/molecules/disconnect-confirm-copy.ts:49,51-57,80-85,87-104` — the copy contract
- `src/components/molecules/disconnect-confirm-copy.test.ts:45-71` — the substring invariant
- `src/lib/integrations/disconnect-impact.ts` — the fact module the copy is assembled from
- `src/app/(app)/settings/connections/github/page.tsx:22-27,65,74-79` — why the settings route exists; conditional heading
- `e2e/disconnect.ts:54,65,68` — the shared E2E helper, highest-leverage update

## Architecture Insights

- **Copy is data here, not markup.** The mature surfaces in this area split into a
  fact module and a copy-assembly module, both pure `.ts`, both unit-tested, with
  the `.tsx` reduced to a renderer. `integration-card.tsx` is the outlier that has
  not been through that treatment — which is why the card is simultaneously the
  least-tested and the most-about-to-change file in the slice. Extracting an
  `integration-card-copy.ts` is the conventional move, and it is what makes the
  new copy assertable at all given the absent component-test harness.
- **The safe-default pattern is already house style** and appears in two places
  (`disconnect-confirm.tsx`, `jira-project-editor.tsx`): the primary button is the
  non-destructive one; the destructive branch is `variant="destructive"` and must
  be reached by a name that states the outcome. Anything S-31 adds to the card
  should read as the third instance of that pattern, not a fourth idiom.
- **Button-label collisions are a real, encoded hazard**, not a style preference —
  Playwright's substring name matching makes `Reconnect` vs `Connect` a live trap
  (note `e2e/setup-github.spec.ts:55` already relies on `exact: true` for
  `Connect`). Any new label needs checking against every sibling label on the same
  screen.
- **The failure path already points at the fix; the layout does not.** This is the
  cheapest available lever: the guidance exists in `failure-reason.ts` and is
  rendered above the buttons — it is simply prose, in an alert, competing with two
  other alerts, above three equally-weighted controls.

## Historical Context (from prior changes)

- `context/archive/2026-08-30-disconnect-data-retention/frame.md:55` — "Overloaded
  verb", the finding this slice exists to fix; rated STRONG.
- `context/archive/2026-08-30-disconnect-data-retention/frame.md:58-90` — the
  `committed_frozen_at` corruption, "the finding that was not on the map". S-26
  took it in scope; this research confirms the Jira `sprint` cascade is still
  unconditional in both modes, which is precisely what keeps the Jira asymmetry
  real.
- `context/archive/2026-08-30-disconnect-data-retention/plan.md:124-126` — the
  explicit deferral to S-31.
- `context/archive/2026-08-30-destructive-action-confirmation/plan.md:180-185` —
  "No visual re-weighting of the buttons. Owner's decision." The decision S-31
  must either honour or consciously reverse.
- `context/foundation/lessons.md` #9 — "A parallel worktree cannot run the suite
  that guards the shape it is changing." Directly binding: this slice changes
  user-visible strings from a worktree, and §4 above is the inventory that lesson
  demands. Its own corollary also applies — the rule forbids `test:e2e` in **two**
  worktrees at once, so running it once locally, with the other session idle and
  port 3000 free, is permitted and is the only thing that will ever run it.
- `context/foundation/manual-test-backlog.md` — open rows on this exact surface:
  **16.A**, **16.B** (dialog footer labels and contents, rewritten by S-26),
  **16.C** (demo: Disconnect greyed out, with a Polish sentence *under the
  buttons* listing what is disabled), **22.B–22.F** (S-26 keep/clear outcomes;
  22.D flagged 🔴 irreversible), **15.C**, **15.F** (the reconnect route itself).

## Related Research

- `context/archive/2026-08-30-disconnect-data-retention/` — frame, plan, reviews
- `context/archive/2026-08-30-destructive-action-confirmation/` — S-24's plan and
  checklist
- `context/archive/2026-08-30-demo-boundary-enforcement/` — why the card renders
  the real account in demo and disables its controls

## Open Questions

1. ~~**Does the owner reverse S-24's "no visual re-weighting"?**~~ —
   **ANSWERED 2026-08-31 (owner, at `/10x-research`). Yes: reverse it.**
   Reconnect is promoted to the primary (`default`) control and renamed after the
   job it does; Test connection and Disconnect drop below it. This is a
   **deliberate reversal** of `destructive-action-confirmation/plan.md:180-185`
   ("No visual re-weighting of the buttons … Owner's decision — the dialog is the
   gate"), and the plan must record it as one — the precedent for how a reversal
   is written down is S-23 undoing S-08's decision against an FTE column
   (`context/archive/2026-08-25-absence-calendar/plan-brief.md:41`). Note the
   twist that makes the reversal coherent rather than contradictory: Disconnect
   is already the *lightest* control, so S-24's concern (do not make the
   destructive button loud) is untouched — what changes is that the safe route
   stops being one of three equal-weight siblings. S-24's other half — the dialog
   remains the gate — stands.
2. ~~**Do the two cards say different things now?**~~ — **ANSWERED 2026-08-31
   (owner, at `/10x-research`). Per-integration copy, assembled from
   `disconnect-impact.ts`.** A new pure `integration-card-copy.ts` sibling builds
   each card's sentences from the same schema-checked fact module that
   `disconnect-confirm-copy.ts` uses, so the card cannot drift from the FK graph
   the way a hand-written shared sentence would. The rejected option — one
   cautious sentence covering both — was rejected for a specific reason worth
   carrying into the plan: on GitHub it would threaten a loss that S-26 already
   removed, which is the exact defect S-26 named in the dialog
   (`disconnect-confirm-copy.ts:74-78`, *"a dialog that keeps threatening a loss
   it no longer inflicts frightens the lead off the safe path"*).
3. **How far does "same project" get into the copy?** The lossless promise is only
   true for Jira when the project is unchanged; the same form, with a different
   project picked, destroys the same rows a disconnect would. The connect-route
   page already warns about this (`jira/page.tsx:62-67`), but the *card* would be
   making the promise.
4. **Is the third job — "we moved to a different project" — on this card at all?**
   It is currently served by `JiraProjectEditor` in the `editSlot`, below the
   buttons, with its own keep/clear flow. Naming three jobs while one of them
   lives in a collapsed section under the fold is a layout question, not just
   copy.
5. **Does the wizard's connection status get the same treatment?** It has no
   Reconnect control at all — the lead must disconnect first, which on Jira is the
   destructive path. That is arguably the sharpest instance of the exact problem
   S-31 names, and it is not in the roadmap entry's wording.
6. **Backlog hygiene, found in passing:** row **15.C** still instructs the tester
   to click a dialog button named *"Disconnect GitHub"*, while row **16.A**
   (rewritten by S-26) asserts that **no** button is named that. The two rows
   contradict each other; 15.C is stale. Also, row **16.C** pins the demo card's
   layout ("a Polish sentence *under the buttons*"), so a layout change here needs
   that row updated in step.
