# Debug log — memory exhaustion / machine crash investigation

Started: 2026-06-01

## Symptom (reported by user)
- App crashed ~5 times.
- Machine crashed ~3 times.
- Saw OS message: "Application is running out of memory".
- Computer turned itself off.
- Suspicion: something is starting **a loop**.
- There **was** an extra lock file one level below the app root; user thinks it is gone now.
- App currently won't work.

## Hypotheses (to confirm/reject)
- H1: A runaway dev process (Next.js dev server, a watcher, or a background job) is spinning in an infinite loop and leaking memory.
- H2: A misconfigured background sync loop (node-cron / 15-min sync, per CLAUDE.md) re-triggering without backoff.
- H3: A file watcher loop (e.g. writing into a watched dir, which retriggers a rebuild, which writes again...).
- H4: next.config.ts change (currently modified in git) introduced a bad config.

## Rules for this session
- Write to this file BEFORE and AFTER each potentially-heavy step.
- Do NOT start the dev server / build until we understand the loop — starting it could re-crash the machine.
- Prefer read-only inspection first.

## Step log

### Step 0 — create this log file
- Status: DONE
- Action: created DEBUG-MEMORY-CRASH.md at project root.

### Step 1 — inspect running processes + git diff + dir listing (READ ONLY)
- Status: DONE
- Findings:
  - NO runaway node/next/wrangler process alive right now. Only VS Code helpers + `shadcn mcp`. So nothing is looping at this moment.
  - `git diff next.config.ts` shows a FIX already staged: added `turbopack: { root: path.join(__dirname) }` with a comment naming the exact failure mode — a stray lockfile in a parent dir makes Next/Turbopack infer the wrong workspace root, expanding FS watching to the whole parent tree → loop.
  - Parent dir `/Users/.../kurs10xdevs/` now contains ONLY the project (no stray lockfile). Its mtime (Jun 1 22:34) matches the next.config.ts edit → lockfile deletion + config edit happened together.

### ROOT CAUSE (high confidence)
- Next.js 16 + Turbopack detected multiple lockfiles (one in parent dir) → inferred workspace root = parent → recursive file-watch over the whole parent tree → runaway memory → OS OOM → machine power-off.
- Mitigations now present: (a) stray lockfile removed, (b) `turbopack.root` pinned to project dir (staged, uncommitted).

### Step 2 — verify config fix + find why "app won't work"
- Status: DONE (verification) / OPEN (won't-work cause)
- Findings:
  - NO lockfiles anywhere up the ancestor chain now (kurs10xdevs, LEARNING, Programming, ~). Good.
  - Context7 / Next 16 docs CONFIRM `turbopack.root` is the correct stable key. Docs: pointing root at a PARENT dir "expands the scope of filesystem watching" — that is exactly the crash mechanism. Pinning to `__dirname` (project) contracts the watch back. **Fix is correct.**
  - `next.config.ts` is otherwise clean (images.unoptimized, serverExternalPackages for pg). No bug.
  - `.next/dev` mtime = Jun 1 22:45 → a dev server DID run AFTER the fix (config edited 22:34). No node/next process alive now → it was stopped or died.
  - Only uncommitted changes: `next.config.ts` (the fix) + this log file. Fix is NOT yet committed.

### Open question for user: what does "app won't work" actually look like?
- Need: does `next dev` fail to start, show an error in terminal, blank page, or crash again? Exact message if any.
- Likely suspect: `.next` build/dev cache corrupted by OOM-killed processes → safe remedy is `rm -rf .next` then restart. NOT done yet (awaiting user go-ahead before starting the dev server that previously crashed the machine).

### Step 3 — USER ATTEMPTING `npm run dev` AGAIN (fix in place)
- Timestamp: about to run now (2026-06-01 evening).
- State going in: stray lockfile removed; `turbopack.root` pinned in next.config.ts (uncommitted); no other node/next process running; no lockfiles up the ancestor chain.
- EXPECTATION: dev server starts and stays flat on memory; NO watch-the-parent-tree loop.
- SAFETY: run with a hard Node memory cap so that IF the loop somehow recurs, the Node process self-kills (OOM) BEFORE the whole Mac runs out of RAM and powers off:
    NODE_OPTIONS="--max-old-space-size=2048" npm run dev
  (Optionally clear the possibly-corrupted cache first: `rm -rf .next`.)
- IF IT CRASHES AGAIN, check on restart:
    1. Confirm next.config.ts still has the turbopack.root pin (was it reverted?).
    2. Re-scan for a re-created lockfile in the parent dir.
    3. Inspect Turbopack trace / `.next/dev` for what path it was watching.
- RESULT: (to be filled in after the attempt) ____________________

### Step 4 — fresh verification run after clearing cache (2026-06-14)
- Status: DONE (server boots clean) / OPEN (awaiting user's browser test)
- Pre-checks (read-only) confirmed the fix is sound:
  - No stray lockfiles anywhere up the ancestor chain — only `./package-lock.json` in the project root. Parent dirs clean.
  - No runaway node/next/turbo process alive before starting.
  - `package.json` has no `"type": "module"` → config is CommonJS → `__dirname` in next.config.ts resolves correctly (would have thrown under ESM). The `turbopack.root` pin is valid.
- Actions taken:
  - User removed `.next` (cleared the possibly OOM-corrupted dev/build cache).
  - Started dev with hard memory cap: `NODE_OPTIONS="--max-old-space-size=2048" npm run dev` (background).
- Observed result:
  - ✓ Next.js 16.2.6 (Turbopack) — **Ready in 290ms**, no errors, no watch-the-parent-tree loop.
  - HTTP GET `/` → **200 OK** (~1.4s first-compile cold start, normal).
  - Memory FLAT: `next-server` ~626 MB (normal post-compile, well under the 2 GB cap); CLI wrapper ~61 MB. No climb, no OOM.
- Conclusion: the crash path (Turbopack workspace-root misdetection → recursive parent-tree watch → OOM) is neutralized. App runs.
- STILL OPEN:
  - The fix in `next.config.ts` is UNCOMMITTED — only in the working tree. A stash/reset/branch-switch would lose the pin and the crash could return. Recommend committing (branch first; we're on `main`).
  - NEXT: user will open http://localhost:3000 in the browser to confirm the app behaves as expected. Result of that browser test: ____________________
