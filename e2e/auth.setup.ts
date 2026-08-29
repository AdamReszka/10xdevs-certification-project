import { expect, test as setup } from "@playwright/test";

import { STORAGE_STATE } from "../playwright.config";

/**
 * Authentication setup project — runs once before the main suite.
 *
 * This is the storageState pattern from Playwright's official auth docs: sign in
 * a single time here, persist the browser's authenticated state to disk, and let
 * every test in the `chromium` project bootstrap from it. No test logs in through
 * the UI on its own — that's slow and couples every test to the login form.
 *
 * We SIGN UP a fresh account each run (unique timestamp email) rather than
 * depending on a pre-seeded user, so the suite is self-contained on any clean
 * database. autoSignIn is enabled, so a successful sign-up lands authenticated.
 *
 * THE DESTINATION IS THE DOORSTEP, NOT THE DASHBOARD (`onboarding-routing`
 * Phase 3). The sign-up form still pushes to `/dashboard`, but the first-run
 * gate there sends an un-onboarded account to `/setup`. This project's job is a
 * SESSION, not a destination — and the account is left deliberately
 * un-onboarded, because `setup-github.spec.ts` and `setup-jira.spec.ts` need it
 * that way. Specs that assert the real dashboard take their own onboarded
 * account from `e2e/accounts.ts`.
 */
setup("authenticate", async ({ page }) => {
  const email = `e2e-user-${Date.now()}@example.test`;
  const password = "Sprint-Flow-1!";

  await page.goto("/signup");

  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait until the session cookie is set and the app has navigated to a GATED
  // surface — proof we are actually authenticated before saving state. For a
  // brand-new account that surface is the first-run doorstep.
  await page.waitForURL("**/setup");
  await expect(page.getByRole("heading", { name: "Zaczynamy" })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
