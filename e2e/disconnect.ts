import { expect, type Page } from "@playwright/test";

/**
 * Disconnect an integration from the setup wizard, confirming the S-24 dialog.
 *
 * Both setup specs disconnect twice each — once as a pre-step, once in
 * `afterEach` — and all four call sites broke the moment the confirmation
 * landed. One helper keeps them from drifting apart again, and keeps
 * `e2e/seed.spec.ts` and `e2e/dashboard-sprint-detail.spec.ts` able to rely on
 * the shared account being left un-onboarded.
 *
 * ⚠️ `{ exact: true }` everywhere is load-bearing, not tidiness. `getByRole`'s
 * `name` defaults to a case-insensitive SUBSTRING match, so with the dialog open
 * `{ name: "Disconnect" }` resolves to two nodes (the trigger and the dialog's
 * "Disconnect GitHub") and `{ name: "Connect" }` to three — *Dis**connect***,
 * *Re**connect*** and *Dis**connect** GitHub*. Every one of those is a
 * strict-mode violation.
 */
export async function disconnectIfConnected(
  page: Page,
  integration: "GitHub" | "Jira",
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Disconnect", exact: true });
  if (!(await trigger.isVisible().catch(() => false))) return;

  await trigger.click();

  // The dialog's action is labelled differently from its trigger precisely so
  // the two are distinguishable here (and to a screen reader).
  await page
    .getByRole("button", { name: `Disconnect ${integration}`, exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
}
