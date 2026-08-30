import { describe, expect, it } from "vitest";

import {
  disconnectClearLabel,
  disconnectDescription,
  disconnectKeepLabel,
  disconnectTitle,
  type DisconnectIntegration,
} from "./disconnect-confirm-copy";

/**
 * The ASSEMBLED dialog copy (S-24, impl-review F3; extended by S-26 Phase 3).
 *
 * `disconnect-impact.test.ts` holds the individual fragments equal to the
 * schema's foreign-key graph. This file covers the other half — that the
 * fragments actually compose into a readable sentence, that the promises the
 * lead relies on survive an edit to those fragments, and that the two button
 * labels stay tellable apart by a screen reader and by Playwright.
 */

const INTEGRATIONS: DisconnectIntegration[] = ["github", "jira"];

/** The trigger that opens the dialog. Its label is fixed in `integration-card.tsx`. */
const TRIGGER_LABEL = "Disconnect";

describe("disconnect dialog copy", () => {
  it.each(INTEGRATIONS)("%s: reads as prose, not a joined list", (integration) => {
    const text = disconnectDescription(integration);

    // At least three sentences: what goes, what stays, what reconnecting does.
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
    "%s: neither button label collides with the other or with the trigger",
    (integration) => {
      const keep = disconnectKeepLabel(integration);
      const clear = disconnectClearLabel(integration);
      const all = [TRIGGER_LABEL, keep, clear];

      // The invariant, and it is stronger than "differs from the trigger".
      // `getByRole`'s `name` is a case-insensitive SUBSTRING match, so
      // "Disconnect Jira" / "Disconnect Jira and delete data" would be a
      // strict-mode violation even with `{ exact: true }` on the trigger — the
      // longer label contains the shorter one. None of the three may contain
      // another, in either direction.
      for (const a of all) {
        for (const b of all) {
          if (a === b) continue;
          expect(a.toLowerCase()).not.toContain(b.toLowerCase());
        }
      }

      // Neither action re-uses the word the trigger and the title own.
      expect(keep).not.toContain(TRIGGER_LABEL);
      expect(clear).not.toContain(TRIGGER_LABEL);
      // The title is where "Disconnect" is still said.
      expect(disconnectTitle(integration)).toMatch(/^Disconnect \w+\?$/);
    },
  );

  it.each(INTEGRATIONS)(
    "%s: the two labels say which outcome each produces",
    (integration) => {
      // A pair of buttons the lead cannot tell apart is the failure this slice
      // exists to avoid: the whole point is that keeping is a real choice.
      expect(disconnectKeepLabel(integration)).toMatch(/^Keep /);
      expect(disconnectClearLabel(integration)).toMatch(/^Delete /);
      expect(disconnectKeepLabel(integration)).not.toBe(
        disconnectClearLabel(integration),
      );
    },
  );

  it("the Jira dialog says the hand-entered absences SURVIVE by default", () => {
    // The inversion of the S-24 assertion this replaces. Absences are still the
    // one irreplaceable item in either list, so the sentence about them is
    // still load-bearing — but the true sentence under the DEFAULT outcome is
    // now that they stay. A dialog that keeps threatening a loss it no longer
    // inflicts frightens the lead off the safe path just as effectively as one
    // that hides a real loss.
    const text = disconnectDescription("jira");
    expect(text).toContain("absences");
    expect(text).toMatch(/It keeps [^.]*absences/);
    expect(text).not.toMatch(/nothing entered by hand comes back/);
  });

  it.each(INTEGRATIONS)(
    "%s: the clear sentence names the button that produces it",
    (integration) => {
      // Describing a destructive alternative without saying which control
      // produces it is how a lead ends up clicking to find out. Quoting the
      // label here is also what keeps the prose and the button equal after a
      // later label edit.
      const text = disconnectDescription(integration);
      expect(text).toContain(`Choosing “${disconnectClearLabel(integration)}” also removes `);
    },
  );

  it("the Jira clear sentence carries the warning that used to be a threat", () => {
    // Moved, not deleted (S-26 Phase 3): "cannot be synced back" is true of the
    // clear branch and only of it.
    const text = disconnectDescription("jira");
    const [, clearOnwards] = text.split(`Choosing “${disconnectClearLabel("jira")}”`);

    expect(clearOnwards).toMatch(/cannot be synced back/);
    // …and it must NOT appear in the part that describes the default outcome.
    const [defaultPart] = text.split("Choosing “");
    expect(defaultPart).not.toMatch(/cannot be synced back/);
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
