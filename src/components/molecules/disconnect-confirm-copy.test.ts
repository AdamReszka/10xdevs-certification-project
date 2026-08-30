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
    // The opening varies since S-26: a GitHub disconnect destroys nothing, so
    // an empty `destroys` gets its own sentence instead of a hole in this one.
    expect(text).toMatch(/^This (deletes|removes) /);
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

  it("the Jira dialog says the hand-entered absences SURVIVE", () => {
    // The inversion of the S-24 assertion this replaces. Absences are still the
    // one irreplaceable item in either list, so the sentence about them is
    // still load-bearing — but the true sentence is now that they stay. A
    // dialog that keeps threatening a loss it no longer inflicts frightens the
    // lead off the safe path just as effectively as one that hides a real loss.
    const text = disconnectDescription("jira");
    expect(text).toContain("absences");
    expect(text).toMatch(/It keeps [^.]*absences/);
    expect(text).not.toMatch(/cannot be synced back/);
    expect(text).not.toMatch(/nothing entered by hand comes back/);
  });

  it("the GitHub dialog names the repositories and the synced history as surviving", () => {
    const text = disconnectDescription("github");
    expect(text).toContain("monitored repositories");
    expect(text).toMatch(/It keeps [^.]*monitored repositories/);
    // Nothing below the credential dies, so there is no deletion list to name.
    expect(text).toMatch(/^This removes the connection itself\./);
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
