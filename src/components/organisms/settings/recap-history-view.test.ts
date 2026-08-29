import { describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  RECAP_HISTORY_EMPTY,
  describeRecapRow,
  readRecapHeaderFacts,
  type RecapHistoryRow,
  type StoredRecapPayload,
} from "./recap-history-view";

/**
 * `/settings/recap/history`'s display logic (S-12, FR-019). Unit-testable only
 * because it lives outside the `.tsx` — there is no component-test harness here.
 */

function row(over: Partial<RecapHistoryRow> = {}): RecapHistoryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    recapDay: "2026-08-26",
    sendStatus: "SENT",
    sentAt: "2026-08-26T13:00:12.000Z",
    attemptCount: 1,
    lastAttemptAt: "2026-08-26T13:00:00.000Z",
    hasRenderedMessage: true,
    ...over,
  };
}

describe("describeRecapRow", () => {
  it("reads a delivered row as delivered, timestamped from the send", () => {
    const view = describeRecapRow(row());
    expect(view.state).toBe("SENT");
    expect(view.label).toBe("Sent");
    expect(view.when).toBe("2026-08-26 13:00 UTC");
    expect(view.href).toBe("/settings/recap/history/11111111-1111-4111-8111-111111111111");
  });

  it("distinguishes a retryable failure from an exhausted one", () => {
    const retryable = describeRecapRow(row({ sendStatus: "FAILED", attemptCount: 1 }));
    expect(retryable.state).toBe("FAILED_RETRYABLE");
    expect(retryable.tone).toBe("destructive");
    expect(retryable.detail).toContain("attempt 1");
    expect(retryable.detail).toContain("try again");

    const exhausted = describeRecapRow(
      row({ sendStatus: "FAILED", attemptCount: MAX_ATTEMPTS }),
    );
    expect(exhausted.state).toBe("FAILED_EXHAUSTED");
    expect(exhausted.detail).toContain(`${MAX_ATTEMPTS} attempts`);
    expect(exhausted.detail).not.toContain("try again");
  });

  it("reports a FRESH PENDING claim as in flight", () => {
    const now = new Date("2026-08-26T13:02:00.000Z"); // 2 min into the claim
    const view = describeRecapRow(
      row({ sendStatus: "PENDING", sentAt: null, lastAttemptAt: "2026-08-26T13:00:00.000Z" }),
      now,
    );
    expect(view.state).toBe("PENDING_IN_FLIGHT");
    expect(view.detail).toContain("Being sent right now");
  });

  it("reports a STALE PENDING claim as stalled, not as in flight", () => {
    // Same distinction the settings card draws (S-11 impl-review F6), drawn by
    // the SAME classifier — a stalled recap that reads as healthy is how one
    // stays broken indefinitely.
    const now = new Date("2026-08-26T13:20:00.000Z"); // 20 min — past the TTL
    const view = describeRecapRow(
      row({ sendStatus: "PENDING", sentAt: null, lastAttemptAt: "2026-08-26T13:00:00.000Z" }),
      now,
    );
    expect(view.state).toBe("PENDING_STALLED");
    expect(view.detail).toContain("Stalled");
  });

  it("treats a PENDING row with no claim timestamp as stalled, and shows no time", () => {
    const view = describeRecapRow(
      row({ sendStatus: "PENDING", sentAt: null, lastAttemptAt: null }),
    );
    expect(view.state).toBe("PENDING_STALLED");
    expect(view.when).toBe("—");
  });

  it("says out loud when a row has no rendered message", () => {
    // The row exists and the message was never rendered — two different facts.
    // Without this the drill-in is an unexplained blank page.
    const view = describeRecapRow(
      row({ sendStatus: "FAILED", attemptCount: MAX_ATTEMPTS, hasRenderedMessage: false }),
    );
    expect(view.detail).toContain("never rendered");
    expect(describeRecapRow(row()).detail).not.toContain("never rendered");
  });

  it("offers an empty state that is neither a spinner nor an error", () => {
    expect(RECAP_HISTORY_EMPTY).toContain("No recaps yet");
    expect(RECAP_HISTORY_EMPTY).not.toMatch(/error|failed/i);
  });
});

describe("readRecapHeaderFacts", () => {
  const payload = (over: Partial<StoredRecapPayload> = {}): StoredRecapPayload =>
    ({
      schemaVersion: 1,
      generatedAt: "2026-08-26T12:59:00.000Z",
      sprint: { name: "Sprint 24", dayNumber: 13, totalDays: 14 },
      anomalies: [{}, {}, {}],
      ...over,
    }) as StoredRecapPayload;

  it("reads the sprint, the instant and the count off a current payload", () => {
    const facts = readRecapHeaderFacts(row(), payload());
    expect(facts).toEqual({
      sprintName: "Sprint 24",
      generatedAt: "2026-08-26T12:59:00.000Z",
      anomalyCount: 3,
      payloadReadable: true,
    });
  });

  it("falls back to the row's own columns for an UNKNOWN schema version", () => {
    // plan-review F6. `RECAP_SCHEMA_VERSION` exists so this slice can read rows
    // written before a later payload change; without the check the guard is
    // decorative and a v2 row renders `undefined` into the page.
    const future = { ...payload(), schemaVersion: 2 } as unknown as StoredRecapPayload;
    const facts = readRecapHeaderFacts(row(), future);

    expect(facts.payloadReadable).toBe(false);
    expect(facts.sprintName).toBeNull();
    expect(facts.anomalyCount).toBeNull();
    // The row's own column, which every row has whatever the payload shape is.
    expect(facts.generatedAt).toBe("2026-08-26T13:00:12.000Z");
  });

  it("treats an absent payload the same way, and reaches lastAttemptAt when there is no send", () => {
    const facts = readRecapHeaderFacts(
      row({ sendStatus: "FAILED", attemptCount: MAX_ATTEMPTS, sentAt: null }),
      null,
    );
    expect(facts.payloadReadable).toBe(false);
    expect(facts.generatedAt).toBe("2026-08-26T13:00:00.000Z");
  });

  it("tolerates a current-version payload with pieces missing", () => {
    const facts = readRecapHeaderFacts(row(), { schemaVersion: 1 });
    expect(facts.payloadReadable).toBe(true);
    expect(facts.sprintName).toBeNull();
    expect(facts.anomalyCount).toBeNull();
    expect(facts.generatedAt).toBe("2026-08-26T13:00:12.000Z");
  });
});
