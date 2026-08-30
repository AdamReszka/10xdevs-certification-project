import { describe, expect, it } from "vitest";

import {
  type MeasurementRef,
  type SprintRowRef,
  resolveAdjustmentAvailability,
  resolveSprintSelection,
  toSprintOptions,
} from "@/app/(app)/dashboard/sprint-detail/sprint-selection";

/**
 * S-23 Phase 7 — one case per row of the plan's three-way table, plus the two
 * withholdings that gate the lead's manual entries.
 *
 * The middle row is the one worth the file: a sprint whose measurement outlived
 * its raw data must render ITSELF with a notice, never the active sprint's
 * numbers under its name.
 */

/**
 * Every date below is DISTINCT per sprint and per source, so a leak has
 * somewhere to show up (S-25 Phase 2). If the measurement-only branch ever
 * returns `ACTIVE_START`, that is the whole bug this file exists to prevent,
 * wearing dates instead of numbers.
 */
const ACTIVE_START = new Date("2026-08-17T00:00:00.000Z");
const ACTIVE_END = new Date("2026-08-28T00:00:00.000Z");
const CLOSED_ROW_START = new Date("2026-08-03T00:00:00.000Z");
const CLOSED_ROW_END = new Date("2026-08-14T00:00:00.000Z");
const RECORD_START = new Date("2026-07-06T00:00:00.000Z");
const RECORD_END = new Date("2026-07-17T00:00:00.000Z");

const ACTIVE: SprintRowRef = {
  id: "row-active",
  jiraSprintId: "900",
  name: "Sprint 12",
  startDate: ACTIVE_START,
  endDate: ACTIVE_END,
};
const CLOSED: SprintRowRef = {
  id: "row-closed",
  jiraSprintId: "899",
  name: "Sprint 11",
  startDate: CLOSED_ROW_START,
  endDate: CLOSED_ROW_END,
};

function measurement(jiraSprintId: string, sprintName: string | null): MeasurementRef {
  return { jiraSprintId, sprintName, startDate: RECORD_START, endDate: RECORD_END };
}

const SERIES = [measurement("900", "Sprint 12"), measurement("899", "Sprint 11")];

describe("resolveSprintSelection", () => {
  it("renders the active sprint when no sprint was asked for", () => {
    expect(
      resolveSprintSelection({
        requestedJiraSprintId: null,
        activeSprint: ACTIVE,
        requestedSprint: null,
        measurements: SERIES,
      }),
    ).toEqual({
      jiraSprintId: "900",
      name: "Sprint 12",
      sprintRowId: "row-active",
      startDate: ACTIVE_START,
      endDate: ACTIVE_END,
      kind: "active",
    });
  });

  it("renders the selected sprint, with its row, when both halves are there", () => {
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: CLOSED,
      measurements: SERIES,
    });

    expect(selection.kind).toBe("selected");
    expect(selection.sprintRowId).toBe("row-closed");
    expect(selection.jiraSprintId).toBe("899");
  });

  it("renders the SELECTED sprint, not the active one, when its raw data is gone", () => {
    // The bug the three-way table exists to prevent. A sprint recorded before a
    // Jira-project switch has no `sprint` row left; falling back to the active
    // sprint here would put the active sprint's aging, matrix and burndown on
    // screen under the old sprint's name.
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: null,
      measurements: SERIES,
    });

    expect(selection).toEqual({
      jiraSprintId: "899",
      name: "Sprint 11",
      sprintRowId: null,
      startDate: RECORD_START,
      endDate: RECORD_END,
      kind: "measurement-only",
    });
  });

  it("dates a row-less sprint from its RECORD, never from the active sprint", () => {
    // The same substitution as above, one field further in. A date is exactly
    // the kind of value that looks plausible under the wrong sprint's name —
    // which is why it is asserted against the active sprint's, not just for
    // being non-null.
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: null,
      measurements: SERIES,
    });

    expect(selection.startDate).toEqual(RECORD_START);
    expect(selection.endDate).toEqual(RECORD_END);
    expect(selection.startDate).not.toEqual(ACTIVE_START);
    expect(selection.endDate).not.toEqual(ACTIVE_END);
  });

  it("prefers the ROW's dates over the record's on the selected branch", () => {
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: CLOSED,
      measurements: SERIES,
    });

    expect(selection.startDate).toEqual(CLOSED_ROW_START);
    expect(selection.endDate).toEqual(CLOSED_ROW_END);
  });

  it("falls back to the record's dates when the row carries none", () => {
    // `sprint.start_date` is nullable, so this is reachable rather than
    // theoretical — and it mirrors how the NAME already resolves one line up.
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: { ...CLOSED, startDate: null, endDate: null },
      measurements: SERIES,
    });

    expect(selection.kind).toBe("selected");
    expect(selection.startDate).toEqual(RECORD_START);
    expect(selection.endDate).toEqual(RECORD_END);
  });

  it("falls back to the active sprint on an id it has never recorded", () => {
    // A stale bookmark, or another account's id. Not a crash, and not a render
    // of someone else's sprint: the series it is resolved against is already
    // owner- and project-scoped.
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "12345",
      activeSprint: ACTIVE,
      requestedSprint: null,
      measurements: SERIES,
    });

    expect(selection.kind).toBe("active");
    expect(selection.jiraSprintId).toBe("900");
  });

  it("ignores a row lookup that answered about a different sprint", () => {
    const selection = resolveSprintSelection({
      requestedJiraSprintId: "899",
      activeSprint: ACTIVE,
      requestedSprint: ACTIVE,
      measurements: SERIES,
    });

    expect(selection.kind).toBe("measurement-only");
    expect(selection.sprintRowId).toBeNull();
  });

  it("says there is nothing at all when the account has no sprint", () => {
    expect(
      resolveSprintSelection({
        requestedJiraSprintId: null,
        activeSprint: null,
        requestedSprint: null,
        measurements: [],
      }),
    ).toEqual({
      jiraSprintId: null,
      name: null,
      sprintRowId: null,
      startDate: null,
      endDate: null,
      kind: "none",
    });
  });

  it("still falls back to the active sprint when the series is empty", () => {
    expect(
      resolveSprintSelection({
        requestedJiraSprintId: "899",
        activeSprint: ACTIVE,
        requestedSprint: CLOSED,
        measurements: [],
      }).kind,
    ).toBe("active");
  });
});

describe("toSprintOptions", () => {
  it("keeps the reader's newest-first order and marks the active sprint", () => {
    expect(toSprintOptions({ measurements: SERIES, activeSprint: ACTIVE })).toEqual([
      { jiraSprintId: "900", label: "Sprint 12", isActive: true },
      { jiraSprintId: "899", label: "Sprint 11", isActive: false },
    ]);
  });

  it("pins the active sprint on top when the sweep has not recorded it yet", () => {
    // A sprint that started ten minutes ago has no record. A switcher that
    // could not name the sprint on screen would be worse than no switcher.
    const options = toSprintOptions({
      measurements: [measurement("899", "Sprint 11")],
      activeSprint: ACTIVE,
    });

    expect(options.map((o) => o.jiraSprintId)).toEqual(["900", "899"]);
    expect(options[0].isActive).toBe(true);
  });

  it("names a nameless sprint by its id rather than rendering an empty row", () => {
    expect(
      toSprintOptions({ measurements: [measurement("899", null)], activeSprint: null })[0]
        .label,
    ).toBe("Sprint 899");
  });

  it("returns an empty list for an account with neither", () => {
    expect(toSprintOptions({ measurements: [], activeSprint: null })).toEqual([]);
  });
});

describe("resolveAdjustmentAvailability", () => {
  it("offers the delivered correction on a finalized sprint", () => {
    expect(
      resolveAdjustmentAvailability({ sprintRowId: "row-closed", isFinalized: true }),
    ).toEqual({ kind: "editable", canCorrectDelivered: true });
  });

  it("withholds the delivered field while the record is not finalized", () => {
    // The sweep is still recomputing it every cycle, so a correction entered now
    // is a guess that survives into FR-024's average.
    expect(
      resolveAdjustmentAvailability({ sprintRowId: "row-active", isFinalized: false }),
    ).toEqual({ kind: "editable", canCorrectDelivered: false });
  });

  it("withholds the whole form when the sprint row is gone", () => {
    // `writeLeadColumn` resolves the owner's `sprint` row before writing, so
    // this form could only ever fail. Both branches asserted, so a finalized
    // record cannot smuggle the form back in.
    expect(resolveAdjustmentAvailability({ sprintRowId: null, isFinalized: true })).toEqual(
      { kind: "unavailable" },
    );
    expect(
      resolveAdjustmentAvailability({ sprintRowId: null, isFinalized: false }),
    ).toEqual({ kind: "unavailable" });
  });
});
