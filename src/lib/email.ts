/**
 * Workers-native Resend client (S-11). Sends one message via
 * `POST https://api.resend.com/emails` using raw `fetch` — no `resend` SDK, for
 * the same reason `github.ts` skips Octokit: the Node-shaped SDK pulls in
 * globals that are awkward at Workers module scope, and this is a single POST.
 *
 * Injectable `baseUrl` + `fetchImpl` are the seam that makes this mockable from
 * the unit tests without a network. The `RESEND_API_BASE_URL` override that
 * feeds `baseUrl` lives in `email-transport.ts` behind a production guard —
 * never honour one here.
 *
 * `lessons.md` #4 (cap and origin-check server-directed pagination loops that
 * carry a secret) is **N/A** for this module: there is exactly one request to a
 * caller-independent URL, no `Link: rel="next"` to follow, and nothing the
 * response can redirect us to. Stated explicitly rather than left implicit, the
 * way `github.ts:646-647` and `jira.ts:706-709` do for their own single-resource
 * calls.
 *
 * SECURITY: the API key is a bearer secret. It is sent only in the
 * `Authorization` header and NEVER placed in a thrown error, a log line, or a
 * return value. The response BODY is never interpolated into an error either —
 * a provider echoing the request back would otherwise leak it into a stack.
 */

const DEFAULT_BASE_URL = "https://api.resend.com";
const USER_AGENT = "SprintFlow";

/** Injectable transport + endpoint, so the client is unit-testable offline. */
export type EmailClientOpts = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** One outbound message. `html` and `text` are both required — see `render.ts`. */
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Resend returns the ORIGINAL result for a repeated key, which is what stops a
   * retry after an accepted-then-dropped response from mailing twice.
   *
   * The payload must be byte-identical across attempts: a repeated key carrying
   * a different body is rejected with `409 invalid_idempotent_request`. Callers
   * therefore freeze the rendered bytes before the first send (S-11 stores them
   * on the claim row) rather than re-rendering per attempt. Keys expire after 24h.
   */
  idempotencyKey?: string;
  /**
   * Extra headers on the message itself (the recap sets `List-Unsubscribe`).
   * Cannot clobber `Authorization` — see `emailHeaders`.
   */
  headers?: Record<string, string>;
};

/**
 * Resend rejected the API key (401). Distinct from the two below so a caller can
 * tell a misconfigured key from a transient outage. **Never carries the key.**
 */
export class EmailAuthError extends Error {
  constructor(message = "Resend rejected the API key (invalid or revoked).") {
    super(message);
    this.name = "EmailAuthError";
  }
}

/**
 * Resend could not be reached, or answered with something that may succeed later
 * (429 rate limit, 5xx, network/timeout, an unreadable body). **RETRYABLE** — the
 * recap leaves the row claimable and tries again on a later tick.
 * **Never carries the key.**
 */
export class EmailUnavailableError extends Error {
  constructor(message = "Could not reach Resend. Please try again.") {
    super(message);
    this.name = "EmailUnavailableError";
  }
}

/**
 * Every other non-2xx — the request itself is wrong and will stay wrong.
 * **NOT retryable.**
 *
 * This branch is load-bearing, not defensive padding: Resend's documented set for
 * this endpoint reaches well past 401/429/5xx — `400 invalid_idempotency_key`,
 * `403` (the missing-`User-Agent` case), `409 invalid_idempotent_request`,
 * `409 concurrent_idempotent_requests`, `422` (unverified sender). Without it
 * they would be mistaken for transient and burn all three of the day's attempts
 * against a misconfiguration that can never succeed.
 *
 * Carries `status` as a FIELD so callers can branch on it (the recap treats
 * `409 concurrent_idempotent_requests` as "in flight, come back later" rather
 * than as a failure). **Never carries the key**, and never the response body.
 */
export class EmailRequestError extends Error {
  readonly status: number;

  /**
   * The provider's machine-readable error name, populated for 409 ONLY.
   *
   * A deliberate, narrow exception to "the response body is never read on an
   * error path". Two 409s mean opposite things —
   * `concurrent_idempotent_requests` is "another attempt is in flight, come back
   * later", `invalid_idempotent_request` is "this key already carried a
   * different payload" and is permanent — and the status alone cannot tell them
   * apart. Conflating them leaves the day's row stuck `PENDING` forever.
   *
   * Only this one enum-ish field crosses over. It is NEVER interpolated into
   * `message`, never attached as `cause`, and no other status reads the body.
   * Do not widen this.
   */
  readonly code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `Resend refused the request (HTTP ${status}).`);
    this.name = "EmailRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Resend's name for a 409 whose first request has not settled yet. */
export const CONCURRENT_IDEMPOTENT_REQUESTS = "concurrent_idempotent_requests";

/**
 * Headers for the single authenticated POST.
 *
 * Caller-supplied headers are spread FIRST so `Authorization` / `Content-Type` /
 * `User-Agent` always win. A caller cannot redirect the key onto a header of
 * their choosing, or blank it out.
 */
function emailHeaders(apiKey: string, extra?: Record<string, string>): HeadersInit {
  return {
    ...(extra ?? {}),
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // Resend answers 403 (error 1010) to requests with no User-Agent. The
    // official SDKs set it automatically; a raw-fetch client must do it itself.
    "User-Agent": USER_AGENT,
  };
}

/**
 * Read ONLY the `name` field, and ONLY for a 409. See `EmailRequestError.code`.
 *
 * Everything else about the body is discarded unread, including on failure to
 * parse — a provider that echoed the request back must not be able to put the
 * API key anywhere near an error surface.
 */
async function readErrorCode(res: Response): Promise<string | undefined> {
  if (res.status !== 409) return undefined;
  try {
    const body = (await res.json()) as { name?: unknown } | null;
    return typeof body?.name === "string" ? body.name : undefined;
  } catch {
    return undefined;
  }
}

/** The provider message id — S-12's recap history wants it. */
export type SendEmailResult = { id: string };

export async function sendEmail(
  apiKey: string,
  message: EmailMessage,
  opts?: EmailClientOpts,
): Promise<SendEmailResult> {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts?.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    ...(emailHeaders(apiKey, message.headers) as Record<string, string>),
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers ? { headers: message.headers } : {}),
      }),
    });
  } catch {
    // Network-level failure (offline, DNS, timeout). The caught error is
    // deliberately NOT attached as `cause` (`github.ts:104-106`): its message
    // could echo the request, and we never risk the key surfacing in a stack.
    throw new EmailUnavailableError(
      "Could not reach Resend (network error). Please try again.",
    );
  }

  if (res.status === 401) throw new EmailAuthError();
  if (res.status === 429 || res.status >= 500) {
    throw new EmailUnavailableError(
      `Resend is temporarily unavailable (HTTP ${res.status}). Please try again.`,
    );
  }
  if (!res.ok) throw new EmailRequestError(res.status, await readErrorCode(res));

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Accepted, but we cannot read what it said. Retryable rather than fatal:
    // the idempotency key makes a replay safe, and the alternative is losing the
    // day's recap to a parse error.
    throw new EmailUnavailableError(
      "Resend returned an unreadable response. Please try again.",
    );
  }

  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new EmailUnavailableError(
      "Resend returned no message id. Please try again.",
    );
  }
  return { id };
}
