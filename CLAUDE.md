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
- **Tailwind CSS 4** + **shadcn/ui** (new-york style, neutral base, OKLCH tokens) — all UI must be built with shadcn/ui components; use the `@shadcn` MCP server to look up available components before implementing any UI surface; add components with `npx shadcn add <name>`
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
- Database driver: `@neondatabase/serverless` with `drizzle-orm/neon-http` (Workers require HTTP mode, not TCP)

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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
