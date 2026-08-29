import { describe, expect, it } from "vitest";

import { RETAINED_SPRINTS, resolveRetentionCutoff } from "@/lib/recap/retention";

/**
 * The retention boundary (S-12 Phase 2, FR-019) — the pure half, tested without
 * a database.
 *
 * Every case here is a case in which the rule must decline or must land on a
 * specific local day. This is the arithmetic in front of the repo's first
 * irreversible deletion, so "declines" is asserted as loudly as "deletes".
 */

/** The series shape the resolver actually reads — newest-first, `start_date`
 * only, which is all `listRecordedSprints` guarantees about ordering. */
function series(...startDates: (string | null)[]) {
  return startDates.map((iso) => ({
    startDate: iso === null ? null : new Date(iso),
  }));
}

describe("resolveRetentionCutoff", () => {
  it("declines when the team has fewer than three recorded sprints", () => {
    // A young team. Not a cutoff of zero, not "older than today" — no cutoff at
    // all, so `purgeOldRecaps` never issues a DELETE.
    expect(resolveRetentionCutoff(series(), "Europe/Warsaw")).toBeNull();
    expect(
      resolveRetentionCutoff(series("2026-08-17T08:00:00.000Z"), "Europe/Warsaw"),
    ).toBeNull();
    expect(
      resolveRetentionCutoff(
        series("2026-08-17T08:00:00.000Z", "2026-08-03T08:00:00.000Z"),
        "Europe/Warsaw",
      ),
    ).toBeNull();
  });

  it("takes the third-newest sprint's start day — the current sprint plus two", () => {
    const cutoff = resolveRetentionCutoff(
      series(
        "2026-08-17T08:00:00.000Z", // current
        "2026-08-03T08:00:00.000Z", // previous
        "2026-07-20T08:00:00.000Z", // previous-previous — the boundary
        "2026-07-06T08:00:00.000Z", // beyond the bound, must not be chosen
      ),
      "Europe/Warsaw",
    );

    expect(cutoff).toBe("2026-07-20");
    // The constant IS the rule; a change to it changes what is deleted.
    expect(RETAINED_SPRINTS).toBe(3);
  });

  it("declines when the third-newest sprint has no start date", () => {
    // `writeLeadColumn` can insert a record carrying only the identity columns
    // (`measurement/reader.ts:123-132`), which sorts NULLS LAST — so a
    // start-date-less row CAN occupy the boundary slot. Without a date there is
    // no boundary, and the rule fails toward keeping data.
    expect(
      resolveRetentionCutoff(
        series("2026-08-17T08:00:00.000Z", "2026-08-03T08:00:00.000Z", null),
        "Europe/Warsaw",
      ),
    ).toBeNull();
  });

  it("resolves the boundary in the TEAM's zone, not in UTC", () => {
    // 20:00Z on the 31st is already the 1st in Auckland (UTC+12). `recap_day` is
    // a local DayKey, so a UTC-derived cutoff would spare (or delete) a whole
    // day's recap at every boundary for a team east of UTC.
    const boundary = series(
      "2026-09-28T08:00:00.000Z",
      "2026-09-14T08:00:00.000Z",
      "2026-08-31T20:00:00.000Z",
    );

    expect(resolveRetentionCutoff(boundary, "Pacific/Auckland")).toBe("2026-09-01");
    expect(resolveRetentionCutoff(boundary, "UTC")).toBe("2026-08-31");
    // An absent or unrecognized zone degrades to UTC through `safeZone` rather
    // than throwing (`day-bucket.ts:1-13`) — the purge must not die on a project
    // row whose `time_zone` was never written.
    expect(resolveRetentionCutoff(boundary, null)).toBe("2026-08-31");
    expect(resolveRetentionCutoff(boundary, "Mars/Olympus")).toBe("2026-08-31");
  });
});
