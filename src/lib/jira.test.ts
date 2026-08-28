import { describe, expect, it } from "vitest";

import {
  JiraAuthError,
  JiraBoardNotFoundError,
  JiraRefinementInputError,
  JiraUnavailableError,
  type JiraStatus,
  getActiveSprint,
  listAssignableUsers,
  listBoards,
  listProjects,
  listProjectStatuses,
  normalizeWorkspaceUrl,
  resolveFieldIds,
  MAX_REFINEMENT_TICKETS_PER_CALL,
  fetchRefinementTickets,
  searchSprintIssues,
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

  it("surfaces the owner timeZone from /myself (F3 cadence source)", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({ accountId: "5b10a2", timeZone: "Europe/Warsaw" }),
    );

    const result = await validateCredentials(BASE, CREDS, { fetchImpl });

    expect(result.timeZone).toBe("Europe/Warsaw");
  });

  it("leaves timeZone undefined when /myself omits it", async () => {
    const fetchImpl = onceFetch(jsonResponse({ accountId: "5b10a2" }));

    const result = await validateCredentials(BASE, CREDS, { fetchImpl });

    expect(result.timeZone).toBeUndefined();
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

describe("listBoards", () => {
  it("keeps sprint-capable boards, drops kanban, and maps id/name/type", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        isLast: true,
        values: [
          { id: 1, name: "SF Scrum", type: "scrum" },
          { id: 2, name: "SF Kanban", type: "kanban" },
          { id: "3", name: "Other Scrum", type: "scrum" },
        ],
      }),
    );

    const boards = await listBoards(BASE, CREDS, "SF", { fetchImpl });

    expect(boards).toEqual([
      { id: 1, name: "SF Scrum", type: "scrum" },
      { id: 3, name: "Other Scrum", type: "scrum" },
    ]);
  });

  it("keeps a team-managed board, which reports type `simple`", async () => {
    // A team-managed (next-gen) project — the DEFAULT when creating a project in
    // Jira Cloud — reports `simple` for its board even when it runs sprints.
    // Filtering on `scrum` alone returned [], so importCadence persisted no
    // sprint and the whole dashboard stayed empty. Observed on a real project.
    const fetchImpl = onceFetch(
      jsonResponse({
        isLast: true,
        values: [{ id: 1, name: "SCRUM board", type: "simple" }],
      }),
    );

    const boards = await listBoards(BASE, CREDS, "FM", { fetchImpl });

    expect(boards).toEqual([{ id: 1, name: "SCRUM board", type: "simple" }]);
  });

  it("still drops kanban when it is the only board", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({ isLast: true, values: [{ id: 9, name: "Board", type: "kanban" }] }),
    );

    expect(await listBoards(BASE, CREDS, "SF", { fetchImpl })).toEqual([]);
  });

  it("queries the Agile base path with projectKeyOrId", async () => {
    const { fetchImpl, calls } = seqFetch([jsonResponse({ isLast: true, values: [] })]);

    await listBoards(BASE, CREDS, "SF", { fetchImpl });

    expect(calls[0]).toBe(
      `${BASE}/rest/agile/1.0/board?projectKeyOrId=SF&startAt=0&maxResults=50`,
    );
  });

  it("offset-paginates until isLast and assembles pages", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `b${i + 1}`,
      type: "scrum",
    }));
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ isLast: false, values: full }),
      jsonResponse({ isLast: true, values: [{ id: 51, name: "b51", type: "scrum" }] }),
    ]);

    const boards = await listBoards(BASE, CREDS, "SF", { fetchImpl });

    expect(boards).toHaveLength(51);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(
      `${BASE}/rest/agile/1.0/board?projectKeyOrId=SF&startAt=50&maxResults=50`,
    );
  });

  it("caps the page count on an unbounded chain", async () => {
    // Always a full page with isLast:false → the cap must break the loop.
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `b${i + 1}`,
      type: "scrum",
    }));
    const fetchImpl = (async () =>
      jsonResponse({ isLast: false, values: full })) as unknown as typeof fetch;

    await expect(listBoards(BASE, CREDS, "SF", { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("throws JiraUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    await expect(listBoards(BASE, CREDS, "SF", { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  // A PAT that `/myself` accepts can still lack Agile permission; that 401 must
  // reach the owner as "reconnect Jira", not as a rate-limit no-op.
  it("throws JiraAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "nope" }, { status: 401 }));

    await expect(listBoards(BASE, CREDS, "SF", { fetchImpl })).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listBoards(BASE, CREDS, "SF", { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("getActiveSprint", () => {
  it("returns the first active sprint mapped to id/state/name/dates", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        values: [
          {
            id: 42,
            state: "active",
            name: "Sprint 7",
            startDate: "2026-08-18T08:00:00.000Z",
            endDate: "2026-09-01T08:00:00.000Z",
          },
        ],
      }),
    );

    const sprint = await getActiveSprint(BASE, CREDS, 1, { fetchImpl });

    expect(sprint).toEqual({
      id: 42,
      state: "active",
      name: "Sprint 7",
      startDate: "2026-08-18T08:00:00.000Z",
      endDate: "2026-09-01T08:00:00.000Z",
    });
  });

  it("queries board/{id}/sprint?state=active", async () => {
    const { fetchImpl, calls } = seqFetch([jsonResponse({ values: [] })]);

    await getActiveSprint(BASE, CREDS, 7, { fetchImpl });

    expect(calls[0]).toBe(
      `${BASE}/rest/agile/1.0/board/7/sprint?state=active&maxResults=50`,
    );
  });

  it("returns null when no sprint is active (between-sprints team)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ values: [] }));

    const sprint = await getActiveSprint(BASE, CREDS, 1, { fetchImpl });

    expect(sprint).toBeNull();
  });

  it("throws JiraUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 503 }));

    await expect(getActiveSprint(BASE, CREDS, 1, { fetchImpl })).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
  });

  it("throws JiraAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "nope" }, { status: 401 }));

    await expect(getActiveSprint(BASE, CREDS, 1, { fetchImpl })).rejects.toBeInstanceOf(
      JiraAuthError,
    );
  });

  // 404 is narrower than "unavailable" on purpose: the reconciler retries with a
  // freshly discovered board on this error only, never on a 5xx or a rate limit.
  it("throws JiraBoardNotFoundError on 404 (board deleted in Jira)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "gone" }, { status: 404 }));

    await expect(getActiveSprint(BASE, CREDS, 1, { fetchImpl })).rejects.toBeInstanceOf(
      JiraBoardNotFoundError,
    );
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "gone" }, { status: 404 }));

    const err = await getActiveSprint(BASE, CREDS, 1, { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("listAssignableUsers", () => {
  it("filters to accountType=atlassian and maps the member shape", async () => {
    // A short page (2 < 50) still requires a following empty page to terminate.
    const { fetchImpl } = seqFetch([
      jsonResponse([
        {
          accountId: "a1",
          accountType: "atlassian",
          displayName: "Mia",
          emailAddress: "mia@example.com",
          active: true,
          timeZone: "Europe/Warsaw",
        },
        { accountId: "bot1", accountType: "app", displayName: "Automation" },
      ]),
      jsonResponse([]),
    ]);

    const members = await listAssignableUsers(BASE, CREDS, "SF", { fetchImpl });

    expect(members).toEqual([
      {
        accountId: "a1",
        displayName: "Mia",
        emailAddress: "mia@example.com",
        active: true,
        timeZone: "Europe/Warsaw",
      },
    ]);
  });

  it("offset-pages until an empty array (short page is NOT end-of-list)", async () => {
    // A short first page (1 < 50) followed by more, terminated by an empty page.
    const { fetchImpl, calls } = seqFetch([
      jsonResponse([{ accountId: "a1", accountType: "atlassian", displayName: "A", active: true }]),
      jsonResponse([{ accountId: "a2", accountType: "atlassian", displayName: "B", active: true }]),
      jsonResponse([]),
    ]);

    const members = await listAssignableUsers(BASE, CREDS, "SF", { fetchImpl });

    expect(members.map((m) => m.accountId)).toEqual(["a1", "a2"]);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toBe(
      `${BASE}/rest/api/3/user/assignable/search?project=SF&startAt=1&maxResults=50`,
    );
  });

  it("defaults displayName to accountId and active to false when absent", async () => {
    const { fetchImpl } = seqFetch([
      jsonResponse([{ accountId: "a1", accountType: "atlassian" }]),
      jsonResponse([]),
    ]);

    const members = await listAssignableUsers(BASE, CREDS, "SF", { fetchImpl });

    expect(members).toEqual([
      {
        accountId: "a1",
        displayName: "a1",
        emailAddress: undefined,
        active: false,
        timeZone: undefined,
      },
    ]);
  });

  it("throws JiraUnavailableError on a non-OK status", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    await expect(
      listAssignableUsers(BASE, CREDS, "SF", { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraUnavailableError);
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await listAssignableUsers(BASE, CREDS, "SF", { fetchImpl }).catch((e) => e);
    expect(String(err)).not.toContain(TOKEN);
  });
});

const SP_FIELD = "customfield_10016";

describe("searchSprintIssues", () => {
  it("maps issue fields + story points and parses status changelog", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({
        issues: [
          {
            id: "1001",
            key: "SF-1",
            fields: {
              summary: "Build sync",
              status: { id: "3", name: "In Progress" },
              assignee: { accountId: "acc-1" },
              created: "2026-08-02T09:00:00.000+0000",
              [SP_FIELD]: 5,
            },
            changelog: {
              histories: [
                {
                  id: "9001",
                  created: "2026-08-03T10:00:00.000+0000",
                  items: [
                    { field: "status", from: "1", fromString: "To Do", to: "3", toString: "In Progress" },
                    { field: "assignee", from: null, to: "acc-1" },
                  ],
                },
                {
                  id: "9002",
                  created: "2026-08-04T10:00:00.000+0000",
                  items: [{ field: "summary", fromString: "old", toString: "Build sync" }],
                },
              ],
            },
          },
        ],
        nextPageToken: null,
      }),
    ]);

    const issues = await searchSprintIssues(
      BASE,
      CREDS,
      { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
      { fetchImpl },
    );

    expect(issues).toEqual([
      {
        issueId: "1001",
        jiraKey: "SF-1",
        summary: "Build sync",
        storyPoints: 5,
        currentStatusId: "3",
        currentStatusName: "In Progress",
        assigneeJiraAccountId: "acc-1",
        createdAt: new Date("2026-08-02T09:00:00.000+0000"),
        sprintFieldChanges: [],
        statusHistory: [
          {
            changelogId: "9001",
            changedAt: new Date("2026-08-03T10:00:00.000+0000"),
            fromStatusId: "1",
            fromStatusName: "To Do",
            toStatusId: "3",
            toStatusName: "In Progress",
          },
        ],
      },
    ]);
    // First page carries no nextPageToken param; JQL is the sprint+project query.
    // URLSearchParams encodes spaces as `+`, which decodeURIComponent leaves as-is,
    // so normalize `+`→space before matching the human-readable JQL.
    const jql0 = decodeURIComponent(calls[0].replace(/\+/g, " "));
    expect(calls[0]).toContain(`${BASE}/rest/api/3/search/jql?`);
    expect(calls[0]).toContain("expand=changelog");
    expect(jql0).toContain('project = "SF" AND sprint = 42');
    expect(jql0).toContain(SP_FIELD);
  });

  it("follows nextPageToken across pages and passes it on the next request", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({
        issues: [{ id: "1", key: "SF-1", fields: { status: { id: "1", name: "To Do" } } }],
        nextPageToken: "TOKEN_PAGE_2",
      }),
      jsonResponse({
        issues: [{ id: "2", key: "SF-2", fields: { status: { id: "1", name: "To Do" } } }],
        nextPageToken: null,
      }),
    ]);

    const issues = await searchSprintIssues(
      BASE,
      CREDS,
      { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
      { fetchImpl },
    );

    expect(issues.map((i) => i.jiraKey)).toEqual(["SF-1", "SF-2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain("nextPageToken");
    expect(calls[1]).toContain("nextPageToken=TOKEN_PAGE_2");
  });

  it("adds an updated>= delta clause when a cursor is given", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ issues: [], nextPageToken: null }),
    ]);

    await searchSprintIssues(
      BASE,
      CREDS,
      {
        projectKey: "SF",
        sprintId: 42,
        storyPointFieldId: SP_FIELD,
        updatedSince: new Date("2026-08-10T14:30:00Z"),
      },
      { fetchImpl },
    );

    expect(decodeURIComponent(calls[0].replace(/\+/g, " "))).toContain(
      'updated >= "2026-08-10 14:30"',
    );
  });

  it("omits the story-point field from the request when unresolved", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({
        issues: [{ id: "1", key: "SF-1", fields: { status: { id: "1", name: "To Do" } } }],
        nextPageToken: null,
      }),
    ]);

    const issues = await searchSprintIssues(
      BASE,
      CREDS,
      { projectKey: "SF", sprintId: 42, storyPointFieldId: null },
      { fetchImpl },
    );

    expect(issues[0].storyPoints).toBeNull();
    expect(decodeURIComponent(calls[0])).toContain("fields=summary,status,assignee,created");
  });

  it("caps the page count on an unbounded nextPageToken chain", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        issues: [{ id: "1", key: "SF-1", fields: {} }],
        nextPageToken: "always-more",
      })) as unknown as typeof fetch;

    await expect(
      searchSprintIssues(
        BASE,
        CREDS,
        { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(JiraUnavailableError);
  });

  it("throws JiraAuthError on 401 (credentials revoked mid-life)", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Unauthorized" }, { status: 401 }));

    await expect(
      searchSprintIssues(
        BASE,
        CREDS,
        { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(JiraAuthError);
  });

  it("throws JiraUnavailableError on 5xx and never leaks the token", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 503 }));

    const err = await searchSprintIssues(
      BASE,
      CREDS,
      { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
      { fetchImpl },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(JiraUnavailableError);
    expect(String(err)).not.toContain(TOKEN);
  });

  /**
   * S-23 phase 3 §1 — the story-point guard. `jira_ticket.story_points` is an
   * `integer` and the write happens INSIDE the sync transaction, so an
   * unrounded `0.5` rolls the whole Jira pull back and stamps `sync_state`
   * ERROR every 15 minutes with no self-heal path.
   */
  describe("story-point guard", () => {
    async function storyPointsFor(raw: unknown): Promise<number | null> {
      const { fetchImpl } = seqFetch([
        jsonResponse({
          issues: [
            {
              id: "1",
              key: "SF-1",
              fields: { status: { id: "1", name: "To Do" }, [SP_FIELD]: raw },
            },
          ],
          nextPageToken: null,
        }),
      ]);
      const issues = await searchSprintIssues(
        BASE,
        CREDS,
        { projectKey: "SF", sprintId: 42, storyPointFieldId: SP_FIELD },
        { fetchImpl },
      );
      return issues[0].storyPoints;
    }

    it("rounds a fractional estimate to the nearest integer", async () => {
      expect(await storyPointsFor(0.5)).toBe(1);
      expect(await storyPointsFor(2.4)).toBe(2);
      expect(await storyPointsFor(3)).toBe(3);
    });

    it("clamps a negative estimate to zero rather than writing it through", async () => {
      expect(await storyPointsFor(-2)).toBe(0);
    });

    it("maps a non-finite estimate to null, never to NaN", async () => {
      expect(await storyPointsFor(Number.NaN)).toBeNull();
      expect(await storyPointsFor(Number.POSITIVE_INFINITY)).toBeNull();
      expect(await storyPointsFor("5")).toBeNull();
    });

    it("maps an estimate past the int4 column's range to null, not to a number", async () => {
      // Finite, so the non-finite guard lets it through; `Math.round` keeps it
      // whole. Written unguarded it reaches an `integer` column INSIDE the sync
      // transaction and raises `value out of range for type integer`, rolling
      // the whole Jira pull back — the same wedge `0.5` used to cause.
      expect(await storyPointsFor(1e10)).toBeNull();
      expect(await storyPointsFor(2_147_483_648)).toBeNull();
      // The domain itself is untouched: FR-009's largest bucket still passes.
      expect(await storyPointsFor(21)).toBe(21);
    });
  });

  /**
   * S-23 phase 3 §2 (plan review F5) — the `Sprint` changelog is matched on the
   * RESOLVED FIELD ID, because `field` is the site's display label: localised
   * and renameable. A miss here is silent, and the `createdAt` fallback it
   * triggers writes a wrong committed figure that the freeze makes permanent.
   */
  describe("Sprint-field changelog", () => {
    const SPRINT_FIELD = "customfield_10020";

    function issueWithSprintChange(item: Record<string, unknown>) {
      return {
        id: "1",
        key: "SF-1",
        fields: { status: { id: "1", name: "To Do" } },
        changelog: {
          histories: [
            { id: "h1", created: "2026-08-20T10:00:00.000+0000", items: [item] },
          ],
        },
      };
    }

    async function changesFor(
      item: Record<string, unknown>,
      sprintFieldId: string | null,
    ) {
      const { fetchImpl } = seqFetch([
        jsonResponse({ issues: [issueWithSprintChange(item)], nextPageToken: null }),
      ]);
      const issues = await searchSprintIssues(
        BASE,
        CREDS,
        { projectKey: "SF", sprintId: 42, storyPointFieldId: null, sprintFieldId },
        { fetchImpl },
      );
      return issues[0].sprintFieldChanges;
    }

    it("matches by fieldId even when the display name is not the English 'Sprint'", async () => {
      const changes = await changesFor(
        { field: "Sprintti", fieldId: SPRINT_FIELD, from: "41", to: "41, 42" },
        SPRINT_FIELD,
      );

      expect(changes).toEqual([
        {
          changedAt: new Date("2026-08-20T10:00:00.000+0000"),
          from: "41",
          to: "41, 42",
        },
      ]);
    });

    it("falls back to the display name when the field id could not be resolved", async () => {
      const changes = await changesFor({ field: "Sprint", from: null, to: "42" }, null);

      expect(changes).toEqual([
        { changedAt: new Date("2026-08-20T10:00:00.000+0000"), from: null, to: "42" },
      ]);
    });

    it("ignores a same-named item from a different field once the id is known", async () => {
      const changes = await changesFor(
        { field: "Sprint", fieldId: "customfield_99999", from: null, to: "42" },
        SPRINT_FIELD,
      );

      expect(changes).toEqual([]);
    });

    it("leaves status parsing untouched — the two parsers read the same changelog", async () => {
      const { fetchImpl } = seqFetch([
        jsonResponse({
          issues: [
            {
              id: "1",
              key: "SF-1",
              fields: { status: { id: "3", name: "In Progress" } },
              changelog: {
                histories: [
                  {
                    id: "h1",
                    created: "2026-08-20T10:00:00.000+0000",
                    items: [
                      { field: "status", from: "1", fromString: "To Do", to: "3", toString: "In Progress" },
                      { field: "Sprint", fieldId: SPRINT_FIELD, from: null, to: "42" },
                    ],
                  },
                ],
              },
            },
          ],
          nextPageToken: null,
        }),
      ]);

      const issues = await searchSprintIssues(
        BASE,
        CREDS,
        { projectKey: "SF", sprintId: 42, storyPointFieldId: null, sprintFieldId: SPRINT_FIELD },
        { fetchImpl },
      );

      expect(issues[0].statusHistory).toHaveLength(1);
      expect(issues[0].statusHistory[0].toStatusId).toBe("3");
      expect(issues[0].sprintFieldChanges).toHaveLength(1);
    });
  });
});

describe("resolveFieldIds — the story-point id", () => {
  it("picks the custom field by greenhopper schema", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { id: "summary", name: "Summary", custom: false, schema: { system: "summary" } },
        {
          id: "customfield_10016",
          name: "Story Points",
          custom: true,
          schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" },
        },
      ]),
    );

    const { storyPointFieldId: id } = await resolveFieldIds(BASE, CREDS, { fetchImpl });

    expect(id).toBe("customfield_10016");
  });

  it("falls back to matching the field name when schema is uninformative", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        { id: "customfield_20000", name: "Story point estimate", custom: true, schema: {} },
      ]),
    );

    const { storyPointFieldId: id } = await resolveFieldIds(BASE, CREDS, { fetchImpl });

    expect(id).toBe("customfield_20000");
  });

  it("ignores system fields and returns null when no story-point field exists", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([
        // A system field literally named to try to fool the name match.
        { id: "story", name: "Story Points", custom: false },
        { id: "customfield_1", name: "Severity", custom: true, schema: { custom: "x:y" } },
      ]),
    );

    const { storyPointFieldId: id } = await resolveFieldIds(BASE, CREDS, { fetchImpl });

    expect(id).toBeNull();
  });

  it("throws JiraAuthError on 401", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "Unauthorized" }, { status: 401 }));

    await expect(
      resolveFieldIds(BASE, CREDS, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraAuthError);
  });

  it("throws JiraUnavailableError on 5xx and never leaks the token", async () => {
    const fetchImpl = onceFetch(jsonResponse({ message: "boom" }, { status: 500 }));

    const err = await resolveFieldIds(BASE, CREDS, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(JiraUnavailableError);
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("resolveFieldIds — the Sprint field id", () => {
  const FIELD_LIST = [
    { id: "summary", name: "Summary", custom: false, schema: { system: "summary" } },
    {
      id: "customfield_10016",
      name: "Story Points",
      custom: true,
      schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" },
    },
    {
      // Display name deliberately NOT the English "Sprint" — the schema is what
      // identifies it, which is the whole point of resolving an id.
      id: "customfield_10020",
      name: "Sprintti",
      custom: true,
      schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
    },
  ];

  it("picks the Jira Software sprint field by its greenhopper schema", async () => {
    const fetchImpl = onceFetch(jsonResponse(FIELD_LIST));

    expect((await resolveFieldIds(BASE, CREDS, { fetchImpl })).sprintFieldId).toBe(
      "customfield_10020",
    );
  });

  it("returns null when the site exposes no sprint field", async () => {
    const fetchImpl = onceFetch(
      jsonResponse([{ id: "customfield_1", name: "Sprint", custom: true, schema: {} }]),
    );

    expect((await resolveFieldIds(BASE, CREDS, { fetchImpl })).sprintFieldId).toBeNull();
  });

  it("resolves BOTH ids from a single field listing", async () => {
    const { fetchImpl, calls } = seqFetch([jsonResponse(FIELD_LIST)]);

    const ids = await resolveFieldIds(BASE, CREDS, { fetchImpl });

    expect(ids).toEqual({
      storyPointFieldId: "customfield_10016",
      sprintFieldId: "customfield_10020",
    });
    // One subrequest, not two — the sync pays for this list once per cycle.
    expect(calls).toHaveLength(1);
  });
});

/**
 * `fetchRefinementTickets` (S-13 phase 2) — the reader that feeds the Refinement
 * analysis. It differs from `searchSprintIssues` in what it asks for, not in how
 * it asks: same `/search/jql` transport, a much wider `fields` list, and ADF
 * bodies flattened on the way out.
 *
 * The assertions that matter beyond mapping are the two the lesson register
 * demands: a requested key Jira did not return is REPORTED, not silently
 * absent (a narrowing predicate must not turn "wrong value" into "empty
 * result"), and nothing that came from the caller reaches the JQL string
 * unvalidated.
 */

const adfDoc = (...paragraphs: string[]) => ({
  type: "doc",
  version: 1,
  content: paragraphs.map((t) => ({
    type: "paragraph",
    content: [{ type: "text", text: t }],
  })),
});

describe("fetchRefinementTickets — keys path", () => {
  it("asks /search/jql for the widened analysis fields with a key IN clause", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ issues: [], nextPageToken: null }),
    ]);

    await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-1", "FM-2"] },
      { fetchImpl },
    );

    const url = new URL(calls[0]);
    expect(url.pathname).toBe("/rest/api/3/search/jql");
    expect(url.searchParams.get("jql")).toBe(
      'key IN ("FM-1", "FM-2") ORDER BY key ASC',
    );
    const fields = (url.searchParams.get("fields") ?? "").split(",");
    expect(fields).toEqual(
      expect.arrayContaining([
        "summary",
        "status",
        "issuetype",
        "description",
        "comment",
        "attachment",
        "issuelinks",
        "subtasks",
        "duedate",
        "labels",
        "priority",
        "created",
      ]),
    );
    // The changelog is what the sprint sync needs; refinement reads content.
    expect(url.searchParams.get("expand")).toBeNull();
  });

  it("flattens the ADF description and the newest comments to text", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [
          {
            id: "10001",
            key: "FM-1",
            fields: {
              summary: "Nowy regulamin",
              issuetype: { name: "Task" },
              description: adfDoc("Publikujemy nowy regulamin.", "Wchodzi wkrótce."),
              comment: {
                comments: [
                  { body: adfDoc("Pierwszy komentarz.") },
                  { body: adfDoc("Drugi komentarz.") },
                ],
              },
            },
          },
        ],
        nextPageToken: null,
      }),
    );

    const { tickets } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-1"] },
      { fetchImpl },
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0].key).toBe("FM-1");
    expect(tickets[0].summary).toBe("Nowy regulamin");
    expect(tickets[0].issueType).toBe("Task");
    expect(tickets[0].description).toBe(
      "Publikujemy nowy regulamin.\nWchodzi wkrótce.",
    );
    expect(tickets[0].comments).toEqual([
      "Pierwszy komentarz.",
      "Drugi komentarz.",
    ]);
  });

  it("keeps attachment names and mime types, never a byte of content", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [
          {
            id: "10001",
            key: "FM-1",
            fields: {
              summary: "Nowy regulamin",
              attachment: [
                {
                  filename: "regulamin-2026.pdf",
                  mimeType: "application/pdf",
                  content: "https://acme.atlassian.net/secure/attachment/1/x.pdf",
                },
                { filename: "notes.txt" },
              ],
            },
          },
        ],
        nextPageToken: null,
      }),
    );

    const { tickets } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-1"] },
      { fetchImpl },
    );

    expect(tickets[0].attachments).toEqual([
      { filename: "regulamin-2026.pdf", mimeType: "application/pdf" },
      { filename: "notes.txt", mimeType: null },
    ]);
  });

  it("maps subtasks and issue links to one hop with their statuses", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [
          {
            id: "10001",
            key: "FM-4",
            fields: {
              summary: "Widok listy polis",
              subtasks: [
                {
                  key: "FM-5",
                  fields: {
                    summary: "Endpoint /policies",
                    status: {
                      name: "In Progress",
                      statusCategory: { key: "indeterminate" },
                    },
                  },
                },
              ],
              issuelinks: [
                {
                  type: { inward: "is blocked by", outward: "blocks" },
                  inwardIssue: {
                    key: "FM-9",
                    fields: {
                      summary: "Kontrakt API",
                      status: { name: "To Do", statusCategory: { key: "new" } },
                    },
                  },
                },
              ],
            },
          },
        ],
        nextPageToken: null,
      }),
    );

    const { tickets } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-4"] },
      { fetchImpl },
    );

    expect(tickets[0].subtasks).toEqual([
      {
        key: "FM-5",
        summary: "Endpoint /policies",
        status: "In Progress",
        category: "indeterminate",
        relation: "subtask",
      },
    ]);
    expect(tickets[0].links).toEqual([
      {
        key: "FM-9",
        summary: "Kontrakt API",
        status: "To Do",
        category: "new",
        relation: "is blocked by",
      },
    ]);
  });

  it("builds sourceUrl from the base so the lead can open the ticket", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [{ id: "1", key: "FM-1", fields: { summary: "x" } }],
        nextPageToken: null,
      }),
    );
    const { tickets } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-1"] },
      { fetchImpl },
    );
    expect(tickets[0].sourceUrl).toBe("https://acme.atlassian.net/browse/FM-1");
  });
});

describe("fetchRefinementTickets — the input the caller controls", () => {
  it("reports requested keys Jira did not return instead of dropping them", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [{ id: "1", key: "FM-1", fields: { summary: "exists" } }],
        nextPageToken: null,
      }),
    );

    const { tickets, missingKeys } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["FM-1", "FM-404", "FM-999"] },
      { fetchImpl },
    );

    expect(tickets.map((t) => t.key)).toEqual(["FM-1"]);
    expect(missingKeys).toEqual(["FM-404", "FM-999"]);
  });

  it("matches a lowercase request against Jira's uppercase key", async () => {
    const fetchImpl = onceFetch(
      jsonResponse({
        issues: [{ id: "1", key: "FM-1", fields: { summary: "exists" } }],
        nextPageToken: null,
      }),
    );

    const { missingKeys } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { keys: ["fm-1"] },
      { fetchImpl },
    );

    expect(missingKeys).toEqual([]);
  });

  it("rejects a key outside Jira's key charset before issuing any request", async () => {
    const { fetchImpl, calls } = seqFetch([]);

    await expect(
      fetchRefinementTickets(
        BASE,
        CREDS,
        { keys: ['FM-1" OR project = "SECRET'] },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(JiraRefinementInputError);
    expect(calls).toEqual([]);
  });

  it("rejects an empty selection rather than searching for nothing", async () => {
    const { fetchImpl, calls } = seqFetch([]);
    await expect(
      fetchRefinementTickets(BASE, CREDS, { keys: [] }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraRefinementInputError);
    expect(calls).toEqual([]);
  });

  it("raises rather than silently truncating a selection above the per-call cap", async () => {
    const { fetchImpl, calls } = seqFetch([]);
    const tooMany = Array.from(
      { length: MAX_REFINEMENT_TICKETS_PER_CALL + 1 },
      (_, i) => `FM-${i + 1}`,
    );

    await expect(
      fetchRefinementTickets(BASE, CREDS, { keys: tooMany }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraRefinementInputError);
    expect(calls).toEqual([]);
  });

  it("never includes the token in a thrown error", async () => {
    const fetchImpl = onceFetch(jsonResponse({}, { status: 500 }));
    await expect(
      fetchRefinementTickets(BASE, CREDS, { keys: ["FM-1"] }, { fetchImpl }),
    ).rejects.toSatisfy((e) => !String((e as Error).message).includes(TOKEN));
  });
});

describe("fetchRefinementTickets — board backlog path", () => {
  const backlogIssue = (n: number) => ({
    id: String(n),
    key: `FM-${n}`,
    fields: { summary: `Backlog item ${n}` },
  });

  it("reads the board's BACKLOG, not the active sprint", async () => {
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ startAt: 0, maxResults: 50, total: 0, issues: [] }),
    ]);

    await fetchRefinementTickets(BASE, CREDS, { boardId: 7 }, { fetchImpl });

    const url = new URL(calls[0]);
    expect(url.pathname).toBe("/rest/agile/1.0/board/7/backlog");
    // The sprint search would be /rest/api/3/search/jql with a `sprint =` JQL —
    // hitting it here is the exact defect manual row 2.5 exists to catch.
    expect(url.searchParams.get("jql")).toBeNull();
    const fields = (url.searchParams.get("fields") ?? "").split(",");
    expect(fields).toEqual(expect.arrayContaining(["description", "comment", "attachment"]));
  });

  it("offset-paginates the backlog and assembles the pages", async () => {
    const first = Array.from({ length: 50 }, (_, i) => backlogIssue(i + 1));
    const { fetchImpl, calls } = seqFetch([
      jsonResponse({ startAt: 0, maxResults: 50, total: 51, issues: first }),
      jsonResponse({ startAt: 50, maxResults: 50, total: 51, issues: [backlogIssue(51)] }),
    ]);

    const { tickets, missingKeys } = await fetchRefinementTickets(
      BASE,
      CREDS,
      { boardId: 7 },
      { fetchImpl },
    );

    expect(tickets).toHaveLength(51);
    expect(tickets[50].key).toBe("FM-51");
    expect(new URL(calls[1]).searchParams.get("startAt")).toBe("50");
    // Nothing was requested by key, so nothing can be missing.
    expect(missingKeys).toEqual([]);
  });

  it("caps the page count on an unbounded backlog chain", async () => {
    const full = Array.from({ length: 50 }, (_, i) => backlogIssue(i + 1));
    const { fetchImpl } = seqFetch(
      Array.from({ length: 25 }, () =>
        jsonResponse({ startAt: 0, maxResults: 50, total: 100000, issues: full }),
      ),
    );

    await expect(
      fetchRefinementTickets(BASE, CREDS, { boardId: 7 }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraUnavailableError);
  });

  it("throws JiraBoardNotFoundError on 404 so a stale board id triggers re-discovery", async () => {
    const fetchImpl = onceFetch(jsonResponse({}, { status: 404 }));
    await expect(
      fetchRefinementTickets(BASE, CREDS, { boardId: 7 }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraBoardNotFoundError);
  });

  it("throws JiraAuthError on 401 (a token without Agile permission)", async () => {
    const fetchImpl = onceFetch(jsonResponse({}, { status: 401 }));
    await expect(
      fetchRefinementTickets(BASE, CREDS, { boardId: 7 }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraAuthError);
  });

  it("refuses a board id that is not a positive integer before requesting", async () => {
    const { fetchImpl, calls } = seqFetch([]);
    await expect(
      fetchRefinementTickets(BASE, CREDS, { boardId: Number.NaN }, { fetchImpl }),
    ).rejects.toBeInstanceOf(JiraRefinementInputError);
    expect(calls).toEqual([]);
  });
});
