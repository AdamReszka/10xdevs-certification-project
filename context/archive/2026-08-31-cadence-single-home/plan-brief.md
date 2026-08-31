# The cadence a lead chose has exactly one home in the database (S-32) — Plan Brief

> Full plan: `context/changes/cadence-single-home/plan.md`
> Frame brief: `context/changes/cadence-single-home/frame.md`

## What & Why

S-30 moved the lead's chosen cadence into `sprint_cadence_override` and left the
old copy on `sprint` in place, written but never read, held by one hermetic
source scan. This slice removes the second copy. The frame's finding is what the
plan is built around: **the last live reader of the superseded columns is a SQL
constant the guard was never able to see, and the "retention decision" is a
decision the PRD has already made — so S-32 is one real migration knot plus one
paragraph to write down, not a migration plus a prune.**

## Starting Point

`sprint.working_days` / `sprint.cadence_overridden` are written by two paths and
read by none of the application code. `BACKFILL_CADENCE_OVERRIDES`
(`cadence-override.ts:524-553`) reads both in SQL; four integration tests execute
it live and a fifth pins it byte-for-byte to migration `0023`, which is shipped
history and cannot be edited. Nothing prunes `sprint_cadence_override` — and
nothing prunes `sprint`, `jira_ticket` or `pull_request` either, so there is no
retention regime for the table to be out of line with. Measured: one override row
locally, zero on production.

## Desired End State

`sprint` carries no cadence-override state, the reader guard is gone because the
database now enforces what it scanned for, and the PRD, the table docblock and
the roadmap all record that the record is kept for the team's lifetime — with the
evidence for why a prune was rejected, so the question stops being re-opened.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| The retention half | No prune, ever — record the non-decision | Both edges the roadmap named are false premises: no current-plus-two purge exists for anything but recaps, and a record for an unmonitored project is a promise `disconnect-impact.ts` makes to the lead in copy. | Frame |
| Where the non-decision is written | PRD § Non-Goals + table docblock + roadmap | Same mechanism the PRD already uses to protect `sprint_measurement`'s record; prose, not a new guard. | Plan |
| `BACKFILL_CADENCE_OVERRIDES` | Delete the constant and all five of its tests | After the drop the statement cannot execute; `0023` keeps its verbatim copy and a fresh database still runs it *before* the drop, so chain correctness is untouched. | Plan |
| Enforcing "nothing deletes a row" | Prose only, no replacement guard | S-32 exists to retire a guard; adding one in the same commit trades one debt for another. | Plan |
| Phase boundary | Cut readers/writers first, drop second | A green suite with the columns still present is direct evidence the mapped blast radius is the whole of it, before anything irreversible. | Plan |

## Scope

**In scope:** dropping both columns; deleting the reader guard and the backfill
constant with its five tests; removing both writers' use of the columns
(`reconcile-sprint.ts`, `roster-store.ts`) and the two row literals
(`demo/fixture.ts`, `anomaly/test-support.ts`); retargeting four test files onto
the record; the PRD / docblock / roadmap record of why no prune exists.

**Out of scope:** any prune job, cron or retention predicate for
`sprint_cadence_override`; `sprint.length_days` / `start_day`, which remain tier
3 of the resolver; editing `0023`; a replacement guard test; production
migration.

## Architecture / Approach

Two writers stop writing → columns dropped by a generated `0024` → the guarantee
moves from a source scan to the schema. Verification found a **fifth** touch
point the frame's four-file list did not carry: `saveCadence`
(`roster-store.ts:1156-1160`) writes `workingDays` into `sprint` inside a
`.set({…})`, invisible to both of the guard's regexes — a write by object key
matches neither the camelCase flag nor the receiver-name read pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Cut the last readers and writers | Nothing in `src/` names either column except `schema.ts`; guard and backfill tests deleted | The guard fails on its own allowlist the moment the writes go, so it cannot be carried past this phase — it must be deleted here, not with the migration |
| 2. Drop the columns | Generated `0024` with two `DROP COLUMN`s, applied locally | Deploy ordering is the reverse of every additive migration this repo has shipped; enforced by the phase order, no live data at stake |
| 3. Write down the non-decision | PRD exception extended, docblock made permanent, roadmap updated | Prose can be ignored — deliberately accepted over a second guard |

**Prerequisites:** S-30 (archived 2026-08-31). Local Supabase running; no parallel
worktree, since this slice runs both `db:migrate` and the integration suite.
**Estimated effort:** one session, three phases.

## Open Risks & Assumptions

- Rollback stops being "just a code revert" — S-30's stated reason for keeping
  the columns. Accepted: that window closes because a green suite proves it
  unnecessary.
- The prose record of the no-prune decision is not enforced by anything. Accepted
  in preference to replacing a retired guard with a new one.
- `0023`'s header will name a constant that no longer exists. Accepted: shipped
  migrations are not edited; the forward pointer goes in `0024`'s header.

## Success Criteria (Summary)

- The two columns do not exist, and the full suite — unit, integration, typecheck,
  lint — passes without them.
- A lead can still set Mon–Thu on `/team/cadence`, and it survives a reload with
  working days reading as hand-set while length and start day follow Jira.
- Someone asking "why does nothing prune `sprint_cadence_override`" finds the
  answer and its evidence in the PRD and the docblock, without opening the archive.
