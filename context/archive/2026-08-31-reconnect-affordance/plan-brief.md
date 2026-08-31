# S-31 — Reconnect and Disconnect stop looking like the same decision — Plan Brief

> Full plan: `context/changes/reconnect-affordance/plan.md`
> Research: `context/changes/reconnect-affordance/research.md`
> Originating frame: `context/archive/2026-08-30-disconnect-data-retention/frame.md` ("Overloaded verb")

## What & Why

A lead whose GitHub or Jira token has expired arrives at `/settings/connections`
and has to guess. The card offers four controls of equal-or-lighter weight,
three of them named after mechanisms, and nothing on it says that one of them
rotates the token losslessly while another destroys the sprint. S-24 gave
Disconnect a confirmation and S-26 gave it a safe default, but both act *after*
the lead has already chosen the wrong control. This slice fixes what is upstream
of the dialog: weight and words.

## Starting Point

`storeJiraIntegration` already upserts and touches `sprint` only when the
monitored project actually changes — Settings' `Reconnect` reaches exactly that
path — and since S-26 GitHub's `disconnect(keep)` → reconnect is *equivalent* to
a resubmit. The asymmetry the roadmap describes is therefore real only for Jira,
and only while the project stays the same. Meanwhile `integration-card.tsx` is
the one file in this area never split into a fact module plus a copy module: every
string is an inline JSX literal, and **no test anywhere covers a single one of
them**. The `editSlot` below the buttons — already correctly named
`"Change monitored project"` — is a fourth button, not a section.

## Desired End State

The card names the three jobs in one sentence, each mapped to the control that
does it. `Reconnect` is the single emphasised button, with a line under it saying
what re-submitting costs: nothing for GitHub, nothing for Jira *as long as the
project stays the same*, with `Change monitored project` named as the control
that shows that cost first — not as a cheaper route, because it costs the same
(plan-review F4). `Disconnect` stays the lightest control on the card. The two
wizard status cards gain the same `Reconnect` route, so rotating a token no
longer requires pressing the destructive button first; they carry the `"wizard"`
variant of the promise, which drops the clause naming a control that screen does
not have (plan-review F5).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Button labels | Keep `Reconnect` / `Test connection` / `Disconnect` as they are | Owner's call; the job-naming moves entirely into the prose, which also keeps E2E churn to the labels that actually move. | Plan |
| Visual re-weighting | `Reconnect` → `default`; `Disconnect` **stays** `ghost` | Deliberate reversal of S-24's "no visual re-weighting", coherent because S-24's concern was the destructive button being loud — it stays the quietest. | Plan |
| Jira's conditional promise | Condition stated on the card, sourced from `DISCONNECT_IMPACT.projectSwitch` | Continues S-26's rule that copy names which control causes which loss; the `projectSwitch` root (not `.jira`) is what a reconnect actually costs, per plan-review F1. | Plan + review |
| GitHub vs Jira copy | Per-integration, derived from `disconnect-impact.ts` | A shared cautious sentence would threaten a loss S-26 removed — the exact defect S-26 named in the dialog. | Research |
| Third job's placement | `editSlot` trigger joins the action row | It is already a bare button and already job-named; leaving it below the fold would name three jobs while hiding one. | Plan |
| Wizard cards | In scope — same `Reconnect` link, `Disconnect` demoted to `ghost` | The sharpest instance of the problem: today the wizard's only route to a fresh token runs through the destructive button. | Plan |
| Copy module scope | Whole card extracted to `integration-card-copy.ts` | There is no component-test harness in this repo, so a pure `.ts` sibling is the only way any card string becomes assertable — and this is house style. | Plan |
| E2E | **Add** connected-card coverage, then run `npm run test:e2e` once locally as a phase gate | Plan-review F2: no existing assertion breaks (every connected-surface locator is `{ exact: true }`) and no spec covers the connected Connections card at all — so the phase is additive. CI runs no E2E job and no hook does either. | Plan + review |

## Scope

**In scope:** `integration-card-copy.ts` + its hermetic test; `integration-card.tsx`
re-weight and re-layout; `w-full` on both selection editors' open panel;
`Reconnect` on both wizard status cards; NEW E2E coverage for the connected
Connections card plus one local suite run; `MANUAL-CHECKLIST.md`, backlog rows
15.C / 16.C / new S-31 rows, roadmap status.

**Out of scope:** any schema, store, Server Action or migration change (forbidden
in this worktree anyway); the disconnect dialog itself; what demo hides; a
reconnect *form* inside the wizard; live counts in the copy.

## Architecture / Approach

Two layers, already house style: `disconnect-impact.ts` is the fact module held
equal to the schema's FK graph by its own test; the new
`integration-card-copy.ts` assembles the card's prose from it; `.tsx` becomes a
renderer holding no strings. The card's promise is therefore *derived*, through
an explicit per-integration source map rather than a branch on one entry's shape
(plan-review F1): `jira` → `DISCONNECT_IMPACT.projectSwitch.destroys`, `github`
→ `DISCONNECT_IMPACT.github.clears`. Both are held equal to the FK graph by
`disconnect-impact.test.ts`, so a future slice that hangs a cascading child under
`sprint` or `monitored_repo` breaks this copy at build time instead of turning it
into a lie. One clause is deliberately NOT derived and declares itself so — the
FR-023 commitment freeze, which is a column re-computation rather than a table in
the graph (plan-review F3).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Copy module | Every card string in a pure, tested `.ts`; the two new job sentences | The label substring invariant now spans five labels on one screen; missing a pair is a silent Playwright strict-mode break |
| 2. The card | `Reconnect` promoted, three jobs in one row, `Test connection` demoted to diagnostics | The open editor panel wraps and pushes `Disconnect` below it — a real visual state |
| 3. Wizard cards | Same route on `/setup/github` and `/setup/jira`, `"wizard"` promise variant | The promise must not quote a control the wizard does not have |
| 4. E2E | New connected-card coverage + one local suite run | Requires the other worktree session to be idle; nothing else will ever run these |
| 5. Backlog | Checklist, backlog rows 15.C/16.C, roadmap status | Row 15.C contradicts 16.A today; retiring it must keep its still-live half |

**Prerequisites:** S-24 and S-26 done (both are). The other worktree session idle
for Phase 4. `npm ci` in this worktree.
**Estimated effort:** ~1–2 sessions; Phases 1–3 are small, Phase 4 is the
schedule risk.

## Open Risks & Assumptions

- Phase 4's gate depends on something this plan does not control: the other
  session being idle and port 3000 free. If it cannot be met, the phase does not
  silently pass — the run is the criterion.
- The row will deliberately mix vocabularies (`Reconnect` beside
  `Change monitored project`). The intro sentence is what makes that legible; if
  it reads badly on screen, the label decision is the thing to revisit, not the
  sentence.
- **Resolved by plan-review F1.** `reconnectCost` no longer infers its source
  from `destroys` being non-empty — that inference picked `DISCONNECT_IMPACT.jira`
  for Jira, which overstates a project switch. The map is now written out per
  integration, and the Phase 1 test asserts each sentence against its own entry
  plus a negative assertion against the wrong one.

## Success Criteria (Summary)

- A lead reading only the card can tell, without experimenting, which control
  rotates a token losslessly and under what condition.
- `Disconnect` is still the quietest control on every surface it appears on, and
  the dialog is still the gate.
- The card's promise cannot outlive the FK graph it describes: changing
  `DISCONNECT_IMPACT` without changing the copy fails `npm test`.
