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
    const clause = ground(makeTicket(), "it carries no description at all.");
    expect(clause).toBe(
      'This ticket is about "Aktualizacja regulaminu karty", but it carries no description at all.',
    );
  });

  it("falls back to the key when there is no summary to ground in", () => {
    const clause = ground(
      makeTicket({ summary: null }),
      "it carries no description at all.",
    );
    expect(clause).toBe(
      "Ticket FM-12 has no summary to go on, and it carries no description at all.",
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
