<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-21 — One `db` handle per request (kill the 3-4x pool multiplicity)

- **Plan**: `context/changes/db-pool-teardown/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

> Run **after** the slice merged (PR #77, 2026-08-30 11:39). All five phase SHAs
> — `a73388a`, `d9e45de`, `46f24a7`, `8a13017`, `6380045` — are ancestors of
> `main`. This review is the close-out step that never ran; see F1.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Success criteria run at review time

| Check | Result |
|---|---|
| `npm run lint` | pass — 0 errors, 10 warnings (pre-existing) |
| `npm run typecheck` | pass |
| `npm test` | pass — 1152 tests / 92 files |
| `npm run test:integration` | pass — 340 tests / 30 files |
| `npm run test:e2e` | pass — 16/16, parallel workers, no `53300` |
| `npm run build` | pass |
| `grep -rn "isolate's lifetime" src/ context/foundation/` | empty — pass (Phase 5.5) |
| `node scripts/manual-test-sweep.mjs` | exit 0 |

## What was verified by reading, not just by running

- **`src/lib/db.ts`** implements the memo exactly as `lessons.md` #3 states it,
  including all three corollaries: the `try`/`catch` around
  `getCloudflareContext()` (load-bearing for SSG and the cron path, not
  defensive), the module-scope `auth` constructor kept OUT of the memo, and the
  pool never exposed from `getDb`.
- **`src/lib/db.test.ts`** guards each corollary as its own case — same handle
  under one context, different handle under a fresh one, unshared fallback with
  no context, `getDbWithPool` not returning the memo, and the static `auth`
  export not populating it.
- **Pool ownership is where the plan says.** `getDbWithPool` is called from
  exactly three product sites — `sync/scheduled.ts`, `sync/actions.ts`,
  `api/webhooks/resend/route.ts` — plus `auth.ts`'s module-scope constructor,
  which the plan calls out. No `.end()` anywhere on a `getDb` handle.
- **Scope guardrail holds.** The four sites the plan excluded
  (`roster-store.ts`, `reconcile-sprint.ts`, `absence-store.ts`,
  `api/auth/[...all]/route.ts`) have **zero** commits in the slice's range —
  which settles manual row 5.7 by evidence.
- **`requireSession` / `getOptionalSession`** implement the three outcomes with
  the public contract unchanged, and `(auth)/layout.tsx` redirects only on
  `active`, so a database blip can neither impersonate a signed-out user nor trap
  one out of `/login`.

## Findings

### F1 — The slice merged without its close-out, so its own records disagree with reality

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/db-pool-teardown/change.md:4`
- **Detail**: `change.md` still reads `status: implementing` although PR #77
  merged; there was no `reviews/impl-review.md` until this file; the folder is
  still under `context/changes/`; and the roadmap has no `## Done` bullet for
  S-21 (the `Status: done` flips were made by the slice's own Phase 5 §2, not by
  archiving). The mechanism is worth recording: `/10x-implement`'s epilogue fires
  only when EVERY `## Progress` row is `[x]`, and 15 rows here are manual and
  deferred to the tester by design — so the trigger was never met and the last
  commit (`d57a9ff`) stopped at the Phase 5 SHA write-back. The same shape nearly
  caught S-27 an hour later, where the defensive straggler prompt surfaced it.
- **Fix**: Flip `change.md` to `impl_reviewed` (this review does it), then
  `/10x-archive`, which adds the `## Done` bullet and moves the folder.
- **Decision**: FIXED — `change.md` stamped `impl_reviewed` by this review, and
  the slice archived to `context/archive/2026-08-19-db-pool-teardown/` in the
  same commit, which added the roadmap's missing `## Done` bullet.

### F2 — The error boundary tells signed-out visitors they are still signed in

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/app/error.tsx:64-65`
- **Detail**: The card asserts *"You are still signed in."* unconditionally.
  `src/app/error.tsx` is the app's ONLY boundary (verified — no
  `global-error.tsx`, no per-segment `error.tsx`), and it is deliberately
  root-level so it can catch throws from `(app)/layout.tsx`. That same placement
  makes it the boundary for `(auth)/login`, `/signup` and `/reset` as well, where
  the visitor is by definition not signed in. The sentence is load-bearing — it
  exists to undo exactly the "you have been logged out" misreading Phase 4 was
  built to kill — but it is stated as a fact the boundary cannot check, and the
  plan forbids it from checking (it must not call `getOptionalSession`). The
  database-down case on `/login` is safe (the layout catches and renders), so
  this needs an unrelated render error on a public route to surface.
- **Fix**: Reword to something true in both states — e.g. *"If you were signed
  in, you still are."* Manual row 17.A quotes the current sentence, so
  `manual-test-backlog.md` changes in the same commit.
- **Decision**: FIXED — the card now reads *"If you were signed in, you still
  are."*, and the docblock records why the sentence is conditional. The quote was
  updated in both places that assert it: `manual-test-backlog.md` row 17.A and
  the slice's own `MANUAL-CHECKLIST.md:41`. Lint, typecheck and 1152 unit tests
  green.

### F3 — Three Phase 3 manual rows are already evidenced in the repo but sit unticked

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/db-pool-teardown/plan.md` Progress 3.4–3.6
- **Detail**: `measurements.md` carries both tables — the baseline (§"Baseline —
  before the fix": 3.00 conn/GET, 4.00 conn/action) and the after-measurement
  (§"After the fix": app bucket flat at **5** for K=8, 12 and 24). That is
  row 3.4 ("after-measurement recorded next to the baseline") and row 3.5 ("peak
  no longer scales past `POOL_MAX`") satisfied by committed evidence. Row 3.6
  ("no `53300` in the E2E output") held on both full E2E runs during this review.
  Row **3.7** is genuinely open — it wants a wall-clock comparison against the
  serial baseline, which nothing in the repo records. Backlog row 17.G already
  says the measurements are "przegląd, nie powtórka", but the plan's Progress
  still reads as unstarted work.
- **Fix**: Tick 3.4–3.6 with the evidence named; leave 3.7 for the tester.
  Ticking manual rows is the user's call — not applied without a say-so.
- **Decision**: LEFT TO THE USER — rows untouched. The evidence is named here and
  in backlog row 17.G, so whoever ticks them can see what backs each one.

### F4 — The backlog tells the tester `measurements.md` is uncommitted; it is committed

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/manual-test-backlog.md:2170-2171`
- **Detail**: §17 closes with *"zapisany w `measurements.md` i celowo
  niecommitowany"*, but `git ls-files` lists the file. The plan's Phase 1 §1 says
  the **snippet** is uncommitted ("none committed. The snippet lives in the
  session scratchpad"); the write-up was always meant to be committed. The two
  got conflated. It matters because row 17.G tells the reader to open that very
  file — being told it does not exist in the repo is a dead end.
- **Fix**: Reword to say the throwaway measuring snippet was not committed, while
  `measurements.md` is.
- **Decision**: FIXED — §17's closing paragraph now says the SCRIPT was
  deliberately not committed and points at the committed
  `measurements.md` path that row 17.G opens.
