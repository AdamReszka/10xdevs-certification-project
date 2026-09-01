/**
 * Invisible reCAPTCHA v2 on the three unauthenticated auth endpoints (FR-001).
 * PURE — no I/O, no clock; the caller passes the env it found.
 *
 * ## Why a module and not two `env?.X` reads at the call site
 *
 * Two values, read on opposite sides of the client boundary, that are only
 * correct TOGETHER. The pairing rule below is the whole reason this is a module:
 * a form rendering a widget against a server that checks nothing, or a server
 * demanding a token no form produces, are both silent and both look like "wrong
 * password" from the outside.
 *
 * ## Fail-closed, decided deliberately (2026-09-01)
 *
 * Better Auth's handler throws `SERVICE_UNAVAILABLE` when Google cannot be
 * reached (`plugins/captcha/verify-handlers/google-recaptcha.mjs`), so an
 * outage at Google is an outage of sign-in here. That is the owner's call and
 * it is the safer one: a captcha that waves requests through under load fails
 * exactly when it is needed, and a bot can produce that load on purpose.
 *
 * ## Absent keys mean OFF, and that is not a loophole — it is the build
 *
 * The first version of this module threw whenever `NODE_ENV === "production"`
 * and no secret was set. It broke `next build` outright, proven rather than
 * predicted: `auth.ts` ends with a module-scope `export const auth =
 * createAuth()` for the schema-gen CLI, Next evaluates it while collecting page
 * data for `/api/auth/[...all]`, and a build has no Workers secrets by
 * construction — they are runtime bindings. CI's `bundle-size` job and
 * Cloudflare's Workers Builds both run that build, so the guard would have
 * failed every deploy before reaching a single user.
 *
 * `NODE_ENV` cannot separate the cases either: `npm run preview` builds and runs
 * the real production bundle on localhost, so "production" is true there too.
 *
 * So absence is silence, and the mistake actually worth catching is a HALF
 * configuration — one key set and the other forgotten. That one is unambiguous,
 * cannot occur on a machine with no keys at all, and is the realistic
 * deployment error. Whether the control is genuinely on in production is
 * answered by verifying it against production, not by a guess about NODE_ENV:
 * see `MANUAL-CHECKLIST.md`.
 *
 * ## v2 INVISIBLE, not v3
 *
 * The keys are v2 Invisible, so there is no score: `siteverify` answers
 * `success` alone. Better Auth's handler already branches on that — `isV3()`
 * tests for a `score` field and only then applies `minScore` — so `minScore`
 * is deliberately NOT set below. Setting it would suggest a threshold that
 * nothing reads.
 *
 * ## Both keys are Workers SECRETS, including the public one
 *
 * The site key is public by design — it ships in the browser. It is still
 * stored as a secret rather than a `var` because `wrangler.jsonc` records that
 * plain vars do not surface in `getCloudflareContext().env` on this OpenNext
 * version, and secrets do. A public value in a secret costs nothing; a config
 * that silently resolves to `undefined` costs the login page.
 */

/** `x-captcha-response` — the header Better Auth's plugin reads the token from
 *  (`plugins/captcha/index.mjs`). Exported so the client sends what the server
 *  expects, from one spelling rather than two string literals. */
export const CAPTCHA_HEADER = "x-captcha-response";

export type CaptchaEnv = {
  /** Public: rendered into the page. Still a secret binding — see the docblock. */
  RECAPTCHA_SITE_KEY?: string;
  /** Never leaves the server. */
  RECAPTCHA_SECRET_KEY?: string;
};

/**
 * Both keys, or neither.
 *
 * THROWS ONLY ON A HALF CONFIGURATION. A pair where one key is set and the
 * other is not can serve no working login on any environment: a server
 * demanding a token no form can produce, or a form producing a token no server
 * checks. It is always a mistake, and it is the one an operator actually makes.
 */
function assertPaired(siteKey?: string, secretKey?: string): void {
  if (Boolean(siteKey) === Boolean(secretKey)) return;
  const missing = siteKey ? "RECAPTCHA_SECRET_KEY" : "RECAPTCHA_SITE_KEY";
  const present = siteKey ? "RECAPTCHA_SITE_KEY" : "RECAPTCHA_SECRET_KEY";
  throw new Error(
    `${present} is set but ${missing} is not. Invisible reCAPTCHA needs both ` +
      `or neither — one alone yields a login form nobody can submit.`,
  );
}

function read(env: CaptchaEnv | undefined): {
  siteKey?: string;
  secretKey?: string;
} {
  return {
    siteKey: firstSet(env?.RECAPTCHA_SITE_KEY, process.env.RECAPTCHA_SITE_KEY),
    secretKey: firstSet(
      env?.RECAPTCHA_SECRET_KEY,
      process.env.RECAPTCHA_SECRET_KEY,
    ),
  };
}

/**
 * First NON-EMPTY value, not first non-nullish.
 *
 * `??` alone would treat `""` as configured, and an empty string is a value the
 * environment produces easily — a blank `.env` line, a `wrangler secret put`
 * fed nothing. It would then pass the pairing check while verifying against an
 * empty secret, which Google rejects for every request: a login page nobody can
 * submit, arriving through the one branch that was supposed to prevent exactly
 * that.
 */
function firstSet(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * The secret the Better Auth plugin verifies with, or `undefined` when captcha
 * is not configured — in which case no plugin is registered and the endpoints
 * behave exactly as they did before. That is the local-dev, unit-test,
 * Playwright and BUILD path, and all four must keep working.
 */
export function resolveCaptchaSecret(env?: CaptchaEnv): string | undefined {
  const { siteKey, secretKey } = read(env);
  assertPaired(siteKey, secretKey);
  return secretKey;
}

/**
 * The site key the form renders the widget with, or `null` when captcha is not
 * configured — the form then submits without a token and the server, having no
 * secret either, never asks for one.
 *
 * PUBLIC BY DESIGN: it ships in the browser. It is still a Workers secret rather
 * than a `var` because `wrangler.jsonc` records that plain vars do not surface
 * in `getCloudflareContext().env` on this OpenNext version.
 */
export function resolveCaptchaSiteKey(env?: CaptchaEnv): string | null {
  const { siteKey, secretKey } = read(env);
  assertPaired(siteKey, secretKey);
  return siteKey ?? null;
}
