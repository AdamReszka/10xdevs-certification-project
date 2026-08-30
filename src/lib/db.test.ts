import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb, getDbWithPool } from "@/lib/db";

/**
 * The identity contract of the request-scoped `db` handle (S-21).
 *
 * Before this slice, one authenticated request built THREE independent
 * `pg.Pool`s — one in `createAuth`, one in `resolveWorkspace`, one in the page
 * or action body — and a Server Action built four, because React `cache()` is
 * inert outside a Flight render. These cases are the guard that keeps a future
 * fourth constructing seam from quietly costing another connection.
 *
 * Hermetic: `pg.Pool`'s constructor opens nothing, so no case here needs (or
 * touches) a database.
 */

/** The adapter's own global cell — nothing defines it in a Vitest process. */
const CONTEXT = Symbol.for("__cloudflare-context__");
/** Where `getDb` memoizes the handle. Must match `src/lib/db.ts`. */
const REQUEST_DB = Symbol.for("sprintflow.requestDb");

const ENV = {
  HYPERDRIVE: { connectionString: "postgresql://u:p@127.0.0.1:54322/postgres" },
};

type SymbolBag = Record<symbol, unknown>;

/** Stand in for one `runWithCloudflareRequestContext` invocation. */
function installContext(): SymbolBag & { env: typeof ENV } {
  const context = { env: ENV, ctx: {}, cf: undefined };
  (globalThis as unknown as SymbolBag)[CONTEXT] = context;
  return context;
}

afterEach(() => {
  delete (globalThis as unknown as SymbolBag)[CONTEXT];
  vi.resetModules();
});

describe("getDb — request-scoped identity", () => {
  it("returns the same handle to every caller under one context", () => {
    installContext();

    expect(getDb(ENV)).toBe(getDb(ENV));
  });

  it("returns a different handle under a fresh context", () => {
    installContext();
    const first = getDb(ENV);

    installContext();

    expect(getDb(ENV)).not.toBe(first);
  });

  it("falls back to an unshared handle when no context is installed", () => {
    // SSG, module top level, and the cron path (`worker.ts` runs
    // `runScheduledSync` outside the ALS wrapper) all land here.
    const first = getDb(ENV);
    const second = getDb(ENV);

    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("opens no connection at construction", () => {
    installContext();
    getDb(ENV);

    // The premise `src/lib/auth.test.ts:15-17` rests on: `createAuth()` is safe
    // to call in a hermetic test because nothing connects until a query runs.
    const { pool } = getDbWithPool(ENV);
    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);
  });
});

describe("getDbWithPool — the explicitly-owned pool", () => {
  it("never returns the memoized handle, so `.end()` cannot reach it", () => {
    const context = installContext();
    const shared = getDb(ENV);
    const memoized = context[REQUEST_DB];

    const owned = getDbWithPool(ENV);

    expect(owned.db).not.toBe(shared);
    expect(context[REQUEST_DB]).toBe(memoized);
  });
});

describe("the static `auth` export", () => {
  it("does not populate the memo", async () => {
    const context = installContext();

    vi.resetModules();
    await import("@/lib/auth");

    // `export const auth = createAuth()` supplies no env and evaluates AFTER
    // `initOpenNextCloudflareForDev` installs the dev context. Under the memo it
    // would become the process-global pool for the whole dev server, and every
    // later `getDb(env)` would silently inherit its env.
    expect(context[REQUEST_DB]).toBeUndefined();
  });
});
