/**
 * Client-facing, fully-serializable shapes for the Anomaly Inbox (S-07). The server
 * component (`dashboard/page.tsx`) maps DB rows + typed context into these plain
 * primitives so the `"use client"` organism carries no `@/db/schema` runtime import
 * and no `Date`/`unknown` across the RSC boundary.
 */

export type InboxSeverity = "HIGH" | "MEDIUM" | "LOW";

export type InboxAnomalyType =
  | "PR_REVIEW_STALLED"
  | "TICKET_STATUS_AGING"
  | "DEVELOPER_INACTIVE"
  | "TICKET_NO_COMMIT_LINK"
  | "SPRINT_AT_RISK"
  | "PR_TOO_BIG"
  | "SCOPE_CREEP"
  | "PR_TICKET_DESYNC";

export type InboxAnomaly = {
  id: string;
  type: InboxAnomalyType;
  severity: InboxSeverity;
  description: string;
  suggestedAction: string;
  sourceUrl: string | null;
  riskScore: number | null;
  /** ISO-8601 UTC; used for the "by age" sort and the display timestamp. */
  detectedAt: string | null;
  memberId: string | null;
  memberName: string | null;
  /** `"pr"` / `"ticket"` / `null` (sprint-/member-scoped, no artifact). */
  identityKind: "pr" | "ticket" | null;
  /** `#123` for PRs, the Jira key for tickets, `null` otherwise. */
  identityLabel: string | null;
  /** Stable "by ticket/PR" sort key; empty string for identity-less rows. */
  identitySortKey: string;
  /** Human contextual-data chips (FR-014), pre-formatted server-side. */
  contextChips: string[];
  dedupKey: string;
};

export type InboxRosterMember = {
  id: string;
  name: string;
};

/** Human labels for the 8 anomaly types — shared by the row + the type filter. */
export const TYPE_LABEL: Record<InboxAnomalyType, string> = {
  PR_REVIEW_STALLED: "PR review stalled",
  TICKET_STATUS_AGING: "Ticket status aging",
  DEVELOPER_INACTIVE: "Developer inactive",
  TICKET_NO_COMMIT_LINK: "Ticket no-commit link",
  SPRINT_AT_RISK: "Sprint at risk",
  PR_TOO_BIG: "PR too big",
  SCOPE_CREEP: "Scope creep",
  PR_TICKET_DESYNC: "PR ↔ ticket desync",
};

export type InboxIntegration = "GITHUB" | "JIRA";
export type InboxSyncStatus = "OK" | "ERROR" | "RATE_LIMITED";

export type InboxIntegrationState = {
  integration: InboxIntegration;
  /** ISO-8601 UTC of the last successful sync, or null if never synced. */
  lastSuccessfulSyncAt: string | null;
  status: InboxSyncStatus | null;
  // Raw `lastError` is deliberately NOT surfaced to the client (defense-in-depth
  // vs. the tokens-never-in-client-payload guardrail) — the banner renders a
  // friendly per-status message from `status` alone.
};

export type InboxSyncState = Record<InboxIntegration, InboxIntegrationState>;
