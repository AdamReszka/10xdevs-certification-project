<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Auth Flow (S-01)

- **Plan**: context/changes/account-auth-flow/plan.md
- **Scope**: All 4 phases (complete)
- **Date**: 2026-06-14
- **Verdict**: APPROVED (one warning worth a quick fix)
- **Findings**: 0 critical · 1 warning · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Auth client calls in the four forms have no try/catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: login-form.tsx, signup-form.tsx, reset-form.tsx, reset-password-form.tsx (each onSubmit)
- **Detail**: Each onSubmit destructures `{ error }` and toasts on it (correct for the normal return), but a network fetch rejection makes the promise throw. RHF's handleSubmit swallows the rejection → no toast, button silently re-enables. Soft violation of the PRD "always a clear error" guardrail on the offline/flaky path.
- **Fix**: Wrap each `await authClient.*` in try/catch and toast a generic "Something went wrong. Please try again." (or use fetchOptions.onError). Apply uniformly to all four forms.
- **Decision**: FIXED (try/catch added to all four form onSubmit handlers; lint + build green)

### F2 — Reset URL (with token) is console-logged

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (Security)
- **Location**: src/lib/auth.ts:52-54
- **Detail**: Intentional S-01 log-only transport stub; token short-lived + single-use. Collides with the project "never logged" posture if it reaches a real deploy.
- **Fix**: Ensure replaced by Resend transport in S-11; don't ship the console.log to production. (Already self-flagged in code comment.)
- **Decision**: SKIPPED (intentional S-11 deferral; tracked in code comment)

### F3 — Comments say "proxy.ts" but the file is "middleware.ts"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth.ts:79, (app)/layout.tsx prose comments
- **Detail**: Conceptually correct (optimistic cookie boundary) but the filename reference is stale.
- **Fix**: s/proxy.ts/middleware.ts/ in comments when next touched.
- **Decision**: FIXED (updated auth.ts comments to reference middleware.ts)

### F4 — (auth) layout duplicates requireSession's session-fetch body

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM
- **Dimension**: Architecture
- **Location**: src/app/(auth)/layout.tsx vs src/lib/auth.ts
- **Detail**: Inverted/fail-open semantics justify not reusing requireSession(), but the lazy-import + getSession block is a near-copy.
- **Fix**: Optional — extract a shared getOptionalSession() in auth.ts that both requireSession() and AuthLayout build on.
- **Decision**: FIXED (extracted getOptionalSession() in auth.ts; requireSession() and AuthLayout both build on it)

### F5 — Dashboard load does two authoritative getSession calls

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture (Performance)
- **Location**: (app)/layout.tsx + (app)/dashboard/page.tsx
- **Detail**: Both call requireSession() independently. Cookie cache (maxAge 300) mitigates; page needs user.name.
- **Fix**: Optional — pass session via props/context, or read user in one place.
- **Decision**: FIXED (getOptionalSession() wrapped in React cache() — layout + page now share one getSession per request)
