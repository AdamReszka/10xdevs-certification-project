import { describe, expect, it } from "vitest";

import {
  GAP_CLASSES,
  GAP_CLASS_LEVEL,
  GAP_CLASS_OBLIGATIONS,
  TASK_KINDS,
} from "@/lib/refinement/types";

describe("the closed vocabulary", () => {
  it("levels every gap class exactly once", () => {
    expect(new Set(GAP_CLASSES).size).toBe(GAP_CLASSES.length);
    for (const gapClass of GAP_CLASSES) {
      expect(GAP_CLASS_LEVEL[gapClass]).toMatch(/^P[0-3]$/);
    }
    expect(Object.keys(GAP_CLASS_LEVEL).sort()).toEqual([...GAP_CLASSES].sort());
  });

  it("names the levels the rubric defines", () => {
    expect(GAP_CLASS_LEVEL.DESCRIPTION_MISSING).toBe("P0");
    expect(GAP_CLASS_LEVEL.TITLE_TOO_VAGUE).toBe("P1");
    expect(GAP_CLASS_LEVEL.API_CONTRACT_MISSING).toBe("P2");
    expect(GAP_CLASS_LEVEL.TASK_NOT_VIABLE).toBe("P3");
  });
});

describe("GAP_CLASS_OBLIGATIONS", () => {
  it("has an entry for every task kind", () => {
    expect(Object.keys(GAP_CLASS_OBLIGATIONS).sort()).toEqual(
      [...TASK_KINDS].sort(),
    );
  });

  it("obliges only real gap classes, each named once per kind", () => {
    for (const kind of TASK_KINDS) {
      const obliged = GAP_CLASS_OBLIGATIONS[kind];
      expect(obliged.length).toBeGreaterThan(0);
      expect(new Set(obliged).size).toBe(obliged.length);
      for (const gapClass of obliged) {
        expect(GAP_CLASSES).toContain(gapClass);
      }
    }
  });

  // A class no kind ever obliges is dead vocabulary: the model may still return
  // it and the gate would silently drop it on every ticket.
  it("leaves no gap class unreachable", () => {
    const reachable = new Set(
      TASK_KINDS.flatMap((kind) => GAP_CLASS_OBLIGATIONS[kind]),
    );
    expect([...GAP_CLASSES].filter((c) => !reachable.has(c))).toEqual([]);
  });

  it("narrows: a spike is not asked for acceptance criteria or a mockup", () => {
    expect(GAP_CLASS_OBLIGATIONS.SPIKE).not.toContain(
      "ACCEPTANCE_CRITERIA_MISSING",
    );
    expect(GAP_CLASS_OBLIGATIONS.SPIKE).not.toContain("MOCKUP_MISSING");
    expect(GAP_CLASS_OBLIGATIONS.NEW_VIEW_OR_COMPONENT).toContain(
      "MOCKUP_MISSING",
    );
  });

  it("keeps the universal classes on every kind", () => {
    for (const kind of TASK_KINDS) {
      expect(GAP_CLASS_OBLIGATIONS[kind]).toContain("DESCRIPTION_MISSING");
      expect(GAP_CLASS_OBLIGATIONS[kind]).toContain("TITLE_TOO_VAGUE");
      expect(GAP_CLASS_OBLIGATIONS[kind]).toContain("TASK_NOT_VIABLE");
    }
  });
});
