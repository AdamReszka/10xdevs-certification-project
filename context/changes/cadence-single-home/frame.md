# Frame Brief: Retiring what S-30 left behind (S-32)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

S-30 shipped `sprint_cadence_override` and deliberately did **not** drop
`sprint.working_days` / `sprint.cadence_overridden`. Two consequences were
recorded as leftovers (`context/foundation/roadmap.md` §S-32):

1. Two written-but-never-read columns, with one hermetic test
   (`src/lib/cadence-override-readers.test.ts`) as the only thing stopping a
   future reader from picking up the stale copy.
2. `sprint_cadence_override` rows that no write path ever deletes — "nothing
   prunes records for sprints that fell out of the PRD's current-plus-two
   retention window, or for a Jira project the account no longer monitors".

## Initial Framing (preserved)

- **User's stated cause or approach**: the roadmap's own shape — "one migration
  dropping the two columns and deleting the reader guard in the same commit,
  plus a decision on when a cadence record stops being worth keeping". The first
  half is called a chore; the second is called "genuinely a decision, not a
  chore", because "a prune that is too eager is the S-30 defect rebuilt in a
  cron job".
- **User's proposed direction**: take S-32 as written, both halves in one slice.
- **Pre-dispatch narrowing**: *scope* — "Both, as written". *Observation* —
  "Nothing observed": no rows anywhere have bothered the owner; the retention
  concern comes entirely from S-30's own write-up. *Deploy state* — "Local dev
  only": production is still empty, the only database holding `sprint` rows is
  local Supabase.

## Dimension Map

The two leftovers could each originate at a different place:

1. **The TypeScript readers of the two columns** — the guard's subject. Does an
   allowlist plus a DROP actually close it?  ← initial framing, half 1
2. **A non-TypeScript reader the guard cannot see** — SQL, a migration, a
   fixture. The guard scans `.ts`/`.tsx` for a camelCase identifier.
3. **The premise that a retention regime exists to bring this table into line
   with**  ← initial framing, half 2 assumes one
4. **The premise that a record for an unmonitored project is junk** — as opposed
   to a promise already made to the lead in copy.
5. **Unbounded growth** — is there a write path that manufactures rows without a
   human?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. TS readers: the columns are genuinely unread and the drop is mechanical | Four allowlisted files only, all writers or row-literal builders: `schema.ts`, `reconcile-sprint.ts:349-397` (the writer), `demo/fixture.ts:828-829`, `anomaly/test-support.ts:41-42`. Three DROP COLUMN precedents already exist (`0009`, `0012` sp_capacity, `0018`), so the migration shape is house-standard. | **STRONG** |
| 2. A reader the guard cannot see | `src/lib/cadence-override.ts:524-553` holds `BACKFILL_CADENCE_OVERRIDES`, whose SQL reads `s."cadence_overridden"` and `s."working_days"`. `cadence-override.integration.test.ts:529` pins it byte-for-byte to `0023_flowery_flatman.sql`, and `:542,562,580,587` **execute it live** against a fully-migrated database. The guard misses it twice over: its `FLAG` is `/\bcadenceOverridden\b/` (camelCase) and the SQL is snake_case; and `cadence-override.ts` is *deliberately off* the allowlist ("if a sprint-row read ever appears there, that is worth failing on too"). | **STRONG** |
| 3. A current-plus-two retention regime exists | It does not. `purgeOldRecaps` (`src/lib/recap/retention.ts`) is the ONLY age-based delete in the repo, and it deletes recaps only. Nothing purges `sprint`, `jira_ticket`, `jira_status_history`, `pull_request` or `commit` by age; the two `delete(sprint)` calls (`connection-service.ts:456`, `jira-store.ts:287`) are project-switch/disconnect, not retention. | **NONE** |
| 4. A record for an unmonitored project is junk | It is a promise. `disconnect-impact.ts:203-206` tells the lead in advance the switch keeps *"the sprint cadence you set by hand, which stays with the project you set it for"*, and the resolver's `sameProject` LEFT JOIN (`cadence-override.ts:278-300`) exists so such rows stay visible rather than vanishing. S-30's impl-review already fixed a bug caused by treating them as a fault. | **NONE** |
| 5. Unbounded growth | Two inserts exist (`cadence-override.ts:399`, `:478`), both behind `saveCadence`, reachable only from the wizard's cadence form and `/team/cadence`. Zero deletes. A row exists only where a human pressed Save, at most one per sprint. Measured: local holds **1** override row against 7 `sprint` rows (0 flagged); production holds none. | **NONE** |

## Narrowing Signals

- **"Nothing observed."** The owner has not seen a single row they would call
  junk. The retention half is a prediction inherited from S-30's own prose, not
  a report — and hypotheses 3–5 say the prediction rests on two false premises
  and no growth mechanism.
- **"Local dev only."** With production empty, the DROP's deploy-ordering hazard
  (a drop must land *after* the code stops writing, the reverse of every
  additive migration this repo has shipped — `lessons.md`, "a deploy that ships
  code but not migrations") is real as a habit but carries no live data risk
  this time. It belongs in `## Migration Notes`, not in the slice's risk budget.
- **1 override row, 7 sprint rows, 0 flagged.** The scale the second half was
  worried about does not exist yet and is bounded by human effort when it does.

## Cross-System Convention

The PRD has already decided this exact question for this exact shape. The
retention non-goal carries a named exception: the per-sprint *measurement*
record — "a few dozen bytes per sprint" — is retained for the team's whole
lifetime, "because an average that resets every three sprints is not an
average". `sprint_cadence_override` was built to the `sprint_measurement`
pattern on purpose (`schema.ts:575-603` says so), and its tier-2 inheritance
lookback is unbounded by construction — `start_date <= ?`, ordered desc, limit 1,
with no floor (`cadence-override.ts:274-300`). The same sentence applies one
step further: an inheritance chain that resets every three sprints is not
inheritance.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the last live reader of the
> superseded columns is a SQL constant the guard was never able to see, and the
> "retention decision" is a decision the PRD has already made — so S-32 is one
> real migration knot plus one paragraph to write down, not a migration plus a
> prune.

Half 1 is **confirmed but relocated**. The roadmap calls it a chore because it
counted TypeScript readers, and by that count it is one. The surviving reader is
`BACKFILL_CADENCE_OVERRIDES`, executed against a live database by four
integration tests while a fifth pins it byte-for-byte to migration `0023` —
which is immutable history and cannot be edited to match. Dropping the columns
without untying that knot turns four green integration tests red on `column
s.cadence_overridden does not exist`. That is the finding a plan must open with;
"delete the guard in the same commit" is still right, and still not the hard part.

Half 2 is **reframed from a decision into a record**. Both edges the roadmap
names are false premises: there is no current-plus-two purge for anything but
recaps, and a record for an unmonitored project is a promise the product makes
out loud, not debris. With no observed rows, no non-human write path, and a
measured population of one, the honest answer to "when does a cadence record
stop being worth keeping" is *it doesn't* — the same answer, for the same
reason, that the PRD already gave `sprint_measurement`. What S-32 owes is
writing that down where the next reader will find it (the PRD non-goal's
exception, and the table's docblock), so the question stops being re-opened by
each slice that notices nothing prunes the table.

## Confidence

- **HIGH** — hypotheses 3, 4 and 5 each have *no* supporting evidence and each
  has direct contradicting evidence with file:line; hypothesis 2 is a
  reproducible mechanical fact about four test call sites; the reframe matches
  the PRD's own recorded convention for the sibling table.

The one thing worth verifying before implementation rather than during it: run
`npm run test:integration -- cadence-override` after the drop is written to
confirm the four call sites are the whole blast radius, and no fifth executes
the constant indirectly.

## What Changes for /10x-plan

Plan half 1 around the SQL constant, not around the TypeScript readers: the
migration and the guard deletion are the easy phases, and the phase that has to
be thought about is how `BACKFILL_CADENCE_OVERRIDES` and its byte-for-byte pin
stop referencing dropped columns without editing an already-shipped migration
file. Plan half 2 as documentation and an explicit non-decision — amend the
PRD's retention exception and the table docblock to say the record is kept for
the team's lifetime like `sprint_measurement`, and record *why* a prune was
rejected (the project-switch promise, the unbounded tier-2 lookback) so the next
reader does not rebuild it. Do **not** plan a prune job, a cron, or a retention
predicate for `sprint_cadence_override`.

## References

- Roadmap: `context/foundation/roadmap.md:1535-1575` (S-32 detail block), `:585` (summary row)
- Superseded columns: `src/db/schema.ts:444-466`
- The guard and its blind spot: `src/lib/cadence-override-readers.test.ts`
- The surviving SQL reader: `src/lib/cadence-override.ts:524-553`; pinned and executed at `src/lib/cadence-override.integration.test.ts:529,542,562,580,587`; shipped copy at `src/db/migrations/0023_flowery_flatman.sql`
- The only writer: `src/lib/integrations/reconcile-sprint.ts:349-397`
- Resolver tiers / unbounded lookback: `src/lib/cadence-override.ts:200-300`
- Project-switch promise: `src/lib/integrations/disconnect-impact.ts:203-206`
- The only implemented purge: `src/lib/recap/retention.ts`
- PRD retention exception for `sprint_measurement`: `context/foundation/prd.md` § Non-Goals
- Prior art: `context/archive/2026-08-31-cadence-override-retention/`
- Investigation: performed inline (no sub-agents spawned, per session policy); every row of the hypothesis table carries file:line.
