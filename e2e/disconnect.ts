import { expect, type Page } from "@playwright/test";

/**
 * Which of the dialog's two outcomes the helper takes (S-26).
 *
 * `clear` is the DEFAULT here, and deliberately not the default the product
 * offers. In the product the keeping button is primary, because a lead who
 * disconnects almost never means "destroy what I typed". In the suite the
 * opposite is true: every caller disconnects to put the shared `storageState`
 * account back into a genuinely empty state, and `keep` no longer delivers that
 * — `monitored_repo.credential_id` is `SET NULL` since `0021`, so the rows
 * survive the credential and `monitoredRepo` (one of `isOnboardingComplete`'s
 * six probes) stays satisfied. `e2e/seed.spec.ts:34` and
 * `e2e/dashboard-sprint-detail.spec.ts:51` both rest on that account being left
 * un-onboarded, so the cleanup path has to be the destructive one.
 */
export type DisconnectMode = "keep" | "clear";

/**
 * Disconnect an integration from the setup wizard, choosing one of the S-26
 * dialog's two outcomes.
 *
 * Both setup specs disconnect twice each — once as a pre-step, once in
 * `afterEach` — and all four call sites broke the moment the confirmation
 * landed. One helper keeps them from drifting apart again, and keeps
 * `e2e/seed.spec.ts` and `e2e/dashboard-sprint-detail.spec.ts` able to rely on
 * the shared account being left un-onboarded.
 *
 * ⚠️ `{ exact: true }` everywhere is load-bearing, not tidiness. `getByRole`'s
 * `name` defaults to a case-insensitive SUBSTRING match, so with the dialog open
 * `{ name: "Disconnect" }` resolves to two nodes (the trigger and, until S-26,
 * the dialog's "Disconnect GitHub") and `{ name: "Connect" }` to three —
 * *Dis**connect***, *Re**connect*** and *Dis**connect** GitHub*. Every one of
 * those is a strict-mode violation.
 *
 * Since S-26 the dialog has TWO actions and neither says "Disconnect": the
 * substring rule makes a `Disconnect X` / `Disconnect X and delete data` pair
 * unusable even under `{ exact: true }`, because the longer contains the
 * shorter. `disconnect-confirm-copy.test.ts` holds the three strings mutually
 * non-containing; the labels below are that decision's output, not a choice this
 * file gets to make.
 */
export async function disconnectIfConnected(
  page: Page,
  integration: "GitHub" | "Jira",
  mode: DisconnectMode = "clear",
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Disconnect", exact: true });
  if (!(await trigger.isVisible().catch(() => false))) return;

  await trigger.click();

  // The dialog's actions are labelled differently from its trigger precisely so
  // the three are distinguishable here (and to a screen reader).
  const label =
    mode === "keep"
      ? `Keep my ${integration} data`
      : `Delete my ${integration} data`;
  await page.getByRole("button", { name: label, exact: true }).click();

  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
}
