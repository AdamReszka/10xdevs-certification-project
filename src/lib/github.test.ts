import { describe, expect, it } from "vitest";

import {
  GithubAuthError,
  GithubUnavailableError,
  listRepos,
  validatePat,
} from "@/lib/github";

/**
 * Unit suite for the GitHub `fetch` client (`src/lib/github.ts`).
 *
 * Hermetic: the HTTP edge is mocked via the injectable `fetchImpl` — no network,
 * no real token. We assert the two typed-error boundaries (401 ⇒ auth,
 * everything-else ⇒ unavailable, F5), scope/fine-grained parsing, `Link`-header
 * pagination assembly, and — the load-bearing security assertion — that the raw
 * token never appears in a thrown error.
 *
 * Mutation-hardened style (mirrors crypto.test.ts): every client call lives
 * inside an `it()`, and error paths pin the exact class + message, not just the
 * thrown type.
 */

const TOKEN = "ghp_secret_pat_value_do_not_leak_1234";
const BASE = "https://api.test";

/** Build a `fetch` stand-in that replays a fixed sequence of responses. */
function seqFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const res = responses[i];
    i += 1;
    if (!res) throw new Error(`unexpected fetch call #${i}`);
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A single-response `fetch` stand-in. */
function onceFetch(res: Response): typeof fetch {
  return seqFetch([res]).fetchImpl;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe("validatePat", () => {
  it("parses login and comma-split scopes on 200", async () => {
    const fetchImpl = onceFetch(
      jsonResponse(
        { login: "octocat" },
        { headers: { "x-oauth-scopes": "repo, read:org, user" } },
      ),
    );

    const result = await validatePat(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(result.login).toBe("octocat");
    expect(result.scopes).toEqual(["repo", "read:org", "user"]);
    expect(result.likelyFineGrained).toBe(false);
  });

  it("sends the required auth + User-Agent headers to {baseUrl}/user", async () => {
    let seen: Headers | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seen = new Headers(init?.headers);
      return jsonResponse({ login: "octocat" }, { headers: { "x-oauth-scopes": "repo" } });
    }) as unknown as typeof fetch;

    await validatePat(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(seenUrl).toBe(`${BASE}/user`);
    expect(seen?.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen?.get("user-agent")).toBe("SprintFlow");
    expect(seen?.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("flags likelyFineGrained and empty scopes when x-oauth-scopes is absent", async () => {
    const fetchImpl = onceFetch(jsonResponse({ login: "fg-user" }));

    const result = await validatePat(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(result.likelyFineGrained).toBe(true);
    expect(result.scopes).toEqual([]);
    expect(result.login).toBe("fg-user");
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(validatePat(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      GithubAuthError,
    );
  });

  it("throws GithubUnavailableError on 403 (rate-limit / missing UA)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "rate limited" }, { status: 403 }));

    const err = await validatePat(TOKEN, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubUnavailableError);
    expect(err.name).toBe("GithubUnavailableError");
  });

  it("throws GithubUnavailableError on 5xx", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "server error" }, { status: 503 }));

    await expect(validatePat(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      GithubUnavailableError,
    );
  });

  it("maps a network/transport failure to GithubUnavailableError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(validatePat(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      GithubUnavailableError,
    );
  });

  it("never includes the token in a thrown error (auth path)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    const err = await validatePat(TOKEN, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(err.message).not.toContain(TOKEN);
  });

  it("never includes the token in a thrown error (network path)", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connection to ${TOKEN}@host failed`);
    }) as unknown as typeof fetch;

    const err = await validatePat(TOKEN, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("listRepos", () => {
  it("maps id → githubRepoId and full_name → fullName", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { id: 1, full_name: "octocat/hello" },
        { id: 2, full_name: "octocat/world" },
      ]),
    );

    const repos = await listRepos(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(repos).toEqual([
      { githubRepoId: 1, fullName: "octocat/hello" },
      { githubRepoId: 2, fullName: "octocat/world" },
    ]);
  });

  it("follows Link rel=\"next\" and assembles multi-page results", async () => {
    const page2Url = `${BASE}/user/repos?page=2`;
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ id: 1, full_name: "a/one" }]), {
        status: 200,
        headers: { link: `<${page2Url}>; rel="next", <${BASE}/last>; rel="last"` },
      }),
      new Response(JSON.stringify([{ id: 2, full_name: "b/two" }]), {
        status: 200,
        // no Link header ⇒ pagination stops here.
      }),
    ]);

    const repos = await listRepos(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(repos).toEqual([
      { githubRepoId: 1, fullName: "a/one" },
      { githubRepoId: 2, fullName: "b/two" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(page2Url);
  });

  it("skips malformed rows without an id or full_name", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { id: 1, full_name: "a/one" },
        { id: "not-a-number", full_name: "b/two" },
        { full_name: "c/three" },
      ]),
    );

    const repos = await listRepos(TOKEN, { baseUrl: BASE, fetchImpl });

    expect(repos).toEqual([{ githubRepoId: 1, fullName: "a/one" }]);
  });

  it("throws GithubUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    await expect(listRepos(TOKEN, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      GithubUnavailableError,
    );
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listRepos(TOKEN, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
  });
});
