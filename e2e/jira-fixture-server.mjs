import { createServer } from "node:http";

/**
 * Jira Cloud API fixture server for the S-03 setup e2e (test-plan §6.3).
 *
 * The connect flow's Jira calls happen SERVER-SIDE (inside the Server Actions),
 * so `page.route()` cannot intercept them. Instead the app is launched with
 * `JIRA_API_BASE_URL=http://localhost:<PORT>` (see playwright.config.ts), and
 * this tiny server answers the three GETs the client makes with canned fixtures:
 *
 *   GET /rest/api/3/myself                      → 200, { accountId, … }
 *   GET /rest/api/3/project/search              → 200, PageBeanProject (isLast)
 *   GET /rest/api/3/project/{idOrKey}/statuses  → 200, IssueTypeWithStatus[]
 *
 * The statuses fixture deliberately includes "In Review" and "QA" so the
 * auto-suggestion (Code Review / Testing) is exercised end-to-end. Plain `.mjs`
 * so it runs under `node` with zero deps.
 */

const PORT = Number(process.env.PORT ?? 3098);
const BASE = `http://localhost:${PORT}`;

const PROJECTS = [{ id: "10000", key: "SF", name: "SprintFlow" }];

const STATUSES = [
  {
    id: "1",
    name: "Story",
    statuses: [
      { id: "10", name: "To Do", statusCategory: { key: "new" } },
      { id: "11", name: "In Progress", statusCategory: { key: "indeterminate" } },
      { id: "12", name: "In Review", statusCategory: { key: "indeterminate" } },
      { id: "13", name: "QA", statusCategory: { key: "indeterminate" } },
      { id: "14", name: "Done", statusCategory: { key: "done" } },
    ],
  },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  const p = url.pathname;

  if (p === "/rest/api/3/myself") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        accountId: "e2e-account-1",
        emailAddress: "e2e@example.test",
        displayName: "E2E Lead",
      }),
    );
    return;
  }

  if (p === "/rest/api/3/project/search") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ isLast: true, values: PROJECTS }));
    return;
  }

  // /rest/api/3/project/{idOrKey}/statuses — accept id ("10000") or key ("SF").
  if (/^\/rest\/api\/3\/project\/[^/]+\/statuses$/.test(p)) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(STATUSES));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found", path: p }));
});

server.listen(PORT, () => {
  console.log(`[jira-fixture] listening on ${BASE}`);
});
