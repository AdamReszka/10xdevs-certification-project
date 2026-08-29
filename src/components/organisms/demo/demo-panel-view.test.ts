import { describe, expect, it } from "vitest";

import {
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
