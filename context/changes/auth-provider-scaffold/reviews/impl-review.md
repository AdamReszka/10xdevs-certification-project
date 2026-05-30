<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-01 Auth Provider Scaffold

- **Plan**: context/changes/auth-provider-scaffold/plan.md
- **Scope**: Phases 1–3 (full plan)
- **Date**: 2026-05-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan fidelity is excellent — zero drift, all 5 accepted deviations implemented correctly, the Workers per-request construction rule holds. The two warnings are pre-existing/cross-cutting, not auth-logic defects.

## Findings

### F1 — Two competing wrangler configs; .jsonc wins, .toml edits inert

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — affects deploy correctness; the file you edit is not the file that ships
- **Dimension**: Safety & Quality (Reliability)
- **Location**: wrangler.toml vs wrangler.jsonc
- **Detail**: Both tracked. Wrangler resolves .jsonc before .toml; deploy confirms it (shipped name `10xdevs-certification-project` = .jsonc, not `sprintflow` = .toml). Phase 1's compatibility_date bump in wrangler.toml was inert (live date 2026-05-23 from .jsonc; native scrypt resolved only because .jsonc's date is also 2025+). .toml's [vars] (NEXT_PUBLIC_*) aren't delivered by config (survive via Next build-time .env inlining). .jsonc adds `global_fetch_strictly_public`. Secrets unaffected.
- **Fix A ⭐ Recommended**: Consolidate into wrangler.jsonc, delete wrangler.toml.
  - Strength: .jsonc is what ships and carries the working Hyperdrive binding + valid compat date; fold needed [vars]/[build] in so one file is the truth.
  - Tradeoff: Port [build] + NEXT_PUBLIC_* vars to JSON; re-verify a deploy.
  - Confidence: HIGH — deploy output proves .jsonc is canonical.
  - Blind spot: Whether anything external references the `sprintflow` name (nothing in-repo).
- **Fix B**: Delete wrangler.jsonc, keep wrangler.toml.
  - Strength: .toml has vars + build command + the secrets comment already.
  - Tradeoff: Changes live worker NAME → new URL; orphans current deployment + secrets bound to .jsonc-named worker. Higher blast radius.
  - Confidence: MEDIUM — renaming mid-stream is disruptive.
  - Blind spot: Existing secrets are bound to the .jsonc-named worker.
- **Decision**: FIXED via Fix A — folded [vars] + secrets note into wrangler.jsonc, deleted wrangler.toml, redeployed + verified (gate 307, API 200).

### F2 — requireSession() has no fail-closed error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; small edit, but semantics matter
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/auth.ts:70-85
- **Detail**: requireSession() calls auth.api.getSession (DB hit via Hyperdrive) with no try/catch. A transient DB blip makes the gated server component throw → error page instead of graceful /login redirect. Brushes PRD "never a white screen on API failure".
- **Fix**: Wrap getSession so a thrown error falls through to redirect("/login") (fail-closed). Note: redirect() throws internally — catch must re-throw Next's redirect signal and only swallow real errors.
- **Decision**: FIXED — wrapped getSession in try/catch in src/lib/auth.ts; real errors fail closed to redirect("/login"), redirect() throw kept outside try. Build + lint green.

### F3 — session/account.updated_at NOT NULL with no DB default

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Data safety
- **Location**: src/db/schema.ts:24,54
- **Detail**: Unlike user/verification (defaultNow()), session.updatedAt & account.updatedAt are NOT NULL with only Drizzle $onUpdate. Better Auth sets them on insert so it works; latent insert-failure trap for any non-Better-Auth writer.
- **Fix**: Add .defaultNow() to both in a future migration (CLI-generated schema; no action required this slice).
- **Decision**: SKIPPED — noted for a future slice; works today (Better Auth sets updatedAt on insert).

### F4 — BETTER_AUTH_SECRET not validated at createAuth

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth.ts:27
- **Detail**: secret passed through possibly-undefined; a missing secret yields a misconfigured/insecure instance rather than a loud failure (db.ts asserts DATABASE_URL! by contrast).
- **Fix**: Throw if secret is absent at runtime (env present) in createAuth.
- **Decision**: FIXED — createAuth throws when env is present but secret is absent (CLI path exempt). Build + lint green.

### F5 — static `auth` export builds a pg.Pool at module load

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: src/lib/auth.ts:58
- **Detail**: `export const auth = createAuth()` opens a Pool against process.env.DATABASE_URL at import. Safe today — no Worker path imports static `auth` (only createAuth(env)), betterAuth() doesn't eagerly connect. Safe only while that import discipline holds.
- **Fix**: One-line comment already present; optionally make the static export lazy in a future slice. No action now.
- **Decision**: SKIPPED — safe + documented today; optional lazy refactor deferred.
