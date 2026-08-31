# Cadence after setup (S-29) — Plan Brief

> Full plan: `context/changes/post-setup-cadence-surface/plan.md`
> Frame brief: `context/changes/post-setup-cadence-surface/frame.md`

## What & Why

Finishing the setup wizard permanently opts an account out of FR-007's
auto-pull, because `saveCadence` sets `cadence_overridden = true`
unconditionally — so whatever cadence happened to be derived at that moment is
frozen for the account's lifetime, the one surface that could correct it is
unreachable, and between sprints that surface would report success while writing
nothing. This plan fixes the lifecycle and then builds the screen on top of it.

## Starting Point

`CadenceForm` has exactly one mount, the wizard's last step; none of the seven
Settings/Team tabs renders it. The page reads through `getActiveSprintRow`
(state-unscoped fallback) while the write is scoped to `state = 'ACTIVE'`, and
the action discards the service's rows-affected and returns `{ok: true}`
regardless. On the live database the one real onboarded account is frozen at
`start_day = FRI` with `cadence_overridden = t`; the five rows that never went
through the wizard are all `f`. Since S-28, `working_days` decides when all five
time-based anomaly rules fire, so a wrong value here is louder than it was two
slices ago.

## Desired End State

`cadence_overridden` means "the lead deliberately changed this". A save either
changes one named row or fails with a message saying why. Every existing account
is back on auto-pull, so a Jira-side cadence change reaches the row again — the
real account's `FRI` is derived from a sprint that really started on a Friday, so
it changes when the lead corrects it on the new screen, not by itself. `/team/cadence` is a fourth Team tab showing all three fields with honest
provenance, saving in place, with a "Restore Jira's values" control that hands
the cadence back to auto-pull.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where cadence lives | Stays on the `sprint` row; write keys on `sprint.id` from `getActiveSprintRow` | Fixes the silent no-op without a schema change and leaves S-30's account-vs-sprint modelling question intact | Plan |
| Existing frozen accounts | Migration `0022` clears the flag on every row, values untouched | Nobody set that flag deliberately, and Jira is FR-007's source of truth | Plan |
| What flips the flag | Dirty-check inside `saveCadence`: only when submitted ≠ stored | "Confirmed" stops meaning "overrode", with one mechanism shared by both callers | Plan |
| Fields on the new screen | All three, editable, each labelled with its source | FR-007 names all three, and a two-thirds screen re-opens the same gap; `working_days` has no Jira source and the current copy claims otherwise | Plan |
| Where the screen lives | `/team/cadence`, fourth Team tab | `team/days-off` already consumes `sprint.working_days` — the adjacency is real, not thematic | Plan |
| No sprint row at all | Named `no_sprint` refusal, screen explains and offers a pull | Kills the silent no-op rather than relocating it; matches `setMemberActive`'s existing zero-row guard | Plan |
| Way back to auto-pull | A restore that passes `forceCadenceRefresh` into the reconcile | Without it an override is one-way; and a clear on either side of the reconcile is unsafe — after it is a no-op reporting success, before it strands a cleared flag when the Jira call throws | Plan |
| The `working_days` / anomaly blast radius | Accepted, surfaced in the manual rows | S-28 made the column load-bearing; the fix is honest provenance copy, not hiding the field | Frame |

## Scope

**In scope:** truthful cadence write keyed on the resolved row; dirty-checked
override flag; data migration unfreezing existing accounts; a restore-from-Jira
action; `/team/cadence` plus its tab; shared cadence fields between the wizard
and the new editor; the three pieces of copy that asserted a surface that did not
exist.

**Out of scope:** moving cadence to the account (S-30); placeholder sprint rows;
an explicit "don't sync" toggle; deriving working days from a country (S-17);
projecting an unstarted sprint (S-18); the Reconnect/Disconnect affordance
(S-31); `jira_project.time_zone` nulling on a project switch (backlog 28.A).

## Architecture / Approach

Mechanism before surface. `saveCadence` stops hand-rolling its own predicate and
calls `getActiveSprintRow` — the same resolver the page, the anomaly snapshot and
the days-off editor already use — so the row the lead sees and the row the save
writes become one row. The override flag is decided in that one service by
comparing submitted against stored. The restore does not clear the flag itself: it
tells `reconcileActiveSprint` to ignore it, so the refresh and the clear land in
one statement inside the transaction that already exists. Only then does a new route mount extracted, shared cadence
fields.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The write stops lying | By-id UPDATE, `no_sprint` refusal, dirty-checked flag | Dirty-check must omit the column, not write `false`, or it un-overrides a real override |
| 2. Unfreeze existing accounts | Data-only migration `0022` | A code deploy without the migration; the route to production is manual and IPv6-blocked for drizzle-kit |
| 3. Hand the cadence back to Jira | `forceCadenceRefresh` + `restoreCadenceFromJira` + action | A separate clear, on either side of the reconcile, is unsafe — the new flag must default false so the 15-min sync is untouched |
| 4. `/team/cadence` | Route, tab, shared fields, pure view module | `working_days` moves five anomaly rules — a careless edit is now loud |
| 5. Close the loop | Wizard on shared fields, links and copy, manual rows | An e2e spec asserts the doorstep copy; it cannot be caught by lint or typecheck |

**Prerequisites:** S-15 and S-16 done (both are). Local Supabase running for the
integration suite; production Supabase access for the `0022` row.
**Estimated effort:** ~2–3 sessions across five phases; phases 1–3 are
service-and-test work, phase 4 is the only substantial UI.

## Open Risks & Assumptions

- **`length_days` and `start_day` become visible for the first time.** Nothing
  reads them today, so their drift has never been seen; a lead who opens the new
  screen may find a start day that disagrees with their real sprint. That is the
  defect surfacing, not the screen creating it — but it will read as new.
- **The migration is one-way in practice.** Re-setting the flag restores the
  freeze but not the values, which the next reconcile will already have
  refreshed. Accepted: those values were never chosen by anyone.
- **A disconnect still loses the override** (S-30). This plan makes the override
  meaningful and reachable; it does not make it durable.
- **Editing a CLOSED sprint's `working_days` does not retroactively change its
  `sprint_measurement`**, whose `working_day_count` is frozen by design. Correct,
  but worth knowing before someone reports it as a bug.

## Success Criteria (Summary)

- A lead can change sprint length, start day and working days from `/team/cadence`
  without re-entering the wizard, and the change is still there after a reload —
  including between sprints.
- No cadence save reports success having written nothing.
- An account that merely finished the wizard is on auto-pull, and one that
  deliberately overrode has a one-click way back to Jira's values.
