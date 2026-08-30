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

## Parallel worktrees (a second Claude session on this repo)

**Before starting, or choosing work for, a session in a git worktree, read
@context/foundation/parallel-worktrees.md.** A worktree isolates files; it does
NOT isolate the things that actually break — all worktrees share ONE local
Postgres (`supabase/config.toml` pins `project_id`), port 3000, and the
Playwright fixture ports 3098/3099.

The three rules that cost the most if broken, in a parallel worktree:

- **No migrations** (`db:migrate` writes to the shared database).
- **No `test:integration` and no `test:e2e`** in two worktrees at once —
  `reuseExistingServer` will silently attach the suite to the other worktree's
  dev server. Since S-21 landed, `playwright.config.ts` runs PARALLEL workers
  locally again (`workers: process.env.CI ? 1 : undefined`), so a second
  concurrent suite competes for the same Postgres harder than before, not less.
- **`npm ci` first.** `node_modules` is gitignored and 1.2 GB; the `PostToolUse`
  hooks run `npx eslint` and `npx vitest` after every edit and stall without it.

`.worktreeinclude` carries `.env`, `.env.local` and the gitignored
`.claude/skills/10x-*` (without which `/10x-plan`, `/10x-implement` etc. do not
exist in the worktree). `.claude/settings.local.json` is read from the MAIN
checkout — do not copy it.

## Architecture

- **Next.js 16.2.6 App Router** — use server components by default; do not use Pages Router
- **TypeScript 5 strict mode** — path alias `@/*` → `./src/*`
- **Tailwind CSS 4** + **shadcn/ui** (new-york style, zinc base, OKLCH tokens) — all UI must be built with shadcn/ui components; use the `@shadcn` MCP server to look up available components before implementing any UI surface; add components with `npx shadcn add <name>`
- **Component architecture: atomic design** — `src/components/ui/` (shadcn-generated primitives), `atoms/` (custom stateless primitives), `molecules/` (composite widgets), `organisms/{anomaly,dashboard,auth,setup}/` (feature sections), `templates/` (page-level shells), `providers/` (React context wrappers)
- **AI (S-13, FR-020/FR-021 — Refinement Helper only)** — `@anthropic-ai/sdk`
  behind the `src/lib/anthropic.ts` seam, model pinned to **`claude-sonnet-5`**
  (`ANTHROPIC_MODEL`). Sonnet rather than the originally-planned
  `claude-haiku-4-5` because the P2/P3 rubric levels
  (`context/changes/refinement-helper-ai/dor-notes.md`) are judgment work, not
  extraction, and at realistic usage — a handful of tickets per refinement, a
  cached rubric prefix — the cost difference is under a dollar a month. The
  client MUST be constructed inside the request path (Workers expose no secrets
  at module scope), and `ANTHROPIC_API_KEY` is a Workers **secret**, never a
  `var`
- **Deployment target: Cloudflare Workers** — do not suggest Vercel-specific APIs or config; adapter is `@opennextjs/cloudflare` (not the deprecated `@cloudflare/next-on-pages`)
- **Testing** — Vitest 4, split into two projects that must not be merged:
  `npm test` (`vitest.config.ts`) is hermetic and DB-free and EXCLUDES
  `*.integration.test.ts`; `npm run test:integration`
  (`vitest.integration.config.ts`) runs those against real Postgres and refuses
  any `DATABASE_URL` that is not local Supabase `127.0.0.1:54322`. Also
  `npm run test:e2e` (Playwright) and `npm run test:mutation` (Stryker).
  **There is no component-test harness** — no jsdom, no RTL — so decision logic
  in a `.tsx` is extracted to a pure `.ts` sibling to be unit-testable
  (`roster-merge.ts`, `inbox-controls.ts`, `absence-calendar-view.ts`).
  ⚠️ Two Stryker configs exist: `stryker.conf.json` (scoped to the anomaly
  rules, `break: 70`) wins by filename precedence over the stale
  `stryker.config.json` (crypto-only, no break threshold). Renaming either
  silently changes what is mutated.
- **CI** — `.github/workflows/ci.yml`, triggered on `pull_request` only (not on
  push to main). Two parallel jobs: `test` (lint → typecheck → unit) and
  `integration` (supabase CLI pinned to 2.101.0 → Postgres-only `supabase start`
  → `db:migrate` → integration suite with a per-run generated
  `TOKEN_ENCRYPTION_KEY`). Node is pinned via `.nvmrc` (24). No secrets. A third
  PR check, `Workers Builds`, comes from the Cloudflare GitHub app, not from
  this repo.

## Security constraints (non-negotiable)

- GitHub PAT and Jira API tokens must be encrypted at rest, never logged, never in client payloads
- No per-developer performance framing — all anomalies are team/sprint-level
- Graceful degradation: show last cached state + error banner on API failure

## Planned integrations (not yet installed)

These are required by the PRD but not wired yet:
- Auth: NextAuth or Better Auth (FR-001, email + password)
- Database: PostgreSQL + Drizzle ORM via Neon or Supabase
- Email: Resend (FR-018, Daily Recap)
- Background jobs: node-cron or Cloudflare Cron Triggers (15-min sync loops)
- Cloudflare adapter: `@opennextjs/cloudflare` (Workers target; `@cloudflare/next-on-pages` is deprecated)
- Database driver: `drizzle-orm/node-postgres` (`pg`) over Cloudflare Hyperdrive — Workers-safe TCP via the `HYPERDRIVE` binding (`src/lib/db.ts`). An HTTP-mode driver (`@neondatabase/serverless` / `drizzle-orm/neon-http`) is NOT used; Hyperdrive removes the no-persistent-TCP constraint.

## Manual testing conventions

**Priority order: shipping the remaining functionality comes first.** Manual
verification is real work but it is not what the deadline is measured on. Never
block progress on a slice waiting for the user to finish clicking through the
previous one.

### The two tester-facing skills

A second person — non-technical — runs the manual tests on their own Mac, with
Jira and GitHub connected exactly like the owner's. Two skills serve them, both
tracked in git under the `.claude/skills/sprintflow-*` exception in `.gitignore`
(course `10x-*` skills stay untracked):

- **`/sprintflow-health-check`** — verifies the environment is workable: global
  tooling (Node 24, npm, git, Docker), repo dependencies, `.env` + `.env.local`
  composed together, local Supabase, migrations, and that the app answers. It
  diagnoses and *proposes* fixes; it never repairs without consent. Catalogue of
  checks: `references/checks.md`.
- **`/sprintflow-manual-testing`** — runs a testing session: creates a
  `test/manual-testing-session-<date>` branch, takes the next unticked row from
  `manual-test-backlog.md`, explains what it is for in business terms, walks the
  tester through the UI click by click, and records the outcome. **It never
  fixes code** — a failed test produces a note, not a patch.

Both converse in Polish while working on the English files.

### Failed manual tests live in `context/manual-tests/`

**When asked "do we have any failing manual tests?", look there first.** One
Markdown file per failed row, named `<SLICE>-<NUMER>-<slug>.md`; each separates
what the tester observed from the hypothesis `/sprintflow-manual-testing` drew
from the code without running anything. Passed tests leave no file — they are
ticked in the backlog and in the source `plan.md`. A note is deleted in the same
commit as its fix; a note that outlives its repair is actively misleading.

### At the start of every session

**Ask the user for the state of outstanding manual tests before planning new
work.** Read the current change's `MANUAL-CHECKLIST.md` and
`context/foundation/manual-test-backlog.md` §1, name the rows still unticked,
and ask which of them they got through. They test during token-limit waits, so
the answer is usually "some of them" — tick what they confirm, then move on to
building. Do not re-derive the state from git or assume nothing was done.

### The backlog must stay equal to the plans — check it, don't assume it

**`context/foundation/manual-test-backlog.md` must contain EVERY open manual row
that exists in the repo.** A second person works from that file alone; a row
missing from it does not exist for them.

Three places hold the truth and they drift on their own: `## Progress` `- [ ]`
rows under `#### Manual` in every `context/**/plan.md` (canonical), the per-slice
`MANUAL-CHECKLIST.md` files (full descriptions, in `changes/` **and** in
`archive/`), and the backlog (the one list). **Archiving a slice does not close
its manual rows** — that mistake left 68 canonical open rows against 27 known to
the backlog, including the one S-15 row that permanently deletes a database row.

Run `node scripts/manual-test-sweep.mjs` and act on it:

- **at the closing phase of `/10x-implement`**, before the epilogue commit;
- **at `/10x-archive`**, before the folder moves;
- **whenever the user asks what is left to test.**

It exits non-zero when a slice with open rows, or a checklist, has no mention in
the backlog. It only checks presence — writing the row is still yours, and it
carries the four things below. A row that is genuinely obsolete moves to the
backlog's §6 with the reason; it is never deleted quietly.

### Two files, two jobs

- **`context/changes/<change-id>/MANUAL-CHECKLIST.md` — the short list.** Only
  what genuinely blocks the slice: paths that destroy data irreversibly, and
  surfaces that are unreachable if broken. Aim for **3–5 rows per slice**, never
  twenty. This is what the user is asked to do at the end of a phase.
- **`context/foundation/manual-test-backlog.md` — everything else.** Full
  detail, deferred rows, cross-slice debt, environment traps. Written in Polish,
  the format is already established there. Nothing is dropped — it is moved
  here, with the reason it was deprioritized.

### Writing a row the user can act on without asking questions

Every row in either file carries four things. A row missing any of them costs a
round trip the deadline cannot afford:

1. **Where** — the exact route (`/settings/team`), and the account to use when
   it matters.
2. **What to do** — click by click, in order.
3. **What must be true** — the observable pass condition, worded so there is no
   judgment call left. Not "check the dialog is right" but "the dialog offers
   Deactivate only, with no Delete permanently button".
4. **Why it matters** — the defect this catches. Without it the user cannot
   judge what to skip when time runs short.

Sign off with the phase number so `plan.md` `## Progress` can be ticked in step;
`plan.md` stays canonical.

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
