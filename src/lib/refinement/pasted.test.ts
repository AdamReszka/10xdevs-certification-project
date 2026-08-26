import { describe, expect, it } from "vitest";

import { JiraRefinementInputError } from "@/lib/jira";
import { ALL_P0_DETECTORS } from "@/lib/refinement/gaps";
import { attachmentStateKnown } from "@/lib/refinement/gaps/helpers";
import { PASTED_TICKET_KEY, parsePastedTicket } from "@/lib/refinement/pasted";
import { GAP_CLASS_LEVEL } from "@/lib/refinement/types";

describe("parsePastedTicket", () => {
  it("takes the first non-empty line as the summary and the rest as the description", () => {
    const ticket = parsePastedTicket(
      "\n  Aktualizacja regulaminu karty  \n\nJako klient potrzebuję aktualnego regulaminu.\n- PDF wisi\n",
    );
    expect(ticket.summary).toBe("Aktualizacja regulaminu karty");
    expect(ticket.description).toBe(
      "Jako klient potrzebuję aktualnego regulaminu.\n- PDF wisi",
    );
  });

  it("carries the shape the analysis reads, with nothing invented", () => {
    const ticket = parsePastedTicket("Tytuł\nOpis");
    expect(ticket).toMatchObject({
      key: PASTED_TICKET_KEY,
      issueType: null,
      comments: [],
      attachments: [],
      links: [],
      subtasks: [],
      dueDate: null,
      labels: [],
      priority: null,
      sourceUrl: null,
      origin: "PASTE",
    });
  });

  it("leaves the description empty for a one-line paste", () => {
    expect(parsePastedTicket("Nowa fryzura dla Zenka").description).toBe("");
  });

  // An empty summary would trip TITLE_TOO_VAGUE and read as a finding about the
  // ticket, when the fault is in the input.
  it("refuses empty and whitespace-only input rather than building a ticket", () => {
    expect(() => parsePastedTicket("")).toThrow(JiraRefinementInputError);
    expect(() => parsePastedTicket("   \n\t\n  ")).toThrow(
      JiraRefinementInputError,
    );
  });

  it("marks attachment state unknown, so absence-based checks cannot fire on it", () => {
    const ticket = parsePastedTicket("Podmiana regulaminu\nNowa wersja od 1.09.");
    expect(attachmentStateKnown(ticket)).toBe(false);
    const produced = ALL_P0_DETECTORS.flatMap((detect) => detect(ticket));
    expect(produced.map((gap) => GAP_CLASS_LEVEL[gap.gapClass])).not.toContain(
      "P2",
    );
    expect(produced.map((gap) => gap.gapClass)).not.toContain(
      "FILE_ATTACHMENT_MISSING",
    );
    expect(produced.map((gap) => gap.gapClass)).not.toContain("MOCKUP_MISSING");
  });
});
