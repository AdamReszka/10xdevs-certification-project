import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAPTCHA_HEADER,
  resolveCaptchaSecret,
  resolveCaptchaSiteKey,
} from "@/lib/captcha";

/**
 * `lessons.md`: test the no-configuration path through the REAL resolver. The
 * point of this module is what it does when the keys are absent — and the first
 * version got that wrong in a way only a real build caught, so the empty case
 * is pinned first and hardest.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("no keys configured — the local, test and BUILD path", () => {
  it("returns undefined / null instead of throwing", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. An earlier version threw whenever
    // NODE_ENV was "production" and no secret was set. `auth.ts` ends with a
    // module-scope `createAuth()`, Next evaluates it while collecting page data
    // for /api/auth/[...all], and a build has no Workers secrets by
    // construction — so `next build` failed outright, taking CI's bundle-size
    // job and Cloudflare's Workers Builds with it.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RECAPTCHA_SITE_KEY", "");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "");

    expect(resolveCaptchaSecret()).toBeUndefined();
    expect(resolveCaptchaSiteKey()).toBeNull();
    expect(resolveCaptchaSecret({})).toBeUndefined();
    expect(resolveCaptchaSiteKey({})).toBeNull();
  });

  it("stays off outside production too", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RECAPTCHA_SITE_KEY", "");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "");

    expect(resolveCaptchaSecret({})).toBeUndefined();
    expect(resolveCaptchaSiteKey({})).toBeNull();
  });
});

describe("both keys configured", () => {
  const BOTH = { RECAPTCHA_SITE_KEY: "site", RECAPTCHA_SECRET_KEY: "secret" };

  it("returns each key to its own side", () => {
    expect(resolveCaptchaSecret(BOTH)).toBe("secret");
    expect(resolveCaptchaSiteKey(BOTH)).toBe("site");
  });

  it("prefers the Workers env over process.env", () => {
    // On Workers the binding is the real source; `process.env` is the Node
    // fallback for the build and the schema-gen CLI.
    vi.stubEnv("RECAPTCHA_SITE_KEY", "from-process");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "from-process");

    expect(resolveCaptchaSiteKey(BOTH)).toBe("site");
    expect(resolveCaptchaSecret(BOTH)).toBe("secret");
  });

  it("falls back to process.env when the Workers env has neither", () => {
    vi.stubEnv("RECAPTCHA_SITE_KEY", "p-site");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "p-secret");

    expect(resolveCaptchaSiteKey({})).toBe("p-site");
    expect(resolveCaptchaSecret({})).toBe("p-secret");
  });
});

describe("half configured — the mistake an operator actually makes", () => {
  it("throws when only the site key is set", () => {
    // A form that renders a widget against a server checking nothing. Silent,
    // and indistinguishable from "captcha is working" until someone tests it.
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "");
    expect(() => resolveCaptchaSiteKey({ RECAPTCHA_SITE_KEY: "site" })).toThrow(
      /RECAPTCHA_SITE_KEY is set but RECAPTCHA_SECRET_KEY is not/,
    );
    expect(() => resolveCaptchaSecret({ RECAPTCHA_SITE_KEY: "site" })).toThrow(
      /RECAPTCHA_SITE_KEY is set but RECAPTCHA_SECRET_KEY is not/,
    );
  });

  it("throws when only the secret is set", () => {
    // The worse half: a server demanding a token no form can produce, i.e. a
    // login page nobody can submit.
    vi.stubEnv("RECAPTCHA_SITE_KEY", "");
    expect(() => resolveCaptchaSecret({ RECAPTCHA_SECRET_KEY: "s" })).toThrow(
      /RECAPTCHA_SECRET_KEY is set but RECAPTCHA_SITE_KEY is not/,
    );
    expect(() => resolveCaptchaSiteKey({ RECAPTCHA_SECRET_KEY: "s" })).toThrow(
      /RECAPTCHA_SECRET_KEY is set but RECAPTCHA_SITE_KEY is not/,
    );
  });
});

describe("an EMPTY value is not a configured value", () => {
  it("treats an empty string as absent on both sides", () => {
    // A blank `.env` line or a `wrangler secret put` fed nothing. Without this,
    // the pair passes the check and every verification fails against an empty
    // secret — a login page nobody can submit, through the very branch meant to
    // prevent it.
    expect(
      resolveCaptchaSecret({ RECAPTCHA_SITE_KEY: "", RECAPTCHA_SECRET_KEY: "" }),
    ).toBeUndefined();
    expect(
      resolveCaptchaSiteKey({ RECAPTCHA_SITE_KEY: "  ", RECAPTCHA_SECRET_KEY: "" }),
    ).toBeNull();
  });

  it("still catches a half configuration where the other half is empty", () => {
    expect(() =>
      resolveCaptchaSecret({ RECAPTCHA_SITE_KEY: "site", RECAPTCHA_SECRET_KEY: "" }),
    ).toThrow(/RECAPTCHA_SITE_KEY is set but RECAPTCHA_SECRET_KEY is not/);
  });
});

describe("CAPTCHA_HEADER", () => {
  it("is the header Better Auth's plugin reads", () => {
    // ONE spelling: the client sends this and the plugin reads it. Two literals
    // drifting apart would present as "captcha always fails", with nothing on
    // either side looking wrong.
    expect(CAPTCHA_HEADER).toBe("x-captcha-response");
  });
});
