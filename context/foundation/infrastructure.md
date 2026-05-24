---
project: sprintflow
researched_at: 2026-05-23
recommended_platform: Cloudflare Workers
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Next.js 16.2.6 (App Router)
  runtime: Node.js (Workers nodejs_compat)
  adapter: "@opennextjs/cloudflare"
  database: PostgreSQL via Neon (HTTP/serverless driver required)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the highest-scoring platform across all five agent-friendly criteria, costs $5/month at MVP scale (10M requests/month included), and supports the 15-minute background sync requirement via native Cron Triggers. The `@opennextjs/cloudflare` adapter (GA) targets Workers directly, replacing the deprecated `@cloudflare/next-on-pages` that `CLAUDE.md` currently references — updating that reference is the first action item. Two hard prerequisites before first deploy: (1) verify the Next.js 16.2.0 crash (opennextjs-cloudflare issue #1157) is resolved in the installed adapter version, and (2) replace the standard pg/Drizzle TCP client with Neon's HTTP serverless driver, which is required by the Workers request-scoped I/O model.

## Platform Comparison

Scoring: Pass = 2 / Partial = 1 / Fail = 0. Hard filter: Q1="Yes (persistent background work required)" — all platforms retained because each has a mechanism for scheduled execution, but complexity and reliability of that mechanism varies. Soft weights applied: cost-sensitive (Q2=Minimize cost) penalizes platforms requiring ≥$20/month; no edge-CDN preference (Q4=Single region); no co-location preference (Q5=External providers fine).

| Platform | CLI-first | Managed / Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Raw | Cost adj. | Final |
|---|---|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | 10 | 0 ($5/mo) | **10** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial [beta MCP] | 9 | −2 ($20/mo required for 15-min cron) | **7** |
| **Netlify** | Pass | Pass | Pass | Pass | Partial [early-GA MCP] | 9 | −2 ($20/mo + Scheduled→Background indirection) | **7** |
| **Render** | Partial (no CLI rollback) | Partial (managed containers) | Pass | Partial (REST-only rollback) | Pass | 7 | 0 ($7–8/mo) | **7** |
| **Railway** | Partial (no CLI rollback) | Partial (managed containers) | Partial (no llms.txt) | Partial (no CLI rollback) | Pass | 6 | 0 ($5/mo) | **6** |
| **Fly.io** | Pass | Partial (Dockerfile required) | Partial (no llms.txt) | Partial (image-tag rollback only) | Partial [experimental MCP] | 6 | 0 ($5–10/mo) | **6** |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Perfect score on all five criteria: `wrangler` CLI covers deploy/rollback/log-tail without a browser; Workers abstracts all OS/network ops; Cloudflare publishes `llms.txt`, per-page markdown, and a full agents text dump (GA since February 2026); `wrangler deploy` and `wrangler rollback` are deterministic one-command operations; and Cloudflare operates 16 official MCP servers (GA) including Workers management, Observability, and Builds. At $5/month, the paid Standard plan comfortably covers MVP traffic and enables the 10,000-subrequest ceiling needed for the sync Cron Trigger. The platform is the pre-existing `deployment_target` hint in `tech-stack.md` — the decision is consistent with the stack selection. The risks (adapter migration, HTTP-only DB driver) are real but well-scoped and resolvable before implementation begins.

#### 2. Render

Render is the cleanest alternative: no Dockerfile required, auto-detects Node.js + Next.js 16, Starter tier at $7/month is always-on with no spin-down. The GA MCP server exposes `render-deploy`, `render-debug`, and `render-monitor` tools. Both `llms.txt` and `llms-full.txt` are published. The gap versus the recommendation: no CLI rollback command (REST API only), partial score on the managed/serverless criterion (containers require somewhat more ops awareness than Workers), and the Cron Job isolation pattern (embedded node-cron vs. separate $1/month cron service) is less elegant than Cloudflare's native Cron Triggers.

#### 3. Railway

Railway's persistent containers make node-cron straightforward — no serverless indirection. The official `@railway/mcp-server` (GA, actively maintained, MIT) is a genuine first-class agent integration. Hobby plan at $5/month covers two minimal services (web + worker). The gaps: no `rollback` CLI command (dashboard required), no `llms.txt` (docs are readable but not structured), and a critical deployment gotcha (Node.js must be pinned to 22 or deploys fail silently). Ranked third over Render because the rollback gap is equivalent but the docs scoring is lower.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Adapter is deprecated and `CLAUDE.md` references the wrong package.** `@cloudflare/next-on-pages` is deprecated as of late 2025. The current adapter is `@opennextjs/cloudflare`. A known crash on Next.js 16.2.0 (opennextjs-cloudflare issue #1157) must be verified fixed for 16.2.6 before the first deploy.
2. **No persistent TCP connections to PostgreSQL.** The Workers request-scoped I/O model is incompatible with standard pg connection pools. The project must switch to `@neondatabase/serverless` (HTTP driver) — a constraint that shapes every database access pattern and isn't flagged by the Drizzle + Neon choice alone.
3. **Worker bundle size ceiling is a hard wall.** Paid plan: 10 MiB gzip compressed. A Next.js 16 app with App Router, Drizzle schema, Anthropic SDK, and auth middleware can approach this ceiling before the product is feature-complete. Free plan's 3 MiB limit makes testing on free effectively impossible.
4. **CI build hangs in non-TTY environments.** The `@opennextjs/cloudflare` build step prompts interactively in GitHub Actions / Docker (issue #1198). Requires `--yes` flag or env var workaround not documented in the main Getting Started guide.
5. **Subrequest limit (10,000 paid) shapes sync architecture.** Each outbound call to Jira, GitHub, Anthropic, and Resend counts toward the per-invocation ceiling. A sprint with 20+ PRs across 3 repos with paginated API calls consumes the budget faster than the feature count implies.

### Pre-Mortem — How This Could Fail

The team deployed SprintFlow on Cloudflare Workers, drawn by the $5/month cost and the pre-existing `deployment_target: cloudflare-pages` hint in the tech stack. Day one consumed debugging the adapter deprecation — `CLAUDE.md` pointed at `@cloudflare/next-on-pages`, which is no longer the right package, and the migration to `@opennextjs/cloudflare` surfaced the Next.js 16.2.0 crash before 16.2.6 compatibility was confirmed. The Neon HTTP driver worked in development but produced subtle behavior differences in production: the lack of connection-level transactions in the HTTP driver caused intermittent race conditions in the sync logic when two Cron Trigger invocations overlapped. NextAuth's JWT session handling expected file-system persistence for session caching, which doesn't survive across Worker instances, producing random session invalidations unreproducible locally. By month two, the Next.js bundle hit the 10 MiB ceiling after adding the Anthropic SDK and Drizzle schema — an emergency code-splitting refactor stalled the feature roadmap for a week. None of these were platform failures; every problem was solvable. But the cumulative tax of adapter quirks, driver substitution, CI workarounds, and size budgeting cost more calendar time than the cost saving over Render justified.

### Unknown Unknowns

- **Auth library crypto compatibility is not guaranteed.** Workers' `nodejs_compat` flag enables many but not all Node.js crypto APIs. NextAuth and Better Auth use internal crypto primitives that may or may not be covered — this must be tested with the specific auth library version before committing to the platform.
- **`wrangler.toml` for Workers differs from Pages config.** The `deployment_target: cloudflare-pages` in `tech-stack.md` implies Pages-style configuration. `@opennextjs/cloudflare` targets Workers, which uses a different `wrangler.toml` format, different binding syntax, and different deploy commands. The migration from a Pages mental model to a Workers mental model is a one-time cost but is non-trivial.
- **`next/image` optimization requires explicit Cloudflare configuration.** Without a Cloudflare Images binding or `remotePatterns` config, `<Image>` components fall back to unoptimized delivery in production. This is not flagged during local development.
- **In-memory state resets between invocations.** Module-level caches (memoized token validation, in-process rate-limit counters) are not shared across Worker instances. Any caching built on module-level Maps or Sets will exhibit surprising cold-miss patterns.
- **Cron Trigger timing is approximate, not guaranteed.** Cloudflare does not SLA the firing precision. Anomaly timestamps should derive from the actual sync completion time recorded in the database, not the scheduled trigger time — otherwise, the "last sync" indicator in the dashboard will drift.

## Operational Story

- **Preview deploys**: No automatic PR preview URLs out-of-the-box. Set up a GitHub Actions step running `wrangler deploy --env preview` to deploy a named preview environment on each PR. Preview Workers URLs are `<name>.<account>.workers.dev`; protect with Cloudflare Access if the dashboard should not be publicly reachable.
- **Secrets**: Stored as Workers Secrets via `wrangler secret put KEY` (interactive) or `echo "VALUE" | wrangler secret put KEY --stdin` (scriptable). Retrieved via `env.KEY` in Worker code. CI uses `CLOUDFLARE_API_TOKEN` as a GitHub Secret; `wrangler` picks it up automatically. Never store in `wrangler.toml`.
- **Rollback**: `wrangler rollback` (rolls back to the previous deployment) or `wrangler rollback <VERSION_ID>` (rolls back to a specific version, listed via `wrangler versions list`). Typically completes in under 30 seconds. Database migrations are not reversed by Worker rollbacks — plan migration scripts accordingly.
- **Approval**: Destructive actions requiring human execution: deleting the Workers project, rotating the `CLOUDFLARE_API_TOKEN`, changing DNS records, modifying account-level billing. The agent may deploy, rollback, tail logs, and update Workers Secrets for the project in scope unattended.
- **Logs**: `wrangler tail` streams live logs to the terminal. `wrangler tail --status error` filters to errors only. `wrangler tail --format json` for structured output parseable by agent. Cloudflare Observability MCP server (`mcp.cloudflare.com`) exposes log queries as structured tools for richer agent-driven log analysis.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `@cloudflare/next-on-pages` is deprecated; CLAUDE.md references it | Research finding | High (confirmed) | High | Update CLAUDE.md and install `@opennextjs/cloudflare` before any deploy attempt |
| Next.js 16.2.0 crash bug (issue #1157) in opennextjs-cloudflare | Research finding | Medium (may be fixed in 16.2.6) | High | Run `npx opennextjs-cloudflare build` locally against the project and verify clean output before CI setup |
| HTTP-only PostgreSQL driver required (no persistent TCP) | Devil's advocate | High (confirmed architectural constraint) | High | Install `@neondatabase/serverless` and configure Drizzle with `drizzle-orm/neon-http` before writing any DB access code |
| Auth library crypto incompatibility (NextAuth / Better Auth) | Unknown unknowns | Medium | High | Prototype the auth flow on Workers in a branch before building auth-gated routes; test session create/validate/invalidate cycle |
| Worker bundle size ceiling (10 MiB gzip, paid) | Devil's advocate | Medium (grows with codebase) | Medium | Monitor bundle size in CI with `wrangler deploy --dry-run`; use dynamic imports for large SDK dependencies (Anthropic SDK) |
| CI build hang in non-TTY (issue #1198) | Research finding | High (confirmed in GitHub Actions) | Medium | Add `--yes` flag to the build command or set the documented env var in the GitHub Actions workflow |
| Subrequest limit (10,000/invocation) shapes sync design | Devil's advocate | Medium (depends on team/sprint size) | Medium | Design the Jira delta-pull to batch by ticket ID range; cap GitHub repo scan to N most recent events per sync cycle |
| In-memory state resets between Worker invocations | Unknown unknowns | Medium | Low (cache misses, not data loss) | Do not rely on module-level state for correctness; use the database as the single source of truth for all sync state |
| Cron Trigger timing imprecision | Unknown unknowns | High (documented) | Low | Record actual sync completion timestamp in DB; display that, not the scheduled time, in the dashboard's "last sync" indicator |
| `next/image` unoptimized in production without Cloudflare Images config | Unknown unknowns | High (default behavior) | Low | Add `unoptimized: true` explicitly until a Cloudflare Images binding is configured, to make the tradeoff explicit rather than silent |

## Getting Started

The following commands assume the project is on Next.js 16.2.6 and targets Cloudflare Workers via `@opennextjs/cloudflare`. Verify each against the adapter's README before executing — this is a fast-moving adapter.

1. **Install Wrangler and the OpenNext adapter:**
   ```bash
   npm install -D wrangler @opennextjs/cloudflare
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```
   This opens a browser OAuth flow. After login, `wrangler whoami` confirms the active account.

3. **Initialize Workers configuration** — create `wrangler.toml` in the project root:
   ```toml
   name = "sprintflow"
   compatibility_date = "2024-12-01"
   compatibility_flags = ["nodejs_compat"]
   main = ".open-next/worker.js"
   assets = { directory = ".open-next/assets", binding = "ASSETS" }

   [build]
   command = "npm run build:cloudflare"
   ```
   Add to `package.json` scripts:
   ```json
   "build:cloudflare": "npx opennextjs-cloudflare build"
   ```

4. **Switch the database client to Neon's HTTP serverless driver** (required before writing any DB code):
   ```bash
   npm install @neondatabase/serverless
   ```
   Configure Drizzle with `drizzle-orm/neon-http` and `neon()` from `@neondatabase/serverless` instead of a standard TCP pool.

5. **Verify the build locally and deploy:**
   ```bash
   npm run build:cloudflare    # verify @opennextjs/cloudflare processes the project without the issue #1157 crash
   npx wrangler deploy         # first production deploy
   npx wrangler tail           # confirm live traffic and logs
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow files)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1 or KV as a database alternative (project targets external Neon/Supabase)
