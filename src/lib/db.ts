import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Build a request/invocation-scoped drizzle instance AND expose its `pg.Pool` so
 * the caller can tear it down. On Cloudflare Workers a pool left open pins a
 * Hyperdrive-backed connection for the isolate's lifetime (lesson #3); the
 * scheduled/on-demand sync path has no request after-hook, so it MUST close the
 * pool itself via `ctx.waitUntil(pool.end())` after all queries resolve.
 */
export function getDbWithPool(env?: { HYPERDRIVE?: { connectionString: string } }) {
  const connectionString =
    env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString,
    max: 1,
  });
  return { db: drizzle(pool), pool };
}

/**
 * Request-path convenience that hides the pool (unchanged S-02 behavior). The
 * pre-existing request-path leak (lesson #3) is out of scope for S-05 and stays a
 * separate ticket; use {@link getDbWithPool} on any path that owns teardown.
 */
export function getDb(env?: { HYPERDRIVE?: { connectionString: string } }) {
  return getDbWithPool(env).db;
}
