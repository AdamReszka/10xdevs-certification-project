/**
 * Turn a stored sync status into something a lead can act on (S-10 Phase 7).
 * PURE and DB-free.
 *
 * WHY THIS EXISTS. The dashboard banner says "GitHub sync failed" and stops
 * there, so an owner has no route from the symptom to a next step. This maps the
 * status onto a headline plus one concrete action.
 *
 * WHY IT READS `status` AND NOTHING ELSE. `sync_state.last_error` is deliberately
 * never forwarded to a client payload (S-07 impl-review F2), and that decision
 * stands. `classifyError` in `run-sync.ts` ends with
 * `err instanceof Error ? err.message : "Unknown sync error."` — an unbounded
 * fallback that can carry a Postgres error, a driver message, or anything else a
 * non-typed throw produces. None of it has been audited for secrets. A status
 * enum has been.
 *
 * The gap this leaves — "is my token valid RIGHT NOW?" — is answered by the live
 * connection test in the settings actions, not by replaying a stale log line.
 */

import type { syncStatus } from "@/db/schema";

export type SyncStatus = (typeof syncStatus.enumValues)[number];
export type IntegrationName = "GITHUB" | "JIRA";

export type FailureReason = {
  /** One line naming what went wrong, in the lead's terms. */
  headline: string;
  /** One line naming what to do about it. */
  whatToDo: string;
  /** Whether the owner has to act, or SprintFlow recovers on its own. */
  needsOwnerAction: boolean;
};

const LABEL: Record<IntegrationName, string> = {
  GITHUB: "GitHub",
  JIRA: "Jira",
};

/**
 * Classify a failing status. Returns `null` for `OK` and for a never-attempted
 * integration (`status === null`) — neither is a failure, and rendering a
 * reason for them would invent a problem.
 */
export function classifyFailure(
  status: SyncStatus | null,
  integration: IntegrationName,
): FailureReason | null {
  const name = LABEL[integration];

  switch (status) {
    case "ERROR":
      return {
        headline: `${name} rejected SprintFlow's credentials.`,
        whatToDo: `Run "Test connection" below to confirm, then reconnect ${name} with a fresh token. A token that was revoked, expired, or lost a required scope fails this way.`,
        needsOwnerAction: true,
      };
    case "RATE_LIMITED":
      return {
        headline: `${name} is rate-limiting or temporarily unavailable.`,
        whatToDo: `Nothing to do — SprintFlow backs off and retries on the next cycle. If it persists for hours, widen the sync interval to conserve the rate-limit budget.`,
        needsOwnerAction: false,
      };
    case "OK":
    case null:
      return null;
  }
}
