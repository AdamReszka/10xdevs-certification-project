import { describe, expect, it } from "vitest";

import {
  buildActivityGrid,
  UNKNOWN_MEMBER_ID,
  type ActivityMember,
} from "@/lib/dashboard/activity-grid";
import { dayRangeInTimeZone } from "@/lib/dashboard/day-bucket";

/**
 * Unit suite for M2. The load-bearing cases: null churn must stay null (an
 * over-cap commit was never measured, and 0 would be a lie), unmatched authors
 * must land in UNKNOWN rather than vanish, and a developer with no activity must
 * still render a row.
 */

const ZONE = "Europe/Warsaw";
const FROM = new Date("2026-08-17T08:00:00Z");
const TO = new Date("2026-08-19T08:00:00Z");

const MEMBERS: ActivityMember[] = [
  { id: "m-1", name: "Ada", githubUsername: "ada" },
  { id: "m-2", name: "Bo", githubUsername: "BoDev" },
  { id: "m-3", name: "Cy", githubUsername: null },
];

function build(args: Partial<Parameters<typeof buildActivityGrid>[0]> = {}) {
  return buildActivityGrid({
    commits: [],
    pullRequests: [],
    reviews: [],
    members: MEMBERS,
    from: FROM,
    to: TO,
    timeZone: ZONE,
    ...args,
  });
}

describe("buildActivityGrid — shape", () => {
  it("renders one row per roster member with every day zeroed", () => {
    const grid = build();

    expect(grid.days).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(grid.rows.map((r) => r.memberId)).toEqual(["m-1", "m-2", "m-3"]);
    for (const row of grid.rows) {
      expect(Object.keys(row.cells)).toEqual(grid.days);
      expect(row.cells["2026-08-17"]).toEqual({
        commits: 0,
        additions: null,
        deletions: null,
        prsOpened: 0,
        prsMerged: 0,
        reviews: 0,
      });
    }
  });

  it("keeps a developer with zero activity in the grid", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 5,
          deletions: 1,
        },
      ],
    });

    const cy = grid.rows.find((r) => r.memberId === "m-3")!;
    expect(cy.cells["2026-08-18"].commits).toBe(0);
  });
});

describe("buildActivityGrid — commits and churn", () => {
  it("sums commits and churn into the author's local-day cell", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 10,
          deletions: 2,
        },
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T14:00:00Z"),
          additions: 5,
          deletions: 3,
        },
      ],
    });

    const cell = grid.rows[0].cells["2026-08-18"];
    expect(cell.commits).toBe(2);
    expect(cell.additions).toBe(15);
    expect(cell.deletions).toBe(5);
  });

  it("keeps churn null when every contributing commit was unmeasured", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: null,
          deletions: null,
        },
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T14:00:00Z"),
          additions: null,
          deletions: null,
        },
      ],
    });

    const cell = grid.rows[0].cells["2026-08-18"];
    expect(cell.commits).toBe(2);
    expect(cell.additions).toBeNull();
    expect(cell.deletions).toBeNull();
  });

  it("sums only the measured commits when the cell mixes null and non-null", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 7,
          deletions: 2,
        },
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T14:00:00Z"),
          additions: null,
          deletions: null,
        },
      ],
    });

    const cell = grid.rows[0].cells["2026-08-18"];
    expect(cell.commits).toBe(2);
    expect(cell.additions).toBe(7);
  });

  it("buckets by the team's local day, not UTC", () => {
    // 22:30 UTC on the 17th is 00:30 Warsaw on the 18th.
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-17T22:30:00Z"),
          additions: 1,
          deletions: 0,
        },
      ],
    });

    expect(grid.rows[0].cells["2026-08-17"].commits).toBe(0);
    expect(grid.rows[0].cells["2026-08-18"].commits).toBe(1);
  });

  it("drops events outside the requested range and events with no timestamp", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-25T10:00:00Z"),
          additions: 9,
          deletions: 9,
        },
        { authorGithubUsername: "ada", authoredAt: null, additions: 9, deletions: 9 },
      ],
    });

    for (const day of grid.days) {
      expect(grid.rows[0].cells[day].commits).toBe(0);
    }
  });
});

describe("buildActivityGrid — PRs and reviews", () => {
  it("counts a PR on both its opened and merged day", () => {
    const grid = build({
      pullRequests: [
        {
          authorGithubUsername: "ada",
          openedAt: new Date("2026-08-17T10:00:00Z"),
          mergedAt: new Date("2026-08-19T10:00:00Z"),
        },
      ],
    });

    expect(grid.rows[0].cells["2026-08-17"].prsOpened).toBe(1);
    expect(grid.rows[0].cells["2026-08-19"].prsMerged).toBe(1);
    expect(grid.rows[0].cells["2026-08-17"].prsMerged).toBe(0);
  });

  it("counts an unmerged PR as opened only", () => {
    const grid = build({
      pullRequests: [
        {
          authorGithubUsername: "ada",
          openedAt: new Date("2026-08-17T10:00:00Z"),
          mergedAt: null,
        },
      ],
    });

    expect(grid.rows[0].cells["2026-08-17"].prsOpened).toBe(1);
    expect(grid.days.every((d) => grid.rows[0].cells[d].prsMerged === 0)).toBe(true);
  });

  it("counts reviews for the reviewer, not the PR author", () => {
    const grid = build({
      reviews: [
        {
          reviewerGithubUsername: "BoDev",
          submittedAt: new Date("2026-08-18T10:00:00Z"),
        },
      ],
    });

    expect(grid.rows[1].cells["2026-08-18"].reviews).toBe(1);
    expect(grid.rows[0].cells["2026-08-18"].reviews).toBe(0);
  });
});

describe("buildActivityGrid — login matching and the UNKNOWN row", () => {
  it("matches GitHub logins case-insensitively", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "bodev",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 3,
          deletions: 1,
        },
      ],
    });

    expect(grid.rows.find((r) => r.memberId === "m-2")!.cells["2026-08-18"].commits).toBe(1);
    expect(grid.rows.some((r) => r.memberId === UNKNOWN_MEMBER_ID)).toBe(false);
  });

  it("aggregates unmatched and null authors into one trailing UNKNOWN row", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "drive-by",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 4,
          deletions: 1,
        },
        {
          authorGithubUsername: null,
          authoredAt: new Date("2026-08-18T11:00:00Z"),
          additions: 2,
          deletions: 0,
        },
      ],
      reviews: [
        { reviewerGithubUsername: "someone-else", submittedAt: new Date("2026-08-19T09:00:00Z") },
      ],
    });

    expect(grid.rows[grid.rows.length - 1].memberId).toBe(UNKNOWN_MEMBER_ID);
    const unknown = grid.rows[grid.rows.length - 1];
    expect(unknown.cells["2026-08-18"].commits).toBe(2);
    expect(unknown.cells["2026-08-18"].additions).toBe(6);
    expect(unknown.cells["2026-08-19"].reviews).toBe(1);
  });

  it("omits the UNKNOWN row entirely when every event resolves", () => {
    const grid = build({
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 1,
          deletions: 1,
        },
      ],
    });

    expect(grid.rows).toHaveLength(MEMBERS.length);
  });

  it("does not match a null-login member against a null-author event", () => {
    // Cy has no GitHub username; a null-author commit must not be attributed to them.
    const grid = build({
      commits: [
        {
          authorGithubUsername: null,
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 1,
          deletions: 1,
        },
      ],
    });

    expect(grid.rows.find((r) => r.memberId === "m-3")!.cells["2026-08-18"].commits).toBe(0);
    expect(grid.rows[grid.rows.length - 1].memberId).toBe(UNKNOWN_MEMBER_ID);
  });
});

describe("buildActivityGrid — single-day range (Yesterday's Activity)", () => {
  it("renders exactly one column for a zone-local day range", () => {
    // The bounds MUST be zone-local: 2026-08-18T23:59:59Z is already the 19th in
    // Warsaw, so a midnight-to-midnight-UTC range would spill a second column.
    const { from, to } = dayRangeInTimeZone("2026-08-18", ZONE);
    const grid = build({
      from,
      to,
      commits: [
        {
          authorGithubUsername: "ada",
          authoredAt: new Date("2026-08-18T10:00:00Z"),
          additions: 3,
          deletions: 3,
        },
      ],
    });

    expect(grid.days).toEqual(["2026-08-18"]);
    expect(grid.rows[0].cells["2026-08-18"].commits).toBe(1);
  });
});
