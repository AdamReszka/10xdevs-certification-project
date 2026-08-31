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
 *
 * S-30 ADDS THE **AGILE** API, which the three above do not cover:
 *
 *   GET /rest/agile/1.0/board?projectKeyOrId=…  → 200, one scrum board
 *   GET /rest/agile/1.0/board/{id}/sprint       → 200, one dated ACTIVE sprint
 *
 * `reconcileActiveSprint` calls both, and against a 404 it returns `no_board`
 * and writes no `sprint` row at all — which is why `/team/cadence` had zero E2E
 * coverage before: with no sprint row it renders `no_sprint`, the restore button
 * is disabled and a save throws `NoSprintRowError`. `e2e/accounts.ts` is explicit
 * that `sprint` is "deliberately NOT seeded", so the fixture is the route to a
 * REAL sprint row minted by the real reconciler.
 *
 * THE SPRINT'S DATES ARE CHOSEN SO ITS DERIVED CADENCE DIFFERS from what the
 * cadence spec then sets by hand — 7 days from a THURSDAY, against a hand-set
 * 21 / MON — so "restore returned length and start day to Jira's" is an
 * assertable CHANGE rather than a coincidence.
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

const BOARDS = [{ id: 77, name: "SF Board", type: "scrum" }];

/**
 * Thu 2026-08-06T08:00Z → Thu 2026-08-13T08:00Z. `deriveCadence` reads that as
 * `lengthDays: 7`, `startDay: "THU"` — deliberately unlike the 14/MON defaults
 * AND unlike anything a spec would set by hand, so a restore is visible.
 */
const ACTIVE_SPRINT = {
  id: 4242,
  state: "active",
  name: "SF Sprint 1",
  startDate: "2026-08-06T08:00:00.000Z",
  endDate: "2026-08-13T08:00:00.000Z",
};

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

  // --- Agile API (S-30) ---------------------------------------------------

  if (p === "/rest/agile/1.0/board") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ isLast: true, values: BOARDS }));
    return;
  }

  if (/^\/rest\/agile\/1\.0\/board\/[^/]+\/sprint$/.test(p)) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ isLast: true, values: [ACTIVE_SPRINT] }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found", path: p }));
});

server.listen(PORT, () => {
  console.log(`[jira-fixture] listening on ${BASE}`);
});
