---
change_id: disconnect-data-retention
title: Disconnecting an integration stops destroying the lead's own data
status: implementing
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

Roadmap **S-26** (`context/foundation/roadmap.md`). Outcome: disconnecting an
integration removes what that integration supplied — the credential, the
monitored selection, and the rows a future sync would rebuild. It stops taking
data the lead typed themselves. Concretely: a Jira disconnect no longer deletes
recorded absences.

Split out of S-24 by the owner at `/10x-frame destructive-action-confirmation`
(2026-08-30) so consent could ship without a migration. S-24 settled *consent* —
the lead is asked, is told what goes, and can cancel. This is the other half: a
confirmation makes an irreversible loss **conscious**, it does not make it
**necessary**.

### What shipped (2026-08-30, six phases)

**Read this before the sections below.** Everything from "The mechanism" onwards
describes the defect **as it stood before this slice**, in the present tense it
was written in. It is kept because it is the evidence, not because it is still
true. What is true now:

- Migration `0021` re-points two referential actions at `ON DELETE SET NULL`
  (`absence.sprint_id`, `monitored_repo.credential_id`) and deletes nothing.
- Disconnect has **two** completions rather than one meaning: `Keep my <X> data`
  (primary, default) and `Delete my <X> data` (destructive, reached by name).
  The Jira project switch offers the same pair. So a confirmed disconnect
  destroys recorded absences **only when the lead asks for it by that name** —
  any sentence in this repo that says otherwise unconditionally is stale.
- `anomaly` and `status_mapping` stay in the cascade, for the structural reason
  recorded below (regenerated `randomUUID()` parents, so a kept row would be an
  orphan) — not because the loss was overlooked.
- A re-created `sprint` row now recovers its frozen commitment from
  `sprint_measurement` instead of freezing a second time at the reconnect-time
  sum.
- **Not fixed here, and now on the roadmap:** the cadence override still dies
  with the `sprint` row (**S-28**), and Reconnect still looks like Disconnect's
  twin (**S-29**). Open Roadmap Question 4 is recorded as answered.

### The mechanism, as the roadmap records it (to be verified in research)

- `absence.sprint_id` is `ON DELETE CASCADE` on `sprint` (`src/db/schema.ts`),
  and `src/lib/absence-store.ts` stamps every new absence with the active sprint
  id from `getActiveSprintRow`, whose two-tier fallback returns "the most
  recently started sprint of any state" before it returns NULL. `updateAbsence`
  never re-stamps it. So on any account past first-run setup essentially **every
  absence the lead ever typed is destroyed by a Jira disconnect**, and the
  handful that survive are an arbitrary early-adopter subset decided by *when*
  the row was typed — which nothing in the UI exposes.
- Known class in this repo at a different layer: `lessons.md` — "Delete-then-
  insert is only safe for tables with no hand-entered children" — was written
  about exactly this data. Its rule is "check the referential actions on every
  inbound FK before reaching for the idiom"; the FK that fires here was never
  re-examined when S-16 attached `sprint` beneath `jira_project`.

### Also in range — weighed at `/10x-frame`, 2026-08-30

- **`sprint.committed_sp` / `committed_frozen_at` — IN SCOPE, and worse than a
  loss.** The freeze is designed to happen exactly once. A disconnect deletes the
  `sprint` row; a reconnect creates a new one with `committed_frozen_at = null`,
  indistinguishable from a sprint never seen, and the next full pull re-freezes
  the commitment **at the reconnect-time sum**. Since
  `sprint_measurement.committedSp` is copied and never recomputed, a mid-sprint
  disconnect permanently poisons one entry of the FR-024 velocity history with
  something that looks like valid data. Bounded: `shouldRecompute`
  (`sweep.ts:66`) refuses to touch a finalized record, so closed sprints are
  safe. A quieter variant — disconnect with no return — strands the record
  unfinalized forever, so the sprint vanishes from history instead.
- **Hand-imported cadence columns — same root.** Carry-forward reads the
  *previous* sprint row, which the cascade removed, so the row reseeds with
  Jira's defaults and `cadenceOverridden: false` (`reconcile-sprint.ts:190-231`).
- **`status_mapping` — OUT of scope by owner decision** (re-entered in one wizard
  step; nothing remembers the lead's prior choice, and `suggestCategory` only
  guesses from status names).
- **`anomaly.status` — THE ORIGINAL CLAIM WAS WRONG.** It is not triage the lead
  set by hand: it holds `ACTIVE`/`RESOLVED`, written only by `detect.ts` and the
  rollover sweep, and no dismiss/acknowledge action exists anywhere in `src/`.
  Anomaly rows are fully re-derived by the next detection cycle. `anomaly` also
  stays in the cascade on its own merits — `sprint_id` is NOT NULL, sits in the
  dedup key `(owner_id, sprint_id, dedup_key)`, and the rollover sweep depends on
  its NULL-free comparison. Roadmap S-26 carries the same error and is corrected
  with the fix.

### The scope question is SETTLED (2026-08-30, `frame.md`)

**Open Roadmap Question 4** — *should disconnecting an integration delete its
data at all, and who actually presses this button?* The roadmap records both
halves: (a) the cascade is justified by nothing written down — the only recorded
framing of Disconnect is S-02/S-03's "I mistyped the token, let me re-enter it",
for which deleting the whole synced history is a strange response; (b) the
plausible pressers are someone rotating an expired token (who wants the data
KEPT), someone repointing at a different project (already served by
`jira-project-editor.tsx` without a disconnect), and someone leaving the product
(who does not care).

**Answered by the owner at `/10x-frame`:** Disconnect keeps a **choice** rather
than a fixed meaning — the lead is offered keep-or-clear, over the payload that
can genuinely be kept. That qualifier is load-bearing: the frame round found
that "keep the data" is structurally coherent only for rows carrying no FK into
the sync lifecycle. `absence` qualifies; `anomaly` and `status_mapping` do not,
because internal `sprint.id` / `jira_project.id` are regenerated on reconnect
and a preserved row would be an orphan nothing re-finds.

Two further owner decisions the same round: `status_mapping` is **deliberately
out of scope** (the lead passes through the wizard on reconnect anyway and
re-mapping is one step), and the `committed_sp` corruption below is **in scope
as its own phase**, with `absence` still leading the pass condition.

Also established: **token rotation is already lossless today** —
`storeJiraIntegration` upserts and touches `sprint` only when the project
actually changes, and Settings' "Reconnect" reaches that path. The presser who
most wants the data kept already has a safe route; they lose everything only
because Disconnect sits beside it looking equally reasonable.

### Unblocked by S-20 (2026-08-30)

The open question used to be what an orphaned absence *means*, because `SET NULL`
on `absence.sprint_id` collided with S-20. S-20 ruled the column is **write-time
provenance with no reader** — `SPRINT_AT_RISK` now matches absences by date — so
nothing downstream changes behaviour if the stamp is nulled, and S-26 is free to
choose the referential action on its own merits. S-20 deliberately left the
writer, the FK and the cascade exactly as they were, so the column is not being
settled twice.

### Migration

This slice changes referential actions, so it carries a migration — which means
it runs in the MAIN checkout, never a worktree (`CLAUDE.md`: all worktrees share
one local Postgres). Per `lessons.md`, a migration is not done when its tests
pass but when it has a NAMED ROUTE TO PRODUCTION; that route belongs in the
plan's `## Migration Notes` and on `MANUAL-CHECKLIST.md` before any row that
reads the changed schema.
