# Working in a parallel worktree

Rules for running a second Claude Code session on this repo at the same time as
the main one — `claude --worktree <name>`, or Claude entering one with
`EnterWorktree`. Written 2026-08-30, when the first parallel session was set up
against S-21 (`db-pool-teardown`).

**Read this before starting parallel work, and before choosing what the second
session works on.** The failure modes below are not hypothetical git conflicts —
they are two sessions sharing one Postgres and one set of TCP ports.

---

## The mental model: what is shared, what is not

A git worktree is a fresh checkout with its own branch. Everything else on this
machine is shared.

| Thing | Shared with the main checkout? | Consequence |
| --- | --- | --- |
| `.git` directory | **Yes** | `git commit` works; lefthook hooks in `.git/hooks` run in worktrees without reinstalling |
| Local Postgres / Supabase stack | **Yes — one instance** | `supabase/config.toml` has a fixed `project_id`, so ports 54321–54329 are one Docker stack. **Two worktrees share one database.** |
| Port 3000 (`next dev`) | **Yes** | The second `npm run dev` fails, or worse, silently reuses the first |
| Playwright fixture ports 3098 / 3099 | **Yes** | Hard-coded in `playwright.config.ts:23,30` |
| `.claude/settings.local.json` | **Yes** | Claude Code reads it from the **main checkout's root** in a worktree. MCP approvals and "don't ask again" rules carry over; do not copy the file |
| `.claude/settings.json`, `.mcp.json`, `.nvmrc` | **Yes** | Tracked in git |
| `node_modules` | **No** | 1.2 GB, gitignored. Each worktree needs its own |
| `.env`, `.env.local`, `.claude/skills/10x-*`, `.claude/commands`, `.claude/prompts` | **No — copied** | Handled by `.worktreeinclude` at worktree creation |
| `.next`, `.open-next`, `.wrangler`, `next-env.d.ts`, `playwright/.auth` | **No** | Regenerated; nothing to carry |

---

## Never do these in a parallel worktree

1. **Never run a migration.** `npm run db:migrate` writes to the *shared*
   Postgres. A new column added from worktree B breaks worktree A's running app
   and its integration tests, with no signal that a second checkout caused it.
   → A slice that needs a migration must not run in parallel. Finish one first.

2. **Never run `npm run test:integration` in two worktrees at once.** Both point
   at `127.0.0.1:54322` — the same tables, the same rows. Failures look like
   product bugs and are not.

3. **Never run `npm run test:e2e` in two worktrees at once.** Three collisions
   at once: port 3000, the fixture servers on 3098/3099, and `reuseExistingServer`
   silently attaching to the *other* worktree's dev server — which was started
   without `GITHUB_API_BASE_URL`, so the suite passes or fails against the wrong
   backend. On top of that, S-21 restored PARALLEL workers locally
   (`workers: process.env.CI ? 1 : undefined`) — so a second concurrent suite now
   competes for Postgres's slots harder than it did under the serial pin, not
   less. S-21 gave the dev server ONE pool with a fixed ceiling; two dev servers
   are two ceilings, and that is exactly what the fix does not cover.

4. **Never run demo seeding or any destructive script.** One database, one set of
   accounts. See the standing rule about never seeding the owner's account.

5. **Never `cd` back into the main checkout to "just check something".** Claude
   Code blocks it, and the block is correct: the isolation guarantee is the whole
   point. Read from the worktree's own copy.

6. **Never assume the worktree has your in-progress work.** New worktrees branch
   from `origin/main` (`worktree.baseRef` default `"fresh"`). Unpushed commits on
   the main checkout's branch are *not* there.

---

## Setting up a worktree

```bash
claude --worktree <name>          # from the MAIN checkout, not from a worktree
```

Then, inside it:

```bash
npm ci                            # mandatory — see below
```

`npm ci` is not optional. The `PostToolUse` hooks in `.claude/settings.json` run
`npx eslint --fix` and `npx vitest related` after every `Write`/`Edit`; without
`node_modules` every file edit stalls on `npx` trying to fetch a package.

To run a second dev server, take a different port and tell auth about it — edit
the worktree's own `.env.local`:

```bash
BETTER_AUTH_URL=http://localhost:3001
# then: npx next dev -p 3001
```

Safe to run in parallel: `npm test` (hermetic, DB-free), `npm run lint`,
`npm run typecheck`, `npm run build`.

---

## Choosing what the second session works on

Run this checklist against the candidate slice **before** starting. A "yes" to
any of the first three means it does not go in parallel.

1. **Does it need a database migration?** (a new column, table, or FK) → No.
2. **Is its acceptance test the E2E suite?** → No.
3. **Does it touch the same seams as the in-flight slice?** For S-21 those are
   `src/lib/db.ts`, `src/lib/auth.ts` (`createAuth`), and
   `src/lib/workspace.ts` (`resolveWorkspace`) — which means any slice adding a
   gated page, a Server Action, or a demo guard touches them. → No.
4. **Which files does it edit?** Overlap in a `page.tsx` body is usually fine
   (different regions merge); overlap in a `src/lib/*` seam is not.
5. **Does it depend on the in-flight slice landing first?** Check the roadmap's
   prerequisites column, not just intuition.

Good shapes for parallel work: presentation-only slices over data that is
already loaded, extractions into pure `.ts` siblings, documentation, and test
additions that are hermetic.

---

## At merge time

- **`context/foundation/roadmap.md` will conflict.** Both sessions flip a status
  in `## At a glance` and a row in `## Backlog Handoff`. Expect it; resolve by
  keeping both rows.
- Same for `context/foundation/manual-test-backlog.md` when both slices add
  manual rows.
- Merge the branches one at a time and re-run `npm test` + `npm run typecheck`
  after each, so a semantic conflict (both changed how `db` is obtained) surfaces
  before both are on `main`.

---

## Claude Code specifics worth knowing

- **`.worktreeinclude` is read from the main checkout's working directory** at
  creation time, not from the new worktree. If the main checkout is on a branch
  where that file does not exist, nothing is copied.
- **Hook paths do not follow the worktree.** `${CLAUDE_PROJECT_DIR}` in a hook
  still points at the main checkout; the worktree path arrives as the `cwd` field
  in the hook's input JSON. This repo's hooks use neither, so they are unaffected.
- **Permission approvals granted in a worktree are saved to the main checkout**
  and apply everywhere, so approving something once is enough.
- **Cleanup:** exiting an interactive session prompts when the worktree holds
  work. A worktree with uncommitted changes is never swept automatically.

## References

- `.worktreeinclude`, `.gitignore` (the `.claude/worktrees/` entry)
- `supabase/config.toml` (`project_id`, ports), `context/foundation/local-setup.md`
- `playwright.config.ts:23,30,50` (fixture ports, `workers: 1` and why)
- `.claude/settings.json` (`PostToolUse` hooks that require `node_modules`)
- Claude Code docs: *Run parallel sessions with worktrees*, *Settings § Where
  Claude Code keeps the local file in a git repository*
