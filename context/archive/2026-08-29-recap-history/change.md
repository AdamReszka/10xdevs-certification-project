---
change_id: recap-history
title: Recap history view with sprint-bounded auto-purge
status: archived
created: 2026-08-29
updated: 2026-08-29
archived_at: 2026-08-29T21:21:14Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Roadmap **S-12** (`context/foundation/roadmap.md`) — PRD **FR-019**. Prereq S-11
(`daily-recap-email`) is done: `daily_recap` already stores a versioned
`payload` + `rendered_message` per send, so the rows to browse exist.

Roadmap-recorded scope notes to carry into planning:

- **Outcome:** list past daily recaps + drill into one; recaps older than the
  current sprint + 2 previous sprints are auto-purged.
- **Risk (roadmap):** the purge must be keyed to *sprint boundaries*, not
  calendar days — confirm per-sprint end-date metadata is stored so the query
  can identify "current + 2 previous sprints".
- Roadmap also names S-12 as the home for the **deferred Resend
  bounce/complaint webhook** — decide at planning whether that rides along or
  splits out.
