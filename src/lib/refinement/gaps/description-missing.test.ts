import { describe, expect, it } from "vitest";

import { detectDescriptionMissing } from "@/lib/refinement/gaps/description-missing";
import { makeTicket } from "@/lib/refinement/test-support";

describe("detectDescriptionMissing", () => {
  it("fires on an empty description, grounded in the ticket's own summary", () => {
    const out = detectDescriptionMissing(makeTicket({ description: "" }));
    expect(out).toHaveLength(1);
    expect(out[0].gapClass).toBe("DESCRIPTION_MISSING");
    expect(out[0].groundingClause).toContain("Aktualizacja regulaminu karty");
    expect(out[0].groundingClause).toMatch(/^Zadanie dotyczy „/);
  });

  it("fires on a whitespace-only description", () => {
    expect(
      detectDescriptionMissing(makeTicket({ description: "  \n\t " })),
    ).toHaveLength(1);
  });

  it("stays silent when a description is present", () => {
    expect(
      detectDescriptionMissing(
        makeTicket({ description: "Podmieniamy PDF regulaminu na wersję 2026." }),
      ),
    ).toEqual([]);
  });

  // P0 is presence only. "The description is there but says nothing useful" is
  // a P1 judgment the model makes — a length threshold here would be the
  // detector guessing at quality.
  it("does not judge a short description", () => {
    expect(detectDescriptionMissing(makeTicket({ description: "PDF." }))).toEqual(
      [],
    );
  });
});
