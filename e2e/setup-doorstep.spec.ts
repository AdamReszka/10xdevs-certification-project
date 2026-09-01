import { expect, test, type BrowserContext } from "@playwright/test";

import { PASSWORD, deleteAccountByEmail, signUpFreshAccount } from "./accounts";

/**
 * `onboarding-routing` — the first-run doorstep and the `/dashboard` gate.
 *
 * THE BEHAVIOUR THIS WHOLE CHANGE EXISTS FOR, tested through the real routing
 * path on a genuinely empty account. `lessons.md` names the requirement: "test
 * the no-configuration path through the real resolver, not through an injected
 * dependency" — so nothing here mocks `isOnboardingComplete`, and every account
 * below is a real sign-up against real Postgres.
 *
 * Risks protected:
 *   1. A new account lands on a dashboard of zeros instead of the doorstep —
 *      the symptom this change was opened for.
 *   2. The doorstep offers a way out of itself. Its whole design is two doors;
 *      four nav links in the header would be four more, and the first-run
 *      destination would stop being a destination.
 *   3. `/dashboard` typed directly slips past the gate. A gate that only fires
 *      on the post-sign-up push is not a gate.
 *   4. The demo door sends the visitor into the wizard it exists to avoid
 *      (FR-008 / US-02) — the one case where the gate must NOT fire.
 *
 * Every test signs up its own timestamp-suffixed account and deletes it in
 * `afterAll`, so the specs are independent, re-runnable, and parallel-safe.
 */

test.describe("first run — the doorstep is where a new account lands", () => {
  // Sign up through the UI here, deliberately: the risk is the DESTINATION of
  // the real post-sign-up navigation, which the API path never performs.
  test.use({ storageState: { cookies: [], origins: [] } });

  const email = `e2e-doorstep-signup-${Date.now()}@example.test`;

  // Keyed on the email, not on an id captured inside the test: the account is
  // created by the UI form, so an early failure would otherwise leak it.
  test.afterAll(async () => {
    await deleteAccountByEmail(email);
  });

  /**
   * Risk-tied: risks 1 and 2. Before this change the sign-up form pushed
   * straight to `/dashboard`, which rendered the full S-07/S-10 surface against
   * an empty account. If the gate regressed, the URL would settle on
   * `/dashboard`; if the nav suppression regressed, the header links would be
   * visible and the doorstep would have five exits it is not supposed to offer
   * (five since S-19 added Team to the nav).
   */
  test("signing up lands on the doorstep, with two doors and no navigation", async ({
    page,
  }) => {
    await page.goto("/signup");

    await page.getByLabel("Name").fill("Doorstep E2E");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL("**/setup");
    await expect(page.getByRole("heading", { name: "Zaczynamy" })).toBeVisible();

    // Both doors, and nothing else to click: configure, or look around. Both are
    // BUTTONS since S-27 — the configure door leaves demo before it navigates,
    // so it can no longer be a bare `<a href>`.
    await expect(page.getByRole("button", { name: "Podłącz GitHuba" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zobacz demo" })).toBeVisible();

    // No navigation out. Asserted per link rather than on the <nav> element, so
    // this fails on a partial regression too.
    for (const label of [
      "Dashboard",
      "Sprint Detail",
      "Team",
      "Settings",
      "Refinement",
    ]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }

    // Sign-out stays reachable — the doorstep is a destination, not a trap.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("first run — the gate on /dashboard", () => {
  const email = `e2e-doorstep-gate-${Date.now()}@example.test`;

  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await signUpFreshAccount(browser, email, "Doorstep Gate E2E");
  });

  test.afterAll(async () => {
    await deleteAccountByEmail(email);
    await context?.close();
  });

  /**
   * Risk-tied: risk 3. A gate wired only into the sign-up form's push target
   * would leave `/dashboard` reachable by typing it, by a bookmark, or by the
   * `(auth)` layout's redirect for an already-signed-in visitor. This account
   * has a valid session and zero configuration — exactly that case.
   */
  test("an un-onboarded account typing /dashboard is sent to the doorstep", async () => {
    const page = await context.newPage();
    await page.goto("/dashboard");

    await page.waitForURL("**/setup");
    await expect(page.getByRole("heading", { name: "Zaczynamy" })).toBeVisible();

    await page.close();
  });
});

test.describe("first run — the demo door", () => {
  const email = `e2e-doorstep-demo-${Date.now()}@example.test`;
  // A SECOND account, created through the UI form inside the test — the API
  // context above cannot perform the client-side push that plants the stale
  // Client Cache entry this test exists to catch.
  const uiEmail = `e2e-doorstep-demo-ui-${Date.now()}@example.test`;

  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await signUpFreshAccount(browser, email, "Doorstep Demo E2E");
  });

  test.afterAll(async () => {
    // Deleting the real account cascades its demo tenancy row (`demo_of` is
    // ON DELETE CASCADE) and everything the demo fixture wrote under it.
    await deleteAccountByEmail(email);
    await deleteAccountByEmail(uiEmail);
    await context?.close();
  });

  /**
   * Risk-tied: risk 4, the half of the PRD a plain redirect would have broken.
   * US-02 promises a visitor can explore without ever touching real Jira or
   * GitHub; the gate must therefore short-circuit on `isDemo` BEFORE consulting
   * the onboarding predicate. If that ordering were reversed — or the demo door
   * simply forgotten — the second `goto` below would bounce back to `/setup`
   * and this test would fail on a visitor holding zero real credentials.
   */
  test("the demo door lands on a populated dashboard the gate no longer redirects", async ({
    browser,
  }) => {
    // SIGNS UP THROUGH THE UI, in this page, so the test walks the real path a
    // visitor walks: form → `router.push("/dashboard")` → gate → `/setup` →
    // demo door. The API-authenticated context above never performs that
    // client-side push.
    //
    // HONEST LIMIT — THIS DOES NOT REPRODUCE THE 2026-09-01 PRODUCTION DEFECT,
    // and it was verified not to: with the pre-fix `router.push("/dashboard")`
    // restored, this test still passes. `playwright.config.ts` boots
    // `npm run dev`, and in dev Next disables `<Link>` prefetching, so the
    // Client Cache stays nearly empty — while the production build fills it.
    // The stale `/dashboard` → `/setup` entry that made the door read as dead
    // therefore cannot form here.
    //
    // Kept anyway because it exercises the true route, and named so nobody
    // later mistakes a green run for coverage of that defect. What actually
    // guards it is the hard navigation in `workspace-navigation.ts`, which no
    // client cache can defeat, plus verification against production.
    const fresh = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await fresh.newPage();

    await page.goto("/signup");
    await page.getByLabel("Name").fill("Demo Door E2E");
    await page.getByLabel("Email").fill(uiEmail);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/setup");

    await page.getByRole("button", { name: "Zobacz demo" }).click();

    await page.waitForURL("**/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard — Today" }),
    ).toBeVisible();
    // The banner is what distinguishes the two modes — `/dashboard` looks the
    // same in both — so its presence is the proof the demo actually loaded.
    await expect(page.getByText("Jesteś w trybie demonstracyjnym")).toBeVisible();

    // And the gate stays quiet on a re-entry: still no real credentials.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard — Today" }),
    ).toBeVisible();

    await fresh.close();
  });
});
