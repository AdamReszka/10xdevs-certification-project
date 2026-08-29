# Local setup on a second machine

Bringing up a working SprintFlow dev environment on a machine that already has
VS Code, git, Node, the GitHub CLI, OrbStack (or Docker Desktop), Claude Code and
a clone of this repo — but no database.

Written 2026-08-29 for the manual-testing machine. The commands come from this
repo's own CI (`.github/workflows/ci.yml`) and `supabase/config.toml`, not from
general knowledge; where a step could not be verified from here it says so.

**Verification is a separate job.** When these steps are done, run
`/sprintflow-health-check` in Claude Code — it checks all twenty things and
speaks Polish. This document is for the person doing the install.

---

## What the database actually is

Two facts decide the whole procedure:

1. **Drizzle owns the schema, not Supabase.** The Supabase snapshot in
   `supabase/migrations/` is infrastructure-only and creates **zero** product
   tables. The 19 files in `src/db/migrations/` are the real schema. CI records
   this explicitly, and the ordering `supabase start` → `db:migrate` is
   load-bearing.
2. **The local database is per-machine.** `supabase start` on a new machine
   gives an empty Postgres. Nothing carries over by itself.

## Step 1 — Node and dependencies

```bash
node --version          # must be v24 (see .nvmrc)
npm ci                  # not `npm install` — ci installs the locked versions
```

## Step 2 — Container runtime

OrbStack or Docker Desktop must be **running**, not merely installed:

```bash
docker info --format '{{.ServerVersion}}'   # prints a version = the engine is up
```

`docker --version` is not sufficient — it answers even when the engine is down.

## Step 3 — Start Supabase

```bash
npx supabase start
```

First run pulls several container images; allow a few minutes and a working
connection. The CLI is a devDependency (`supabase@^2.101.0`), so `npx` resolves
it — no global install.

Expect the output to end with `supabase local development setup is running` and
a table of URLs (Studio on `54323`, Mailpit on `54324`, database on `54322`).

**`Stopped services: [imgproxy, edge_runtime, pooler]` is normal.** Those three
are unused by this project and stay down on a healthy setup. Do not chase them.

## Step 4 — The `.env.local` file

Copy the file prepared on the source machine. **Only `.env.local` — never
`.env`.**

`.env` carries the connection string for the **production** database. It is
harmless on the machine that owns it, because `.env.local` overrides it and
`drizzle.config.ts` loads them in that order. On a second machine it is a
liability: delete or rename `.env.local` and `npm run db:migrate` targets
production. The prepared `.env.local` is self-contained, so that file never needs
to exist here at all.

```bash
scp <source-machine>:<path>/env.local.for-second-machine \
    <repo>/.env.local
chmod 600 .env.local
```

Then confirm the Supabase client values match this machine:

```bash
npx supabase status      # compare API URL and the publishable key
```

⚠️ **`TOKEN_ENCRYPTION_KEY` must be byte-identical to the source machine's.**
GitHub PATs and Jira tokens are encrypted at rest with it. A different key does
not produce an error message — it produces integrations that look broken for no
visible reason.

## Step 5 — Restore the database

The dump covers the `public` and `drizzle` schemas, with data, and is written
with `--clean --if-exists`, so it is safe to re-run.

```bash
scp <source-machine>:<path>/sprintflow-local-db.sql .
docker exec -i supabase_db_10xdevs-certification-project \
  psql -U postgres -d postgres < sprintflow-local-db.sql
```

The container name comes from `project_id` in `supabase/config.toml`; if it was
renamed, find it with `docker ps --format '{{.Names}}' | grep supabase_db`.

The dump includes `drizzle.__drizzle_migrations`, so the migration bookkeeping
arrives with the data.

## Step 6 — Verify the schema is current

```bash
npm run db:migrate
```

On a correct restore this is a **no-op** — the bookkeeping table already lists
all 19 migrations. If it applies anything, the dump was older than the checked-out
branch; that is fine, and this is the step that reconciles it.

## Step 7 — Run it

```bash
npm run dev
```

Then open `http://localhost:3000/login`.

## Step 8 — Hand over to the health-check

```
/sprintflow-health-check
```

It verifies all of the above independently and reports in Polish. Treat its
verdict as the definition of done, not this list.

---

## Things worth knowing before you hand the machine over

**The dump carries the e2e leftovers.** ~73 user rows are throwaway accounts from
Playwright runs (`e2e-user-*@example.test`). They are harmless and invisible in
the UI, but they are why the account list looks alarming in a direct query.

**Real credentials come with the dump.** Restoring gives this machine working
Jira and GitHub tokens for the FM project — that is the point, and it is also
worth saying out loud: a second physical machine now holds them.

**Mail leaves the machine.** If `RESEND_API_KEY` is present, password-reset and
daily-recap tests reach real inboxes. Comment both `RESEND_*` lines out to get
the console transport back, which logs the message instead of sending it.

**Two accounts, inverted names.** `demo@sprintflow.test` holds the *real*
credentials and the FM project; `adam.reszka85@gmail.com` holds seeded
placeholders and the WEB project. Identify the target account by what it points
at, never by the name.

## Not verified from here

This runbook was assembled on the source machine. Steps 1–3 and 5–7 are this
repo's own commands with names read out of its config; the `scp` invocations in
steps 4 and 5 are templates — paths depend on how the two machines reach each
other. Nothing here has been executed against a second machine.
