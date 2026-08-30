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
 * The two buttons, and why neither of them says "Disconnect" any more.
 *
 * The dialog has offered one action since S-24, labelled `Disconnect Jira` — a
 * string that CONTAINS the trigger's own `Disconnect`. That was survivable while
 * `{ exact: true }` could tell the two apart. A second action makes it fatal:
 * `getByRole`'s `name` is a case-insensitive SUBSTRING match, so a pair like
 * `Disconnect Jira` / `Disconnect Jira and delete data` is a strict-mode
 * violation the moment the second one exists, EVEN under `{ exact: true }` for
 * the trigger — the longer label contains the shorter one.
 *
 * So the invariant is stronger than "differs from the trigger", and it is
 * asserted in the sibling test rather than left to a reviewer's eye: **none of
 * the three strings — the trigger's `Disconnect`, the keep label and the clear
 * label — may be a substring of another, in either direction.** The title stays
 * the place the word `Disconnect` is said; the buttons answer HOW, which is the
 * question this dialog actually asks.
 */
export function disconnectKeepLabel(integration: DisconnectIntegration): string {
  return `Keep my ${INTEGRATION_LABEL[integration]} data`;
}

export function disconnectClearLabel(integration: DisconnectIntegration): string {
  return `Delete my ${INTEGRATION_LABEL[integration]} data`;
}

export function disconnectTitle(integration: DisconnectIntegration): string {
  return `Disconnect ${INTEGRATION_LABEL[integration]}?`;
}

/**
 * The prose the dialog shows. One string, because the description renders
 * inside Radix's `Primitive.p` — a `<ul>` there would be invalid nesting.
 *
 * Two S-26 corrections, both of which the old wording got wrong the moment the
 * cascade was narrowed:
 *
 *  - **The opening clause can be empty.** A GitHub disconnect now destroys
 *    NOTHING — `monitored_repo` is SET NULL — so `destroys` is `[]` and
 *    "This deletes ." is what the old template produced. An empty list gets its
 *    own sentence rather than a hole in this one.
 *  - **"nothing entered by hand comes back" is no longer true.** It was the
 *    honest summary while a disconnect destroyed the absences; under the default
 *    outcome they never leave, so repeating it would frighten the lead out of
 *    the safe path. The closing sentence now says what reconnecting does and
 *    stops there.
 *
 * The third sentence is the S-26 Phase 3 addition: the second button's extra
 * losses, NAMED WITH THAT BUTTON'S OWN LABEL. Describing a destructive
 * alternative without saying which control produces it is how a lead ends up
 * clicking to find out — and quoting the label here means the copy test can
 * hold the sentence and the button equal, so a later label edit cannot leave
 * the prose pointing at a button that no longer exists.
 */
export function disconnectDescription(integration: DisconnectIntegration): string {
  const impact = DISCONNECT_IMPACT[integration];
  const opening =
    impact.destroys.length > 0
      ? `This deletes ${joinClauses(impact.destroys)}.`
      : `This removes the connection itself.`;
  const clearing =
    impact.clears.length > 0
      ? `Choosing “${disconnectClearLabel(integration)}” also removes ${joinClauses(impact.clears)}. `
      : "";

  return (
    `${opening} ` +
    `It keeps ${joinClauses(impact.keeps)}. ` +
    clearing +
    `Reconnecting re-syncs what ${INTEGRATION_LABEL[integration]} still holds.`
  );
}
