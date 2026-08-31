import { describe, expect, it } from "vitest";

import { holidayCalendarNotice } from "@/lib/holidays/calendar-notice";

/**
 * S-17 Phase 4 — the whole precedence table, row by row.
 *
 * Enumerated rather than sampled because four conditions can be true at once
 * and the table is the specification: a reordering that "looks equivalent" is
 * exactly the change these cases exist to catch. The demo row in particular is
 * asserted with a country set AND a year unapproved, so it cannot pass by
 * accident on an input that would have been silent anyway.
 */

const BASE = {
  isDemo: false,
  countryCode: "PL" as string | null,
  years: [2026],
  approvedYears: new Set<number>(),
  calendarIsEmpty: true,
};

describe("holidayCalendarNotice — row 0, demo", () => {
  it("says nothing in demo, even with no country", () => {
    expect(
      holidayCalendarNotice({ ...BASE, isDemo: true, countryCode: null }),
    ).toBeNull();
  });

  it("says nothing in demo with a country and an unapproved year", () => {
    // The state that would produce `year_unapproved` on a real account.
    expect(holidayCalendarNotice({ ...BASE, isDemo: true })).toBeNull();
  });
});

describe("holidayCalendarNotice — row 1, country unavailable", () => {
  it("names the stored code when no rules exist for it", () => {
    const notice = holidayCalendarNotice({ ...BASE, countryCode: "XX" });

    expect(notice?.kind).toBe("country_unavailable");
    // The lead cannot act on "your country" — they need to see which one.
    expect(notice?.body).toContain("XX");
  });

  it("outranks the unapproved year, which would otherwise be offered", () => {
    // Approving an empty list would stamp a year with zero holidays and read as
    // success — `lessons.md`'s narrowing predicate.
    const notice = holidayCalendarNotice({
      ...BASE,
      countryCode: "XX",
      approvedYears: new Set<number>(),
    });
    expect(notice?.kind).not.toBe("year_unapproved");
  });

  it("does not fire when at least one year asked about has rules", () => {
    const notice = holidayCalendarNotice({ ...BASE, years: [2026, 2027] });
    expect(notice?.kind).toBe("year_unapproved");
  });
});

describe("holidayCalendarNotice — row 2, no country", () => {
  it("offers to pick one", () => {
    const notice = holidayCalendarNotice({ ...BASE, countryCode: null });
    expect(notice?.kind).toBe("no_country");
  });

  it("outranks a calendar the lead already filled in by hand", () => {
    // The state the row exists for: rows typed by hand, but still no
    // jurisdiction, no recurrence, and no answer for next January.
    const notice = holidayCalendarNotice({
      ...BASE,
      countryCode: null,
      calendarIsEmpty: false,
    });

    expect(notice?.kind).toBe("no_country");
    // And the copy must not read as a complaint about the rows they typed.
    expect(notice?.body).toMatch(/already recorded/i);
  });

  it("names both numbers the missing calendar moves", () => {
    const body = holidayCalendarNotice({ ...BASE, countryCode: null })?.body ?? "";
    expect(body).toMatch(/man-days/i);
    expect(body).toMatch(/age/i);
  });
});

describe("holidayCalendarNotice — row 3, year unapproved", () => {
  it("names the year", () => {
    const notice = holidayCalendarNotice(BASE);

    expect(notice?.kind).toBe("year_unapproved");
    expect(notice?.title).toContain("2026");
  });

  it("names both years when the sprint crosses a boundary", () => {
    const notice = holidayCalendarNotice({ ...BASE, years: [2026, 2027] });

    expect(notice?.title).toContain("2026");
    expect(notice?.title).toContain("2027");
  });

  it("still fires when only the SECOND year is unapproved", () => {
    // The mid-December failure this exists for: the current year is approved,
    // the sprint runs into January, and 1 January is being counted as a working
    // day right now.
    const notice = holidayCalendarNotice({
      ...BASE,
      years: [2026, 2027],
      approvedYears: new Set([2026]),
    });

    expect(notice?.kind).toBe("year_unapproved");
    expect(notice?.title).toContain("2027");
    expect(notice?.title).not.toContain("2026");
  });

  it("names both numbers the unreviewed year moves", () => {
    const body = holidayCalendarNotice(BASE)?.body ?? "";
    expect(body).toMatch(/man-days/i);
    expect(body).toMatch(/age/i);
  });
});

describe("holidayCalendarNotice — row 4, silence", () => {
  it("says nothing once every year asked about is approved", () => {
    expect(
      holidayCalendarNotice({ ...BASE, approvedYears: new Set([2026]) }),
    ).toBeNull();
  });

  it("says nothing to a lead who approved a year and kept no days", () => {
    // A team that genuinely works every public holiday. The approval record,
    // not the row count, is what says the calendar was reviewed — so this
    // account is silent even though it holds nothing.
    expect(
      holidayCalendarNotice({
        ...BASE,
        approvedYears: new Set([2026]),
        calendarIsEmpty: true,
      }),
    ).toBeNull();
  });
});
