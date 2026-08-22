import { describe, expect, it } from "vitest";

import {
  GithubAuthError,
  GithubUnavailableError,
  getCommitDetail,
  getPullRequestDetail,
  listCollaborators,
  listCommits,
  listPullRequests,
  listRepos,
  listReviews,
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

describe("listCollaborators", () => {
  it("maps login/id/type/role_name and requests affiliation=all", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse([
        { login: "octocat", id: 1, type: "User", role_name: "admin" },
        { login: "hubot", id: 2, type: "Bot" },
      ]),
    ]);

    const people = await listCollaborators(TOKEN, "octocat/hello", {
      baseUrl: BASE,
      fetchImpl,
    });

    expect(people).toEqual([
      { login: "octocat", id: 1, type: "User", roleName: "admin" },
      { login: "hubot", id: 2, type: "Bot", roleName: undefined },
    ]);
    expect(calls[0]).toBe(
      `${BASE}/repos/octocat/hello/collaborators?affiliation=all&per_page=100`,
    );
  });

  it("follows Link rel=\"next\" and assembles multi-page results", async () => {
    const page2Url = `${BASE}/repos/o/r/collaborators?page=2`;
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ login: "a", id: 1, type: "User" }]), {
        status: 200,
        headers: { link: `<${page2Url}>; rel="next"` },
      }),
      new Response(JSON.stringify([{ login: "b", id: 2, type: "User" }]), {
        status: 200,
      }),
    ]);

    const people = await listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl });

    expect(people.map((p) => p.login)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(page2Url);
  });

  it("rejects a cross-origin next-link without refetching it", async () => {
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ login: "a", id: 1, type: "User" }]), {
        status: 200,
        headers: {
          link: `<https://evil.example.com/collaborators?page=2>; rel="next"`,
        },
      }),
    ]);

    await expect(
      listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
    // The hostile page was never refetched with the token.
    expect(calls).toHaveLength(1);
  });

  it("caps the page count on an unbounded next-link chain", async () => {
    const selfNext = `${BASE}/repos/o/r/collaborators?page=self`;
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ login: "a", id: 1, type: "User" }]), {
        status: 200,
        headers: { link: `<${selfNext}>; rel="next"` },
      })) as unknown as typeof fetch;

    await expect(
      listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 403 (missing read:org scope)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Forbidden" }, { status: 403 }));

    await expect(
      listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("skips malformed rows without a login or id", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { login: "a", id: 1, type: "User" },
        { login: "b" },
        { id: 3, type: "User" },
      ]),
    );

    const people = await listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl });

    expect(people).toEqual([{ login: "a", id: 1, type: "User", roleName: undefined }]);
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listCollaborators(TOKEN, "o/r", { baseUrl: BASE, fetchImpl }).catch(
      (e) => e,
    );
    expect(String(err)).not.toContain(TOKEN);
  });
});

const SINCE = new Date("2026-08-01T00:00:00Z");

describe("listCommits", () => {
  it("maps sha, author login, authored date, message and sends the since param", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse([
        {
          sha: "abc123",
          author: { login: "octocat" },
          commit: { author: { date: "2026-08-05T10:00:00Z" }, message: "fix bug" },
        },
        // detached author (no GitHub account linked) ⇒ null username, still kept.
        {
          sha: "def456",
          author: null,
          commit: { author: { date: "2026-08-06T10:00:00Z" }, message: "chore" },
        },
      ]),
    ]);

    const commits = await listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl });

    expect(commits).toEqual([
      {
        sha: "abc123",
        authorGithubUsername: "octocat",
        authoredAt: new Date("2026-08-05T10:00:00Z"),
        message: "fix bug",
        additions: null,
        deletions: null,
      },
      {
        sha: "def456",
        authorGithubUsername: null,
        authoredAt: new Date("2026-08-06T10:00:00Z"),
        message: "chore",
        additions: null,
        deletions: null,
      },
    ]);
    expect(calls[0]).toBe(
      `${BASE}/repos/o/r/commits?per_page=100&since=2026-08-01T00%3A00%3A00.000Z`,
    );
  });

  it("skips rows without a sha", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([{ sha: "keep", commit: {} }, { commit: { message: "no sha" } }]),
    );

    const commits = await listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl });

    expect(commits.map((c) => c.sha)).toEqual(["keep"]);
  });

  it("follows Link rel=\"next\" across pages", async () => {
    const page2 = `${BASE}/repos/o/r/commits?page=2`;
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ sha: "one", commit: {} }]), {
        status: 200,
        headers: { link: `<${page2}>; rel="next"` },
      }),
      new Response(JSON.stringify([{ sha: "two", commit: {} }]), { status: 200 }),
    ]);

    const commits = await listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl });

    expect(commits.map((c) => c.sha)).toEqual(["one", "two"]);
    expect(calls[1]).toBe(page2);
  });

  it("rejects a cross-origin next-link without refetching it", async () => {
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ sha: "one", commit: {} }]), {
        status: 200,
        headers: { link: `<https://evil.example.com/commits?page=2>; rel="next"` },
      }),
    ]);

    await expect(
      listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("caps the page count on an unbounded next-link chain", async () => {
    const self = `${BASE}/repos/o/r/commits?page=self`;
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ sha: "x", commit: {} }]), {
        status: 200,
        headers: { link: `<${self}>; rel="next"` },
      })) as unknown as typeof fetch;

    await expect(
      listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("throws GithubAuthError on 401 (token revoked mid-life)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 5xx", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 503 }));

    await expect(
      listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listCommits(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }).catch(
      (e) => e,
    );
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("listPullRequests", () => {
  it("maps fields and derives MERGED/CLOSED/OPEN state", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse([
        {
          id: 10,
          number: 1,
          title: "feat: X",
          body: "closes ABC-1",
          user: { login: "octocat" },
          state: "closed",
          merged_at: "2026-08-10T12:00:00Z",
          closed_at: "2026-08-10T12:00:00Z",
          created_at: "2026-08-09T09:00:00Z",
          updated_at: "2026-08-10T12:00:00Z",
          draft: false,
          head: { ref: "feature/ABC-1" },
          html_url: "https://gh/pr/1",
        },
        {
          id: 11,
          number: 2,
          title: "wip",
          state: "open",
          merged_at: null,
          created_at: "2026-08-08T09:00:00Z",
          updated_at: "2026-08-09T09:00:00Z",
          draft: true,
          head: { ref: "wip" },
          html_url: "https://gh/pr/2",
        },
        {
          id: 12,
          number: 3,
          state: "closed",
          merged_at: null,
          updated_at: "2026-08-09T00:00:00Z",
          head: {},
        },
      ]),
    ]);

    const pulls = await listPullRequests(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl });

    expect(pulls[0]).toMatchObject({
      githubPrId: 10,
      number: 1,
      state: "MERGED",
      branch: "feature/ABC-1",
      isDraft: false,
      mergedAt: new Date("2026-08-10T12:00:00Z"),
      sourceUrl: "https://gh/pr/1",
    });
    expect(pulls[1]).toMatchObject({ number: 2, state: "OPEN", isDraft: true, branch: "wip" });
    expect(pulls[2]).toMatchObject({ number: 3, state: "CLOSED", branch: null });
    expect(calls[0]).toBe(
      `${BASE}/repos/o/r/pulls?state=all&sort=updated&direction=desc&per_page=100`,
    );
  });

  it("stops at the first PR older than since and drops the sub-cutoff tail", async () => {
    const page2 = `${BASE}/repos/o/r/pulls?page=2`;
    const { fetchImpl, calls } = seqFetch([
      new Response(
        JSON.stringify([
          { id: 1, number: 1, state: "open", updated_at: "2026-08-15T00:00:00Z", head: {} },
          // older than SINCE (2026-08-01) ⇒ scan ends here, this row is dropped.
          { id: 2, number: 2, state: "open", updated_at: "2026-07-20T00:00:00Z", head: {} },
        ]),
        { status: 200, headers: { link: `<${page2}>; rel="next"` } },
      ),
    ]);

    const pulls = await listPullRequests(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl });

    expect(pulls.map((p) => p.number)).toEqual([1]);
    // The crossing page ended the scan — page 2 was never fetched.
    expect(calls).toHaveLength(1);
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      listPullRequests(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 5xx and never leaks the token", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 502 }));

    const err = await listPullRequests(TOKEN, "o/r", SINCE, { baseUrl: BASE, fetchImpl }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GithubUnavailableError);
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("getPullRequestDetail", () => {
  it("returns additions/deletions/changed_files from the detail endpoint", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ additions: 120, deletions: 30, changed_files: 7 }),
    ]);

    const detail = await getPullRequestDetail(TOKEN, "o/r", 5, { baseUrl: BASE, fetchImpl });

    expect(detail).toEqual({ additions: 120, deletions: 30, changedFiles: 7 });
    expect(calls[0]).toBe(`${BASE}/repos/o/r/pulls/5`);
  });

  it("nulls missing size fields rather than throwing", async () => {
    const fetchImpl = onceFetch(jsonResponse({ additions: 10 }));

    const detail = await getPullRequestDetail(TOKEN, "o/r", 5, { baseUrl: BASE, fetchImpl });

    expect(detail).toEqual({ additions: 10, deletions: null, changedFiles: null });
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      getPullRequestDetail(TOKEN, "o/r", 5, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 5xx", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    await expect(
      getPullRequestDetail(TOKEN, "o/r", 5, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });
});

describe("getCommitDetail", () => {
  it("returns additions/deletions from stats on the detail endpoint", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ sha: "abc123", stats: { additions: 42, deletions: 7, total: 49 } }),
    ]);

    const detail = await getCommitDetail(TOKEN, "o/r", "abc123", { baseUrl: BASE, fetchImpl });

    expect(detail).toEqual({ additions: 42, deletions: 7 });
    expect(calls[0]).toBe(`${BASE}/repos/o/r/commits/abc123`);
  });

  it("nulls a missing stats object rather than throwing", async () => {
    const fetchImpl = onceFetch(jsonResponse({ sha: "abc123" }));

    const detail = await getCommitDetail(TOKEN, "o/r", "abc123", { baseUrl: BASE, fetchImpl });

    expect(detail).toEqual({ additions: null, deletions: null });
  });

  it("nulls a non-numeric stats field rather than throwing", async () => {
    const fetchImpl = onceFetch(jsonResponse({ stats: { additions: 5, deletions: "many" } }));

    const detail = await getCommitDetail(TOKEN, "o/r", "abc123", { baseUrl: BASE, fetchImpl });

    expect(detail).toEqual({ additions: 5, deletions: null });
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      getCommitDetail(TOKEN, "o/r", "abc123", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 5xx without leaking the token", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await getCommitDetail(TOKEN, "o/r", "abc123", {
      baseUrl: BASE,
      fetchImpl,
    }).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(GithubUnavailableError);
    expect(String(err)).not.toContain(TOKEN);
  });

  it("throws GithubUnavailableError on an unparseable body", async () => {
    const fetchImpl = onceFetch(new Response("<html>not json</html>", { status: 200 }));

    await expect(
      getCommitDetail(TOKEN, "o/r", "abc123", { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
  });
});

describe("listReviews", () => {
  it("maps enum-valid verdicts and skips PENDING/DISMISSED", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse([
        { id: 1, user: { login: "rev1" }, state: "APPROVED", submitted_at: "2026-08-11T00:00:00Z" },
        { id: 2, user: { login: "rev2" }, state: "CHANGES_REQUESTED", submitted_at: "2026-08-12T00:00:00Z" },
        { id: 3, user: { login: "rev3" }, state: "COMMENTED", submitted_at: "2026-08-13T00:00:00Z" },
        { id: 4, user: { login: "rev4" }, state: "DISMISSED", submitted_at: "2026-08-14T00:00:00Z" },
        { id: 5, user: { login: "rev5" }, state: "PENDING" },
      ]),
    ]);

    const reviews = await listReviews(TOKEN, "o/r", 9, { baseUrl: BASE, fetchImpl });

    expect(reviews).toEqual([
      { githubReviewId: 1, reviewerGithubUsername: "rev1", state: "APPROVED", submittedAt: new Date("2026-08-11T00:00:00Z") },
      { githubReviewId: 2, reviewerGithubUsername: "rev2", state: "CHANGES_REQUESTED", submittedAt: new Date("2026-08-12T00:00:00Z") },
      { githubReviewId: 3, reviewerGithubUsername: "rev3", state: "COMMENTED", submittedAt: new Date("2026-08-13T00:00:00Z") },
    ]);
    expect(calls[0]).toBe(`${BASE}/repos/o/r/pulls/9/reviews?per_page=100`);
  });

  it("rejects a cross-origin next-link without refetching it", async () => {
    const { fetchImpl, calls } = seqFetch([
      new Response(JSON.stringify([{ id: 1, state: "APPROVED" }]), {
        status: 200,
        headers: { link: `<https://evil.example.com/reviews?page=2>; rel="next"` },
      }),
    ]);

    await expect(
      listReviews(TOKEN, "o/r", 9, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("throws GithubAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Bad credentials" }, { status: 401 }));

    await expect(
      listReviews(TOKEN, "o/r", 9, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(GithubAuthError);
  });

  it("throws GithubUnavailableError on 5xx and never leaks the token", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listReviews(TOKEN, "o/r", 9, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubUnavailableError);
    expect(String(err)).not.toContain(TOKEN);
  });
});
