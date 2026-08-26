<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account Auth Flow (S-01)

- **Plan**: context/changes/account-auth-flow/plan.md
- **Mode**: Deep
- **Date**: 2026-06-14
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical · 1 warning · 1 observation (all resolved)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding
10/10 paths ✓ (all claimed-to-modify files exist; new paths correctly absent), symbols ✓ (`emailAndPassword`/`requireEmailVerification`/`sendResetPassword` present, `autoSignIn` absent as planned, `PUBLIC_PREFIXES`/`isPublic` confirmed), brief↔plan ✓. No `docs/reference/contract-surfaces.md` (skipped). Progress↔Phase consistency ✓.

## Findings

### F1 — Reset-confirm route is gated by middleware; reset link dead-ends

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 #2 — Reset-confirm page (token surface)
- **Detail**: Plan placed the page at `/reset-password` and asserted route-group `(auth)` makes it public. But gating is path-based: `isPublic("/reset-password")` is false against `PUBLIC_PREFIXES = ["/", "/login", "/signup", "/reset", "/api/auth"]` (middleware.ts:26-32) — not equal to `/reset`, doesn't start with `/reset/`. Unauthenticated users opening the reset link get redirected to `/login`; the whole reset flow breaks.
- **Fix A ⭐ Recommended**: Name the route `(auth)/reset/confirm` — `/reset/confirm` starts with `/reset/` so `isPublic()` already returns true; zero middleware change; matches the option chosen during planning.
  - Strength: No edit to security-sensitive middleware; verified against middleware.ts:28-32.
  - Tradeoff: Page path diverges from Better Auth's default `/reset-password` endpoint name (cosmetic — it's our page, not the API route).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Fix B**: Keep `/reset-password`, add it to `PUBLIC_PREFIXES`.
  - Strength: Keeps conventional page name.
  - Tradeoff: Edits middleware; the prefix would also expose any future `/reset-password/*`.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — renamed route to `(auth)/reset/confirm`, `redirectTo: "/reset/confirm"`, added a Critical Implementation Details note, updated all references in plan + brief.

### F2 — Phase 2 proposed editing AppShell internals; the `actions` slot already covers it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 #2 — Authenticated app-shell with sign-out
- **Detail**: `AppShell` already takes `actions?: ReactNode` (app-shell.tsx:19,27-29), used by the public landing (page.tsx). The authenticated layout can pass `<SignOutButton />` via that slot — no AppShell edit, no blast radius on the shared landing header. Plan's "add the authenticated header variant to app-shell.tsx" risked an unnecessary modification.
- **Fix**: Compose AppShell via the existing `actions` slot; add only a new `SignOutButton`; leave AppShell internals untouched.
- **Decision**: FIXED — Phase 2 #2 rewritten to create `sign-out-button.tsx` and compose via `actions`; AppShell internals untouched.

### F3 — Authenticated users aren't redirected away from /login, /signup, /reset

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Cross-cutting (middleware / auth pages)
- **Detail**: Middleware treats auth pages as always-public, so a signed-in user can still load `/login` etc. Not required by FR-001; harmless polish.
- **Fix**: Add a redirect-if-authenticated check to the `(auth)` layout (or defer).
- **Decision**: FIXED — added Phase 2 #4: a non-fatal session check on the `(auth)` layout that `redirect("/dashboard")` if authenticated; added manual criterion 2.7.
