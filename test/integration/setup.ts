import { config } from "dotenv";

/**
 * Integration-suite setup (S-02 Phase 3). Loads `.env.local` so `DATABASE_URL`
 * and `TOKEN_ENCRYPTION_KEY` are present in `process.env` for the request-
 * context-free service core, then hard-refuses to run against any DB that is not
 * the local Supabase instance.
 *
 * The safety guard is load-bearing: these specs INSERT and DELETE credential /
 * monitored-repo rows. Pointed at a remote database that would be destructive,
 * so we allow-list localhost:54322 only and throw otherwise — a wrong
 * `DATABASE_URL` fails fast instead of mutating real data.
 */
config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Integration tests need DATABASE_URL (local Supabase). Run `npx supabase start` and ensure .env.local is present.",
  );
}

let host: string;
let port: string;
try {
  const parsed = new URL(url);
  host = parsed.hostname;
  port = parsed.port;
} catch {
  throw new Error("DATABASE_URL is not a valid URL.");
}

const isLocal =
  (host === "127.0.0.1" || host === "localhost") && port === "54322";
if (!isLocal) {
  throw new Error(
    `Refusing to run integration tests against ${host}:${port}. ` +
      "These specs mutate credential rows and only run against local Supabase (127.0.0.1:54322).",
  );
}

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error(
    "Integration tests need TOKEN_ENCRYPTION_KEY (from .env.local) to exercise the encrypt-before-store path.",
  );
}
