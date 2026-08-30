import { expect, test } from "@playwright/test";

import { disconnectIfConnected } from "./disconnect";

/**
 * S-03 setup wizard — Jira connect happy path (FR-003, FR-004, FR-005).
 *
 * Modeled on `e2e/setup-github.spec.ts`: role/label/text locators, wait-for-state
 * (never `waitForTimeout`), test independence + cleanup. Runs authenticated via
 * the saved `storageState` (the `chromium` project's dependency on `setup`).
 *
 * Jira is mocked SERVER-SIDE: the app is launched with
 * `JIRA_API_BASE_URL=http://localhost:3098` (playwright.config.ts) so the Server
 * Actions' `fetch` resolves to `e2e/jira-fixture-server.mjs` — a `page.route()`
 * cannot reach a server-side fetch. The workspace field still has to be a valid
 * `*.atlassian.net` host (schema-validated); the base override redirects the
 * actual fetch to the fixture. Email/token values are irrelevant to the fixture.
 */

const WORKSPACE = "sprintflow-e2e.atlassian.net";
const EMAIL = "e2e@example.test";
const TOKEN = "jira-e2e-fixture-token";

test.describe("setup — Jira connect (authenticated)", () => {
  // Test independence: leave the account with no Jira credential so a re-run
  // starts from the connect form.
  test.afterEach(async ({ page }) => {
    await page.goto("/setup/jira");
    await disconnectIfConnected(page, "Jira");
  });

  /**
   * Risk-tied: FR-003 (validate-before-store) + FR-004 (single project) + FR-005
   * (status mapping). The assertion chain fails exactly if any stage broke —
   * credential validation, the project picker, the status mapper (pre-filled from
   * the auto-suggestion), the store mutation, or the connected-status re-render.
   */
  test("connect Jira, pick a project, map statuses, and see the connected state", async ({
    page,
  }) => {
    await page.goto("/setup/jira");

    // Ensure a clean starting point.
    await disconnectIfConnected(page, "Jira");

    // Stage 1 — validate the credentials (no write yet, FR-003).
    await page.getByLabel("Workspace URL").fill(WORKSPACE);
    await page.getByLabel("Account email").fill(EMAIL);
    await page.getByLabel("API token").fill(TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    // Stage 2 — the project picker appears with the fixture's project (FR-004).
    await expect(page.getByText("Choose a project to monitor")).toBeVisible();
    await page.getByRole("radio", { name: /SF.*SprintFlow/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    // Stage 3 — the status mapper appears, pre-filled from the auto-suggestion so
    // Save is immediately enabled (FR-005 completeness holds by default).
    await expect(page.getByText("Map workflow statuses")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Stage 4 — the connected-status card renders (server re-render after store).
    await expect(page.getByText("Jira connected")).toBeVisible();
    await expect(page.getByText(/Connected to .*sprintflow-e2e/)).toBeVisible();
    await expect(page.getByText(/Monitoring project/)).toBeVisible();
  });
});
