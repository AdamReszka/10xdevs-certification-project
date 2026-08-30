import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Ceiling on simultaneous connections per pool — a *ceiling*, not an allocation:
 * `pg.Pool`'s constructor opens nothing (`pg-pool/index.js:167,235`), so one
 * value is correct on both runtimes and no runtime branch is needed.
 *
 * 5 is Cloudflare's own number, not a throughput guess: their Hyperdrive +
 * node-postgres example sets `max: 5` "due to Workers' limits on concurrent
 * external connections", and Workers allows six simultaneous connections per
 * invocation before the seventh queues. On Workers this is a per-invocation
 * budget; in `next dev` the memoized pool is process-global, so it is the whole
 * dev server's budget.
 */
const POOL_MAX = 5;

/**
 * Key under which the request-scoped handle is memoized on the adapter's own
 * request-context object. `Symbol.for` (global registry) rather than `Symbol()`
 * so the memo survives a module re-evaluation under dev HMR.
 */
const REQUEST_DB = Symbol.for("sprintflow.requestDb");

type DbEnv = { HYPERDRIVE?: { connectionString: string } };
type DbHandle = ReturnType<typeof getDbWithPool>;

/**
 * The adapter's request context, or `undefined` when there is none.
 *
 * The adapter exports no non-throwing accessor: `getCloudflareContext()` THROWS
 * for SSG, at module top level, and on the cron path (`src/worker.ts:43-47`
 * calls `runScheduledSync` OUTSIDE `runWithCloudflareRequestContext`). This
 * catch is load-bearing, not defensive — without it `npm run build` and the
 * scheduled handler break.
 */
function currentContext():
  | (Record<symbol, unknown> & { env: CloudflareEnv })
  | undefined {
  try {
    return getCloudflareContext() as unknown as Record<symbol, unknown> & {
      env: CloudflareEnv;
    };
  } catch {
    return undefined;
  }
}

/**
 * Build a drizzle instance with a pool the CALLER owns and must close.
 *
 * Always constructs fresh — it never reads or writes the request memo, which is
 * what makes it safe to `.end()`. Three call sites legitimately use it:
 * `sync/scheduled.ts` (no request context to memoize on), `sync/actions.ts` and
 * `api/webhooks/resend/route.ts` (a deliberately separate pool for a
 * long-running fan-out that outlives the useful life of the shared handle).
 *
 * Every other path wants {@link getDb}. Never call `.end()` on a handle that
 * came from `getDb` — in `next dev` that pool is process-global and closing it
 * poisons the dev server for the rest of its life.
 */
export function getDbWithPool(env?: DbEnv) {
  const connectionString =
    env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString,
    max: POOL_MAX,
  });
  return { db: drizzle(pool), pool };
}

/**
 * The request-scoped `db` handle. Every caller under one request context gets
 * the SAME instance, so `createAuth`, `resolveWorkspace` and the page/action
 * body share one pool instead of building three or four (S-21).
 *
 * Identity comes from the adapter's context object — per-invocation on Workers,
 * per-process in `next dev`. Two fallbacks return an unshared handle instead:
 * SSG/module top level and the cron path, where no context object exists.
 *
 * Invariant — FIRST CONSTRUCTION WINS: the memo key is the context object, not
 * `env`, so every later caller under one context inherits the first caller's
 * `env`. That is safe only while every participant is a request-path caller
 * passing `getCloudflareContext().env`; the one module-scope constructor
 * (`auth.ts`'s static `auth` export) is deliberately kept out of the memo.
 *
 * The pool is intentionally not exposed: nobody may `.end()` this handle. Use
 * {@link getDbWithPool} on a path that owns its own teardown.
 */
export function getDb(env?: DbEnv) {
  const ctx = currentContext();
  if (!ctx) return getDbWithPool(env).db;
  return ((ctx[REQUEST_DB] ??= getDbWithPool(env ?? ctx.env)) as DbHandle).db;
}
