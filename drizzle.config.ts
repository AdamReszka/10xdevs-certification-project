import type { Config } from "drizzle-kit";
import { config as loadDotenv } from "dotenv";

// drizzle-kit auto-loads `.env`, whose DATABASE_URL points at the REMOTE prod DB.
// `.env.local` is the gitignored, local-only override (local Supabase at
// 127.0.0.1:54322) and is never deployed. Loading it here with `override: true`
// makes `db:migrate`/`db:generate` default to the LOCAL dev DB whenever a
// developer has a `.env.local` — so a stray migrate can't silently hit prod.
//
// Escape hatch for a deliberate non-local migration (e.g. applying to prod):
// set `DATABASE_URL_OVERRIDE=<url>` in the shell; it is checked before the
// (now local) DATABASE_URL and bypasses the `.env.local` default.
loadDotenv({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL_OVERRIDE ?? process.env.DATABASE_URL!;

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
} satisfies Config;
