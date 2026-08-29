import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import pg from "pg";

/**
 * S-10 — Dashboard "Sprint Detail" + the Today tab retrofit.
 *
 * Modeled on `e2e/seed.spec.ts`: role/text locators, wait-for-state (never
 * `waitForTimeout`), one risk per test, cleanup in `afterAll`.
 *
 * Risks protected (plan Phase 6 §2, test-plan.md Risks #5 and #6):
 *   1. The S-07 north star regressed — Today must still OPEN on the Anomaly
 *      Inbox after being put behind a tab shell, and each tab must reveal its
 *      own panel. This is the single biggest risk S-10 introduced.
 *   2. Sprint Detail crashes for an owner with no sprint row (plan review F2).
 *      `middleware.ts` gates only on the session cookie, so a freshly signed-up
 *      lead reaches this route from the nav with nothing seeded — Risk #6's
 *      shape exactly: a white screen instead of a graceful empty state.
 *   3. With real data, the three Sprint Detail surfaces render and the matrix
 *      metric switcher actually changes the numbers (not just the label).
 *
 * ISOLATION. Tests 1–2 need an owner with NO sprint; test 3 needs a seeded one.
 * They therefore cannot share the suite's `storageState` account — under
 * `fullyParallel` a seeded row would make the no-sprint assertion flaky. Test 3
 * creates its OWN account (unique timestamp email) via the sign-up API — no UI
 * login — seeds against that owner id, and deletes it in `afterAll`.
 *
 * Internal boundaries stay real: auth, middleware, routing, and Postgres are all
 * exercised. Nothing is mocked here — the seeded rows stand in for a completed
 * sync, which is what the read-side reducers consume anyway.
 */

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Sprint-Flow-1!";

/**
 * Create a brand-new authenticated browser context, without going through the
 * login UI.
 *
 * Used by the two describes that cannot share the suite's `storageState`
 * account: one needs an owner with NO sprint and no integrations, the other
 * seeds its own data. The setup specs connect GitHub and Jira on the shared
 * account, so under `fullyParallel` any assertion about the unconnected state
 * is a coin flip there.
 */
async function signUpFreshAccount(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/auth/sign-up/email", {
    // Better Auth rejects a cross-origin-looking POST (MISSING_OR_NULL_ORIGIN);
    // APIRequestContext sends no Origin by default, so set it explicitly.
    headers: { origin: baseURL },
    data: { name: "S10 E2E", email, password: PASSWORD },
  });
  expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return context;
}

// ---------------------------------------------------------------------------
// Risks 1 & 2 — run on the suite's shared (unseeded) account.
// ---------------------------------------------------------------------------

test.describe("Dashboard Today — S-10 tab retrofit", () => {
  /**
   * Risk-tied: FR-016 — "the Today dashboard opens on the Anomaly Inbox as the
   * default view", the differentiator S-07 shipped. If the retrofit had made
   * any other tab default, or had left the inbox unrendered behind the shell,
   * this fails: `aria-selected` would sit on the wrong tab and the inbox panel
   * would not be visible.
   */
  test("Today still opens on the Anomaly Inbox, and each tab reveals its panel", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard — Today" })).toBeVisible();

    // The inbox is the landing tab — selected without anyone clicking anything.
    const inboxTab = page.getByRole("tab", { name: "Anomaly Inbox" });
    await expect(inboxTab).toHaveAttribute("aria-selected", "true");
    // Scoped to the active tabpanel: the same copy also appears in the page
    // header, so an unscoped match would pass even with the panel empty.
    await expect(page.getByRole("tabpanel").getByText("Anomaly Inbox")).toBeVisible();

    // Freshness stays OUTSIDE the tabs, so it must be visible on the first paint
    // and survive every switch below (US-01: last-sync time is always visible).
    const freshness = page.getByText(/Jira last synced:/);
    await expect(freshness).toBeVisible();

    // Each remaining tab reveals its own panel. The locators target content
    // unique to each panel, not the tab label — clicking a tab that revealed
    // nothing would still leave the label on screen.
    for (const [tabName, panelContent] of [
      ["Sprint Pulse", "Tickets by status"],
      ["Yesterday", "Yesterday's activity"],
      ["Reliability", /hasn't recorded this sprint/],
    ] as const) {
      await page.getByRole("tab", { name: tabName }).click();
      await expect(page.getByText(panelContent)).toBeVisible();
      await expect(freshness).toBeVisible();
    }

    // Returning to the inbox restores the headline surface.
    await inboxTab.click();
    // Scoped to the active tabpanel: the same copy also appears in the page
    // header, so an unscoped match would pass even with the panel empty.
    await expect(page.getByRole("tabpanel").getByText("Anomaly Inbox")).toBeVisible();
  });
});

test.describe("Sprint Detail — no sprint (plan review F2)", () => {
  /**
   * Risk-tied: test-plan.md Risk #6 ("no white screen, no unhandled crash") and
   * plan review F2. The three reducers all take a non-optional `sprintId`; if
   * the null-sprint guard were removed, this route would call them with null and
   * the page would 500 instead of rendering the empty state. The assertion fails
   * exactly then — Next's error surface carries neither the heading nor the copy.
   */
  test("an owner with no sprint reaches Sprint Detail from the nav and gets the empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Reachability is part of the risk: the route is only useful if the nav
    // exposes it (plan Phase 4 §1).
    await page.getByRole("link", { name: "Sprint Detail" }).click();
    await page.waitForURL("**/dashboard/sprint-detail");

    await expect(
      page.getByRole("heading", { name: "Dashboard — Sprint Detail" }),
    ).toBeVisible();
    await expect(page.getByText("No active sprint", { exact: true })).toBeVisible();

    // Graceful degradation, not a crash: the freshness bar still renders.
    await expect(page.getByText(/Jira last synced:/)).toBeVisible();
  });
});

test.describe("Settings — Connections (S-10 Phase 8)", () => {
  /**
   * ISOLATION: this test asserts the NOT-CONNECTED state, so it cannot use the
   * suite's shared `storageState` account — `setup-github.spec.ts` and
   * `setup-jira.spec.ts` connect those integrations on that same account, and
   * under `fullyParallel` they may land first. (They did: this test passed alone
   * and failed in the full suite until it got its own account.) A fresh sign-up
   * is unconnected by construction.
   */
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await signUpFreshAccount(browser, `e2e-s10-settings-${Date.now()}@example.test`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  /**
   * Risk-tied: the gap this phase exists to close. Since S-02/S-03 the wizard
   * has rendered a connected-state card per integration, but NOTHING linked back
   * to it after first run — a failing integration surfaced only as a dashboard
   * banner with no route to any detail.
   *
   * The assertion chain fails exactly if that regresses: no nav entry, or the
   * page renders without naming both integrations.
   */
  test("Settings is reachable from the nav and reports both integrations", async () => {
    const page = await context.newPage();
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Settings" }).click();
    // /settings redirects to its first section, mirroring the wizard.
    await page.waitForURL("**/settings/connections");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Both integrations are named, whatever their state.
    await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
    await expect(page.getByText("Jira", { exact: true })).toBeVisible();

    // "Sync now" is the control that had no caller before this phase.
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();

    // Not connected is a route forward, not an error.
    await expect(page.getByRole("link", { name: "Connect GitHub" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect Jira" })).toBeVisible();

    await page.close();
  });

  /**
   * Risk-tied (Phase 9): connecting ONE integration from Settings must not drag
   * the owner into the 4-step wizard. Before the split, `reconnectHref` pointed
   * at `/setup/github`, which renders the stepper and, on success, a "Continue
   * to Jira" CTA — a flow they never asked for.
   *
   * Asserts BOTH sides so the fix cannot be mistaken for deleting the wizard:
   * the Settings route has no stepper, and `/setup/github` still does.
   */
  test("connecting from Settings is a single step, while the wizard keeps its stepper", async () => {
    const page = await context.newPage();
    await page.goto("/settings/connections");

    await page.getByRole("link", { name: "Connect GitHub" }).click();
    await page.waitForURL("**/settings/connections/github");

    // The real form is here — this is one action, not a tour.
    await expect(page.getByRole("heading", { name: "Connect GitHub" })).toBeVisible();
    await expect(page.getByText(/Krok \d+ z \d+/)).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Continue to Jira/ })).toHaveCount(0);

    // And a way back that does not require finishing anything.
    await page.getByRole("link", { name: "Back to connections" }).click();
    await page.waitForURL("**/settings/connections");

    // The wizard is untouched — this phase added an entry point, it did not
    // replace one. If this half fails, the fix went too far.
    await page.goto("/setup/github");
    await expect(page.getByText(/Krok 2 z 4/)).toBeVisible();

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Risk 3 — needs its own seeded owner, isolated from the shared account.
// ---------------------------------------------------------------------------

test.describe("Sprint Detail — seeded sprint", () => {
  const email = `e2e-s10-${Date.now()}@example.test`;

  let client: pg.Client;
  let ownerId: string;
  let context: BrowserContext;

  /** Sign up through the API (never the UI) and resolve the new owner's id. */
  async function signUpAndResolveOwner(browser: Browser): Promise<void> {
    context = await signUpFreshAccount(browser, email);

    const { rows } = await client.query('select id from "user" where email = $1', [email]);
    expect(rows, "the sign-up did not create a user row").toHaveLength(1);
    ownerId = rows[0].id;
  }

  /**
   * Seed the upstream rows a completed sync would have written. Deliberately
   * minimal and hand-derived — enough to make each surface non-empty and to give
   * the matrix a value that can only appear under one metric.
   */
  async function seedSprint(): Promise<void> {
    const now = Date.now();
    const day = (n: number) => new Date(now - (8 - n) * 86_400_000);

    const credId = randomUUID();
    await client.query(
      `insert into jira_credential (id, owner_id, encrypted_token, token_last4, workspace_url, jira_email)
       values ($1,$2,$3,$4,$5,$6)`,
      [credId, ownerId, "e2e-placeholder-not-a-real-token", "0000", "https://e2e.atlassian.net", email],
    );
    const projId = randomUUID();
    await client.query(
      `insert into jira_project (id, owner_id, credential_id, jira_project_id, project_key, time_zone)
       values ($1,$2,$3,$4,$5,$6)`,
      [projId, ownerId, credId, "10001", "E2E", "Europe/Warsaw"],
    );
    const sprintId = randomUUID();
    await client.query(
      `insert into sprint (id, owner_id, jira_project_id, jira_sprint_id, name, state,
                           start_date, end_date, committed_sp, completed_sp)
       values ($1,$2,$3,$4,'E2E Sprint','ACTIVE',$5,$6,13,5)`,
      [sprintId, ownerId, projId, "9001", day(0), new Date(now + 6 * 86_400_000)],
    );

    const memberId = randomUUID();
    await client.query(
      `insert into team_member (id, owner_id, name, github_username, jira_account_id,
                                technology_track, source, is_active)
       values ($1,$2,'Ada Lovelace','ada-e2e','acc-ada-e2e','BACKEND','MANUAL',true)`,
      [memberId, ownerId],
    );

    // Two tickets: one still open (so it appears in the aging report), one DONE
    // (so the burndown actually burns and the BACKEND track has a line).
    const openTicket = randomUUID();
    const doneTicket = randomUUID();
    await client.query(
      `insert into jira_ticket (id, owner_id, jira_project_id, sprint_id, jira_key, summary,
                                story_points, current_category, assignee_jira_account_id,
                                last_status_change_at, added_after_sprint_start, source_url)
       values ($1,$2,$3,$4,'E2E-1','Stalled in review',8,'CODE_REVIEW','acc-ada-e2e',$5,false,$6),
              ($7,$2,$3,$4,'E2E-2','Shipped early',5,'DONE','acc-ada-e2e',$8,false,$9)`,
      [
        openTicket, ownerId, projId, sprintId, day(2),
        "https://e2e.atlassian.net/browse/E2E-1",
        doneTicket, day(4), "https://e2e.atlassian.net/browse/E2E-2",
      ],
    );
    await client.query(
      `insert into jira_status_history (id, owner_id, ticket_id, to_category, changed_at, jira_changelog_id)
       values ($1,$2,$3,'CODE_REVIEW',$4,'e2e-cl-1'), ($5,$2,$6,'DONE',$7,'e2e-cl-2')`,
      [randomUUID(), ownerId, openTicket, day(2), randomUUID(), doneTicket, day(4)],
    );

    const ghCredId = randomUUID();
    await client.query(
      `insert into github_credential (id, owner_id, encrypted_token, token_last4, github_login)
       values ($1,$2,$3,$4,'ada-e2e')`,
      [ghCredId, ownerId, "e2e-placeholder-not-a-real-token", "0000"],
    );
    const repoId = randomUUID();
    await client.query(
      `insert into monitored_repo (id, owner_id, credential_id, github_repo_id, full_name, is_active)
       values ($1,$2,$3,$4,'acme/e2e',true)`,
      [repoId, ownerId, ghCredId, 910001],
    );
    // 310 + 88 = 398 lines on one day — a number that CANNOT appear as a commit
    // count, which is what makes the metric-switch assertion meaningful. The
    // second commit has NULL churn (an over-cap commit), so the matrix must
    // render "—" and never 0 for it.
    await client.query(
      `insert into github_commit (id, owner_id, repo_id, sha, author_github_username,
                                  authored_at, additions, deletions, message)
       values ($1,$2,$3,'e2esha0001','ada-e2e',$4,310,88,'measured commit'),
              ($5,$2,$3,'e2esha0002','ada-e2e',$6,null,null,'over-cap commit')`,
      [randomUUID(), ownerId, repoId, day(3), randomUUID(), day(5)],
    );
  }

  test.beforeAll(async ({ browser }) => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    await signUpAndResolveOwner(browser);
    await seedSprint();
  });

  test.afterAll(async () => {
    // Cleanup: deleting the user cascades every row seeded above, so a re-run
    // starts clean and no other test can observe this account.
    if (ownerId) await client.query('delete from "user" where id = $1', [ownerId]);
    await client?.end();
    await context?.close();
  });

  /**
   * Risk-tied: plan Phase 6 §2 risks (c) and (d). Proves the three reducers
   * reach the rendered page with real rows, and — the part a screenshot could
   * not tell you — that the metric switcher changes the NUMBERS, not just the
   * label. 398 is the summed churn of one commit; it is unreachable as a commit
   * count, so its appearance can only mean the Lines metric is live.
   */
  test("all three surfaces render, and the matrix switcher changes the rendered values", async () => {
    const page = await context.newPage();
    await page.goto("/dashboard/sprint-detail");

    // --- Surface A: the aging report is the default tab ---------------------
    await expect(
      page.getByRole("heading", { name: "Dashboard — Sprint Detail" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Workflow health" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The open ticket is listed; the DONE one is excluded by design.
    await expect(page.getByRole("link", { name: "E2E-1" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "E2E-2" })).toHaveCount(0);

    // --- Surface B: the activity matrix, and the metric switch --------------
    await page.getByRole("tab", { name: "Team activity" }).click();
    const commitsTable = page.getByRole("table", { name: /showing commits/ });
    await expect(commitsTable).toBeVisible();
    await expect(commitsTable.getByText("398", { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Lines" }).click();
    const linesTable = page.getByRole("table", { name: /showing lines/ });
    // The business outcome of the switch: a value only the Lines metric yields.
    await expect(linesTable.getByText("398", { exact: true })).toBeVisible();
    // Exactly one cell is unmeasured — the single over-cap commit seeded above.
    // A quiet day reads 0, not "not measured", so the count pins the semantics:
    // if empty days leaked into the null bucket this would be 8, not 1.
    await expect(linesTable.getByText("lines: not measured")).toHaveCount(1);

    // --- Surface C: the per-technology sub-burndown -------------------------
    await page.getByRole("tab", { name: "By technology" }).click();
    // The legend renders only once the chart has actually drawn its series, so
    // this fails if the reducer returned nothing or the chart failed to mount.
    await expect(page.getByText("Backend")).toBeVisible();

    await page.close();
  });
});
