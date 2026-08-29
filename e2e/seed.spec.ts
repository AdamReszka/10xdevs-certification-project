import { expect, test, type BrowserContext } from "@playwright/test";

import { deleteAccount, signUpOnboardedAccount } from "./accounts";

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

test.describe("dashboard (authenticated)", () => {
  /**
   * ISOLATION (`onboarding-routing` Phase 3): `/dashboard` is gated on
   * `isOnboardingComplete`, and the suite's shared `storageState` account is
   * deliberately left un-onboarded — the setup specs disconnect its integrations
   * in `afterEach`, so under `fullyParallel` its onboarding state is a coin
   * flip. This describe asserts the REAL dashboard, so it takes an account that
   * satisfies the predicate by construction.
   */
  const email = `e2e-seed-dashboard-${Date.now()}@example.test`;

  let context: BrowserContext;
  let ownerId: string;

  test.beforeAll(async ({ browser }) => {
    ({ context, ownerId } = await signUpOnboardedAccount(browser, email));
  });

  test.afterAll(async () => {
    if (ownerId) await deleteAccount(ownerId);
    await context?.close();
  });

  /**
   * Risk-tied: FR-001 + US-01 — a signed-in lead reaches their app surface.
   * No UI login here: the account is signed up through the auth API. If the
   * session/guard chain broke, `requireSession` would redirect to /login and the
   * dashboard heading would never appear.
   */
  test("authenticated user can view the dashboard", async () => {
    const page = await context.newPage();
    await page.goto("/dashboard");

    // Wait for STATE (the heading rendering), not a fixed duration. Assert the
    // real authenticated surface, not just the URL.
    await expect(
      page.getByRole("heading", { name: /Dashboard/ }),
    ).toBeVisible();
    // Authenticated chrome from `(app)/layout.tsx`: the shell only renders a
    // sign-out control once `requireSession()` has resolved a real session.
    //
    // STALE-ASSERTION REPAIR (S-10): this line used to look for "Signed in as",
    // copy that S-07 removed in cfba761 when it replaced the shell's user slot.
    // The assertion has been red on main ever since — nothing regressed here,
    // the test was simply never updated. The behavior under test is unchanged.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.close();
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
