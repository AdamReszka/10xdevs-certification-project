import { describe, expect, it } from "vitest";

import { holidayCalendarNotice } from "@/lib/holidays/calendar-notice";

/**
 * S-17 Phase 1 — the disclosure's decision logic.
 *
 * Two branches only, because Phase 1 has two states to tell apart. The
 * assertions on the BODY are not style checks: the sentence has to name both
 * consumers of the calendar, and a future edit that trims it back to "capacity"
 * would leave the aging budgets undisclosed with every gate still green.
 */
describe("holidayCalendarNotice", () => {
  it("speaks when the account holds no team day off at all", () => {
    const notice = holidayCalendarNotice({ calendarIsEmpty: true });

    expect(notice).not.toBeNull();
    expect(notice?.kind).toBe("empty");
    expect(notice?.title).toBeTruthy();
  });

  it("names both numbers the empty calendar moves, not only capacity", () => {
    const body = holidayCalendarNotice({ calendarIsEmpty: true })?.body ?? "";

    // The man-day figure...
    expect(body).toMatch(/man-days/i);
    // ...and the elapsed-time rules, which S-23 wired to the same set.
    expect(body).toMatch(/age/i);
  });

  it("says nothing once the calendar has any row", () => {
    expect(holidayCalendarNotice({ calendarIsEmpty: false })).toBeNull();
  });
});
