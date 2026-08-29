/**
 * Display logic for `/settings/recap/history` and its drill-in (S-12, FR-019).
 * PURE, no React.
 *
 * Split out for the reason CLAUDE.md states: there is no component-test harness
 * in this project (no jsdom, no RTL), so any judgement a `.tsx` makes moves to a
 * `.ts` sibling where a unit test can reach it. Same split as
 * `recap-settings-view.ts`, `absence-calendar-view.ts`, `roster-merge.ts`.
 *
 * THIS MODULE OWNS THE SEND-STATE MAPPING for the whole recap surface.
 * `describeLastSend` (`recap-settings-view.ts`) drew the same five distinctions
 * one card at a time; it now calls {@link classifyRecapSend} instead. A second
 * copy of "is this PENDING row in flight or stalled" would drift the moment one
 * of the two constants below changed, and the two surfaces would then disagree
 * about the same row on the same screen.
 */

import type { RecapPayload } from "@/lib/recap/types";
import { RECAP_SCHEMA_VERSION } from "@/lib/recap/schema-version";

/**
 * The claim TTL from `recap/send.ts:58`. A PENDING row older than this was
 * orphaned by a crashed invocation and the next cron tick reclaims it — so the
 * copy must stop saying "being sent right now".
 */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

/** The attempt cap from `recap/send.ts:65`. At it, the row is done for the day. */
export const MAX_ATTEMPTS = 3;

/** The four `daily_recap.send_status` values plus the two splits below. */
export type RecapSendRow = {
  recapDay: string;
  sendStatus: "PENDING" | "SENT" | "FAILED";
  /** ISO instant, or null when the send never completed. */
  sentAt: string | null;
  attemptCount: number;
  /** ISO instant the current attempt claimed the row; null on an unclaimed one. */
  lastAttemptAt: string | null;
};

/**
 * The stored status, split where the status alone is ambiguous.
 *
 * Two of the three stored values wear two situations each, and reporting the
 * second as the first is how a stalled recap reads as healthy indefinitely
 * (S-11 impl-review F6).
 */
export type RecapSendState =
  | "SENT"
  | "PENDING_IN_FLIGHT"
  | "PENDING_STALLED"
  | "FAILED_RETRYABLE"
  | "FAILED_EXHAUSTED";

/**
 * `now` is an injected default parameter, not a captured `Date.now()`, so the
 * two time-dependent branches stay unit-testable — and so the demo's frozen
 * clock has somewhere to land.
 */
export function classifyRecapSend(row: RecapSendRow, now: Date = new Date()): RecapSendState {
  switch (row.sendStatus) {
    case "SENT":
      return "SENT";
    case "PENDING": {
      const claimedAt = row.lastAttemptAt ? Date.parse(row.lastAttemptAt) : NaN;
      // No timestamp fails toward the honest reading: without one we cannot
      // claim a send is in progress.
      const stalled = Number.isNaN(claimedAt) || now.getTime() - claimedAt >= CLAIM_TTL_MS;
      return stalled ? "PENDING_STALLED" : "PENDING_IN_FLIGHT";
    }
    case "FAILED":
      return row.attemptCount >= MAX_ATTEMPTS ? "FAILED_EXHAUSTED" : "FAILED_RETRYABLE";
  }
}

/** One row of the history list, as the page hands it over (dates already ISO). */
export type RecapHistoryRow = RecapSendRow & {
  id: string;
  /**
   * Whether `rendered_message` survived. Genuinely absent for two states
   * (`recap/send.ts:143-155` and `:223-231`), so the list marks it rather than
   * offering a drill-in that can only show an apology.
   */
  hasRenderedMessage: boolean;
};

/** Everything the list row renders, decided here so the `.tsx` only lays it out. */
export type RecapRowView = {
  state: RecapSendState;
  /** The badge's short word. */
  label: string;
  /** Maps onto the shadcn `Badge` variants the settings surfaces already use. */
  tone: "secondary" | "destructive" | "outline";
  /** The one-line "what happened to this one". */
  detail: string;
  /** `YYYY-MM-DD HH:MM UTC`, or `—` when the row never reached a timestamp. */
  when: string;
  href: string;
};

/** The same `HH:MM UTC` rendering `sync-history.tsx:36-38` uses. */
function formatAt(iso: string | null): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—";
}

const LABEL: Record<RecapSendState, { label: string; tone: RecapRowView["tone"] }> = {
  SENT: { label: "Sent", tone: "secondary" },
  PENDING_IN_FLIGHT: { label: "Sending", tone: "outline" },
  PENDING_STALLED: { label: "Stalled", tone: "outline" },
  FAILED_RETRYABLE: { label: "Failed", tone: "destructive" },
  FAILED_EXHAUSTED: { label: "Failed", tone: "destructive" },
};

/**
 * One history row's view-model.
 *
 * A FAILED row is the most valuable thing on this list — the settings page's
 * last-send line only ever shows the newest one — so nothing here hides it or
 * softens it into an "—".
 */
export function describeRecapRow(row: RecapHistoryRow, now: Date = new Date()): RecapRowView {
  const state = classifyRecapSend(row, now);
  const { label, tone } = LABEL[state];

  let detail: string;
  switch (state) {
    case "SENT":
      detail = "Delivered to your inbox.";
      break;
    case "PENDING_IN_FLIGHT":
      detail = "Being sent right now.";
      break;
    case "PENDING_STALLED":
      detail = "Stalled mid-send — SprintFlow will retry it within 15 minutes.";
      break;
    case "FAILED_RETRYABLE":
      detail = `Failed on attempt ${row.attemptCount} — SprintFlow will try again within 15 minutes.`;
      break;
    case "FAILED_EXHAUSTED":
      detail = `Not delivered after ${MAX_ATTEMPTS} attempts.`;
      break;
  }

  // Said out loud rather than left as an empty drill-in: the row exists, the
  // message never got as far as being rendered, and those are different facts.
  if (!row.hasRenderedMessage) {
    detail = `${detail} The message was never rendered, so there is nothing to read.`;
  }

  return {
    state,
    label,
    tone,
    detail,
    // A SENT row's timestamp is when it left; anything else has only its last
    // attempt to show.
    when: formatAt(state === "SENT" ? (row.sentAt ?? row.lastAttemptAt) : row.lastAttemptAt),
    href: `/settings/recap/history/${row.id}`,
  };
}

/**
 * The empty state. A plain sentence, never a spinner and never an error — an
 * account whose first recap has not gone out yet is in a normal state, and
 * FR-019's history is bounded, so "empty" is also what an old account looks like
 * after a long gap.
 */
export const RECAP_HISTORY_EMPTY =
  "No recaps yet. They appear here once the daily send has run — SprintFlow keeps the current sprint and the two before it.";

/**
 * What a stored payload may look like when it was NOT written by this build.
 *
 * Typed loosely on purpose. `daily_recap.payload` is declared
 * `.$type<RecapPayload>()`, so the compiler believes every row matches the
 * CURRENT shape — which is exactly the belief `schemaVersion` exists to stop us
 * acting on.
 */
export type StoredRecapPayload = Pick<RecapPayload, "schemaVersion"> &
  Partial<Omit<RecapPayload, "schemaVersion">>;

export type RecapHeaderFacts = {
  /** The sprint the recap was about, or null when the payload cannot be read. */
  sprintName: string | null;
  /** When the payload was assembled; falls back to the row's own timestamps. */
  generatedAt: string | null;
  /** How many anomalies the email carried, or null when unknown. */
  anomalyCount: number | null;
  /**
   * False when there is no payload, or when there is one this build does not
   * understand. The detail page says so rather than rendering blanks.
   */
  payloadReadable: boolean;
};

/**
 * The detail page's header facts, read from the payload ONLY when this build
 * wrote its shape.
 *
 * `RECAP_SCHEMA_VERSION` exists so S-12 can read rows written before a later
 * payload change (`types.ts:22-26`); without this check the guard is decorative
 * and a v2 row renders `undefined` into the page (plan-review F6). The frozen
 * `rendered_message` is unaffected — it is bytes, not a shape, and is displayed
 * whatever the payload says.
 */
export function readRecapHeaderFacts(
  row: RecapSendRow,
  payload: StoredRecapPayload | null,
): RecapHeaderFacts {
  const readable = payload !== null && payload.schemaVersion === RECAP_SCHEMA_VERSION;

  if (!readable) {
    return {
      sprintName: null,
      // The row's own columns, which every row has regardless of payload shape.
      generatedAt: row.sentAt ?? row.lastAttemptAt,
      anomalyCount: null,
      payloadReadable: false,
    };
  }

  return {
    sprintName: payload.sprint?.name ?? null,
    generatedAt: payload.generatedAt ?? row.sentAt ?? row.lastAttemptAt,
    anomalyCount: payload.anomalies?.length ?? null,
    payloadReadable: true,
  };
}
