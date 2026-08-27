import { describe, expect, it } from "vitest";

import {
  GAP_CLASS_LABEL,
  TASK_KIND_LABEL,
  countVerdicts,
  describeDroppedClasses,
  groupGapsByLevel,
  orderVerdicts,
  type RunVerdictView,
} from "@/components/organisms/refinement/run-view";
import { GAP_CLASSES, TASK_KINDS, type Gap } from "@/lib/refinement/types";

function gap(over: Partial<Gap> = {}): Gap {
  return {
    gapClass: "ACCEPTANCE_CRITERIA_MISSING",
    groundingClause:
      "This ticket is about swapping the card regulations PDF, but no acceptance criteria say how we know it worked.",
    ...over,
  };
}

function view(over: Partial<RunVerdictView> = {}): RunVerdictView {
  return {
    id: "v1",
    ticketKey: "FM-12",
    ticketSummary: "Aktualizacja regulaminu karty",
    taskKind: "FILE_OR_DOCUMENT_SWAP",
    verdict: "DOR_MET",
    gaps: [],
    droppedClasses: [],
    sourceUrl: null,
    ...over,
  };
}

describe("orderVerdicts", () => {
  it("puts NOT_VIABLE first, then gaps, then the clean rows", () => {
    const ordered = orderVerdicts([
      view({ id: "a", ticketKey: "FM-1", verdict: "DOR_MET" }),
      view({ id: "b", ticketKey: "FM-2", verdict: "GAPS", gaps: [gap()] }),
      view({ id: "c", ticketKey: "FM-3", verdict: "NOT_VIABLE" }),
    ]);

    expect(ordered.map((v) => v.id)).toEqual(["c", "b", "a"]);
  });

  it("orders two GAPS rows by how many gaps they carry", () => {
    const ordered = orderVerdicts([
      view({ id: "one", ticketKey: "FM-1", verdict: "GAPS", gaps: [gap()] }),
      view({
        id: "three",
        ticketKey: "FM-2",
        verdict: "GAPS",
        gaps: [gap(), gap({ gapClass: "MOCKUP_MISSING" }), gap({ gapClass: "TITLE_TOO_VAGUE" })],
      }),
    ]);

    expect(ordered.map((v) => v.id)).toEqual(["three", "one"]);
  });

  it("breaks a tie on the ticket key, so a run renders in a stable order", () => {
    const ordered = orderVerdicts([
      view({ id: "b", ticketKey: "FM-20" }),
      view({ id: "a", ticketKey: "FM-11" }),
    ]);

    expect(ordered.map((v) => v.ticketKey)).toEqual(["FM-11", "FM-20"]);
  });

  it("does not mutate the array it was given", () => {
    const list = [view({ ticketKey: "FM-9" }), view({ ticketKey: "FM-1" })];
    orderVerdicts(list);
    expect(list.map((v) => v.ticketKey)).toEqual(["FM-9", "FM-1"]);
  });
});

describe("countVerdicts", () => {
  it("counts each verdict and every gap across the run", () => {
    expect(
      countVerdicts([
        view({ verdict: "GAPS", gaps: [gap(), gap({ gapClass: "MOCKUP_MISSING" })] }),
        view({ verdict: "GAPS", gaps: [gap()] }),
        view({ verdict: "DOR_MET" }),
        view({ verdict: "NOT_VIABLE" }),
      ]),
    ).toEqual({ total: 4, notViable: 1, withGaps: 2, dorMet: 1, gapTotal: 3 });
  });

  it("counts an empty run as empty rather than raising", () => {
    expect(countVerdicts([]).total).toBe(0);
  });
});

describe("groupGapsByLevel", () => {
  it("buckets gaps by detection level, cheapest first", () => {
    const groups = groupGapsByLevel([
      gap({ gapClass: "MOCKUP_MISSING" }), // P2
      gap({ gapClass: "DESCRIPTION_MISSING" }), // P0
      gap({ gapClass: "TASK_NOT_VIABLE" }), // P3
      gap({ gapClass: "TITLE_TOO_VAGUE" }), // P1
    ]);

    expect(groups.map((g) => g.level)).toEqual(["P0", "P1", "P2", "P3"]);
    expect(groups.every((g) => g.gaps.length === 1)).toBe(true);
  });

  it("omits a level with no gaps rather than heading an empty list", () => {
    const groups = groupGapsByLevel([gap({ gapClass: "DESCRIPTION_MISSING" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].level).toBe("P0");
  });

  it("returns nothing for a ticket with no gaps", () => {
    expect(groupGapsByLevel([])).toEqual([]);
  });
});

describe("describeDroppedClasses", () => {
  it("returns null when the gate discarded nothing", () => {
    expect(describeDroppedClasses(view({ droppedClasses: [] }))).toBeNull();
  });

  it("names the count, the classification and what it cost", () => {
    const sentence = describeDroppedClasses(
      view({
        taskKind: "BUG",
        droppedClasses: ["ENDPOINTS_UNSPECIFIED", "API_CONTRACT_MISSING"],
      }),
    );

    expect(sentence).toContain("2 checks skipped");
    expect(sentence).toContain(TASK_KIND_LABEL.BUG);
    expect(sentence).toContain(GAP_CLASS_LABEL.ENDPOINTS_UNSPECIFIED);
    expect(sentence).toContain(GAP_CLASS_LABEL.API_CONTRACT_MISSING);
  });

  it("says 'check' when exactly one was discarded", () => {
    expect(
      describeDroppedClasses(view({ droppedClasses: ["MOCKUP_MISSING"] })),
    ).toContain("1 check skipped");
  });
});

describe("the label tables cover the closed vocabulary", () => {
  // A class added to types.ts without a label here would render as `undefined`
  // on the row — the one failure mode a Record<> type cannot catch at runtime.
  it("labels every gap class", () => {
    for (const cls of GAP_CLASSES) {
      expect(GAP_CLASS_LABEL[cls], cls).toBeTruthy();
    }
  });

  it("labels every task kind", () => {
    for (const kind of TASK_KINDS) {
      expect(TASK_KIND_LABEL[kind], kind).toBeTruthy();
    }
  });
});
