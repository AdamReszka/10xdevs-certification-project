# SprintFlow — Cloudflare Workers Deploy Plan

**Status**: In progress — Phases 0–8 complete, Phase 9 (Git integration) pending  
**Platform**: Cloudflare Workers (Paid, $5/mo)  
**Adapter**: `@opennextjs/cloudflare` ≥ 1.19.9  
**Database**: Supabase (PostgreSQL) via Cloudflare Hyperdrive + Drizzle ORM  
**Drafted**: 2026-05-23  
**Source**: `context/foundation/infrastructure.md`

---

## Scope of This Plan

This plan covers the path from a bare Next.js 16.2.6 scaffold to a running production Worker with CI/CD, database connectivity, and secrets management. It does **not** cover: auth implementation, Drizzle schema design, anomaly-detection business logic, or Cron Trigger wiring — those belong in feature implementation plans.

**Human gates are marked `[HUMAN]`** — steps that require a browser, paste of a secret, or irreversible account action. All other steps are agent-executable.

---

## Phase 0 — External Account Prerequisites

> Complete all items in this phase before touching any code. These are one-time browser/CLI setup steps.

### Cloudflare Account

- [x] **[HUMAN]** Create a Cloudflare account at https://dash.cloudflare.com/sign-up (skip if you already have one)
- [x] **[HUMAN]** Upgrade to **Workers Paid plan** ($5/month)
- [x] **[HUMAN]** Account ID confirmed via `npx wrangler whoami`

### Supabase Account & Project

- [x] **[HUMAN]** Supabase account exists; project `uzqwuikgbbkpnemcnlwo` provisioned (EU region)
- [x] **[HUMAN]** Credentials collected and stored in `.env` and `.env.local`
  - Note: env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `ANON_KEY` — newer Supabase naming)
  - `.env.local` points to local Supabase (`127.0.0.1:54321`); `.env` points to cloud
- [x] **[HUMAN]** `.env.local` created and gitignored

### GitHub Repository

- [x] `.github/workflows/` directory exists (currently empty — CI set up in Phase 10)
- [x] GitHub Actions enabled for the repository

---

## Phase 1 — Wrangler Authentication

- [x] Wrangler 4.94.0 installed as dev dependency
- [x] **[HUMAN]** Authenticated via OAuth — `adam.reszka85@gmail.com`
- [x] `npx wrangler whoami` confirmed

---

## Phase 2 — Cloudflare Hyperdrive Setup

> Hyperdrive maintains a warm TCP connection pool between Cloudflare's edge and Supabase, solving the Workers request-scoped I/O problem. Without it, every Worker invocation would open a cold TCP connection to Supabase — causing latency spikes and risking connection exhaustion.

- [x] **[HUMAN]** Hyperdrive `sprintflow-db` created
  - ID: `86417a117a96464e947d5005e56f2a21`
  - Host: `db.uzqwuikgbbkpnemcnlwo.supabase.co:5432` (direct connection — correct when using Hyperdrive; Hyperdrive is the pooler)
- [x] `npx wrangler hyperdrive list` confirmed

---

## Phase 3 — Package Installation

- [x] `@opennextjs/cloudflare` 1.19.11 installed
- [x] `drizzle-orm` 0.45.2 + `pg` 8.21.0 installed
- [x] `drizzle-kit` 0.31.10 + `@types/pg` 8.20.0 installed
- [x] `wrangler` 4.94.0 installed

---

## Phase 4 — Configuration Files

### 4a — Create `wrangler.toml`

Create `/wrangler.toml` in the project root:

```toml
name = "sprintflow"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
main = ".open-next/worker.js"
assets = { directory = ".open-next/assets", binding = "ASSETS" }

[build]
command = "npm run build:cloudflare"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<YOUR-HYPERDRIVE-ID>"       # from Phase 2 — replace this placeholder

[vars]
# Non-secret public vars only — secrets go via `wrangler secret put`
NEXT_PUBLIC_SUPABASE_URL = "https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY = "[anon-key]"
```

- [ ] Replace `<YOUR-HYPERDRIVE-ID>` with the ID from Phase 2
- [ ] Replace `[ref]` and `[anon-key]` with values from Phase 0

### 4b — Create `open-next.config.ts`

Create `/open-next.config.ts` in the project root:

```typescript
import type { OpenNextConfig } from "@opennextjs/cloudflare";

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
    },
  },
};

export default config;
```

> **Why this file matters**: Without it, `opennextjs-cloudflare build` prompts interactively and hangs in CI. Fixed in v1.19.3 to error instead of hang — but providing the file pre-empts the issue entirely.

### 4c — Update `next.config.ts`

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    // Required: no Cloudflare Images binding configured yet.
    // Without this, <Image> silently falls back to unoptimized in production.
    // Remove when a Cloudflare Images binding is added.
  },
};

export default nextConfig;
```

### 4d — Update `package.json` scripts

Add these scripts:

```json
"build:cloudflare": "npx opennextjs-cloudflare build",
"deploy": "npm run build:cloudflare && npx wrangler deploy",
"preview": "npm run build:cloudflare && npx wrangler dev"
```

### 4e — Confirm `.gitignore` covers Workers build output

Add if missing:
```
.open-next/
.wrangler/
.env.local
.env*.local
```

- [x] 4a complete — `wrangler.toml` created with Hyperdrive ID `86417a117a96464e947d5005e56f2a21`; build command is `npm run build:cf`
- [x] 4b complete — `open-next.config.ts` uses `defineCloudflareConfig` with `staticAssetsIncrementalCache` (newer API than plan template; functionally equivalent and preferred)
- [x] 4c complete — `next.config.ts` updated with `images: { unoptimized: true }`
- [x] 4d complete — `deploy` and `preview` scripts added to `package.json`
- [x] 4e complete — `.open-next/` and `.wrangler/` already in `.gitignore`

---

## Phase 5 — Drizzle ORM Setup

### 5a — Create `src/lib/db.ts`

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Accept env per-request; fall back to DATABASE_URL for local `next dev`
// (Hyperdrive binding is only available inside the Wrangler runtime)
export function getDb(env?: { HYPERDRIVE?: { connectionString: string } }) {
  const connectionString =
    env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString,
    max: 1, // Workers are single-threaded per invocation; one connection is enough
  });
  return drizzle(pool);
}
```

### 5b — Create `drizzle.config.ts`

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

### 5c — Create placeholder schema file

Create `src/db/schema.ts` (will be expanded during feature implementation):

```typescript
// Drizzle schema — tables will be added during feature implementation
export {};
```

- [x] 5a complete — `src/lib/db.ts` created
- [x] 5b complete — `drizzle.config.ts` created
- [x] 5c complete — `src/db/schema.ts` placeholder created

---

## Phase 6 — Workers Secrets

> Secrets are encrypted at rest and injected into the Worker at runtime via `env`. They never appear in `wrangler.toml`, logs, or any client payload.

- [x] **[HUMAN]** `DATABASE_URL` secret set via `wrangler secret put`
- [x] ~~`SUPABASE_SERVICE_ROLE_KEY` secret~~ — **removed 2026-08-29.** Nothing reads
  it: `@supabase/supabase-js` is not a dependency, no code constructs a Supabase
  client, and the app reaches Postgres solely through the `HYPERDRIVE` binding.
  It was also revoked upstream during the rotation below, so the value was dead.
- [x] **[HUMAN]** `BETTER_AUTH_SECRET` set — Better Auth was the library chosen (F-01)
- [x] Verify all secrets registered: `npx wrangler secret list`

### Secrets as of 2026-08-29 (all seven active on the deployed version)

`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`,
`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `TOKEN_ENCRYPTION_KEY`.

⚠️ **`RESEND_FROM_ADDRESS` is a secret although it is not secret.** Plain `vars`
resolve to `null` in `getCloudflareContext().env` on this OpenNext version, and
the `vars` block in `wrangler.jsonc` is authoritative — a value added in the
dashboard is overwritten on the next deploy. The same reasoning applies to
`BETTER_AUTH_URL`.

⚠️ **`wrangler secret put` fails when the latest version is not deployed**
("Secret edit failed… the latest version of your Worker isn't currently
deployed"). Each secret write uploads a new version; if one is left undeployed,
the next write is refused. Use `wrangler versions secret put <KEY>` and then
`wrangler versions deploy <id>@100`. A secret that sits in an undeployed version
is not in effect, so `wrangler secret list` alone does not prove production has it.

### Rotation of 2026-08-29

Credentials were exposed to a session transcript by an editor selection and were
rotated. Recorded because two findings outlive the incident.

**Production had never worked.** The database was 16 migrations behind (3 of 19
applied, 22 tables of 27) and three secrets the code requires were absent —
including `TOKEN_ENCRYPTION_KEY`, whose absence makes `src/lib/crypto.ts` throw
on every credential read or write. Zero rows existed in `user`,
`github_credential`, `jira_credential`, `sprint` or `anomaly`. Fixed the same
day: migrations applied through the pooler, secrets set, version deployed, and
`/api/auth/get-session` verified returning `200` — proof the Worker reaches
Postgres through Hyperdrive.

**The direct database host is unreachable from an IPv4 network.**
`db.<ref>.supabase.co` publishes AAAA only. Migrating production from a
developer machine needs the pooler:
`postgresql://postgres.<ref>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
(this project is in West EU / Ireland). Cloudflare is unaffected, so the
Hyperdrive origin still points at the direct host.

Local and production now hold **different** `TOKEN_ENCRYPTION_KEY` values, which
is deliberate: a local dump cannot be restored into production, because the
production key will not decrypt locally-encrypted tokens. Rotating that key
without re-encrypting orphans every stored token, so
`scripts/rotate-token-encryption-key.ts` exists to do it in one transaction with
verification before commit.

---

## Phase 7 — Local Build Verification

> This phase catches adapter/compatibility issues before touching production. Run every step; do not skip even if the previous step passed.

- [ ] **Step 1** — Run the Cloudflare build:
  ```bash
  npm run build:cloudflare
  ```
  Expected: exits 0, produces `.open-next/` directory.

  | Symptom | Cause | Fix |
  |---|---|---|
  | `Unexpected loadManifest(prefetch-hints.json)` | Adapter < 1.19.9 | `npm install -D @opennextjs/cloudflare@latest` |
  | Build hangs with no output | `open-next.config.ts` missing | Create the file from Phase 4b |
  | `wrangler.toml not found` prompt | `wrangler.toml` missing | Create the file from Phase 4a |

- [ ] **Step 2** — Check bundle size (must be < 10,000 KiB on Paid plan):
  ```bash
  npx wrangler deploy --dry-run --outdir .open-next
  # Look for: "Total Upload: X KiB gzip"
  ```
  If > 8,000 KiB: see Edge Case E1 (dynamic-import the Anthropic SDK).

- [ ] **Step 3** — Run local Workers preview and verify the root page loads:
  ```bash
  npm run preview
  # App runs at http://localhost:8787
  ```
  Open http://localhost:8787 in a browser. Confirm the page renders without console errors.

---

## Phase 8 — First Production Deploy

- [x] Deployed via `npm run deploy`
  - URL: https://10xdevs-certification-project.adam-reszka85.workers.dev
  - Version ID: `20afb2ec-d1ff-49f5-be99-9e4591fc4e81`
  - Bundle: 928 KiB gzip / startup 27ms

- [ ] Tail live logs: `npx wrangler tail`
- [ ] List deployments: `npx wrangler deployments list`

**Rollback reference** (if something is wrong):
```bash
npx wrangler rollback                    # roll back to previous deployment
npx wrangler versions list               # see all versions with their IDs
npx wrangler rollback <VERSION_ID>       # roll back to a specific version
```
Note: rollback restores the Worker code only — database migrations are not reversed.

---

## Phase 9 — Cloudflare Git Integration (Auto-Deploy on Push)

> This phase wires Cloudflare's built-in Git integration so every push to `main` triggers an automatic deploy on Cloudflare's side — no GitHub Actions workflow file required. GitHub Actions CI/CD (with drizzle migrations, PR previews, etc.) is deferred to a later phase.

**How it works**: Cloudflare Workers Builds connects directly to your GitHub repository via OAuth. When you push to `main`, Cloudflare clones the repo, runs your `build:cloudflare` script, and deploys the result — all without a workflow file.

### 9a — Connect GitHub to Cloudflare Workers Builds

- [ ] **[HUMAN]** Go to the Cloudflare dashboard → **Workers & Pages**
- [ ] **[HUMAN]** Click on the **sprintflow** Worker (created in Phase 8)
- [ ] **[HUMAN]** Navigate to **Settings → Builds & Deployments**
- [ ] **[HUMAN]** Click **Connect to Git**
- [ ] **[HUMAN]** Authorize Cloudflare to access your GitHub account (OAuth flow)
- [ ] **[HUMAN]** Select the `10xdevs-certification-project` repository
- [ ] **[HUMAN]** Configure the build settings:
  - **Branch to deploy**: `main`
  - **Build command**: `npm run build:cloudflare`
  - **Build output directory**: `.open-next`
  - **Root directory**: `/` (leave empty if the project is at repo root)
  - **Node.js version**: `22`

### 9b — Verify the Git integration trigger

- [ ] **[HUMAN]** Make a trivial commit and push to `main`:
  ```bash
  git commit --allow-empty -m "chore: verify cloudflare auto-deploy trigger"
  git push origin main
  ```
- [ ] **[HUMAN]** In the Cloudflare dashboard → Workers & Pages → sprintflow → **Deployments**, confirm a new build appears and completes successfully
- [ ] Tail logs during the triggered deploy to confirm a clean boot:
  ```bash
  npx wrangler tail
  ```

### Note — Secrets in Cloudflare Builds

Workers Secrets set via `wrangler secret put` (Phase 6) are automatically available to the Worker at runtime after each Git-triggered deploy — no extra configuration needed. The build environment itself does **not** have access to secrets (the `build:cloudflare` script only processes code, it doesn't connect to the database).

### Deferred — GitHub Actions CI/CD

Full GitHub Actions setup (Drizzle migrations before deploy, per-PR preview Workers, lint/type-check gates) is deferred. When that phase is activated, disable the Cloudflare Git integration first to avoid double-deploys on push to `main`.

---

## Edge Cases & Extra Support Steps

### E1 — Bundle size approaching 10 MiB ceiling

When `--dry-run` reports > 8,000 KiB, the Anthropic SDK (installed later for the Refinement Helper) is the most likely cause (~2 MiB). Use a dynamic import so it's excluded from the initial bundle:

```typescript
// Instead of: import Anthropic from "@anthropic-ai/sdk"
const { default: Anthropic } = await import("@anthropic-ai/sdk");
```

Re-run `--dry-run` after each large SDK addition to stay within budget.

### E2 — Auth library crypto incompatibility

Workers `nodejs_compat` covers most Node.js crypto APIs but not all. Before building any auth-gated route:

1. Create a minimal test route at `src/app/api/auth-smoke/route.ts` that imports and calls the auth library's session create/validate cycle
2. `npm run build:cloudflare && npx wrangler deploy`
3. `curl https://sprintflow.<account>.workers.dev/api/auth-smoke` and check `npx wrangler tail --status error` for `crypto.xxx is not a function`

If NextAuth fails: switch to Better Auth before implementing auth-gated routes — Better Auth explicitly targets edge runtimes and has better Workers compatibility.

### E3 — Supabase connection timeout in Workers

If DB calls time out in production (not locally):
1. Confirm you're using the **Transaction pooler** URL (port **6543**), not the Direct connection (port 5432) — direct connections require a persistent TCP socket Workers can't maintain
2. Confirm `?sslmode=require` is appended to `DATABASE_URL`
3. If timeouts persist: add `?pgbouncer=true` to the connection string to enable PgBouncer-compatible mode

### E4 — Hyperdrive not available in `next dev`

The `HYPERDRIVE` binding is only injected by the Wrangler runtime (`npm run preview`). In `next dev`, `env.HYPERDRIVE` is `undefined`. The `getDb()` fallback in Phase 5a handles this transparently — `next dev` uses `DATABASE_URL` directly, `preview`/production uses Hyperdrive.

If you see `Cannot read properties of undefined (reading 'connectionString')`:
- Confirm `getDb()` is called with `env` from the Workers `Env` object, not with `undefined` explicitly
- Confirm `.env.local` contains a valid `DATABASE_URL`

### E5 — Cron Trigger timing drift (for the 15-minute sync, FR-011/FR-012)

Cloudflare Cron Triggers fire approximately on schedule — there is no SLA on precision. When the sync cron is wired (later feature):
- Record the actual sync completion timestamp in the database (`lastSyncAt = new Date()` at the end of the sync handler)
- Display `lastSyncAt` from the DB on the dashboard — never display the scheduled trigger time

### E6 — Preview Worker secrets

Preview Workers (`sprintflow-pr-N`) do not inherit production secrets. For PR previews that need DB access:
```bash
npx wrangler secret put DATABASE_URL --name sprintflow-pr-<N>
```
Acceptable alternative: let preview Workers run without DB (UI-only changes don't need it).

### E7 — Wrangler version drift

Wrangler is pinned in `package.json` devDependencies (Phase 3). If a teammate or CI runs `npm install` and gets a different Wrangler minor:
```bash
# Check what's installed
npx wrangler --version
# Lock to an exact version if drift causes issues:
npm install -D wrangler@3.90.0   # pin to the version that worked
```

### E8 — `next/image` silent fallback

With `unoptimized: true` in `next.config.ts`, all `<Image>` components serve the raw original file. This is intentional and explicit — it avoids the silent fallback that would occur without the flag. When a Cloudflare Images subscription is added:
1. Remove `unoptimized: true`
2. Add a `remotePatterns` config for external image domains
3. Redeploy

### E9 — Drizzle migration fails in CI on first run (no schema yet)

`drizzle-kit migrate` on an empty schema file (`export {}`) generates no SQL and exits 0 — this is safe. The step will start producing real migrations once tables are defined in `src/db/schema.ts`.

---

## Operational Reference (post-deploy)

| Operation | Command |
|---|---|
| Deploy production | `npx wrangler deploy` |
| Roll back to previous | `npx wrangler rollback` |
| Roll back to specific version | `npx wrangler rollback <VERSION_ID>` |
| List deployment versions | `npx wrangler versions list` |
| Stream all live logs | `npx wrangler tail` |
| Stream error logs only | `npx wrangler tail --status error` |
| Structured JSON log output | `npx wrangler tail --format json` |
| Add or rotate a secret | `npx wrangler secret put KEY` |
| List registered secrets | `npx wrangler secret list` |
| Local Workers preview | `npm run preview` |
| Bundle size check | `npx wrangler deploy --dry-run --outdir .open-next` |
| List Hyperdrive configs | `npx wrangler hyperdrive list` |

## Destructive Actions — Human Only

The following are never automated, never agent-executed without explicit instruction:

- Deleting the `sprintflow` Workers project
- Rotating or revoking `CLOUDFLARE_API_TOKEN`
- Modifying Cloudflare DNS records or Access policies
- Deleting the Supabase project or its data
- Rolling back database migrations
- Changing Cloudflare account billing or plan
