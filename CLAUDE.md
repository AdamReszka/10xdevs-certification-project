# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: SprintFlow

Sprint anomaly detector for tech leads — reads GitHub and Jira data to surface workflow anomalies ranked by sprint-delivery risk. Full spec: @context/foundation/prd.md

## Commands

```
npm run dev     # dev server at localhost:3000
npm run build   # production build
npm run lint    # ESLint flat config (eslint.config.mjs); no --fix flag exposed
```

## Architecture

- **Next.js 16.2.6 App Router** — use server components by default; do not use Pages Router
- **TypeScript 5 strict mode** — path alias `@/*` → `./src/*`
- **Tailwind CSS 4** + **shadcn/ui** (new-york style, zinc base, OKLCH tokens) — all UI must be built with shadcn/ui components; use the `@shadcn` MCP server to look up available components before implementing any UI surface; add components with `npx shadcn add <name>`
- **Component architecture: atomic design** — `src/components/ui/` (shadcn-generated primitives), `atoms/` (custom stateless primitives), `molecules/` (composite widgets), `organisms/{anomaly,dashboard,auth,setup}/` (feature sections), `templates/` (page-level shells), `providers/` (React context wrappers)
- **Deployment target: Cloudflare Workers** — do not suggest Vercel-specific APIs or config; adapter is `@opennextjs/cloudflare` (not the deprecated `@cloudflare/next-on-pages`)
- No test framework installed yet — add one before implementing business logic
- No CI workflows yet (`.github/workflows/` is empty)

## Security constraints (non-negotiable)

- GitHub PAT and Jira API tokens must be encrypted at rest, never logged, never in client payloads
- No per-developer performance framing — all anomalies are team/sprint-level
- Graceful degradation: show last cached state + error banner on API failure

## Planned integrations (not yet installed)

These are required by the PRD but not wired yet:
- Auth: NextAuth or Better Auth (FR-001, email + password)
- Database: PostgreSQL + Drizzle ORM via Neon or Supabase
- AI: `@anthropic-ai/sdk`, model `claude-haiku-4-5` (FR-020, Refinement Helper only)
- Email: Resend (FR-018, Daily Recap)
- Background jobs: node-cron or Cloudflare Cron Triggers (15-min sync loops)
- Cloudflare adapter: `@opennextjs/cloudflare` (Workers target; `@cloudflare/next-on-pages` is deprecated)
- Database driver: `drizzle-orm/node-postgres` (`pg`) over Cloudflare Hyperdrive — Workers-safe TCP via the `HYPERDRIVE` binding (`src/lib/db.ts`). An HTTP-mode driver (`@neondatabase/serverless` / `drizzle-orm/neon-http`) is NOT used; Hyperdrive removes the no-persistent-TCP constraint.

## Task tracking conventions

Issue/PR work follows the hybrid convention in `context/foundation/task-tracking.md`. Read that file before creating, editing, or referencing GitHub issues. Highlights:

- **Roadmap IDs (`F-01`, `S-07`) are the stable identifier.** They live in `context/foundation/roadmap.md` and never change.
- **GitHub `#N` is secondary** — a clickable autolink, never a primary contract. Issues and PRs share one counter, so `#N` can't be predicted before creation.
- Issue body format (dependency sections): `**F-01** auth-provider-scaffold (#8) — description`.
- Parent tracker (#25) keeps bare `#N` first in checkboxes (`- [ ] #8 **F-01** …`) so GitHub auto-checks on close.
- **Never predict `#N` before an issue exists.** Always look it up via `gh issue list`.
- **Never delete an issue.** Edit, don't recreate — a recreated issue gets a new `#N` that breaks every prior reference.
- Scope changes start in `roadmap.md`, not in issue bodies. Roadmap is canonical; issues are instances.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
