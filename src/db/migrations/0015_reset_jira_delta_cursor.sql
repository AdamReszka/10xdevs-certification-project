-- Data-only migration (S-23 impl-review F1). No schema change.
--
-- 0014 added `sprint.committed_frozen_at` with no backfill, so every existing
-- account's active sprint is unfrozen. The first cycle to freeze it must be a
-- FULL Jira pull: `committed_sp` sums the whole ticket table, but
-- `added_after_sprint_start` is only rewritten for the issues a cycle pulled,
-- and on a delta cycle the untouched rows still carry the old
-- `created_at > sprint_start` verdict. Freezing that mixture is permanent —
-- the `case when committed_frozen_at is null` guard means no later cycle can
-- correct it, and the FR-023 measurement record inherits it for good.
--
-- Clearing the cursor costs one larger Jira pull on the next cycle and nothing
-- else: the cursor is a freshness optimisation, never a source of truth. The
-- code-side guard in `run-sync.ts` (freeze only when `updatedSince === null`)
-- is what keeps this from recurring; this statement is what makes the accounts
-- that already exist correct on their very next sync rather than at rollover.
UPDATE "sync_state"
SET "jira_history_cursor" = NULL,
    "jira_cursor_sprint_id" = NULL
WHERE "integration" = 'JIRA';
