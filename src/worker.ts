/**
 * Custom Cloudflare Worker entry (S-05, Phase 5). OpenNext generates
 * `.open-next/worker.js` with a `fetch` handler (and the incremental-cache
 * Durable Object classes) but no `scheduled` handler. Cron Triggers need a
 * `scheduled` export, so `wrangler.jsonc`'s `main` points HERE: we re-export the
 * generated `fetch` (preserving the entire Next request path) and the DO classes
 * verbatim, and add a `scheduled` handler that runs the 15-min sync cycle.
 *
 * The `.open-next/worker.js` import resolves at wrangler bundle time (the build
 * generates it first); tsc can't see the artifact, hence the `@ts-expect-error`s.
 */

// @ts-expect-error — build artifact, resolved by wrangler at bundle time.
import generated from "../.open-next/worker.js";
// @ts-expect-error — re-export the OpenNext Durable Object classes verbatim so
// their wrangler bindings still resolve against this custom entry.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

import { runScheduledSync } from "@/lib/integrations/sync/scheduled";

type Env = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
  GITHUB_API_BASE_URL?: string;
  JIRA_API_BASE_URL?: string;
};

type ExecCtx = { waitUntil: (promise: Promise<unknown>) => void };
type FetchHandler = (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;

const fetchHandler = (generated as { fetch: FetchHandler }).fetch;

const handler = {
  fetch: fetchHandler,
  async scheduled(_controller: unknown, env: Env, ctx: ExecCtx): Promise<void> {
    // Run the whole cycle under waitUntil so the isolate stays alive until the
    // sync (and the pool teardown scheduled inside it) resolves.
    ctx.waitUntil(runScheduledSync(env, ctx));
  },
};

export default handler;
