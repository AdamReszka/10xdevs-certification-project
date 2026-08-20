import { describe, expect, it } from "vitest";

import {
  JiraAuthError,
  JiraUnavailableError,
  type JiraStatus,
  listProjects,
  listProjectStatuses,
  normalizeWorkspaceUrl,
  suggestCategory,
  validateCredentials,
} from "@/lib/jira";

/**
 * Unit suite for the Jira `fetch` client (`src/lib/jira.ts`).
 *
 * Hermetic: the HTTP edge is mocked via the injectable `fetchImpl` — no network,
 * no real credentials. We assert the two typed-error boundaries (401 ⇒ auth,
 * everything-else ⇒ unavailable), Basic-auth header construction, `nextPage`
 * pagination assembly + the cap + the cross-origin guard (F2), status dedupe,
 * `suggestCategory` (name-first with native fallback, F3), and — the load-bearing
 * security assertion — that the credentials never appear in a thrown error.
 */

const EMAIL = "lead@example.com";
const TOKEN = "jira_secret_token_do_not_leak_1234";
const BASE = "https://acme.atlassian.net";
const CREDS = { email: EMAIL, token: TOKEN };

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

describe("normalizeWorkspaceUrl", () => {
  it("collapses bare, host, and full-URL inputs to one origin", () => {
    expect(normalizeWorkspaceUrl("acme")).toBe("https://acme.atlassian.net");
    expect(normalizeWorkspaceUrl("acme.atlassian.net")).toBe(
      "https://acme.atlassian.net",
    );
    expect(normalizeWorkspaceUrl("https://acme.atlassian.net/jira?x=1")).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("rejects a non-Jira-Cloud host", () => {
    expect(() => normalizeWorkspaceUrl("https://evil.example.com")).toThrow();
  });

  it("rejects an empty input", () => {
    expect(() => normalizeWorkspaceUrl("   ")).toThrow();
  });
});

describe("validateCredentials", () => {
  it("parses accountId, email and displayName on 200", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        accountId: "5b10a2",
        emailAddress: "mia@example.com",
        displayName: "Mia Krystof",
      }),
    );

    const result = await validateCredentials(BASE, CREDS, { fetchImpl });

    expect(result.accountId).toBe("5b10a2");
    expect(result.emailAddress).toBe("mia@example.com");
    expect(result.displayName).toBe("Mia Krystof");
  });

  it("sends HTTP Basic auth + JSON accept to {base}/rest/api/3/myself", async () => {
    let seen: Headers | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seen = new Headers(init?.headers);
      return jsonResponse({ accountId: "5b10a2" });
    }) as unknown as typeof fetch;

    await validateCredentials(BASE, CREDS, { fetchImpl });

    const expectedBasic = Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64");
    expect(seenUrl).toBe(`${BASE}/rest/api/3/myself`);
    expect(seen?.get("authorization")).toBe(`Basic ${expectedBasic}`);
    expect(seen?.get("accept")).toBe("application/json");
  });

  it("throws JiraAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Unauthorized" }, { status: 401 }));

    await expect(validateCredentials(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  it("throws JiraUnavailableError on 5xx", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "server error" }, { status: 503 }));

    await expect(validateCredentials(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("maps a network/transport failure to JiraUnavailableError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(validateCredentials(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("never includes the token in a thrown error (auth path)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Unauthorized" }, { status: 401 }));

    const err = await validateCredentials(BASE, CREDS, { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(err.message).not.toContain(TOKEN);
  });

  it("never includes the token in a thrown error (network path)", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connection to ${TOKEN}@host failed`);
    }) as unknown as typeof fetch;

    const err = await validateCredentials(BASE, CREDS, { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("listProjects", () => {
  it("maps id → jiraProjectId (as string), key and name", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        isLast: true,
        values: [
          { id: 10000, key: "EX", name: "Example" },
          { id: "10001", key: "SF", name: "SprintFlow" },
        ],
      }),
    );

    const projects = await listProjects(BASE, CREDS, { fetchImpl });

    expect(projects).toEqual([
      { jiraProjectId: "10000", key: "EX", name: "Example" },
      { jiraProjectId: "10001", key: "SF", name: "SprintFlow" },
    ]);
  });

  it("follows nextPage and assembles multi-page results", async () => {
    const page2Url = `${BASE}/rest/api/3/project/search?startAt=1&maxResults=50`;
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({
        isLast: false,
        nextPage: page2Url,
        values: [{ id: 1, key: "A", name: "One" }],
      }),
      jsonResponse({
        isLast: true,
        values: [{ id: 2, key: "B", name: "Two" }],
      }),
    ]);

    const projects = await listProjects(BASE, CREDS, { fetchImpl });

    expect(projects).toEqual([
      { jiraProjectId: "1", key: "A", name: "One" },
      { jiraProjectId: "2", key: "B", name: "Two" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(page2Url);
  });

  it("rejects a cross-origin nextPage without refetching it (F2)", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({
        isLast: false,
        nextPage: "https://evil.example.com/rest/api/3/project/search?startAt=1",
        values: [{ id: 1, key: "A", name: "One" }],
      }),
    ]);

    await expect(listProjects(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
    // The hostile page was never refetched with the credentials.
    expect(calls).toHaveLength(1);
  });

  it("caps the page count on an unbounded nextPage chain", async () => {
    // Every page points forward on the same origin — the cap must break the loop.
    const selfNext = `${BASE}/rest/api/3/project/search?startAt=x`;
    const fetchImpl = (async () =>
      jsonResponse({
        isLast: false,
        nextPage: selfNext,
        values: [],
      })) as unknown as typeof fetch;

    await expect(listProjects(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("throws JiraUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    await expect(listProjects(BASE, CREDS, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listProjects(BASE, CREDS, { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("listProjectStatuses", () => {
  it("flattens issue types and dedupes statuses by id", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        {
          id: "1",
          name: "Story",
          statuses: [
            { id: "10", name: "To Do", statusCategory: { key: "new" } },
            { id: "11", name: "In Progress", statusCategory: { key: "indeterminate" } },
          ],
        },
        {
          id: "2",
          name: "Bug",
          statuses: [
            // Duplicate of id 11 under a second issue type — must be deduped.
            { id: "11", name: "In Progress", statusCategory: { key: "indeterminate" } },
            { id: "12", name: "Done", statusCategory: { key: "done" } },
          ],
        },
      ]),
    );

    const statuses = await listProjectStatuses(BASE, CREDS, "SF", { fetchImpl });

    expect(statuses).toEqual([
      { jiraStatusId: "10", jiraStatusName: "To Do", nativeCategoryKey: "new" },
      { jiraStatusId: "11", jiraStatusName: "In Progress", nativeCategoryKey: "indeterminate" },
      { jiraStatusId: "12", jiraStatusName: "Done", nativeCategoryKey: "done" },
    ]);
  });

  it("tolerates a missing statusCategory (F3)", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { id: "1", name: "Story", statuses: [{ id: "10", name: "Backlog" }] },
      ]),
    );

    const statuses = await listProjectStatuses(BASE, CREDS, "SF", { fetchImpl });

    expect(statuses).toEqual([
      { jiraStatusId: "10", jiraStatusName: "Backlog", nativeCategoryKey: undefined },
    ]);
  });

  it("throws JiraUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 404 }));

    await expect(
      listProjectStatuses(BASE, CREDS, "SF", { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraUnavailableError);
  });
});

describe("suggestCategory", () => {
  const withName = (jiraStatusName: string, nativeCategoryKey?: JiraStatus["nativeCategoryKey"]): JiraStatus => ({
    jiraStatusId: "x",
    jiraStatusName,
    nativeCategoryKey,
  });

  it("maps by name first, covering the two categories Jira can't express", () => {
    expect(suggestCategory(withName("In Review"))).toBe("CODE_REVIEW");
    expect(suggestCategory(withName("Code Review"))).toBe("CODE_REVIEW");
    expect(suggestCategory(withName("Waiting for QA"))).toBe("TESTING");
    expect(suggestCategory(withName("Testing"))).toBe("TESTING");
    expect(suggestCategory(withName("In Progress"))).toBe("IN_PROGRESS");
    expect(suggestCategory(withName("Done"))).toBe("DONE");
    expect(suggestCategory(withName("Backlog"))).toBe("TODO");
  });

  it("name wins over the coarse native seed (Review with indeterminate → CODE_REVIEW)", () => {
    expect(suggestCategory(withName("In Review", "indeterminate"))).toBe("CODE_REVIEW");
    expect(suggestCategory(withName("QA", "indeterminate"))).toBe("TESTING");
  });

  it("falls back to the native category when the name is uninformative", () => {
    expect(suggestCategory(withName("Zzz", "indeterminate"))).toBe("IN_PROGRESS");
    expect(suggestCategory(withName("Zzz", "done"))).toBe("DONE");
    expect(suggestCategory(withName("Zzz", "new"))).toBe("TODO");
  });

  it("defaults to TODO when neither name nor native category is informative (F3)", () => {
    expect(suggestCategory(withName("Zzz"))).toBe("TODO");
  });
});
