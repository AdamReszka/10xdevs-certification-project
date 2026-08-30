import {
  DISCONNECT_IMPACT,
  joinClauses,
} from "@/lib/integrations/disconnect-impact";

/**
 * The dialog's words, as a pure module (S-24, impl-review F3).
 *
 * Split out of `disconnect-confirm.tsx` for the reason `CLAUDE.md` gives: there
 * is no component-test harness in this repo — no jsdom, no RTL — so decision
 * logic and copy assembly living in a `.tsx` cannot be asserted at all. The
 * house answer is a pure `.ts` sibling (`demo-panel-view.ts`,
 * `roster-merge.ts`, `inbox-controls.ts`), which is what this is.
 *
 * `disconnect-impact.test.ts` already pins the individual copy FRAGMENTS against
 * the schema. What it cannot see is the ASSEMBLED sentence — whether the pieces
 * actually compose into readable prose, and whether the promise the lead reads
 * ("nothing entered by hand comes back") survives an edit to the fragments. That
 * is what the sibling test here covers.
 */

const INTEGRATION_LABEL = {
  github: "GitHub",
  jira: "Jira",
} as const;

export type DisconnectIntegration = keyof typeof INTEGRATION_LABEL;

export function integrationLabel(integration: DisconnectIntegration): string {
  return INTEGRATION_LABEL[integration];
}

/**
 * The confirm label deliberately differs from the trigger label ("Disconnect"),
 * so the dialog's action and the button behind it are distinguishable — to a
 * screen-reader user and to Playwright alike. E2E locators additionally need
 * `{ exact: true }`, because `getByRole`'s name match is a case-insensitive
 * SUBSTRING: with the dialog open, "Disconnect" matches both nodes and
 * "Connect" matches three.
 */
export function disconnectConfirmLabel(integration: DisconnectIntegration): string {
  return `Disconnect ${INTEGRATION_LABEL[integration]}`;
}

export function disconnectTitle(integration: DisconnectIntegration): string {
  return `Disconnect ${INTEGRATION_LABEL[integration]}?`;
}

/** The prose the dialog shows. One string, because the description renders
 *  inside Radix's `Primitive.p` — a `<ul>` there would be invalid nesting. */
export function disconnectDescription(integration: DisconnectIntegration): string {
  const impact = DISCONNECT_IMPACT[integration];
  return (
    `This deletes ${joinClauses(impact.destroys)}. ` +
    `It keeps ${joinClauses(impact.keeps)}. ` +
    `Reconnecting re-syncs what ${INTEGRATION_LABEL[integration]} still holds, ` +
    `but nothing entered by hand comes back.`
  );
}
