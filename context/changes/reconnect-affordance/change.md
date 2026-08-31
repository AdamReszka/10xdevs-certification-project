---
change_id: reconnect-affordance
title: Reconnect and Disconnect stop looking like the same decision
status: implementing
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

Roadmap **S-31** (`context/foundation/roadmap.md`). PRD refs — (Guardrails: no
silent data loss). Prerequisites S-24, S-26 — both `done`.

The half of Open Roadmap Question 4(b) that S-26 answered but could not fix.
**Token rotation is already lossless today**: `storeJiraIntegration` is an upsert
(`onConflictDoUpdate`, `id` deliberately omitted from the SET) and `sprint` is
deleted only when the monitored project actually changes — and Settings'
"Reconnect" reaches exactly that path. Nothing on the card says so, and
Disconnect sits beside it looking equally reasonable when the integration is red.

S-24 gave Disconnect a confirmation, S-26 gave it a safe default; both act
*after* the lead has already chosen the wrong control. The remaining problem is
upstream of the dialog: two buttons named after mechanisms, when the lead is
thinking in jobs — *my token expired*, *we moved to a different project*, *we are
done with this integration*.

Shape: copy and layout. No schema change, no store change.

Full evidence: `context/archive/2026-08-30-disconnect-data-retention/frame.md`
("Overloaded verb").

### Working context

Running in a parallel worktree (`.claude/worktrees/reconnect-affordance`, branch
`feat/reconnect-affordance`) alongside the main checkout's S-28 archive work.
`context/foundation/parallel-worktrees.md` rules apply: no migrations, no
`test:integration`, no `test:e2e`, no seeding.
