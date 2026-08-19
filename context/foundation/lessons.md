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

## Request-scoped pg.Pool must be closed at request end, not leaked per invocation

- **Context**: src/lib/db.ts:7-11 — getDb(env) builds `new Pool({ max: 1 })` per call; consumed by auth.ts (createAuth/getOptionalSession), the S-02 Server Actions, and gated page components.
- **Problem**: The per-request pool is never `.end()`ed. On Workers each request/action/render opens a Hyperdrive-backed connection that lives for the isolate's lifetime → under sustained traffic, connection exhaustion. A naive `ctx.waitUntil(pool.end())` inside getDb is WRONG — pool.end() fires immediately and closes the pool before the caller's queries run.
- **Rule**: On Cloudflare Workers, a per-request DB pool must be torn down exactly when the request ends — reuse one pool per request (cached on request context) and close it via the request's after-hook / `ctx.waitUntil` scheduled to run AFTER the handler, never at pool-construction time. Don't expose the pool to call sites for manual closing (createAuth holds it for the instance's lifetime).
- **Applies to**: src/lib/db.ts and every getDb consumer; any Workers request path that opens a TCP-backed resource (pg Pool over Hyperdrive).

## Cap and origin-check server-directed pagination loops that carry a secret

- **Context**: src/lib/github.ts:183-207 — listRepos follows the GitHub `Link: rel="next"` URL verbatim, refetching each page with the PAT in the Authorization header.
- **Problem**: The loop has no iteration cap and no origin check against the configured baseUrl. Against real api.github.com it's fine, but a hostile/misconfigured base host could return a self-referential or cross-host `next` link → unbounded loop (DoS) and/or the secret forwarded to an arbitrary host.
- **Rule**: When following a server-provided next-link (Link rel=next, HAL, etc.) while attaching a credential, always (a) cap the iteration count to a sane bound, and (b) verify each next URL's origin equals the configured base origin before refetching. Never send a secret to a host the response chose without validation.
- **Applies to**: src/lib/github.ts and any Workers HTTP client following server-directed pagination with a token attached (S-05 GitHub/Jira sync reuses this pattern).
