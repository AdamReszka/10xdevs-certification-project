import { describe, expect, it } from "vitest";

import {
  CADENCE_PROVENANCE,
  cadenceEditorState,
  restoreOutcome,
  saveButtonLabel,
} from "./cadence-editor-view";
import { FOLLOWS_SOURCE, type CadenceProvenance } from "@/lib/cadence-override";

/** Every field hand-set — what the single `cadenceOverridden: true` used to mean. */
const ALL_HAND_SET: CadenceProvenance = {
  lengthDays: true,
  startDay: true,
  workingDays: true,
};

/** The state S-30 exists to create, and the one no boolean could describe. */
const WORKING_DAYS_ONLY: CadenceProvenance = {
  lengthDays: false,
  startDay: false,
  workingDays: true,
};

/**
 * S-29 Phase 4 — the `/team/cadence` banner state machine and its copy.
 *
 * There is no component-test harness in this repo, so these assertions are the
 * only automated guard on what the screen actually SAYS.
 */

describe("cadenceEditorState", () => {
  it("no sprint row at all → no_sprint, and says the cadence has nothing to attach to", () => {
    const state = cadenceEditorState({
      hasSprintRow: false,
      sprintState: null,
      provenance: { ...FOLLOWS_SOURCE },
    });

    expect(state.kind).toBe("no_sprint");
    expect(state.body).toContain("has not imported one from Jira yet");
  });

  it("a CLOSED newest row → no_active_sprint, and says saving works", () => {
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "CLOSED",
      provenance: { ...FOLLOWS_SOURCE },
    });

    expect(state.kind).toBe("no_active_sprint");
    // The whole point of Phase 1: this used to report success and write nothing.
    expect(state.body).toContain("Saving here works normally");
    expect(state.body).not.toContain("Auto-pull is currently off");
  });

  it("between sprints AND overridden mentions both, rather than hiding the override", () => {
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "CLOSED",
      provenance: ALL_HAND_SET,
    });

    expect(state.kind).toBe("no_active_sprint");
    expect(state.body).toContain("Auto-pull is currently off");
  });

  it("working days hand-set, length and start day following Jira → both stated (S-30)", () => {
    // The account this slice exists to make reachable. Under one boolean it was
    // told auto-pull was off for everything, which was false for two of three.
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "ACTIVE",
      provenance: WORKING_DAYS_ONLY,
    });

    expect(state.kind).toBe("overridden");
    expect(state.body).toContain("keeping the working days you chose");
    expect(state.body).toContain("Sprint length and start day still come from Jira");
    // And the restore's promise, stated where the lead can read it.
    expect(state.body).toContain("leaves your working days alone");
  });

  it("between sprints with only the working days hand-set says exactly that", () => {
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "CLOSED",
      provenance: WORKING_DAYS_ONLY,
    });

    expect(state.kind).toBe("no_active_sprint");
    expect(state.body).toContain("Saving here works normally");
    expect(state.body).toContain("working days are set by hand");
    expect(state.body).not.toContain("Auto-pull is currently off");
  });

  it("an active, overridden account → overridden, and names the way back", () => {
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "ACTIVE",
      provenance: ALL_HAND_SET,
    });

    expect(state.kind).toBe("overridden");
    expect(state.body).toContain("Restore Jira’s values");
    // Even here the restore does not touch the working days — Jira has no
    // working-days field to restore them from.
    expect(state.body).toContain("your working days stay");
  });

  it("an active, non-overridden account → in_sync", () => {
    const state = cadenceEditorState({
      hasSprintRow: true,
      sprintState: "ACTIVE",
      provenance: { ...FOLLOWS_SOURCE },
    });

    expect(state.kind).toBe("in_sync");
    expect(state.body).toContain("every sync");
  });

  it("every state carries a title and a body", () => {
    const inputs = [
      { hasSprintRow: false, sprintState: null, provenance: { ...FOLLOWS_SOURCE } },
      { hasSprintRow: true, sprintState: "CLOSED", provenance: { ...FOLLOWS_SOURCE } },
      { hasSprintRow: true, sprintState: "CLOSED", provenance: WORKING_DAYS_ONLY },
      { hasSprintRow: true, sprintState: "ACTIVE", provenance: ALL_HAND_SET },
      { hasSprintRow: true, sprintState: "ACTIVE", provenance: WORKING_DAYS_ONLY },
      { hasSprintRow: true, sprintState: "ACTIVE", provenance: { ...FOLLOWS_SOURCE } },
    ];

    for (const input of inputs) {
      const state = cadenceEditorState(input);
      expect(state.title).toBeTruthy();
      expect(state.body).toBeTruthy();
    }
  });
});

describe("CADENCE_PROVENANCE", () => {
  it("attributes length and start day to Jira", () => {
    expect(CADENCE_PROVENANCE.lengthDays).toContain("Jira");
    expect(CADENCE_PROVENANCE.startDay).toContain("Jira");
  });

  it("does NOT claim working days come from Jira — there is no such field", () => {
    // The wizard's old single line said all three were "pulled from your active
    // sprint". For this one that was simply untrue (`cadence.ts`).
    expect(CADENCE_PROVENANCE.workingDays).toContain("no working-days field");
    expect(CADENCE_PROVENANCE.workingDays).toContain("SprintFlow’s own");
  });

  it("names what working days actually move, since S-28 made the column load-bearing", () => {
    expect(CADENCE_PROVENANCE.workingDays).toContain("capacity");
    expect(CADENCE_PROVENANCE.workingDays).toContain("age");
  });
});

describe("saveButtonLabel", () => {
  it("switches on the in-flight flag", () => {
    expect(saveButtonLabel(false)).toBe("Save cadence");
    expect(saveButtonLabel(true)).toBe("Saving…");
  });
});

describe("restoreOutcome", () => {
  it("a successful pull says auto-pull is back on", () => {
    const outcome = restoreOutcome({ pulled: true });

    expect(outcome.kind).toBe("pulled");
    expect(outcome.body).toContain("every sync");
  });

  it("nothing pulled says nothing was changed — NOT that the override was lifted", () => {
    const outcome = restoreOutcome({ pulled: false });

    expect(outcome.kind).toBe("nothing_to_pull");
    expect(outcome.body).toContain("Nothing was changed");
    // The restore carries its intent into the reconcile instead of clearing the
    // flag first, so on this path the override genuinely still stands. Copy that
    // claimed otherwise would be the reassuring kind of lie this slice exists to
    // remove (plan-review F1/F5).
    expect(outcome.body).toContain("override are still");
  });
});
