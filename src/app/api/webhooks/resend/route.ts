import { getCloudflareContext } from "@opennextjs/cloudflare";

import { getDbWithPool } from "@/lib/db";
import { disableRecapForAddress, parseResendEvent } from "@/lib/recap/webhook";
import {
  WebhookConfigError,
  resolveWebhookSecret,
  verifyResendSignature,
} from "@/lib/recap/webhook-signature";

/**
 * Resend bounce/complaint webhook (S-12 Phase 4, closing S-11 plan-review F6).
 *
 * THE ONLY PUBLIC, UNAUTHENTICATED, INTERNET-REACHABLE ROUTE IN THIS REPO.
 * `middleware.ts` lets it through by prefix; the signature check IS the security
 * boundary and there is nothing else behind it. Read `webhook-signature.ts`
 * before changing anything here.
 *
 * No `runtime` and no `dynamic` export, matching the only other route handler
 * (`api/auth/[...all]/route.ts`). `getCloudflareContext()` is called INSIDE the
 * handler for the reason recorded there: Workers expose no env at module scope.
 *
 * ORDER IS LOAD-BEARING, and it is the reason the database work is last:
 *
 *   1. resolve the secret — missing is a 500 and returns BEFORE any database
 *      work (`lessons.md` #6: a precondition that cannot improve on retry is
 *      checked before anything is persisted);
 *   2. verify the signature over the RAW body — bad or absent is a 401;
 *   3. only now open a pool, parse, act, and answer 200.
 *
 * The pool is acquired AFTER the signature verifies, not at the top the way
 * `scheduled.ts:92` does (plan-review F5). A handle opened first would cost a
 * Hyperdrive connection for every forged request anyone on the internet cared to
 * send, and the 500 and 401 paths have no database work to do at all.
 *
 * IT IS A POOL THIS ROUTE OWNS (`getDbWithPool`), not the request-scoped handle.
 * The webhook does run inside a request context and could share the memoized one
 * (lesson #3); it takes a separate, self-closed pool because the disable fan-out
 * is long-running. **Never call `.end()` on a handle that came from `getDb`.**
 */

/** Ignorable events and unknown addresses are 200s — see below. */
const OK = () => new Response(null, { status: 200 });

export async function POST(request: Request) {
  const { env, ctx } = getCloudflareContext();

  const secret = resolveWebhookSecret(env as { RESEND_WEBHOOK_SECRET?: string });
  if (!secret) {
    // 500, not 401: this is OUR misconfiguration, and Resend retries a 5xx —
    // which is what we want once the secret is provisioned. The message goes to
    // the operator log, never to the caller.
    console.error(new WebhookConfigError().message);
    return new Response(null, { status: 500 });
  }

  // The RAW bytes, read exactly once. `await request.json()` here and
  // re-serializing for the verifier changes key order and whitespace, and every
  // signature then fails — the single most common way this is got wrong.
  const body = await request.text();

  const verified = verifyResendSignature({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
  });

  if (!verified.ok) {
    // The fixed reason code, never the body and never the headers.
    console.warn(`resend webhook: rejected (${verified.reason})`);
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    // Signed but not JSON. Whoever holds our signing secret sent nonsense;
    // retrying will not fix it, so 400 rather than 500.
    return new Response(null, { status: 400 });
  }

  const event = parseResendEvent(payload);
  if (event.kind === "ignore") {
    // 200, deliberately. Resend delivers every subscribed event type and an
    // endpoint that errors on one it does not handle teaches the provider to
    // retry it forever.
    return OK();
  }

  const { db, pool } = getDbWithPool(env);
  try {
    const result = await disableRecapForAddress({
      db,
      addresses: event.addresses,
      reason: event.reason,
    });
    // A COUNT, never the address — the recipient is personal data and must not
    // reach an operator log (the rule `email.ts:19-23` states for the API key).
    console.log(`resend webhook: ${event.reason} disabled ${result.matched} owner(s)`);
    return OK();
  } finally {
    // Safe because this pool came from `getDbWithPool` and this route owns it:
    // closed after the queries resolve, never at construction. The request's own
    // memoized handle (`lessons.md` #3) must never be closed this way.
    ctx.waitUntil(pool.end());
  }
}
