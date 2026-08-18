import { expect, test } from "@playwright/test";

/**
 * S-02 setup wizard — GitHub connect happy path (FR-002, FR-004).
 *
 * Modeled on `e2e/seed.spec.ts`: role/label/text locators, wait-for-state (never
 * `waitForTimeout`), test independence + cleanup. Runs authenticated via the
 * saved `storageState` (the `chromium` project's dependency on `setup`).
 *
 * GitHub is mocked SERVER-SIDE: the app is launched with
 * `GITHUB_API_BASE_URL=http://localhost:3099` (playwright.config.ts) so the
 * Server Action's `fetch` resolves to `e2e/github-fixture-server.mjs` — a
 * `page.route()` cannot reach a server-side fetch. The fixture serves a paginated
 * repo list, so this also exercises the `Link: rel="next"` follow.
 *
 * A classic-PAT-shaped token (`ghp_…`) satisfies the upstream zod regex; its
 * value is irrelevant because the fixture accepts any bearer.
 */

const FIXTURE_TOKEN = "ghp_e2efixturetoken0123456789ABCDEFGH";

test.describe("setup — GitHub connect (authenticated)", () => {
  // Test independence: leave the account with no GitHub credential, whatever
  // state this test left it in, so a re-run starts from the connect form.
  test.afterEach(async ({ page }) => {
    await page.goto("/setup/github");
    const disconnect = page.getByRole("button", { name: "Disconnect" });
    if (await disconnect.isVisible().catch(() => false)) {
      await disconnect.click();
      await expect(
        page.getByRole("button", { name: "Connect" }),
      ).toBeVisible();
    }
  });

  /**
   * Risk-tied: FR-002 (validate-before-store) + FR-004 (choose repos). The
   * assertion chain would fail exactly if the connect flow broke — token
   * validation, the repo picker, the store mutation, or the connected-status
   * re-render.
   */
  test("connect a PAT, pick a repo, and see the connected state", async ({
    page,
  }) => {
    await page.goto("/setup/github");

    // Ensure a clean starting point (a prior run on this account may have left a
    // credential; disconnect first so we exercise the connect form).
    const existingDisconnect = page.getByRole("button", { name: "Disconnect" });
    if (await existingDisconnect.isVisible().catch(() => false)) {
      await existingDisconnect.click();
      await expect(
        page.getByRole("button", { name: "Connect" }),
      ).toBeVisible();
    }

    // Stage 1 — validate the token (no write yet, FR-002).
    await page.getByLabel("Personal access token").fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: "Connect" }).click();

    // Stage 2 — the repo picker appears with the fixture's paginated repos.
    await expect(
      page.getByText("Choose repositories to monitor"),
    ).toBeVisible();
    // Page-2 repo proves the Link-header pagination was followed.
    await expect(
      page.getByRole("checkbox", { name: "sprintflow-e2e/mobile" }),
    ).toBeVisible();

    // Pick a repo and save (FR-004).
    await page
      .getByRole("checkbox", { name: "sprintflow-e2e/frontend" })
      .check();
    await page.getByRole("button", { name: /^Save/ }).click();

    // Stage 3 — the connected-status card renders (server re-render after store).
    // Scope to the card's description text (the `(` disambiguates it from the
    // transient "Connected as … — monitoring 1 repository." success toast).
    await expect(page.getByText("GitHub connected")).toBeVisible();
    await expect(
      page.getByText(/Connected as sprintflow-e2e \(/),
    ).toBeVisible();
    await expect(page.getByText(/ghp_••••/)).toBeVisible();
    await expect(page.getByText(/Monitoring/)).toBeVisible();
  });
});
