# SprintFlow — Cloudflare Workers Deploy Plan

**Status**: Pending execution approval  
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

- [ ] **[HUMAN]** Create a Cloudflare account at https://dash.cloudflare.com/sign-up (skip if you already have one)
- [ ] **[HUMAN]** Upgrade to **Workers Paid plan** ($5/month):
  - Dashboard → Workers & Pages → Plans → Upgrade
  - Required: the free plan's 3 MiB gzip bundle limit makes a Next.js 16 App Router project undeployable
- [ ] **[HUMAN]** Note your **Account ID** — visible in the right sidebar of any Workers & Pages page, or via `npx wrangler whoami` after login

### Supabase Account & Project

- [ ] **[HUMAN]** Create a Supabase account at https://supabase.com (skip if you already have one)
- [ ] **[HUMAN]** Create a new Supabase project:
  - Choose a region close to your users (e.g. EU West for Poland)
  - Project creation takes ~2 minutes
- [ ] **[HUMAN]** Once provisioned, collect the following from **Project Settings → Database → Connection string**:
  - Copy the **Transaction pooler** connection string (port **6543**, NOT 5432)
  - Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
  - This is `DATABASE_URL` — store it in your password manager now
- [ ] **[HUMAN]** From **Project Settings → API** collect:
  - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
  - **anon** public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - **service_role** secret key → `SUPABASE_SERVICE_ROLE_KEY` (never expose client-side)
- [ ] **[HUMAN]** Create `.env.local` in the project root (git-ignored — never commit):
  ```env
  DATABASE_URL=postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require
  NEXT_PUBLIC_SUPABASE_URL=https://[ref].supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
  SUPABASE_SERVICE_ROLE_KEY=[service-role-key]
  ```

### GitHub Repository

- [ ] Confirm `.github/workflows/` directory exists (currently empty — CI is set up in Phase 10)
- [ ] Confirm GitHub Actions is enabled for the repository (Settings → Actions → Allow all actions)

---

## Phase 1 — Wrangler Authentication

- [ ] Install Wrangler as a dev dependency (pins the version for CI parity):
  ```bash
  npm install -D wrangler
  ```
- [ ] **[HUMAN]** Authenticate the CLI — opens browser OAuth:
  ```bash
  npx wrangler login
  ```
- [ ] Verify authentication:
  ```bash
  npx wrangler whoami
  # Expected: "You are logged in with an OAuth Token, associated with the email ..."
  ```

---

## Phase 2 — Cloudflare Hyperdrive Setup

> Hyperdrive maintains a warm TCP connection pool between Cloudflare's edge and Supabase, solving the Workers request-scoped I/O problem. Without it, every Worker invocation would open a cold TCP connection to Supabase — causing latency spikes and risking connection exhaustion.

- [ ] **[HUMAN]** Create a Hyperdrive configuration pointing at the Supabase Transaction Pooler:
  ```bash
  npx wrangler hyperdrive create sprintflow-db \
    --connection-string="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require"
  ```
  Output includes a Hyperdrive **ID** (32-character hex string) — copy it now
- [ ] Verify the Hyperdrive config was created:
  ```bash
  npx wrangler hyperdrive list
  # Should show "sprintflow-db" with its ID
  ```

---

## Phase 3 — Package Installation

- [ ] Install the Cloudflare adapter:
  ```bash
  npm install -D @opennextjs/cloudflare
  ```
- [ ] Install database packages:
  ```bash
  npm install drizzle-orm pg
  npm install -D drizzle-kit @types/pg
  ```
- [ ] Verify adapter version is ≥ 1.19.9 (this version confirmed Next.js 16.2.6 compatibility):
  ```bash
  node -e "console.log(require('./node_modules/@opennextjs/cloudflare/package.json').version)"
  # Must print 1.19.9 or higher
  ```
  If lower: `npm install -D @opennextjs/cloudflare@latest`

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

- [ ] 4a complete — `wrangler.toml` created with correct Hyperdrive ID
- [ ] 4b complete — `open-next.config.ts` created
- [ ] 4c complete — `next.config.ts` updated
- [ ] 4d complete — `package.json` scripts updated
- [ ] 4e complete — `.gitignore` updated

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

- [ ] 5a complete — `src/lib/db.ts` created
- [ ] 5b complete — `drizzle.config.ts` created
- [ ] 5c complete — `src/db/schema.ts` placeholder created

---

## Phase 6 — Workers Secrets

> Secrets are encrypted at rest and injected into the Worker at runtime via `env`. They never appear in `wrangler.toml`, logs, or any client payload.

- [ ] **[HUMAN]** Set `DATABASE_URL` (paste Transaction Pooler connection string when prompted):
  ```bash
  npx wrangler secret put DATABASE_URL
  ```
- [ ] **[HUMAN]** Set `SUPABASE_SERVICE_ROLE_KEY`:
  ```bash
  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  ```
- [ ] **[HUMAN]** Set `NEXTAUTH_SECRET` (or `BETTER_AUTH_SECRET` depending on auth library chosen):
  ```bash
  npx wrangler secret put NEXTAUTH_SECRET
  # Generate a strong random value: openssl rand -base64 32
  ```
- [ ] Verify all secrets are registered (values are never shown):
  ```bash
  npx wrangler secret list
  # Should show: DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXTAUTH_SECRET
  ```

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

- [ ] Deploy:
  ```bash
  npx wrangler deploy
  ```
  Expected: output ends with `Deployed sprintflow (https://sprintflow.<account>.workers.dev)`

- [ ] Tail live logs immediately and open the workers.dev URL in a browser:
  ```bash
  npx wrangler tail
  ```
  Confirm no errors appear in the log stream on page load.

- [ ] List deployments to confirm the version is recorded:
  ```bash
  npx wrangler deployments list
  ```

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
