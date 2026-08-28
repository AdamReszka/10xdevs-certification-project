# Follow-ups from implementation review

## Phase 6 prerequisite — tie-break for overlapping sprint windows (from Phase 4 impl-review F3)

**Where it bites**: `src/lib/measurement/sweep.ts`, the delivered-SP
recomputation. Delivered SP is deliberately not narrowed by
`jira_ticket.sprint_id` — that is the fix that lets a re-stamped carried-over
ticket count in the sprint that finished it (integration test 4.10). The window
`[sprintStart, sprintEnd]` is therefore the only predicate.

**Why it is not safe by construction**: `src/lib/sprint.ts` documents that an
owner can hold more than one ACTIVE `sprint` row (`importCadence` conflicts on
`jiraSprintId` and inserts rather than updates), and Jira Software permits
parallel sprints on one board. Two overlapping records each count the same
first-DONE instants.

**Why it matters beyond one record**: FR-024 averages normalised velocity across
these records, so a double count does not stay local — it inflates the estimate
the lead is shown.

**To decide before Phase 6 consumes the series**:

1. Is the overlap state reachable in practice for the monitored FM project?
   (Unverified — check whether the board ever runs parallel sprints.)
2. If yes, which tie-break: nearest `startDate`, or the sprint the ticket was
   stamped to at the instant of its first DONE (needs the stamp's own history,
   which the schema does not keep)?
3. Whichever is chosen, it must not narrow by `sprint_id` — that regresses 4.10.

**Not blocking Phase 5.** Phase 5 writes overrides and corrections; it does not
average anything.
