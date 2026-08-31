import { describe, expect, it } from "vitest";

import { DISCONNECT_IMPACT } from "@/lib/integrations/disconnect-impact";
import {
  disconnectClearLabel,
  disconnectKeepLabel,
  type DisconnectIntegration,
} from "@/components/molecules/disconnect-confirm-copy";
import type { SyncStatus } from "@/lib/integrations/failure-reason";
import {
  CADENCE_RETENTION_CLAUSE,
  COMMITMENT_FREEZE_CLAUSE,
  DISCONNECT_LABEL,
  RECONNECT_LABEL,
  TEST_LABEL,
  connectLabel,
  jobsIntro,
  reconnectCost,
  selectionEditorLabel,
  statusBadge,
} from "./integration-card-copy";

/**
 * The Connections card's assembled copy (S-31 Phase 1).
 *
 * This is NEW coverage, not updated coverage: before this file no assertion
 * anywhere — unit or browser — touched a single string on the card. It has
 * three jobs.
 *
 *  1. Hold the assembled prose readable, the way
 *     `disconnect-confirm-copy.test.ts` does for the dialog.
 *  2. Hold it equal to `disconnect-impact.ts`, which its own test holds equal to
 *     the schema's foreign-key graph — so a slice that hangs a cascading child
 *     under `sprint` or `monitored_repo` breaks the card's promise here instead
 *     of turning it into a lie on screen.
 *  3. Extend the label invariant from three strings in one dialog to every
 *     label that can appear on one Connections screen.
 */

const INTEGRATIONS: DisconnectIntegration[] = ["github", "jira"];

const ALL_SYNC_STATUSES: SyncStatus[] = ["OK", "ERROR", "RATE_LIMITED"];

describe("integration card labels", () => {
  it("no label on the Connections screen contains another", () => {
    // The same invariant as `disconnect-confirm-copy.test.ts:45-71`, widened.
    // Read the two together: that one covers the dialog's three strings, this
    // one covers everything reachable on the screen behind it. `getByRole`'s
    // `name` is a case-insensitive SUBSTRING match, so a containing pair is a
    // Playwright strict-mode violation the moment both render — and S-31 puts
    // five labels in one card where there were four.
    //
    // The busy-state labels (`Testing…`, `Disconnecting…`) are deliberately out
    // of the set: each REPLACES its idle label rather than joining it, so
    // `Disconnecting…` containing `Disconnect` can never be two nodes at once.
    const all = [
      RECONNECT_LABEL,
      TEST_LABEL,
      DISCONNECT_LABEL,
      ...INTEGRATIONS.map(connectLabel),
      ...INTEGRATIONS.map(selectionEditorLabel),
      ...INTEGRATIONS.map(disconnectKeepLabel),
      ...INTEGRATIONS.map(disconnectClearLabel),
    ];

    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        expect(a.toLowerCase()).not.toContain(b.toLowerCase());
      }
    }
  });

  it("the two selection editors keep one string, not two", () => {
    // `selectionEditorLabel("jira")` re-exports `PROJECT_SWITCH_TRIGGER_LABEL`
    // rather than repeating it, so `jira-project-editor-copy.test.ts` and this
    // file cannot pin different strings for the same button.
    expect(selectionEditorLabel("jira")).toBe("Change monitored project");
    expect(selectionEditorLabel("github")).toBe("Change monitored repositories");
  });
});

describe("jobsIntro", () => {
  it.each(INTEGRATIONS)("%s: quotes all three control labels verbatim", (integration) => {
    // The labels are staying as they are, so this sentence carries the whole
    // job-naming burden. Quoting the labels is what lets a later label edit
    // break here rather than leave the prose pointing at a control that no
    // longer exists.
    const text = jobsIntro(integration);

    expect(text).toContain(`“${RECONNECT_LABEL}”`);
    expect(text).toContain(`“${selectionEditorLabel(integration)}”`);
    expect(text).toContain(`“${DISCONNECT_LABEL}”`);
  });

  it.each(INTEGRATIONS)("%s: reads as prose", (integration) => {
    const text = jobsIntro(integration);
    expect(text.trim()).toMatch(/\.$/);
    expect(text).not.toMatch(/\.\./);
    expect(text).not.toMatch(/\s{2,}/);
  });
});

describe("reconnectCost", () => {
  it("jira: states the same-project condition and names the routing control", () => {
    const text = reconnectCost("jira");

    expect(text).toContain("same project");
    expect(text).toContain("costs you nothing");
    expect(text).toContain(selectionEditorLabel("jira"));

    // The cost of a reconnect that CHANGES the project is `projectSwitch`, and
    // at least one of its fragments must be said out loud.
    expect(
      DISCONNECT_IMPACT.projectSwitch.destroys.some((fragment) =>
        text.includes(fragment),
      ),
    ).toBe(true);
  });

  it("jira: does not borrow the DISCONNECT root's losses", () => {
    // The negative half, and the one that catches the wrong-root conflation.
    // `disconnect-impact.ts:161-169` records why `projectSwitch` is a THIRD
    // root rather than a subset of `jira`: a switch UPDATES `jira_project` in
    // place and REPLACES the status mapping from the submitted form, so both
    // survive. Deriving this sentence from `DISCONNECT_IMPACT.jira` would tell
    // the lead they lose a project row and a mapping that they keep.
    const text = reconnectCost("jira");
    const onlyInDisconnect = DISCONNECT_IMPACT.jira.destroys.filter(
      (fragment) => !DISCONNECT_IMPACT.projectSwitch.destroys.includes(fragment),
    );

    expect(onlyInDisconnect.length).toBeGreaterThan(0);
    for (const fragment of onlyInDisconnect) {
      expect(text).not.toContain(fragment);
    }
  });

  it("jira: routes to the editor without presenting it as the cheaper way", () => {
    // `updateJiraProject` runs the same `delete(sprint)` cascade
    // (`connection-service.ts:444-451`) and its `clear` mode additionally
    // deletes absences (`:453-458`), so the editor is not cheaper — it is
    // better at STATING the cost first. Copy that sold it as a saving would be
    // the same defect S-26 fixed in the dialog, one surface up.
    const text = reconnectCost("jira").toLowerCase();

    for (const comparative of ["instead", "safely", "without losing", "avoid"]) {
      expect(text).not.toContain(comparative);
    }
  });

  it("jira: names the commitment freeze, the one clause the FK graph cannot guard", () => {
    // `sprint.committedFrozenAt` / `committedSp` are re-frozen by the next sync
    // at the post-switch ticket set (`run-sync.ts:907-917`, `sweep.ts:51-54`).
    // That is a re-computation, not a table in the cascade, so nothing derived
    // from `DISCONNECT_IMPACT` can name it — and it is the one casualty of a
    // project switch that no re-sync rebuilds. Asserted against the exported
    // constant rather than a literal so the sentence and the clause cannot
    // drift apart.
    for (const surface of ["settings", "wizard"] as const) {
      expect(reconnectCost("jira", surface)).toContain(COMMITMENT_FREEZE_CLAUSE);
    }
  });

  it("jira: names the cadence the switch KEEPS, the other undrivable clause (S-30)", () => {
    // `sprint_cadence_override` survives because it has NO foreign key into the
    // sync graph. That is a NEGATIVE fact about the schema: a derivation over
    // `collectEdges()` can say which tables an edge reaches, never that a table
    // has no edge worth mentioning. Pinned against the exported constant, on
    // `COMMITMENT_FREEZE_CLAUSE`'s precedent, so the sentence and the clause
    // cannot drift apart.
    for (const surface of ["settings", "wizard"] as const) {
      expect(reconnectCost("jira", surface)).toContain(CADENCE_RETENTION_CLAUSE);
    }
  });

  it("github: threatens no loss S-26 removed", () => {
    // Since S-26 `monitored_repo.credential_id` is ON DELETE SET NULL and the
    // repo write is a differential upsert, so `github.destroys` is `[]` and a
    // reconnect costs nothing. A shared cautious sentence would re-introduce
    // exactly the threat S-26 deleted from the dialog
    // (`disconnect-confirm-copy.ts:74-78`).
    const text = reconnectCost("github");

    expect(text).toContain("costs you nothing");
    expect(text).not.toMatch(/delet|destroy/i);

    // The one loss it does name is attributed to DESELECTING a repository, not
    // to reconnecting — and it is said after that attribution, never before.
    const deselect = text.indexOf("Deselecting");
    expect(deselect).toBeGreaterThan(-1);
    for (const fragment of DISCONNECT_IMPACT.github.clears) {
      expect(text.indexOf(fragment)).toBeGreaterThan(deselect);
    }
  });

  it.each(INTEGRATIONS)(
    "%s: quotes every fragment of its own source entry, and nothing is left dangling",
    (integration) => {
      // Fragment sync. Each sentence draws on ONE entry — `projectSwitch` for
      // Jira, `github` for GitHub — and quotes all of it, so editing any
      // fragment in `disconnect-impact.ts` turns this red instead of letting
      // the card drift away from the schema.
      const source =
        integration === "github"
          ? DISCONNECT_IMPACT.github.clears
          : DISCONNECT_IMPACT.projectSwitch.destroys;
      const text = reconnectCost(integration);

      for (const fragment of source) {
        expect(text).toContain(fragment);
      }

      expect(text.trim()).toMatch(/\.$/);
      expect(text).not.toMatch(/\.\./);
      expect(text).not.toMatch(/,\s*\./);
      expect(text).not.toMatch(/\s{2,}/);
      expect(text).not.toContain("and .");
      // A shortened source entry must not leave a hole in the sentence — the
      // failure mode of quoting fragments positionally instead of joining them.
      expect(text).not.toContain("undefined");
    },
  );

  it.each(INTEGRATIONS)(
    "%s: the wizard variant quotes no control the wizard does not have",
    (integration) => {
      // `/setup/github` and `/setup/jira` hold `Reconnect`, `Disconnect` and
      // `Continue` — no selection editor, no `Test connection`. A promise
      // naming a button its reader cannot see is the same defect as one naming
      // a button that no longer exists, and no pure-string test can catch a
      // SURFACE mismatch, which is why the variant exists at all.
      const wizard = reconnectCost(integration, "wizard");
      expect(wizard).not.toContain(selectionEditorLabel(integration));
      expect(wizard).not.toContain(TEST_LABEL);

      // Both directions, so neither variant can quietly become the other.
      expect(reconnectCost(integration, "settings")).toContain(
        selectionEditorLabel(integration),
      );
    },
  );
});

describe("statusBadge", () => {
  it("is total over every sync status plus the never-synced case", () => {
    // The `null` branch used to be a bare `<Badge variant="outline">` literal in
    // the card's JSX, where nothing could see it.
    for (const status of [...ALL_SYNC_STATUSES, null]) {
      const badge = statusBadge(status);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(["default", "secondary", "destructive", "outline"]).toContain(
        badge.variant,
      );
    }

    expect(statusBadge(null).label).toBe("Not synced yet");
  });
});
