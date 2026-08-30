import { describe, expect, it } from "vitest";

import {
  DEMO_RESET_CONFIRM,
  DEMO_STATE_COPY,
  DEMO_TRANSITION_LABEL,
  allowedTransitions,
  toDemoState,
  type DemoState,
} from "@/components/organisms/demo/demo-panel-view";

/**
 * S-09 Phase 4 — the demo panel offers only the transitions valid for its state.
 *
 * Worth asserting rather than eyeballing in JSX: two of the invalid pairings are
 * destructive or confusing rather than merely untidy. "Zobacz demo" offered
 * while a demo already exists would re-anchor it and discard the visitor's demo
 * edits, and "Wyjdź z demo" offered from the real account would be a button that
 * does nothing.
 */

const ALL_STATES: DemoState[] = ["no_demo", "demo_idle", "demo_active"];

describe("allowedTransitions", () => {
  it("offers only loading when there is no demo", () => {
    expect(allowedTransitions("no_demo")).toEqual(["load"]);
  });

  it("offers returning and deleting when a demo exists but is not being viewed", () => {
    expect(allowedTransitions("demo_idle")).toEqual(["enter", "reset"]);
  });

  it("offers leaving and deleting while the demo is being viewed", () => {
    expect(allowedTransitions("demo_active")).toEqual(["exit", "reset"]);
  });

  it("never offers a load once a demo exists — it would discard demo edits", () => {
    expect(allowedTransitions("demo_idle")).not.toContain("load");
    expect(allowedTransitions("demo_active")).not.toContain("load");
  });

  it("never offers an exit unless the demo is actually being viewed", () => {
    expect(allowedTransitions("no_demo")).not.toContain("exit");
    expect(allowedTransitions("demo_idle")).not.toContain("exit");
  });

  it("gives every state at least one transition, and a label for each", () => {
    for (const state of ALL_STATES) {
      const transitions = allowedTransitions(state);
      expect(transitions.length).toBeGreaterThan(0);
      expect(DEMO_STATE_COPY[state]).toBeTruthy();
      for (const t of transitions) expect(DEMO_TRANSITION_LABEL[t]).toBeTruthy();
    }
  });
});

describe("toDemoState", () => {
  it("maps the resolver's two facts onto the three states", () => {
    expect(toDemoState({ hasDemo: false, isDemo: false })).toBe("no_demo");
    expect(toDemoState({ hasDemo: true, isDemo: false })).toBe("demo_idle");
    expect(toDemoState({ hasDemo: true, isDemo: true })).toBe("demo_active");
  });

  it("treats 'in demo with no demo owner' as no demo, matching the resolver's fallback", () => {
    // `resolveWorkspace` falls back to REAL when the demo owner is missing, so a
    // panel that reported `demo_active` here would offer an exit from a mode the
    // rest of the app is not in.
    expect(toDemoState({ hasDemo: false, isDemo: true })).toBe("no_demo");
  });
});

/**
 * S-27 Phase 4 — the demo copy makes ONE general claim, not a list.
 *
 * The list has now gone stale three times: S-09 wrote it short, S-24 corrected it
 * and wrote it short again, and S-27's own Phase 2 added Connect / Reconnect to
 * the disabled set without any of the enumerations noticing. Asserting the
 * general shape here is what stops the fourth: a future slice that reaches for an
 * enumeration has to delete a test to do it.
 */
describe("DEMO_STATE_COPY", () => {
  const ALL_COPY = ALL_STATES.map((state) => DEMO_STATE_COPY[state]);

  it("no longer carries the sentence S-24 retracted", () => {
    // "Twoje prawdziwe dane są nietknięte" was true of DATA and false of
    // integrations at the time it was written; the general claim replaced it.
    for (const copy of ALL_COPY) expect(copy).not.toMatch(/nietknięt/i);
  });

  it("names no individual action", () => {
    // The words that only ever appear inside an enumeration of what demo
    // disables — the shape, not any one sentence.
    for (const copy of ALL_COPY) {
      expect(copy).not.toMatch(/synchronizacj/i);
      expect(copy).not.toMatch(/refinement/i);
      expect(copy).not.toMatch(/odłączeni/i);
      expect(copy).not.toMatch(/repozytori/i);
    }
  });

  it("states the general guarantee wherever a demo world exists", () => {
    // `no_demo` is the one state that has nothing to guarantee yet — the lead is
    // looking at their real account and no demo has been built.
    for (const state of ["demo_idle", "demo_active"] as const) {
      expect(DEMO_STATE_COPY[state]).toMatch(/nie zmienia Twojego prawdziwego/i);
    }
  });
});

describe("DEMO_RESET_CONFIRM", () => {
  it("names both sides — what disappears and what survives", () => {
    expect(DEMO_RESET_CONFIRM.description).toMatch(/demo/i);
    expect(DEMO_RESET_CONFIRM.description).toMatch(/anomalie/i);
    expect(DEMO_RESET_CONFIRM.description).toMatch(/prawdziwe konto/i);
    expect(DEMO_RESET_CONFIRM.description).toMatch(/token/i);
  });

  it("says the demo can be loaded again", () => {
    // Reset is irreversible for THIS demo world but not a one-way door out of
    // demo; a dialog that omitted this would read as the harsher of the two.
    expect(DEMO_RESET_CONFIRM.description).toMatch(/ponownie/i);
  });

  it("confirms under the same words as the button that opened it", () => {
    expect(DEMO_RESET_CONFIRM.confirmLabel).toBe(DEMO_TRANSITION_LABEL.reset);
  });

  it("asks a question in the title, so it cannot read as a report", () => {
    expect(DEMO_RESET_CONFIRM.title).toMatch(/\?$/);
  });
});
