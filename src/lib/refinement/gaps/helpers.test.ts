import { describe, expect, it } from "vitest";

import {
  attachmentStateKnown,
  ground,
  hasAcceptanceCriteriaSection,
  hasUserStoryFrame,
  isBlank,
} from "@/lib/refinement/gaps/helpers";
import { makeTicket } from "@/lib/refinement/test-support";

describe("isBlank", () => {
  it("treats absent, empty and whitespace-only text as blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   \n\t  ")).toBe(true);
  });

  it("treats any visible character as present", () => {
    expect(isBlank("x")).toBe(false);
    expect(isBlank("  a  ")).toBe(false);
  });
});

describe("hasUserStoryFrame", () => {
  it("recognises the English frame", () => {
    expect(
      hasUserStoryFrame("As a marketing employee, I want to download reports"),
    ).toBe(true);
    expect(hasUserStoryFrame("As an admin I need a new tab")).toBe(true);
  });

  // The team writes its tickets in Polish (dor-notes.md #4) — a probe that only
  // reads English would report USER_STORY_MISSING on every real ticket.
  it("recognises the Polish frame", () => {
    expect(
      hasUserStoryFrame(
        "Jako pracownik marketingu potrzebuję nowej zakładki, gdzie będę mógł pobierać raporty",
      ),
    ).toBe(true);
    expect(hasUserStoryFrame("Jako klient chcę zobaczyć nowy regulamin")).toBe(
      true,
    );
  });

  it("does not fire on prose that merely mentions a user", () => {
    expect(hasUserStoryFrame("Podmiana regulaminu karty na nową wersję")).toBe(
      false,
    );
    expect(hasUserStoryFrame("As discussed, I will update the PDF")).toBe(false);
    expect(hasUserStoryFrame("")).toBe(false);
  });
});

describe("hasAcceptanceCriteriaSection", () => {
  it("finds the section behind a flattened ADF heading", () => {
    expect(
      hasAcceptanceCriteriaSection("## Kryteria akceptacji\n- nowy PDF wisi"),
    ).toBe(true);
    expect(
      hasAcceptanceCriteriaSection("# Acceptance Criteria\n- it renders"),
    ).toBe(true);
    expect(hasAcceptanceCriteriaSection("### Definition of Done\n- shipped")).toBe(
      true,
    );
  });

  it("finds it behind a plain label line", () => {
    expect(hasAcceptanceCriteriaSection("Kryteria akceptacji:\n- a\n- b")).toBe(
      true,
    );
    expect(hasAcceptanceCriteriaSection("**Acceptance criteria**\n- a")).toBe(
      true,
    );
  });

  it("does not fire on prose that happens to use the words", () => {
    expect(
      hasAcceptanceCriteriaSection(
        "Ustal z PO kryteria akceptacji zanim zaczniesz",
      ),
    ).toBe(false);
    expect(hasAcceptanceCriteriaSection("Opis zadania\n- zrób to")).toBe(false);
  });
});

describe("ground", () => {
  it("names the ticket's own summary, so even a P0 gap reads as grounded", () => {
    const clause = ground(makeTicket(), "nie ma żadnego opisu.");
    expect(clause).toBe(
      'Zadanie dotyczy „Aktualizacja regulaminu karty”, ale nie ma żadnego opisu.',
    );
  });

  it("falls back to the key when there is no summary to ground in", () => {
    const clause = ground(
      makeTicket({ summary: null }),
      "nie ma żadnego opisu.",
    );
    expect(clause).toBe(
      "Zadanie FM-12 nie ma tytułu, na którym można się oprzeć, a nie ma żadnego opisu.",
    );
  });
});

describe("attachmentStateKnown", () => {
  it("is true for a Jira ticket, whether or not it has attachments", () => {
    expect(attachmentStateKnown(makeTicket())).toBe(true);
  });

  // A pasted story has no attachments because paste carries none — not because
  // the author forgot one. Inferring absence from the empty array would invent
  // FILE_ATTACHMENT_MISSING on every single paste.
  it("is false for a pasted ticket", () => {
    expect(attachmentStateKnown(makeTicket({ origin: "PASTE" }))).toBe(false);
  });
});

/**
 * The label form, found on the real ticket FM-7. The single-line frames could
 * not see it, so a ticket that plainly has a user story was reported as having
 * none — while the model simultaneously judged that story's actor wrong.
 */
describe("hasUserStoryFrame — the label form", () => {
  it("accepts a role and a need written as their own labelled lines", () => {
    expect(
      hasUserStoryFrame(
        "JAKO: pracownik działu compliance\nPotrzebuję: formularza do przesyłania zgłoszeń",
      ),
    ).toBe(true);
  });

  it("accepts the English label form too", () => {
    expect(hasUserStoryFrame("As a: auditor\nI need: an export")).toBe(true);
  });

  it("rejects a need with no actor — that is not a user story", () => {
    expect(hasUserStoryFrame("Potrzebuję: formularza do zgłoszeń")).toBe(false);
  });

  it("rejects an actor with no need", () => {
    expect(hasUserStoryFrame("JAKO: pracownik compliance\nOpis: cokolwiek")).toBe(false);
  });

  it("rejects an unfilled template — a bare label with no value", () => {
    expect(hasUserStoryFrame("JAKO:\nPotrzebuję:")).toBe(false);
  });
});

describe("hasAcceptanceCriteriaSection — the KA abbreviation", () => {
  it("accepts 'KA:' as a section heading, like the DoD and AC abbreviations beside it", () => {
    expect(hasAcceptanceCriteriaSection("Opis czegoś\nKA:\n- formularz jest walidowany")).toBe(
      true,
    );
  });

  it("still refuses the abbreviation buried in prose", () => {
    expect(hasAcceptanceCriteriaSection("ustal ka z product ownerem")).toBe(false);
  });
});
