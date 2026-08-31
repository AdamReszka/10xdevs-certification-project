/**
 * Pure view logic for `/team/cadence` (S-29, FR-007). No React, no DOM, no I/O.
 *
 * Same split, and the same reason, as `team-days-off-view.ts` and
 * `setup-doorstep-view.ts`: this project has no component-test harness — no
 * jsdom, no RTL (CLAUDE.md) — so a banner state machine or a sentence assembled
 * inside a `.tsx` is only testable once it is extracted here. S-31's
 * `integration-card-copy.ts` is the same pattern at its largest scale.
 *
 * Two vocabularies live here and they are deliberately NOT one union:
 *
 *  - {@link cadenceEditorState} answers "what is true of this account right
 *    now", read on every render.
 *  - {@link restoreOutcome} answers "what did the restore just do", which only
 *    exists after the lead pressed a button. Folding the second into the first
 *    would force the page to invent a resting state for an event.
 */

import type { CadenceProvenance } from "@/lib/cadence-override";

/** Does the lead own ANY of the three values? */
export function anyHandSet(p: CadenceProvenance): boolean {
  return p.lengthDays || p.startDay || p.workingDays;
}

/** What the screen is looking at before the lead touches anything. */
export type CadenceEditorState =
  /** No `sprint` row at all — there is nothing to write a cadence onto. */
  | { kind: "no_sprint"; title: string; body: string }
  /** The newest sprint row is not ACTIVE: the team is between sprints. */
  | { kind: "no_active_sprint"; title: string; body: string }
  /** The lead deliberately set at least one of the three values by hand. */
  | { kind: "overridden"; title: string; body: string }
  /** Auto-pull is on and nothing needs saying. */
  | { kind: "in_sync"; title: string; body: string };

export function cadenceEditorState(input: {
  /** False when `getActiveSprintRow` returned null. */
  hasSprintRow: boolean;
  /** `sprint.state` of the resolved row; null when there is no row. */
  sprintState: string | null;
  /**
   * PER FIELD since S-30. One boolean could not describe the account this slice
   * exists to create — working days hand-set, length and start day still
   * following Jira — so it described it wrongly, and the screen said so.
   */
  provenance: CadenceProvenance;
}): CadenceEditorState {
  const { hasSprintRow, sprintState, provenance } = input;
  const handSet = anyHandSet(provenance);
  // The one field with no upstream: Jira has no working-days field to pull
  // (`CADENCE_PROVENANCE.workingDays`), so it is the half that can stand alone.
  const workingDaysOnly =
    provenance.workingDays && !provenance.lengthDays && !provenance.startDay;

  if (!hasSprintRow) {
    return {
      kind: "no_sprint",
      title: "No sprint to store a cadence against",
      body:
        "SprintFlow keeps the cadence on the sprint it was imported with, and " +
        "this account has not imported one from Jira yet. Import the sprint " +
        "cadence first — the rhythm you set here would have nothing to attach to.",
    };
  }

  // Between sprints is the EXACT moment a lead revises a cadence, and it is the
  // moment the old write silently persisted nothing. Saying so is what makes a
  // successful save believable here.
  if (sprintState !== "ACTIVE") {
    return {
      kind: "no_active_sprint",
      title: "Your team is between sprints",
      body:
        "There is no active sprint in Jira right now, so this cadence is stored " +
        "against your most recent one and carries over when the next sprint " +
        "starts. Saving here works normally." +
        (handSet
          ? workingDaysOnly
            ? " Your working days are set by hand; sprint length and start day " +
              "still come from Jira."
            : " Auto-pull is currently off for the values you changed by hand."
          : ""),
    };
  }

  // THE STATE S-30 EXISTS TO CREATE, and the reason this is no longer one
  // sentence: working days have no upstream in Jira at all, so a lead can own
  // them while length and start day keep auto-pulling. Under the old single
  // boolean that account was told auto-pull was off for everything.
  if (workingDaysOnly) {
    return {
      kind: "overridden",
      title: "You set your working days by hand",
      body:
        "SprintFlow is keeping the working days you chose. " +
        CADENCE_PROVENANCE.workingDays +
        " Sprint length and start day still come from Jira on every sync, and " +
        "“Restore Jira’s values” leaves your working days alone.",
    };
  }

  if (handSet) {
    return {
      kind: "overridden",
      title: "You set this cadence by hand",
      body:
        "SprintFlow is keeping your values and no longer takes the sprint " +
        "length or start day from Jira. Use “Restore Jira’s values” to hand the " +
        "sprint length and start day back to auto-pull — your working days stay " +
        "as they are, because Jira has no working-days field to restore them from.",
    };
  }

  return {
    kind: "in_sync",
    title: "Following Jira",
    body:
      "Sprint length and start day are re-derived from your active sprint on " +
      "every sync. Changing anything here stops that and keeps your values " +
      "instead — you can hand it back at any time.",
  };
}

/**
 * Where each field's value actually comes from.
 *
 * The wizard used to present all three as “Pulled from your active sprint”,
 * which was false for one of them: Jira exposes no working-days field at all
 * (`cadence.ts`), so that value has always been SprintFlow's own default. The
 * copy is per field now because the provenance genuinely differs per field.
 */
export const CADENCE_PROVENANCE = {
  lengthDays:
    "Derived from your sprint’s start and end dates in Jira.",
  startDay:
    "Derived from the weekday your sprint starts on in Jira, in your Jira time zone.",
  // Named as a consequence, not as a warning: since S-28 this column decides
  // when all five time-based anomaly rules fire, not just the capacity figure.
  workingDays:
    "SprintFlow’s own Mon–Fri default — Jira has no working-days field to pull. " +
    "This one drives your capacity in man-days and how fast tickets and PRs age.",
} as const;

/** The submit button's two labels. */
export function saveButtonLabel(isSaving: boolean): string {
  return isSaving ? "Saving…" : "Save cadence";
}

/** What "Restore Jira's values" actually did. */
export type RestoreOutcome =
  | { kind: "pulled"; title: string; body: string }
  | { kind: "nothing_to_pull"; title: string; body: string };

export function restoreOutcome(input: {
  /**
   * Did the reconcile actually land on a sprint row?
   *
   * The caller derives this from `ImportCadenceResult.jiraSprintId != null`, NOT
   * from `noActiveSprint`. Four of the reconciler's five non-reconciled outcomes
   * set `noActiveSprint: true`, but `board_ambiguous` does not — a project with
   * several scrum boards and none chosen comes back `noActiveSprint: false`
   * carrying `DEFAULT_CADENCE` and a null sprint id, having written nothing. A
   * flag that is false in a case where nothing happened is exactly how
   * `DEFAULT_CADENCE` gets presented as a successful pull.
   */
  pulled: boolean;
}): RestoreOutcome {
  if (!input.pulled) {
    // NOTHING WAS WRITTEN, and the override is still in force. The restore
    // passes its intent into the reconcile rather than clearing the flag first
    // (plan-review F1), so a pull that found no sprint leaves the row exactly as
    // it was. Copy claiming auto-pull is back on would be false.
    return {
      kind: "nothing_to_pull",
      title: "Nothing to restore from yet",
      body:
        "SprintFlow found no sprint in Jira to take values from right now — the " +
        "usual reason is that your team is between sprints. Nothing was changed: " +
        "your cadence and your override are still in place. Try again once your " +
        "next sprint has started.",
    };
  }

  return {
    kind: "pulled",
    title: "Restored from Jira",
    body:
      "Sprint length and start day now come from your active sprint again, and " +
      "SprintFlow will keep them up to date on every sync.",
  };
}
