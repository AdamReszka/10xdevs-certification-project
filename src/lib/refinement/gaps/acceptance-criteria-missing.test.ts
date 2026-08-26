import { describe, expect, it } from "vitest";

import { detectAcceptanceCriteriaMissing } from "@/lib/refinement/gaps/acceptance-criteria-missing";
import { makeTicket } from "@/lib/refinement/test-support";

describe("detectAcceptanceCriteriaMissing", () => {
  it("fires when no acceptance-criteria section is present", () => {
    const out = detectAcceptanceCriteriaMissing(
      makeTicket({ description: "Podmieniamy PDF regulaminu na wersję 2026." }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].gapClass).toBe("ACCEPTANCE_CRITERIA_MISSING");
    expect(out[0].groundingClause).toContain("Aktualizacja regulaminu karty");
  });

  it("stays silent when the flattened description heads a section", () => {
    expect(
      detectAcceptanceCriteriaMissing(
        makeTicket({
          description: "Podmiana PDF.\n## Kryteria akceptacji\n- nowy PDF wisi",
        }),
      ),
    ).toEqual([]);
  });

  it("accepts criteria agreed in a comment", () => {
    expect(
      detectAcceptanceCriteriaMissing(
        makeTicket({
          description: "Podmiana PDF.",
          comments: ["Acceptance criteria:\n- stary PDF przekierowuje"],
        }),
      ),
    ).toEqual([]);
  });

  it("defers to DESCRIPTION_MISSING when there is nothing to read", () => {
    expect(
      detectAcceptanceCriteriaMissing(makeTicket({ description: "" })),
    ).toEqual([]);
  });
});
