import { describe, expect, it } from "vitest";

import { DISCONNECT_IMPACT } from "@/lib/integrations/disconnect-impact";
import {
  PROJECT_SWITCH_TRIGGER_LABEL,
  projectSwitchClearLabel,
  projectSwitchDiscardedDescription,
  projectSwitchKeepLabel,
  projectSwitchWarning,
} from "./jira-project-editor-copy";

/**
 * The ASSEMBLED project-switch copy (S-26 Phase 4), the sibling of
 * `disconnect-confirm-copy.test.ts` for the third path into the same loss.
 *
 * `disconnect-impact.test.ts` holds the individual fragments equal to the
 * schema's foreign-key graph. This file covers the other half: that they
 * compose into readable prose, that the sentence naming the destructive control
 * quotes that control's ACTUAL label, and that the two labels stay tellable
 * apart by a screen reader and by Playwright.
 */

describe("project-switch warning copy", () => {
  it("reads as prose, not a joined list", () => {
    const text = projectSwitchWarning("SF");

    expect(text).toContain("a project other than SF");
    expect(text).toContain(". It keeps ");
    expect(text.match(/\. /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(text.trim()).toMatch(/\.$/);

    // No double punctuation or empty slots from a fragment-list edit.
    expect(text).not.toMatch(/\.\./);
    expect(text).not.toMatch(/,\s*\./);
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).not.toContain("and .");
  });

  it("falls back to a generic phrase when no project is configured", () => {
    expect(projectSwitchWarning(null)).toContain("a different project");
    expect(projectSwitchWarning(null)).not.toContain("null");
  });

  it("names the destructive control with that control's own label", () => {
    // The sentence and the button must be held equal here, or a later label
    // edit leaves the prose pointing at a control that no longer exists.
    expect(projectSwitchWarning("SF")).toContain(`“${projectSwitchClearLabel()}”`);
  });

  it("says the absences survive the default outcome and go on the other", () => {
    const text = projectSwitchWarning("SF");
    // The whole point of the slice, on this surface: `keeps` carries the
    // cross-project semantics, `clears` carries the irreversible loss.
    expect(text).toContain("stay with the team rather than with the project");
    expect(text).toContain("cannot be synced back");
    // …and the unconditional half must not still claim the absences go.
    expect(DISCONNECT_IMPACT.projectSwitch.destroys.join(" ")).not.toContain("absences");
  });

  it("neither control label collides with the other or with the trigger", () => {
    const all = [
      PROJECT_SWITCH_TRIGGER_LABEL,
      projectSwitchKeepLabel(),
      projectSwitchClearLabel(),
    ];

    // `getByRole`'s `name` is a case-insensitive SUBSTRING match, so a pair
    // sharing a prefix is a strict-mode violation the moment both exist. None
    // of the three may contain another, in either direction.
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        expect(a.toLowerCase()).not.toContain(b.toLowerCase());
      }
    }
  });
});

describe("project-switch outcome summary", () => {
  it("reports the clear branch as an additional, deliberate removal", () => {
    const text = projectSwitchDiscardedDescription("clear");

    expect(text).toContain("As you asked");
    expect(text).toContain("cannot be synced back");
    expect(text).toContain("daily recaps were kept");
  });

  it("reports the keep branch as the absences surviving", () => {
    const text = projectSwitchDiscardedDescription("keep");

    // Understating the loss is the defect on one branch; overstating it on the
    // other is how a lead is frightened off the safe path.
    expect(text).toContain("absences were kept");
    expect(text).not.toContain("cannot be synced back");
  });

  it.each(["keep", "clear"] as const)(
    "%s: says the cadence STAYS WITH the old project, never that it reattaches (S-30)",
    (mode) => {
      // The record is filed under the JIRA-SIDE project id and every tier of
      // `resolveCadenceFor` is scoped to it, so a switch leaves the cadence with
      // the project it was set for — it does NOT come back on the new project's
      // first sprint. This screen promised that it would, and its own button
      // then sent the lead to `/team/cadence`, where `survivingCadenceProvenance`
      // finds nothing under the new project and the page says the opposite.
      //
      // `DISCONNECT_IMPACT.projectSwitch.keeps` has said it correctly since S-30
      // landed; asserted against that entry so the two cannot drift apart again.
      const text = projectSwitchDiscardedDescription(mode);

      expect(text).toContain("stays with the project you set it for");
      expect(DISCONNECT_IMPACT.projectSwitch.keeps.join(" ")).toContain(
        "stays with the project you set it for",
      );
      expect(text).not.toMatch(/reattach/i);
    },
  );

  it.each(["keep", "clear"] as const)("%s: reads as prose", (mode) => {
    const text = projectSwitchDiscardedDescription(mode);

    expect(text.trim()).toMatch(/\.$/);
    expect(text).not.toMatch(/\.\./);
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).not.toContain("and .");
  });
});
