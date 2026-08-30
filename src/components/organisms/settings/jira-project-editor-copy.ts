import {
  DISCONNECT_IMPACT,
  joinClauses,
} from "@/lib/integrations/disconnect-impact";
import type { DisconnectMode } from "@/lib/validations/disconnect";

/**
 * The project-switch warning's words, as a pure module (S-26 Phase 4).
 *
 * Split out of `jira-project-editor.tsx` for the reason `CLAUDE.md` gives and
 * `disconnect-confirm-copy.ts` already follows: there is no component-test
 * harness in this repo — no jsdom, no RTL — so copy assembled inside a `.tsx`
 * cannot be asserted at all. Every string below is built from
 * `DISCONNECT_IMPACT.projectSwitch`, which a hermetic test holds equal to the
 * schema's foreign-key graph, so this surface cannot quietly become a lie when
 * a later slice moves an edge.
 *
 * WHY THIS SURFACE KEEPS ITS INLINE `Alert` rather than adopting
 * `ConfirmDialog`: the switch is a multi-step flow — warning, then the project
 * picker, then the status mapper — and a modal cannot stay visible across
 * steps. That is why it diverged in the first place; S-26 gives it the same
 * two OUTCOMES as the dialog without giving it the dialog's shape.
 */

const PROJECT_SWITCH = DISCONNECT_IMPACT.projectSwitch;

/**
 * The two controls, and the constraint on their names.
 *
 * `getByRole`'s `name` is a case-insensitive SUBSTRING match (`e2e/disconnect.ts`
 * carries the same warning for the dialog), so neither label may contain the
 * other, and neither may contain the trigger's own `Change monitored project`.
 * Both say what happens to the absences AND what the click does, because on
 * this surface the button is also the step forward into the picker — a lead who
 * reads only the button must still know which of the two outcomes they bought.
 */
export const PROJECT_SWITCH_TRIGGER_LABEL = "Change monitored project";

export function projectSwitchKeepLabel(): string {
  return "Keep my absences and choose a project";
}

export function projectSwitchClearLabel(): string {
  return "Delete my absences and choose a project";
}

/**
 * The prose above the two controls.
 *
 * Three clauses in reading order — what goes either way, what the default keeps,
 * and what the destructive control additionally removes, NAMED WITH THAT
 * CONTROL'S OWN LABEL so the sentence and the button cannot drift apart. The
 * fourth sentence is the one that was already here: re-syncing rebuilds only
 * what the new project's Jira holds.
 */
export function projectSwitchWarning(currentProjectKey: string | null): string {
  const target = currentProjectKey
    ? `a project other than ${currentProjectKey}`
    : "a different project";

  return (
    `Pointing the account at ${target} deletes ${joinClauses(PROJECT_SWITCH.destroys)}. ` +
    `It keeps ${joinClauses(PROJECT_SWITCH.keeps)}. ` +
    `Choosing “${projectSwitchClearLabel()}” also removes ${joinClauses(PROJECT_SWITCH.clears)}. ` +
    `Re-syncing rebuilds only what the new project's Jira history contains.`
  );
}

/**
 * The after-the-fact summary, which must report the outcome the lead actually
 * chose rather than a fixed sentence. Saying "as warned, this discarded X" and
 * omitting the absences on the clear branch would understate a loss that no
 * sync can undo.
 */
export function projectSwitchDiscardedDescription(mode: DisconnectMode): string {
  const cleared =
    mode === "clear"
      ? `As you asked, it also removed ${joinClauses(PROJECT_SWITCH.clears)}. `
      : `Your recorded absences were kept — they stay with the team rather than with the project. `;

  return (
    `As warned, this discarded ${joinClauses(PROJECT_SWITCH.destroys)}. ` +
    cleared +
    `Your past daily recaps were kept, but are no longer linked to a sprint. ` +
    `Nothing has imported a sprint for the new project yet, so both dashboards ` +
    `will stay empty until you re-run the cadence import.`
  );
}
