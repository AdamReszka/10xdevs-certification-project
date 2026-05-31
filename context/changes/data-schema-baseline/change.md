---
change_id: data-schema-baseline
title: Data schema baseline
status: implemented
created: 2026-05-31
updated: 2026-05-31
archived_at: null
---

## Notes

**What this is.** Roadmap F-02 — the foundation slice that lands the Drizzle schema + Supabase
migration for all product entities. Pure schema + migration work; no app/UI/feature logic.
Unblocks the whole downstream chain (S-01 account-auth through S-13 refinement-helper).

**Why now.** F-01 (auth-provider-scaffold) is done and merged. Nearly every other slice needs a
table this change defines, so F-02 is the long pole — it runs parallel with F-01/F-03 but gates
S-01…S-13.

**Scope decisions locked at research time:**
- Design and land the **full entity model now** (~18 tables across FR-002–007, 009–013, 018–020),
  not thin stubs. STABLE tables get full columns; HIGH-CHURN tables (synced GitHub/Jira data,
  anomaly, anomaly_settings, daily_recap, refinement_session) land their FR-pinned contract
  columns with `jsonb` bodies left deliberately open for their owning slice to refine.
- Every product table is account-scoped: `ownerId text NOT NULL → user.id ON DELETE CASCADE` +
  index (the relational form of the PRD cross-account-isolation guarantee).
- Token encryption-at-rest = **app-layer AES-256-GCM in a Drizzle `customType`**, synchronous
  `node:crypto`, key from a Workers Secret. `nodejs_compat` is already on (Better Auth scrypt),
  so the sync-crypto path Drizzle's `customType` requires is free. One `encryptedToken` envelope
  column (`v1:iv:ciphertext||tag`) + `keyVersion`. Bind `userId`+`provider` as GCM AAD;
  `autoDecrypt:false` so a broad SELECT can never serialize plaintext.

**Landmines to remember:**
- The roadmap's headline F-02 driver risk is **STALE**. The project uses Supabase + Cloudflare
  Hyperdrive + `drizzle-orm/node-postgres` (TCP) — Hyperdrive makes TCP `pg` Workers-safe. There
  is **no** Neon/HTTP migration to do; `@neondatabase/serverless` isn't even installed. F-02 does
  zero driver work beyond confirming the Hyperdrive binding stays valid during migration.
- Three docs still echo the dead Neon/HTTP mandate and should be corrected (candidate to fold into
  this slice): `CLAUDE.md:42`, `context/foundation/infrastructure.md`, and the roadmap F-02 risk note.
- Do **not** redefine or rename the four Better Auth tables (`user`/`session`/`account`/`verification`);
  only FK to `user.id`. Mirror existing conventions: singular table names, snake_case↔camelCase,
  `text` IDs, `defaultNow()`+`$onUpdate` timestamps.
- `sprint.endDate` must exist from day one — it's the retention purge key for S-12 (keyed to sprint
  boundaries, not calendar days).
- No technology-track history table in MVP (FR-006 needs mutability, not history).

**Out of scope.** No data-access/query layer, no sync logic, no UI — those belong to S-02+.
Migration is generated (`drizzle-kit generate`) and applied (`drizzle-kit migrate`); the
`supabase/migrations/` lineage stays separate.

Research complete — full detail, table-by-table model, and encryption comparison in `research.md`.
