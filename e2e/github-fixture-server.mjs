import { createServer } from "node:http";

/**
 * GitHub API fixture server for the S-02 setup e2e (test-plan §6.3).
 *
 * The connect flow's GitHub calls happen SERVER-SIDE (inside the Server Action),
 * so `page.route()` cannot intercept them. Instead the app is launched with
 * `GITHUB_API_BASE_URL=http://localhost:<PORT>` (see playwright.config.ts), and
 * this tiny server answers the two GETs the client makes with canned fixtures:
 *
 *   GET /user       → 200, { login }, `x-oauth-scopes: repo,…` (classic PAT)
 *   GET /user/repos → 200, repo page 1 + a `Link: rel="next"` to page 2
 *   GET /user/repos?page=2 → 200, repo page 2, no `Link` (pagination terminates)
 *
 * Plain `.mjs` so it runs under `node` with zero deps (no MSW, no tsx).
 */

const PORT = Number(process.env.PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;

const REPOS_PAGE_1 = [
  { id: 900001, full_name: "sprintflow-e2e/frontend" },
  { id: 900002, full_name: "sprintflow-e2e/backend" },
];
const REPOS_PAGE_2 = [{ id: 900003, full_name: "sprintflow-e2e/mobile" }];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);

  if (url.pathname === "/user") {
    res.writeHead(200, {
      "content-type": "application/json",
      "x-oauth-scopes": "repo, read:org",
    });
    res.end(JSON.stringify({ login: "sprintflow-e2e" }));
    return;
  }

  if (url.pathname === "/user/repos") {
    if (url.searchParams.get("page") === "2") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(REPOS_PAGE_2));
      return;
    }
    // Page 1 advertises page 2 via the Link header (exercises pagination).
    res.writeHead(200, {
      "content-type": "application/json",
      link: `<${BASE}/user/repos?page=2>; rel="next"`,
    });
    res.end(JSON.stringify(REPOS_PAGE_1));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found", path: url.pathname }));
});

server.listen(PORT, () => {
  console.log(`[github-fixture] listening on ${BASE}`);
});
