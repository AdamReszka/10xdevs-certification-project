import { describe, expect, it } from "vitest";

import { resolveTrustedOrigins } from "@/lib/auth-origins";

/**
 * The regression suite for the 2026-09-01 production incident: browser sign-up
 * returned 403 `INVALID_ORIGIN` on `https://sprintflow.pl` for as long as the
 * `BETTER_AUTH_URL` secret pointed somewhere else, because the trusted-origin
 * list was that one value and nothing else.
 *
 * The first case is the whole point of the module and must never be deleted:
 * **with the environment empty, production is still trusted.**
 */

const PRODUCTION = "https://sprintflow.pl";

describe("resolveTrustedOrigins", () => {
  it("trusts production with NO environment at all", () => {
    // `lessons.md`: test the no-configuration path through the real resolver.
    // This is the state a fresh Worker meets when a secret was never set, and
    // the state the incident actually ran in — a wrong value is not worse than
    // a missing one here, and neither may take the domain down.
    expect(resolveTrustedOrigins()).toContain(PRODUCTION);
    expect(resolveTrustedOrigins({})).toContain(PRODUCTION);
  });

  it("trusts production when BETTER_AUTH_URL points somewhere else entirely", () => {
    // The incident, exactly: the secret still said localhost after the custom
    // domain was attached.
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "http://localhost:3000",
    });

    expect(origins).toContain(PRODUCTION);
    expect(origins).toContain("http://localhost:3000");
  });

  it("trusts the www host as well as the apex", () => {
    // `www` redirects to the apex at the Cloudflare edge today. If that rule is
    // ever removed, auth must not break silently along with it.
    expect(resolveTrustedOrigins()).toContain("https://www.sprintflow.pl");
  });

  it("trusts the Worker's own workers.dev hostname", () => {
    // The only URL that still answers when the custom domain is misconfigured —
    // which is precisely when someone needs to sign in and look.
    expect(resolveTrustedOrigins()).toContain(
      "https://10xdevs-certification-project.adam-reszka85.workers.dev",
    );
  });

  it("trusts the local dev and Playwright fixture origins", () => {
    const origins = resolveTrustedOrigins();

    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3098");
    expect(origins).toContain("http://localhost:3099");
  });

  it("adds BETTER_AUTH_URL's origin when it is a new one", () => {
    expect(
      resolveTrustedOrigins({ BETTER_AUTH_URL: "https://staging.sprintflow.pl" }),
    ).toContain("https://staging.sprintflow.pl");
  });

  it("normalises a configured value to a bare origin", () => {
    // Better Auth compares `new URL(request).origin`, so a trailing slash or a
    // path would never match — and would fail as silently as the defect this
    // module exists to prevent.
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://staging.sprintflow.pl/api/auth/",
    });

    expect(origins).toContain("https://staging.sprintflow.pl");
    expect(origins).not.toContain("https://staging.sprintflow.pl/api/auth/");
  });

  it("reads a comma-separated extra list, trimming whitespace", () => {
    // The escape hatch: a new domain becomes trustable with `wrangler secret
    // put` alone, without a deploy.
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_TRUSTED_ORIGINS: " https://a.example , https://b.example ",
    });

    expect(origins).toContain("https://a.example");
    expect(origins).toContain("https://b.example");
  });

  it("DROPS an unparseable entry instead of throwing", () => {
    // A typo in a secret must not take the auth endpoint down. That failure
    // mode — one bad string, no sign-ins — is the whole reason this file exists.
    expect(() =>
      resolveTrustedOrigins({
        BETTER_AUTH_URL: "not a url",
        BETTER_AUTH_TRUSTED_ORIGINS: "also-not-a-url,,   ,https://ok.example",
      }),
    ).not.toThrow();

    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "not a url",
      BETTER_AUTH_TRUSTED_ORIGINS: "also-not-a-url,,   ,https://ok.example",
    });

    expect(origins).toContain(PRODUCTION);
    expect(origins).toContain("https://ok.example");
    expect(origins).not.toContain("not a url");
    expect(origins).not.toContain("also-not-a-url");
  });

  it("de-duplicates without reordering", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: PRODUCTION,
      BETTER_AUTH_TRUSTED_ORIGINS: `${PRODUCTION},https://www.sprintflow.pl`,
    });

    expect(origins.filter((o) => o === PRODUCTION)).toHaveLength(1);
    expect(origins.filter((o) => o === "https://www.sprintflow.pl")).toHaveLength(1);
    expect(origins[0]).toBe(PRODUCTION);
  });

  it("never returns an empty list", () => {
    // The state that produced the incident. `[]` means "trust nothing", which
    // Better Auth honours to the letter.
    for (const env of [
      undefined,
      {},
      { BETTER_AUTH_URL: "" },
      { BETTER_AUTH_TRUSTED_ORIGINS: "" },
      { BETTER_AUTH_URL: "garbage", BETTER_AUTH_TRUSTED_ORIGINS: "garbage" },
    ]) {
      expect(resolveTrustedOrigins(env).length).toBeGreaterThan(0);
    }
  });
});
