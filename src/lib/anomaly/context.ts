import { anomalyType, statusCategory } from "@/db/schema";

/**
 * Typed view over the `anomaly.context` jsonb (S-07). The column is declared
 * `unknown` in the schema because each of the 8 detectors writes a different shape.
 * This module reverse-engineers those shapes (from `src/lib/anomaly/rules/*.ts`) as a
 * discriminated union keyed by the anomaly `type`, so the inbox UI narrows `context`
 * instead of touching `unknown`.
 *
 * Discriminant = the 8-value `anomaly_type` enum. `SPRINT_AT_RISK` carries a nested
 * discriminant (`condition`) because its one type has two write shapes.
 *
 * These types MUST track the detectors' `context: { ... }` literals — if a detector
 * changes what it writes, the matching variant here changes too.
 */

type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type StatusCategoryValue = (typeof statusCategory.enumValues)[number];

export type PrReviewStalledContext = {
  pullRequestId: string;
  number: number;
  ageHours: number;
  thresholdHours: number;
};

export type TicketStatusAgingContext = {
  ticketId: string;
  jiraKey: string;
  category: StatusCategoryValue;
  storyPoints: number | null;
  sinceIso: string;
};

export type DeveloperInactiveContext = {
  teamMemberId: string;
  githubUsername: string | null;
  noCommitDays: number;
};

export type TicketNoCommitLinkContext = {
  ticketId: string;
  jiraKey: string;
  daysInProgress: number;
  noCommitDays: number;
};

/** `SPRINT_AT_RISK` has two write shapes, discriminated by `condition`. */
export type SprintAtRiskParallelContext = {
  condition: "max_parallel";
  category: StatusCategoryValue;
  count: number;
  limit: number;
  teamMemberId: string;
};
export type SprintAtRiskTodoNearEndContext = {
  condition: "todo_near_end";
  todoCount: number;
  todoSp: number;
  hoursLeft: number;
};
export type SprintAtRiskContext =
  | SprintAtRiskParallelContext
  | SprintAtRiskTodoNearEndContext;

export type PrTooBigContext = {
  pullRequestId: string;
  number: number;
  lines: number;
  maxLines: number;
};

export type ScopeCreepContext = {
  sprintId: string;
  addedSp: number;
  committedSp: number;
  actualPercent: number;
  thresholdPercent: number;
};

export type PrTicketDesyncContext = {
  pullRequestId: string;
  number: number;
  linkedTicketKey: string | null;
  ticketCategory: StatusCategoryValue | null;
};

/** Anomaly type → the context shape that type's detector writes. */
export type AnomalyContextByType = {
  PR_REVIEW_STALLED: PrReviewStalledContext;
  TICKET_STATUS_AGING: TicketStatusAgingContext;
  DEVELOPER_INACTIVE: DeveloperInactiveContext;
  TICKET_NO_COMMIT_LINK: TicketNoCommitLinkContext;
  SPRINT_AT_RISK: SprintAtRiskContext;
  PR_TOO_BIG: PrTooBigContext;
  SCOPE_CREEP: ScopeCreepContext;
  PR_TICKET_DESYNC: PrTicketDesyncContext;
};

/**
 * Narrow an anomaly's `unknown` context to the typed shape for its `type`. The
 * detector that wrote the row guarantees the shape; this is the single sanctioned
 * cast, keyed on the discriminant, so call-sites stay `unknown`-free.
 */
export function anomalyContextOf<T extends AnomalyTypeValue>(anomaly: {
  type: T;
  context: unknown;
}): AnomalyContextByType[T] {
  return anomaly.context as AnomalyContextByType[T];
}

/** How an anomaly is identified for the "by ticket/PR" sort + filter. */
export type AnomalyIdentityKind = "pr" | "ticket" | null;

export type AnomalyIdentity = {
  /** `"pr"` (PR-scoped), `"ticket"` (ticket-scoped), or `null` (sprint-/member-
   * scoped — SCOPE_CREEP, SPRINT_AT_RISK, DEVELOPER_INACTIVE — no artifact). */
  kind: AnomalyIdentityKind;
  /** Display label: `#123` for PRs, the Jira key for tickets, `null` otherwise. */
  label: string | null;
  /** Stable, always-present key for the "by ticket/PR" sort. Empty string for
   * identity-less rows so callers can group them last deterministically. */
  sortKey: string;
};

/**
 * Derive the display ticket/PR identity + a stable sort key for an anomaly. Reads
 * only the identity fields (`number` / `jiraKey`) each detector writes; never
 * fabricates an identity for sprint-/member-scoped rows.
 */
export function anomalyIdentity(anomaly: {
  type: AnomalyTypeValue;
  context: unknown;
}): AnomalyIdentity {
  switch (anomaly.type) {
    case "PR_REVIEW_STALLED":
    case "PR_TOO_BIG":
    case "PR_TICKET_DESYNC": {
      const c = anomaly.context as { number?: number };
      const label = typeof c.number === "number" ? `#${c.number}` : null;
      return { kind: "pr", label, sortKey: label ? `pr:${label}` : "" };
    }
    case "TICKET_STATUS_AGING":
    case "TICKET_NO_COMMIT_LINK": {
      const c = anomaly.context as { jiraKey?: string };
      const label = c.jiraKey ?? null;
      return { kind: "ticket", label, sortKey: label ? `ticket:${label}` : "" };
    }
    default:
      return { kind: null, label: null, sortKey: "" };
  }
}
