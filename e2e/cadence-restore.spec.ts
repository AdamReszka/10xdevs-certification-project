import { expect, test, type BrowserContext } from "@playwright/test";

import { deleteAccount, signUpOnboardedAccount } from "./accounts";
import { disconnectIfConnected } from "./disconnect";

/**
 * S-30 — "Restore Jira's values" keeps the working days (FR-007).
 *
 * THE RISK, in one sentence: the restore dialog promises *"Working days are not
 * pulled from Jira and stay as they are"*, and until S-30 the code did the
 * opposite — `forceCadenceRefresh` reset them to the Mon–Fri constant, a value
 * derived from nothing, because Jira exposes no working-days field at all. The
 * contradiction was pinned GREEN by an integration test whose own comment
 * ("back to what the sprint's own Jira dates derive") was false.
 *
 * WHY BROWSER-LEVEL. The promise is a sentence on a screen, and the thing that
 * has to match it is a database write four boundaries away — session → route →
 * Server Action → Jira → transaction → resolver → re-render. Nothing below the
 * browser can assert that the dialog's words and the row's contents agree, which
 * is exactly the pair that disagreed.
 *
 * HOW IT REACHES A SPRINT ROW. `e2e/accounts.ts` is explicit that `sprint` is
 * "deliberately NOT seeded", and without one `/team/cadence` renders `no_sprint`,
 * the restore button is disabled and a save throws. So this spec MINTS a real
 * row through the real reconciler: it re-connects Jira through the wizard (which
 * upserts a genuinely encrypted token over the seeded placeholder), then presses
 * "Pull from Jira" on the wizard's cadence step.
 *
 * REAL vs MOCKED. Auth, routing, the Server Actions and Postgres are all real —
 * that is where this risk lives. Only Jira is mocked, and SERVER-SIDE
 * (`e2e/jira-fixture-server.mjs` via `JIRA_API_BASE_URL`), because these calls
 * happen inside Server Actions where `page.route()` cannot reach them.
 *
 * THE FIXTURE'S SPRINT RUNS THU→THU OVER 7 DAYS, so its derived cadence (7 /
 * Thu) differs from what this spec then sets by hand (21 / Mon). That is what
 * makes "restore returned length and start day to Jira's" an assertable CHANGE
 * rather than a coincidence — a restore that did nothing at all would leave 21 /
 * Mon on screen and fail here.
 */

const WORKSPACE = "sprintflow-e2e.atlassian.net";
const EMAIL = "e2e@example.test";
const TOKEN = "jira-e2e-fixture-token";

/** What `deriveCadence` reads off the fixture's Thu 2026-08-06 → Thu 2026-08-13. */
const JIRA_LENGTH = "7";
const JIRA_START_DAY = "Thu";

/** Deliberately unlike Jira's, so a restore is visible in both directions. */
const HAND_SET_LENGTH = "21";
const HAND_SET_START_DAY = "Mon";

test.describe("cadence — restoring Jira's values keeps the working days (S-30)", () => {
  const email = `e2e-cadence-restore-${Date.now()}@example.test`;

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
   * Risk-tied: this fails if the restore touches the working days at all. Before
   * S-30 the Fri checkbox came back CHECKED here — the lead's Mon–Thu pattern
   * silently replaced by a default, on a button whose dialog had just promised
   * the opposite.
   */
  test("restore resets length and start day but leaves a hand-set Mon–Thu alone", async () => {
    const page = await context.newPage();

    // --- Connect Jira for real, so the reconciler can reach the fixture -----
    // The seeded account carries a PLACEHOLDER encrypted token that cannot be
    // decrypted, so the wizard has to write a real envelope over it. It renders
    // the CONNECTED card for that seeded row, so the form is reached by
    // disconnecting first — `clear` for the same reason every other spec uses
    // it, to start from a genuinely empty state.
    await page.goto("/setup/jira");
    await disconnectIfConnected(page, "Jira");

    await page.getByLabel("Workspace URL").fill(WORKSPACE);
    await page.getByLabel("Account email").fill(EMAIL);
    await page.getByLabel("API token").fill(TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page.getByText("Choose a project to monitor")).toBeVisible();
    await page.getByRole("radio", { name: /SF.*SprintFlow/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Map workflow statuses")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Jira connected")).toBeVisible();

    // --- Mint a REAL sprint row through the real reconciler -----------------
    await page.goto("/setup/team");
    await page.getByRole("button", { name: "Pull from Jira" }).click();
    // Wait for STATE: the pull has landed when the form holds Jira's derived
    // length. Nothing here waits on a duration.
    await expect(page.getByLabel("Sprint length (days)")).toHaveValue(
      JIRA_LENGTH,
    );

    // --- Set a cadence by hand on the post-setup editor ---------------------
    await page.goto("/team/cadence");
    await expect(
      page.getByRole("heading", { name: "Sprint cadence" }),
    ).toBeVisible();

    await page.getByLabel("Sprint length (days)").fill(HAND_SET_LENGTH);
    await page.getByRole("combobox", { name: "Sprint start day" }).click();
    await page.getByRole("option", { name: HAND_SET_START_DAY }).click();
    // Mon–Thu: drop Friday from SprintFlow's own Mon–Fri default.
    await page.getByRole("checkbox", { name: "Fri" }).uncheck();
    await page.getByRole("button", { name: "Save cadence" }).click();

    // The save reports PER FIELD since S-30, and all three are the lead's here.
    await expect(page.getByText("Cadence saved")).toBeVisible();
    await expect(
      page.getByText(/stop taking the sprint length and start day from Jira/),
    ).toBeVisible();

    // --- Restore, and confirm the dialog's own promise ----------------------
    await page.getByRole("button", { name: "Restore Jira’s values" }).click();
    await expect(
      page.getByText(/Working days are not pulled from Jira and stay as they are/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Restore from Jira" }).click();

    await expect(page.getByText("Restored from Jira")).toBeVisible();

    // Length and start day DID go back to what the sprint's Jira dates derive…
    await expect(page.getByLabel("Sprint length (days)")).toHaveValue(
      JIRA_LENGTH,
    );
    await expect(
      page.getByRole("combobox", { name: "Sprint start day" }),
    ).toContainText(JIRA_START_DAY);

    // …and the working days did NOT. This is the assertion the whole slice is
    // for: Friday stays OFF, and Mon–Thu stay on.
    await expect(page.getByRole("checkbox", { name: "Fri" })).not.toBeChecked();
    for (const day of ["Mon", "Tue", "Wed", "Thu"]) {
      await expect(page.getByRole("checkbox", { name: day })).toBeChecked();
    }

    // And it survives a real SSR reload — the restore wrote it, the screen is
    // not just remembering it.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Fri" })).not.toBeChecked();
    await expect(page.getByLabel("Sprint length (days)")).toHaveValue(
      JIRA_LENGTH,
    );

    await page.close();
  });
});
