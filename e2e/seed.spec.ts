import { expect, test } from "@playwright/test";

/**
 * SEED TEST — the reference every generated E2E test in this project is modeled on.
 *
 * "What you show is what you get." If this file uses `getByRole` and waits for
 * state, generated tests do too. If it used a CSS selector or `waitForTimeout`,
 * every future test would inherit that anti-pattern. Treat this as the canonical
 * example, not a throwaway smoke test.
 *
 * The four patterns a good seed must demonstrate (see
 * `.claude/skills/10x-e2e/references/seed-test-pattern.md`):
 *   1. Role-based locators — `getByRole` / `getByLabel` / `getByText`, never CSS/XPath.
 *   2. Test independence — each test does its own setup, action, assertion, cleanup.
 *   3. Wait for state, not time — `toBeVisible()`, `waitForURL()`, `waitForResponse()`;
 *      never `page.waitForTimeout()`.
 *   4. Risk-tied assertions — the test name binds it to a risk/requirement, and the
 *      assertion would FAIL if that risk materialized.
 *
 * These map 1:1 to the five agent anti-patterns in
 * `.claude/skills/10x-e2e/references/e2e-anti-patterns.md`.
 *
 * Auth model: the `chromium` project starts already authenticated via the state
 * saved by `auth.setup.ts` (see `playwright.config.ts`). Tests that must run as
 * a signed-OUT user opt out with `test.use({ storageState: ... empty })`.
 */

test.describe("dashboard (authenticated — uses saved storageState)", () => {
  /**
   * Risk-tied: FR-001 + US-01 — a signed-in lead reaches their app surface.
   * Runs authenticated for free (no UI login here) because the setup project
   * already saved the session. If the session/guard chain broke, `requireSession`
   * would redirect to /login and the dashboard heading would never appear.
   */
  test("authenticated user can view the dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for STATE (the heading rendering), not a fixed duration. Assert the
    // real authenticated surface, not just the URL.
    await expect(
      page.getByRole("heading", { name: /Dashboard/ }),
    ).toBeVisible();
    await expect(page.getByText(/Signed in as/)).toBeVisible();
  });
});

test.describe("route guard (signed out)", () => {
  // Drop the saved session so these tests run as an unauthenticated visitor.
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * Risk-tied: PRD "Access Control" — "Unauthenticated requests to gated routes
   * are redirected to sign-in." Adjacent to Risk #4 (cross-account isolation):
   * the gate is the first line that must hold before ownership checks matter.
   *
   * The cleanest exemplar: crosses real boundaries (routing + middleware +
   * session check) with NO side effects, so it needs no cleanup and can run in
   * any order, in parallel, alone. The assertion fails exactly when the risk
   * materializes — a broken guard leaves the URL on /dashboard.
   */
  test("unauthenticated request to a gated route is redirected to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await page.waitForURL("**/login");
    // Assert the sign-in form actually rendered. `CardTitle` is a <div> (no
    // heading role), so target the submit button — a real role + accessible
    // name that proves the login surface is shown.
    await expect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });
});
