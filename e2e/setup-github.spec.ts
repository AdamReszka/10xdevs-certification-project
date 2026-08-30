import { expect, test } from "@playwright/test";

import { disconnectIfConnected } from "./disconnect";

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
  // Both tests drive the ONE GitHub credential of the suite's shared
  // `storageState` account, so they are not independent of each other: under
  // `fullyParallel: true` each would see the other's connect/disconnect. Serial
  // is the honest declaration of that shared resource.
  test.describe.configure({ mode: "serial" });

  // Test independence: leave the account with no GitHub credential, whatever
  // state this test left it in, so a re-run starts from the connect form.
  test.afterEach(async ({ page }) => {
    await page.goto("/setup/github");
    await disconnectIfConnected(page, "GitHub");
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
    await disconnectIfConnected(page, "GitHub");

    // Stage 1 — validate the token (no write yet, FR-002).
    await page.getByLabel("Personal access token").fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();

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

  /**
   * Risk-tied (S-24): **Cancel actually cancels.** This is the one thing the
   * manual rows cannot cheaply re-prove on every run — a regression that wired
   * the dialog's Cancel to the Server Action would pass every other check in
   * this suite, and the cost of missing it is an account's whole synced history.
   */
  test("Disconnect asks first, and Cancel leaves the connection intact", async ({
    page,
  }) => {
    await page.goto("/setup/github");

    // Reach the connected state this test is about.
    await disconnectIfConnected(page, "GitHub");
    await page.getByLabel("Personal access token").fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Choose repositories to monitor")).toBeVisible();
    await page.getByRole("checkbox", { name: "sprintflow-e2e/frontend" }).check();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByText("GitHub connected")).toBeVisible();

    // The click no longer destroys anything on its own — it asks.
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // It NAMES what each outcome does with the repositories and their synced
    // artefacts (the house convention), so the lead is not consenting to an
    // unspecified deletion. Since S-26 those two clauses live on DIFFERENT
    // branches: the default keeps them, and only the second button removes them.
    await expect(dialog).toContainText(
      "the monitored repositories and everything synced from them, which are re-linked when you reconnect",
    );
    await expect(dialog).toContainText(
      "Choosing \u201cDelete my GitHub data\u201d also removes the list of monitored repositories and every commit, pull request and code review synced from them",
    );

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    // Still connected: the card is there and the connect form is NOT.
    await expect(page.getByText("GitHub connected")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    // The assertion that fails without `exact: true` — the visible *Disconnect*
    // trigger substring-matches "Connect".
    await expect(
      page.getByRole("button", { name: "Connect", exact: true }),
    ).toHaveCount(0);
  });

  /**
   * Risk-tied (S-26): **the choice exists, and a locator can tell the three
   * controls apart.** `disconnect-confirm-copy.test.ts` already holds the three
   * strings mutually non-containing as pure data; what it cannot see is the
   * rendered dialog. `getByRole`'s `name` is a case-insensitive SUBSTRING match,
   * so a relabelling to `Disconnect GitHub` / `Disconnect GitHub and delete data`
   * would keep every copy test green while making every locator in this suite —
   * and every screen-reader announcement — ambiguous. The `toHaveCount(1)` calls
   * are the assertion that fails in that world.
   */
  test("the dialog offers two outcomes, and all three controls are distinguishable", async ({
    page,
  }) => {
    await page.goto("/setup/github");

    // Reach the connected state this test is about.
    await disconnectIfConnected(page, "GitHub");
    await page.getByLabel("Personal access token").fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Choose repositories to monitor")).toBeVisible();
    await page.getByRole("checkbox", { name: "sprintflow-e2e/frontend" }).check();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByText("GitHub connected")).toBeVisible();

    // Closed, the trigger is the page's only "Disconnect" — the state every
    // caller of `disconnectIfConnected` starts from.
    const trigger = page.getByRole("button", { name: "Disconnect", exact: true });
    await expect(trigger).toHaveCount(1);
    await trigger.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // Three controls. Deliberately WITHOUT `exact` — `getByRole`'s default is a
    // case-insensitive substring match, so `toHaveCount(1)` here is the mutual
    // non-containment assertion: it fails if any other button's name contains
    // this one, which is precisely what a `Disconnect GitHub` /
    // `Disconnect GitHub and delete data` pair would do.
    const keep = dialog.getByRole("button", { name: "Keep my GitHub data" });
    const clear = dialog.getByRole("button", { name: "Delete my GitHub data" });
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    await expect(keep).toHaveCount(1);
    await expect(clear).toHaveCount(1);
    await expect(cancel).toHaveCount(1);

    // No action re-uses the trigger's word at all. (The trigger itself is out of
    // the accessibility tree while the modal is open — Radix `aria-hidden`s the
    // rest of the page — so this counts dialog buttons only, which is the half
    // that is this dialog's to keep true.)
    await expect(dialog.getByRole("button", { name: "Disconnect" })).toHaveCount(
      0,
    );

    // Leave the connection intact; `afterEach` owns the cleanup.
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("GitHub connected")).toBeVisible();
  });
});
