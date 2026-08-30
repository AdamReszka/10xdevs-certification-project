/**
 * The Daily Recap's stored snapshot shape (S-11, FR-018) and the frozen bytes
 * handed to the transport.
 *
 * TYPE-ONLY MODULE. It has no runtime imports and emits no runtime code, which
 * is what lets `src/db/schema.ts` apply `.$type<RecapPayload>()` /
 * `.$type<RenderedEmail>()` to the `daily_recap` JSONB columns without a module
 * cycle: `import type` is erased at compile time, so nothing loads back into the
 * schema at runtime. Keep it that way — a single value import here would make
 * the schema module depend on the recap module.
 *
 * WHY A SNAPSHOT AND NOT FOREIGN KEYS: S-12 (FR-019) renders recap history from
 * these rows. Pointing at `anomaly` ids instead would show a recap whose
 * anomalies have since been RESOLVED, re-scored, or purged with their sprint —
 * i.e. not the email that was actually sent. The payload therefore carries
 * everything the email showed, denormalized.
 */

import type { CategoryKey } from "@/lib/dashboard/time-in-status";
import type { SyncStatusValue } from "@/lib/sync-state";

/**
 * Bumped whenever this shape changes incompatibly. Cheap now; it is what lets
 * S-12 read rows written before the change instead of crashing on them.
 */
export type RecapSchemaVersion = 1;

/** Mirrors the `severity` pgEnum, in its declaration (= sort) order. */
export type RecapSeverity = "HIGH" | "MEDIUM" | "LOW";

/** Mirrors the `anomaly_type` pgEnum. */
export type RecapAnomalyType =
  | "PR_REVIEW_STALLED"
  | "TICKET_STATUS_AGING"
  | "DEVELOPER_INACTIVE"
  | "TICKET_NO_COMMIT_LINK"
  | "SPRINT_AT_RISK"
  | "PR_TOO_BIG"
  | "SCOPE_CREEP"
  | "PR_TICKET_DESYNC";

/** One anomaly as the email showed it. */
export type RecapAnomaly = {
  id: string;
  type: RecapAnomalyType;
  severity: RecapSeverity;
  description: string;
  /**
   * Copied VERBATIM off `anomaly.suggested_action` — never regenerated.
   * `suggested-action.ts:6-7` records the contract: the builders' inputs
   * (elapsed hours, day counts) were computed against detection-time `now` and
   * cannot be reproduced later, so a re-render would silently disagree with the
   * Anomaly Inbox.
   */
  suggestedAction: string;
  /** Null for the 4 emit branches that have no deep link; renders as plain text. */
  sourceUrl: string | null;
  /** The stable ticket/PR identity label the inbox shows. */
  identityLabel: string;
  memberName: string | null;
  riskScore: number | null;
};

/** Sprint progress as of `generatedAt`. */
export type RecapSprint = {
  name: string | null;
  /**
   * The sprint's window, as ISO instants (S-25) — what makes the name in the
   * email checkable against Jira rather than merely stated.
   *
   * OPTIONAL, AND DELIBERATELY SO. `RECAP_SCHEMA_VERSION` stays `1`: every
   * payload read is gated on exact version equality
   * (`organisms/settings/recap-history-view.ts`), so a bump would turn every
   * recap already stored into `payloadReadable: false` and blank its sprint name
   * and anomaly count — a visible regression caused by a change that takes
   * nothing away from any existing reader. Not bumping is only honest if the
   * fields are optional: `daily_recap.payload` is `.$type<RecapPayload>()`, so
   * declaring them required would make the compiler believe every stored row
   * carries them, and an older payload hands `undefined` — not `null` — to the
   * renderer. Optional puts that case back where a test can reach it.
   */
  startDate?: string | null;
  endDate?: string | null;
  /** 1-based day within the sprint, or null when the sprint has no dates. */
  dayNumber: number | null;
  totalDays: number | null;
  committedSp: number | null;
  remainingSp: number | null;
  /** Ticket COUNT per current category — FR-016's distribution. */
  byCategory: Record<CategoryKey, number>;
};

/**
 * The previous local day's team rollup. TEAM granularity only — the PRD
 * Guardrail forbids per-developer performance framing, and a per-person table in
 * an email is exactly that.
 *
 * `additions`/`deletions` are nullable because null is not zero: an over-cap
 * commit keeps NULL churn permanently (`activity-grid.ts:18-24`), and a 0 would
 * claim we measured an empty commit.
 */
export type RecapActivity = {
  commits: number;
  additions: number | null;
  deletions: number | null;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  ticketsMovedToDone: number;
};

/**
 * Per-integration freshness, so an email riding on a failed sync can say so.
 *
 * `lastError` is deliberately ABSENT, for the same reason `InboxIntegrationState`
 * withholds it from the client (`dashboard/page.tsx:100-102`): it is operator
 * text that can echo a third-party response.
 */
export type RecapIntegrationState = {
  lastSuccessfulSyncAt: string | null;
  status: SyncStatusValue | null;
};

export type RecapPayload = {
  schemaVersion: RecapSchemaVersion;
  /** ISO instant the payload was assembled. */
  generatedAt: string;
  /** The local calendar day the recap is for (`YYYY-MM-DD` in `timeZone`). */
  dayKey: string;
  /** The team's IANA zone from `jira_project.time_zone`; null means UTC was used. */
  timeZone: string | null;
  sprint: RecapSprint;
  activity: RecapActivity;
  syncState: {
    GITHUB: RecapIntegrationState;
    JIRA: RecapIntegrationState;
  };
  anomalies: RecapAnomaly[];
};

/**
 * The exact bytes handed to the transport, stored on the claim row BEFORE the
 * first send and re-sent verbatim by every retry.
 *
 * This is what keeps the `Idempotency-Key` usable (plan-review F1): Resend
 * answers a repeated key carrying a DIFFERENT payload with `409
 * invalid_idempotent_request`, and `runDetect` runs on every 15-minute tick
 * immediately before the recap — so a retry that rebuilt the payload from live
 * state would differ from attempt 1 and 409 in exactly the case retries exist
 * for. Nothing on a retry path may call `renderRecapEmail` again.
 */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  /**
   * Message headers (`List-Unsubscribe` + `List-Unsubscribe-Post`), frozen here
   * rather than recomputed per attempt.
   *
   * They travel in the request BODY, so they are part of what Resend compares
   * for an `Idempotency-Key`. Deriving them at send time from live
   * `BETTER_AUTH_URL` made the byte-identical-across-attempts invariant rest on
   * "that config never changes" instead of on the mechanism chosen to guarantee
   * it (impl-review F4). Optional so rows written before this shape still read.
   */
  headers?: Record<string, string>;
};
