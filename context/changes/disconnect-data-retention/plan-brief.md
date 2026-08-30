# Disconnect Data Retention (S-26) — Plan Brief

> Full plan: `context/changes/disconnect-data-retention/plan.md`
> Frame brief: `context/changes/disconnect-data-retention/frame.md`
> Plan review: `context/changes/disconnect-data-retention/reviews/plan-review.md`
> (8 findings, all fixed in the plan; verdict REVISE → SOUND)

## What & Why

Disconnect is the only visible verb for three different intents, two of which are
already served losslessly elsewhere — and the `sprint`-row deletion it fires does
two qualitatively different kinds of damage: it destroys hand-entered data that
no sync can rebuild, and it silently re-freezes a commitment that was designed to
freeze once, poisoning a permanent record that feeds FR-024 for the life of the
team.

## Starting Point

No code anywhere deletes an `absence` row explicitly — absences die purely as a
side effect of a `sprint` row disappearing, on both the disconnect path and the
project switch. `absence.sprint_id` has had no reader since S-20, and the column
is already nullable. The GitHub subtree is re-linkable in principle
(`monitored_repo` carries a durable `unique(owner_id, github_repo_id)`) while the
Jira one is not (`sprint.id` / `jira_project.id` are regenerated UUIDs) — which is
what separates what can be kept from what cannot. In practice the wizard's
reconnect does not yet USE that key: it deletes the repo set and re-inserts it
with fresh ids, so the slice has to bring that path along too (plan-review F1).

## Desired End State

A lead who disconnects is asked, and gets two real choices: keep everything they
entered by hand and everything a reconnect can re-link (the default), or clear it
deliberately. A lead who rotates a token mid-sprint and reconnects finds their
absences intact and their sprint's committed story points unmoved.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What Disconnect means | A choice, not a fixed meaning | None of the three real pressers wants today's outcome; the token rotator wants it least | Frame |
| `absence.sprint_id` action | `ON DELETE SET NULL` | Exact prior art in `0019_old_spectrum.sql`; column already nullable; the schema-derived assertions reclassify it for free (five hand-written ones do need inverting — plan-review F2) | Plan |
| Control shape | Two buttons via `ConfirmDialog.secondary` | `roster-editor.tsx:859-885` already runs this shape (Deactivate / Delete permanently) | Plan |
| Default outcome | Keep | The irreversible act stops being the path of least resistance | Plan |
| What "clear" removes | Today's cascade plus the retained rows | Leaves `sprint_measurement` alone — the PRD amended its own retention non-goal for that record | Plan |
| GitHub symmetry | Full — and it keeps the whole GitHub subtree | `monitored_repo` has a durable GitHub-side key, so keeping is genuinely meaningful — but only once the wizard's reconnect stops minting new ids (plan-review F1) | Plan |
| The wizard's reconnect | Differential upsert, like the settings path | Delete-then-insert on `monitored_repo` cascades away every commit, PR and review; `connection-service.ts:297-304` already refused the idiom once and `lessons.md:35-40` states the rule | Plan review |
| Project switch | Same choice | Third entry into the same loss; the FK change fixes it either way, the choice makes it consistent | Plan |
| Frozen commitment | The measurement is the authority | `sprint_measurement` is the one table designed with no FK precisely so it survives this cascade | Plan |
| `anomaly`, `status_mapping` | Stay in the cascade | NOT NULL + dedup key + rollover sweep; and unconditional delete-and-reinsert on every save | Frame |

## Scope

**In scope:** narrowing two referential actions with a migration; bringing the
wizard's GitHub reconnect onto the differential upsert so the kept subtree
survives it; a keep/clear outcome on both disconnects and on the Jira project
switch; restoring a re-created sprint's frozen commitment from its measurement
record; correcting every document and test that describes the old behaviour.

**Out of scope:** keeping `anomaly` or `status_mapping`; deleting
`sprint_measurement` in either branch; restoring the erased cadence override
(same root, but the measurement stores a working-day count, not the cadence
config); the Reconnect-vs-Disconnect affordance problem; demo behaviour, settled
by S-24/S-27.

## Architecture / Approach

Narrow the cascade first, so the default outcome is safe before any UI exists;
then teach the stores two explicit outcomes; then surface the choice. The impact
model `disconnect-impact.ts` stays the single maintained answer to "what does
this destroy", with a schema-derived guard test holding it equal to the actual
foreign-key graph — it gains a third category for what the destructive second
button removes. Each phase leaves the app shippable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema and migration | `absence` and the GitHub subtree stop dying with their credential | Nullable `monitored_repo.credential_id` is a state the read path has never seen |
| 2. Stores and actions | Server-side keep vs clear, and a reconnect that no longer discards what keep kept | The demo guard matches action source by regex; the refusal line must stay textually intact; `mode` arrives as a public HTTP parameter and must fail toward `keep` |
| 3. The dialog | The lead can express the choice | One `onConfirm` contract change ripples through four call sites |
| 4. Project switch | The third path behaves like the other two | That surface uses a bespoke `Alert` gating a multi-step flow, not `ConfirmDialog` |
| 5. Frozen commitment | A re-created sprint recovers what it was | Reverses the usual direction: the sweep copies sprint → measurement, this reads back |
| 6. Documents and E2E | Nothing in the repo still describes the old behaviour | One shared E2E helper drives all four disconnect flows |

**Prerequisites:** S-08, S-16, S-24 (all done). Runs in the MAIN checkout — the
migration writes to the Postgres every worktree shares.
**Estimated effort:** ~4–6 sessions across 6 phases; Phases 1–3 are the spine.

## Open Risks & Assumptions

- **Production may carry migration debt.** `lessons.md:56-60` records `0019` and
  `0020` shipping un-applied at the S-12 merge. Confirm the production migration
  state before applying `0021` rather than assuming it sits at `0020`.
- **There is no automated route to a migrated production database.** The plan
  names the manual one and puts it first on the checklist, but it stays a human
  step that a green deploy will not reveal as missing.
- **Full GitHub symmetry widens the schema change** beyond the minimum the frame
  identified — a second referential action, the first `monitored_repo` rows that
  exist without a credential, and (plan-review F1) a change to
  `storeGithubIntegration`'s write shape without which the GitHub keep is copy
  rather than behaviour.
- **The cadence-override erasure is knowingly left standing.** Same root, not
  reachable by this slice's mechanism; proposed as a roadmap entry.

## Success Criteria (Summary)

- Disconnecting Jira with the default button leaves every recorded absence in place.
- Choosing the destructive button removes them, and says so before it does.
- Rotating a token mid-sprint and reconnecting leaves the sprint's committed story points exactly as they were.
