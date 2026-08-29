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

## Delete-then-insert is only safe for tables with no hand-entered children

- **Context**: src/lib/integrations/roster-store.ts — `saveRoster` expressed "save the roster" as DELETE the owner's whole `team_member` set + re-INSERT it, copied from the S-02/S-03 monitored-set stores (`github-store.ts`, `jira-store.ts`) where the idiom is safe.
- **Problem**: `team_member` has children the monitored-set tables do not. `absence.team_member_id` is `ON DELETE CASCADE` and `anomaly.related_team_member_id` is `ON DELETE SET NULL`, neither `DEFERRABLE`, so both referential actions fire on the DELETE and are **not** undone by the re-INSERT — the database cannot tell that a re-inserted row carrying the same id is "the same row". Every save silently destroyed the owner's recorded absences (hand-entered FR-010 data) and detached anomaly attribution, and reset `is_active` to the column default because the insert omitted it. Proven against local Postgres: a save that changed nothing took absences 1 → 0 and attribution `<id>` → NULL.
- **Rule**: A full-set delete-then-insert is safe only for tables with no hand-entered children. When any child FK exists, express "save" as a **differential upsert** — update rows by id, insert rows without one, delete nothing — and make removal an explicit single-row operation. Two corollaries: (a) the owner-scoped DELETE was accidentally providing cross-account isolation, so every `UPDATE … WHERE id = $1` that replaces it MUST carry `AND owner_id = $ownerId` **and** reject a submitted id outside the caller's current set rather than treating it as new; (b) check the referential actions on every inbound FK before reaching for the idiom, not just the table you are writing.
- **Applies to**: any owner-scoped "save the whole set" store function (S-02/S-03 monitored sets, S-15 roster, and future settings/threshold sets); implement, impl-review, plan-review.

## A narrowing predicate turns "wrong value" into "empty result", which reads as success

- **Context**: `src/lib/integrations/sync/run-sync.ts` — `searchSprintIssues` filters by `sprint = <jira_sprint_id>`; `src/lib/jira.ts:listBoards` filtered by `type === "scrum"`; the Jira delta cursor filtered by `updated >= <cursor>` without checking which sprint that cursor belonged to.
- **Problem**: Each of these narrows a query on a value that came from somewhere else — a stored row, a config guess, a previous cycle. When the value is WRONG, the query does not error: it returns an empty set, which is indistinguishable from a legitimately empty one. The cycle then reports `OK`. This is how a real account showed a healthy green sync and an empty dashboard for days: the stored sprint was the demo seed's `jira_sprint_id=1001`, which does not exist in that Jira, so the JQL correctly matched nothing. Same shape three times: `type === "scrum"` silently returned `[]` for projects whose board Jira types differently, and the sprint-blind cursor silently hid every ticket in a new sprint that had not been edited since.
- **Rule**: When a query narrows on a value that came from elsewhere, an empty result MUST be treated as "the predicate may be wrong", not as "there is nothing there". Two obligations follow: (a) the operator log must distinguish the cases — record WHICH predicate produced the empty set (a diagnostic `outcome` string, not a bare `OK`), so "nothing matched" is never reported as an ordinary successful run; and (b) where the narrowing value is stored state that an upstream system owns, reconcile it against that system rather than trusting it indefinitely — the value is a cache, and a cache with no invalidation is a permanent silent failure.
- **Applies to**: any sync/detect path filtering on an external id, a stored cursor, or a type/category guess (S-05 ingestion, S-16 reconciliation, and any future tracker/VCS binding); implement, impl-review, plan-review.

## Test the no-configuration path through the real resolver, not through an injected dependency

- **Context**: Any module that resolves configuration from the environment (API keys, sender addresses, base URLs, bindings) and either degrades or throws depending on what it finds — `email-transport.ts` (`resolveApiKey` / `resolveFromAddress` / `resolveEmailTransport`), `crypto.ts:getKey`, `setup/github/actions.ts:githubOptsFromEnv`.
- **Problem**: Every test passed a fully-populated `ENV` *and* injected the dependency the resolver would have produced, so no test ever ran the configuration the code will actually meet on its first real start. 210 integration tests were green while `sendDailyRecap` could not send at all without `RESEND_FROM_ADDRESS` — the sender check sat after the claim, so the first cron tick after deploy would have written `FAILED` + `attempt_count` at the cap for every owner, burning the day in a way that provisioning the secrets that same afternoon could not undo. The designed degradation path (a console transport when no key is set) was unreachable from its main consumer for the same reason, and nothing reported it: dead code emits no signal, and the tests routed around it.
- **Rule**: When a module resolves configuration from the environment and has defined behaviour for its absence, there MUST be a test that goes through the REAL resolver with that configuration empty — not only one that injects a ready-made dependency. Injection bypasses exactly the code that runs first in production. Corollary: a precondition that cannot improve on the next attempt (missing config, missing permission) is checked BEFORE anything is persisted and ends in a skip, never in a durable failure record that outlives the fix.
- **Applies to**: implement, impl-review, plan-review

## A deploy that ships code but not migrations breaks silently, at the first request that reads the new column

- **Context**: Any slice whose phases add a `src/db/migrations/*.sql` file, on a project where merge-to-main triggers a CODE-ONLY deploy (Cloudflare Workers Builds). `.github/workflows/ci.yml:53` runs `db:migrate` against CI's own ephemeral Postgres; `npm run db:migrate` is local-only by construction (`drizzle.config.ts` force-loads `.env.local` with `override: true`), and `DATABASE_URL_OVERRIDE` is the only documented route to a non-local database.
- **Problem**: At the S-12 merge (2026-08-29) migrations `0019` and `0020` shipped inside deployed code that selects `recap_settings.disabled_reason` / `disabled_at` and assumes `daily_recap.sprint_id` is nullable, while nothing had applied either to production. EVERY gate was green — lint, typecheck, 1047 unit, 335 integration, bundle-size, the Workers build — because all of them run against a database that DOES have the migration. Nothing in the pipeline can observe the gap, the deploy reports success, and the break surfaces only when a real user hits the first request that reads the new column.
- **Rule**: A phase that adds a migration is not done when its tests pass — it is done when the migration has a NAMED ROUTE TO PRODUCTION. State that route in the plan's `## Migration Notes`, and put applying it on `MANUAL-CHECKLIST.md` as a row that runs BEFORE any manual row depending on the new column. Never read a green deploy as evidence of a migrated database: schema and code travel on different tracks here and only one of them is automated.
- **Applies to**: plan, plan-review, implement, impl-review
