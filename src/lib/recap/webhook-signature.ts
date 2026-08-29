import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Svix/Resend webhook signature verification (S-12 Phase 4).
 *
 * THE FIRST SIGNATURE VERIFICATION IN THIS REPO. Hand-rolled on `node:crypto`
 * rather than pulling in `svix`, for the two reasons already settled elsewhere:
 * `crypto.ts:12-17` establishes synchronous `node:crypto` under `nodejs_compat`
 * as this project's crypto path, and `email.ts:1-6` establishes that a single
 * well-documented HTTP contract does not earn a vendor SDK in the Worker bundle.
 *
 * THIS IS THE ONLY AUTHENTICATION THE WEBHOOK HAS. `/api/webhooks/resend` is the
 * repo's only public, unauthenticated, internet-reachable route; everything
 * downstream of it — the address, the bounce type, the event name — comes out of
 * a body a stranger would be delighted to forge. If this function is wrong, an
 * attacker turns off any owner's recap by asserting their email address.
 *
 * SECURITY: the secret and the raw body NEVER appear in a thrown error, a log
 * line, or a return value — the invariant `email.ts:19-23` states for the API
 * key. `VerifyResult.reason` is a fixed enum, not a message built from input.
 */

/** Env surface, mirroring `crypto.ts:27-29`: Workers `env` first, Node fallback. */
export type WebhookEnv = {
  RESEND_WEBHOOK_SECRET?: string;
};

/**
 * Missing configuration, named with BOTH provisioning routes — the shape
 * `crypto.ts:56-61` uses.
 *
 * A precondition that cannot improve on the next attempt (`lessons.md` #6) is
 * checked before anything is persisted, so the route throws this before it opens
 * a database handle.
 */
export class WebhookConfigError extends Error {
  constructor() {
    super(
      "RESEND_WEBHOOK_SECRET is not set — set it as a Workers secret " +
        "(wrangler secret put RESEND_WEBHOOK_SECRET) or in .env.local for local dev. " +
        "The value is the `whsec_…` signing secret from the Resend webhook's settings page.",
    );
    this.name = "WebhookConfigError";
  }
}

/**
 * Resolve the signing secret from the Workers env first, then Node.
 *
 * A blank value is treated as absent, copying `anthropic.ts:56-60`: `wrangler
 * secret put` with an empty body and a bare `RESEND_WEBHOOK_SECRET=` line both
 * produce `""`, and an empty secret is not a secret. Collapsing the two here
 * means every caller sees one "unconfigured" shape.
 */
export function resolveWebhookSecret(env?: WebhookEnv): string | undefined {
  const raw = env?.RESEND_WEBHOOK_SECRET ?? process.env.RESEND_WEBHOOK_SECRET;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Default replay window. Svix's own recommendation is five minutes either side;
 * without a window a single captured request replays forever.
 */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

/** Why a verification failed. A fixed enum — never text built from the input. */
export type VerifyFailure =
  | "missing-headers"
  | "bad-timestamp"
  | "timestamp-out-of-tolerance"
  | "malformed-signature-header"
  | "no-matching-signature";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * Strip the `whsec_` prefix and base64-decode.
 *
 * The prefix is presentation only — it is NOT part of the key material, and
 * HMAC-ing with it included produces a signature that never matches.
 */
function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

/**
 * Constant-time compare of two base64 signatures.
 *
 * `timingSafeEqual` THROWS on unequal lengths, so the length check has to come
 * first — and it is not itself a leak: signature length is a property of the
 * algorithm, not of the secret.
 */
function signatureMatches(expected: Buffer, candidate: string): boolean {
  let given: Buffer;
  try {
    given = Buffer.from(candidate, "base64");
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/**
 * Verify a Svix-signed webhook delivery.
 *
 * Returns a discriminated result rather than throwing: a bad signature is an
 * EXPECTED input on a public endpoint — it is what the endpoint is for — and
 * modelling it as an exception would put attacker-controlled flow on the error
 * path. A missing secret is different and is the caller's job to check first,
 * via {@link resolveWebhookSecret} and {@link WebhookConfigError}.
 *
 * THE SIGNED CONTENT IS `${id}.${timestamp}.${body}` and `body` must be the RAW
 * bytes as received. Calling `request.json()` and re-serializing changes key
 * order and whitespace, and every signature then fails — the single most common
 * way this integration is got wrong.
 *
 * The `svix-signature` header may carry SEVERAL space-separated entries
 * (`v1,<base64> v1,<base64>`) because Svix rotates secrets by signing with both
 * for a window. Any one matching is a pass; entries whose scheme is not `v1` are
 * skipped rather than treated as malformed.
 */
export function verifyResendSignature({
  secret,
  id,
  timestamp,
  signature,
  body,
  now = new Date(),
  toleranceMs = DEFAULT_TOLERANCE_MS,
}: {
  secret: string;
  /** `svix-id` header. */
  id: string | null;
  /** `svix-timestamp` header — seconds since the epoch, as a string. */
  timestamp: string | null;
  /** `svix-signature` header. */
  signature: string | null;
  /** The raw request body, exactly as received. */
  body: string;
  now?: Date;
  toleranceMs?: number;
}): VerifyResult {
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing-headers" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: "bad-timestamp" };

  // BEFORE the HMAC, not after: an expired delivery is rejected on its
  // timestamp alone, so a captured request cannot be replayed indefinitely.
  // Symmetric window — a clock skewed either way is equally untrustworthy.
  if (Math.abs(now.getTime() - seconds * 1000) > toleranceMs) {
    return { ok: false, reason: "timestamp-out-of-tolerance" };
  }

  const expected = createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  let sawCandidate = false;
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma === -1) continue;
    if (entry.slice(0, comma) !== "v1") continue;
    sawCandidate = true;
    if (signatureMatches(expected, entry.slice(comma + 1))) return { ok: true };
  }

  // "Nothing to compare against" and "compared and did not match" are different
  // facts, and an operator debugging a 401 needs to tell them apart —
  // `lessons.md` #5: an empty result must not be reported as an ordinary one.
  return {
    ok: false,
    reason: sawCandidate ? "no-matching-signature" : "malformed-signature-header",
  };
}
