import { describe, expect, it } from "vitest";

import {
  approveButtonLabel,
  emptyApprovalHint,
  proposalHeadline,
  proposalImpact,
  toHolidayProposalRows,
} from "@/components/organisms/settings/holiday-calendar-view";

/**
 * S-17 Phase 4 — the review list's shaping and copy.
 *
 * The load-bearing case is `costsNothing`: two of Poland's fourteen always fall
 * on a Sunday, so a lead who approves fourteen days and watches capacity drop by
 * ten needs to have been told which is which BEFORE approving, or the drop reads
 * as an arithmetic error.
 */

const WEEK = ["MON", "TUE", "WED", "THU", "FRI"];

/** 2026-01-01 is a Thursday; 2026-01-03 is a Saturday. */
const PROPOSED = [
  { year: 2026, day: "2026-01-03", label: "A Saturday one" },
  { year: 2026, day: "2026-01-01", label: "Nowy Rok" },
];

describe("toHolidayProposalRows", () => {
  it("sorts chronologically regardless of input order", () => {
    const rows = toHolidayProposalRows({ proposed: PROPOSED, workingDays: WEEK });
    expect(rows.map((r) => r.day)).toEqual(["2026-01-01", "2026-01-03"]);
  });

  it("flags the day that costs the team nothing", () => {
    const rows = toHolidayProposalRows({ proposed: PROPOSED, workingDays: WEEK });
    expect(rows[0].costsNothing).toBe(false);
    expect(rows[1].costsNothing).toBe(true);
  });

  it("follows the team's own working week, not Mon–Fri", () => {
    // A Sat–Wed team works the Saturday and not the Thursday.
    const rows = toHolidayProposalRows({
      proposed: PROPOSED,
      workingDays: ["SAT", "SUN", "MON", "TUE", "WED"],
    });
    expect(rows[0].costsNothing).toBe(true);
    expect(rows[1].costsNothing).toBe(false);
  });

  it("treats an empty working-day list as absent, not as 'no days are worked'", () => {
    const rows = toHolidayProposalRows({ proposed: PROPOSED, workingDays: [] });
    expect(rows[0].costsNothing).toBe(false);
  });

  it("carries the year through, so a two-year list can be stamped per year", () => {
    const rows = toHolidayProposalRows({
      proposed: [
        { year: 2027, day: "2027-01-01", label: "Nowy Rok" },
        { year: 2026, day: "2026-12-25", label: "Boże Narodzenie" },
      ],
      workingDays: WEEK,
    });
    expect(rows.map((r) => r.year)).toEqual([2026, 2027]);
  });
});

describe("proposalImpact", () => {
  it("counts the days that will actually move the numbers", () => {
    const rows = toHolidayProposalRows({ proposed: PROPOSED, workingDays: WEEK });
    expect(proposalImpact(rows)).toEqual({ total: 2, costing: 1 });
  });
});

describe("proposalHeadline", () => {
  it("names the year and how many days cost anything", () => {
    const rows = toHolidayProposalRows({ proposed: PROPOSED, workingDays: WEEK });
    const headline = proposalHeadline(rows);

    expect(headline).toContain("2026");
    expect(headline).toContain("1 of them");
  });

  it("names both years when the sprint crosses a boundary", () => {
    const rows = toHolidayProposalRows({
      proposed: [
        { year: 2026, day: "2026-12-25", label: "Boże Narodzenie" },
        { year: 2027, day: "2027-01-01", label: "Nowy Rok" },
      ],
      workingDays: WEEK,
    });

    expect(proposalHeadline(rows)).toContain("2026 and 2027");
  });

  it("does not say '2 of them' when every day costs a working day", () => {
    const rows = toHolidayProposalRows({
      proposed: [{ year: 2026, day: "2026-01-01", label: "Nowy Rok" }],
      workingDays: WEEK,
    });
    expect(proposalHeadline(rows)).toContain("costs your team a working day");
  });

  it("says there is nothing left when the list is empty", () => {
    expect(proposalHeadline([])).toMatch(/already recorded/i);
  });
});

describe("emptyApprovalHint", () => {
  it("explains that approving nothing is still a decision", () => {
    // The team that works every public holiday. Without the stamp, the whole
    // calendar comes back on the next render.
    expect(emptyApprovalHint(0)).toMatch(/reviewed/i);
  });

  it("is silent once anything is kept", () => {
    expect(emptyApprovalHint(1)).toBeNull();
  });
});

describe("approveButtonLabel", () => {
  it("says what it is doing while saving", () => {
    expect(approveButtonLabel(true)).not.toBe(approveButtonLabel(false));
  });
});
