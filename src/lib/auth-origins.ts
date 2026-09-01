/**
 * Which origins Better Auth accepts (FR-001). PURE — no I/O, no clock, no env
 * read of its own; the caller passes what it found.
 *
 * ## Why this is a module and not one line in `auth.ts`
 *
 * It used to be one line: `trustedOrigins: baseURL ? [baseURL] : []`, where
 * `baseURL` is the `BETTER_AUTH_URL` secret. That made the entire origin check
 * hang on ONE env value, and on 2026-09-01 that value was still pointing at
 * `localhost` after the production domain was attached. The result was not a
 * clean failure:
 *
 *  - Every browser sign-up and sign-in on `https://sprintflow.pl` returned
 *    **403 `INVALID_ORIGIN`**.
 *  - The same request sent with `curl` **succeeded**, because Better Auth's
 *    Fetch Metadata check only engages when the request carries `Sec-Fetch-*`
 *    headers — which every browser sends and no `curl` invocation does unless
 *    you add them by hand. Without them, `getBaseURL(…, request)` derives the
 *    base URL from the request itself and the request's own origin is trusted.
 *
 * So the symptom ("works from the terminal, 403 from the browser") pointed
 * nowhere near the cause, and the blast radius of one wrong string was the whole
 * domain's authentication.
 *
 * ## The rule that follows
 *
 * The product's OWN hostnames are not a secret and must not be reachable only
 * through one. They are compiled in, so a missing or stale `BETTER_AUTH_URL`
 * degrades to "the reset email links are wrong" — visible, recoverable — instead
 * of "nobody can sign in", which is neither.
 *
 * `BETTER_AUTH_URL` stays authoritative for {@link ../auth.ts}'s `baseURL` (the
 * absolute URLs in recap and password-reset emails still come from it, see
 * `recap/send.ts`); this module only stops it being the sole source of TRUST.
 *
 * ## What is deliberately NOT here
 *
 * No wildcard for `*.workers.dev`. It would trust every Worker on the platform,
 * including other people's, for the sake of preview URLs this project does not
 * use — `.github/workflows/` has no preview-deploy job, and the one workers.dev
 * host that exists is named explicitly below.
 */

/** The production domain. Both hosts, because `www` exists in DNS and redirects
 *  to the apex at the Cloudflare edge — if that redirect is ever removed, auth
 *  does not silently break with it. */
const PRODUCTION_ORIGINS = [
  "https://sprintflow.pl",
  "https://www.sprintflow.pl",
] as const;

/** The Worker's own `workers.dev` hostname, named rather than wildcarded. It is
 *  what `wrangler deploy` publishes to and the only URL available when the
 *  custom domain is misconfigured — which is exactly when you need to sign in to
 *  check. */
const WORKERS_DEV_ORIGIN =
  "https://10xdevs-certification-project.adam-reszka85.workers.dev";

/** `next dev` (`npm run dev`) and the Playwright fixture ports. Loopback only —
 *  these can never be reached from another machine. */
const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3098",
  "http://localhost:3099",
] as const;

export type AuthOriginEnv = {
  /** The canonical absolute URL, also used as Better Auth's `baseURL`. */
  BETTER_AUTH_URL?: string;
  /**
   * Comma-separated extra origins. The escape hatch that needs no deploy: a new
   * domain can be trusted with `wrangler secret put` alone. Entries that are not
   * parseable absolute URLs are dropped rather than throwing — a typo here must
   * not take the auth endpoint down, which is the failure this whole module
   * exists to prevent.
   */
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
};

/**
 * The origins Better Auth should trust, de-duplicated and order-stable.
 *
 * Order is: compiled-in production, the Worker's own hostname, loopback, then
 * whatever the environment adds. Stable so a test can assert on it and a human
 * can diff two deployments.
 */
export function resolveTrustedOrigins(env?: AuthOriginEnv): string[] {
  const fromEnv = (env?.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const candidates = [
    ...PRODUCTION_ORIGINS,
    WORKERS_DEV_ORIGIN,
    ...LOCAL_ORIGINS,
    ...(env?.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []),
    ...fromEnv,
  ];

  const seen = new Set<string>();
  const origins: string[] = [];

  for (const candidate of candidates) {
    // Normalised to a bare origin: Better Auth compares `new URL(req).origin`,
    // so a trailing slash or a path on a configured value would never match and
    // would fail exactly as silently as the defect above.
    const origin = toOrigin(candidate);
    if (origin === null || seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }

  return origins;
}

/** `https://app.test/callback` → `https://app.test`; anything unparseable → null.
 *  Never throws: a malformed env value is dropped, not propagated. */
function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
