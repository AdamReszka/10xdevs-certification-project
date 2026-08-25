---
change_id: absence-calendar
title: Absence calendar
status: implementing
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

Roadmap **S-08** (`context/foundation/roadmap.md`), PRD **FR-010**.

Outcome: the user can record per-sprint team-member absences (vacation, sickness,
training) on a simple calendar.

Absences are not just captured data — they feed **three** downstream calculations,
and the roadmap's risk note calls for testing all three independently, because a
silent failure in any one leaves the anomaly inbox giving misleading signals
rather than an error:

1. suppress `DEVELOPER_INACTIVE` for the absent developer during the window
2. raise the `SPRINT_AT_RISK` score for an unplanned mid-sprint absence
3. feed sprint-capacity calculation

Prerequisites S-04 and S-06 are both done. No blockers, no unknowns recorded.

The `absence` table already exists from F-02 (`src/db/schema.ts`) and is
referenced by S-15's delete gate — `absence.team_member_id` is
`ON DELETE CASCADE`, which is why `saveRoster` is a differential upsert rather
than delete-then-insert.
