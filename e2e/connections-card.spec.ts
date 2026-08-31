import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";
import pg from "pg";

import {
  DB_URL,
  deleteAccount,
  resolveOwnerId,
  signUpFreshAccount,
} from "./accounts";
import {
  DISCONNECT_LABEL,
  RECONNECT_LABEL,
  TEST_LABEL,
  connectLabel,
  jobsIntro,
  reconnectCost,
  selectionEditorLabel,
} from "@/components/organisms/settings/integration-card-copy";

/**
 * S-31 — the connected Connections card, which nothing tested at all.
 *
 * WHY THIS FILE EXISTS. Before S-31 no assertion anywhere — unit or browser —
 * covered a single string or control on `/settings/connections`'s CONNECTED
 * branch. `integration-card-copy.test.ts` now covers the strings as data; this
 * covers the half a pure test cannot see, which is whether the card renders them
 * at all and in what order. A sentence assembled and never mounted is green in
 * the hermetic test and invisible to the lead.
 *
 * WHY ITS OWN ACCOUNT, GITHUB ONLY. The suite's shared `storageState` account is
 * driven by `setup-github.spec.ts` and `setup-jira.spec.ts`, which connect and
 * disconnect on it in `afterEach`; under `fullyParallel: true` its connection
 * state is a coin flip (`accounts.ts` says so, and `dashboard-sprint-detail.spec.ts`
 * moved off it for the same reason). It also has to be GitHub-ONLY: `Reconnect`
 * and `Disconnect` appear on BOTH cards, so `toHaveCount(1)` is only a
 * meaningful assertion while the Jira card sits in its not-connected branch —
 * which is also what lets these locators stay role-and-name based instead of
 * reaching for a CSS selector to scope to one card.
 *
 * The credential's `encrypted_token` is a placeholder: this page never decrypts
 * it, and no test here clicks `Test connection`, which is the one control that
 * would reach the API.
 */

const email = `e2e-s31-connections-${Date.now()}@example.test`;

test.describe("settings — the connected Connections card (S-31)", () => {
  // All three tests drive ONE seeded account, and `beforeAll` runs once per
  // WORKER — so under `fullyParallel: true` a second worker re-runs the sign-up
  // with the same address and dies on `user_email_unique`. Serial is the honest
  // declaration of that shared resource, the same one `setup-github.spec.ts`
  // makes about the suite's shared credential.
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext;
  let ownerId: string;

  test.beforeAll(async ({ browser }) => {
    context = await signUpFreshAccount(browser, email);

    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    try {
      ownerId = await resolveOwnerId(client, email);

      const credId = randomUUID();
      await client.query(
        `insert into github_credential (id, owner_id, encrypted_token, token_last4, github_login)
         values ($1,$2,$3,$4,'ada-s31')`,
        [credId, ownerId, "e2e-placeholder-not-a-real-token", "0000"],
      );
      await client.query(
        `insert into monitored_repo (id, owner_id, credential_id, github_repo_id, full_name, is_active)
         values ($1,$2,$3,$4,'acme/e2e-s31',true)`,
        [randomUUID(), ownerId, credId, 930031],
      );
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    if (ownerId) await deleteAccount(ownerId);
    await context?.close();
  });

  /**
   * Risk-tied: the three jobs are on screen, once each, and a locator can tell
   * them apart. The screen now holds five labels where it held four, and
   * `getByRole`'s `name` is a case-insensitive SUBSTRING match — the invariant
   * `integration-card-copy.test.ts` asserts as data. This is the half that
   * asserts it as DOM: `toHaveCount(1)` fails if any other control's accessible
   * name contains one of these.
   */
  test("the connected card offers three jobs, each resolving to one control", async () => {
    const page = await context.newPage();
    await page.goto("/settings/connections");

    // The GitHub card is connected; the Jira one is not, which is what keeps
    // these counts unambiguous.
    await expect(page.getByText("acme/e2e-s31")).toBeVisible();
    await expect(
      page.getByRole("link", { name: connectLabel("jira"), exact: true }),
    ).toHaveCount(1);

    // Job 1 — rotate the token. A LINK, not a button: outside demo the control
    // is `<Button asChild><a>` pointing at the settings connect route.
    const reconnect = page.getByRole("link", { name: RECONNECT_LABEL, exact: true });
    await expect(reconnect).toHaveCount(1);
    await expect(reconnect).toHaveAttribute("href", "/settings/connections/github");

    // Job 2 — change what is watched.
    await expect(
      page.getByRole("button", { name: selectionEditorLabel("github"), exact: true }),
    ).toHaveCount(1);

    // Job 3 — end the integration. Still the quietest control, which is a
    // manual row (2.5); what is asserted here is that it is still exactly one
    // node under the name every other spec locates it by.
    await expect(
      page.getByRole("button", { name: DISCONNECT_LABEL, exact: true }),
    ).toHaveCount(1);
  });

  /**
   * Risk-tied: `Test connection` is a DIAGNOSTIC and sits above the jobs row,
   * and the row's own order puts the emphasised, lossless control first. The
   * whole point of the slice is which control the lead reaches for first, and
   * DOM order is what a screen reader and a keyboard user actually get.
   *
   * Asserted on document order rather than on classes: the house locator rule
   * forbids CSS selectors, and the visual weight is a manual row (2.5) because
   * a `variant` is not something a browser assertion should pin.
   */
  test("Test connection sits above the jobs row, and Reconnect leads it", async () => {
    const page = await context.newPage();
    await page.goto("/settings/connections");
    await expect(page.getByText("acme/e2e-s31")).toBeVisible();

    // Role queries return matches in document order, so the indices below are
    // the DOM order of the card's controls.
    const names = await page
      .getByRole("button")
      .or(page.getByRole("link"))
      .allInnerTexts();
    const orderOf = (label: string) =>
      names.findIndex((text) => text.trim() === label);

    const test_ = orderOf(TEST_LABEL);
    const reconnect = orderOf(RECONNECT_LABEL);
    const editor = orderOf(selectionEditorLabel("github"));
    const disconnect = orderOf(DISCONNECT_LABEL);

    expect(test_).toBeGreaterThan(-1);
    // Diagnostic first, outside the row it used to sit in.
    expect(test_).toBeLessThan(reconnect);
    // Then the three jobs, lossless route first.
    expect(reconnect).toBeLessThan(editor);
    expect(editor).toBeLessThan(disconnect);
  });

  /**
   * Risk-tied: the derived prose is actually MOUNTED. `integration-card-copy.test.ts`
   * can prove the sentences assemble correctly and stay equal to
   * `disconnect-impact.ts`; it cannot tell whether the card renders them. A
   * refactor that drops the `<p>` is green there and silent on screen, which is
   * the state this card was in before S-31 for every string it holds.
   */
  test("the intro sentence and the reconnect promise are on screen, as the module builds them", async () => {
    const page = await context.newPage();
    await page.goto("/settings/connections");
    await expect(page.getByText("acme/e2e-s31")).toBeVisible();

    await expect(page.getByText(jobsIntro("github"), { exact: true })).toBeVisible();
    await expect(
      page.getByText(reconnectCost("github", "settings"), { exact: true }),
    ).toBeVisible();

    // The wizard variant must NOT be what this surface shows — it is the one
    // that drops the clause naming the selection editor.
    await expect(
      page.getByText(reconnectCost("github", "wizard"), { exact: true }),
    ).toHaveCount(0);
  });
});
