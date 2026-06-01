# F-02 Data Schema Baseline — Plan Brief

> Full plan: `context/changes/data-schema-baseline/plan.md`
> Research: `context/changes/data-schema-baseline/research.md`

## What & Why

Land SprintFlow's foundation database schema (roadmap F-02): all ~18 product entities as Drizzle tables, a central set of Postgres enums, a token encryption-at-rest helper, and a single applied Supabase migration. Every downstream slice (S-01 account-auth through S-13 refinement-helper) queries a table defined here, so this is the long-pole foundation that unblocks the rest of the build.

## Starting Point

F-01 left a live schema (not a placeholder): four Better Auth tables (`user`/`session`/`account`/`verification`) in `src/db/schema.ts`, a working `getDb()` over `drizzle-orm/node-postgres` + Hyperdrive (TCP, Workers-safe — final, no change), and one applied migration (`0000`). No test framework, no db npm scripts, and three docs still carrying a stale Neon/HTTP driver mandate.

## Desired End State

`src/db/schema.ts` holds all 18 account-scoped tables (full detail) with enums, relations, and exported inferred types; `src/lib/crypto.ts` provides AES-256-GCM `encryptToken`/`decryptToken`; a single `0001_*` migration is generated and applied to Supabase so the tables are live; and the three stale driver docs reflect Hyperdrive-TCP.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| DB driver | Keep Hyperdrive-TCP (`node-postgres`) | Research proved the roadmap's "switch to neon-http" risk is stale; Hyperdrive already makes TCP Workers-safe | Research |
| Token encryption approach | App-layer AES-256-GCM, `node:crypto` | `nodejs_compat` is on, so the synchronous crypto path is free and keeps the key out of Postgres | Research |
| Crypto timing | Build helper + columns in F-02 | Define/verify the security boundary once in the foundation; downstream just calls it | Plan |
| Token storage shape | Single envelope `v1:iv:ct‖tag`, AAD-bound | Atomic, no partial-write hazard; AAD (`ownerId+provider`) blocks row-swap decryption | Plan |
| AAD vs transparent column | Plain `text` column + explicit `encryptToken/decryptToken` helpers | AAD needs row identity, which a transparent Drizzle `customType` can't supply | Plan |
| Tests | None this slice (throwaway script only) | Test framework deferred to a later training lesson | Plan |
| Table detail | Full detail for all 18 tables now | One complete migration; downstream slices not blocked on schema | Plan |
| PK style | `text` PK everywhere | Uniform with Better Auth tables; aligned FK types | Plan |
| Enums | Native `pgEnum` | DB-level enforcement of closed sets (8 anomaly types, etc.) | Plan |
| Type exports | Tables + `relations()` + `$inferSelect/$inferInsert` | Downstream gets typed queries + relational loads for free | Plan |
| Default thresholds | Typed `DEFAULT_THRESHOLDS` constant, seed at S-06 | No orphan/global seed before an account exists | Plan |
| Migration | Generate + apply to remote Supabase | Schema must be live for the next slice (F-01 precedent) | Plan |
| Stale docs | Fix all 3 in F-02 | Driver story is freshest now; stops misleading S-02+ | Plan |
| BLOCKED category | Ship 5 values; add later via `ALTER TYPE` | Matches locked MVP scope; no dead enum member | Plan |

## Scope

**In scope:** 18 account-scoped tables (full detail), all enums, relations + inferred types, `encryptToken/decryptToken` helper + key wiring, `DEFAULT_THRESHOLDS` constant, one generated+applied Supabase migration, fix 3 stale driver docs.

**Out of scope:** Query/repository layer, sync logic, UI, committed tests, `anomaly_settings` row seeding, 6th `BLOCKED` category, changes to Better Auth tables or the driver, encrypting Better Auth's legacy OAuth token columns.

## Architecture / Approach

Bottom-up across 4 phases in one file (`schema.ts`) plus a small `crypto.ts`: primitives first (enums + crypto), then stable config/entity tables, then high-churn engine/data tables + the defaults constant, then a single migration generated & applied once everything compiles. Every product table is account-scoped via `ownerId text → user.id ON DELETE CASCADE` (+ index/unique) — the relational form of the PRD cross-account-isolation guarantee. Token columns store an AAD-bound AES-GCM envelope; the key is a Workers Secret read via the existing `env? ?? process.env` pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Enums & crypto | All `pgEnum`s + `encryptToken/decryptToken` + key wiring | Crypto correctness (IV uniqueness, AAD, tamper-reject) — verified by script |
| 2. Config & entity tables | 9 stable tables + relations + types | FK/enum wiring; account-scope on every table |
| 3. Engine & data tables | 9 high-churn tables (full) + `DEFAULT_THRESHOLDS` | Over-specifying sync/anomaly internals before their slice exists |
| 4. Migration & docs | `0001_*` generated + applied to Supabase; 3 docs fixed | Remote DB apply; must not touch `0000`/Better Auth tables |

**Prerequisites:** F-01 done (it is); `DATABASE_URL`/Hyperdrive access; `TOKEN_ENCRYPTION_KEY` generated for local + set as Workers Secret for prod.
**Estimated effort:** ~2–3 sessions across 4 phases (schema-heavy but mechanical; crypto is the only logic).

## Open Risks & Assumptions

- Remote Supabase migration touches the shared DB — apply carefully; rollback is dropping the additive `0001` tables/enums (`0000` unaffected).
- **Cross-account isolation depends on the Supabase Data API (PostgREST) being disabled** — new public tables carry `anon` grants with no RLS, and the publishable key is browser-bundled. Phase 4 verifies the Data API is off (and documents direct-Hyperdrive-only access); enabling RLS is the phase-2 fallback if it's ever turned on. (Plan-review F1.)
- High-churn tables (sync data, anomaly internals) are specified from the PRD ahead of their engine slices; S-05/S-06 may still add columns despite "full detail now."
- `nodejs_compat` + `compatibility_date` 2025+ must remain set, or synchronous `node:crypto` AES-GCM breaks in the Worker runtime.
- Crypto ships without committed tests this slice (deliberate, per training sequence) — the throwaway-script verification is the only gate until tests arrive in a later lesson.

## Success Criteria (Summary)

- `tsc --noEmit` + `npm run lint` green; one `0001_*` migration applies cleanly to Supabase; all 18 tables + enums live, Better Auth tables untouched.
- A token round-trips through `encryptToken → decryptToken`, and tamper / wrong-AAD / missing-key all fail safely.
- The three foundation docs describe Hyperdrive-TCP, not neon-http.
