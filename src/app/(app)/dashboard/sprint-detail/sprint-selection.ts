/**
 * Which sprint Sprint Detail renders, and what it may show about it
 * (S-23 Phase 7). PURE — no DB, no React, no clock.
 *
 * Extracted for the same reason as `capacity-adjustments-view.ts` and
 * `reliability-kpi-view.ts`: this repo has no component-test harness (both
 * vitest projects run `environment: "node"`; neither jsdom nor RTL is
 * installed), so a decision left inside the server component is a decision no
 * test can reach.
 *
 * THE DECISION IS THREE-WAY, NOT TWO-WAY, and the third branch is the reason
 * this file exists. `?sprint=` is resolved against `sprint_measurement` FIRST,
 * and only then is the matching `sprint` row looked up — because the two can
 * legitimately disagree. A sprint recorded before the owner switched monitored
 * Jira project has had its `sprint` row cascade-deleted
 * (`connection-service.ts`, `jira-store.ts`) while its measurement survives by
 * design; the same shape will appear again once the PRD's "current + 2 sprints"
 * retention purge exists. Falling back to the active sprint there would render
 * THE ACTIVE SPRINT'S NUMBERS under a switcher entry naming the old one —
 * silently, and in exactly the case the notice was written for.
 */

import { labelFor } from "@/lib/sprint-identity";

/** A `sprint` row, narrowed to what this decision reads. */
export type SprintRowRef = {
  id: string;
  jiraSprintId: string;
  name: string | null;
};

/** A `sprint_measurement` row, narrowed the same way. */
export type MeasurementRef = {
  jiraSprintId: string;
  sprintName: string | null;
  startDate: Date | null;
};

/**
 * How the page arrived at the sprint it is showing.
 *
 * `measurement-only` is the branch that carries a consequence: the three
 * reducers (aging, activity matrix, sub-burndown) all take a `sprint.id`, so
 * without one there is no detail data to render and the screen has to say why.
 */
export type SprintSelectionKind = "active" | "selected" | "measurement-only" | "none";

export type SprintSelection = {
  /** The sprint on screen, or `null` when the account has none at all. */
  jiraSprintId: string | null;
  /** Its name, for the heading and the switcher's value. */
  name: string | null;
  /** The `sprint` row id the three reducers need. `null` ⇒ no raw data left. */
  sprintRowId: string | null;
  kind: SprintSelectionKind;
};

const NONE: SprintSelection = {
  jiraSprintId: null,
  name: null,
  sprintRowId: null,
  kind: "none",
};

/**
 * Resolve `?sprint=` against the recorded series and the owner's sprint rows.
 *
 * `measurements` is already owner-scoped AND filtered to the current Jira
 * project by the reader, which is what stops a crafted id from another account
 * — or from a team the owner used to monitor — resolving to anything here.
 *
 * An absent or unknown id falls back to the active sprint rather than erroring:
 * a stale bookmark, or a link shared after the record aged out, is an ordinary
 * thing to happen to a URL and not a state worth a crash.
 */
export function resolveSprintSelection({
  requestedJiraSprintId,
  activeSprint,
  requestedSprint,
  measurements,
}: {
  requestedJiraSprintId: string | null;
  /** The owner's ACTIVE (or most recent) sprint — the default and the fallback. */
  activeSprint: SprintRowRef | null;
  /** The `sprint` row matching the request, when one still exists. */
  requestedSprint: SprintRowRef | null;
  measurements: readonly MeasurementRef[];
}): SprintSelection {
  const requested =
    requestedJiraSprintId === null
      ? undefined
      : measurements.find((m) => m.jiraSprintId === requestedJiraSprintId);

  if (!requested) return fromActive(activeSprint);

  // The row lookup is a separate query, so guard against it having answered
  // about a different sprint than the one asked for.
  if (requestedSprint && requestedSprint.jiraSprintId === requested.jiraSprintId) {
    return {
      jiraSprintId: requestedSprint.jiraSprintId,
      name: requestedSprint.name ?? requested.sprintName,
      sprintRowId: requestedSprint.id,
      kind: "selected",
    };
  }

  return {
    jiraSprintId: requested.jiraSprintId,
    name: requested.sprintName,
    sprintRowId: null,
    kind: "measurement-only",
  };
}

function fromActive(activeSprint: SprintRowRef | null): SprintSelection {
  if (!activeSprint) return NONE;
  return {
    jiraSprintId: activeSprint.jiraSprintId,
    name: activeSprint.name,
    sprintRowId: activeSprint.id,
    kind: "active",
  };
}

/** One entry in the switcher. Serializable — it crosses the client boundary. */
export type SprintOption = {
  jiraSprintId: string;
  label: string;
  /** Marks the sprint currently in flight, so the list reads as a timeline. */
  isActive: boolean;
};

/**
 * The switcher's list: every recorded sprint for the current project, plus the
 * active one.
 *
 * The active sprint is unioned in rather than assumed present, because the
 * record is written by a sweep that runs on sync — a sprint that started ten
 * minutes ago has no row yet, and a switcher that could not name the sprint the
 * lead is looking at would be worse than no switcher.
 *
 * Ordering is the reader's (newest `start_date` first), with the active sprint
 * pinned to the top when it has no record to be ordered by.
 */
export function toSprintOptions({
  measurements,
  activeSprint,
}: {
  measurements: readonly MeasurementRef[];
  activeSprint: SprintRowRef | null;
}): SprintOption[] {
  const options = measurements.map((m) => ({
    jiraSprintId: m.jiraSprintId,
    label: labelFor(m.sprintName, m.jiraSprintId),
    isActive: m.jiraSprintId === activeSprint?.jiraSprintId,
  }));

  if (!activeSprint) return options;
  if (options.some((o) => o.jiraSprintId === activeSprint.jiraSprintId)) return options;

  return [
    {
      jiraSprintId: activeSprint.jiraSprintId,
      label: labelFor(activeSprint.name, activeSprint.jiraSprintId),
      isActive: true,
    },
    ...options,
  ];
}

// `labelFor` used to live here. It moved to `@/lib/sprint-identity` (S-25
// Phase 1) because the identity bar names the same nameless sprint two elements
// away from the switcher entry, and one spelling has to serve both.

/**
 * Whether the lead's manual entries are offered for the sprint on screen
 * (FR-022/FR-023) — carried in from the Phase 5 impl-review (F3).
 *
 * TWO SEPARATE WITHHOLDINGS, for two different reasons:
 *
 *  - **No `sprint` row ⇒ nothing at all.** `writeLeadColumn` resolves the
 *    owner's `sprint` row before it writes, so a sprint whose row cascaded away
 *    on a project switch CANNOT be corrected — the save would be refused with
 *    `UnknownSprintError`. Rendering a form that is guaranteed to fail teaches
 *    the lead that saves fail; saying so instead is the honest surface.
 *  - **Not finalized ⇒ no delivered-SP field.** The sweep recomputes that figure
 *    every cycle while the sprint runs, so a correction entered mid-sprint is a
 *    guess that the disjoint writers then preserve — straight into FR-024's
 *    average, with nothing recording that it was premature. The capacity
 *    override stays available regardless: capacity is a plan for the whole
 *    window, not a figure still being measured.
 */
export type AdjustmentAvailability =
  | { kind: "editable"; canCorrectDelivered: boolean }
  | { kind: "unavailable" };

export function resolveAdjustmentAvailability({
  sprintRowId,
  isFinalized,
}: {
  sprintRowId: string | null;
  /** `sprint_measurement.finalized_at !== null` for the sprint on screen. */
  isFinalized: boolean;
}): AdjustmentAvailability {
  if (sprintRowId === null) return { kind: "unavailable" };
  return { kind: "editable", canCorrectDelivered: isFinalized };
}
