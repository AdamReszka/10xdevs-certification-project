# Frame Brief: Disconnecting an integration stops destroying the lead's own data (S-26)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Disconnecting Jira cascade-deletes data the lead typed by hand and no sync can
rebuild — every recorded absence, the status mapping, the triaged anomaly state
— because those tables hang under `sprint` / `jira_project` with
`ON DELETE CASCADE`. Split out of S-24 by the owner on 2026-08-30 so consent
could ship without a migration; S-24 settled *consent*, this is the other half.

## Initial Framing (preserved)

- **User's stated cause or approach**: Disconnect removes what the INTEGRATION
  supplied; it should not remove what the LEAD supplied. The cascade was never
  re-examined when S-16 attached `sprint` beneath `jira_project`, and the only
  recorded framing of Disconnect ("I mistyped the token, let me re-enter it")
  does not justify deleting anything.
- **User's proposed direction**: change the referential actions so hand-entered
  rows survive a disconnect — at minimum `absence`. Open Roadmap Question 4
  decides whether the slice grows to "Disconnect means forget the credential" or
  shrinks to `absence` alone.
- **Pre-dispatch narrowing**: the leading concern is the WHOLE class of
  hand-entered data, not `absence` alone; whether the project-switch path is
  coupled to this was explicitly unknown and sent to investigation; and all
  three candidate pressers are real — *"lead zmienia zespół i chce się odpiąć i
  wtedy czyszczenie ma sens, rotacja tokena […] gdzie chcielibyśmy pozostawić
  dane"*. The owner floated a direction in the same breath: **ask whether to
  clear, and allow keeping** — because the lead may re-attach the same Jira with
  a different token and *"dane będą z tej samej puli, szkoda czyścić"*.

## Dimension Map

1. **Referential action on hand-entered children** — `absence.sprint_id`,
   `status_mapping`, `anomaly` hang under CASCADE  ← *initial framing*
2. **Wrong parent** — the lead's data is attached to entities whose lifecycle
   belongs to the SYNC (`sprint`, `jira_project`), not to durable account
   entities (`user`, `team_member`)
3. **Identity across reconnect** — can the system recognise the same Jira after
   a disconnect? Without that, "keep the data" produces unreachable orphans
4. **The verb has no defined meaning** — one irreversible button serves three
   intents that want three different outcomes
5. **A second entry into the same loss** — the project switch destroys the same
   rows by a different root (`DISCONNECT_IMPACT.projectSwitch`)

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Referential action** | No `DELETE FROM absence` exists anywhere in `src/`; absences die *only* as a side effect of a `sprint` row being deleted — cascaded via `jira_credential`→`jira_project`→`sprint` on disconnect (`jira-store.ts:301-310`, `schema.ts:317-319,410-412,642-644`), explicit via `tx.delete(sprint)` on the project switch (`connection-service.ts:416-423`). So ONE referential-action change on `absence.sprint_id` neutralises **both** paths | **STRONG** |
| **2. Wrong parent** | Holds for `absence`, fails for `anomaly`. `absence.sprint_id` has **zero production readers** — `sprint-at-risk.ts:117-131` now matches by DATES, joining four date-based siblings (`capacity.ts:164-176`, `developer-inactive.ts:47`, `absence-store.ts:103,263`, `load-snapshot.ts:90-99`); the column is nullable already; `team_member` (+ `startDate`/`endDate`, both NOT NULL) is a durable parent that survives a disconnect and is already the row's primary FK. `anomaly.sprint_id` is the opposite: NOT NULL, a member of the dedup key `(owner_id, sprint_id, dedup_key)` (`schema.ts:913-917`) and load-bearing for the rollover sweep, whose own comment (`reconcile-sprint.ts:283`) relies on the absence of a NULL trap in `ne(...)` | **STRONG (absence) / NONE (anomaly)** |
| **3. Identity across reconnect** | **Reverses the retention idea for everything except `absence`.** Jira-side ids are durable but internal `jiraProject.id` / `sprint.id` are `randomUUID()`, and `disconnectJira` hard-deletes the parents — so on reconnect the upsert machinery that *would* recognise sameness (`onConflictDoUpdate` on `ownerId`; on `(ownerId, jiraSprintId)` at `reconcile-sprint.ts:249-250`) has nothing to match and inserts fresh rows. A preserved `anomaly` would sit permanently orphaned under a dead sprint id while detection creates a duplicate. A preserved `status_mapping` would be wiped anyway — `storeJiraIntegration` deletes and re-inserts the whole set on EVERY save (`jira-store.ts:262-275`), project change or not. `absence` is the one class where keeping without re-linking is sufficient, precisely because nothing reads the link | **STRONG** |
| **4. Overloaded verb** | **Token rotation is already lossless — and nothing says so.** `storeJiraIntegration` is an upsert: credential and project go through `onConflictDoUpdate` with `id` deliberately omitted from the SET (`jira-store.ts:189-231`), and `sprint` is deleted **only** when `previous.jiraProjectId !== project.jiraProjectId` (`:233-259`). Settings' "Reconnect" reaches `/settings/connections/jira`, which renders the form regardless of credential state. So the presser who wants the data KEPT is already served — by the button sitting next to the one that destroys everything, with nothing distinguishing them when the card is red. Also: there is **no recorded product decision** about what Disconnect is for; the roadmap's "I mistyped the token" is an inference from a QA checklist bullet (`2026-06-14-setup-github-integration/plan.md:192`), not a stated intent | **STRONG** |
| **5. Second entry** | Confirmed, and it has a **third, worse entry nobody recorded** — see below | **STRONG** |

### The finding that was not on the map

`sprint.committed_frozen_at` freezes the commitment exactly once, so that "a
commitment that grows with the scope added to it" cannot make reliability look
good by construction (`run-sync.ts:882-921`). A disconnect deletes the `sprint`
row; a reconnect creates a new one with `committed_frozen_at = null` —
indistinguishable from a sprint SprintFlow has never seen. The next full pull
(forced, because `jiraCursorSprintId` no longer matches the new `sprint.id`,
`run-sync.ts:712-722`) **re-freezes `committed_sp` at the reconnect-time sum**
and stamps a fresh, entirely legitimate-looking `committed_frozen_at`. Because
`sprint_measurement.committedSp` is *"COPIED from `sprint.committed_sp`, never
recomputed"* (`schema.ts:502-506`), retained for the team's whole lifetime and
feeding FR-024's average, a mid-sprint disconnect can permanently poison one
entry of the velocity history with no way to detect or correct it afterwards.

**Trigger conditions**, established directly: the `sprint` row must die while its
measurement is **not yet finalized**, the lead must reconnect to the SAME
project, and the sprint must still be active in Jira (`searchSprintIssues` only
ever queries the active sprint, `jira.ts:920`). In practice: **any
Disconnect→Reconnect of the same Jira during a running sprint** — the token-
rotation scenario. **The bound is real**: `shouldRecompute` (`sweep.ts:66`)
refuses to touch a finalized record and the guard is enforced by Postgres in the
conflict clause, so closed, finalized sprints are untouchable.

A quieter second variant: a disconnect with no return strands the record
unfinalized forever — the sweep iterates `sprint` rows, closed sprints are never
re-pulled, and `listSprintMeasurements` filters on `finalizedAt IS NOT NULL`
(`reader.ts:119`). That sprint does not poison the average; it silently vanishes
from history. The same cascade also erases a lead's cadence override (FR-007):
carry-forward reads the *previous* sprint row, which no longer exists, so the row
reseeds with Jira's defaults and `cadenceOverridden: false`
(`reconcile-sprint.ts:190-231`).

## Narrowing Signals

- **`anomaly.status` is not the lead's triage state — the observation was wrong
  on this point.** It holds `ACTIVE`/`RESOLVED`, written only by `detect.ts` and
  the rollover sweep; no dismiss/acknowledge action exists anywhere in `src/`.
  Anomalies are fully re-derived by the next detection cycle. `change.md` and
  roadmap S-26 both list it as hand-entered; both need correcting.
- **S-23 never considered disconnect.** Zero occurrences of "disconnect" in
  `context/archive/2026-08-27-capacity-in-man-days/`, though its plan reasons at
  length about why the freeze must be permanent (`plan.md:600-602,757-763`). The
  corruption is genuinely undocumented, not a known trade.
- **The "keep or clear" pattern already exists here.** `ConfirmDialog` carries a
  documented `secondary` slot — *"An alternative, usually less destructive, way
  out — e.g. Deactivate beside a refused Delete"* — exercised by the roster,
  where `deleteMember` outright REFUSES when the member has any absences
  (`roster-store.ts:682-684`). `disconnect-confirm.tsx:54-56` currently says *"No
  `secondary`: unlike a member delete, there is no safer alternative to offer
  here."* That sentence is what this slice overturns.
- **Owner's decisions this round**: Disconnect gets a **keep-or-clear choice**,
  scoped to the payload that can genuinely be kept; the `committed_sp`
  corruption is **in scope as its own phase**, with `absence` still leading the
  pass condition; **`status_mapping` is deliberately out of scope** — the lead
  passes through the wizard on reconnect anyway and re-mapping is one step, so
  the loss is accepted rather than overlooked.

## Cross-System Convention

The house answer to "this row must outlive a sync-lifecycle parent" is already
written, and it is **not** softening the cascade — it is **carrying no foreign
key at all**. `sprint_measurement` (`schema.ts:446-470`) stores the Jira-side
project id as plain text with no FK, because *"an FK would reintroduce the very
cascade the record must survive"* and the internal id *"would be the WRONG
identity"*. The mechanism works because the row is never deleted in the first
place — it is "refuse to be deleted", not "recover after deletion", which is
exactly why it does not generalise to re-linking orphans. `absence` needs only
the first half: stop dying. It needs no re-linking, because nothing reads the
link.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: Disconnect is the only visible verb
> for three different intents, two of which are already served losslessly
> elsewhere — and the `sprint`-row deletion it fires does two qualitatively
> different kinds of damage: it destroys hand-entered data that no sync can
> rebuild, and it silently re-freezes a commitment that was designed to be
> frozen once, poisoning a permanent record that feeds FR-024 for the life of
> the team.

The initial framing is **confirmed and materially enlarged**. "Stop taking data
the lead typed" is right and `absence` is exactly the row class where it is both
necessary and structurally free. What the investigation adds is three things the
framing could not see. First, the loss is not the worst outcome: an entry that
looks like valid data and is wrong outranks a gap the lead can see. Second,
"keep the data" is only coherent for rows that carry no FK into the sync
lifecycle — for `anomaly` and `status_mapping` it would manufacture orphans, so
the owner's keep-or-clear choice must be offered over the payload that can
actually be kept, not over the whole cascade. Third, the presser who most wants
the data kept — the token rotator — **already has a lossless path** and is
losing everything only because two adjacent buttons look equally reasonable when
the connection is failing.

## Confidence

**HIGH** — four independent read-only investigations, every claim carrying a
`file:line`; they converged rather than competed, and two of them *contradicted*
the direction they were sent to support (dimension 3 reversed the retention idea
for everything but `absence`; dimension 2 ruled `anomaly` out on its own merits
rather than for lack of ambition). The inverse check held: if the corruption
were a known trade, S-23's plan would show it weighed — it shows the topic never
raised. The finalization guard was verified as a real bound rather than assumed,
which is what keeps the blast radius honest in both directions.

## What Changes for /10x-plan

The plan is about **`absence` surviving both deletion paths, plus a Disconnect
that offers keeping over the payload that can genuinely be kept, plus a separate
phase closing the `committed_sp` re-freeze**. Five things the plan must carry
rather than discover:

1. **One referential-action change on `absence.sprint_id` covers both paths** —
   disconnect and project switch alike — because neither issues an explicit
   delete against `absence`. Verify this rather than trusting it; it is the
   slice's central mechanical claim.
2. **`anomaly` and `status_mapping` stay in the cascade**, each for a recorded
   reason: NOT NULL + dedup key + rollover sweep for the first, owner decision +
   unconditional delete-and-reinsert on every save for the second.
3. **The corruption phase is about the re-freeze, not about the cascade** — the
   fix has to make a re-created `sprint` row distinguishable from a
   never-before-seen one, or make the measurement record the authority. Both
   variants (poisoned entry, stranded record) trace to the same root.
4. **Two documents describe `anomaly.status` as hand-entered triage and are
   wrong** — `change.md` and roadmap S-26 — and are corrected in the same commit.
5. **`disconnect-impact.ts` is the maintained answer with a schema-derived guard
   test**; its copy and its `destroyedTables` both move when the FK does, and the
   test is what stops the dialog from becoming a lie. It also needs a new
   vocabulary for "kept" as distinct from "destroyed" and "weakened".

Carried forward, not planned here: **Open Roadmap Question 4(a) is answered** —
Disconnect keeps a choice rather than a fixed meaning — and the finding that
Reconnect already rotates a token losslessly deserves a roadmap line of its own,
since the affordance problem (two adjacent buttons, one catastrophic) is a UI
question this slice does not own.

## References

- Schema: `src/db/schema.ts:317-319,410-412,446-470,502-506,527,642-644,888-890,903-907,913-917`
- Delete paths: `src/lib/integrations/jira-store.ts:189-231,233-259,262-275,301-310`,
  `src/lib/settings/connection-service.ts:402-423`
- Freeze / measurement: `src/lib/integrations/sync/run-sync.ts:712-722,882-921`,
  `src/lib/measurement/sweep.ts:52-66,112-202`, `src/lib/measurement/reader.ts:105-125`,
  `src/lib/integrations/reconcile-sprint.ts:190-231,249-250,280-293`
- Absence: `src/lib/absence-store.ts:118-131,139-166,172-206`,
  `src/lib/anomaly/rules/sprint-at-risk.ts:117-131`, `src/lib/anomaly/load-snapshot.ts:85-97`
- Convention: `src/lib/integrations/disconnect-impact.ts`,
  `src/components/molecules/confirm-dialog.tsx:59-61,99-107`,
  `src/components/molecules/disconnect-confirm.tsx:54-56`,
  `src/lib/integrations/roster-store.ts:682-684`
- Prior decisions: `context/archive/2026-08-30-destructive-action-confirmation/frame.md`,
  `context/archive/2026-08-30-absence-sprint-scoping/frame.md`,
  `context/archive/2026-08-27-capacity-in-man-days/plan.md:600-602,757-763`,
  `context/foundation/lessons.md:35-40`
- Roadmap: `context/foundation/roadmap.md` S-26, Open Roadmap Question 4
- Investigations: four parallel read-only agents (2026-08-30) — rebuildability
  inventory, re-parenting feasibility, identity across reconnect, overloaded verb
  + second path
