import { describe, expect, it } from "vitest";

import { labelFor, toSprintIdentity } from "@/lib/sprint-identity";

/**
 * S-25 Phase 1 — the formatting decisions four surfaces now share.
 *
 * The Warsaw case is the one that justifies the module's zone choice: the
 * tester's own sprint is stored as `2026-08-29T22:46Z` and everyone on her team
 * calls it a 30.08 sprint. If this file ever goes green with `29.08`, the dates
 * on screen have stopped being checkable against Jira, which is the whole point
 * of printing them.
 */

/** The separator is invisible in a diff, so name it once and assert against it. */
const JOIN = "\u200A\u2013\u200A";

const NOW = new Date("2026-08-30T09:00:00.000Z");

describe("toSprintIdentity", () => {
  it("names the sprint and its range in the team's zone", () => {
    expect(
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: new Date("2026-08-29T22:46:00.000Z"),
        endDate: new Date("2026-09-12T22:46:00.000Z"),
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toEqual({
      kind: "identified",
      label: "PT Sprint 1",
      range: `30.08${JOIN}13.09`,
    });
  });

  it("reads the SAME instants as the previous day in UTC", () => {
    // Not a curiosity: this is the difference between the identity matching the
    // lead's Jira and quietly naming a different day.
    expect(
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: new Date("2026-08-29T22:46:00.000Z"),
        endDate: new Date("2026-09-12T22:46:00.000Z"),
        timeZone: "UTC",
        now: NOW,
      }),
    ).toMatchObject({ range: `29.08${JOIN}12.09` });
  });

  it("degrades an unrecognized zone to UTC instead of throwing", () => {
    expect(() =>
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: new Date("2026-08-29T22:46:00.000Z"),
        endDate: new Date("2026-09-12T22:46:00.000Z"),
        timeZone: "Mars/Olympus_Mons",
        now: NOW,
      }),
    ).not.toThrow();

    expect(
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: new Date("2026-08-29T22:46:00.000Z"),
        endDate: new Date("2026-09-12T22:46:00.000Z"),
        timeZone: null,
        now: NOW,
      }),
    ).toMatchObject({ range: `29.08${JOIN}12.09` });
  });

  it("calls a nameless sprint by its Jira id", () => {
    expect(
      toSprintIdentity({
        name: null,
        jiraSprintId: "1042",
        startDate: null,
        endDate: null,
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toEqual({ kind: "identified", label: "Sprint 1042", range: null });
  });

  it("spells a nameless sprint exactly as the switcher does", () => {
    // One definition, so the bar and the switcher entry two elements away
    // cannot drift (plan review F7).
    expect(
      toSprintIdentity({
        name: null,
        jiraSprintId: "1042",
        startDate: null,
        endDate: null,
        now: NOW,
      }),
    ).toMatchObject({ label: labelFor(null, "1042") });
  });

  it("keeps the label and withholds the range when either date is missing", () => {
    const start = new Date("2026-08-29T22:46:00.000Z");

    expect(
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: start,
        endDate: null,
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toEqual({ kind: "identified", label: "PT Sprint 1", range: null });

    expect(
      toSprintIdentity({
        name: "PT Sprint 1",
        jiraSprintId: "1042",
        startDate: null,
        endDate: start,
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toEqual({ kind: "identified", label: "PT Sprint 1", range: null });
  });

  it("reports no sprint when there is neither a name nor an id", () => {
    expect(
      toSprintIdentity({
        name: null,
        jiraSprintId: null,
        startDate: null,
        endDate: null,
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toEqual({ kind: "none" });
  });

  it("appends the year only to an endpoint outside the current year", () => {
    expect(
      toSprintIdentity({
        name: "Sprint 3",
        jiraSprintId: "800",
        startDate: new Date("2024-12-30T09:00:00.000Z"),
        endDate: new Date("2025-01-10T09:00:00.000Z"),
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toMatchObject({ range: `30.12.2024${JOIN}10.01.2025` });
  });

  it("straddling New Year INTO the current year stamps only the old endpoint", () => {
    expect(
      toSprintIdentity({
        name: "Sprint 9",
        jiraSprintId: "900",
        startDate: new Date("2025-12-29T09:00:00.000Z"),
        endDate: new Date("2026-01-09T09:00:00.000Z"),
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toMatchObject({ range: `29.12.2025${JOIN}09.01` });
  });

  it("renders a same-day range once", () => {
    expect(
      toSprintIdentity({
        name: "Spike",
        jiraSprintId: "901",
        startDate: new Date("2026-08-30T07:00:00.000Z"),
        endDate: new Date("2026-08-30T19:00:00.000Z"),
        timeZone: "Europe/Warsaw",
        now: NOW,
      }),
    ).toMatchObject({ range: "30.08" });
  });

  it("reads the current year in the team's zone, not the runner's", () => {
    // 2026-01-01T00:30Z is still 2025 in Los Angeles, so the endpoints are the
    // current year there and must NOT be stamped.
    expect(
      toSprintIdentity({
        name: "Sprint 1",
        jiraSprintId: "902",
        startDate: new Date("2025-12-20T20:00:00.000Z"),
        endDate: new Date("2025-12-31T20:00:00.000Z"),
        timeZone: "America/Los_Angeles",
        now: new Date("2026-01-01T00:30:00.000Z"),
      }),
    ).toMatchObject({ range: `20.12${JOIN}31.12` });
  });
});
