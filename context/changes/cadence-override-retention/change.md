---
change_id: cadence-override-retention
title: A hand-entered sprint cadence survives a disconnect and a project switch
status: impl_reviewed
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

Roadmap S-30. The cadence columns live ON the `sprint` row (`schema.ts:419-436`),
which dies with the Jira credential in BOTH of S-26's disconnect outcomes —
`sprint.id` is a `randomUUID()` a reconnect regenerates. Carry-forward reads the
PREVIOUS sprint row (`reconcile-sprint.ts:190-231`), so with that row gone the
next reconcile reseeds from Jira's configuration and writes
`cadenceOverridden: false`: the override is not lost loudly, it is replaced by a
plausible wrong number.

Not fixable by a referential action. The open modelling question is what a cadence
override BELONGS to — the account, or a sprint identified Jira-side (the
`sprint_measurement` pattern, `schema.ts:446-470`, which carries the Jira-side key
and no FK into the sync graph).

S-29 shipped first and deliberately left this open ("Not moving cadence off the
`sprint` row … A disconnect still loses the override"), and raised the stakes: the
override is now settable from a reachable screen (`/team/cadence`). Two S-29
pieces to reuse — `getActiveSprintRow` as the single resolver for read and write,
and `forceCadenceRefresh`, which already gives the reconcile a way to be told what
to do with the flag.
