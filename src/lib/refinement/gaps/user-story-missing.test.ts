import { describe, expect, it } from "vitest";

import { detectUserStoryMissing } from "@/lib/refinement/gaps/user-story-missing";
import { makeTicket } from "@/lib/refinement/test-support";

describe("detectUserStoryMissing", () => {
  it("fires when the description has no user-story frame", () => {
    const out = detectUserStoryMissing(
      makeTicket({ description: "Podmieniamy PDF regulaminu na wersję 2026." }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].gapClass).toBe("USER_STORY_MISSING");
    expect(out[0].groundingClause).toContain("Aktualizacja regulaminu karty");
  });

  it("stays silent when the description carries the Polish frame", () => {
    expect(
      detectUserStoryMissing(
        makeTicket({
          description:
            "Jako klient potrzebuję aktualnego regulaminu, żeby znać zasady karty.",
        }),
      ),
    ).toEqual([]);
  });

  it("accepts a user story written in a comment rather than the description", () => {
    expect(
      detectUserStoryMissing(
        makeTicket({
          description: "Podmiana pliku.",
          comments: ["As a customer I want the current terms of the card"],
        }),
      ),
    ).toEqual([]);
  });

  // An absent description already yields DESCRIPTION_MISSING. Reporting the
  // missing user story on top of it is two findings for one cause, which is the
  // over-flagging dor-notes.md §5 warns kills the tool.
  it("defers to DESCRIPTION_MISSING when there is nothing to read", () => {
    expect(detectUserStoryMissing(makeTicket({ description: "" }))).toEqual([]);
  });
});
