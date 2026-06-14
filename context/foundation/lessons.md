# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Nullable column in a UNIQUE dedup key defeats deduplication

- **Context**: src/db/schema.ts — jiraStatusHistory's UNIQUE(ticket_id, jira_changelog_id), the dedup key for S-05 incremental upsert.
- **Problem**: The dedup column (jira_changelog_id) was left nullable. Postgres treats NULLs as DISTINCT in a UNIQUE constraint, so two rows with a NULL in that column never collide — the constraint silently fails to dedup, and idempotent upsert lets duplicates through.
- **Rule**: Any column used as (part of) a UNIQUE constraint that an upsert/ON CONFLICT relies on for idempotency MUST be NOT NULL. If a natural key can be absent, don't rely on a UNIQUE constraint for dedup there.
- **Applies to**: Drizzle/Postgres schema slices defining source-id dedup keys for synced data (S-05, and any table with a unique(externalId) upsert path).

## Pin turbopack.root to neutralize workspace-root OOM crashes

- **Context**: Any Next.js 16 + Turbopack dev/build run in a project nested under a parent directory that may contain its own lockfile (monorepo-ish or course/workspace layouts).
- **Problem**: Turbopack detects a stray lockfile in a parent dir, infers the wrong workspace root, and recursively file-watches the entire parent tree → runaway memory → OS OOM → the Mac powered itself off (crashed ~3 times before diagnosis).
- **Rule**: Always pin `turbopack.root` to the project dir in next.config.ts, keep parent dirs free of stray lockfiles, and run dev/build with a hard Node memory cap (NODE_OPTIONS="--max-old-space-size=2048") so a runaway watch self-kills before the OS OOMs.
- **Applies to**: implement, impl-review
