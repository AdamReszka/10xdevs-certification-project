# Confirmation before a destructive disconnect (S-24) — Plan Brief

> Full plan: `context/changes/destructive-action-confirmation/plan.md`
> Frame brief: `context/changes/destructive-action-confirmation/frame.md`

## What & Why

A safe action silently became a destructive one as three later slices attached
cascading children beneath it, and every layer that should have noticed still
describes the old, safe version — so the deliverable is not only a dialog, it is
the first correct statement of what Disconnect destroys. Four buttons (GitHub
and Jira, wizard and settings) cascade-delete synced **and** hand-entered data on
a single click, with no confirmation, no undo and no export. Raised by the tester
on 2026-08-30, standing in front of the button.

## Starting Point

All four paths fire their Server Action straight from `onClick`; Settings imports
the wizard's own two actions, so the four buttons are two implementations. The
actual cascade is four tables deep for GitHub and five deep / nine wide for Jira,
including `absence` — hand-entered FR-010 data no sync can rebuild. Six
docstrings state a one-level cascade, and the repo's only destructive warning
(`jira-project-editor.tsx`) is wrong in both directions: it names `daily_recap`,
which survives, and omits `absence`, which dies (its docstring omits `anomaly`
too). Separately, demo mode reaches nine real-account Server Actions on the
Connections tab, under a banner promising real integrations are untouched.

## Desired End State

Any Disconnect opens the house `ConfirmDialog`, naming correctly what disappears
and what survives, cancellable with nothing lost. The category list is not
hand-maintained — a hermetic test holds it equal to the foreign-key graph, so a
future slice that hangs a new child under `sprint` fails the build instead of
silently invalidating the copy. On Connections, demo reaches no real-account
mutation, and the demo banner's promise becomes true because the code honours it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Blast-radius source of truth | Pure module + schema-derived guard test | Hand-written copy is exactly what already failed once; `getTableConfig(...).foreignKeys[].onDelete` is readable with no database, so the declaration can be machine-checked in `npm test` | Plan |
| Live counts | No — categories only | Owner's decision at frame; pass condition is "asked, told what will be removed, able to cancel" | Frame |
| Confirmation pattern | `ConfirmDialog` (S-15), not `jira-project-editor.tsx` | The named, reusable, documented convention whose own plan already listed Disconnect as the outstanding gap | Frame |
| Demo behaviour | Block, don't warn — server refusal + disabled control | Owner: "tryb demo nie ma ruszać w bazie prawdziwych danych, ma w UI podmienić prawdziwe na te demo"; this makes the banner's existing promise true rather than softening it | Plan |
| Demo scope | The whole Connections tab (9 actions), not only the 4 Disconnects | Leaving "Change monitored project" able to delete real sprints beside a blocked Disconnect recreates the exact asymmetry that produced S-24; the three `load*` readers join for the same reason a `disabled` attribute is not a boundary (plan-review F4) | Plan |
| Exit-demo semantics | Unchanged — view switch only, rows stay | Already the code's behaviour (`exitDemoAction` flips `active_workspace`; only `resetDemoAction` deletes); deleting on exit would make demo one-shot and discard demo-side edits | Plan |
| Button visual weight | Unchanged (`ghost` stays `ghost`) | Owner's decision — the dialog is the gate; scope stays "confirmation" | Plan |
| Wrong warning in `jira-project-editor.tsx` | Fixed in this slice | The Phase 1 module serves it almost for free, and a known lie two clicks from the new correct dialog is worse than either alone | Plan |
| Cascade itself | Untouched — `absence` still dies | Owner parked it as S-26; it needs a migration and must not be settled twice with S-20 | Frame |

## Scope

**In scope:**

- One shared confirmation on all four Disconnect paths, copy fed from one module
- A hermetic test holding that module equal to the schema's cascade closure, for
  all three roots it declares — GitHub, Jira, and the project switch rooted at
  `sprint` (plan-review F1)
- Server-side demo refusal + disabled controls for all nine Connections actions
- Repairing six docstrings, the wrong warning, the demo panel's disabled list
- Fixing four E2E cleanup hooks + one new cancel-actually-cancels test
- Correcting the two documents that assert a confirmation that never existed;
  deleting the tester's note in the same commit as its fix

**Out of scope:**

- Narrowing the cascade so absences survive a Jira disconnect (**S-26**)
- Whether Disconnect should delete anything at all (Open Roadmap Question 4)
- A demo gate on `/setup/**`, the doorstep's `push` vs `replace` (**S-27**)
- Live counts in the dialog; any schema change or migration; a `lessons.md` entry

## Architecture / Approach

```
src/db/schema.ts ──(getTableConfig, test-time only)──▶ disconnect-impact.test.ts
                                                              │ asserts equal
                                                              ▼
                                              disconnect-impact.ts  (pure)
                                                     │
                        ┌────────────────────────────┼────────────────────────┐
                        ▼                            ▼                        ▼
        setup/{github,jira}-connection-status   settings/integration-card   jira-project-editor
                        └──────────── DisconnectConfirmDialog ──────────────┘
                                              │
                                    disconnect{Github,Jira}()
                                    requireRealWorkspace() + demoRefusal()
```

The module is the only place the cascade is stated; the test is the only thing
that can notice when the schema outgrows it. Demo follows the rule already
written at `setup/team/actions.ts:51-61` and the seam at `lib/demo/refusal.ts` —
server refusal first, disabled control second.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Name the blast radius | `disconnect-impact.ts` + schema-derived guard test | The traversal mis-models a cascade edge; mitigated by three named regression assertions pinning mistakes already made in this repo |
| 2. One confirmation, four paths | `ConfirmDialog` wired everywhere, six docstrings repaired, E2E hooks fixed | Four E2E hooks break by construction — they are repaired in this phase, not discovered in CI |
| 3. Demo stops reaching real data | Refusal + disabled control on nine Connections actions | `disconnect*` return type widens and ripples to three components; `typecheck` forces every call site to be visited, and each needs a new `if (!result.ok)` branch — neither the wizard's `catch`-bound toast nor the settings card has one today |
| 4. Every statement becomes true | Wrong warning, demo panel, two documents, checklist, roadmap | Correcting an *archived* checklist — it is annotated with a date, never rewritten |

**Prerequisites:** none outstanding — S-02, S-03, S-08 and S-16 are all shipped.
Local Supabase running for the integration suite in Phase 3.
**Estimated effort:** ~1–2 sessions across four phases; Phase 3 is the largest
because of the signature change.

## Open Risks & Assumptions

- **Assumption, verified by experiment**: `fk.onDelete` is readable at runtime
  from `drizzle-orm/pg-core` with no database. Proven in this repo's unit project
  on 2026-08-30. If a drizzle upgrade removes it, the guard must move to the
  integration project and read `information_schema` instead.
- **Blocking Disconnect in demo removes a token-rotation path** for someone
  currently viewing demo. Accepted: "Wyjdź z demo" is one click and destroys
  nothing.
- **The four-buttons-but-not-the-connect-form line is deliberate but uneven** —
  in demo the wizard's Disconnect is blocked while its *connect* form can still
  write a real credential. That half is S-27, and it collides with the demo
  banner's "Dokończ konfigurację" button, which routes from demo into the wizard
  on purpose.
- **The guard test will fail on legitimate future schema changes.** That is the
  point, but it means a slice adding a cascading child must budget a copy update.

## Success Criteria (Summary)

- No path that permanently deletes synced or hand-entered data fires on a single
  click; the lead is told what goes, what stays, and can cancel with nothing lost.
- The dialog's list is provably the schema's list, and stays that way without
  anyone remembering to check.
- Demo mode changes what the UI shows and never what the real account holds — and
  every sentence the product says about Disconnect is true.
