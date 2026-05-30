import { getCloudflareContext } from "@opennextjs/cloudflare";
import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth";

// Catch-all for every Better Auth endpoint under /api/auth/*.
//
// The auth instance is built *per request* from getCloudflareContext().env — do
// NOT use the top-level `export const { POST, GET } = toNextJsHandler(auth)`
// form: it evaluates `auth` at module load (before any request/env exists) and
// would cache a request-scoped Hyperdrive pg connection across Worker
// invocations. See plan Critical Implementation Details.

export async function POST(request: Request) {
  const { env } = getCloudflareContext();
  return toNextJsHandler(createAuth(env)).POST(request);
}

export async function GET(request: Request) {
  const { env } = getCloudflareContext();
  return toNextJsHandler(createAuth(env)).GET(request);
}
