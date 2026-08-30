import { describe, expect, it } from "vitest";

import {
  disconnectConfirmLabel,
  disconnectDescription,
  disconnectTitle,
  type DisconnectIntegration,
} from "./disconnect-confirm-copy";

/**
 * The ASSEMBLED dialog copy (S-24, impl-review F3).
 *
 * `disconnect-impact.test.ts` holds the individual fragments equal to the
 * schema's foreign-key graph. This file covers the other half — that the
 * fragments actually compose into a readable sentence, and that the two
 * promises the lead relies on survive any edit to those fragments.
 */

const INTEGRATIONS: DisconnectIntegration[] = ["github", "jira"];

describe("disconnect dialog copy", () => {
  it.each(INTEGRATIONS)("%s: reads as prose, not a joined list", (integration) => {
    const text = disconnectDescription(integration);

    // Three sentences: what goes, what stays, what reconnecting does.
    expect(text.match(/\. /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/^This deletes /);
    expect(text).toContain(". It keeps ");
    expect(text.trim()).toMatch(/\.$/);

    // No double punctuation or empty slots from a fragment list edit.
    expect(text).not.toMatch(/\.\./);
    expect(text).not.toMatch(/,\s*\./);
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).not.toContain("and .");
  });

  it.each(INTEGRATIONS)(
    "%s: the confirm label differs from the trigger label",
    (integration) => {
      // Both would otherwise be a button named "Disconnect", which no
      // screen-reader user and no Playwright locator could tell apart.
      expect(disconnectConfirmLabel(integration)).not.toBe("Disconnect");
      expect(disconnectConfirmLabel(integration)).toMatch(/^Disconnect \w+$/);
      expect(disconnectTitle(integration)).toMatch(/^Disconnect \w+\?$/);
    },
  );

  it("the Jira dialog says the hand-entered absences do not come back", () => {
    // The one irreplaceable item in either list. If a future fragment edit
    // drops it, the lead consents to a loss nobody told them about.
    const text = disconnectDescription("jira");
    expect(text).toContain("absences");
    expect(text).toMatch(/cannot be synced back/);
    expect(text).toMatch(/nothing entered by hand comes back/);
  });

  it("the GitHub dialog names the repositories and the synced history", () => {
    const text = disconnectDescription("github");
    expect(text).toContain("monitored repositories");
    expect(text).toContain("commit, pull request and code review");
  });

  it("both dialogs say what SURVIVES, not only what is destroyed", () => {
    // The house copy shape (`confirm-dialog.tsx`): name what disappears
    // alongside what stays, so the prompt is not pure alarm.
    for (const integration of INTEGRATIONS) {
      const text = disconnectDescription(integration);
      expect(text).toContain("It keeps ");
      expect(text).toContain("team roster");
    }
  });

  it("each dialog names the OTHER integration as surviving", () => {
    expect(disconnectDescription("github")).toContain("Jira connection");
    expect(disconnectDescription("jira")).toContain("GitHub connection");
  });
});
