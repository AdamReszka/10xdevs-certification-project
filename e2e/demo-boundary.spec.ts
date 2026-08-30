import { expect, test, type BrowserContext } from "@playwright/test";

import { deleteAccountByEmail, signUpFreshAccount } from "./accounts";

/**
 * S-27 — the demo boundary is a gate, not a convention.
 *
 * Before this slice, nav → Settings → Connections → Reconnect was three clicks
 * from a demo screen to a form that overwrites a REAL credential. Nothing
 * refused: the two store actions carried no demo check and the connect routes
 * rendered their form unconditionally. The unit layer asserts the server
 * refusals; this spec asserts the layer above them — that the route does not
 * render the form at all, and that the control does not invite the click.
 *
 * WHY THIS ACCOUNT SHAPE. The persona the slice is about is the visitor who took
 * the demo door off the doorstep, so they hold ZERO credentials and
 * `/settings/connections` renders both cards in their NOT-CONNECTED branch. The
 * control is therefore labelled "Connect GitHub", not "Reconnect" — and that is
 * the likelier of the two to be met, which is why S-27 guards both branches.
 * Reaching the Reconnect state would mean connecting against
 * `e2e/github-fixture-server.mjs` first and only then loading demo — a second
 * fixture-server consumer under parallel workers, for a control the unit and
 * manual layers already cover.
 *
 * Its own timestamp-suffixed account, deleted in `afterAll`; deleting the real
 * row cascades the demo tenancy row (`demo_of` is ON DELETE CASCADE).
 */

test.describe("demo boundary — the connect route and its control", () => {
  const email = `e2e-demo-boundary-${Date.now()}@example.test`;

  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await signUpFreshAccount(browser, email, "Demo Boundary E2E");
  });

  test.afterAll(async () => {
    await deleteAccountByEmail(email);
    await context?.close();
  });

  test("in demo, /settings/connections/github redirects and Connect is disabled", async () => {
    const page = await context.newPage();

    // Into demo the way the persona gets there — the doorstep's demo door.
    await page.goto("/setup");
    await page.getByRole("button", { name: "Zobacz demo" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByText("Jesteś w trybie demonstracyjnym")).toBeVisible();

    // Typing the connect route directly is the shortest path to overwriting a
    // real credential. It must land on the parent, which already explains why.
    await page.goto("/settings/connections/github");
    await page.waitForURL("**/settings/connections");
    await expect(
      page.getByRole("heading", { name: "Connect GitHub" }),
    ).toHaveCount(0);

    // And the control that pointed there is disabled rather than merely
    // redirecting on arrival — an `<a>` ignores `disabled`, so this fails if the
    // trigger regresses to a styled link.
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Connect GitHub" })).toHaveCount(0);

    // The Jira card is the same control, and the same regression risk.
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeDisabled();

    await page.close();
  });
});
