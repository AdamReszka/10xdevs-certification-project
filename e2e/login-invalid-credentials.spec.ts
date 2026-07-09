import { expect, test } from "@playwright/test";

/**
 * Risk (auth boundary — negative direction): wrong credentials must be REJECTED.
 * The app shows an error, stays on /login, and — the security-critical part — no
 * session is created, so the gated dashboard remains unreachable.
 *
 * This is the counterpart to the seed's happy-path auth test (`seed.spec.ts`):
 * that one proves a valid session reaches the dashboard; this one proves an
 * invalid one never does. Traces to the PRD "Access Control" guardrail — the
 * gate must hold from both sides — and underpins Risk #4 (cross-account
 * isolation): isolation is meaningless if bad credentials grant a session.
 *
 * Generated via /10x-e2e (standalone), modeled on e2e/seed.spec.ts + the E2E
 * rules in e2e/README.md. Crosses real boundaries: login form → Better Auth →
 * Postgres → middleware guard → server-side requireSession(). Nothing mocked —
 * there is no external API in this flow.
 */

// Signed-out context — drop the project's saved storageState so this runs as an
// unauthenticated visitor.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login — invalid credentials", () => {
  test("wrong credentials are rejected and never create a session", async ({
    page,
  }) => {
    // A well-formed but non-existent account — unique so it can never coincide
    // with a real row, even across parallel runs / re-runs.
    const email = `nobody-${Date.now()}@example.test`;

    // Attempt sign-in with credentials that must fail.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Outcome 1 — the app surfaces an error and does NOT navigate away from
    // /login. (Web-first assertion retries until the error toast renders.)
    await expect(
      page.getByText(/could not sign in|invalid email or password/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // Outcome 2 (security-critical) — no session was created, so the gated
    // dashboard is unreachable and the guard bounces back to sign-in. If the
    // failed attempt had wrongly minted a session, this would land on
    // /dashboard and the test would fail.
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });
});
