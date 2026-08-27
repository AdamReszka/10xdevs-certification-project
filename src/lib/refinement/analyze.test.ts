import { describe, expect, it, vi } from "vitest";

import {
  analyzeTicket,
  analyzeTickets,
  MAX_TICKETS_PER_RUN,
  RefinementAnalysisError,
  type AnalyzeDeps,
  type ModelAnalysis,
} from "@/lib/refinement/analyze";
import { makeTicket } from "@/lib/refinement/test-support";

const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as never;

/** A `complete` that answers with exactly what the test hands it — the seam
 * that keeps this suite hermetic. The real model is measured by the corpus
 * eval, never here. */
function stub(...responses: unknown[]): AnalyzeDeps & { calls: number } {
  let index = 0;
  const deps = {
    calls: 0,
    complete: vi.fn(async () => {
      const value = responses[Math.min(index, responses.length - 1)];
      index += 1;
      deps.calls = index;
      return { value, usage: USAGE };
    }),
  } as unknown as AnalyzeDeps & { calls: number };
  return deps;
}

function modelSays(over: Partial<ModelAnalysis> = {}): ModelAnalysis {
  return {
    taskKind: "BUG",
    verdict: "DOR_MET",
    gaps: [],
    ...over,
  } as ModelAnalysis;
}

/** A ticket that gives the deterministic P0 detectors nothing to report, so a
 * test about the gate is only about the gate. */
const COMPLETE_TICKET = makeTicket({
  description:
    "Jako pracownik marketingu potrzebuję eksportu raportu, aby rozliczyć kampanię.\n\n## Kryteria akceptacji\n- plik CSV pobiera się z zakładki Raporty",
});

describe("analyzeTicket — the task-kind gate", () => {
  it("drops a gap the recognised kind does not oblige AND reports it on droppedClasses", async () => {
    const verdict = await analyzeTicket(
      COMPLETE_TICKET,
      stub(
        modelSays({
          taskKind: "BUG",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "ENDPOINTS_UNSPECIFIED",
              groundingClause: "This ticket is about X, but no endpoint is named.",
            },
          ],
        }),
      ),
    );

    expect(verdict.gaps).toEqual([]);
    // The whole point: a discarded class must not read as "nothing was wrong".
    expect(verdict.droppedClasses).toEqual(["ENDPOINTS_UNSPECIFIED"]);
    expect(verdict.taskKind).toBe("BUG");
    expect(verdict.verdict).toBe("DOR_MET");
  });

  it("keeps a gap the recognised kind does oblige", async () => {
    const verdict = await analyzeTicket(
      COMPLETE_TICKET,
      stub(
        modelSays({
          taskKind: "FRONTEND_ON_BACKEND_DATA",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "ENDPOINTS_UNSPECIFIED",
              groundingClause: "This ticket is about X, but no endpoint is named.",
            },
          ],
        }),
      ),
    );

    expect(verdict.gaps.map((gap) => gap.gapClass)).toEqual([
      "ENDPOINTS_UNSPECIFIED",
    ]);
    expect(verdict.droppedClasses).toEqual([]);
    expect(verdict.verdict).toBe("GAPS");
  });
});

describe("analyzeTicket — merging code with judgment", () => {
  it("lets the deterministic P0 finding win on a duplicate class", async () => {
    const verdict = await analyzeTicket(
      makeTicket({ summary: "Nowy regulamin", description: "" }),
      stub(
        modelSays({
          taskKind: "FILE_OR_DOCUMENT_SWAP",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "DESCRIPTION_MISSING",
              groundingClause: "the model's own wording",
            },
          ],
        }),
      ),
    );

    const described = verdict.gaps.filter(
      (gap) => gap.gapClass === "DESCRIPTION_MISSING",
    );
    expect(described).toHaveLength(1);
    expect(described[0].groundingClause).toContain("Nowy regulamin");
    expect(described[0].groundingClause).not.toBe("the model's own wording");
  });

  it("reports a P0 gap even when the model saw nothing", async () => {
    const verdict = await analyzeTicket(
      makeTicket({ description: "" }),
      stub(modelSays({ taskKind: "OTHER", verdict: "DOR_MET", gaps: [] })),
    );

    expect(verdict.gaps.map((gap) => gap.gapClass)).toContain(
      "DESCRIPTION_MISSING",
    );
    expect(verdict.verdict).toBe("GAPS");
  });
});

describe("analyzeTicket — verdict reduction", () => {
  it("returns DOR_MET when nothing survives the merge and the gate", async () => {
    const verdict = await analyzeTicket(
      COMPLETE_TICKET,
      stub(modelSays({ taskKind: "OTHER" })),
    );
    expect(verdict.verdict).toBe("DOR_MET");
    expect(verdict.gaps).toEqual([]);
  });

  it("carries NOT_VIABLE through even though gaps also exist", async () => {
    const verdict = await analyzeTicket(
      COMPLETE_TICKET,
      stub(
        modelSays({
          taskKind: "OTHER",
          verdict: "NOT_VIABLE",
          gaps: [
            {
              gapClass: "TASK_NOT_VIABLE",
              groundingClause:
                "This ticket is about a page that was deleted last sprint, so there is nothing to change.",
            },
          ],
        }),
      ),
    );

    expect(verdict.verdict).toBe("NOT_VIABLE");
  });

  it("raises when the model claims DOR_MET while listing gaps", async () => {
    await expect(
      analyzeTicket(
        COMPLETE_TICKET,
        stub(
          modelSays({
            taskKind: "OTHER",
            verdict: "DOR_MET",
            gaps: [
              {
                gapClass: "TITLE_TOO_VAGUE",
                groundingClause: "This ticket is about X, but the title says nothing.",
              },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(RefinementAnalysisError);
  });
});

describe("analyzeTicket — an unusable model response", () => {
  // The failure mode this guards is silent: a response that does not match the
  // schema, coerced to "no gaps", reads to the lead as a clean ticket.
  it.each([
    ["a kind outside the vocabulary", { taskKind: "REFACTOR" }],
    ["a gap class outside the vocabulary", {
      verdict: "GAPS",
      gaps: [{ gapClass: "SMELLS_BAD", groundingClause: "x" }],
    }],
    ["a gap with no grounding clause", {
      verdict: "GAPS",
      gaps: [{ gapClass: "TITLE_TOO_VAGUE", groundingClause: "   " }],
    }],
    ["gaps that are not an array", { gaps: null }],
    ["nothing at all", null],
  ])("raises on %s rather than degrading to an empty gap list", async (_label, response) => {
    await expect(
      analyzeTicket(
        COMPLETE_TICKET,
        stub(response === null ? null : modelSays(response as Partial<ModelAnalysis>)),
      ),
    ).rejects.toThrow(RefinementAnalysisError);
  });
});

describe("analyzeTickets", () => {
  it("refuses a selection larger than MAX_TICKETS_PER_RUN before spending a call", async () => {
    const deps = stub(modelSays());
    const tickets = Array.from({ length: MAX_TICKETS_PER_RUN + 1 }, (_, i) =>
      makeTicket({ key: `FM-${i}`, description: "x" }),
    );

    await expect(analyzeTickets(tickets, deps)).rejects.toThrow(
      RefinementAnalysisError,
    );
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("returns one verdict per ticket plus the measurements MAX_TICKETS_PER_RUN is derived from", async () => {
    const deps = stub(modelSays({ taskKind: "OTHER" }));
    const result = await analyzeTickets(
      [
        makeTicket({ key: "FM-1", description: COMPLETE_TICKET.description }),
        makeTicket({ key: "FM-2", description: COMPLETE_TICKET.description }),
      ],
      deps,
    );

    expect(result.verdicts.map((v) => v.ticketKey)).toEqual(["FM-1", "FM-2"]);
    expect(result.measurements).toHaveLength(2);
    expect(result.measurements[0].ticketKey).toBe("FM-1");
    expect(typeof result.measurements[0].latencyMs).toBe("number");
    expect(result.measurements[0].usage).toBeDefined();
  });

  it("raises on an empty selection rather than reporting a run that analysed nothing", async () => {
    await expect(analyzeTickets([], stub(modelSays()))).rejects.toThrow(
      RefinementAnalysisError,
    );
  });
});

/**
 * The FM-7 case, kept as a regression: a real ticket whose user story and
 * acceptance criteria the P0 probes did not recognise, while the model read
 * both and judged their QUALITY. Without the guard the row said "there is no
 * user story" and "the user story names the wrong actor" at the same time.
 *
 * The probes were widened for FM-7's exact shapes, so these fixtures use a
 * shape nobody has taught them — which is the point: the guard exists for the
 * NEXT unforeseen layout, not for the one already fixed.
 */
describe("analyzeTicket — a presence gap the rest of the list contradicts", () => {
  const UNRECOGNISED_STORY = makeTicket({
    description:
      "Rola => pracownik compliance\nCel => wysyłka zgłoszeń\nWarunki => formularz jest walidowany",
  });

  it("drops USER_STORY_MISSING when the model judged that same story's actor wrong", async () => {
    const verdict = await analyzeTicket(
      UNRECOGNISED_STORY,
      stub(
        modelSays({
          taskKind: "NEW_VIEW_OR_COMPONENT",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "USER_STORY_WRONG_ACTOR",
              groundingClause:
                "Zadanie dotyczy formularza zgłoszeń, ale aktorem jest zamawiający, nie osoba wypełniająca.",
            },
          ],
        }),
      ),
    );

    const classes = verdict.gaps.map((gap) => gap.gapClass);
    expect(classes).toContain("USER_STORY_WRONG_ACTOR");
    expect(classes).not.toContain("USER_STORY_MISSING");
  });

  it("drops ACCEPTANCE_CRITERIA_MISSING when the model called a stated criterion unverifiable", async () => {
    const verdict = await analyzeTicket(
      UNRECOGNISED_STORY,
      stub(
        modelSays({
          taskKind: "NEW_VIEW_OR_COMPONENT",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "ACCEPTANCE_CRITERIA_UNVERIFIABLE",
              groundingClause:
                "Zadanie podaje „formularz jest walidowany”, ale nie mówi jakie reguły obowiązują.",
            },
          ],
        }),
      ),
    );

    const classes = verdict.gaps.map((gap) => gap.gapClass);
    expect(classes).toContain("ACCEPTANCE_CRITERIA_UNVERIFIABLE");
    expect(classes).not.toContain("ACCEPTANCE_CRITERIA_MISSING");
  });

  it("keeps the presence gap when nothing contradicts it", async () => {
    const verdict = await analyzeTicket(
      UNRECOGNISED_STORY,
      stub(
        modelSays({
          taskKind: "NEW_VIEW_OR_COMPONENT",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "MOCKUP_MISSING",
              groundingClause: "Zadanie dotyczy nowego formularza, ale nie ma makiety.",
            },
          ],
        }),
      ),
    );

    expect(verdict.gaps.map((gap) => gap.gapClass)).toContain(
      "USER_STORY_MISSING",
    );
  });
});

/**
 * The corpus caught this and the unit suite had not: a vague title and an empty
 * description are different carriers, so the first must never suppress the
 * second. `dor-notes.md` #1 is a ticket that has both at once.
 */
describe("analyzeTicket — carriers the guard must keep apart", () => {
  it("keeps DESCRIPTION_MISSING alongside TITLE_TOO_VAGUE", async () => {
    const verdict = await analyzeTicket(
      makeTicket({ summary: "Feedy produktowe", description: "" }),
      stub(
        modelSays({
          taskKind: "SPIKE",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "TITLE_TOO_VAGUE",
              groundingClause:
                "Zadanie nosi tytuł „Feedy produktowe”, ale nie mówi, co ma powstać.",
            },
          ],
        }),
      ),
    );

    const classes = verdict.gaps.map((gap) => gap.gapClass);
    expect(classes).toContain("DESCRIPTION_MISSING");
    expect(classes).toContain("TITLE_TOO_VAGUE");
  });
});

/**
 * A pasted story carries no attachments BY CONSTRUCTION, so an absence-based
 * finding about one is unknowable rather than true. `prompt.ts` says so in
 * words; the model reported MOCKUP_MISSING on a real paste regardless, which is
 * why this is enforced in code (criterion 6.12).
 */
describe("analyzeTicket — absence nobody could have proven", () => {
  const pasted = makeTicket({
    origin: "PASTE",
    key: "PASTED",
    sourceUrl: null,
    description:
      "Jako klient chcę widzieć powiadomienia o statusie zamówienia, żeby nie sprawdzać panelu co godzinę.",
  });

  it("drops MOCKUP_MISSING and FILE_ATTACHMENT_MISSING on a pasted story", async () => {
    const verdict = await analyzeTicket(
      pasted,
      stub(
        modelSays({
          taskKind: "NEW_VIEW_OR_COMPONENT",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "MOCKUP_MISSING",
              groundingClause: "Ten ticket opisuje nową zakładkę, ale nie ma makiety.",
            },
            {
              gapClass: "DATA_SOURCE_UNSPECIFIED",
              groundingClause: "Ten ticket nie mówi, skąd pochodzą powiadomienia.",
            },
          ],
        }),
      ),
    );

    const classes = verdict.gaps.map((gap) => gap.gapClass);
    expect(classes).not.toContain("MOCKUP_MISSING");
    expect(classes).toContain("DATA_SOURCE_UNSPECIFIED");
    // A fact about the input, not a predicate that might be wrong — so it does
    // NOT travel as a dropped class the way the task-kind gate's discards do.
    expect(verdict.droppedClasses).not.toContain("MOCKUP_MISSING");
  });

  it("keeps MOCKUP_MISSING on a ticket actually read from Jira", async () => {
    const verdict = await analyzeTicket(
      makeTicket({ description: "Nowa zakładka w panelu klienta." }),
      stub(
        modelSays({
          taskKind: "NEW_VIEW_OR_COMPONENT",
          verdict: "GAPS",
          gaps: [
            {
              gapClass: "MOCKUP_MISSING",
              groundingClause: "Ten ticket opisuje nową zakładkę, ale nie ma makiety.",
            },
          ],
        }),
      ),
    );

    expect(verdict.gaps.map((gap) => gap.gapClass)).toContain("MOCKUP_MISSING");
  });
});
