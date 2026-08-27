import { describe, expect, it } from "vitest";

import * as gaps from "@/lib/refinement/gaps";
import { ALL_P0_DETECTORS } from "@/lib/refinement/gaps";
import { GAP_CLASS_LEVEL } from "@/lib/refinement/types";
import { makeTicket } from "@/lib/refinement/test-support";

/** Every `detect*` the barrel exports — the set the registry has to match. */
const exportedDetectors = Object.entries(gaps)
  .filter(([name, value]) => name.startsWith("detect") && typeof value === "function")
  .map(([, value]) => value);

describe("ALL_P0_DETECTORS", () => {
  // The same guard the anomaly engine carries: a detector that exists but is
  // not registered runs on nothing and reports nothing, and a green suite looks
  // identical either way.
  it("registers every exported detector, exactly once", () => {
    expect(ALL_P0_DETECTORS).toHaveLength(exportedDetectors.length);
    expect(new Set(ALL_P0_DETECTORS).size).toBe(ALL_P0_DETECTORS.length);
    for (const detector of exportedDetectors) {
      expect(ALL_P0_DETECTORS).toContain(detector);
    }
  });

  it("reports only P0 classes — judgment stays with the model", () => {
    const bare = makeTicket({ description: "" });
    const rich = makeTicket({ description: "Podmiana PDF regulaminu." });
    for (const detect of [...ALL_P0_DETECTORS]) {
      for (const gap of [...detect(bare), ...detect(rich)]) {
        expect(GAP_CLASS_LEVEL[gap.gapClass]).toBe("P0");
      }
    }
  });

  it("grounds every gap it produces in the ticket's own content", () => {
    const ticket = makeTicket({ description: "Podmiana PDF regulaminu." });
    const produced = ALL_P0_DETECTORS.flatMap((detect) => detect(ticket));
    expect(produced.length).toBeGreaterThan(0);
    for (const gap of produced) {
      expect(gap.groundingClause).toContain("Aktualizacja regulaminu karty");
    }
  });

  it("says nothing about a ticket that carries all three carriers", () => {
    const complete = makeTicket({
      description: [
        "Jako klient potrzebuję aktualnego regulaminu karty, żeby znać zasady.",
        "## Kryteria akceptacji",
        "- nowy PDF jest opublikowany",
      ].join("\n"),
    });
    expect(ALL_P0_DETECTORS.flatMap((detect) => detect(complete))).toEqual([]);
  });
});
